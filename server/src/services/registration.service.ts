import { USERNAME_PATTERN, RESERVED_USERNAMES, signUpPasswordError, type SignUpRequest } from "shared/types";
import { AuthService, hashPassword } from "./auth.service";
import { WorkspaceService } from "./workspace.service";
import { isValidTimeZone } from "./today-clock";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, rawDb } from "../db/connection";
import { appUsers, registrationInvites } from "../db/schema";
import { HttpError } from "../middleware/errorHandler";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const validTokenShape = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
export class RegistrationService {
  constructor(private readonly auth = new AuthService(), private readonly workspaces = new WorkspaceService()) {}

  async signUp(input: SignUpRequest) {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username) || (RESERVED_USERNAMES as readonly string[]).includes(username)) throw new HttpError(400, "Choose a username of 3–40 letters, numbers, dots, underscores or hyphens.");
    const passwordError = signUpPasswordError(input.password, username);
    if (passwordError) throw new HttpError(400, passwordError);
    if (!input.displayName.trim() || input.displayName.trim().length > 200) throw new HttpError(400, "Enter your name (up to 200 characters).");
    if (input.timeZone && !isValidTimeZone(input.timeZone)) throw new HttpError(400, "Choose a valid time zone.");
    const passwordHash = await hashPassword(input.password);
    return rawDb.transaction(() => {
      const invite = this.findValidInvite(input.inviteToken);
      if (!invite) throw new HttpError(410, "This invite link is no longer valid.");
      if (db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.username, username)).get()) throw new HttpError(409, "That username is taken.");
      const workspaceId = this.workspaces.createWorkspaceForManager(username, input.displayName);
      const user = this.auth.createUserWithHash({ username, displayName: input.displayName, role: "manager", password: input.password, workspaceId, isInstallAdmin: false }, passwordHash);
      this.workspaces.initializeWorkspace(workspaceId, { timeZone: input.timeZone });
      const userRow = db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.username, username)).get()!;
      db.update(registrationInvites).set({ usedAt: new Date().toISOString(), usedByUserId: userRow.id }).where(eq(registrationInvites.id, invite.id)).run();
      return user;
    })();
  }

  createInvite({ note, createdBy = "operator", expiresDays = 7 }: { note?: string; createdBy?: string; expiresDays?: number } = {}) {
    if (!Number.isInteger(expiresDays) || expiresDays < 1 || expiresDays > 365) throw new HttpError(400, "Expiry must be 1–365 days");
    if (!db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.isInstallAdmin, 1), eq(appUsers.role, "manager"), eq(appUsers.isActive, 1))).get()) throw new HttpError(409, "Complete install-owner setup before creating invites");
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const row = db.insert(registrationInvites).values({ tokenHash: tokenHash(token), note: note?.trim().slice(0, 200) || null, createdBy, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + expiresDays * 86400000).toISOString() }).returning({ id: registrationInvites.id, expiresAt: registrationInvites.expiresAt }).get();
    if (!row) throw new Error("Invite creation failed");
    return { ...row, token }; // Trusted CLI only, displayed once. Never logged.
  }

  findValidInvite(token: string) {
    if (!validTokenShape(token)) return undefined;
    const invite = db.select().from(registrationInvites).where(eq(registrationInvites.tokenHash, tokenHash(token))).get();
    return invite && !invite.usedAt && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now() ? invite : undefined;
  }
  checkInvite(token: string): boolean { return Boolean(this.findValidInvite(token)); }

  listInvites() {
    return db.select({ id: registrationInvites.id, note: registrationInvites.note, createdBy: registrationInvites.createdBy, createdAt: registrationInvites.createdAt, expiresAt: registrationInvites.expiresAt, usedAt: registrationInvites.usedAt, revokedAt: registrationInvites.revokedAt }).from(registrationInvites).all().map(invite => ({ ...invite, state: invite.usedAt ? "used" : invite.revokedAt ? "revoked" : Date.parse(invite.expiresAt) <= Date.now() ? "expired" : "active" }));
  }
  revokeInvite(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "A positive invite id is required");
    const result = db.update(registrationInvites).set({ revokedAt: new Date().toISOString() }).where(eq(registrationInvites.id, id)).run();
    if (!result.changes) throw new HttpError(404, "Invite not found");
    return { revoked: true, id };
  }
}
