"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NAV_PREFERENCES = exports.NAV_PAGE_IDS_TASKS = exports.NAV_PAGE_IDS = exports.oneOnOneSessionActionSchema = exports.oneOnOneAgendaReorderSchema = exports.oneOnOneAgendaAttachSchema = exports.oneOnOneSessionUpdateSchema = exports.oneOnOneSessionCreateSchema = exports.oneOnOneSeriesUpdateSchema = exports.oneOnOneSeriesCreateSchema = exports.oneOnOneCadenceSchema = exports.TASK_EVENT_TYPES = exports.taskViewDefinitionSchema = exports.TASK_STALE_DAYS = exports.TASK_LABEL_COLORS = exports.TASK_KEY_PATTERN = void 0;
exports.isSystemTaskLabel = isSystemTaskLabel;
exports.taskLabelDisplayName = taskLabelDisplayName;
exports.isNavPageId = isNavPageId;
exports.sanitizeNavPreferences = sanitizeNavPreferences;
exports.isCompleteNavPreferences = isCompleteNavPreferences;
const zod_1 = require("zod");
exports.TASK_KEY_PATTERN = /^[Tt]-(\d{1,9})$/;
exports.TASK_LABEL_COLORS = [
    "slate",
    "red",
    "amber",
    "green",
    "teal",
    "blue",
    "violet",
    "pink",
];
function isSystemTaskLabel(name) {
    return name === "category:follow_up" || name === "kind:decision" || name === "kind:waiting" || name.startsWith("priority:");
}
/** Label chip text: system labels render without their `x:` prefix. */
function taskLabelDisplayName(name) {
    const stripped = name.replace(/^(category|kind|priority):/, "");
    return stripped.replace(/_/g, " ");
}
/** docs/49 D9: days without activity before an open task reads as stale. */
exports.TASK_STALE_DAYS = 5;
const taskViewIsoDate = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const taskViewDateRange = zod_1.z.object({
    from: taskViewIsoDate.optional(),
    to: taskViewIsoDate.optional(),
}).strict()
    // Open-ended ranges are fine, but an empty range would scan all history (§5.2).
    .refine((range) => range.from !== undefined || range.to !== undefined, { message: "Date range needs at least one bound" });
/**
 * Phase 3 (P3-D9, §5.2): the validated view-definition schema, shared between
 * the server's `/api/task-views` validation and any client-side view editing.
 * Closed tasks require a bounded `closed` range so no view can scan all history.
 */
exports.taskViewDefinitionSchema = zod_1.z.object({
    filters: zod_1.z.object({
        owner: zod_1.z.union([zod_1.z.enum(["me", "team", "inbox"]), zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).min(1).max(50)]).optional(),
        status: zod_1.z.array(zod_1.z.enum(["open", "active", "blocked", "done", "dropped"])).min(1).max(5).optional(),
        labels: zod_1.z.array(zod_1.z.string().trim().min(1).max(64)).min(1).max(20).optional(),
        linkedJira: zod_1.z.boolean().optional(),
        kind: zod_1.z.enum(["task", "meeting"]).optional(),
        later: zod_1.z.boolean().optional(),
        scheduled: taskViewDateRange.optional(),
        closed: taskViewDateRange.optional(),
        followUp: zod_1.z.boolean().optional(),
        staleDays: zod_1.z.number().int().min(1).max(365).optional(),
        jiraDrift: zod_1.z.boolean().optional(),
        horizon: zod_1.z.enum(["today", "upcoming"]).optional(),
        waiting: zod_1.z.boolean().optional(),
        attention: zod_1.z.array(zod_1.z.enum(["overdue", "stale", "drift"])).min(1).max(3).optional(),
    }).strict().optional(),
    sort: zod_1.z.enum(["scheduled", "updated", "created", "priority"]).optional(),
    group: zod_1.z.enum(["owner", "status", "label", "scheduled"]).optional(),
}).strict();
exports.TASK_EVENT_TYPES = [
    "created", "update", "instruction", "decision", "blocker", "status", "assign",
    "focus", "title", "schedule", "link", "checkin_ref", "note_ref", "merged",
];
const oneOnOneIsoDate = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
exports.oneOnOneCadenceSchema = zod_1.z.enum(["weekly", "biweekly", "monthly", "ad_hoc"]);
exports.oneOnOneSeriesCreateSchema = zod_1.z.object({
    developerAccountId: zod_1.z.string().trim().min(1).max(200),
    cadence: exports.oneOnOneCadenceSchema,
    preferredWeekday: zod_1.z.number().int().min(0).max(6).nullable().optional(),
}).strict();
exports.oneOnOneSeriesUpdateSchema = zod_1.z.object({
    cadence: exports.oneOnOneCadenceSchema.optional(),
    preferredWeekday: zod_1.z.number().int().min(0).max(6).nullable().optional(),
    active: zod_1.z.boolean().optional(),
}).strict();
exports.oneOnOneSessionCreateSchema = zod_1.z.object({
    scheduledFor: oneOnOneIsoDate.optional(),
}).strict();
exports.oneOnOneSessionUpdateSchema = zod_1.z.object({
    status: zod_1.z.enum(["scheduled", "done", "skipped"]).optional(),
    notes: zod_1.z.string().max(20000).optional(),
    scheduledFor: oneOnOneIsoDate.optional(),
    /** Start marks a scheduled session live (`startedAt`). */
    started: zod_1.z.boolean().optional(),
    /**
     * 48 §4.2: when completing (`status: "done"`), `false` detaches the still-open
     *  agenda items instead of carrying them to the next session. Default: keep
     *  open — they auto-carry.
     */
    reopenCarried: zod_1.z.boolean().optional(),
}).strict();
exports.oneOnOneAgendaAttachSchema = zod_1.z.object({
    /** Attach an existing canonical task by id or key. */
    taskId: zod_1.z.number().int().positive().optional(),
    taskKey: zod_1.z.string().trim().min(1).max(32).optional(),
    /** Freeform capture — creates a canonical task and attaches it (48 §4.2). */
    title: zod_1.z.string().trim().min(1).max(500).optional(),
}).strict();
exports.oneOnOneAgendaReorderSchema = zod_1.z.object({
    itemIds: zod_1.z.array(zod_1.z.number().int().positive()).min(1).max(1000),
}).strict();
exports.oneOnOneSessionActionSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(500),
    /** Defaults to the series developer (48 §4.2, OO-D8). */
    ownerType: zod_1.z.enum(["manager", "developer"]).optional(),
    ownerId: zod_1.z.string().trim().min(1).max(200).optional(),
    scheduledOn: oneOnOneIsoDate.nullable().optional(),
}).strict();
exports.NAV_PAGE_IDS = ["work", "team", "desk", "follow-ups", "notes", "meetings"];
/** Phase 3 (P3-D1): the same page set with Desk renamed to Tasks. */
exports.NAV_PAGE_IDS_TASKS = ["work", "team", "tasks", "follow-ups", "notes", "meetings"];
exports.DEFAULT_NAV_PREFERENCES = {
    topNav: ["work", "team", "desk"],
    moreNav: ["follow-ups", "notes", "meetings"],
};
const NAV_PAGE_ID_SET = new Set([...exports.NAV_PAGE_IDS, ...exports.NAV_PAGE_IDS_TASKS]);
function isNavPageId(value) {
    return typeof value === "string" && NAV_PAGE_ID_SET.has(value);
}
function liveNavPageIds(tasksNav) {
    return tasksNav ? exports.NAV_PAGE_IDS_TASKS : exports.NAV_PAGE_IDS;
}
function normalizeNavPageId(id, tasksNav) {
    if (tasksNav) {
        return id === "desk" ? "tasks" : id;
    }
    return id === "tasks" ? "desk" : id;
}
/**
 * Leniently rebuild preferences from stored/cached lists: keeps known pages in
 * their zones, drops unknown ids, and appends never-seen pages to the More menu
 * so new pages surface without a migration.
 */
function sanitizeNavPreferences(topNav, moreNav, options = {}) {
    const liveIds = liveNavPageIds(options.tasksNav);
    const liveSet = new Set(liveIds);
    const top = Array.isArray(topNav) ? topNav.map((id) => normalizeNavPageId(id, options.tasksNav)) : [];
    const more = Array.isArray(moreNav) ? moreNav.map((id) => normalizeNavPageId(id, options.tasksNav)) : [];
    const seen = new Set();
    const nextTop = [];
    const nextMore = [];
    for (const id of top) {
        if (liveSet.has(id) && !seen.has(id)) {
            seen.add(id);
            nextTop.push(id);
        }
    }
    for (const id of more) {
        if (liveSet.has(id) && !seen.has(id)) {
            seen.add(id);
            nextMore.push(id);
        }
    }
    for (const id of liveIds) {
        if (!seen.has(id)) {
            nextMore.push(id);
        }
    }
    return { topNav: nextTop, moreNav: nextMore };
}
/** Strict check: a complete partition of every page across the two zones. */
function isCompleteNavPreferences(value, options = {}) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const prefs = value;
    if (!Array.isArray(prefs.topNav) || !Array.isArray(prefs.moreNav)) {
        return false;
    }
    const liveIds = liveNavPageIds(options.tasksNav);
    const liveSet = new Set(liveIds);
    const combined = [...prefs.topNav, ...prefs.moreNav].map((id) => normalizeNavPageId(id, options.tasksNav));
    if (combined.length !== liveIds.length || combined.some((id) => typeof id !== "string" || !liveSet.has(id))) {
        return false;
    }
    return new Set(combined).size === combined.length;
}
