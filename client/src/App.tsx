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
import Avatar from './components/Avatar';
import { ThemeProvider } from './contexts/ThemeContext';
import { FollowProvider } from './contexts/FollowContext';
import { PhotoViewerProvider } from './components/PhotoViewer';
import { api } from './api/client';
import { lazy, Suspense } from 'react';
import { AuthContext, type User, useAuth } from './contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

const Casino = lazy(() => import('./pages/Casino'));
const LoadingFallback = () => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="animate-spin h-8 w-8 border-b-2 border-indigo-600 rounded-full" />
  </div>
);

// Hoisted here (before App) so the reference in App's JSX is clearly resolved,
// and to keep it stable across HMR re-renders of App.
function MessageNotificationManager({ setUnreadCount }: { setUnreadCount: (n: number) => void }) {
  const { token: authToken } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();

  // Use a ref so the polling closure always sees the latest token (avoids stale token after login/logout)
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = authToken || null;

  type MessageToast = {
    id: string;
    senderName: string;
    avatar?: string | null;
    text: string | null;
    otherUserId: number;
    mode: 'regular' | 'secret';
  };

  const [messageToasts, setMessageToasts] = useState<MessageToast[]>([]);
  const prevUnreadRef = useRef(0);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const autoDismissTimers = useRef<Record<string, number>>({});
  const initializedRef = useRef(false);

  // Keep latest path in a ref so the suppression check doesn't require the effect to restart on every navigation
  const currentPathRef = useRef(loc.pathname);
  currentPathRef.current = loc.pathname;

  // When user opens the messages page, clear any visible incoming toasts
  useEffect(() => {
    if (loc.pathname.startsWith('/messages')) {
      setMessageToasts([]);
      Object.values(autoDismissTimers.current).forEach(clearTimeout);
      autoDismissTimers.current = {};
    }
  }, [loc.pathname]);

  // Also force a fresh poll when we gain a token (helps after login/restore)
  useEffect(() => {
    if (authToken && tokenRef.current) {
      // The poll function will pick it up via ref on next tick
    }
  }, [authToken]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      setMessageToasts([]);
      Object.values(autoDismissTimers.current).forEach(clearTimeout);
      autoDismissTimers.current = {};
    };
  }, []);

  function scheduleAutoDismiss(toastId: string) {
    if (autoDismissTimers.current[toastId]) {
      clearTimeout(autoDismissTimers.current[toastId]);
    }
    const timer = window.setTimeout(() => {
      dismiss(toastId);
      delete autoDismissTimers.current[toastId];
    }, 8000);
    autoDismissTimers.current[toastId] = timer;
  }

  useEffect(() => {
    const currentToken = tokenRef.current;
    if (!currentToken) {
      setMessageToasts([]);
      prevUnreadRef.current = 0;
      seenMessageIdsRef.current = new Set();
      initializedRef.current = false;
      Object.values(autoDismissTimers.current).forEach(clearTimeout);
      autoDismissTimers.current = {};
      return;
    }

    let cancelled = false;

    const poll = async () => {
      const t = tokenRef.current;
      if (cancelled || !t) return;
      try {
        const countRes = await api.getUnreadMessageCount(t);
        const newCount = countRes?.count ?? 0;

        if (!initializedRef.current) {
          // First poll after app load: seed "seen" with whatever is currently unread.
          // This prevents spamming toasts for old unread messages on startup.
          // Badge will still correctly show the current number.
          try {
            const currentUnread = await api.getUnreadMessages(t);
            (currentUnread || []).forEach((m: any) => {
              const key = `${m.mode}:${m.id}`;
              seenMessageIdsRef.current.add(key);
            });
          } catch {}
          initializedRef.current = true;
          prevUnreadRef.current = newCount;
          if (!cancelled) setUnreadCount(newCount);
          return;
        }

        // Only react to *new* arrivals (count increased while app is running)
        const countIncreased = newCount > prevUnreadRef.current;

        if (countIncreased) {
          const unreadList = await api.getUnreadMessages(t);

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
              avatar: m.sender?.avatar || null,
              text,
              otherUserId: m.sender_id,
              mode: m.mode,
            });
            seenMessageIdsRef.current.add(key);
          }

          if (newToasts.length > 0) {
            setMessageToasts((prev) => {
              const combined = [...prev, ...newToasts];
              const limited = combined.slice(Math.max(0, combined.length - 3));
              newToasts.forEach(t => scheduleAutoDismiss(t.id));
              return limited;
            });
          }
        }

        prevUnreadRef.current = newCount;
        if (!cancelled) setUnreadCount(newCount);
      } catch {
        // silent (network / auth transient issues). Browser will still log the failing request.
      }
    };

    poll();
    const interval = setInterval(poll, 12000); // slightly more frequent for better "live" feel

    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authToken]);

  function dismiss(toastId: string) {
    setMessageToasts((prev) => prev.filter((t) => t.id !== toastId));
    if (autoDismissTimers.current[toastId]) {
      clearTimeout(autoDismissTimers.current[toastId]);
      delete autoDismissTimers.current[toastId];
    }
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
    <div className="fixed z-[300] pointer-events-none
      top-3 left-3 right-3 flex flex-col gap-2 items-stretch
      lg:top-auto lg:bottom-3 lg:right-3 lg:left-auto lg:items-end
      max-w-[calc(100vw-1.5rem)] lg:max-w-[320px]">
      <AnimatePresence>
        {messageToasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 80, scale: 0.95, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.6 }}
            drag="x"
            dragConstraints={{ left: -120, right: 120 }}
            dragElastic={0.2}
            onDragEnd={(event, info) => {
              if (Math.abs(info.offset.x) > 70) {
                dismiss(toast.id);
              }
            }}
            whileDrag={{ scale: 0.985 }}
            onClick={() => onToastClick(toast)}
            className="pointer-events-auto w-full lg:w-80 max-w-[92vw] lg:max-w-[320px] bg-white border border-slate-200 shadow-2xl rounded-2xl p-3 cursor-pointer flex gap-3 active:scale-[0.985] transition"
            style={{ backgroundColor: 'var(--card, #fff)', touchAction: 'pan-y' }}
          >
            {/* Avatar */}
            <div className="flex-shrink-0 mt-0.5" onClick={(e) => { e.stopPropagation(); onToastClick(toast); }}>
              <Avatar src={toast.avatar} alt={toast.senderName} size="sm" />
            </div>

            <div className="flex-1 min-w-0" onClick={(e) => { e.stopPropagation(); onToastClick(toast); }}>
              <div className="flex items-center gap-2 mb-0.5">
                <div className="font-semibold text-sm truncate">{toast.senderName}</div>
                {toast.mode === 'secret' && <span className="text-[10px]">🔒</span>}
              </div>
              <div className="text-sm text-slate-600 line-clamp-2 break-words">
                {toast.text ? toast.text : 'Новое секретное сообщение'}
              </div>
            </div>

            {/* Close button (fallback) */}
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
              className="self-start text-slate-400 hover:text-slate-600 text-xl leading-none mt-[-4px] px-1 active:opacity-70"
              aria-label="Закрыть уведомление"
            >
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
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

  // Collapsible sidebar (default collapsed / icons-only as requested)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved === null ? true : saved === 'true';
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  // Ref to always have the latest token for background / stale-closure safe calls (refresh, etc.)
  const appTokenRef = useRef<string | null>(null);

  // Restore auth from localStorage on app start (this must run to exit loading state)
  useEffect(() => {
    const savedToken = localStorage.getItem('butuz_token');
    const savedUser = localStorage.getItem('butuz_user');

    if (savedToken && savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setToken(savedToken);
      setUser(parsedUser);
      appTokenRef.current = savedToken;
      // Immediate count fetch so badge is correct right on load (manager will keep it live)
      (async () => {
        try {
          const res = await api.getUnreadMessageCount(savedToken);
          setUnreadMessageCount(res?.count ?? 0);
        } catch {}
      })();
    }
    setLoading(false);
  }, []);

  // Keep appTokenRef in sync whenever the token state changes
  useEffect(() => {
    appTokenRef.current = token;
  }, [token]);

  async function refreshUnreadMessageCount() {
    const t = appTokenRef.current || token;
    if (!t) return;
    try {
      const res = await api.getUnreadMessageCount(t);
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
    appTokenRef.current = newToken;
    // Immediate fetch so badge shows correct unread right after login
    (async () => {
      try {
        const res = await api.getUnreadMessageCount(newToken);
        setUnreadMessageCount(res?.count ?? 0);
      } catch {
        setUnreadMessageCount(0);
      }
    })();
  };

  const logout = () => {
    localStorage.removeItem('butuz_token');
    localStorage.removeItem('butuz_user');
    setToken(null);
    setUser(null);
    appTokenRef.current = null;
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
                <div className={`sidebar-left hidden lg:block fixed left-0 top-16 h-[calc(100vh-4rem)] overflow-y-auto border-r border-slate-200 bg-white transition-all ${sidebarCollapsed ? 'w-16' : 'w-64'}`}>
                  <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
                </div>
              )}

              <main className={`flex-1 min-w-0 ${isAuthenticated && !isMessagesPage ? (sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64') : ''} pt-16 ${isAuthenticated ? 'pb-16 lg:pb-0' : ''}`}>
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
