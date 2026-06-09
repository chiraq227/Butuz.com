import { NavLink, useLocation, Link } from 'react-router-dom';
import { Home, MessageCircle, Coins, User, MoreHorizontal, Users, Bookmark, Settings, LogOut, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';

export default function MobileBottomNav() {
  const { user, unreadMessageCount, logout } = useAuth();
  const location = useLocation();
  const [showMore, setShowMore] = useState(false);

  const mainLinks = [
    { to: '/', label: 'Лента', icon: Home },
    { to: '/messages', label: 'Сообщения', icon: MessageCircle, badge: unreadMessageCount },
    { to: '/casino', label: 'Казино', icon: Coins },
  ];

  const moreItems = [
    { to: `/profile/${user?.username}`, label: 'Профиль', icon: User },
    { to: '/friends', label: 'Друзья', icon: Users },
    { to: '/bookmarks', label: 'Закладки', icon: Bookmark },
    { to: '/settings', label: 'Настройки', icon: Settings },
  ];

  const isMoreActive = moreItems.some(item => location.pathname === item.to || location.pathname.startsWith(item.to.split('?')[0]));

  const handleLogout = () => {
    setShowMore(false);
    logout();
    // navigation will be handled by App routes
    window.location.href = '/login';
  };

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[90] bg-white/95 backdrop-blur border-t border-slate-200 safe-bottom">
        <div className="flex items-center justify-around h-16 px-1 max-w-md mx-auto">
          {mainLinks.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center flex-1 py-2 min-h-[44px] text-xs transition-colors active:bg-slate-100/60 rounded-lg ${
                  isActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`
              }
              end={to === '/'}
            >
              <div className="relative">
                <Icon className="w-6 h-6 mb-0.5" />
                {badge && badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-red-600 text-white text-[9px] font-semibold flex items-center justify-center tabular-nums">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </div>
              <span className="font-medium tracking-tight">{label}</span>
            </NavLink>
          ))}

          {/* More button */}
          <button
            onClick={() => setShowMore(!showMore)}
            className={`flex flex-col items-center justify-center flex-1 py-2 min-h-[44px] text-xs transition-colors active:bg-slate-100/60 rounded-lg ${
              showMore || isMoreActive ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <div className="relative">
              <MoreHorizontal className="w-6 h-6 mb-0.5" />
            </div>
            <span className="font-medium tracking-tight">Ещё</span>
          </button>
        </div>
      </nav>

      {/* More menu sheet */}
      {showMore && (
        <div className="lg:hidden fixed inset-0 z-[95] flex items-end" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full bg-white rounded-t-3xl border-t shadow-2xl p-2 pb-6 max-w-md mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="font-semibold text-lg">Меню</div>
              <button onClick={() => setShowMore(false)} className="p-2 -mr-2 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-2">
              {moreItems.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setShowMore(false)}
                  className="flex items-center gap-3 px-4 py-3 text-base text-slate-700 hover:bg-slate-50 rounded-2xl active:bg-slate-100"
                >
                  <Icon className="w-5 h-5 text-slate-500" />
                  <span>{label}</span>
                </Link>
              ))}

              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-base text-red-600 hover:bg-red-50 rounded-2xl mt-1 active:bg-red-100"
              >
                <LogOut className="w-5 h-5" />
                <span>Выйти</span>
              </button>
            </div>

            <div className="h-3" />
          </div>
        </div>
      )}
    </>
  );
}
