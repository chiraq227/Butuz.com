import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

export default function Login() {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.login({ emailOrUsername, password });
      login(res.token, res.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen auth-container flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
              <span className="text-white font-bold text-3xl">Б</span>
            </div>
            <span className="text-4xl font-bold logo-gradient">Бутуз</span>
          </div>
          <p className="text-slate-600">Войдите в свою социальную сеть</p>
        </div>

        <div className="bg-white shadow-xl shadow-slate-200 rounded-3xl p-8">
          <h1 className="text-2xl font-semibold mb-6">Вход</h1>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email или имя пользователя</label>
              <input
                type="text"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                className="input w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                placeholder="username или email"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3.5 text-white font-semibold rounded-2xl disabled:opacity-60"
            >
              {loading ? 'Входим...' : 'Войти'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-600 mt-6">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-indigo-600 hover:underline font-medium">
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
