import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ArrowLeftRight, History, Keyboard, ListChecks, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { RecordStandupSessionResponse, TeamTrackerBoardResponse, TrackerCheckInVisibility, TrackerDeveloperDay, TrackerDeveloperStatus } from '@/types';
import { usesCheckIns } from '@/lib/participation';
import { useTeamMode } from '@/hooks/useTeamMode';
import { useStandupRound } from '@/hooks/useStandupRound';
import { isCoveredByLaterLayer, useModalFocus } from '@/hooks/useModalFocus';
import './standup/standup.css';
import { api } from '@/lib/api';
import { useLatestStandupSession, usePrefetchStandupFeeds, useStandupFeed } from '@/hooks/useTeamTracker';
import {
  useAddCheckIn,
  useReassignTrackerItem,
  useRecordStandupReviews,
  useSetCurrentItem,
  useStatusUpdate,
} from '@/hooks/useTeamTrackerMutations';
import { useUpdateTaskDetail } from '@/hooks/useTaskDetail';
import { useDevelopers } from '@/hooks/useDevelopers';
import { useToast } from '@/context/ToastContext';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import {
  buildStandupSummary,
  dayStats,
  doneTodayFor,
  feedActiveTaskKeys,
  openTasksFor,
  type StandupLogKind,
} from '@/lib/standup';
import { TaskUpdateComposer, taskUpdateDrafts } from '@/components/tasks/TaskUpdateComposer';
import { taskKeysForSubmit, type TaskPickerTask } from '@/components/tasks/TaskPicker';
import { CaptureBox } from '@/components/capture/CaptureBox';
import { StatusRationaleDialog } from './StatusRationaleDialog';
import { StandupRail } from './standup/StandupRail';
import { StandupPersonHeader, STATUS_LABELS } from './standup/StandupPersonHeader';
import { StandupTaskList } from './standup/StandupTaskList';
import { StandupFeed, StandupFeedRail } from './standup/StandupFeed';
import { StandupActionBar, type StandupActionGroup } from './standup/StandupActionBar';
import { StandupWrapUp } from './standup/StandupWrapUp';
import { CheckInForm, KeyHelpGrid, LayerShell, ReassignList } from './standup/StandupLayers';
import { StandupHistory } from './standup/StandupHistory';
import { Kbd } from './standup/StandupPrimitives';

/**
 * Phase 3 (P3-D5/D6, §6) + docs/50: keyboard-driven standup. One developer
 * at a time, ordered the same way the board is sorted; a "since last standup"
 * feed (anchored to the manager's last sealed session, else a rolling
 * 24h/72h-Monday fallback) sits beside the person's tasks. A client-side
 * session tracks who was reviewed and what was logged; End seals it into a
 * durable `standup_sessions` row, creates follow-up tasks for flagged people,
 * and archives the summary on today's note (docs/50 v2).
 * All writes reuse the canonical task/event/check-in paths — nothing here
 * bypasses them.
 */
interface StandupModeProps {
  date: string;
  board: TeamTrackerBoardResponse;
  onClose: () => void;
  onOpenTask: (taskKey: string) => void;
  /** Pause the keymap while a drawer/dialog stacked above standup owns input. */
  suspended?: boolean;
}

type StandupLayer = 'none' | 'capture' | 'status' | 'reassign' | 'checkin' | 'taskdraft' | 'help' | 'history';
type StandupView = 'person' | 'wrapup';

const DIALOG_STATUSES: TrackerDeveloperStatus[] = ['at_risk', 'blocked', 'waiting'];
const FEED_COLLAPSED_KEY = 'standup-feed-collapsed';

function formatStandupDate(date: string): string {
  try {
    return format(parseISO(date), 'EEE, MMM d');
  } catch {
    return date;
  }
}

export function StandupMode({ date, board, onClose, onOpenTask, suspended = false }: StandupModeProps) {
  const { addToast } = useToast();
  const teamMode = useTeamMode();
  const reduceMotion = useReducedMotion();
  const rootRef = useModalFocus<HTMLDivElement>();
  useEffect(() => {
    document.body.classList.add('standup-open');
    return () => document.body.classList.remove('standup-open');
  }, []);
  useEffect(() => { rootRef.current?.focus(); }, [rootRef]);
  // P3-D5: standup order follows the board's active sort/saved view.
  const storageKey = useScopedStorageKey(`standup-session:${date}`);
  const draftPrefix = useScopedStorageKey('task-update:manager:standup:');
  const [taskDrafts, setTaskDrafts] = useState(() => taskUpdateDrafts(draftPrefix));
  const [recoverTaskKey, setRecoverTaskKey] = useState<string>();
  useEffect(() => {
    const update = () => setTaskDrafts(taskUpdateDrafts(draftPrefix));
    window.addEventListener('task-update-drafts-changed', update);
    return () => window.removeEventListener('task-update-drafts-changed', update);
  }, [draftPrefix]);
  const initialOrder = useMemo(() => board.developers.map((entry) => entry.developer.accountId), [board.developers]);
  const { session, dispatch, storageFailed, ownsRound, clear } = useStandupRound(storageKey, initialOrder);
  const ordered = useMemo(() => (session.order ?? initialOrder).flatMap((id) => {
    const entry = board.developers.find((person) => person.developer.accountId === id);
    return entry ? [entry] : [];
  }), [session.order, initialOrder, board.developers]);
  const reviewed = useMemo(() => new Set(session.reviewed), [session.reviewed]);
  const flagged = useMemo(() => new Set(session.flagged), [session.flagged]);

  // Track the person by id, not index: a status change can re-sort the board.
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const resume = ordered.find((entry) => !session.reviewed.includes(entry.developer.accountId)) ?? ordered[0];
    return session.currentId ?? resume?.developer.accountId ?? null;
  });
  const [view, setView] = useState<StandupView>(() =>
    session.request ? 'wrapup' : session.view ?? (ordered.length > 0 && ordered.every((entry) => session.reviewed.includes(entry.developer.accountId)) ? 'wrapup' : 'person'),
  );
  const [selectedTaskKey, setSelectedTaskKey] = useState(session.taskKey);
  const displayedRound = useRef(session.roundId);
  useEffect(() => {
    if (displayedRound.current === session.roundId) return;
    displayedRound.current = session.roundId;
    setCurrentId(session.currentId ?? ordered[0]?.developer.accountId ?? null);
    setSelectedTaskKey(session.taskKey);
    setView(session.request ? 'wrapup' : session.view ?? 'person');
  }, [session.roundId, session.currentId, session.taskKey, session.request, session.view, ordered]);
  useEffect(() => {
    const focus = window.setTimeout(() => rootRef.current?.querySelector<HTMLElement>('[data-standup-person]')?.focus(), 0);
    return () => window.clearTimeout(focus);
  }, [rootRef, currentId, view]);
  const [layer, setLayer] = useState<StandupLayer>('none');
  const [pendingStatus, setPendingStatus] = useState<TrackerDeveloperStatus | null>(null);
  const [statusPreselect, setStatusPreselect] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [sealing, setSealing] = useState(false);
  const [saveToNote, setSaveToNote] = useState(true);
  const sealingRef = useRef(false);
  const [finishError, setFinishError] = useState('');
  const [notePending, setNotePending] = useState<string | null>(null);
  const notePendingRef = useRef(new Set<string>());
  const liveContext = useRef({ currentId, layer });
  liveContext.current = { currentId, layer };
  // docs/50 v2: whether "End standup" also files the summary under
  // Notes → Standups. Sealing the session itself is unconditional.
  const queryClient = useQueryClient();
  // Reviews do not refetch mid-round (the order is walked by index); refresh once on the way out.
  useEffect(() => () => {
    if (!recordedAnyRef.current) return;
    for (const key of ['team-tracker', 'today']) void queryClient.invalidateQueries({ queryKey: [key] });
  }, [queryClient]);

  const composerApi = useRef<{ expand: () => void; focus: () => void; togglePrivate: () => void } | null>(null);
  const taskRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const checkInRef = useRef<HTMLTextAreaElement>(null);

  // docs/56 P1-07: the feed can be tucked away; a per-viewer convenience, so storage is best-effort.
  const feedStorageKey = useScopedStorageKey(FEED_COLLAPSED_KEY);
  const [feedCollapsed, setFeedCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(feedStorageKey) === '1';
    } catch {
      return false;
    }
  });
  const setFeedHidden = useCallback((hidden: boolean) => {
    setFeedCollapsed(hidden);
    try {
      window.localStorage.setItem(feedStorageKey, hidden ? '1' : '0');
    } catch {
      // Storage can be blocked; the choice still holds for this visit.
    }
  }, [feedStorageKey]);

  // docs/56 P1-07: reviewing someone is a manager touch on the server as it
  // happens, so it does not depend on ending (sealing) the round. A restored
  // round was recorded when it first happened; only new reviews are sent.
  const { mutateAsync: recordReviews } = useRecordStandupReviews();
  const reviewInFlight = useRef(false);
  const [reviewError, setReviewError] = useState(false);
  const [retryReviews, setRetryReviews] = useState(0);
  const recordedAnyRef = useRef(false);
  useEffect(() => {
    const pending = session.reviewed.filter((id) => !session.acknowledged?.includes(id));
    if (!ownsRound || reviewInFlight.current || reviewError || pending.length === 0) return;
    reviewInFlight.current = true;
    recordedAnyRef.current = true;
    const reviewedAt = Object.fromEntries(pending.map((id) => [id, session.reviewTimes?.[id] ?? session.startedAt]));
    void recordReviews({ date, accountIds: pending, reviewedAt }).then((result) => {
      reviewInFlight.current = false;
      dispatch({ type: 'acknowledge', ids: result.recorded });
      if (result.recorded.length !== pending.length) setReviewError(true);
    }, () => { reviewInFlight.current = false; setReviewError(true); });
  }, [session.reviewed, session.acknowledged, session.reviewTimes, session.startedAt, date, recordReviews, ownsRound, reviewError, retryReviews, dispatch]);
  const retryReviewWrites = useCallback(() => { setReviewError(false); setRetryReviews((value) => value + 1); }, []);
  useEffect(() => {
    window.addEventListener('online', retryReviewWrites);
    return () => window.removeEventListener('online', retryReviewWrites);
  }, [retryReviewWrites]);

  const foundIndex = ordered.findIndex((entry) => entry.developer.accountId === currentId);
  const devIndex = foundIndex >= 0 ? foundIndex : 0;
  const day = ordered[devIndex];
  const accountId = day?.developer.accountId;
  const openTasks = useMemo(() => openTasksFor(day), [day]);
  const doneToday = useMemo(() => doneTodayFor(day), [day]);
  const stats = useMemo(() => (day ? dayStats(day, date) : null), [day, date]);
  const taskIndex = Math.max(0, openTasks.findIndex((task) => task.taskKey === selectedTaskKey));
  const focusedTask = openTasks[taskIndex];
  const setTaskIndex = (index: number) => {
    const taskKey = openTasks[index]?.taskKey;
    setSelectedTaskKey(taskKey);
    dispatch({ type: 'patch', patch: { taskKey } });
  };
  const suggestion = day?.statusSuggestion;
  const pickerTasks: TaskPickerTask[] = openTasks.map((task) => ({ taskKey: task.taskKey, title: task.title }));
  const isFlagged = accountId ? flagged.has(accountId) : false;
  // docs/56 P1-04: solo / non-participating people get "note" wording and no check-in judgement.
  const dayUsesCheckIn = useCallback((entry: TrackerDeveloperDay) => usesCheckIns(teamMode, entry.participates), [teamMode]);
  const noteWording = day ? !dayUsesCheckIn(day) : false;
  const noteDraft = accountId ? session.noteDrafts?.[accountId] : undefined;
  const checkInText = noteDraft?.text ?? '';
  const checkInVisibility = noteDraft?.visibility ?? 'shared';
  const changeNote = (updates: { text?: string; visibility?: TrackerCheckInVisibility }) => {
    if (!accountId || noteDraft?.submitted) return;
    dispatch({ type: 'note_draft', accountId, draft: { text: '', visibility: 'shared', requestId: crypto.randomUUID(), ...noteDraft, ...updates } });
  };
  const setCheckInText = (text: string) => changeNote({ text });
  const setCheckInVisibility = (visibility: TrackerCheckInVisibility) => changeNote({ visibility });

  const feed = useStandupFeed(accountId);
  // Load everyone else's feed up front, nearest first and next before previous, so no switch waits on the
  // network. They are few (a team) and small; ones loaded recently are not requested again as the cursor moves.
  usePrefetchStandupFeeds(
    ordered.flatMap((_, distance) => (distance === 0 ? [] : [ordered[devIndex + distance], ordered[devIndex - distance]]))
      .flatMap((entry) => (entry ? [entry.developer.accountId] : [])),
    view === 'person',
  );
  const [feedForcedOpen, setFeedForcedOpen] = useState<string | null>(null);
  // The panel's width follows whether this person has changes. While their feed is still loading it keeps the
  // previous person's state, so it never opens (skeleton) and then collapses — or the reverse — mid-switch.
  const feedSettled = feed.data !== undefined || feed.isError;
  const lastFeedHidden = useRef(false);
  const feedHidden = feedCollapsed || (feedSettled ? feedForcedOpen !== accountId && feed.data?.entries.length === 0 : lastFeedHidden.current);
  useEffect(() => {
    if (feedSettled) lastFeedHidden.current = feedHidden;
  }, [feedSettled, feedHidden]);
  useEffect(() => {
    if (!ownsRound || !accountId || view !== 'person' || suspended || layer !== 'none' || !feed.data?.windowEnd || feed.data.truncated || feed.isError || feed.data.entries.length > 0) return;
    if (session.feedSeenThrough?.[accountId]) return;
    dispatch({ type: 'patch', patch: { feedSeenThrough: { ...session.feedSeenThrough, [accountId]: feed.data.windowEnd } } });
  }, [ownsRound, accountId, view, suspended, layer, feed.data, feed.isError, session.feedSeenThrough, dispatch]);
  const latestSession = useLatestStandupSession(layer === 'history');
  const activeKeys = useMemo(() => feedActiveTaskKeys(feed.data?.entries ?? []), [feed.data]);
  const statusUpdate = useStatusUpdate(date);
  const addCheckIn = useAddCheckIn(date);
  const setCurrent = useSetCurrentItem(date);
  const reassign = useReassignTrackerItem(date);
  const updateTask = useUpdateTaskDetail(focusedTask?.taskKey);
  const developers = useDevelopers(date);

  // Resolve a stored accountId to a display name for the previous-round view —
  // board days first, then the full developer list for people off today's board.
  const nameFor = useCallback(
    (id: string) =>
      ordered.find((entry) => entry.developer.accountId === id)?.developer.displayName
      ?? (developers.data ?? []).find((dev) => dev.accountId === id)?.displayName
      ?? id,
    [ordered, developers.data],
  );

  const log = useCallback((target: string, kind: StandupLogKind, taskKey?: string, detail?: string) => {
    dispatch({ type: 'log', entry: { accountId: target, kind, taskKey, detail, at: new Date().toISOString() } });
  }, [dispatch]);

  const focusRow = useCallback((taskKey?: string) => {
    window.setTimeout(() => {
      if (taskKey) taskRowRefs.current.get(taskKey)?.focus();
      if (taskKey) taskRowRefs.current.get(taskKey)?.scrollIntoView?.({ block: 'nearest' });
    }, 30);
  }, []);

  const closeLayer = useCallback(() => {
    setLayer('none');
    setPendingStatus(null);
    focusRow(focusedTask?.taskKey);
  }, [focusedTask?.taskKey, focusRow]);

  const goToDeveloper = useCallback(
    (id: string) => {
      if (session.request || !ownsRound) return;
      const target = ordered.find((entry) => entry.developer.accountId === id);
      if (!target) return;
      // docs/50 S2: leaving someone counts as reviewing them; jumps don't mark the skipped.
      if (view === 'person' && accountId && id !== accountId) dispatch({ type: 'review', accountId, at: new Date().toISOString() });
      setCurrentId(id);
      setSelectedTaskKey(undefined);
      setView('person');
      dispatch({ type: 'patch', patch: { currentId: id, taskKey: undefined, view: 'person' } });
      setAnnouncement(
        `${target.developer.displayName} — ${openTasksFor(target).length} open tasks, status ${STATUS_LABELS[target.status]}`,
      );
    },
    [ordered, view, accountId, dispatch, session.request, ownsRound],
  );

  const openWrapUp = useCallback(() => {
    if (session.request) { setView('wrapup'); return; }
    if (view === 'person' && accountId) dispatch({ type: 'review', accountId, at: new Date().toISOString() });
    setView('wrapup');
    dispatch({ type: 'patch', patch: { currentId: accountId, view: 'wrapup' } });
    setLayer('none');
    setAnnouncement('Standup wrap-up');
  }, [view, accountId, dispatch, session.request]);

  const moveDeveloper = useCallback(
    (delta: number) => {
      if (!ordered.length) return;
      if (view === 'wrapup') {
        if (session.request) return;
        if (delta < 0) {
          setView('person');
          dispatch({ type: 'patch', patch: { view: 'person' } });
          if (day) setAnnouncement(day.developer.displayName);
        }
        return;
      }
      const next = devIndex + delta;
      if (next < 0) return;
      if (next >= ordered.length) {
        openWrapUp();
        return;
      }
      goToDeveloper(ordered[next]!.developer.accountId);
    },
    [ordered, view, day, devIndex, openWrapUp, goToDeveloper, session.request, dispatch],
  );

  const moveTask = useCallback(
    (delta: number) => {
      if (!openTasks.length) return;
      const taskKey = openTasks[Math.min(Math.max(taskIndex + delta, 0), openTasks.length - 1)]?.taskKey;
      setSelectedTaskKey(taskKey);
      dispatch({ type: 'patch', patch: { taskKey } });
      focusRow(taskKey);
    },
    [openTasks, taskIndex, dispatch, focusRow],
  );

  const focusTaskByKey = useCallback(
    (taskKey: string) => {
      const index = openTasks.findIndex((task) => task.taskKey === taskKey);
      if (index < 0) {
        onOpenTask(taskKey);
        return;
      }
      setSelectedTaskKey(taskKey);
      dispatch({ type: 'patch', patch: { taskKey } });
      focusRow(taskKey);
    },
    [openTasks, onOpenTask, focusRow, dispatch],
  );

  const openStatusDialog = useCallback((status: TrackerDeveloperStatus, preselect: string[] = []) => {
    setPendingStatus(status);
    setStatusPreselect(preselect);
    setLayer('status');
  }, []);

  const handleStatusSelect = useCallback(
    (status: TrackerDeveloperStatus) => {
      if (!day || status === day.status) return;
      if (DIALOG_STATUSES.includes(status)) {
        openStatusDialog(status, focusedTask ? [focusedTask.taskKey] : []);
        return;
      }
      const target = day.developer.accountId;
      statusUpdate.mutate(
        { accountId: target, status },
        {
          onSuccess: () => log(target, 'status', undefined, STATUS_LABELS[status]),
          onError: (error) => addToast(error.message, 'error'),
        },
      );
    },
    [day, focusedTask, openStatusDialog, statusUpdate, log, addToast],
  );

  const submitCheckIn = async () => {
    const summary = checkInText.trim();
    if (!day || !summary || !noteDraft || notePendingRef.current.has(day.developer.accountId)) return;
    const target = day.developer.accountId;
    // Notes (non-participating people) are never developer-facing, so stay shared.
    const isPrivate = (noteDraft.submitted || !noteWording) && checkInVisibility === 'private';
    const taskKeys = noteDraft.taskKeys ?? taskKeysForSubmit([], summary, pickerTasks);
    const snapshot = { ...noteDraft, submitted: true, taskKeys, visibility: isPrivate ? 'private' as const : 'shared' as const };
    dispatch({ type: 'note_draft', accountId: target, draft: snapshot });
    notePendingRef.current.add(target);
    setNotePending(target);
    try {
      await addCheckIn.mutateAsync({ accountId: target, summary, requestId: snapshot.requestId, ...(isPrivate ? { visibility: 'private' as const } : { taskKeys }) });
      dispatch({ type: 'note_saved', accountId: target, requestId: snapshot.requestId });
      log(target, 'checkin');
      if (liveContext.current.currentId === target && liveContext.current.layer === 'checkin') closeLayer();
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Note not acknowledged. Retry to confirm it.', 'error');
    } finally {
      notePendingRef.current.delete(target);
      setNotePending(null);
    }
  };

  const copySummary = useCallback(() => {
    const text = buildStandupSummary({ date, days: ordered, session, usesCheckIn: dayUsesCheckIn });
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      addToast('Clipboard is unavailable in this browser.', 'error');
      return;
    }
    write.then(
      () => addToast({ type: 'success', title: 'Standup summary copied' }),
      () => addToast('Could not copy the summary.', 'error'),
    );
  }, [date, ordered, session, dayUsesCheckIn, addToast]);

  /**
   * docs/50 v2: "End standup" seals the round — one durable session record
   * (which also anchors the next "since last standup" feed), a follow-up task
   * per flagged person created server-side, and — when the wrap-up option is
   * on — the summary appended to the day's standup note (Notes → Standups),
   * kept apart from the personal scratchpad. The client session is cleared so
   * the next standup starts fresh; Esc/Exit still leaves without sealing.
   */
  const endStandup = useCallback(async () => {
    if (sealingRef.current || !ownsRound) return;
    if (session.reviewed.some((id) => !session.acknowledged?.includes(id))) {
      setFinishError('Visits are not yet saved. Retry the pending review writes before finishing.');
      return;
    }
    if (Object.values(session.noteDrafts ?? {}).some((draft) => draft.text.trim()) || taskDrafts.length) {
      setFinishError('There is unsent work. Save or clear the drafts before finishing.');
      return;
    }
    // Ending an untouched session is just exit — an empty seal would anchor
    // everyone's feed to a meaningless timestamp.
    if (!session.reviewed.length && !session.flagged.length && !session.log.length) {
      onClose();
      return;
    }
    setSealing(true);
    sealingRef.current = true;
    setFinishError('');
    try {
      const summary = buildStandupSummary({ date, days: ordered, session, usesCheckIn: dayUsesCheckIn });
      const request = session.request ?? {
        date,
        startedAt: session.startedAt ?? new Date().toISOString(),
        reviewed: session.reviewed,
        feedSeenThrough: session.feedSeenThrough,
        flagged: session.flagged,
        ...(session.flagReasons && { flagReasons: session.flagReasons }),
        log: session.log,
        summary,
        requestId: session.roundId,
      };
      dispatch({ type: 'patch', patch: { request } });
      const result = session.receipt ?? await api.post<RecordStandupSessionResponse>('/team-tracker/standup/session', request);
      dispatch({ type: 'patch', patch: { receipt: result } });
      if (saveToNote) {
        try {
          await api.post(`/notes/${encodeURIComponent(date)}/append`, {
            text: request.summary,
            requestId: session.roundId,
            kind: 'standup',
          });
        } catch {
          setFinishError('Round saved. The Notes archive was not acknowledged. Retry the archive, or untick "Add summary to Notes" to finish without it; the round and follow-ups will not be saved again.');
          return;
        }
      }
      // Clear storage synchronously before unmounting — a dispatch alone races
      // with onClose(): the save effect may never run for the empty session,
      // leaving the sealed round resumable on the next entry.
      clear();
      for (const key of ['team-tracker', 'tasks', 'daily-notes', 'today']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      const followUps = result.followUps.length;
      addToast(
        `Standup recorded${followUps ? ` — ${followUps} follow-up${followUps === 1 ? '' : 's'} created` : ''}`,
        'success',
      );
      onClose();
    } catch (error) {
      setFinishError('Finish was not acknowledged. Retry the same round to confirm it was saved.');
      addToast(error instanceof Error ? error.message : 'Could not end standup', 'error');
    } finally {
      setSealing(false);
      sealingRef.current = false;
    }
  }, [ownsRound, saveToNote, date, ordered, session, taskDrafts.length, dayUsesCheckIn, clear, dispatch, queryClient, addToast, onClose]);

  // ── Actions: shared by the keymap and the action bar (S7) ──────────────
  const actions = {
    update: () => composerApi.current?.expand(),
    togglePrivate: () => composerApi.current?.togglePrivate(),
    setCurrent: () => {
      if (!focusedTask || !accountId) return;
      const { taskKey } = focusedTask;
      const target = accountId;
      setCurrent.mutate(taskKey, {
        onSuccess: () => log(target, 'current', taskKey),
        onError: (error) => addToast(error.message, 'error'),
      });
    },
    done: () => {
      if (!focusedTask || !accountId) return;
      const { taskKey } = focusedTask;
      const target = accountId;
      updateTask.mutate(
        { status: 'done' },
        {
          onSuccess: () => {
            log(target, 'done', taskKey);
            addToast({ type: 'success', title: `${taskKey} done` });
          },
          onError: (error) => addToast(error.message, 'error'),
        },
      );
    },
    blocked: () => openStatusDialog('blocked', focusedTask ? [focusedTask.taskKey] : []),
    add: () => setLayer('capture'),
    checkIn: () => {
      setLayer('checkin');
      window.setTimeout(() => checkInRef.current?.focus(), 40);
    },
    reassign: () => {
      if (focusedTask) setLayer('reassign');
    },
    accept: () => {
      if (suggestion) openStatusDialog(suggestion.status, [suggestion.reasonTaskKey]);
    },
    open: () => {
      if (focusedTask) onOpenTask(focusedTask.taskKey);
    },
    // Flagging asks for an optional one-line reason; unflagging is immediate.
    flag: () => {
      if (!day) return;
      if (isFlagged) {
        dispatch({ type: 'toggle_flag', accountId: day.developer.accountId, at: new Date().toISOString() });
        setAnnouncement(`${day.developer.displayName} unflagged`);
        return;
      }
      dispatch({ type: 'flag', accountId: day.developer.accountId, at: new Date().toISOString() });
      setAnnouncement(`${day.developer.displayName} flagged. Follow-up will be saved at finish.`);
    },
    wrapUp: () => (view === 'wrapup' ? moveDeveloper(-1) : openWrapUp()),
    help: () => setLayer('help'),
  };

  // Keyboard map (§6.2) — plain keys only, inactive while a field or a
  // higher layer owns input. Esc closes the top layer; at root it exits.
  // The listener reads the latest render's handlers through a ref so it is
  // bound once.
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => {});
  useLayoutEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent) => {
      if (event.defaultPrevented || suspended || !ownsRound || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (isCoveredByLaterLayer(rootRef.current) || document.querySelector('[aria-label="LeadOS Copilot"]')) return;
      const target = event.target as HTMLElement | null;
      const inField =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      if (event.key === 'Escape') {
        // Layer dialogs (status, capture, check-in) close themselves; the
        // root level is the only place Esc exits standup.
        if (layer === 'none' && !inField) {
          event.preventDefault();
          onClose();
        }
        return;
      }
      if (layer !== 'none' || inField) return;

      const run = (fn: () => void) => {
        event.preventDefault();
        fn();
      };

      if (view === 'wrapup') {
        switch (event.key) {
          case 'ArrowLeft':
            return run(() => moveDeveloper(-1));
          case 'w':
            return run(actions.wrapUp);
          case '?':
            return run(actions.help);
          case 'Enter':
            // Let a focused button handle its own Enter.
            if (target?.closest('button, a')) return;
            return run(() => void endStandup());
          default:
            return;
        }
      }

      if (event.key === 'Enter' && target?.closest('button, a')) return;
      if (session.request) return;

      // docs/54 K1: letters mean what they mean on Tasks and in the drawer —
      // e done, a assign, n new; people move on arrows only.
      switch (event.key) {
        case 'ArrowRight':
          return run(() => moveDeveloper(1));
        case 'ArrowLeft':
          return run(() => moveDeveloper(-1));
        case 'ArrowDown':
        case 'j':
          return run(() => moveTask(1));
        case 'ArrowUp':
        case 'k':
          return run(() => moveTask(-1));
        case 'u':
          return run(actions.update);
        case 'v':
          return run(actions.togglePrivate);
        case '.':
          if (focusedTask) run(actions.setCurrent);
          return;
        case 'e':
          if (focusedTask) run(actions.done);
          return;
        case 'b':
          return run(actions.blocked);
        case 'n':
          return run(actions.add);
        case 'c':
          return run(actions.checkIn);
        case 'a':
          if (focusedTask) run(actions.reassign);
          return;
        case 'y':
          if (suggestion) run(actions.accept);
          return;
        case 'f':
          return run(actions.flag);
        case 'w':
          return run(actions.wrapUp);
        case 'Enter':
          if (focusedTask) run(actions.open);
          return;
        case '?':
          return run(actions.help);
        default:
          return;
      }
    };
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const reviewedCount = ordered.filter((entry) => reviewed.has(entry.developer.accountId)).length;
  const progress = ordered.length ? reviewedCount / ordered.length : 0;
  const allReviewed = ordered.length > 0 && reviewedCount === ordered.length;

  const actionGroups: StandupActionGroup[] = [{ label: 'Standup', actions: [
    { keys: ['←'], label: 'Previous', onRun: () => moveDeveloper(-1), disabled: devIndex === 0 },
    { keys: ['→'], label: 'Next', onRun: () => moveDeveloper(1) },
    { keys: ['u'], label: 'Update', onRun: actions.update, disabled: !focusedTask },
    { keys: ['c'], label: 'Note', onRun: actions.checkIn },
    { keys: ['f'], label: isFlagged ? 'Unflag' : 'Flag', onRun: actions.flag, emphasis: isFlagged },
  ] }];

  if (!day || !stats || !ownsRound) {
    return createPortal(
      <div ref={rootRef} tabIndex={-1} className="standup-shell fixed inset-0 flex items-center justify-center" style={{ background: 'var(--bg-primary)' }} role="dialog" aria-modal="true" aria-label="Standup mode" data-testid="standup-mode">
        <div className="max-w-sm px-6 py-8 text-center">
          <h1 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>Standup</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>{!ownsRound ? 'Standup is open in another tab. Close it there to continue here.' : 'No people in this view.'}</p>
          <button type="button" onClick={onClose} className="mt-4 rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Exit
          </button>
        </div>
      </div>, document.body,
    );
  }

  return createPortal(
    <motion.div
      ref={rootRef}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="standup-shell fixed inset-0 flex flex-col outline-none"
      style={{ background: 'var(--bg-primary)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Standup mode"
      data-testid="standup-mode"
    >
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Top bar */}
      <header
        className="flex shrink-0 items-center gap-4 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}>
            <ArrowLeftRight size={14} />
          </div>
          <div>
            <h1 className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
              Standup
            </h1>
            <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {formatStandupDate(date)}
            </div>
          </div>
        </div>

        <div className="ml-2 hidden min-w-0 flex-1 items-center gap-3 sm:flex" data-testid="standup-progress">
          <div
            className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full"
            style={{ background: 'var(--bg-tertiary)' }}
            role="progressbar"
            aria-label="People visited"
            aria-valuemin={0}
            aria-valuemax={ordered.length}
            aria-valuenow={reviewedCount}
          >
            <motion.div
              className="h-full rounded-full"
              initial={false}
              animate={{ scaleX: progress }}
              transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 220, damping: 30 }}
              style={{ background: 'var(--accent)', transformOrigin: 'left' }}
            />
          </div>
          <span className="shrink-0 text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{reviewedCount}</span> of {ordered.length} visited
            {session.flagged.length > 0 && (
              <span style={{ color: 'var(--text-muted)' }}> · {session.flagged.length} flagged</span>
            )}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <TopButton onClick={() => setLayer('history')} label="Previous standup round">
            <History size={13} />
            <span className="hidden sm:inline">Last round</span>
          </TopButton>
          <TopButton onClick={actions.wrapUp} label="Review and finish" pressed={view === 'wrapup'} accent={allReviewed && view !== 'wrapup'}>
            <ListChecks size={13} />
            <span>Finish</span>
          </TopButton>
          <TopButton onClick={actions.help} label="Standup keyboard shortcuts">
            <Keyboard size={13} />
            <Kbd subtle>?</Kbd>
          </TopButton>
          <TopButton onClick={onClose} label="Exit standup mode">
            <X size={13} />
            <span className="hidden sm:inline">Exit</span>
            <Kbd subtle>Esc</Kbd>
          </TopButton>
        </div>
      </header>

      {storageFailed && <p role="alert" className="px-4 py-2 text-sm">Browser recovery is unavailable. Keep this page open until your work is saved.</p>}
      {!ownsRound && <div role="alert" className="px-4 py-2 text-sm">Standup is open in another tab. Close it there to continue here.</div>}
      {session.reviewed.some((id) => !session.acknowledged?.includes(id)) && (
        <div role="status" className="flex items-center gap-3 px-4 py-2 text-xs">
          {reviewError ? 'Visits not saved. Your progress is kept in this tab.' : 'Saving visits…'}
          {reviewError && <button type="button" className="ui-btn" onClick={retryReviewWrites}>Retry</button>}
        </div>
      )}
      {finishError && <p role="alert" className="px-4 py-2 text-sm">{finishError}</p>}

      <div className="flex min-h-0 flex-1">
        <StandupRail
          days={ordered}
          currentId={accountId ?? null}
          reviewed={reviewed}
          acknowledged={new Set(session.acknowledged ?? [])}
          flagged={flagged}
          wrapUpActive={view === 'wrapup'}
          onSelect={goToDeveloper}
          onWrapUp={openWrapUp}
        />

        <main className="min-w-0 flex-1 overflow-y-auto lg:overflow-hidden">
          {view === 'wrapup' ? (
            <div className="h-full overflow-y-auto">
              <StandupWrapUp
                days={ordered}
                session={session}
                taskDrafts={taskDrafts}
                onRecoverTask={(taskKey) => { setRecoverTaskKey(taskKey); setLayer('taskdraft'); }}
                onRecoverNote={(id) => { goToDeveloper(id); setLayer('checkin'); }}
                sealing={sealing}
                saveToNote={saveToNote}
                onSaveToNoteChange={setSaveToNote}
                onJump={goToDeveloper}
                onBack={() => moveDeveloper(-1)}
                onEnd={() => void endStandup()}
                onCopy={copySummary}
              />
            </div>
          ) : (
            <div className={`grid grid-cols-1 lg:h-full ${feedHidden ? 'lg:grid-cols-[minmax(0,1fr)_auto]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]'}`}>
              {/* No slide or fade on a person switch: a standup moves fast. The key resets scroll and local state. */}
              <div
                key={day.developer.accountId}
                className="min-w-0 px-5 py-5 lg:overflow-y-auto lg:px-6"
              >
                <div className="mx-auto max-w-[860px] space-y-5">
                  <StandupPersonHeader
                    day={day}
                    stats={stats}
                    position={devIndex + 1}
                    total={ordered.length}
                    flagged={isFlagged}
                    flagReason={accountId ? session.flagReasons?.[accountId] : undefined}
                    onFlagReasonChange={(reason) => dispatch({ type: 'patch', patch: { flagReasons: { ...session.flagReasons, [day.developer.accountId]: reason } } })}
                    onStatusSelect={handleStatusSelect}
                    onPrev={() => moveDeveloper(-1)}
                    onNext={() => moveDeveloper(1)}
                    onFocusCurrent={() => stats.current && focusTaskByKey(stats.current.taskKey)}
                    onAcceptSuggestion={actions.accept}
                    usesCheckIn={!noteWording}
                  />
                  <StandupTaskList
                    ownerName={day.developer.displayName}
                    tasks={openTasks}
                    doneToday={doneToday}
                    focusedIndex={Math.min(taskIndex, Math.max(openTasks.length - 1, 0))}
                    activeKeys={activeKeys}
                    registerRow={(taskKey, el) => {
                      if (el) taskRowRefs.current.set(taskKey, el);
                      else taskRowRefs.current.delete(taskKey);
                    }}
                    onFocusIndex={setTaskIndex}
                    onOpen={onOpenTask}
                    onAdd={actions.add}
                    composer={
                      focusedTask ? (
                        <TaskUpdateComposer
                          taskKey={focusedTask.taskKey}
                          person={{ accountId: day.developer.accountId, name: day.developer.displayName }}
                          mode="manager"
                          via="standup"
                          collapsed
                          placeholder={`Update ${focusedTask.taskKey} for ${day.developer.displayName}`}
                          registerComposer={(api) => {
                            composerApi.current = api;
                          }}
                          onPosted={(event) => log(event.accountId ?? day.developer.accountId, 'update', focusedTask.taskKey)}
                        />
                      ) : null
                    }
                  />
                </div>
              </div>

              <aside
                className={`min-w-0 border-t py-5 lg:flex lg:flex-col lg:overflow-hidden lg:border-l lg:border-t-0 ${feedHidden ? 'px-2' : 'px-5'}`}
                style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-secondary) 45%, transparent)' }}
              >
                {feedHidden ? (
                  <StandupFeedRail count={feed.data?.entries.length} onExpand={() => { setFeedHidden(false); setFeedForcedOpen(accountId ?? null); }} />
                ) : (
                  <StandupFeed
                    note={noteWording}
                    onReadThrough={() => {
                      if (!accountId || !feed.data?.windowEnd || session.feedSeenThrough?.[accountId] || suspended || layer !== 'none') return;
                      dispatch({ type: 'patch', patch: { feedSeenThrough: { ...session.feedSeenThrough, [accountId]: feed.data.windowEnd } } });
                    }}
                    data={feed.data}
                    isLoading={feed.isLoading}
                    isError={feed.isError}
                    onRetry={() => void feed.refetch()}
                    onSelectTask={focusTaskByKey}
                    onOpenTask={onOpenTask}
                    onCollapse={() => setFeedHidden(true)}
                  />
                )}
              </aside>
            </div>
          )}
        </main>
      </div>

      {view === 'person' && <StandupActionBar groups={actionGroups} />}

      {/* Layers */}
      <AnimatePresence>
        {layer === 'taskdraft' && recoverTaskKey && <LayerShell onClose={closeLayer} label={`Draft for ${recoverTaskKey}`}>
          <div className="p-4"><TaskUpdateComposer taskKey={recoverTaskKey} mode="manager" via="standup" autoFocus onPosted={(event) => {
            if (event.accountId) log(event.accountId, 'update', recoverTaskKey);
            closeLayer();
          }} /></div>
        </LayerShell>}
        {layer === 'capture' && (
          <LayerShell onClose={closeLayer} label={`Add a task for ${day.developer.displayName}`}>
            <CaptureBox
              assignee={{ accountId: day.developer.accountId, displayName: day.developer.displayName }}
              onClose={closeLayer}
              onCaptured={({ intent, taskKey }) => {
                if (intent === 'note') return;
                log(day.developer.accountId, intent === 'update' ? 'update' : 'added', taskKey);
              }}
            />
          </LayerShell>
        )}
        {layer === 'checkin' && (
          <LayerShell onClose={closeLayer} label={`${noteWording ? 'Note' : 'Check-in'} for ${day.developer.displayName}`}>
            <CheckInForm
              inputRef={checkInRef}
              note={noteWording}
              developerName={day.developer.displayName}
              visibility={checkInVisibility}
              onVisibilityChange={setCheckInVisibility}
              value={checkInText}
              pending={notePending === accountId}
              submitted={noteDraft?.submitted}
              onChange={setCheckInText}
              onSubmit={submitCheckIn}
              onCancel={closeLayer}
            />
          </LayerShell>
        )}
        {layer === 'reassign' && focusedTask && (
          <LayerShell onClose={closeLayer} label={`Reassign ${focusedTask.taskKey}`}>
            <ReassignList
              developers={(developers.data ?? []).filter((dev) => dev.accountId !== day.developer.accountId)}
              pending={reassign.isPending}
              onPick={(dev) => {
                const { taskKey } = focusedTask;
                const target = day.developer.accountId;
                reassign.mutate(
                  { itemId: taskKey, toAccountId: dev.accountId },
                  {
                    onSuccess: () => {
                      log(target, 'reassign', taskKey, dev.displayName);
                      closeLayer();
                    },
                    onError: (error) => addToast(error.message, 'error'),
                  },
                );
              }}
            />
          </LayerShell>
        )}
        {layer === 'help' && (
          <LayerShell onClose={closeLayer} label="Standup keyboard shortcuts">
            <KeyHelpGrid note={noteWording} />
          </LayerShell>
        )}
        {layer === 'history' && (
          <LayerShell onClose={closeLayer} label="Previous standup">
            <StandupHistory
              session={latestSession.data?.session}
              isLoading={latestSession.isLoading}
              isError={latestSession.isError}
              onRetry={() => void latestSession.refetch()}
              nameFor={nameFor}
            />
          </LayerShell>
        )}
      </AnimatePresence>

      {pendingStatus && (
        <StatusRationaleDialog
          status={pendingStatus}
          developerName={day.developer.displayName}
          developerParticipates={day.participates}
          tasks={pickerTasks}
          initialSelectedKeys={statusPreselect}
          isPending={statusUpdate.isPending}
          error={statusUpdate.error?.message}
          onClose={() => {
            if (!statusUpdate.isPending) {
              statusUpdate.reset();
              closeLayer();
            }
          }}
          onSubmit={({ rationale, taskKey, nextFollowUpAt, visibility }) => {
            const status = pendingStatus;
            const target = day.developer.accountId;
            statusUpdate.mutate(
              { accountId: target, status, rationale, taskKey, nextFollowUpAt, visibility },
              {
                onSuccess: () => {
                  log(target, status === 'blocked' ? 'blocked' : 'status', taskKey, STATUS_LABELS[status]);
                  statusUpdate.reset();
                  closeLayer();
                },
              },
            );
          }}
        />
      )}
    </motion.div>, document.body,
  );
}

function TopButton({
  onClick,
  label,
  pressed,
  accent,
  children,
}: {
  onClick: () => void;
  label: string;
  pressed?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--bg-tertiary)]"
      style={{
        color: pressed || accent ? 'var(--accent)' : 'var(--text-secondary)',
        border: `1px solid ${pressed || accent ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)'}`,
        background: pressed ? 'var(--accent-glow)' : undefined,
      }}
    >
      {children}
    </button>
  );
}
