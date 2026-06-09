import { NavLink } from 'react-router-dom';
import { Home, User, Users, Bookmark, Settings, MessageCircle, Coins, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const { user, unreadMessageCount } = useAuth();

  const links = [
    { to: '/', label: 'Лента', icon: Home },
    { to: '/messages', label: 'Сообщения', icon: MessageCircle, badge: unreadMessageCount },
    { to: '/casino', label: 'Казино', icon: Coins },
    { to: `/profile/${user?.username}`, label: 'Профиль', icon: User },
    { to: '/friends', label: 'Друзья', icon: Users },
    { to: '/bookmarks', label: 'Закладки', icon: Bookmark },
    { to: '/settings', label: 'Настройки', icon: Settings },
  ];

  if (collapsed) {
    return (
      <div className="p-2 flex flex-col h-full">
        {/* Toggle button at top */}
        <button
          onClick={onToggle}
          className="mb-2 mx-auto p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition"
          aria-label="Развернуть меню"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        <div className="space-y-1 flex-1">
          {links.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={label}
              to={to}
              className={({ isActive }) =>
                `sidebar-link flex items-center justify-center px-2 py-3 rounded-xl text-slate-700 hover:bg-slate-100 transition-colors ${
                  isActive ? 'active' : ''
                }`
              }
              end={to === '/'}
              title={label}
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {badge && badge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-semibold flex items-center justify-center tabular-nums">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
            </NavLink>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-1 px-1">
        <div className="text-xs font-semibold tracking-widest text-slate-400 px-3">МЕНЮ</div>
        <button
          onClick={onToggle}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
          aria-label="Свернуть меню"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1">
        {links.map(({ to, label, icon: Icon, badge }) => (
          <NavLink
            key={label}
            to={to}
            className={({ isActive }) =>
              `sidebar-link flex items-center gap-3 px-4 py-3 rounded-xl text-slate-700 hover:bg-slate-100 transition-colors ${
                isActive ? 'active' : ''
              }`
            }
            end={to === '/'}
          >
            <Icon className="w-5 h-5" />
            <span className="font-medium flex-1">{label}</span>

            {/* Unread badge for messages */}
            {badge && badge > 0 && (
              <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center tabular-nums">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
