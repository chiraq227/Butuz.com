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
  { id: 'dark', name: 'Тёмная', description: 'Тёмная тема', mode: 'dark', icon: '🌙', primary: '#818cf8', primaryDark: '#6366f1', accent: '#c084fc', gradient: '135deg, #818cf8 0%, #c084fc 100%' },
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
