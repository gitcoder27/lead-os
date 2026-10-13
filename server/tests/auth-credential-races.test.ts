import { beforeEach, expect, it, vi } from "vitest";
const gate = vi.hoisted(() => ({ password: "", entered: undefined as (() => void) | undefined, release: undefined as (() => void) | undefined }));
vi.mock("node:crypto", async importOriginal => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return { ...original, scrypt: (...args: Parameters<typeof original.scrypt>) => {
    const callback = args[args.length - 1] as (error: Error | null, key: Buffer) => void;
    const finish = (error: Error | null, key: Buffer) => {
      if (args[0] === gate.password) {
        gate.release = () => callback(error, key);
        gate.entered?.();
      } else callback(error, key);
    };
    original.scrypt(args[0], args[1], args[2], finish);
  } };
});
import { eq } from "drizzle-orm";
import { AuthService } from "../src/services/auth.service";
import { appSessions, appUsers } from "../src/db/schema";
import { db, resetDatabase } from "./helpers/db";
const service = new AuthService();
beforeEach(async () => {
  gate.password = "";
  await resetDatabase();
  await service.createUser({ username: "manager", displayName: "Manager", password: "old-password", role: "manager" });
});

it.each(["login", "change"])("rejects an in-flight %s verified against a pre-reset credential", async operation => {
  gate.password = "old-password";
  const entered = new Promise<void>(resolve => { gate.entered = resolve; });
  const pending = operation === "login"
    ? service.authenticate("manager", "old-password")
    : service.changePassword("manager", "old-password", "attacker-replacement");
  const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
  await entered;
  await service.resetPassword("manager", "recovery-password", { allowedRoles: ["manager"] });
  gate.release!();
  await rejected;
  expect(db.select().from(appSessions).all()).toHaveLength(0);
  gate.password = "";
  await expect(service.authenticate("manager", "recovery-password")).resolves.toBeDefined();
  await expect(service.authenticate("manager", "attacker-replacement")).rejects.toMatchObject({ status: 401 });
});

it.each(["login", "change"])("rejects an in-flight %s when the account is deactivated", async operation => {
  gate.password = "old-password";
  const entered = new Promise<void>(resolve => { gate.entered = resolve; });
  const hash = db.select().from(appUsers).all()[0]!.passwordHash;
  const pending = operation === "login"
    ? service.authenticate("manager", "old-password")
    : service.changePassword("manager", "old-password", "replacement-password");
  const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
  await entered;
  db.update(appUsers).set({ isActive: 0 }).where(eq(appUsers.username, "manager")).run();
  gate.release!();
  await rejected;
  expect(db.select().from(appSessions).all()).toHaveLength(0);
  expect(db.select().from(appUsers).all()[0]!.passwordHash).toBe(hash);
});
