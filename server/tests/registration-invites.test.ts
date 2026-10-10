import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { migrateRegistrationInvites } from "../src/db/registration-invites";
import { config } from "../src/config";
import { RegistrationService } from "../src/services/registration.service";
import { AuthService } from "../src/services/auth.service";
import { resetDatabase } from "./helpers/db";
const service = new RegistrationService();
describe("install invitations", () => {
  beforeEach(async () => {
    await resetDatabase(); rawDb.prepare("DELETE FROM registration_invites").run();
    await new AuthService().createUser({ username: "owner", password: "fixture-password", displayName: "Owner", role: "manager" });
  });
  it("defaults registration off", () => { expect(config.LEADOS_REGISTRATION).toBe("off"); });
  it("stores a random token hashed, never lists it, and revokes it", () => {
    const invite = service.createInvite({ note: "Friend" });
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = rawDb.prepare("SELECT * FROM registration_invites WHERE id=?").get(invite.id) as { token_hash: string };
    expect(stored.token_hash).toBe(createHash("sha256").update(invite.token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(invite.token);
    expect(service.checkInvite(invite.token)).toBe(true);
    expect(service.listInvites()).toEqual([expect.objectContaining({ id: invite.id, note: "Friend", state: "active" })]);
    expect(JSON.stringify(service.listInvites())).not.toMatch(/token|hash/);
    service.revokeInvite(invite.id); expect(service.checkInvite(invite.token)).toBe(false);
  });
  it("expires at exactly the boundary and refuses used or unknown links", () => {
    const invite = service.createInvite({ expiresDays: 1 });
    vi.useFakeTimers(); try { vi.setSystemTime(new Date(invite.expiresAt)); expect(service.checkInvite(invite.token)).toBe(false); } finally { vi.useRealTimers(); }
    rawDb.prepare("UPDATE registration_invites SET used_at=? WHERE id=?").run(new Date().toISOString(), invite.id);
    expect(service.checkInvite(invite.token)).toBe(false); expect(service.checkInvite("unknown")).toBe(false);
  });
  it("adds its table idempotently without changing existing workspace rows", () => {
    const before = rawDb.prepare("SELECT * FROM workspaces").all(); service.createInvite();
    migrateRegistrationInvites(rawDb); migrateRegistrationInvites(rawDb);
    expect(rawDb.prepare("SELECT * FROM workspaces").all()).toEqual(before);
    expect(service.listInvites()).toHaveLength(1);
  });
  it("requires an install owner and bounds expiry", () => {
    expect(() => service.createInvite({ expiresDays: 0 })).toThrow(/Expiry/);
    rawDb.prepare("UPDATE app_users SET is_install_admin=0").run();
    expect(() => service.createInvite()).toThrow(/install-owner setup/);
  });
});
