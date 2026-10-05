import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { getLocalTimeZone } from '@/lib/utils';
import type {
  PlacementBulkRequest,
  PlacementBulkResponse,
  PlacementPreview,
  PlacementPreviewRequest,
  Project,
  ProjectDetail,
  ProjectFacts,
  ProjectTrack,
  ProjectWrite,
} from '@/types';
export function useProjects(today: string, archived = false) {
  const scope = useAuthScopeKey();
  return useQuery({
    queryKey: ['projects', scope, today, archived],
    queryFn: () =>
      api.get<{ projects: (Project & { facts: ProjectFacts })[] }>(
        `/projects?today=${today}&archived=${archived}&tz=${encodeURIComponent(getLocalTimeZone() ?? '')}`,
      ),
  });
}
export function useProject(id: number | undefined, today: string) {
  const scope = useAuthScopeKey();
  return useQuery({
    queryKey: ['project', scope, id, today],
    queryFn: () =>
      api.get<ProjectDetail>(`/projects/${id}?today=${today}&tz=${encodeURIComponent(getLocalTimeZone() ?? '')}`),
    enabled: Boolean(id),
    retry: false,
  });
}
export function useProjectWrites() {
  const qc = useQueryClient();
  const scope = useAuthScopeKey();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  return useMutation({
    mutationFn: (input: { id?: number; projectId?: number; track?: boolean; changes: ProjectWrite }) => {
      const url = input.track
        ? input.id
          ? `/project-tracks/${input.id}`
          : `/projects/${input.projectId}/tracks`
        : input.id
          ? `/projects/${input.id}`
          : '/projects';
      return input.id
        ? api.patch<Project | ProjectTrack>(url, input.changes)
        : api.post<Project | ProjectTrack>(url, input.changes);
    },
    onMutate: () => scope,
    onSuccess: (_response, _variables, submittedScope) => {
      if (scopeRef.current === submittedScope) invalidateProjects(qc, submittedScope);
    },
  });
}
export function invalidateProjects(qc: ReturnType<typeof useQueryClient>, scope: string) {
  for (const key of ['projects', 'project', 'tasks', 'task-detail', 'task-view-counts', 'today'])
    void qc.invalidateQueries({ queryKey: [key, scope] });
}
export function usePlacementWrites() {
  const qc = useQueryClient();
  const scope = useAuthScopeKey();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  return useMutation({
    mutationFn: (input: PlacementBulkRequest) => api.post<PlacementBulkResponse>('/task-placements/bulk', input),
    onMutate: () => scope,
    onSuccess: (_response, _variables, submittedScope) => {
      if (scopeRef.current === submittedScope) invalidateProjects(qc, submittedScope);
    },
  });
}
export const previewPlacement = (input: PlacementPreviewRequest) =>
  api.post<PlacementPreview>('/task-placements/preview', input);
