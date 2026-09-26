/**
 * Phase 3 (P3 §11): the shared capture-grammar suite. Runs from both
 * workspaces — server (node env) and client (jsdom) — because the parser is
 * shared: the client previews with it and the server re-parses authoritatively.
 */
import { describe, expect, it } from "vitest";
import {
  matchCapturePeople,
  parseCapture,
  resolveCapture,
  type CaptureLookups,
} from "./capture-grammar";

// 2026-09-24 is a Thursday.
const TODAY = "2026-09-24";
const PEOPLE = [
  { accountId: "dev-1", displayName: "Dev One" },
  { accountId: "dev-2", displayName: "Dev Two" },
  { accountId: "sam", displayName: "Sam Carter" },
];

const resolved = (text: string, lookups: CaptureLookups = {}, today = TODAY) =>
  resolveCapture(parseCapture(text, today), { people: PEOPLE, ...lookups });

describe("parseCapture — intents", () => {
  it.each([
    ["T-142: said hello", "update", "said hello", "T-142"],
    ["t-7: deployed the fix", "update", "deployed the fix", "T-7"],
    ["T-09: pinged support", "update", "pinged support", "T-9"],
    ["/note waiting on design review", "note", "waiting on design review", undefined],
    ["/NOTE synced the roadmap", "note", "synced the roadmap", undefined],
    ["prep board review", "create", "prep board review", undefined],
  ])("%s → intent %s", (text, intent, title, key) => {
    const parsed = parseCapture(text, TODAY);
    expect(parsed.intent).toBe(intent);
    expect(parsed.title).toBe(title);
    if (key) expect(parsed.tokens[0]?.value).toBe(key);
  });

  it("update keeps the rest of the line literal (no tokenization)", () => {
    const parsed = parseCapture("T-1: waiting on !fri +risk", TODAY);
    expect(parsed.title).toBe("waiting on !fri +risk");
    expect(parsed.tokens).toHaveLength(1);
  });

  it("update with no body is an error", () => {
    expect(parseCapture("T-1:", TODAY).diagnostics[0]?.code).toBe("empty-update");
  });

  it("note with no text is an error", () => {
    expect(parseCapture("/note", TODAY).diagnostics[0]?.code).toBe("empty-note");
  });
});

describe("parseCapture — tokens", () => {
  it("parses every token kind out of the title", () => {
    const parsed = resolveCapture(
      parseCapture("Ship @sam report #LEAD-42 ^T-9 T-7 !fri !! +risk /m", TODAY),
      { people: PEOPLE, jiraSynced: () => true, taskState: () => "ok" }
    );
    expect(parsed.title).toBe("Ship report");
    expect(parsed.owner?.accountId).toBe("sam");
    expect(parsed.jiraLinks).toEqual([{ key: "LEAD-42", primary: true }]);
    expect(parsed.parentKey).toBe("T-9");
    expect(parsed.taskLinks).toEqual(["T-7"]);
    expect(parsed.scheduledOn).toBe("2026-09-25"); // next Friday
    expect(parsed.priority).toBe("high");
    expect(parsed.labels).toContain("risk");
    expect(parsed.meeting).toBe(true);
  });

  it("second @person becomes a person link, not the owner", () => {
    const parsed = resolved("Review @dev-1 with @sam");
    expect(parsed.owner?.accountId).toBe("dev-1");
    expect(parsed.peopleLinks.map((p) => p.accountId)).toEqual(["sam"]);
  });

  it("first #jira is primary, later ones related", () => {
    const parsed = resolveCapture(parseCapture("Fix #LEAD-1 #LEAD-2", TODAY), { jiraSynced: () => true });
    expect(parsed.jiraLinks).toEqual([
      { key: "LEAD-1", primary: true },
      { key: "LEAD-2", primary: false },
    ]);
  });

  it("/f binds a following !date to followUpAt, not scheduledOn", () => {
    const parsed = resolved("Check vendor renewal /f !mon");
    expect(parsed.followUp).toBe(true);
    expect(parsed.followUpAt).toBe("2026-09-28"); // next Monday
    expect(parsed.scheduledOn).toBeNull();
    expect(parsed.labels).toEqual(["category:follow_up"]);
  });

  it("/f without a date leaves followUpAt unset (caller defaults to today)", () => {
    const parsed = resolved("Ping legal /f");
    expect(parsed.followUp).toBe(true);
    expect(parsed.followUpAt).toBeNull();
  });

  it("a !date before /f stays the schedule", () => {
    const parsed = resolved("Review contract !sat /f");
    expect(parsed.scheduledOn).toBe("2026-09-26");
    expect(parsed.followUp).toBe(true);
    expect(parsed.followUpAt).toBeNull();
  });

  it("labels lowercase and /later, /meeting aliases work", () => {
    const parsed = resolved("Thing /L +Q3-Plan /M");
    expect(parsed.later).toBe(true);
    expect(parsed.meeting).toBe(true);
    expect(parsed.labels).toContain("q3-plan");
  });

  it("later defaults to no scheduledOn error only when a date is present", () => {
    expect(resolved("Idea /later").blocked).toBe(false);
    const withDate = resolved("Idea /later !fri");
    expect(withDate.diagnostics.some((d) => d.code === "later-with-date" && d.severity === "error")).toBe(true);
    expect(withDate.blocked).toBe(true);
  });

  it("/later with @person is an error (P3-D14)", () => {
    const parsed = resolved("Idea /later @sam");
    expect(parsed.diagnostics.some((d) => d.code === "later-with-person")).toBe(true);
    expect(parsed.blocked).toBe(true);
  });

  it("empty create title is an error", () => {
    expect(resolved("@sam !fri").diagnostics.some((d) => d.code === "empty-title")).toBe(true);
  });
});

describe("parseCapture — dates", () => {
  it.each([
    ["!today", "2026-09-24"],
    ["!tomorrow", "2026-09-25"],
    ["!thu", "2026-09-24"], // today included
    ["!fri", "2026-09-25"],
    ["!wed", "2026-09-30"], // wraps to next week
    ["!+3d", "2026-09-27"],
    ["!+2w", "2026-10-08"],
    ["!2026-12-31", "2026-12-31"],
  ])("%s → %s", (token, expected) => {
    expect(resolved(`Task ${token}`).scheduledOn).toBe(expected);
  });

  it("rejects impossible ISO dates as unrecognized text", () => {
    const parsed = resolved("Task !2026-02-30");
    expect(parsed.scheduledOn).toBeNull();
    expect(parsed.title).toContain("!2026-02-30");
    expect(parsed.diagnostics.some((d) => d.code === "unparsed-date")).toBe(true);
  });

  it("past dates produce a warning that requires confirm", () => {
    const parsed = resolved("Task !2020-01-01");
    expect(parsed.diagnostics.some((d) => d.code === "past-date" && d.severity === "warning")).toBe(true);
    expect(parsed.confirmRequired).toBe(true);
    expect(parsed.blocked).toBe(false);
  });

  it("unrecognized !word stays in the title with a warning", () => {
    const parsed = resolved("Do it !tmorrow");
    expect(parsed.title).toBe("Do it !tmorrow");
    expect(parsed.diagnostics.some((d) => d.code === "unparsed-date")).toBe(true);
  });

  it("a second non-followup !date warns instead of being silently ignored", () => {
    const parsed = resolved("Ship it !fri !mon");
    expect(parsed.scheduledOn).toBe("2026-09-25");
    const warning = parsed.diagnostics.find((d) => d.code === "extra-date");
    expect(warning?.severity).toBe("warning");
    expect(warning?.token).toBe("!mon");
    expect(parsed.blocked).toBe(false);
  });

  it("titles over 500 chars are a structured blocked diagnostic, not a generic 400", () => {
    const parsed = resolved(`x${"y".repeat(600)}`);
    expect(parsed.diagnostics.some((d) => d.code === "title-too-long" && d.severity === "error")).toBe(true);
    expect(parsed.blocked).toBe(true);
  });

  it("token-shaped words that don't parse stay in the title with a warning", () => {
    const parsed = resolved("Email @@ops and ##help now");
    expect(parsed.title).toBe("Email @@ops and ##help now");
    expect(parsed.diagnostics.filter((d) => d.code === "unparsed-token")).toHaveLength(2);
  });
});

describe("resolveCapture — lookups (§4.2 ambiguity rows)", () => {
  it("@alias matching two developers is an error with candidates", () => {
    const parsed = resolved("Ping @dev now");
    const diag = parsed.diagnostics.find((d) => d.code === "ambiguous-person");
    expect(diag?.severity).toBe("error");
    expect(diag?.candidates?.map((c) => c.accountId).sort()).toEqual(["dev-1", "dev-2"]);
    expect(parsed.blocked).toBe(true);
  });

  it("@name matching nobody is an error", () => {
    const parsed = resolved("Ping @nobody");
    expect(parsed.diagnostics.some((d) => d.code === "unknown-person" && d.severity === "error")).toBe(true);
    expect(parsed.blocked).toBe(true);
  });

  it("exact accountId match short-circuits ambiguity", () => {
    const parsed = resolved("Ping @dev-1");
    expect(parsed.owner?.accountId).toBe("dev-1");
    expect(parsed.blocked).toBe(false);
  });

  it("#KEY not synced is a warning and stays in the title", () => {
    const parsed = resolveCapture(parseCapture("Fix #LEAD-99 today", TODAY), {
      people: PEOPLE,
      jiraSynced: (key) => (key === "LEAD-99" ? false : null),
    });
    expect(parsed.jiraLinks).toEqual([]);
    expect(parsed.title).toBe("Fix #LEAD-99 today");
    expect(parsed.diagnostics.some((d) => d.code === "jira-not-synced" && d.severity === "warning")).toBe(true);
    expect(parsed.blocked).toBe(false);
  });

  it("T-n: update on an unknown task is an error", () => {
    const parsed = resolveCapture(parseCapture("T-5: hello", TODAY), {
      taskState: () => "unknown",
    });
    expect(parsed.diagnostics.some((d) => d.code === "bad-update-target")).toBe(true);
    expect(parsed.blocked).toBe(true);
  });

  it("T-n: update on a deleted task is an error", () => {
    const parsed = resolveCapture(parseCapture("T-5: hello", TODAY), {
      taskState: () => "deleted",
    });
    expect(parsed.diagnostics.some((d) => d.code === "bad-update-target")).toBe(true);
    expect(parsed.blocked).toBe(true);
  });

  it("T-n: update on a live task resolves the target", () => {
    const parsed = resolveCapture(parseCapture("T-5: hello", TODAY), {
      taskState: () => "ok",
    });
    expect(parsed.updateTargetKey).toBe("T-5");
    expect(parsed.blocked).toBe(false);
  });

  it("^T-n to a missing task is an error", () => {
    const parsed = resolveCapture(parseCapture("Child task ^T-9", TODAY), {
      taskState: () => "unknown",
    });
    expect(parsed.diagnostics.some((d) => d.code === "bad-parent" && d.severity === "error")).toBe(true);
    expect(parsed.blocked).toBe(true);
  });

  it("bare T-n to a missing task warns and stays as text", () => {
    const parsed = resolveCapture(parseCapture("Ask about T-9", TODAY), {
      taskState: () => "unknown",
    });
    expect(parsed.taskLinks).toEqual([]);
    expect(parsed.title).toBe("Ask about T-9");
    expect(parsed.diagnostics.some((d) => d.code === "bad-task-ref" && d.severity === "warning")).toBe(true);
    expect(parsed.blocked).toBe(false);
  });

  it("null lookups leave tokens unresolved but unblocked (client preview)", () => {
    const parsed = resolveCapture(parseCapture("Fix #LEAD-1 ref T-9", TODAY), {});
    expect(parsed.jiraLinks).toEqual([{ key: "LEAD-1", primary: true }]);
    expect(parsed.taskLinks).toEqual(["T-9"]);
    expect(parsed.blocked).toBe(false);
  });
});

describe("matchCapturePeople", () => {
  it("matches name parts and concatenated names case-insensitively", () => {
    expect(matchCapturePeople("sam", PEOPLE)[0]?.accountId).toBe("sam");
    expect(matchCapturePeople("cart", PEOPLE)[0]?.accountId).toBe("sam");
    expect(matchCapturePeople("samcarter", PEOPLE)[0]?.accountId).toBe("sam");
    expect(matchCapturePeople("SAM", PEOPLE)[0]?.accountId).toBe("sam");
  });
});
