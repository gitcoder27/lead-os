import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import type { AuthUser as PublicAuthUser, UserRole } from "shared/types";
import { db } from "../db/connection";
import { runInTransaction } from "../db/transaction";
import { appSessions, appUsers, developers } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId, WorkspaceService } from "./workspace.service";

/** Authority belongs only to the server principal, never to a client payload. */
export interface ServerAuthUser extends PublicAuthUser { isInstallAdmin: boolean; }
type AuthUser = ServerAuthUser;

export function publicAuthUser(user: PublicAuthUser): PublicAuthUser {
  return { username: user.username, accountId: user.accountId, workspaceId: user.workspaceId, displayName: user.displayName, role: user.role, developerAccountId: user.developerAccountId };
}

/** Password rules shared by account creation (`/register`), reset and the admin CLI. */
/** docs/56 P2-01: raised from 6. Applies to new passwords only; existing logins are unaffected. */
export const PASSWORD_MIN_LENGTH = 8;
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
  isInstallAdmin?: boolean;
}

interface PersistedUser {
  isInstallAdmin: number;
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
    isInstallAdmin: user.isInstallAdmin === 1,
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

    // The route validates too; this covers the CLI, which calls the service directly.
    if (typeof params.password !== "string" || params.password.length < PASSWORD_MIN_LENGTH) {
      throw new HttpError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
    }
    if (params.password.length > PASSWORD_MAX_LENGTH) {
      throw new HttpError(400, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);
    }

    if (params.isInstallAdmin && params.role !== "manager") throw new HttpError(400, "Install authority requires a manager account");
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
        isInstallAdmin: params.role === "manager" && (userCount === 0 || params.isInstallAdmin === true) ? 1 : 0,
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
      isInstallAdmin: row.isInstallAdmin,
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
    // Same generic error: don't reveal that the account exists but was removed.
    if (row.role === "developer" && !(await this.isActiveDeveloper(row.workspaceId, row.developerAccountId))) {
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
      isInstallAdmin: row.isInstallAdmin,
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
        isInstallAdmin: appUsers.isInstallAdmin,
        expiresAt: appSessions.expiresAt,
        lastSeenAt: appSessions.lastSeenAt,
        teamMemberIsActive: developers.isActive,
      })
      .from(appSessions)
      .innerJoin(appUsers, eq(appUsers.id, appSessions.userId))
      // Same query, no extra round trip: managers have a null developerAccountId so
      // the join matches nothing; developers pick up their team member's state.
      .leftJoin(
        developers,
        and(eq(developers.workspaceId, appUsers.workspaceId), eq(developers.accountId, appUsers.developerAccountId))
      )
      .where(eq(appSessions.id, sessionId))
      .limit(1);

    const row = rows[0];
    if (!row || row.isActive !== 1) {
      return undefined;
    }

    // Defense in depth: a developer login is only valid while its team member is
    // active, even if removal failed to delete the session or user row.
    if (row.role === "developer" && row.teamMemberIsActive !== 1) {
      await this.invalidateSession(sessionId);
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
      isInstallAdmin: row.isInstallAdmin,
    });
  }

  async invalidateSession(sessionId: string): Promise<void> {
    await db.delete(appSessions).where(eq(appSessions.id, sessionId));
  }

  /**
   * Deletes every session of the developer-role logins mapped to a team member.
   * Managers are never matched: the role filter is part of the query.
   */
  async revokeDeveloperSessions(developerAccountId: string, workspaceId?: string): Promise<number> {
    const userIds = await this.developerLoginIds(developerAccountId, workspaceId);
    if (userIds.length === 0) return 0;
    const deleted = await db.delete(appSessions).where(inArray(appSessions.userId, userIds)).returning({ id: appSessions.id });
    return deleted.length;
  }

  /**
   * Team-member removal: delete the developer's sessions and login rows. Rows are
   * deleted rather than deactivated because `username` is globally unique, so a
   * dead row would block re-linking a login (and `listUsers` hides inactive rows,
   * leaving the manager no way to see or clear it). Mirrors `deleteUser`.
   * Returns the number of logins removed.
   */
  async revokeDeveloperAccess(developerAccountId: string, workspaceId?: string): Promise<number> {
    const userIds = await this.developerLoginIds(developerAccountId, workspaceId);
    if (userIds.length === 0) return 0;
    await db.delete(appSessions).where(inArray(appSessions.userId, userIds));
    await db.delete(appUsers).where(inArray(appUsers.id, userIds));
    return userIds.length;
  }

  private async developerLoginIds(developerAccountId: string, workspaceId?: string): Promise<number[]> {
    const rows = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(
        and(
          eq(appUsers.workspaceId, normalizeWorkspaceId(workspaceId)),
          eq(appUsers.role, "developer"),
          eq(appUsers.developerAccountId, developerAccountId)
        )
      );
    return rows.map((row) => row.id);
  }

  private async isActiveDeveloper(workspaceId: string, developerAccountId: string | null): Promise<boolean> {
    if (!developerAccountId) return false;
    const rows = await db
      .select({ isActive: developers.isActive })
      .from(developers)
      .where(and(eq(developers.workspaceId, workspaceId), eq(developers.accountId, developerAccountId)))
      .limit(1);
    return rows[0]?.isActive === 1;
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
      isInstallAdmin: row.isInstallAdmin,
      })
    );
  }

  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<void> {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new HttpError(400, "username is required");
    }
    if (!newPassword || newPassword.length < PASSWORD_MIN_LENGTH) {
      throw new HttpError(400, `New password must be at least ${PASSWORD_MIN_LENGTH} characters`);
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
