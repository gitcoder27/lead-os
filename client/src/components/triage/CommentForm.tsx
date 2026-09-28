import { useState } from 'react';
import { useAddComment } from '@/hooks/useAddComment';
import { Send } from 'lucide-react';

interface CommentFormProps {
  issueKey: string;
}

export function CommentForm({ issueKey }: CommentFormProps) {
  const [body, setBody] = useState('');
  const addComment = useAddComment();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    addComment.mutate(
      { key: issueKey, body: body.trim() },
      { onSuccess: () => setBody('') }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-1.5 items-end">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a Jira comment…"
        rows={2}
        className="flex-1 px-3 py-2 rounded-lg text-[13px] resize-none focus:outline-none focus:ring-1 leading-relaxed"
        style={{
          background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          outlineColor: 'var(--accent)',
        }}
      />
      <button
        type="submit"
        disabled={addComment.isPending || !body.trim()}
        className="p-2 rounded-lg transition-colors duration-150 disabled:opacity-40"
        style={{ background: 'var(--accent-solid)', color: 'var(--on-accent)' }}
      >
        <Send size={13} />
      </button>
    </form>
  );
}
