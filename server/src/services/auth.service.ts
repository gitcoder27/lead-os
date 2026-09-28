import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import type { AuthUser, UserRole } from "shared/types";
import { db } from "../db/connection";
import { runInTransaction } from "../db/transaction";
import { appSessions, appUsers, developers } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId, WorkspaceService } from "./workspace.service";

/** Password rules shared by account creation (`/register`), reset and the admin CLI. */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 200;

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_COOKIE_NAME = "dcc_session";
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const scryptAsync = promisify(scrypt);

interface CreateUserParams {
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
  workspaceId?: string;
  developerAccountId?: string;
  isActive?: boolean;
}

interface PersistedUser {
  id: number;
  workspaceId: string;
  username: string;
  displayName: string;
  role: UserRole;
  developerAccountId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64) as Buffer).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const derived = await scryptAsync(password, salt, 64) as Buffer;
  const stored = Buffer.from(hash, "hex");

  if (stored.length !== derived.length) {
    return false;
  }

  return timingSafeEqual(derived, stored);
}

function mapAuthUser(user: PersistedUser): AuthUser {
  return {
    username: user.username,
    accountId: user.developerAccountId ?? user.username,
    workspaceId: user.workspaceId,
    displayName: user.displayName,
    role: user.role,
    developerAccountId: user.developerAccountId,
  };
}

export function serializeSessionCookie(sessionId: string, maxAgeSeconds = SESSION_MAX_AGE_SECONDS): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (IS_PRODUCTION) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (IS_PRODUCTION) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export class AuthService {
  readonly sessionMaxAgeSeconds = SESSION_MAX_AGE_SECONDS;

  constructor(private readonly workspaceService = new WorkspaceService()) {}

  async createUser(params: CreateUserParams): Promise<AuthUser> {
    const username = normalizeUsername(params.username);
    if (!username) {
      throw new HttpError(400, "username is required");
    }

    const userCount = await this.getUserCount();
    if (userCount === 0 && params.role !== "manager") {
      throw new HttpError(403, "The first account must be a manager");
    }

    const workspaceId = await this.resolveWorkspaceIdForNewUser({
      explicitWorkspaceId: params.workspaceId,
      userCount,
      role: params.role,
      username,
      displayName: params.displayName,
    });

    if (params.role === "developer" && !params.developerAccountId) {
      throw new HttpError(400, "developerAccountId is required for developer users");
    }
    if (params.role === "developer" && params.developerAccountId) {
      const developerRows = await db
        .select({ accountId: developers.accountId })
        .from(developers)
        .where(
          and(
            eq(developers.workspaceId, workspaceId),
            eq(developers.accountId, params.developerAccountId),
            eq(developers.isActive, 1)
          )
        )
        .limit(1);

      if (!developerRows[0]) {
        throw new HttpError(400, "developerAccountId must match an active team member");
      }
    }

    const now = nowIso();
    const inserted = await db
      .insert(appUsers)
      .values({
        workspaceId,
        username,
        displayName: params.displayName.trim(),
        passwordHash: await hashPassword(params.password),
        role: params.role,
        developerAccountId: params.developerAccountId ?? null,
        isActive: params.isActive === false ? 0 : 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new Error("Failed to create user");
    }

    return mapAuthUser({
      id: row.id,
      workspaceId: row.workspaceId,
      username: row.username,
      displayName: row.displayName,
      role: row.role as UserRole,
      developerAccountId: row.developerAccountId ?? undefined,
    });
  }

  async authenticate(username: string, password: string): Promise<{ sessionId: string; user: AuthUser }> {
    const normalizedUsername = normalizeUsername(username);
    const rows = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.username, normalizedUsername), eq(appUsers.isActive, 1)))
      .limit(1);

    const row = rows[0];
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      throw new HttpError(401, "Invalid username or password");
    }

    const now = nowIso();
    const sessionId = randomBytes(32).toString("hex");
    await db.insert(appSessions).values({
      id: sessionId,
      userId: row.id,
      createdAt: now,
      expiresAt: addSeconds(now, this.sessionMaxAgeSeconds),
      lastSeenAt: now,
    });

    return {
      sessionId,
      user: mapAuthUser({
        id: row.id,
        workspaceId: row.workspaceId,
        username: row.username,
        displayName: row.displayName,
        role: row.role as UserRole,
        developerAccountId: row.developerAccountId ?? undefined,
      }),
    };
  }

  async getUserForSession(sessionId: string): Promise<AuthUser | undefined> {
    const rows = await db
      .select({
        sessionId: appSessions.id,
        userId: appUsers.id,
        workspaceId: appUsers.workspaceId,
        username: appUsers.username,
        displayName: appUsers.displayName,
        role: appUsers.role,
        developerAccountId: appUsers.developerAccountId,
        isActive: appUsers.isActive,
        expiresAt: appSessions.expiresAt,
        lastSeenAt: appSessions.lastSeenAt,
      })
      .from(appSessions)
      .innerJoin(appUsers, eq(appUsers.id, appSessions.userId))
      .where(eq(appSessions.id, sessionId))
      .limit(1);

    const row = rows[0];
    if (!row || row.isActive !== 1) {
      return undefined;
    }

    const now = nowIso();
    if (new Date(row.expiresAt).getTime() <= new Date(now).getTime()) {
      await this.invalidateSession(sessionId);
      return undefined;
    }

    const lastSeenAt = new Date(row.lastSeenAt).getTime();
    if (Number.isNaN(lastSeenAt) || Date.now() - lastSeenAt >= SESSION_TOUCH_INTERVAL_MS) {
      await db
        .update(appSessions)
        .set({ lastSeenAt: now })
        .where(eq(appSessions.id, sessionId));
    }

    return mapAuthUser({
      id: row.userId,
      workspaceId: row.workspaceId,
      username: row.username,
      displayName: row.displayName,
      role: row.role as UserRole,
      developerAccountId: row.developerAccountId ?? undefined,
    });
  }

  async invalidateSession(sessionId: string): Promise<void> {
    await db.delete(appSessions).where(eq(appSessions.id, sessionId));
  }

  async getUserCount(): Promise<number> {
    const rows = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(eq(appUsers.isActive, 1));
    return rows.length;
  }

  async listUsers(workspaceId?: string): Promise<AuthUser[]> {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.workspaceId, normalizedWorkspaceId), eq(appUsers.isActive, 1)));

    return rows.map((row) =>
      mapAuthUser({
        id: row.id,
        workspaceId: row.workspaceId,
        username: row.username,
        displayName: row.displayName,
        role: row.role as UserRole,
        developerAccountId: row.developerAccountId ?? undefined,
      })
    );
  }

  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<void> {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new HttpError(400, "username is required");
    }
    if (!newPassword || newPassword.length < 6) {
      throw new HttpError(400, "New password must be at least 6 characters");
    }

    const rows = await db
      .select()
      .from(appUsers)
      .where(and(eq(appUsers.username, normalizedUsername), eq(appUsers.isActive, 1)))
      .limit(1);

    const row = rows[0];
    if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
      throw new HttpError(401, "Invalid username or current password");
    }

    await db
      .update(appUsers)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: nowIso() })
      .where(eq(appUsers.id, row.id));
  }

  /**
   * Admin password reset: sets a new password without the current one and signs the
   * user out everywhere. `allowedRoles` is the caller's policy (the Settings route
   * passes ["developer"]; the host-trusted CLI also allows managers). `workspaceId`
   * scopes the lookup for callers that are tied to a workspace; the CLI omits it
   * because usernames are globally unique. Never logs or returns the password.
   */
  async resetPassword(
    username: string,
    newPassword: string,
    options: { allowedRoles: UserRole[]; workspaceId?: string }
  ): Promise<{ username: string; role: UserRole; sessionsRevoked: number }> {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new HttpError(400, "username is required");
    }
    if (typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new HttpError(400, `New password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (newPassword.length > PASSWORD_MAX_LENGTH) {
      throw new HttpError(400, `New password must be at most ${PASSWORD_MAX_LENGTH} characters`);
    }

    const rows = await db
      .select()
      .from(appUsers)
      .where(
        and(
          eq(appUsers.username, normalizedUsername),
          eq(appUsers.isActive, 1),
          options.workspaceId ? eq(appUsers.workspaceId, normalizeWorkspaceId(options.workspaceId)) : undefined
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new HttpError(404, "User not found");
    }
    const role = row.role as UserRole;
    if (!options.allowedRoles.includes(role)) {
      throw new HttpError(403, `Passwords for ${role} accounts cannot be reset here`);
    }

    const passwordHash = await hashPassword(newPassword);
    return runInTransaction(async () => {
      await db.update(appUsers).set({ passwordHash, updatedAt: nowIso() }).where(eq(appUsers.id, row.id));
      const revoked = await db.delete(appSessions).where(eq(appSessions.userId, row.id)).returning({ id: appSessions.id });
      return { username: row.username, role, sessionsRevoked: revoked.length };
    });
  }

  async deleteUser(username: string, workspaceId?: string): Promise<void> {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new HttpError(400, "username is required");
    }

    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const rows = await db
      .select()
      .from(appUsers)
      .where(
        and(
          eq(appUsers.workspaceId, normalizedWorkspaceId),
          eq(appUsers.username, normalizedUsername),
          eq(appUsers.isActive, 1)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new HttpError(404, "User not found");
    }

    if (row.role !== "developer") {
      throw new HttpError(400, "Only developer accounts can be deleted from settings");
    }

    await db.delete(appSessions).where(eq(appSessions.userId, row.id));
    await db.delete(appUsers).where(eq(appUsers.id, row.id));
  }

  private async resolveWorkspaceIdForNewUser(params: {
    explicitWorkspaceId?: string;
    userCount: number;
    role: UserRole;
    username: string;
    displayName: string;
  }): Promise<string> {
    if (params.explicitWorkspaceId) {
      return this.workspaceService.assertWorkspaceExists(params.explicitWorkspaceId);
    }

    if (params.userCount === 0) {
      return this.workspaceService.ensureDefaultWorkspace(params.role === "manager" ? params.username : undefined);
    }

    if (params.role === "manager") {
      return this.workspaceService.createWorkspaceForManager(params.username, params.displayName);
    }

    return this.workspaceService.assertWorkspaceExists(DEFAULT_WORKSPACE_ID);
  }
}
