/** Formatted clipboard only: no external application or network write. */
export async function copyReport(markdown: string, html?: string): Promise<'formatted' | 'text'> {
  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([markdown], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return 'formatted';
    } catch {
      // Browsers can expose ClipboardItem but refuse HTML. Text still has a useful fallback.
    }
  }
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard is unavailable. Select and copy the edited text.');
  await navigator.clipboard.writeText(markdown);
  return 'text';
}
