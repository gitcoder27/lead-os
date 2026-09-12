import { useDailyNoteSources } from '@/hooks/useDailyNotes';
import { NotesSourceLink } from './NotesSourceLink';

export function NotesItemSource({ itemId }: { itemId: number }) {
  const sources = useDailyNoteSources([itemId]);
  const source = sources.data?.find((entry) => entry.itemId === itemId);

  if (!source) {
    return null;
  }

  return (
    <div className="px-5 pt-3">
      <NotesSourceLink source={source} />
    </div>
  );
}
