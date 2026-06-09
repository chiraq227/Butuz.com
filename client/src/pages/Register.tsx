import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

export default function Register() {
  const [form, setForm] = useState({
    username: '',
    email: '',
    display_name: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    if (form.password.length < 6) {
      setError('Пароль должен быть минимум 6 символов');
      return;
    }

    setLoading(true);

    try {
      const res = await api.register({
        username: form.username,
        email: form.email,
        password: form.password,
        display_name: form.display_name || undefined,
      });
      login(res.token, res.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen auth-container flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
              <span className="text-white font-bold text-3xl">Б</span>
            </div>
            <span className="text-4xl font-bold logo-gradient">Бутуз</span>
          </div>
          <p className="text-slate-500 text-sm">Регистрация</p>
        </div>

        <div className="bg-white shadow-xl shadow-slate-200 rounded-3xl p-8">
          <h1 className="text-2xl font-semibold mb-6">Регистрация</h1>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Имя пользователя</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => update('username', e.target.value)}
                  className="input w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                  placeholder="butuz"
                  required
                  minLength={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Отображаемое имя</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={(e) => update('display_name', e.target.value)}
                  className="input w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                  placeholder="Бутуз"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                className="input w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Пароль</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                className="input w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                placeholder="Минимум 6 символов"
                required
                minLength={6}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Подтвердите пароль</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => update('confirmPassword', e.target.value)}
                className="input w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3.5 text-white font-semibold rounded-2xl disabled:opacity-60 mt-2"
            >
              {loading ? 'Создаём аккаунт...' : 'Зарегистрироваться'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-600 mt-6">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-indigo-600 hover:underline font-medium">
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
