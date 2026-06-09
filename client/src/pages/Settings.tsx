import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import ThemeSwitcher from '../components/ThemeSwitcher';
import { useTheme } from '../contexts/ThemeContext';
import Avatar from '../components/Avatar';
import { Link } from 'react-router-dom';
import { Settings as SettingsIcon, Save } from 'lucide-react';

export default function Settings() {
  const { user, token, login } = useAuth();
  const { themeId } = useTheme();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleSaveTheme = async () => {
    if (!token || !user) return;

    setSaving(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('theme', themeId);

      const updated = await api.updateProfile(formData, token);

      const freshUser = {
        ...user,
        theme: updated.theme || themeId,
      };
      login(token, freshUser);

      setMessage({ type: 'ok', text: 'Тема сохранена!' });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message || 'Не удалось сохранить тему' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <SettingsIcon className="w-7 h-7 text-slate-700" />
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Настройки</h1>
      </div>

      {/* Profile editing link */}
      <div className="bg-white border border-slate-200 rounded-3xl p-7 mb-8">
        <h2 className="font-semibold text-xl mb-5">Профиль</h2>

        <div className="flex items-center gap-4 mb-6">
          <Avatar src={user?.avatar} alt={user?.username} size="lg" />
          <div>
            <div className="text-sm text-slate-500">@{user?.username}</div>
            <Link 
              to="/edit-profile" 
              className="mt-2 inline-flex items-center px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl transition"
            >
              Редактировать профиль и аватар
            </Link>
            <div className="text-xs text-slate-400 mt-2">Имя, био, загрузка и удаление аватара (возврат к dicebear)</div>
          </div>
        </div>
      </div>

      {/* Theme picker */}
      <div className="bg-white border border-slate-200 rounded-3xl p-7 mb-6">
        <h2 className="font-semibold text-lg mb-4">Тема</h2>
        <ThemeSwitcher compact />

        <button 
          onClick={handleSaveTheme} 
          disabled={saving} 
          className="mt-4 btn-primary flex items-center gap-2 px-5 py-2 text-white rounded-2xl text-sm font-semibold disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Сохраняем...' : 'Сохранить'}
        </button>

        {message && (
          <div className={`mt-3 text-sm px-4 py-2 rounded-xl ${message.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {message.text}
          </div>
        )}
      </div>

      {/* Casino privacy (kept functional, minimal text) */}
      <div className="bg-white border border-slate-200 rounded-3xl p-7">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={!!(user as any)?.casino_hide_balance}
            onChange={async (e: React.ChangeEvent<HTMLInputElement>) => {
              if (!token || !user) return;
              const hide = e.target.checked;
              try {
                const formData = new FormData();
                formData.append('casino_hide_balance', hide ? '1' : '0');
                const updated = await api.updateProfile(formData, token);
                const freshUser = {
                  ...user,
                  casino_hide_balance: updated?.casino_hide_balance ?? (hide ? 1 : 0),
                } as any;
                login(token, freshUser);
              } catch (err: any) {
                alert(err?.message || 'Не удалось сохранить');
              }
            }}
            className="w-5 h-5 accent-indigo-600"
          />
          <div className="font-medium text-sm">Скрывать баланс казино в профиле</div>
        </label>
      </div>
    </div>
  );
}
