import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import MobileBottomNav from './components/MobileBottomNav';
import Feed from './pages/Feed';
import Profile from './pages/Profile';
import Login from './pages/Login';
import Register from './pages/Register';
import Friends from './pages/Friends';
import Bookmarks from './pages/Bookmarks';
import Settings from './pages/Settings';
import EditProfile from './pages/EditProfile';
import Messages from './pages/Messages';
import { ThemeProvider } from './contexts/ThemeContext';
import { FollowProvider } from './contexts/FollowContext';
import { PhotoViewerProvider } from './components/PhotoViewer';
import { api } from './api/client';
import { lazy, Suspense } from 'react';
import { AuthContext, type User, useAuth } from './contexts/AuthContext';

const Casino = lazy(() => import('./pages/Casino'));
const LoadingFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-spin h-8 w-8 border-b-2 border-indigo-600 rounded-full" />
  </div>
);

// Hoisted here (before App) so the reference in App's JSX is clearly resolved,
// and to keep it stable across HMR re-renders of App.
function MessageNotificationManager({ setUnreadCount }: { setUnreadCount: (n: number) => void }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();

  type MessageToast = {
    id: string;
    senderName: string;
    text: string | null;
    otherUserId: number;
    mode: 'regular' | 'secret';
  };

  const [messageToasts, setMessageToasts] = useState<MessageToast[]>([]);
  const prevUnreadRef = useRef(0);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

  // Keep latest path in a ref so the suppression check doesn't require the effect to restart on every navigation
  const currentPathRef = useRef(loc.pathname);
  currentPathRef.current = loc.pathname;

  useEffect(() => {
    if (!token) {
      setMessageToasts([]);
      prevUnreadRef.current = 0;
      seenMessageIdsRef.current = new Set();
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const countRes = await api.getUnreadMessageCount(token);
        const newCount = countRes?.count ?? 0;

        if (newCount > prevUnreadRef.current || newCount > 0) {
          const unreadList = await api.getUnreadMessages(token);

          const newToasts: MessageToast[] = [];

          for (const m of unreadList || []) {
            const key = `${m.mode}:${m.id}`;
            if (seenMessageIdsRef.current.has(key)) continue;

            const onMessagesPage = currentPathRef.current.startsWith('/messages');
            if (onMessagesPage) {
              seenMessageIdsRef.current.add(key);
              continue;
            }

            const senderName = m.sender?.display_name || m.sender?.username || 'Пользователь';
            const text = m.mode === 'secret' ? null : (m.text || '');

            newToasts.push({
              id: key,
              senderName,
              text,
              otherUserId: m.sender_id,
              mode: m.mode,
            });
            seenMessageIdsRef.current.add(key);
          }

          if (newToasts.length > 0) {
            setMessageToasts((prev) => {
              const combined = [...prev, ...newToasts];
              return combined.slice(Math.max(0, combined.length - 3));
            });
          }
        }

        prevUnreadRef.current = newCount;
        if (!cancelled) setUnreadCount(newCount);
      } catch {
        // silent
      }
    };

    poll();
    const interval = setInterval(poll, 18000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token]);

  function dismiss(toastId: string) {
    setMessageToasts((prev) => prev.filter((t) => t.id !== toastId));
  }

  function onToastClick(toast: MessageToast) {
    dismiss(toast.id);
    const params = new URLSearchParams({
      openUser: String(toast.otherUserId),
      mode: toast.mode,
    });
    navigate(`/messages?${params.toString()}`);
  }

  if (messageToasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-4 right-4 z-[300] flex flex-col gap-2 items-end pointer-events-none max-w-[calc(100vw-2rem)]">
      {messageToasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => onToastClick(toast)}
          className="pointer-events-auto w-80 max-w-[90vw] bg-white border border-slate-200 shadow-xl rounded-2xl p-3 cursor-pointer hover:shadow-2xl transition flex gap-3"
          style={{ backgroundColor: 'var(--card, #fff)' }}
        >
          <div className="flex-1 min-w-0" onClick={(e) => { e.stopPropagation(); onToastClick(toast); }}>
            <div className="flex items-center gap-2 mb-0.5">
              <div className="font-semibold text-sm truncate">{toast.senderName}</div>
              <div className="text-[10px] px-1.5 py-0 rounded bg-slate-100 text-slate-500">
                {toast.mode === 'secret' ? '🔒 секретно' : 'сообщение'}
              </div>
            </div>
            <div className="text-sm text-slate-600 line-clamp-2 break-words">
              {toast.text ? toast.text : 'Новое секретное сообщение'}
            </div>
            <div className="text-[10px] text-indigo-600 mt-1">Нажмите, чтобы открыть чат →</div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
            className="self-start text-slate-400 hover:text-slate-600 text-lg leading-none mt-[-2px] px-1"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const isMessagesPage = location.pathname.startsWith('/messages');

  // Global unread count for the sidebar badge (updated by the manager component)
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

  // Restore auth from localStorage on app start (this must run to exit loading state)
  useEffect(() => {
    const savedToken = localStorage.getItem('butuz_token');
    const savedUser = localStorage.getItem('butuz_user');

    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  async function refreshUnreadMessageCount() {
    if (!token) return;
    try {
      const res = await api.getUnreadMessageCount(token);
      const newCount = res?.count ?? 0;
      setUnreadMessageCount(newCount);
    } catch {
      // silent
    }
  }

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('butuz_token', newToken);
    localStorage.setItem('butuz_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    setUnreadMessageCount(0);
  };

  const logout = () => {
    localStorage.removeItem('butuz_token');
    localStorage.removeItem('butuz_user');
    setToken(null);
    setUser(null);
    setUnreadMessageCount(0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  const isAuthenticated = !!token && !!user;

  // Current theme id from logged in user (server preference) or local
  const currentUserTheme = user?.theme || 'default';

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated,
        unreadMessageCount,
        refreshUnreadMessageCount,
      }}
    >
      <ThemeProvider initialTheme={currentUserTheme}>
        <FollowProvider>
          <PhotoViewerProvider>
            <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
            {isAuthenticated && <Navbar />}

            <div className="flex w-full min-w-0">
              {isAuthenticated && !isMessagesPage && (
                <div className="sidebar-left hidden lg:block w-64 fixed left-0 top-16 h-[calc(100vh-4rem)] overflow-y-auto border-r border-slate-200 bg-white">
                  <Sidebar />
                </div>
              )}

              <main className={`flex-1 min-w-0 ${isAuthenticated && !isMessagesPage ? 'lg:ml-64' : ''} pt-16 ${isAuthenticated ? 'pb-16 lg:pb-0' : ''}`}>
                <Routes>
                  <Route 
                    path="/" 
                    element={isAuthenticated ? <Feed /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/profile/:username" 
                    element={isAuthenticated ? <Profile /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/profile" 
                    element={isAuthenticated ? <Navigate to={`/profile/${user?.username}`} /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/friends" 
                    element={isAuthenticated ? <Friends /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/bookmarks" 
                    element={isAuthenticated ? <Bookmarks /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/settings" 
                    element={isAuthenticated ? <Settings /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/edit-profile" 
                    element={isAuthenticated ? <EditProfile /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/messages" 
                    element={isAuthenticated ? <Messages /> : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/casino" 
                    element={isAuthenticated ? (
                      <Suspense fallback={<LoadingFallback />}>
                        <Casino />
                      </Suspense>
                    ) : <Navigate to="/login" />} 
                  />
                  <Route 
                    path="/login" 
                    element={!isAuthenticated ? <Login /> : <Navigate to="/" />} 
                  />
                  <Route 
                    path="/register" 
                    element={!isAuthenticated ? <Register /> : <Navigate to="/" />} 
                  />
                  <Route path="*" element={<Navigate to={isAuthenticated ? "/" : "/login"} />} />
                </Routes>
              </main>
            </div>

            {/* Message toasts + background polling (mounted only after auth ready) */}
            {isAuthenticated && <MessageNotificationManager setUnreadCount={setUnreadMessageCount} />}

            {/* Mobile bottom navigation for better phone UX */}
            {isAuthenticated && <MobileBottomNav />}
          </div>
          </PhotoViewerProvider>
        </FollowProvider>
      </ThemeProvider>
    </AuthContext.Provider>
  );
}

export default App;
