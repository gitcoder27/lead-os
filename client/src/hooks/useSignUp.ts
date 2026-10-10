import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { InviteCheckResponse, SignUpRequest } from '@/types';
export function useInvite(token: string | null) {
  return useQuery({ queryKey: ['auth-invite', token], queryFn: () => api.get<InviteCheckResponse>(`/auth/invite${token ? `?token=${encodeURIComponent(token)}` : ''}`), retry: false, staleTime: 60000, gcTime: 0, refetchOnWindowFocus: false });
}
export function useSignUp() {
  const { signUp } = useAuth();
  return useMutation({ mutationFn: (input: SignUpRequest) => signUp(input) });
}
