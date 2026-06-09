import { NavLink } from 'react-router-dom';
import { Home, MessageCircle, Coins, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function MobileBottomNav() {
  const { user, unreadMessageCount } = useAuth();

  const links = [
    { to: '/', label: 'Лента', icon: Home },
    { to: '/messages', label: 'Сообщения', icon: MessageCircle, badge: unreadMessageCount },
    { to: '/casino', label: 'Казино', icon: Coins },
    { to: `/profile/${user?.username}`, label: 'Профиль', icon: User },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[90] bg-white/95 backdrop-blur border-t border-slate-200 safe-bottom">
      <div className="flex items-center justify-around h-16 px-1 max-w-md mx-auto">
        {links.map(({ to, label, icon: Icon, badge }) => (
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
      </div>
    </nav>
  );
}
