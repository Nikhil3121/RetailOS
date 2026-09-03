import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Titlebar toggle that flips the app between the dark default and a light
 * preview. Preference is persisted in localStorage so it survives reloads.
 *
 * LIGHT IS THE DEFAULT. A shop floor is bright: dark surfaces catch glare and
 * translucency lowers contrast exactly where money is displayed. Dark stays a
 * deliberate choice for evening use.
 *
 * The switch sets `data-theme="dark"` on <html>; both palettes are token sets
 * in styles/index.css, so this component only owns the state.
 */

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'retailos.theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

export function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  // Keep the DOM in sync with state, and persist across reloads.
  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const isLight = theme === 'light';

  return (
    <button
      type="button"
      onClick={toggle}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-white/5 text-slate-300 transition hover:border-border-strong hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cobalt-500/40"
    >
      {isLight ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </button>
  );
}
