import { createContext, useContext } from 'react';

export interface User {
  id: number;
  username: string;
  email: string;
  display_name: string;
  avatar: string;
  bio?: string;
  theme?: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
  unreadMessageCount: number;
  refreshUnreadMessageCount: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
