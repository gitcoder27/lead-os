import { beforeEach, expect, it, vi } from "vitest";
vi.mock("node:crypto", async importOriginal => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return { ...original, scrypt: vi.fn(original.scrypt) };
});
import { scrypt } from "node:crypto";
import { AuthService } from "../src/services/auth.service";
import { resetDatabase } from "./helpers/db";
beforeEach(resetDatabase);
it("performs one scrypt comparison for wrong known and unknown logins with the same error", async () => {
  const service = new AuthService();
  await service.createUser({ username: "known", displayName: "Known", password: "fixture-password", role: "manager" });
  vi.mocked(scrypt).mockClear();
  await expect(service.authenticate("known", "wrong-password")).rejects.toMatchObject({ status: 401, message: "Invalid username or password" });
  expect(scrypt).toHaveBeenCalledTimes(1);
  vi.mocked(scrypt).mockClear();
  await expect(service.authenticate("unknown", "wrong-password")).rejects.toMatchObject({ status: 401, message: "Invalid username or password" });
  expect(scrypt).toHaveBeenCalledTimes(1);
});
