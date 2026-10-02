import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyReport } from '@/lib/report-clipboard';
import { reportMarkdownToHtml } from '@/lib/weekly-report';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('report clipboard', () => {
  it('offers both HTML and plain text and falls back when formatted writes are refused', async () => {
    const write = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Not allowed'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    let data: Record<string, Blob> = {};
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(value: Record<string, Blob>) {
          data = value;
        }
      },
    );
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } });
    expect(await copyReport('Plain', '<p>HTML</p>')).toBe('formatted');
    expect(Object.keys(data)).toEqual(['text/plain', 'text/html']);
    expect(data['text/html']?.type).toBe('text/html');
    expect(await copyReport('Plain', '<p>HTML</p>')).toBe('text');
    expect(writeText).toHaveBeenCalledWith('Plain');
  });
  it('escapes edited text rather than accepting embedded HTML', () => {
    expect(reportMarkdownToHtml('**<script>**\n\n- "A" & <img src=x>')).toBe(
      '<p><strong>&lt;script&gt;</strong></p><ul><li>&quot;A&quot; &amp; &lt;img src=x&gt;</li></ul>',
    );
  });
});
