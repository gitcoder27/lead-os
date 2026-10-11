import { beforeEach, describe, expect, it } from "vitest";
import { rawDb } from "../src/db/connection";
import { startCanonicalTasksIfEmpty } from "../src/db/canonical-start";
import { projects, projectTracks } from "../src/db/schema";
import { SearchService } from "../src/services/search.service";
import { db, resetDatabase } from "./helpers/db";

// docs/73 UXD-26: the palette finds projects and tracks, and only the signed-in manager's own.
const search = new SearchService();
const now = "2026-10-10T09:00:00.000Z";

async function project(workspaceId: string, managerAccountId: string, name: string, archivedAt: string | null = null) {
  const [row] = await db.insert(projects).values({ workspaceId, managerAccountId, name, archivedAt, createdAt: now, updatedAt: now }).returning();
  return row!;
}

async function track(workspaceId: string, managerAccountId: string, projectId: number, name: string, archivedAt: string | null = null) {
  const [row] = await db.insert(projectTracks).values({ workspaceId, managerAccountId, projectId, name, archivedAt, createdAt: now, updatedAt: now }).returning();
  return row!;
}

describe("search: projects and tracks (docs/73 UXD-26)", () => {
  beforeEach(async () => {
    await resetDatabase();
    startCanonicalTasksIfEmpty(rawDb, "default");
    startCanonicalTasksIfEmpty(rawDb, "friend");
  });

  it("finds the manager's projects by name and tracks with their project", async () => {
    const atlas = await project("default", "mgr-a", "Atlas payments migration");
    await track("default", "mgr-a", atlas.id, "Atlas cutover");
    const result = await search.search("atlas", "default", "mgr-a");
    expect(result.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: atlas.id, projectName: "Atlas payments migration" }),
      expect.objectContaining({ projectId: atlas.id, projectName: "Atlas payments migration", trackName: "Atlas cutover" }),
    ]));
    expect(result.projects?.find((item) => !item.trackName)).not.toHaveProperty("trackId");
  });

  it("never returns another manager's projects in the same workspace, or any from another workspace", async () => {
    const mine = await project("default", "mgr-a", "Atlas mine");
    const colleague = await project("default", "mgr-b", "Atlas colleague");
    await track("default", "mgr-b", colleague.id, "Atlas colleague track");
    const foreign = await project("friend", "mgr-a", "Atlas foreign");
    await track("friend", "mgr-a", foreign.id, "Atlas foreign track");
    const result = await search.search("atlas", "default", "mgr-a");
    expect(result.projects?.map((item) => item.projectId)).toEqual([mine.id]);
    expect(JSON.stringify(result)).not.toMatch(/colleague|foreign/);
  });

  it("leaves archived projects and tracks out, and needs a manager", async () => {
    const live = await project("default", "mgr-a", "Atlas live");
    await project("default", "mgr-a", "Atlas old", now);
    await track("default", "mgr-a", live.id, "Atlas retired", now);
    const archivedParent = await project("default", "mgr-a", "Zeta archived", now);
    await track("default", "mgr-a", archivedParent.id, "Atlas orphan");
    expect((await search.search("atlas", "default", "mgr-a")).projects?.map((item) => item.projectName + (item.trackName ? ` / ${item.trackName}` : ""))).toEqual(["Atlas live"]);
    expect((await search.search("atlas", "default", undefined)).projects).toEqual([]);
  });

  it("treats wildcard characters literally", async () => {
    await project("default", "mgr-a", "Atlas");
    expect((await search.search("%%", "default", "mgr-a")).projects).toEqual([]);
  });
});
