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

  it("/f binds a following !date to followUpAt, and plans my own reminder that day (docs/57 §3)", () => {
    const parsed = resolved("Check vendor renewal /f !mon");
    expect(parsed.followUp).toBe(true);
    expect(parsed.followUpAt).toBe("2026-09-28"); // next Monday
    expect(parsed.scheduledOn).toBe("2026-09-28");
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

  it("/later !date is a resurface date, not a schedule (P3-02)", () => {
    expect(resolved("Idea /later").blocked).toBe(false);
    expect(resolved("Idea /later").hideUntil).toBeNull();
    const withDate = resolved("Idea /later !fri");
    expect(withDate.blocked).toBe(false);
    expect(withDate.scheduledOn).toBeNull();
    expect(withDate.hideUntil).toBe(resolved("x !fri").scheduledOn);
    // Order does not matter: the date still resurfaces the parked task.
    expect(resolved("Idea !fri /later").hideUntil).toBe(withDate.hideUntil);
  });

  it("/later @person links the person and keeps me as owner (P3-02)", () => {
    const parsed = resolved("Idea /later @sam");
    expect(parsed.blocked).toBe(false);
    expect(parsed.owner).toBeNull();
    expect(parsed.peopleLinks.map((person) => person.accountId)).toEqual(["sam"]);
  });

  it("without /later a date schedules and hideUntil stays null", () => {
    const parsed = resolved("Ship it !fri");
    expect(parsed.scheduledOn).not.toBeNull();
    expect(parsed.hideUntil).toBeNull();
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
    expect(parsed.diagnostics.filter((d) => d.code === "unparsed-token")).toHaveLength(1);
    expect(parsed.diagnostics.filter((d) => d.code === "malformed-mention")).toHaveLength(1);
  });

  describe("malformed mentions (docs/63 #8)", () => {
    const mention = (text: string) => resolved(text).diagnostics.find((d) => d.code === "malformed-mention");

    it.each([
      ["Ask @dev-1, about the rollout", "@dev-1,", "@dev-1"],
      ["Ask (@sam) about it", "(@sam)", "@sam"],
      ["Ask \"@sam\" about it", "\"@sam\"", "@sam"],
    ])("%s → needs a decision, suggests the clean mention, changes nothing", (text, token, repair) => {
      const parsed = resolved(text);
      const diagnostic = mention(text)!;
      expect(diagnostic).toMatchObject({ severity: "warning", token });
      expect(diagnostic.message).toContain(`did you mean ${repair}?`);
      // Nothing was stripped, nothing was assigned: the text is exactly as typed and nobody owns it.
      expect(parsed.title).toBe(text);
      expect(parsed.owner).toBeNull();
      expect(parsed.peopleLinks).toEqual([]);
      expect(parsed.blocked).toBe(false);
      expect(parsed.confirmRequired).toBe(true);
    });

    it("a mention whose trailing . or : parses as part of the name is blocked as unknown, never kept as a literal title", () => {
      for (const text of ["Ask @dev-1. Then ship", "Ask @sam: and ship"]) {
        const parsed = resolved(text);
        expect(parsed.diagnostics.find((d) => d.code === "unknown-person")?.severity, text).toBe("error");
        expect(parsed.blocked, text).toBe(true);
        expect(parsed.owner, text).toBeNull();
      }
    });

    it("has no suggestion when no clean mention can be recovered", () => {
      const diagnostic = mention("Ping @@ops today")!;
      expect(diagnostic.message).not.toContain("did you mean");
      expect(resolved("Ping @@ops today").confirmRequired).toBe(true);
    });

    it("a valid mention — including a Jira colon id — is untouched and needs no confirmation", () => {
      for (const text of ["Ask @sam about it", "Ask @712020:abc-1234 about it", "Ask @dev-1 about it"]) {
        const parsed = resolved(text);
        expect(parsed.diagnostics.some((d) => d.code === "malformed-mention"), text).toBe(false);
        expect(parsed.confirmRequired, text).toBe(false);
      }
    });

    it("emails, a bare @ and a mid-word @ are ordinary text", () => {
      for (const text of ["Write to ops@example.com today", "Meet @ 5pm", "Call a@b about it"]) {
        const parsed = resolved(text);
        expect(parsed.diagnostics.some((d) => d.code === "malformed-mention"), text).toBe(false);
        expect(parsed.title, text).toBe(text);
        expect(parsed.confirmRequired, text).toBe(false);
      }
    });

    it("an unknown but well-formed person is still an error, not a silent literal", () => {
      const parsed = resolved("Ask @ghost about it");
      expect(parsed.diagnostics.find((d) => d.code === "unknown-person")?.severity).toBe("error");
      expect(parsed.blocked).toBe(true);
    });
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

describe("waiting on (docs/57 §3, P3-03)", () => {
  const CONTACTS = [{ accountId: "acme-legal", displayName: "Acme Legal", kind: "contact" as const, contactId: 7 }];
  const withContacts = (text: string) => resolveCapture(parseCapture(text, TODAY), { people: [...PEOPLE, ...CONTACTS] });

  it("/w @who !date binds the party and the check-by date, and keeps me as owner", () => {
    const parsed = resolved("/w @sam !fri Contract review");
    expect(parsed.blocked).toBe(false);
    expect(parsed.title).toBe("Contract review");
    expect(parsed.waitingOn?.accountId).toBe("sam");
    expect(parsed.owner).toBeNull();
    expect(parsed.followUpAt).toBe("2026-09-25");
    expect(parsed.scheduledOn).toBeNull();
    expect(parsed.labels).not.toContain("category:follow_up");
  });

  it("binds within the next two words in either order", () => {
    expect(resolved("Contract /w !fri @sam").waitingOn?.accountId).toBe("sam");
    expect(resolved("Contract /w !fri @sam").followUpAt).toBe("2026-09-25");
    // A third word is outside the window: @sam is the owner, not the party.
    const late = resolved("/w @dev-1 review ready @sam");
    expect(late.waitingOn?.accountId).toBe("dev-1");
    expect(late.owner?.accountId).toBe("sam");
  });

  it("/w needs a person", () => {
    const parsed = resolved("Contract review /w !fri");
    expect(parsed.diagnostics.some((d) => d.code === "waiting-needs-person" && d.severity === "error")).toBe(true);
    expect(parsed.blocked).toBe(true);
  });

  it("/f @who is the same as /w; /f !date alone is my reminder planned that day", () => {
    const delegated = resolved("/f @dev-1 !fri Check the rollout");
    expect(delegated.waitingOn?.accountId).toBe("dev-1");
    expect(delegated.followUpAt).toBe("2026-09-25");
    expect(delegated.scheduledOn).toBeNull();
    expect(delegated.labels).toContain("category:follow_up");
    const reminder = resolved("Ping design /f !fri");
    expect(reminder.waitingOn).toBeNull();
    expect(reminder.followUpAt).toBe("2026-09-25");
    expect(reminder.scheduledOn).toBe("2026-09-25");
  });

  it("an owner and a waiting party can coexist", () => {
    const parsed = resolved("@dev-1 Ship migration /w @sam");
    expect(parsed.owner?.accountId).toBe("dev-1");
    expect(parsed.waitingOn?.accountId).toBe("sam");
  });

  it("contacts can be waited on or linked but never own", () => {
    expect(withContacts("/w @acme-legal NDA").waitingOn).toMatchObject({ kind: "contact", contactId: 7 });
    const linked = withContacts("@acme-legal NDA follow-through");
    expect(linked.owner).toBeNull();
    expect(linked.peopleLinks).toEqual([expect.objectContaining({ kind: "contact", contactId: 7 })]);
  });

  it("an unknown person suggests creating a contact", () => {
    const parsed = resolved("/w @vendorx Renewal quote");
    const diagnostic = parsed.diagnostics.find((d) => d.code === "unknown-person");
    expect(diagnostic?.suggestContact).toBe("vendorx");
    expect(parsed.blocked).toBe(true);
  });

  it("person refs accept colon ids (Jira account ids)", () => {
    const people = [{ accountId: "557058:ab-12", displayName: "Jira Person" }];
    const parsed = resolveCapture(parseCapture("Fix it @557058:ab-12", TODAY), { people });
    expect(parsed.blocked).toBe(false);
    expect(parsed.owner?.accountId).toBe("557058:ab-12");
    expect(parsed.title).toBe("Fix it");
  });
});

describe("!due: — the deadline, separate from the plan date (docs/57 P3-04)", () => {
  it("!due:fri sets dueOn and never schedules", () => {
    const parsed = resolved("Send the contract !due:fri");
    expect(parsed.dueOn).toBe("2026-09-25");
    expect(parsed.scheduledOn).toBeNull();
    expect(parsed.title).toBe("Send the contract");
    expect(parsed.tokens.find((token) => token.kind === "due")).toMatchObject({ raw: "!due:fri", value: "2026-09-25" });
    expect(parsed.blocked).toBe(false);
  });

  it.each([
    ["!due:today", "2026-09-24"],
    ["!due:tomorrow", "2026-09-25"],
    ["!due:mon", "2026-09-28"],
    ["!due:+2w", "2026-10-08"],
    ["!due:+3d", "2026-09-27"],
    ["!due:2026-12-01", "2026-12-01"],
    ["!DUE:Fri", "2026-09-25"],
  ])("%s → %s", (token, date) => {
    expect(resolved(`Task ${token}`).dueOn).toBe(date);
  });

  it("a plan date and a deadline are independent, in either order", () => {
    for (const text of ["Draft !mon !due:fri", "Draft !due:fri !mon"]) {
      const parsed = resolved(text);
      expect(parsed.scheduledOn).toBe("2026-09-28");
      expect(parsed.dueOn).toBe("2026-09-25");
      expect(parsed.title).toBe("Draft");
    }
  });

  it("does not steal the date bound to /f or /w", () => {
    const parsed = resolved("/w @sam !due:fri !mon Contract");
    expect(parsed.followUpAt).toBe("2026-09-28");
    expect(parsed.dueOn).toBe("2026-09-25");
    expect(parsed.scheduledOn).toBeNull();
  });

  it("works with /later (parked work can still have a deadline)", () => {
    const parsed = resolved("Renew licence /later !due:2026-12-01");
    expect(parsed.later).toBe(true);
    expect(parsed.dueOn).toBe("2026-12-01");
    expect(parsed.hideUntil).toBeNull();
    expect(parsed.blocked).toBe(false);
  });

  it("an unparseable value stays in the title with a warning", () => {
    const parsed = resolved("Ship !due:soon");
    expect(parsed.dueOn).toBeNull();
    expect(parsed.title).toBe("Ship !due:soon");
    expect(parsed.diagnostics.map((d) => d.code)).toContain("unparsed-date");
    expect(parsed.blocked).toBe(false);
  });

  it("a bare !due is just a word, not a date", () => {
    const parsed = resolved("Pay !due");
    expect(parsed.dueOn).toBeNull();
    expect(parsed.title).toBe("Pay !due");
  });

  it("only the first !due applies", () => {
    const parsed = resolved("Ship !due:fri !due:mon");
    expect(parsed.dueOn).toBe("2026-09-25");
    expect(parsed.diagnostics.find((d) => d.code === "extra-date")?.message).toContain("!due");
  });

  it("a past deadline warns and needs a confirm, like a past date", () => {
    const parsed = resolved("Late !due:2026-09-01");
    expect(parsed.diagnostics.find((d) => d.code === "past-date")).toBeDefined();
    expect(parsed.confirmRequired).toBe(true);
    expect(parsed.blocked).toBe(false);
  });

  it("is not parsed inside an update or a note body", () => {
    expect(parseCapture("T-1: slipped !due:fri", TODAY).tokens).toHaveLength(1);
  });
});
