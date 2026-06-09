import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { themes, getTheme, type Theme } from '../lib/themes';

interface ThemeContextType {
  theme: Theme;
  themeId: string;
  setTheme: (id: string) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children, initialTheme = 'default' }: { children: ReactNode; initialTheme?: string }) {
  const [themeId, setThemeId] = useState<string>(initialTheme);

  const applyTheme = (id: string) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', id);

    // Toggle Tailwind's "dark" class (for any dark: variants still in use)
    const isDarkMode = id === 'dark' || id.startsWith('dark');
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Directly set surface variables on :root for immediate reliable switch
    // (complements the CSS attribute rules)
    const themeObj = getTheme(id);
    const isDark = themeObj.mode === 'dark';

    if (isDark) {
      root.style.setProperty('--bg', '#0f172a');
      root.style.setProperty('--card', '#1e2937');
      root.style.setProperty('--text-primary', '#f1f5f9');
      root.style.setProperty('--text-secondary', '#cbd5e1');
      root.style.setProperty('--text-muted', '#94a3b8');
      root.style.setProperty('--border', '#334155');
      root.style.setProperty('--input-bg', '#1e2937');
      root.style.setProperty('--hover-bg', '#334155');
      root.style.setProperty('--sidebar-bg', '#1e2937');

      // Game table / felt backgrounds (immersive dark)
      root.style.setProperty('--game-felt', '#0b1220');
      root.style.setProperty('--game-felt2', '#111c2e');
      root.style.setProperty('--game-border', '#1f2a44');
      root.style.setProperty('--game-text', '#f1f5f9');
      root.style.setProperty('--game-chip', 'rgba(255,255,255,0.1)');
      root.style.setProperty('--game-sub-bg', 'rgba(0,0,0,0.2)');
    } else {
      root.style.setProperty('--bg', '#f8fafc');
      root.style.setProperty('--card', '#ffffff');
      root.style.setProperty('--text-primary', '#0f172a');
      root.style.setProperty('--text-secondary', '#475569');
      root.style.setProperty('--text-muted', '#64748b');
      root.style.setProperty('--border', '#e2e8f0');
      root.style.setProperty('--input-bg', '#f1f5f9');
      root.style.setProperty('--hover-bg', '#f1f5f9');
      root.style.setProperty('--sidebar-bg', '#ffffff');

      // Game table / felt backgrounds - light on light theme, dark on dark
      root.style.setProperty('--game-felt', '#f0fdf4');
      root.style.setProperty('--game-felt2', '#dcfce7');
      root.style.setProperty('--game-border', '#4ade80');
      root.style.setProperty('--game-text', '#0f172a');
      root.style.setProperty('--game-chip', 'rgba(15,23,42,0.06)');
      root.style.setProperty('--game-sub-bg', 'rgba(15,23,42,0.04)');
    }

    // Store immediately for fast reloads
    try { localStorage.setItem('butuz_theme', id); } catch (_) {}
  };

  const setTheme = (id: string) => {
    const valid = themes.some(t => t.id === id) ? id : (id && (id === 'dark' || id.startsWith('dark')) ? 'dark' : 'default');
    setThemeId(valid);
    applyTheme(valid);
  };

  // Normalize legacy theme ids (e.g. old colored themes like "ocean" or "dark-ocean")
  function normalizeThemeId(id: string | null | undefined): string {
    if (!id) return 'default';
    if (themes.some(t => t.id === id)) return id;
    if (id === 'dark' || id.startsWith('dark')) return 'dark';
    return 'default';
  }

  // On mount: apply from localStorage or prop
  useEffect(() => {
    const saved = localStorage.getItem('butuz_theme');
    const toApply = normalizeThemeId(saved || initialTheme);
    setThemeId(toApply);
    applyTheme(toApply);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-apply if initialTheme from server changes (after login / user update)
  useEffect(() => {
    if (initialTheme && initialTheme !== themeId) {
      const normalized = normalizeThemeId(initialTheme);
      setThemeId(normalized);
      applyTheme(normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTheme]);

  const currentTheme = getTheme(themeId);

  return (
    <ThemeContext.Provider value={{ theme: currentTheme, themeId, setTheme, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback if used outside provider (during early render)
    return {
      theme: getTheme('default'),
      themeId: 'default',
      setTheme: (id: string) => {
        const root = document.documentElement;
        const normalized = (id === 'dark' || id.startsWith('dark')) ? 'dark' : (themes.some(t => t.id === id) ? id : 'default');
        root.setAttribute('data-theme', normalized);
        if (normalized === 'dark' || normalized.startsWith('dark')) {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
        localStorage.setItem('butuz_theme', normalized);
      },
      themes
    };
  }
  return ctx;
};
