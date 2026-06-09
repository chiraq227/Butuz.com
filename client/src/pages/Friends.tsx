import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useFollow } from '../contexts/FollowContext';
import { Users, UserPlus, UserMinus, Search } from 'lucide-react';

interface UserItem {
  id: number;
  username: string;
  display_name: string;
  avatar: string;
  bio?: string;
  followers_count?: number;
  following_count?: number;
}

export default function Friends() {
  const { user, token } = useAuth();
  const { isFollowing, follow, unfollow, refreshFollowing } = useFollow();

  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [followingList, setFollowingList] = useState<UserItem[]>([]); // renamed to avoid conflict with hook
  const [activeTab, setActiveTab] = useState<'discover' | 'following'>('discover');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [users, myFollowing] = await Promise.all([
        api.getUsers(token),
        api.getFollowing(token),
      ]);
      setAllUsers(users);
      setFollowingList(myFollowing);
    } catch (e) {
      console.error('Failed to load friends', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  // After any follow/unfollow action, also refresh the global context + lists
  const handleFollowToggle = async (target: UserItem) => {
    if (!token) return;
    setActionLoading(target.id);
    try {
      const currentlyFollowing = isFollowing(target.id);
      if (currentlyFollowing) {
        await unfollow(target.id);
      } else {
        await follow(target.id);
      }
      // Refresh the full lists for counts + the global set
      await Promise.all([loadData(), refreshFollowing()]);
    } catch (e) {
      alert('Не удалось выполнить действие');
    } finally {
      setActionLoading(null);
    }
  };

  // Filter for search (client side for discover)
  const filteredUsers = allUsers
    .filter(u => u.id !== user?.id)
    .filter(u =>
      !search ||
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.display_name.toLowerCase().includes(search.toLowerCase())
    );

  const currentList = activeTab === 'discover' ? filteredUsers : followingList;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-8 h-8 text-slate-700" />
          <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Друзья</h1>
        </div>
        <p className="text-slate-500">Подписывайтесь на интересных людей и смотрите их посты</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        <button
          onClick={() => setActiveTab('discover')}
          className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors ${
            activeTab === 'discover'
              ? 'border-indigo-500 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Все пользователи
        </button>
        <button
          onClick={() => setActiveTab('following')}
          className={`px-6 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'following'
              ? 'border-indigo-500 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Мои подписки
          <span className="px-1.5 py-0.5 text-xs rounded-full bg-slate-100">{followingList.length}</span>
        </button>
      </div>

      {/* Search (only on discover) */}
      {activeTab === 'discover' && (
        <div className="mb-5 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по имени или @username"
            className="input w-full pl-11 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm"
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-b-2 border-indigo-600 rounded-full" />
        </div>
      ) : currentList.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
          {activeTab === 'following' ? 'Вы пока ни на кого не подписаны.' : 'Никого не найдено.'}
        </div>
      ) : (
        <div className="space-y-3">
          {currentList.map((u) => {
            const followingThisUser = activeTab === 'following' ? true : isFollowing(u.id);
            const isSelf = u.id === user?.id;
            return (
              <div key={u.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4">
                <Link to={`/profile/${u.username}`}>
                  <Avatar src={u.avatar} alt={u.username} size="lg" />
                </Link>

                <div className="flex-1 min-w-0">
                  <Link to={`/profile/${u.username}`} className="font-semibold text-lg text-slate-900 hover:text-indigo-600 transition-colors">
                    {u.display_name}
                  </Link>
                  <div className="text-sm text-slate-500">@{u.username}</div>
                  {u.bio && <p className="mt-1 text-sm text-slate-600 line-clamp-1">{u.bio}</p>}

                  <div className="flex gap-4 mt-2 text-xs text-slate-500">
                    <span><span className="font-semibold text-slate-700">{u.followers_count ?? 0}</span> подписчиков</span>
                    <span><span className="font-semibold text-slate-700">{u.following_count ?? 0}</span> подписок</span>
                  </div>
                </div>

                {!isSelf && (
                  <button
                    onClick={() => handleFollowToggle(u)}
                    disabled={actionLoading === u.id}
                    className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all disabled:opacity-60 ${
                      followingThisUser
                        ? 'bg-slate-100 text-slate-700 hover:bg-red-50 hover:text-red-600'
                        : 'btn-primary text-white'
                    }`}
                  >
                    {followingThisUser ? (
                      <>
                        <UserMinus className="w-4 h-4" /> Отписаться
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" /> Подписаться
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
