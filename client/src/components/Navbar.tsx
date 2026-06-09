import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Search, Bell, User, LogOut, X } from 'lucide-react';
import Avatar from './Avatar';
import Logo from './Logo';
import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface SearchUser {
  id: number;
  username: string;
  display_name: string;
  avatar: string;
}
interface SearchPost {
  id: number;
  content: string;
  user: { username: string; display_name: string };
}

export default function Navbar({ headless = false }: { headless?: boolean }) {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchUsers, setSearchUsers] = useState<SearchUser[]>([]);
  const [searchPosts, setSearchPosts] = useState<SearchPost[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Notifications
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const unreadCount = Array.isArray(notifications) ? notifications.filter((n: any) => !n.is_read).length : 0;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2 || !token) {
      setSearchUsers([]);
      setSearchPosts([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const [users, posts] = await Promise.all([
          api.searchUsers(searchQuery.trim(), token),
          api.searchPosts(searchQuery.trim(), token),
        ]);
        setSearchUsers(users.slice(0, 6));
        setSearchPosts(posts.slice(0, 5));
      } catch (e) {
        setSearchUsers([]);
        setSearchPosts([]);
      } finally {
        setSearchLoading(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery, token]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchUsers([]);
    setSearchPosts([]);
  };

  // Notifications
  const loadNotifications = async () => {
    if (!token) return;
    setNotifLoading(true);
    try {
      const data = await api.getNotifications(token);
      setNotifications(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load notifications');
      setNotifications([]);
    }
    setNotifLoading(false);
  };

  const toggleNotifs = async () => {
    const next = !showNotifs;
    setShowNotifs(next);
    if (next) {
      await loadNotifications();
    }
  };

  const formatNotifTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffM = Math.floor((now.getTime() - date.getTime()) / 60000);
    if (diffM < 1) return 'только что';
    if (diffM < 60) return `${diffM} мин.`;
    if (diffM < 1440) return `${Math.floor(diffM / 60)} ч.`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  };

  // Preload notifications on mount so the unread count badge is visible immediately
  useEffect(() => {
    if (token) {
      loadNotifications();
    }
  }, [token]);

  const goToProfile = (username: string) => {
    closeSearch();
    navigate(`/profile/${username}`);
  };

  const totalResults = searchUsers.length + searchPosts.length;

  if (headless) {
    // Headless mode: no full header bar. 
    // Search, letter logo, and right controls (profile + notifs) stay roughly in the old positions
    // but as floating elements on the page background. Right controls have borders to look like buttons.
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] border-b" style={{ backgroundColor: 'var(--card)' }}>
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          {/* Custom icon logo from assets/logos (the one without text, just the B).
              Logo component automatically chooses light/dark version. */}
          <Link to="/" className="flex-shrink-0">
            <Logo variant="icon" className="h-8 w-8" />
          </Link>

        {/* Search bar - centered */}
        <div className="flex-1 flex justify-center">
          <div className="w-full max-w-md relative">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Поиск людей и постов..."
              className="w-full bg-slate-100 pl-10 pr-9 py-2 rounded-full text-sm border border-transparent focus:border-indigo-200 focus:bg-white transition-colors input"
            />
            {searchQuery && (
              <button
                onClick={closeSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Search dropdown (reused) */}
          {searchOpen && (searchQuery.length >= 2 || searchUsers.length > 0 || searchPosts.length > 0) && (
            <div className="absolute top-full mt-2 left-0 right-0 bg-white border border-slate-200 rounded-2xl shadow-xl z-[110] max-h-[420px] overflow-auto py-2 text-sm">
              {searchLoading && <div className="px-4 py-3 text-slate-500">Поиск...</div>}
              {!searchLoading && totalResults === 0 && searchQuery.length >= 2 && (
                <div className="px-4 py-3 text-slate-500">Ничего не найдено по «{searchQuery}»</div>
              )}
              {searchUsers.length > 0 && (
                <div>
                  <div className="px-4 pt-1 pb-1 text-[10px] font-semibold tracking-widest text-slate-400">ЛЮДИ</div>
                  {searchUsers.map((u) => (
                    <button key={u.id} onClick={() => goToProfile(u.username)} className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-left">
                      <Avatar src={u.avatar} alt={u.username} size="sm" />
                      <div>
                        <div className="font-medium text-slate-900">{u.display_name}</div>
                        <div className="text-xs text-slate-500">@{u.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searchPosts.length > 0 && (
                <div className="mt-1 border-t border-slate-100 pt-1">
                  <div className="px-4 pt-1 pb-1 text-[10px] font-semibold tracking-widest text-slate-400">ПОСТЫ</div>
                  {searchPosts.map((p) => (
                    <button key={p.id} onClick={() => { closeSearch(); navigate(`/profile/${p.user.username}`); }} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                      <div className="text-slate-800 line-clamp-2 leading-snug">{p.content}</div>
                      <div className="text-xs text-slate-500 mt-0.5">— {p.user.display_name}</div>
                    </button>
                  ))}
                </div>
              )}
              {totalResults > 0 && <div className="px-4 pt-2 text-[10px] text-slate-400 text-center">Нажмите на результат, чтобы перейти</div>}
            </div>
          )}
          </div>
        </div>

        {/* Right controls (notifications + profile) on the right, with borders like buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Notifications button with outline */}
          <div className="relative">
            <button onClick={toggleNotifs} className="p-2 border border-slate-300 dark:border-slate-700 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white ring-2 ring-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white border border-slate-200 rounded-2xl shadow-xl z-[110] max-h-[380px] overflow-auto py-1 text-sm">
                <div className="px-3 py-2 border-b flex items-center justify-between font-medium text-slate-700">
                  Уведомления
                  {unreadCount > 0 && (
                    <button onClick={async () => { await api.markAllNotificationsRead(token); await loadNotifications(); }} className="text-xs text-indigo-600 hover:underline">
                      Прочитать всё
                    </button>
                  )}
                </div>
                {notifLoading && <div className="px-3 py-3 text-slate-500 text-sm">Загрузка...</div>}
                {!notifLoading && notifications.length === 0 && <div className="px-3 py-3 text-slate-500 text-sm">Уведомлений пока нет</div>}
                {Array.isArray(notifications) && notifications.map((n: any) => {
                  const actorName = n.actor?.display_name || n.actor?.username;
                  let actionText = '';
                  if (n.type === 'follow') actionText = 'подписался(ась) на вас';
                  else if (n.type === 'like') actionText = 'оценил(а) ваш пост';
                  else if (n.type === 'like_comment') actionText = 'оценил(а) ваш комментарий';
                  else if (n.type === 'comment') actionText = 'прокомментировал(а) ваш пост';
                  else if (n.type === 'bookmark') actionText = 'сохранил(а) ваш пост';
                  return (
                    <div key={n.id} onClick={async () => {
                      if (!n.is_read) { await api.markNotificationRead(n.id, token); await loadNotifications(); }
                      setShowNotifs(false);
                      if (n.post_id && n.actor?.username) navigate(`/profile/${n.actor.username}`);
                      else if (n.actor?.username) navigate(`/profile/${n.actor.username}`);
                    }} className={`px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex gap-2 border-b last:border-0 ${!n.is_read ? 'bg-blue-50/60' : ''}`}>
                      <Avatar src={n.actor?.avatar} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm"><span className="font-medium">{actorName}</span> {actionText}</div>
                        {n.comment_snippet && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">«{n.comment_snippet}»</div>}
                        {n.post_snippet && !n.comment_snippet && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">«{n.post_snippet}»</div>}
                        <div className="text-[10px] text-slate-400 mt-0.5">{formatNotifTime(n.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Profile button with outline/border like a button */}
          <div className="relative">
            <button
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                if (searchOpen) closeSearch();
                if (showNotifs) setShowNotifs(false);
              }}
              className="flex items-center border border-slate-300 dark:border-slate-700 rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Avatar src={user?.avatar} alt={user?.username} size="sm" />
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-lg py-1 z-[110]">
                <Link to={`/profile/${user?.username}`} className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setShowUserMenu(false); closeSearch(); }}>
                  <User className="w-4 h-4" /> Мой профиль
                </Link>
                <button onClick={handleLogout} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                  <LogOut className="w-4 h-4" /> Выйти
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    );
  }

  // Full header mode (original, kept for compatibility)
  return (
    <nav className="fixed top-0 left-0 right-0 bg-white border-b border-slate-200 z-[100]">
      <div className="max-w-7xl mx-auto px-4 h-24 flex items-center justify-between">
        {/* Logo - full custom logo (includes text) */}
        <Link to="/" className="flex items-center">
          <Logo variant="full" className="h-20 w-auto" />
        </Link>

        {/* Search - always visible but compact on mobile */}
        <div className="flex items-center flex-1 max-w-md mx-2 md:mx-8 relative">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Поиск людей и постов..."
              className="w-full bg-slate-100 pl-10 pr-9 py-2 rounded-full text-sm border border-transparent focus:border-indigo-200 focus:bg-white transition-colors input"
            />
            {searchQuery && (
              <button
                onClick={closeSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Search dropdown */}
          {searchOpen && (searchQuery.length >= 2 || searchUsers.length > 0 || searchPosts.length > 0) && (
            <div className="absolute top-full mt-2 left-0 right-0 bg-white border border-slate-200 rounded-2xl shadow-xl z-[110] max-h-[420px] overflow-auto py-2 text-sm">
              {searchLoading && (
                <div className="px-4 py-3 text-slate-500">Поиск...</div>
              )}

              {!searchLoading && totalResults === 0 && searchQuery.length >= 2 && (
                <div className="px-4 py-3 text-slate-500">Ничего не найдено по «{searchQuery}»</div>
              )}

              {/* Users results */}
              {searchUsers.length > 0 && (
                <div>
                  <div className="px-4 pt-1 pb-1 text-[10px] font-semibold tracking-widest text-slate-400">ЛЮДИ</div>
                  {searchUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => goToProfile(u.username)}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50 text-left"
                    >
                      <Avatar src={u.avatar} alt={u.username} size="sm" />
                      <div>
                        <div className="font-medium text-slate-900">{u.display_name}</div>
                        <div className="text-xs text-slate-500">@{u.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Posts results */}
              {searchPosts.length > 0 && (
                <div className="mt-1 border-t border-slate-100 pt-1">
                  <div className="px-4 pt-1 pb-1 text-[10px] font-semibold tracking-widest text-slate-400">ПОСТЫ</div>
                  {searchPosts.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        closeSearch();
                        // Navigate to feed or profile of author (simple UX)
                        navigate(`/profile/${p.user.username}`);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                    >
                      <div className="text-slate-800 line-clamp-2 leading-snug">{p.content}</div>
                      <div className="text-xs text-slate-500 mt-0.5">— {p.user.display_name}</div>
                    </button>
                  ))}
                </div>
              )}

              {totalResults > 0 && null}
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button 
              onClick={toggleNotifs}
              className="p-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors hidden sm:block relative"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white ring-2 ring-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifs && (
              <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white border border-slate-200 rounded-2xl shadow-xl z-[110] max-h-[380px] overflow-auto py-1 text-sm">
                <div className="px-3 py-2 border-b flex items-center justify-between font-medium text-slate-700">
                  Уведомления
                  {unreadCount > 0 && (
                    <button 
                      onClick={async () => { 
                        await api.markAllNotificationsRead(token); 
                        await loadNotifications(); 
                      }} 
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Прочитать всё
                    </button>
                  )}
                </div>
                {notifLoading && <div className="px-3 py-3 text-slate-500 text-sm">Загрузка...</div>}
                {!notifLoading && notifications.length === 0 && (
                  <div className="px-3 py-3 text-slate-500 text-sm">Уведомлений пока нет</div>
                )}
                {Array.isArray(notifications) && notifications.map((n: any) => {
                  const actorName = n.actor?.display_name || n.actor?.username;
                  let actionText = '';
                  if (n.type === 'follow') actionText = 'подписался(ась) на вас';
                  else if (n.type === 'like') actionText = 'оценил(а) ваш пост';
                  else if (n.type === 'like_comment') actionText = 'оценил(а) ваш комментарий';
                  else if (n.type === 'comment') actionText = 'прокомментировал(а) ваш пост';
                  else if (n.type === 'bookmark') actionText = 'сохранил(а) ваш пост';
                  return (
                    <div 
                      key={n.id} 
                      onClick={async () => {
                        if (!n.is_read) {
                          await api.markNotificationRead(n.id, token);
                          await loadNotifications();
                        }
                        setShowNotifs(false);
                        if (n.post_id) {
                          // For post-related (including comment likes), go to the actor's profile (user can find the post there)
                          if (n.actor?.username) {
                            navigate(`/profile/${n.actor.username}`);
                          }
                        } else if (n.actor?.username) {
                          navigate(`/profile/${n.actor.username}`);
                        }
                      }}
                      className={`px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex gap-2 border-b last:border-0 ${!n.is_read ? 'bg-blue-50/60' : ''}`}
                    >
                      <Avatar src={n.actor?.avatar} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          <span className="font-medium">{actorName}</span> {actionText}
                        </div>
                        {n.comment_snippet && (
                          <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">«{n.comment_snippet}»</div>
                        )}
                        {n.post_snippet && !n.comment_snippet && (
                          <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">«{n.post_snippet}»</div>
                        )}
                        <div className="text-[10px] text-slate-400 mt-0.5">{formatNotifTime(n.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Profile dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                if (searchOpen) closeSearch();
                if (showNotifs) setShowNotifs(false);
              }}
              className="flex items-center gap-2 p-1 pr-3 rounded-full hover:bg-slate-100 transition-colors"
            >
              <Avatar src={user?.avatar} alt={user?.username} size="sm" />
              <span className="hidden sm:block text-sm font-medium text-slate-700">
                {user?.display_name}
              </span>
            </button>

            {showUserMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-lg py-1 z-[110]">
                <Link
                  to={`/profile/${user?.username}`}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  onClick={() => { setShowUserMenu(false); closeSearch(); }}
                >
                  <User className="w-4 h-4" />
                  Мой профиль
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="w-4 h-4" />
                  Выйти
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
