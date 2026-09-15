import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./helpers/db";
import {
  AssistantMemoryService,
  MAX_ASSISTANT_MEMORIES,
  MAX_ASSISTANT_MEMORY_CHARS,
} from "../src/services/assistant-memory.service";

const MANAGER = "manager-1";
const WORKSPACE = "ws-test";

describe("AssistantMemoryService", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("adds, lists, and removes memories scoped to the manager", async () => {
    const service = new AssistantMemoryService();

    const first = await service.add(MANAGER, "Priya prefers async updates", WORKSPACE);
    const second = await service.add(MANAGER, "Deploys are Fridays", WORKSPACE);
    await service.add("other-manager", "Not mine", WORKSPACE);

    const listed = await service.list(MANAGER, WORKSPACE);
    expect(listed.map((memory) => memory.text)).toEqual([
      "Priya prefers async updates",
      "Deploys are Fridays",
    ]);
    expect(listed[0]!.id).toBe(first.id);
    expect(listed[1]!.id).toBe(second.id);

    await service.remove(MANAGER, first.id, WORKSPACE);
    expect((await service.list(MANAGER, WORKSPACE)).map((memory) => memory.text)).toEqual([
      "Deploys are Fridays",
    ]);
  });

  it("dedupes case-insensitive repeats and normalizes whitespace", async () => {
    const service = new AssistantMemoryService();
    await service.add(MANAGER, "  brief   in bullets  ", WORKSPACE);
    const again = await service.add(MANAGER, "Brief in bullets", WORKSPACE);

    const listed = await service.list(MANAGER, WORKSPACE);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.text).toBe("brief in bullets");
    expect(again.id).toBe(listed[0]!.id);
  });

  it("rejects blank, overlong, and over-cap memories", async () => {
    const service = new AssistantMemoryService();
    await expect(service.add(MANAGER, "   ", WORKSPACE)).rejects.toMatchObject({ status: 400 });
    await expect(
      service.add(MANAGER, "x".repeat(MAX_ASSISTANT_MEMORY_CHARS + 1), WORKSPACE)
    ).rejects.toMatchObject({ status: 400 });

    for (let i = 0; i < MAX_ASSISTANT_MEMORIES; i += 1) {
      await service.add(MANAGER, `memory ${i}`, WORKSPACE);
    }
    await expect(service.add(MANAGER, "one too many", WORKSPACE)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("clears all memories for the manager", async () => {
    const service = new AssistantMemoryService();
    await service.add(MANAGER, "a", WORKSPACE);
    await service.add(MANAGER, "b", WORKSPACE);

    await service.clear(MANAGER, WORKSPACE);
    expect(await service.list(MANAGER, WORKSPACE)).toEqual([]);
  });
});
