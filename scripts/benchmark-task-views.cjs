// Synthetic CPU only: transpile the real source with inert infrastructure imports.
// No database connection, application startup, or Jira client is loaded.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { performance } = require('node:perf_hooks');
function load(file, overrides = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Date, Intl, Buffer, require: (name) => {
    if (overrides[name]) return overrides[name];
    if (name === 'shared/types') return require('../shared/types.js');
    return new Proxy({}, { get: () => class {} });
  } }, { filename: file });
  return exports;
}
const date = load('server/src/utils/date.ts');
const views = load('server/src/services/task-views.service.ts', { '../utils/date': date });
const rows = Array.from({ length: 1000 }, (_, id) => ({
  id, taskKey: `T-${id}`, title: `Synthetic ${id}`, status: id % 11 === 0 ? 'done' : 'open',
  ownerType: id % 3 === 0 ? 'developer' : 'manager', ownerId: id % 3 === 0 ? 'dev' : 'me', trackedByManagerId: 'me',
  kind: id % 13 === 0 ? 'meeting' : 'task', priority: id % 4 === 0 ? 'high' : 'normal', later: id % 7 === 0 ? 1 : 0,
  hideUntil: null, needsTriage: id % 5 === 0 ? 1 : 0, scheduledOn: id % 2 ? '2026-10-05' : null, schedulePosition: null,
  dueAt: '2026-10-06T01:00:00Z', followUpAt: id % 3 === 0 ? '2026-10-05T10:00:00Z' : null,
  waitingOnType: null, waitingSince: '2026-09-28T10:00:00Z', labelsJson: '[]',
  createdAt: '2026-09-28T10:00:00Z', updatedAt: '2026-09-28T10:00:00Z', closedAt: id % 11 === 0 ? '2026-10-05T10:00:00Z' : null,
  deletedAt: null,
}));
const facts = { lastActivity: new Map(), drifted: new Set([1, 2]), jiraLinked: null };
const principal = { type: 'manager', accountId: 'me' };
const service = Object.create(views.TaskViewsService.prototype);
const definitions = views.builtinTaskViews('2026-10-06');
for (let run = 0; run < 3; run++) {
  const start = performance.now();
  const prepared = service.prepare?.(principal, rows, facts, '2026-10-06', 'Asia/Kolkata');
  const counts = definitions.map(({ definition }) => service.matching(principal, rows, definition, facts, '2026-10-06', 'Asia/Kolkata', prepared).length);
  const matchingMs = performance.now() - start;
  const dateStart = performance.now();
  for (let i = 0; i < 10000; i++) date.isoDatePart('2026-10-06T01:00:00Z', 'Asia/Kolkata');
  console.log(JSON.stringify({ run: run + 1, matchingMs: Math.round(matchingMs), isoDatePartMs: Math.round(performance.now() - dateStart), counts }));
}
