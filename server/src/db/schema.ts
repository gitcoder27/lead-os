import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerAccountId: text("owner_account_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const issues = sqliteTable("issues", {
  workspaceId: text("workspace_id").notNull().default("default"),
  jiraKey: text("jira_key").notNull(),
  summary: text("summary").notNull(),
  description: text("description"),
  aspenSeverity: text("aspen_severity"),
  priorityName: text("priority_name").notNull(),
  priorityId: text("priority_id").notNull(),
  statusName: text("status_name").notNull(),
  statusCategory: text("status_category").notNull(),
  assigneeId: text("assignee_id"),
  assigneeName: text("assignee_name"),
  teamScopeState: text("team_scope_state").notNull().default("in_team"),
  syncScopeState: text("sync_scope_state").notNull().default("active"),
  reporterName: text("reporter_name"),
  component: text("component"),
  labels: text("labels"),
  dueDate: text("due_date"),
  developmentDueDate: text("development_due_date"),
  flagged: integer("flagged").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  syncedAt: text("synced_at").notNull(),
  lastSeenInScopedSyncAt: text("last_seen_in_scoped_sync_at"),
  lastReconciledAt: text("last_reconciled_at"),
  scopeChangedAt: text("scope_changed_at"),
  analysisNotes: text("analysis_notes"),
  excluded: integer("excluded").notNull().default(0),
}, (table) => [
  primaryKey({ name: "pk_issues_workspace_jira_key", columns: [table.workspaceId, table.jiraKey] }),
]);

export const developers = sqliteTable("developers", {
  workspaceId: text("workspace_id").notNull().default("default"),
  accountId: text("account_id").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  source: text("source").notNull().default("jira"),
  jiraAccountId: text("jira_account_id"),
  isActive: integer("is_active").notNull().default(1),
}, (table) => [
  primaryKey({ name: "pk_developers_workspace_account", columns: [table.workspaceId, table.accountId] }),
]);

export const appUsers = sqliteTable("app_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  developerAccountId: text("developer_account_id"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const appSessions = sqliteTable("app_sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const alertDismissals = sqliteTable("alert_dismissals", {
  workspaceId: text("workspace_id").notNull().default("default"),
  managerAccountId: text("manager_account_id").notNull(),
  alertId: text("alert_id").notNull(),
  dismissedAt: text("dismissed_at").notNull(),
}, (table) => [
  uniqueIndex("idx_alert_dismissals_workspace_manager_alert").on(table.workspaceId, table.managerAccountId, table.alertId),
]);

export const componentMap = sqliteTable("component_map", {
  workspaceId: text("workspace_id").notNull().default("default"),
  componentName: text("component_name").notNull(),
  accountId: text("account_id").notNull(),
  fixCount: integer("fix_count").notNull().default(0),
}, (table) => [
  primaryKey({ name: "pk_component_map_workspace_component_account", columns: [table.workspaceId, table.componentName, table.accountId] }),
]);

export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  status: text("status").notNull(),
  issuesSynced: integer("issues_synced").notNull().default(0),
  errorMessage: text("error_message"),
});

export const configTable = sqliteTable("config", {
  workspaceId: text("workspace_id").notNull().default("default"),
  key: text("key").notNull(),
  value: text("value").notNull(),
}, (table) => [
  primaryKey({ name: "pk_config_workspace_key", columns: [table.workspaceId, table.key] }),
]);

export const localTags = sqliteTable("local_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
}, (table) => [
  uniqueIndex("idx_local_tags_workspace_name").on(table.workspaceId, table.name),
]);

export const issueTags = sqliteTable("issue_tags", {
  workspaceId: text("workspace_id").notNull().default("default"),
  jiraKey: text("jira_key").notNull(),
  tagId: integer("tag_id").notNull(),
}, (table) => [
  primaryKey({ name: "pk_issue_tags_workspace_issue_tag", columns: [table.workspaceId, table.jiraKey, table.tagId] }),
]);

export const issueScopeHistory = sqliteTable("issue_scope_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  jiraKey: text("jira_key").notNull(),
  observedAt: text("observed_at").notNull(),
  changeType: text("change_type").notNull(),
  fromAssigneeId: text("from_assignee_id"),
  toAssigneeId: text("to_assignee_id"),
  fromTeamScopeState: text("from_team_scope_state"),
  toTeamScopeState: text("to_team_scope_state"),
  fromSyncScopeState: text("from_sync_scope_state"),
  toSyncScopeState: text("to_sync_scope_state"),
  fromStatusCategory: text("from_status_category"),
  toStatusCategory: text("to_status_category"),
});

// ── Team Tracker tables ────────────────────────────────

export const teamTrackerDays = sqliteTable("team_tracker_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  date: text("date").notNull(),
  developerAccountId: text("developer_account_id").notNull(),
  status: text("status").notNull().default("on_track"),
  capacityUnits: integer("capacity_units"),
  managerNotes: text("manager_notes"),
  lastCheckInAt: text("last_check_in_at"),
  nextFollowUpAt: text("next_follow_up_at"),
  statusUpdatedAt: text("status_updated_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_tracker_days_unique_workspace_date_developer").on(table.workspaceId, table.date, table.developerAccountId),
  index("idx_tracker_days_workspace_developer_date").on(table.workspaceId, table.developerAccountId, table.date),
]);

export const developerAvailabilityPeriods = sqliteTable("developer_availability_periods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  developerAccountId: text("developer_account_id").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const teamTrackerItems = sqliteTable("team_tracker_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  dayId: integer("day_id").notNull(),
  managerDeskItemId: integer("manager_desk_item_id"),
  taskKey: text("task_key"),
  createdByType: text("created_by_type"),
  createdById: text("created_by_id"),
  itemType: text("item_type").notNull(),
  jiraKey: text("jira_key"),
  relatedJiraKeys: text("related_jira_keys"),
  title: text("title").notNull(),
  state: text("state").notNull().default("planned"),
  position: integer("position").notNull().default(0),
  note: text("note"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const teamTrackerCheckIns = sqliteTable("team_tracker_checkins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  dayId: integer("day_id").notNull(),
  summary: text("summary").notNull(),
  status: text("status"),
  rationale: text("rationale"),
  nextFollowUpAt: text("next_follow_up_at"),
  authorType: text("author_type").notNull().default("manager"),
  authorAccountId: text("author_account_id"),
  createdAt: text("created_at").notNull(),
});

export const teamTrackerSavedViews = sqliteTable("team_tracker_saved_views", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  managerAccountId: text("manager_account_id").notNull(),
  name: text("name").notNull(),
  searchQuery: text("search_query"),
  summaryFilter: text("summary_filter").notNull(),
  sortBy: text("sort_by").notNull(),
  groupBy: text("group_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_tracker_saved_views_workspace_manager_name").on(table.workspaceId, table.managerAccountId, table.name),
]);

export const workSavedViews = sqliteTable("work_saved_views", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  managerAccountId: text("manager_account_id").notNull(),
  name: text("name").notNull(),
  filter: text("filter").notNull().default("all"),
  developerAccountId: text("developer_account_id"),
  tagId: integer("tag_id"),
  noTags: integer("no_tags").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_work_saved_views_workspace_manager_name").on(table.workspaceId, table.managerAccountId, table.name),
]);

// ── Manager Desk tables ────────────────────────────────

export const managerDeskDays = sqliteTable("manager_desk_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  date: text("date").notNull(),
  managerAccountId: text("manager_account_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_manager_desk_days_unique_workspace_date_manager").on(table.workspaceId, table.date, table.managerAccountId),
]);

export const managerDeskItems = sqliteTable("manager_desk_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  dayId: integer("day_id").notNull(),
  sourceItemId: integer("source_item_id"),
  taskKey: text("task_key"),
  createdByType: text("created_by_type"),
  createdById: text("created_by_id"),
  assigneeDeveloperAccountId: text("assignee_developer_account_id"),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("inbox"),
  priority: text("priority").notNull().default("medium"),
  participants: text("participants"),
  contextNote: text("context_note"),
  nextAction: text("next_action"),
  outcome: text("outcome"),
  plannedStartAt: text("planned_start_at"),
  plannedEndAt: text("planned_end_at"),
  followUpAt: text("follow_up_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const managerDeskLinks = sqliteTable("manager_desk_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  itemId: integer("item_id").notNull(),
  linkType: text("link_type").notNull(),
  issueKey: text("issue_key"),
  developerAccountId: text("developer_account_id"),
  externalLabel: text("external_label"),
  createdAt: text("created_at").notNull(),
});

export const managerDeskItemHistory = sqliteTable("manager_desk_item_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  itemId: integer("item_id").notNull(),
  managerAccountId: text("manager_account_id").notNull(),
  eventType: text("event_type").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  recordedAt: text("recorded_at").notNull(),
});

export const dailyNotes = sqliteTable("daily_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  managerAccountId: text("manager_account_id").notNull(),
  date: text("date").notNull(),
  body: text("body").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_daily_notes_owner_date").on(table.workspaceId, table.managerAccountId, table.date),
]);

export const dailyNoteCaptures = sqliteTable("daily_note_captures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  managerAccountId: text("manager_account_id").notNull(),
  noteId: integer("note_id").notNull().references(() => dailyNotes.id, { onDelete: "cascade" }),
  requestId: text("request_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_daily_note_captures_owner_request").on(table.workspaceId, table.managerAccountId, table.requestId),
  index("idx_daily_note_captures_note").on(table.noteId),
]);

export const dailyNoteFollowUps = sqliteTable("daily_note_follow_ups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  managerAccountId: text("manager_account_id").notNull(),
  noteId: integer("note_id").notNull().references(() => dailyNotes.id, { onDelete: "cascade" }),
  itemId: integer("item_id").notNull().references(() => managerDeskItems.id, { onDelete: "cascade" }),
  taskId: integer("task_id"),
  requestId: text("request_id").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_daily_note_follow_ups_item").on(table.itemId),
  uniqueIndex("idx_daily_note_follow_ups_owner_request").on(table.workspaceId, table.managerAccountId, table.requestId),
  index("idx_daily_note_follow_ups_note").on(table.noteId),
]);

export const taskKeySequences = sqliteTable("task_key_sequences", {
  workspaceId: text("workspace_id").primaryKey(),
  nextValue: integer("next_value").notNull(),
});

export const taskKeyAliases = sqliteTable("task_key_aliases", {
  workspaceId: text("workspace_id").notNull(),
  aliasKey: text("alias_key").notNull(),
  taskKey: text("task_key").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.aliasKey] })]);

export const dataMigrations = sqliteTable("data_migrations", {
  name: text("name").primaryKey(),
  appliedAt: text("applied_at").notNull(),
  reportJson: text("report_json"),
});

export const taskEvents = sqliteTable("task_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  taskKey: text("task_key").notNull(),
  taskId: integer("task_id"),
  type: text("type").notNull(),
  body: text("body"),
  visibility: text("visibility").notNull(),
  authorType: text("author_type").notNull(),
  authorId: text("author_id"),
  metaJson: text("meta_json"),
  sourceTable: text("source_table"),
  sourceId: integer("source_id"),
  dedupeKey: text("dedupe_key"),
  occurredAt: text("occurred_at").notNull(),
  createdAt: text("created_at").notNull(),
  redactedAt: text("redacted_at"),
  redactedBy: text("redacted_by"),
}, (table) => [
  index("idx_task_events_workspace_key_time").on(table.workspaceId, table.taskKey, table.occurredAt, table.id),
  index("idx_task_events_workspace_author").on(table.workspaceId, table.authorType, table.authorId),
  uniqueIndex("idx_task_events_workspace_dedupe").on(table.workspaceId, table.dedupeKey),
]);

export const checkinTaskRefs = sqliteTable("checkin_task_refs", {
  workspaceId: text("workspace_id").notNull().default("default"),
  checkinId: integer("checkin_id").notNull().references(() => teamTrackerCheckIns.id, { onDelete: "cascade" }),
  taskKey: text("task_key").notNull(),
  taskId: integer("task_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.checkinId, table.taskKey] })]);

export const dailyNoteTaskRefs = sqliteTable("daily_note_task_refs", {
  workspaceId: text("workspace_id").notNull(),
  managerAccountId: text("manager_account_id").notNull(),
  noteId: integer("note_id").notNull().references(() => dailyNotes.id, { onDelete: "cascade" }),
  taskKey: text("task_key").notNull(),
  taskId: integer("task_id"),
  relation: text("relation").notNull(),
  requestId: text("request_id"),
  payloadHash: text("payload_hash"),
  createdAt: text("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.noteId, table.taskKey, table.relation] })]);

// ── Phase 2 canonical task tables (inert until the backfill runs) ──

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  taskKey: text("task_key").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("task"),
  status: text("status").notNull().default("open"),
  later: integer("later").notNull().default(0),
  ownerType: text("owner_type"),
  ownerId: text("owner_id"),
  trackedByManagerId: text("tracked_by_manager_id"),
  parentId: integer("parent_id"),
  priority: text("priority").notNull().default("normal"),
  labelsJson: text("labels_json"),
  scheduledOn: text("scheduled_on"),
  dueAt: text("due_at"),
  followUpAt: text("follow_up_at"),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  participants: text("participants"),
  nextAction: text("next_action"),
  outcome: text("outcome"),
  createdByType: text("created_by_type").notNull().default("unknown"),
  createdById: text("created_by_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  closedAt: text("closed_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("idx_tasks_workspace_key").on(table.workspaceId, table.taskKey),
  index("idx_tasks_workspace_owner_status").on(table.workspaceId, table.ownerType, table.ownerId, table.status),
  index("idx_tasks_workspace_tracked").on(table.workspaceId, table.trackedByManagerId, table.status),
  index("idx_tasks_workspace_closed").on(table.workspaceId, table.closedAt),
]);

export const taskLinks = sqliteTable("task_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  ref: text("ref").notNull(),
  role: text("role"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_task_links_unique").on(table.workspaceId, table.taskId, table.kind, table.ref),
  index("idx_task_links_ref").on(table.workspaceId, table.kind, table.ref),
]);

export const dayFocus = sqliteTable("day_focus", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  date: text("date").notNull(),
  ownerType: text("owner_type").notNull(),
  ownerId: text("owner_id").notNull(),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  source: text("source").notNull().default("plan"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_day_focus_unique").on(table.workspaceId, table.date, table.ownerType, table.ownerId, table.taskId),
  index("idx_day_focus_owner_date").on(table.workspaceId, table.ownerType, table.ownerId, table.date),
]);

export const taskLegacyMap = sqliteTable("task_legacy_map", {
  workspaceId: text("workspace_id").notNull(),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  sourceTable: text("source_table").notNull(),
  sourceId: integer("source_id").notNull(),
  role: text("role").notNull(),
}, (table) => [
  primaryKey({ columns: [table.sourceTable, table.sourceId] }),
  index("idx_task_legacy_map_task").on(table.taskId),
]);

/**
 * Phase 3 (P3-D13): registry of known labels per workspace. Task rows keep the
 * string list in `tasks.labels_json`; this table records names, colors, and
 * system-label protection (`category:follow_up` feeds the Follow-ups
 * predicate; `kind:*`/`priority:*` back existing task semantics).
 */
export const taskLabels = sqliteTable("task_labels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("slate"),
  system: integer("system", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_task_labels_unique").on(table.workspaceId, table.name),
  index("idx_task_labels_workspace").on(table.workspaceId),
]);

/**
 * Phase 3 (P3-D9/D10): saved task views. Private to the owning manager —
 * manager_account_id is part of the primary access path, never shared.
 */
export const taskSavedViews = sqliteTable("task_saved_views", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  managerAccountId: text("manager_account_id").notNull(),
  name: text("name").notNull(),
  definitionJson: text("definition_json").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_task_saved_views_unique").on(table.workspaceId, table.managerAccountId, table.name),
  index("idx_task_saved_views_owner").on(table.workspaceId, table.managerAccountId),
]);

export const developerNotes = sqliteTable("developer_notes", {
  workspaceId: text("workspace_id").notNull(),
  developerAccountId: text("developer_account_id").notNull(),
  body: text("body").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.developerAccountId] })]);

// ── LeadOS Copilot (assistant) tables ──────────────────

export const assistantConversations = sqliteTable("assistant_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  managerAccountId: text("manager_account_id").notNull(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_assistant_conversations_owner").on(table.workspaceId, table.managerAccountId),
]);

export const assistantMessages = sqliteTable("assistant_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull().references(() => assistantConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  toolCalls: text("tool_calls"),
  toolCallId: text("tool_call_id"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("idx_assistant_messages_conversation").on(table.conversationId, table.createdAt),
]);

export const assistantMemories = sqliteTable("assistant_memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("default"),
  managerAccountId: text("manager_account_id").notNull(),
  text: text("text").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_assistant_memories_owner").on(table.workspaceId, table.managerAccountId),
]);

export const userNavPreferences = sqliteTable("user_nav_preferences", {
  workspaceId: text("workspace_id").notNull().default("default"),
  managerAccountId: text("manager_account_id").notNull(),
  topNav: text("top_nav").notNull(),
  moreNav: text("more_nav").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ name: "pk_user_nav_preferences_workspace_manager", columns: [table.workspaceId, table.managerAccountId] }),
]);
