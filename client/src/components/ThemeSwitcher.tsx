import { useTheme } from '../contexts/ThemeContext';
import { lightThemes, darkThemes } from '../lib/themes';

export default function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { themeId, setTheme } = useTheme();

  const light = lightThemes[0];
  const dark = darkThemes[0];
  const isDark = themeId === 'dark' || themeId.startsWith('dark');
  const current = isDark ? dark : light;

  return (
    <div>
      {!compact && (
        <div className="mb-3 text-sm font-medium text-slate-700">Тема оформления</div>
      )}

      <div className={`grid grid-cols-2 gap-3 ${compact ? 'max-w-[180px]' : ''}`}>
        {/* Light */}
        <button
          type="button"
          onClick={() => setTheme('default')}
          className={`group flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all focus:outline-none ${!isDark ? 'border-slate-900 ring-1 ring-offset-2 ring-offset-white ring-slate-300 bg-slate-50 dark:ring-offset-slate-900 dark:ring-slate-600' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-3xl shadow-sm"
            style={{ background: light.gradient }}
          >
            <span className="drop-shadow-sm">{light.icon}</span>
          </div>
          <span className={`text-sm font-medium ${!isDark ? 'text-slate-900' : 'text-slate-500 group-hover:text-slate-700'}`}>
            {light.name}
          </span>
        </button>

        {/* Dark */}
        <button
          type="button"
          onClick={() => setTheme('dark')}
          className={`group flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all focus:outline-none ${isDark ? 'border-slate-900 ring-1 ring-offset-2 ring-offset-white ring-slate-300 bg-slate-50 dark:ring-offset-slate-900 dark:ring-slate-600' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-3xl shadow-sm"
            style={{ background: dark.gradient }}
          >
            <span className="drop-shadow-sm">{dark.icon}</span>
          </div>
          <span className={`text-sm font-medium ${isDark ? 'text-slate-900' : 'text-slate-500 group-hover:text-slate-700'}`}>
            {dark.name}
          </span>
        </button>
      </div>

      {!compact && current && (
        <div className="mt-3 text-xs text-slate-400">
          {current.name}
        </div>
      )}
    </div>
  );
}
