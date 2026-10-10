import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist Variable', 'sans-serif'],
        mono: ['Geist Mono Variable', 'monospace'],
      },
      // docs/73 UXD-02: the only font sizes in the app (the landing page is exempt).
      fontSize: {
        meta: 'var(--fs-11)',
        ui: 'var(--fs-12)',
        body: 'var(--fs-13)',
        'title-sm': 'var(--fs-15)',
        title: 'var(--fs-19)',
        display: 'var(--fs-24)',
      },
      colors: {
        bg: {
          primary: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          tertiary: 'var(--bg-tertiary)',
          glow: 'var(--bg-glow)',
        },
        border: {
          DEFAULT: 'var(--border)',
          active: 'var(--border-active)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          placeholder: 'var(--text-placeholder)',
          disabled: 'var(--text-disabled)',
        },
        placeholder: 'var(--text-placeholder)',
        disabled: 'var(--text-disabled)',
        accent: {
          DEFAULT: 'var(--accent)',
          glow: 'var(--accent-glow)',
          solid: 'var(--accent-solid)',
        },
        'on-accent': 'var(--on-accent)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        danger: {
          DEFAULT: 'var(--danger)',
          muted: 'var(--danger-muted)',
        },
        info: 'var(--info)',
      },
      zIndex: {
        drawer: 'var(--z-drawer)',
        'drawer-stacked': 'var(--z-drawer-stacked)',
        header: 'var(--z-header)',
        copilot: 'var(--z-copilot)',
        dialog: 'var(--z-dialog)',
        'dialog-stacked': 'var(--z-dialog-stacked)',
        popover: 'var(--z-popover)',
        toast: 'var(--z-toast)',
      },
      animation: {
        'pulse-blocked': 'pulseBlocked 2s ease-in-out infinite',
        'glow-idle': 'glowIdle 2s ease-in-out infinite',
      },
      keyframes: {
        pulseBlocked: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        glowIdle: {
          '0%, 100%': { boxShadow: '0 0 4px rgba(245,158,11,0.3)' },
          '50%': { boxShadow: '0 0 12px rgba(245,158,11,0.6)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
