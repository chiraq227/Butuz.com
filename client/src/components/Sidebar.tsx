import { NavLink } from 'react-router-dom';
import { Home, User, Users, Bookmark, Settings, MessageCircle, Coins } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Sidebar() {
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

  return (
    <div className="p-3">
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
