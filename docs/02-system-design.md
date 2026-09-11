# System Design Document

## Defect Management Command Dashboard

**Version:** 1.0
**Date:** March 5, 2026

---

## 1. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React SPA)                   │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌─────────────┐  │
│  │ Overview  │ │  Defect  │ │ Triage │ │  Workload   │  │
│  │  Cards    │ │  Table   │ │ Panel  │ │   Panel     │  │
│  └──────────┘ └──────────┘ └────────┘ └─────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────────┐  │
│  │  Filters │ │  Alerts  │ │  Developer Daily View  │  │
│  └──────────┘ └──────────┘ └────────────────────────┘  │
└───────────────────────┬─────────────────────────────────┘
                        │  HTTP / REST
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  Backend (Node.js / Express)             │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │  REST API     │  │  Sync     │  │  Automation      │ │
│  │  Controllers  │  │  Engine   │  │  Engine          │ │
│  └──────┬───────┘  └─────┬─────┘  └────────┬─────────┘ │
│         │                │                  │           │
│         ▼                ▼                  ▼           │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Service Layer                        │   │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌───────┐ │   │
│  │  │  Issue   │ │ Workload │ │  Alert  │ │ Jira  │ │   │
│  │  │ Service  │ │ Service  │ │ Service │ │Client │ │   │
│  │  └─────────┘ └──────────┘ └─────────┘ └───────┘ │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                               │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │              SQLite Database                       │   │
│  │  issues │ developers │ sync_log │ component_map   │   │
│  └──────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────┘
                        │  HTTPS
                        ▼
┌─────────────────────────────────────────────────────────┐
│                 Jira Cloud REST API v3                   │
│          (atlassian.net / Basic Auth)                    │
└─────────────────────────────────────────────────────────┘
```

### Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend framework | React 18 + Vite | Fast dev cycle, rich ecosystem, Vite for fast builds |
| UI library | Tailwind CSS + shadcn/ui | Modern, composable, dark-mode native |
| Animation | Framer Motion (motion) | Orchestrated page-load sequence, layout animations, mount/unmount transitions |
| Typography | Geist + Geist Mono | Distinctive, technical character; avoids generic Inter/Roboto |
| Backend framework | Node.js + Express | Simple, lightweight, same language as frontend |
| Database | SQLite (via better-sqlite3) | Zero-config, file-based, sufficient for single-user scale |
| ORM | Drizzle ORM | Type-safe, lightweight, great SQLite support |
| API style | REST (JSON) | Simple, well-understood, maps to Jira integration |
| Monorepo | Single repo, /client + /server | Simple structure for a small application |
| State management | TanStack Query (React Query) | Server-state caching, auto-refresh, optimistic updates |
| Real-time refresh | Polling (TanStack Query) | Simple; WebSockets unnecessary for single-user + 5-min interval |

---

## 2. Component Design

### 2.1 Backend Components

#### 2.1.1 Jira Client (`/server/src/jira/client.ts`)

Encapsulates all Jira REST API communication.

```
JiraClient
  ├── constructor(baseUrl, email, apiToken)
  ├── searchIssues(jql, fields[], startAt, maxResults) → Issue[]
  ├── getIssue(issueKey) → Issue
  ├── updateIssue(issueKey, fields) → void
  ├── addComment(issueKey, body) → Comment
  ├── getTransitions(issueKey) → Transition[]
  ├── getProjectComponents(projectKey) → Component[]
  └── getCurrentUser() → User
```

**Authentication:** Basic Auth header (`email:apiToken` base64-encoded).

**Rate Limiting:** Respect `X-RateLimit-*` and `Retry-After` headers. Implement exponential backoff.

**Pagination:** Jira search returns paginated results (max 100 per page). Client iterates until all results are fetched.

---

#### 2.1.2 Sync Engine (`/server/src/sync/engine.ts`)

Periodically fetches data from Jira and stores it locally.

```
SyncEngine
  ├── startSync(intervalMs: 300000)  // 5 minutes
  ├── stopSync()
  ├── syncNow() → SyncResult
  ├── getLastSyncTime() → Date
  └── onSyncComplete(callback)
```

**Sync Strategy:**

1. **Full sync on startup:** Fetch all open defects from Jira for the configured project.
2. **Incremental sync every 5 minutes:** Fetch issues updated since last sync (`updated >= lastSyncTime`).
3. **Manual sync:** User can trigger immediate refresh.

**JQL for sync:**

```
project = {PROJECT_KEY} AND issuetype = Bug AND statusCategory != Done
  AND (assignee = currentUser() OR assignee in ({developerList}))
ORDER BY updated DESC
```

---

#### 2.1.3 Issue Service (`/server/src/services/issue.service.ts`)

Business logic for defect operations.

```
IssueService
  ├── getAll(filters?) → Issue[]
  ├── getById(issueKey) → IssueDetail
  ├── updateAssignee(issueKey, accountId) → void
  ├── updatePriority(issueKey, priorityId) → void
  ├── updateDueDate(issueKey, date) → void
  ├── addComment(issueKey, body) → void
  ├── toggleBlocked(issueKey) → void
  ├── getOverviewCounts() → OverviewCounts
  └── suggestPriority(issue) → Priority
```

**Write-through strategy:** Updates are sent to Jira first. On success, the local cache is updated. On failure, the error is returned to the client.

---

#### 2.1.4 Workload Service (`/server/src/services/workload.service.ts`)

Computes team workload metrics.

```
WorkloadService
  ├── getTeamWorkload() → DeveloperWorkload[]
  ├── getDeveloperWorkload(accountId) → DeveloperWorkload
  ├── suggestAssignee(issue) → RankedDeveloper[]
  └── getIdleDevelopers() → Developer[]
```

**Workload Calculation:**

```typescript
interface DeveloperWorkload {
  developer: Developer;
  activeDefects: number;
  dueToday: number;
  blocked: number;
  score: number;        // weighted sum
  level: 'light' | 'medium' | 'heavy';
}

function calculateScore(issues: Issue[]): number {
  return issues.reduce((sum, issue) => {
    const weight = PRIORITY_WEIGHTS[issue.priority] ?? 0.5;
    return sum + weight;
  }, 0);
}

const PRIORITY_WEIGHTS = {
  Highest: 5, // P0
  High: 3,    // P1
  Medium: 1,  // P2
  Low: 0.5,   // P3
  Lowest: 0.5 // P4
};
```

---

#### 2.1.5 Alert Service (`/server/src/services/alert.service.ts`)

Detects and manages alerts.

```
AlertService
  ├── computeAlerts() → Alert[]
  ├── getActiveAlerts() → Alert[]
  └── getAlertCounts() → AlertCounts
```

**Alert Rules:**

```typescript
interface Alert {
  id: string;
  type: 'overdue' | 'stale' | 'blocked' | 'idle_developer' | 'high_priority_not_started';
  severity: 'high' | 'medium';
  issueKey?: string;
  developerAccountId?: string;
  message: string;
  detectedAt: Date;
}
```

| Type | Detection Logic |
|---|---|
| Overdue | `dueDate < now() AND statusCategory != Done` |
| Stale | `updated < now() - 48h AND statusCategory != Done` |
| Blocked | `flagged = true OR status = 'Blocked'` |
| Idle Developer | Developer has 0 open issues assigned |
| High Priority Not Started | `priority in (Highest, High) AND status = 'To Do' AND created < now() - 4h` |

---

#### 2.1.6 Automation Engine (`/server/src/automation/engine.ts`)

Applies automation rules to generate suggestions.

```
AutomationEngine
  ├── suggestPriority(issue) → SuggestedPriority
  ├── suggestDueDate(priority, createdDate) → SuggestedDate
  └── detectStaleIssues(issues) → Issue[]
```

**Priority Suggestion Rules:**

```
IF labels CONTAINS 'production' OR type = 'Production Bug'  → Highest (P0)
IF labels CONTAINS 'customer' OR labels CONTAINS 'client'   → High (P1)
ELSE                                                         → Medium (P2)
```

**Due Date Suggestion Rules:**

```
P0 (Highest) → created + 24 hours
P1 (High)    → created + 3 business days
P2 (Medium)  → created + 7 business days
P3+ (Low)    → created + 14 business days
```

---

### 2.2 API Design

#### Base URL: `/api`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/issues` | List all issues (with filter query params) |
| GET | `/api/issues/:key` | Get single issue detail |
| PATCH | `/api/issues/:key` | Update issue fields (assignee, priority, dueDate, flagged) |
| POST | `/api/issues/:key/comments` | Add comment to issue |
| GET | `/api/overview` | Get overview card counts |
| GET | `/api/team/workload` | Get team workload data |
| GET | `/api/team/developers` | List configured developers |
| GET | `/api/team/:accountId/issues` | Get issues for a developer |
| GET | `/api/alerts` | Get active alerts |
| GET | `/api/suggestions/assignee/:key` | Get assignment suggestions for issue |
| GET | `/api/suggestions/priority/:key` | Get priority suggestion for issue |
| GET | `/api/suggestions/duedate/:priority` | Get due date suggestion for priority |
| POST | `/api/sync` | Trigger manual sync |
| GET | `/api/sync/status` | Get last sync time and status |
| GET | `/api/config` | Get dashboard configuration |
| PUT | `/api/config` | Update dashboard configuration |

#### Filter Query Parameters for `/api/issues`

| Parameter | Type | Example |
|---|---|---|
| `filter` | Predefined filter name | `unassigned`, `overdue`, `blocked`, `stale`, `dueToday`, `dueThisWeek`, `highPriority` |
| `assignee` | Jira account ID | `5f3a...` |
| `priority` | Priority name | `Highest`, `High` |
| `status` | Status name | `To Do`, `In Progress` |
| `sort` | Sort field | `priority`, `dueDate`, `updated`, `created` |
| `order` | Sort direction | `asc`, `desc` |

#### Example Response: `GET /api/overview`

```json
{
  "new": 3,
  "unassigned": 5,
  "dueToday": 2,
  "overdue": 1,
  "blocked": 2,
  "inProgress": 8,
  "total": 24,
  "lastSynced": "2026-03-05T09:30:00Z"
}
```

#### Example Response: `GET /api/team/workload`

```json
{
  "developers": [
    {
      "accountId": "5f3a...",
      "displayName": "Alice",
      "avatarUrl": "https://...",
      "activeDefects": 4,
      "dueToday": 1,
      "blocked": 0,
      "score": 9,
      "level": "medium"
    }
  ]
}
```

---

## 3. Data Models

### 3.1 Database Schema (SQLite)

```sql
-- Locally cached issues from Jira
CREATE TABLE issues (
  jira_key        TEXT PRIMARY KEY,         -- e.g., 'PROJ-123'
  summary         TEXT NOT NULL,
  description     TEXT,
  priority_name   TEXT NOT NULL,            -- 'Highest', 'High', 'Medium', 'Low', 'Lowest'
  priority_id     TEXT NOT NULL,
  status_name     TEXT NOT NULL,            -- 'To Do', 'In Progress', 'Done'
  status_category TEXT NOT NULL,            -- 'new', 'indeterminate', 'done'
  assignee_id     TEXT,                     -- Jira account ID
  assignee_name   TEXT,
  reporter_name   TEXT,
  component       TEXT,                     -- Primary component name
  labels          TEXT,                     -- JSON array of labels
  due_date        TEXT,                     -- ISO date string
  flagged         INTEGER DEFAULT 0,        -- 0 or 1
  created_at      TEXT NOT NULL,            -- ISO timestamp
  updated_at      TEXT NOT NULL,            -- ISO timestamp
  synced_at       TEXT NOT NULL             -- When we last synced this issue
);

-- Configured team developers
CREATE TABLE developers (
  account_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email        TEXT,
  avatar_url   TEXT,
  is_active    INTEGER DEFAULT 1
);

-- Component-to-developer mapping (Phase 2, schema created in Phase 1)
CREATE TABLE component_map (
  component_name TEXT NOT NULL,
  account_id     TEXT NOT NULL,
  fix_count      INTEGER DEFAULT 0,
  PRIMARY KEY (component_name, account_id),
  FOREIGN KEY (account_id) REFERENCES developers(account_id)
);

-- Sync audit log
CREATE TABLE sync_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  status       TEXT NOT NULL,              -- 'running', 'success', 'error'
  issues_synced INTEGER DEFAULT 0,
  error_message TEXT
);

-- Dashboard configuration
CREATE TABLE config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes for common queries
CREATE INDEX idx_issues_assignee ON issues(assignee_id);
CREATE INDEX idx_issues_status ON issues(status_category);
CREATE INDEX idx_issues_priority ON issues(priority_name);
CREATE INDEX idx_issues_due_date ON issues(due_date);
CREATE INDEX idx_issues_updated ON issues(updated_at);
CREATE INDEX idx_issues_flagged ON issues(flagged);
```

### 3.2 Configuration Keys

| Key | Description | Default |
|---|---|---|
| `jira_base_url` | Jira Cloud instance URL | — |
| `jira_email` | Authentication email | — |
| `jira_project_key` | Jira project key | — |
| `jira_lead_account_id` | Lead's Jira account ID | — |
| `sync_interval_ms` | Sync interval in milliseconds | `300000` (5 min) |
| `jira_auto_sync_enabled` | Enables the scheduled Jira sync; when `false`, no Jira API calls are made except manual syncs | `true` |
| `stale_threshold_hours` | Hours before an issue is considered stale | `48` |

> **Note:** `jira_api_token` is stored in an environment variable (`JIRA_API_TOKEN`), never in the database.

---

## 4. Jira API Integration Details

### 4.1 Authentication

```
Authorization: Basic base64(email:apiToken)
```

### 4.2 Key Endpoints Used

| Operation | Jira API Endpoint |
|---|---|
| Search issues | `GET /rest/api/3/search` |
| Get issue | `GET /rest/api/3/issue/{issueIdOrKey}` |
| Update issue | `PUT /rest/api/3/issue/{issueIdOrKey}` |
| Add comment | `POST /rest/api/3/issue/{issueIdOrKey}/comment` |
| Get transitions | `GET /rest/api/3/issue/{issueIdOrKey}/transitions` |
| List project components | `GET /rest/api/3/project/{projectIdOrKey}/components` |
| Get myself | `GET /rest/api/3/myself` |
| Search users | `GET /rest/api/3/user/search` |

### 4.3 Search JQL Examples

**All open defects for the project:**
```
project = PROJ AND issuetype = Bug AND statusCategory != Done
```

**Defects assigned to lead (unassigned):**
```
project = PROJ AND issuetype = Bug AND assignee = "lead@company.com"
  AND statusCategory != Done
```

**Incremental sync (updated since last sync):**
```
project = PROJ AND issuetype = Bug AND updated >= "2026-03-05 09:00"
  AND statusCategory != Done
```

### 4.4 Issue Fields Requested

```
fields=summary,description,priority,status,assignee,reporter,
  components,labels,duedate,created,updated,flagged
```

### 4.5 Update Payloads

**Assign developer:**
```json
{
  "fields": {
    "assignee": { "accountId": "5f3a..." }
  }
}
```

**Set priority:**
```json
{
  "fields": {
    "priority": { "name": "High" }
  }
}
```

**Set due date:**
```json
{
  "fields": {
    "duedate": "2026-03-08"
  }
}
```

### 4.6 Rate Limit Handling

- Jira Cloud free tier: ~100 requests/minute.
- Sync fetches ~20 pages max (100 issues/page = 2,000 issues).
- Dashboard writes are user-initiated (low frequency).
- Strategy: Queue writes, respect `Retry-After`, exponential backoff on 429.

---

## 5. Sync Architecture

```
                    ┌──────────────┐
                    │  Sync Timer  │
                    │  (5-min)     │
                    └──────┬───────┘
                           │ tick
                           ▼
                    ┌──────────────┐
                    │  Sync Engine │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌──────────┐   ┌─────────────┐
   │ Fetch from  │  │ Diff /   │   │ Recompute   │
   │ Jira API    │  │ Upsert   │   │ Alerts      │
   │ (paginated) │  │ to SQLite│   │ & Workload  │
   └─────────────┘  └──────────┘   └─────────────┘
```

**Sync Flow:**

1. Timer fires (or manual trigger).
2. Sync Engine queries Jira with JQL (`updated >= lastSyncTime` for incremental).
3. Each fetched issue is upserted into `issues` table.
4. Issues that were in the local DB but no longer match JQL (resolved) are marked with status_category = 'done'.
5. Alert Service recomputes alerts from the refreshed data.
6. Workload Service recomputes team scores.
7. Sync log entry written.
8. Frontend is informed via polling (TanStack Query `refetchInterval`).

---

## 6. Frontend Architecture

### 6.1 State Management

```
TanStack Query
  ├── useIssues(filters)        → cached, refetchInterval: 30s
  ├── useIssueDetail(key)       → cached, refetchOnWindowFocus
  ├── useOverview()             → cached, refetchInterval: 30s
  ├── useTeamWorkload()         → cached, refetchInterval: 30s
  ├── useAlerts()               → cached, refetchInterval: 30s
  ├── useSuggestions(key)       → on-demand
  ├── useSyncStatus()           → cached, refetchInterval: 10s
  │
  Mutations:
  ├── useUpdateIssue()          → optimistic update + invalidate
  ├── useAddComment()           → invalidate issue detail
  └── useTriggerSync()          → invalidate all
```

### 6.2 Component Tree

```
<App>
  <ThemeProvider>            // Dark/light mode
    <QueryClientProvider>
      <DashboardLayout>
        <Header />           // App title, sync status, theme toggle
        <OverviewCards />    // F1: Command center cards
        <main>
          <FilterSidebar />  // F7: Smart filters
          <DefectTable />    // F2: Main table
          <TriagePanel />    // F3: Side panel (conditional)
        </main>
        <WorkloadPanel />    // F4: Team workload
        <AlertBanner />      // F6: Active alerts
      </DashboardLayout>
    </QueryClientProvider>
  </ThemeProvider>
</App>
```

### 6.3 Key UI Interactions

| Action | Frontend | Backend | Jira |
|---|---|---|---|
| Load dashboard | Fetch overview + issues + workload + alerts | Serve from SQLite | — (cached) |
| Click filter | Re-fetch `/api/issues?filter=X` | Query SQLite with filter | — |
| Click defect row | Fetch `/api/issues/:key` + show triage panel | Serve detailed issue | — |
| Assign developer | Optimistic update → `PATCH /api/issues/:key` | Update Jira → Update SQLite | `PUT /rest/api/3/issue/:key` |
| Change priority | Same as above | Same | Same |
| Set due date | Same as above | Same | Same |
| Manual refresh | `POST /api/sync` → poll until complete | Full sync from Jira | `GET /rest/api/3/search` |

---

## 7. Security Considerations

| Concern | Mitigation |
|---|---|
| Jira API token storage | Environment variable only — never in DB, config files, or client code |
| API token in transit | HTTPS only (Jira Cloud enforces this) |
| Dashboard access | Single-user local application; no auth needed for MVP. Phase 2: add session auth if deployed. |
| Input validation | Sanitize all user input before sending to Jira API. Validate issue keys, account IDs, dates. |
| XSS | React auto-escapes. Render Jira descriptions with a sanitized markdown renderer. |
| SQL injection | Parameterized queries via Drizzle ORM — no raw SQL interpolation. |
| CORS | Backend serves frontend in production (same origin). Dev uses Vite proxy. |
| Secrets in logs | Redact API tokens from all log output. |

---

## 8. Scalability Considerations

| Dimension | Design |
|---|---|
| Issue volume | SQLite handles tens of thousands of rows easily. Indexed queries. |
| Sync performance | Incremental sync (only changed issues). Full sync only on startup. |
| API rate limits | Respectful pagination, backoff, and caching. |
| Frontend performance | Virtualized table for large lists (TanStack Table). Memoized computations. |
| Multi-user (future) | Replace SQLite with PostgreSQL. Add JWT auth. Minimal backend changes needed. |
| Multi-project (future) | Add project selector; extend JQL filter. Schema supports this. |

---

## 9. Error Handling Strategy

| Scenario | Behavior |
|---|---|
| Jira API unreachable | Show stale data with "Last synced X min ago" warning. Retry on next interval. |
| Jira API rate limited | Queue requests, retry with backoff. Show "Sync delayed" notice. |
| Update fails (write to Jira) | Revert optimistic UI update. Show error toast with details. |
| Invalid configuration | Show setup wizard on first run. Validate connection before saving. |
| Database corruption | Auto-recreate tables. Full re-sync from Jira. No data loss (Jira is source of truth). |

---

## 10. Deployment Architecture

### Development

```
npm run dev
  ├── Vite dev server (port 5173) → proxies /api to backend
  └── Node.js server (port 3001)  → SQLite file in ./data/
```

### Production

```
npm run build
npm run start
  └── Node.js server (port 3001)
      ├── Serves static React build from /client/dist
      ├── Serves /api routes
      └── SQLite file in ./data/
```

Single process, single binary-like deployment. Can run on any machine with Node.js 20+.
