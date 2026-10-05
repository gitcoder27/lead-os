import { beforeEach, expect, it } from "vitest";
import express from "express";
import { db, resetDatabase } from "./helpers/db";
import { invoke } from "./helpers/http";
import { configTable, developers } from "../src/db/schema";
import { errorHandler } from "../src/middleware/errorHandler";
import { requireManager } from "../src/middleware/auth";
import { createProjectsRouter, createProjectTracksRouter } from "../src/routes/projects";
import { createTaskPlacementsRouter } from "../src/routes/task-placements";
import { AuthService, serializeSessionCookie } from "../src/services/auth.service";
const auth = new AuthService();
const app = express();
app.use("/projects", requireManager(auth), createProjectsRouter());
app.use("/project-tracks", requireManager(auth), createProjectTracksRouter());
app.use("/placements", requireManager(auth), createTaskPlacementsRouter());
app.use(errorHandler);
const headers = async (name: string) => {
  const result = await auth.authenticate(name, "secret123");
  return { cookie: serializeSessionCookie(result.sessionId, auth.sessionMaxAgeSeconds) };
};
beforeEach(async () => {
  await resetDatabase();
  await db.insert(configTable).values([
    { key: "tasks_phase2_stage", value: "2c" },
    { key: "tasks_phase3_enabled", value: "true" },
  ]);
  await auth.createUser({
    username: "owner",
    displayName: "Owner",
    password: "secret123",
    role: "manager",
    workspaceId: "default",
  });
  await auth.createUser({
    username: "second",
    displayName: "Second",
    password: "secret123",
    role: "manager",
    workspaceId: "default",
  });
  await db
    .insert(developers)
    .values({ workspaceId: "default", accountId: "dev", displayName: "Developer", isActive: 1 });
  await auth.createUser({
    username: "developer",
    displayName: "Developer",
    password: "secret123",
    role: "developer",
    workspaceId: "default",
    developerAccountId: "dev",
  });
});
it("protects container endpoints and manager-private details", async () => {
  expect((await invoke(app, { method: "GET", url: "/projects" })).status).toBe(401);
  const manager = await headers("owner");
  const created = await invoke(app, {
    method: "POST",
    url: "/projects",
    headers: manager,
    body: { name: "Platform", summary: "Private decision" },
  });
  expect(created.status).toBe(201);
  expect(
    (await invoke(app, { method: "GET", url: `/projects/${created.body.id}`, headers: await headers("second") }))
      .status,
  ).toBe(404);
  expect((await invoke(app, { method: "GET", url: "/projects", headers: await headers("developer") })).status).toBe(
    403,
  );
  expect(
    (await invoke(app, { method: "POST", url: "/projects", headers: manager, body: { name: "Platform" } })).status,
  ).toBe(409);
  const track = await invoke(app, {
    method: "POST",
    url: `/projects/${created.body.id}/tracks`,
    headers: manager,
    body: { name: "Security" },
  });
  expect(track.status).toBe(201);
  expect(
    (
      await invoke(app, {
        method: "PATCH",
        url: `/project-tracks/${track.body.id}`,
        headers: await headers("second"),
        body: { summary: "Forbidden" },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await invoke(app, {
        method: "POST",
        url: "/placements/bulk",
        headers: manager,
        body: { preview: { keys: [], tasks: [] }, placement: null },
      })
    ).status,
  ).toBe(400);
});
