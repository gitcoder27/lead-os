import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rawDb } from "../src/db/connection";
import { AuthService } from "../src/services/auth.service";
import { WorkspaceService } from "../src/services/workspace.service";
import { createAuthRouter } from "../src/routes/auth";
import { errorHandler } from "../src/middleware/errorHandler";
import { resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
const params = { username: "owner", password: "strong-fixture-9", displayName: "Owner", role: "manager" as const };
const state = () => ["workspaces", "config", "app_users"].map(table => rawDb.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
describe("atomic account creation", () => {
  beforeEach(resetDatabase);
  it("rolls back a duplicate independent manager without orphan workspace/config rows", async () => {
    const service = new AuthService(); await service.createUser(params); const before = state();
    await expect(service.createUser(params)).rejects.toMatchObject({ status: 409, message: "That username is taken." });
    expect(state()).toEqual(before);
  });
  it("rolls back workspace creation if the user insert crashes", async () => {
    const service = new AuthService(); await service.createUser(params); const before = state();
    rawDb.exec("CREATE TRIGGER fail_user BEFORE INSERT ON app_users WHEN NEW.username='crash' BEGIN SELECT RAISE(ABORT,'fixture crash'); END");
    try { await expect(service.createUser({ ...params, username: "crash" })).rejects.toThrow("fixture crash"); expect(state()).toEqual(before); }
    finally { rawDb.exec("DROP TRIGGER fail_user"); }
  });
  it("does not publish the installed account count", async () => {
    const service = new AuthService(); await service.createUser(params);
    const app = express(); app.use("/api/auth", createAuthRouter(service)); app.use(errorHandler);
    expect((await invoke(app, { method: "GET", url: "/api/auth/bootstrap" })).body).toEqual({ bootstrapOpen: false });
  });
  it("allows only one simultaneous anonymous bootstrap", async () => {
    const service = new AuthService();
    const results = await Promise.allSettled([service.createUser({ ...params, bootstrapOnly: true }), service.createUser({ ...params, username: "racer", bootstrapOnly: true })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(rawDb.prepare("SELECT COUNT(*) AS n FROM app_users").get()).toEqual({ n: 1 });
    expect(rawDb.prepare("SELECT COUNT(*) AS n FROM workspaces").get()).toEqual({ n: 1 });
  });
  it("rechecks first-account role inside account creation", async () => {
    const workspace = new WorkspaceService(); const create = vi.spyOn(workspace, "createWorkspaceForManager");
    await expect(new AuthService(workspace).createUser({ ...params, role: "developer", developerAccountId: "dev" })).rejects.toMatchObject({ status: 403 });
    expect(create).not.toHaveBeenCalled();
  });
});
