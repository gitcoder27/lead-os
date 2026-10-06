import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggleTheme: () => {} });

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }
}

const readSavedTheme = (): Theme | null => {
  try {
    const stored = localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
};

const deviceThemeQuery = (): MediaQueryList | null => {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
  } catch {
    return null;
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readSavedTheme);
  const [deviceTheme, setDeviceTheme] = useState<Theme>(() =>
    deviceThemeQuery()?.matches ? 'dark' : 'light',
  );
  const theme = preference ?? deviceTheme;

  useLayoutEffect(() => {
    applyTheme(theme);
    if (preference === null) return;
    try {
      localStorage.setItem('theme', preference);
    } catch {
      // The explicit choice still works for this session when storage is blocked.
    }
  }, [theme, preference]);

  useLayoutEffect(() => {
    if (preference !== null) return;
    const query = deviceThemeQuery();
    if (!query) return;

    const followDevice = () => setDeviceTheme(query.matches ? 'dark' : 'light');
    followDevice();
    query.addEventListener?.('change', followDevice);
    return () => query.removeEventListener?.('change', followDevice);
  }, [preference]);

  const toggleTheme = () =>
    setPreference((previous) => (previous ?? deviceTheme) === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
