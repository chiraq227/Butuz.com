// Simplified theme system: only light (default) and dark.
export interface Theme {
  id: string;
  name: string;
  description: string;
  mode: 'light' | 'dark';
  icon: string;
  primary: string;
  primaryDark: string;
  accent: string;
  gradient: string;
}

export const lightThemes: Theme[] = [
  { id: 'default', name: 'Светлая', description: 'Светлая тема', mode: 'light', icon: '☀️', primary: '#6366f1', primaryDark: '#4f46e5', accent: '#a855f7', gradient: '135deg, #6366f1 0%, #a855f7 100%' },
];

export const darkThemes: Theme[] = [
  { id: 'dark', name: 'Тёмная', description: 'Тёмная тема', mode: 'dark', icon: '🌙', primary: '#64748b', primaryDark: '#475569', accent: '#94a3b8', gradient: '135deg, #64748b 0%, #94a3b8 100%' },
];

export const themes: Theme[] = [...lightThemes, ...darkThemes];

export const defaultTheme = 'default';

export function getTheme(id: string | undefined | null): Theme {
  return themes.find(t => t.id === id) || themes[0];
}

export function isDarkTheme(id: string | undefined | null): boolean {
  const t = getTheme(id);
  return t.mode === 'dark';
}
