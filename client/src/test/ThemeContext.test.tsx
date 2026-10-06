import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { StrictMode } from 'react';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import indexHtml from '../../index.html?raw';

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span>{theme}</span>
      <button type="button" onClick={toggleTheme}>Toggle</button>
    </div>
  );
}

const renderProvider = () => render(<ThemeProvider><ThemeProbe /></ThemeProvider>);
const bootstrapScript = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const runBootstrap = () => {
  expect(bootstrapScript).toBeDefined();
  new Function(bootstrapScript!)();
};

let listeners: Set<() => void>;
let query: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

const changeDevice = (dark: boolean) => {
  act(() => {
    query.matches = dark;
    listeners.forEach((listener) => listener());
  });
};

const expectRootTheme = (theme: 'light' | 'dark') => {
  expect(document.documentElement).toHaveClass(theme, 'unrelated');
  expect(document.documentElement).not.toHaveClass(theme === 'dark' ? 'light' : 'dark');
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = 'unrelated';
  listeners = new Set();
  query = {
    matches: false,
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) => listeners.delete(listener)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => query));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Exercise the real head script as well as React so first paint and hydration agree.
describe.each([
  ['ThemeProvider', renderProvider],
  ['first-paint script', runBootstrap],
] as const)('%s resolution', (_name, initialize) => {
  it.each(['light', 'dark'] as const)('uses the %s device theme without persisting it', (theme) => {
    query.matches = theme === 'dark';
    const write = vi.spyOn(Storage.prototype, 'setItem');
    initialize();
    expectRootTheme(theme);
    expect(localStorage.getItem('theme')).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['light', 'dark'] as const)('restores saved %s over the opposite device theme', (theme) => {
    localStorage.setItem('theme', theme);
    query.matches = theme !== 'dark';
    initialize();
    expectRootTheme(theme);
  });

  it.each(['invalid', 'DARK', ''])('ignores invalid saved preference %j', (stored) => {
    localStorage.setItem('theme', stored);
    query.matches = true;
    initialize();
    expectRootTheme('dark');
    expect(localStorage.getItem('theme')).toBe(stored);
  });

  it('uses device preference when a storage read throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    query.matches = true;
    expect(initialize).not.toThrow();
    expectRootTheme('dark');
  });

  it('uses device preference when accessing localStorage itself throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Blocked'); });
    query.matches = true;
    expect(initialize).not.toThrow();
    expectRootTheme('dark');
  });

  it('falls back to light when preference APIs are missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(initialize).not.toThrow();
    expectRootTheme('light');
  });

  it('falls back to light when preference APIs throw', () => {
    vi.stubGlobal('matchMedia', () => { throw new Error('Unavailable'); });
    expect(initialize).not.toThrow();
    expectRootTheme('light');
  });
});

describe('ThemeProvider changes', () => {
  it('follows device changes until a manual choice, then persists only manual toggles', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    renderProvider();
    changeDevice(true);
    expect(screen.getByText('dark')).toBeInTheDocument();
    expectRootTheme('dark');
    changeDevice(false);
    expect(screen.getByText('light')).toBeInTheDocument();
    expectRootTheme('light');
    expect(write).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByText('dark')).toBeInTheDocument();
    expectRootTheme('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(listeners.size).toBe(0);
    changeDevice(true);
    changeDevice(false);
    expectRootTheme('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expectRootTheme('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(write.mock.calls).toEqual([['theme', 'dark'], ['theme', 'light']]);
  });

  it('keeps a saved preference when the device changes', () => {
    localStorage.setItem('theme', 'light');
    query.matches = true;
    renderProvider();
    changeDevice(false);
    changeDevice(true);
    expectRootTheme('light');
    expect(query.addEventListener).not.toHaveBeenCalled();
  });

  it.each(['write', 'access'] as const)('keeps rendering and toggling after storage %s fails', (failure) => {
    if (failure === 'write') {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    } else {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Blocked'); });
    }
    expect(renderProvider).not.toThrow();
    const toggle = screen.getByRole('button', { name: 'Toggle' });
    expect(() => fireEvent.click(toggle)).not.toThrow();
    expect(screen.getByText('dark')).toBeInTheDocument();
    expectRootTheme('dark');
    changeDevice(true);
    changeDevice(false);
    expectRootTheme('dark');
    expect(() => fireEvent.click(toggle)).not.toThrow();
    expect(screen.getByText('light')).toBeInTheDocument();
    expectRootTheme('light');
  });

  it('removes device listeners on unmount, including StrictMode remounts', () => {
    const { unmount } = render(<StrictMode><ThemeProvider><ThemeProbe /></ThemeProvider></StrictMode>);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
    expect(query.removeEventListener.mock.calls).toEqual(query.addEventListener.mock.calls);
    changeDevice(true);
    expectRootTheme('light');
  });
});
