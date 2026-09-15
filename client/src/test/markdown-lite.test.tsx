import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderMarkdownLite } from '@/components/assistant/markdown-lite';

describe('renderMarkdownLite', () => {
  it('renders bold, lists, inline code, and links', () => {
    render(
      <div>
        {renderMarkdownLite('**bold text**\n\n- first\n- second\n\n`code` and [docs](https://example.com/x)')}
      </div>,
    );

    expect(screen.getByText('bold text').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['first', 'second']);
    expect(screen.getByText('code').tagName).toBe('CODE');
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders fenced code blocks', () => {
    render(<div>{renderMarkdownLite('try this:\n\n```ts\nconst x = 1;\n```')}</div>);
    expect(screen.getByText('const x = 1;').tagName).toBe('PRE');
  });

  it('renders issue keys as buttons that open the issue', () => {
    const onOpenIssue = vi.fn();
    render(<div>{renderMarkdownLite('Check AM-12 and QA-9 today', { onOpenIssue })}</div>);

    fireEvent.click(screen.getByRole('button', { name: 'AM-12' }));
    fireEvent.click(screen.getByRole('button', { name: 'QA-9' }));

    expect(onOpenIssue).toHaveBeenCalledWith('AM-12');
    expect(onOpenIssue).toHaveBeenCalledWith('QA-9');
  });

  it('leaves non-http links as plain text', () => {
    render(<div>{renderMarkdownLite('[click](javascript:alert(1))')}</div>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
