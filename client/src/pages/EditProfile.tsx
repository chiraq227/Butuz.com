import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import Avatar from '../components/Avatar';
import { Save, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function EditProfile() {
  const { user, token, login } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Файл слишком большой. Максимум 5 МБ.');
      return;
    }

    setAvatarFile(file);
    setRemoveAvatar(false);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => {
    setRemoveAvatar(true);
    setAvatarFile(null);
    const defaultAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username}`;
    setAvatarPreview(defaultAvatar);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !user) return;

    setSaving(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('display_name', displayName.trim() || user.display_name);
      formData.append('bio', bio.trim());

      if (removeAvatar) {
        formData.append('remove_avatar', 'true');
      } else if (avatarFile) {
        formData.append('avatar', avatarFile);
      }

      const updated = await api.updateProfile(formData, token);

      const freshUser = {
        ...user,
        display_name: updated.display_name,
        bio: updated.bio,
        avatar: updated.avatar,
      };
      login(token, freshUser);

      setAvatarFile(null);
      setAvatarPreview(null);
      setRemoveAvatar(false);

      setMessage({ type: 'ok', text: 'Профиль успешно обновлён!' });
    } catch (e: any) {
      setMessage({ type: 'err', text: e.message || 'Не удалось сохранить' });
    } finally {
      setSaving(false);
    }
  };

  const defaultAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.username}`;

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
      <div className="mb-8 flex items-center gap-3">
        <Link to="/profile" className="text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Редактирование профиля</h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-7 mb-8">
        <h2 className="font-semibold text-xl mb-5">Аватар и информация</h2>

        <form onSubmit={handleSave} className="space-y-5">
          <div className="flex items-center gap-4 mb-6">
            <Avatar src={avatarPreview || user?.avatar} alt={user?.username} size="lg" />
            <div>
              <div className="text-sm text-slate-500">@{user?.username}</div>
              <div className="flex gap-3 mt-2">
                <label className="cursor-pointer text-xs bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-full hover:bg-indigo-200 transition">
                  Загрузить фото
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    className="hidden"
                  />
                </label>
                { (user?.avatar && !user.avatar.includes('dicebear')) || removeAvatar ? (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="text-xs text-red-600 hover:underline px-2"
                  >
                    Удалить аватар
                  </button>
                ) : null }
              </div>
              <div className="text-xs text-slate-400 mt-1">До 5 МБ</div>
              {avatarFile && <div className="text-xs text-emerald-600 mt-1">Выбран: {avatarFile.name}</div>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Отображаемое имя</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input w-full px-4 py-2.5 bg-white border border-slate-200 rounded-2xl"
              maxLength={60}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Биография / О себе</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              className="input w-full px-4 py-2.5 bg-white border border-slate-200 rounded-2xl resize-y"
              placeholder="Расскажите о себе..."
              maxLength={200}
            />
            <div className="text-right text-xs text-slate-400 mt-0.5">{bio.length}/200</div>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary flex items-center gap-2 px-6 py-2.5 text-white rounded-2xl font-semibold disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Сохраняем...' : 'Сохранить изменения'}
            </button>
          </div>

          {message && (
            <div className={`text-sm px-4 py-2 rounded-xl ${message.type === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {message.text}
            </div>
          )}
        </form>
      </div>

      <div className="text-center">
        <Link to="/profile" className="text-sm text-slate-500 hover:text-slate-700">← Вернуться в профиль</Link>
      </div>
    </div>
  );
}
