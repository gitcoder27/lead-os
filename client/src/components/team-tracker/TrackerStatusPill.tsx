import type { TrackerDeveloperStatus } from '@/types';
import { DevStatusMark } from '@/components/ui/DevStatus';

// docs/54 V6: the legacy Title-Case pill is retired; every surface renders the
// shared status mark. These names stay as aliases for existing imports.
export { STATUS_META, StatusDot, DevStatusMark as TrackerStatusMark } from '@/components/ui/DevStatus';

export function TrackerStatusPill({ status }: { status: TrackerDeveloperStatus; size?: 'sm' | 'md' }) {
  return <DevStatusMark status={status} emphasis />;
}
