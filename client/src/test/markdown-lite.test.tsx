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

  it('renders markdown tables', () => {
    render(
      <div>
        {renderMarkdownLite(
          '| Issue | Status |\n| --- | --- |\n| AM-12 | **Done** |\n| QA-9 | Open |',
        )}
      </div>,
    );

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Issue',
      'Status',
    ]);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'AM-12' })).toBeInTheDocument();
    expect(screen.getByText('Done').tagName).toBe('STRONG');
  });

  it('applies column alignment from the separator row', () => {
    render(
      <div>
        {renderMarkdownLite('| Left | Right |\n| :--- | ---: |\n| a | b |')}
      </div>,
    );

    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveStyle({ textAlign: 'left' });
    expect(cells[1]).toHaveStyle({ textAlign: 'right' });
  });

  it('renders a table directly following text in the same paragraph', () => {
    render(
      <div>
        {renderMarkdownLite('Here is the breakdown:\n| A | B |\n| --- | --- |\n| 1 | 2 |')}
      </div>,
    );

    expect(screen.getByText('Here is the breakdown:')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
  });

  it('keeps pipe text without a separator row as a paragraph', () => {
    render(<div>{renderMarkdownLite('either a | b works')}</div>);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('either a | b works')).toBeInTheDocument();
  });
});
