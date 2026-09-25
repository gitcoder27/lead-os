"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_NAV_PREFERENCES = exports.NAV_PAGE_IDS_TASKS = exports.NAV_PAGE_IDS = exports.TASK_EVENT_TYPES = exports.TASK_LABEL_COLORS = exports.TASK_KEY_PATTERN = void 0;
exports.isSystemTaskLabel = isSystemTaskLabel;
exports.taskLabelDisplayName = taskLabelDisplayName;
exports.isNavPageId = isNavPageId;
exports.sanitizeNavPreferences = sanitizeNavPreferences;
exports.isCompleteNavPreferences = isCompleteNavPreferences;
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
exports.TASK_EVENT_TYPES = [
    "created", "update", "instruction", "decision", "blocker", "status", "assign",
    "focus", "title", "schedule", "link", "checkin_ref", "note_ref", "merged",
];
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
