import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import PostCard from '../components/PostCard';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useFollow } from '../contexts/FollowContext';
import { Calendar, MessageCircle } from 'lucide-react';
import { usePhotoViewer } from '../components/PhotoViewer';

interface ProfileUser {
  id: number;
  username: string;
  display_name: string;
  avatar: string;
  bio?: string;
  created_at: string;
  post_count: number;
  followers_count: number;
  following_count: number;
  is_following?: boolean;
  // Casino integration fields (from backend enrichment)
  casino_level?: number;
  casino_rating?: number;
  casino_vip?: boolean;
  casino_games_played?: number;
  casino_balance?: number;
  casino_bank_balance?: number;
  casino_hide_balance?: boolean;
}

interface Post {
  id: number;
  content: string;
  image?: string | null;
  created_at: string;
  like_count: number;
  user_liked: boolean;
  is_bookmarked?: boolean;
  is_pinned?: boolean;
  comment_count?: number;
  is_pinned?: boolean;
}

export default function Profile() {
  const { username } = useParams<{ username: string }>();
  const { user: currentUser, token } = useAuth();
  const { openPhoto } = usePhotoViewer();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { isFollowing, follow, unfollow, refreshFollowing } = useFollow();
  const [followLoading, setFollowLoading] = useState(false);

  const isOwnProfile = currentUser?.username === username;

  useEffect(() => {
    const load = async () => {
      if (!username) return;
      setLoading(true);
      try {
        const data = await api.getUserProfile(username, token || undefined);
        setProfile({
          id: data.id,
          username: data.username,
          display_name: data.display_name,
          avatar: data.avatar,
          bio: data.bio,
          created_at: data.created_at,
          post_count: Number(data.post_count) || 0,
          followers_count: Number(data.followers_count) || 0,
          following_count: Number(data.following_count) || 0,
          is_following: data.is_following,
          // Preserve casino fields so the integrated casino section renders
          casino_level: data.casino_level,
          casino_rating: data.casino_rating,
          casino_vip: data.casino_vip,
          casino_games_played: data.casino_games_played,
          casino_balance: data.casino_balance,
          casino_bank_balance: data.casino_bank_balance,
          casino_hide_balance: data.casino_hide_balance,
        });
        setPosts(data.posts || []);
      } catch (e: any) {
        setError(e.message || 'Пользователь не найден');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [username]);

  const handlePostDeleted = (postId: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    if (profile) {
      setProfile({ ...profile, post_count: Math.max(0, profile.post_count - 1) });
    }
  };

  const handleBookmarkChange = (postId: number, bookmarked: boolean) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, is_bookmarked: bookmarked } : p))
    );
  };

  const handlePinChange = (postId: number, isPinned: boolean) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, is_pinned: isPinned } : p))
    );
  };

  const handleFollowToggle = async () => {
    if (!profile || isOwnProfile) return;
    setFollowLoading(true);
    try {
      const currentlyFollowing = isFollowing(profile.id);
      if (currentlyFollowing) {
        await unfollow(profile.id);
      } else {
        await follow(profile.id);
      }
      // Re-fetch profile for accurate follower counts (the global isFollowing is already updated optimistically)
      const fresh = await api.getUserProfile(username!, token!);
      setProfile({
        id: fresh.id,
        username: fresh.username,
        display_name: fresh.display_name,
        avatar: fresh.avatar,
        bio: fresh.bio,
        created_at: fresh.created_at,
        post_count: Number(fresh.post_count) || 0,
        followers_count: Number(fresh.followers_count) || 0,
        following_count: Number(fresh.following_count) || 0,
        is_following: fresh.is_following, // keep for display if needed
        // Preserve casino fields so the integrated casino section renders
        casino_level: fresh.casino_level,
        casino_rating: fresh.casino_rating,
        casino_vip: fresh.casino_vip,
        casino_games_played: fresh.casino_games_played,
        casino_balance: fresh.casino_balance,
        casino_bank_balance: fresh.casino_bank_balance,
        casino_hide_balance: fresh.casino_hide_balance,
      });
      // Also make sure global list is in sync
      await refreshFollowing();
    } catch (e) {
      alert('Не удалось изменить подписку');
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-2xl mx-auto px-3 sm:px-4 py-8 flex justify-center">
        <div className="animate-spin h-8 w-8 border-b-2 border-indigo-600 rounded-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="w-full max-w-2xl mx-auto px-3 sm:px-4 py-8">
        <div className="bg-white border rounded-2xl p-8 text-center">
          <p className="text-red-600 mb-4">{error || 'Профиль не найден'}</p>
          <Link to="/" className="text-indigo-600 hover:underline">← Вернуться в ленту</Link>
        </div>
      </div>
    );
  }

  const joinDate = new Date(profile.created_at).toLocaleDateString('ru-RU', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="w-full max-w-2xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
      {/* Profile header */}
      <div className="bg-white border border-slate-200 rounded-3xl p-7 mb-6">
        <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center">
          <div 
            className="cursor-pointer group relative"
            onClick={() => openPhoto({ 
              src: profile.avatar, 
              alt: `Фото профиля ${profile.display_name}`, 
              user: {
                id: profile.id,
                username: profile.username,
                display_name: profile.display_name,
                avatar: profile.avatar,
              },
              type: 'avatar'
            })}
          >
            <Avatar src={profile.avatar} alt={profile.username} size="lg" className="ring-4 ring-slate-100 transition-transform group-hover:scale-105" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-full transition flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium bg-black/60 px-2 py-0.5 rounded">Открыть</span>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
                {profile.display_name}
              </h1>
              {isOwnProfile && (
                <span className="px-3 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
                  Вы
                </span>
              )}
              {isOwnProfile && (
                <Link 
                  to="/edit-profile" 
                  className="ml-2 px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full transition"
                >
                  Редактировать
                </Link>
              )}
            </div>
            <div className="text-slate-500">@{profile.username}</div>

            {profile.bio && (
              <p className="mt-3 text-slate-700 leading-relaxed">{profile.bio}</p>
            )}

            <div className="flex items-center gap-4 mt-4 text-sm text-slate-500">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                Присоединился {joinDate}
              </div>
              <div>
                <span className="font-semibold text-slate-800">{profile.post_count}</span> постов
              </div>
              {typeof profile.followers_count === 'number' && (
                <div>
                  <span className="font-semibold text-slate-800">{profile.followers_count}</span> подписчиков
                </div>
              )}
            </div>
          </div>

          {!isOwnProfile && (
            <div className="flex flex-col sm:flex-row gap-2 mt-2 sm:mt-0">
              <button
                onClick={() => navigate(`/messages`)}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-white border border-slate-200 hover:bg-slate-50 transition"
              >
                <MessageCircle className="w-4 h-4" /> Написать
              </button>
              <button
                onClick={handleFollowToggle}
                disabled={followLoading}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition disabled:opacity-60 ${
                  isFollowing(profile.id)
                    ? 'bg-slate-100 text-slate-700 hover:bg-red-50 hover:text-red-600'
                    : 'btn-primary text-white'
                }`}
              >
                {isFollowing(profile.id) ? 'Отписаться' : 'Подписаться'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Бутуз Казино integration */}
      {(profile.casino_level !== undefined || profile.casino_rating !== undefined || profile.casino_vip !== undefined || profile.casino_games_played !== undefined) && (
        <div className="bg-white border border-slate-200 rounded-3xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🎰</span>
            <h3 className="font-semibold text-lg">Бутуз Казино</h3>
            {profile.casino_vip && (
              <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700 font-medium">VIP</span>
            )}
            {isOwnProfile && (
              <Link to="/casino" className="ml-auto text-xs text-indigo-600 hover:underline">Открыть казино →</Link>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <div>Уровень: <span className="font-semibold">{profile.casino_level || 1}</span></div>
            <div>Рейтинг: <span className="font-semibold">👑 {profile.casino_rating || 0}</span></div>
            <div>Игр: <span className="font-semibold">{profile.casino_games_played || 0}</span></div>

            {profile.casino_balance !== undefined ? (
              <div>Баланс: <span className="font-semibold">💎 {Number(profile.casino_balance).toLocaleString('ru-RU')}</span></div>
            ) : (profile.casino_hide_balance && !isOwnProfile) ? (
              <div className="text-slate-500">Баланс скрыт игроком</div>
            ) : null}
          </div>

          {isOwnProfile && (
            <div className="mt-3 text-xs text-slate-500">
              Полный профиль и переводы — во вкладке «Профиль» внутри казино.
            </div>
          )}
        </div>
      )}

      {/* Posts */}
      <div>
        <div className="flex items-center justify-between mb-4 px-1">
          <h2 className="font-semibold text-lg text-slate-800">Публикации</h2>
          {posts.length > 0 && <span className="text-sm text-slate-500">{posts.length}</span>}
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-500">
            {isOwnProfile ? 'У вас пока нет постов. Опубликуйте первый!' : 'У пользователя пока нет постов.'}
          </div>
        ) : (
          <div className="space-y-5">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={{
                  ...post,
                  user: {
                    id: profile.id,
                    username: profile.username,
                    display_name: profile.display_name,
                    avatar: profile.avatar,
                  },
                }}
                onDelete={handlePostDeleted}
                onBookmarkChange={handleBookmarkChange}
                allowPinning={isOwnProfile}
                onPinChange={handlePinChange}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
