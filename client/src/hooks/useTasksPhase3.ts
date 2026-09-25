import { useAuth } from '@/context/AuthContext';

/**
 * Phase 3 (P3 §0): the per-workspace `tasks_phase3_enabled` flag, delivered on
 * the auth session payload. With the flag off, every Phase 3 surface must
 * behave exactly as in Phase 2.
 */
export function useTasksPhase3(): boolean {
  return useAuth().features?.tasksPhase3 ?? false;
}
