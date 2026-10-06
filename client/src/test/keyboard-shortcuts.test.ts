import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Kbd } from '@/components/ui/Kbd';
import { formatShortcutKeys, globalShortcuts, pageShortcuts, shortcutPlatform, shouldIgnoreShortcutHelp } from '@/lib/keyboard-shortcuts';

afterEach(() => vi.unstubAllGlobals());

describe('keyboard shortcut descriptors', () => {
  it.each(['MacIntel', 'iPad', 'Win32', 'Linux x86_64', ''])('maps keys for %s without requiring browser platform APIs', (platform) => {
    vi.stubGlobal('navigator', { platform });
    const mac = /Mac|iPad/.test(platform);
    expect(shortcutPlatform()).toBe(mac ? 'mac' : 'other');
    expect(formatShortcutKeys('⌘⇧F / ⌥↑')).toBe(mac ? '⌘⇧F / ⌥↑' : 'Ctrl+Shift+F / Alt+↑');
    render(createElement(Kbd, null, '⌘K'));
    expect(screen.getByText(mac ? '⌘K' : 'Ctrl+K')).toBeInTheDocument();
  });

  it('uses platform hints and safely falls back without navigator', () => {
    vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' } });
    expect(shortcutPlatform()).toBe('mac');
    vi.stubGlobal('navigator', undefined);
    expect(shortcutPlatform()).toBe('other');
    expect(formatShortcutKeys('⌥ ↑')).toBe('Alt+ ↑');
    expect(formatShortcutKeys('⌘-click')).toBe('Ctrl+click');
  });

  it('advertises only available Copilot and real page shortcuts', () => {
    expect(globalShortcuts(false).keys.some(([, label]) => label === 'Toggle Copilot')).toBe(false);
    expect(globalShortcuts(true).keys).toContainEqual(['⌘ J', 'Toggle Copilot']);
    for (const page of ['work', 'settings', 'desk', 'unknown']) expect(pageShortcuts(page, 'solo')).toEqual([]);
    expect(pageShortcuts('tasks', 'solo').flatMap((group) => group.keys)).toContainEqual(['g → e', 'Meetings']);
    expect(pageShortcuts('team', 'solo').flatMap((group) => group.keys)).toContainEqual(['c', 'Note']);
    expect(pageShortcuts('team', 'collab').flatMap((group) => group.keys)).toContainEqual(['c', 'Check-in']);
    expect(pageShortcuts('today', 'solo').flatMap((group) => group.keys).some(([keys]) => keys === 'c')).toBe(false);
    expect(pageShortcuts('notes', 'solo').flatMap((group) => group.keys)).toContainEqual(['⌘⇧E', 'A task']);
  });

  it('ignores editable descendants, composition and layers even when focus stays on their opener', () => {
    const editor = document.createElement('div'); editor.contentEditable = 'true'; editor.setAttribute('contenteditable', 'true');
    const child = document.createElement('span'); editor.append(child); document.body.append(editor);
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true });
    child.addEventListener('keydown', (e) => expect(shouldIgnoreShortcutHelp(e)).toBe(true));
    child.dispatchEvent(event); editor.remove();
    expect(shouldIgnoreShortcutHelp(new KeyboardEvent('keydown', { key: '?', isComposing: true }))).toBe(true);
    const menu = document.createElement('div'); menu.dataset.popoverLayer = ''; document.body.append(menu);
    expect(shouldIgnoreShortcutHelp(new KeyboardEvent('keydown', { key: '?' }))).toBe(true);
    menu.remove();
    expect(shouldIgnoreShortcutHelp(new KeyboardEvent('keydown', { key: '?' }))).toBe(false);
  });
});
