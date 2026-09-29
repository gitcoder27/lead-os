import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthScopeKey } from '@/context/AuthContext';
import { api } from '@/lib/api';
import type { Contact, ContactListResponse, CreateContactRequest } from '@/types';

/** docs/57 §2 (P3-03): the manager's private external contacts (people a task can wait on). */
export function useContacts(options: { enabled?: boolean } = {}) {
  const scope = useAuthScopeKey();
  return useQuery<Contact[]>({
    queryKey: ['contacts', scope],
    queryFn: async () => (await api.get<ContactListResponse>('/contacts')).contacts,
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContactRequest) => api.post<Contact>('/contacts', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
