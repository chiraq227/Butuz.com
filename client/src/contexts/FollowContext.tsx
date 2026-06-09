import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

interface FollowContextType {
  followingIds: Set<number>;
  isFollowing: (userId: number) => boolean;
  follow: (userId: number) => Promise<void>;
  unfollow: (userId: number) => Promise<void>;
  refreshFollowing: () => Promise<void>;
  loading: boolean;
}

const FollowContext = createContext<FollowContextType | null>(null);

export function FollowProvider({ children }: { children: ReactNode }) {
  const { user, token, isAuthenticated } = useAuth();
  const [followingIds, setFollowingIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  const refreshFollowing = useCallback(async () => {
    if (!token || !isAuthenticated) {
      setFollowingIds(new Set());
      return;
    }
    setLoading(true);
    try {
      const list = await api.getFollowing(token);
      const ids = new Set<number>(list.map((u: any) => u.id));
      setFollowingIds(ids);
    } catch (e) {
      console.error('Failed to refresh following list', e);
    } finally {
      setLoading(false);
    }
  }, [token, isAuthenticated]);

  // Load following list when user logs in / token changes
  useEffect(() => {
    if (isAuthenticated && token) {
      refreshFollowing();
    } else {
      setFollowingIds(new Set());
    }
  }, [isAuthenticated, token, refreshFollowing]);

  const isFollowing = useCallback((userId: number) => {
    return followingIds.has(userId);
  }, [followingIds]);

  const follow = useCallback(async (userId: number) => {
    if (!token) return;

    // Optimistic update
    setFollowingIds(prev => {
      const next = new Set(prev);
      next.add(userId);
      return next;
    });

    try {
      await api.followUser(userId, token);
      // Re-sync to get accurate server counts if needed (optional, can be skipped for perf)
      // await refreshFollowing();
    } catch (e) {
      // Rollback on error
      setFollowingIds(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
      console.error('Follow failed', e);
      throw e;
    }
  }, [token]);

  const unfollow = useCallback(async (userId: number) => {
    if (!token) return;

    // Optimistic
    setFollowingIds(prev => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });

    try {
      await api.unfollowUser(userId, token);
    } catch (e) {
      // Rollback
      setFollowingIds(prev => {
        const next = new Set(prev);
        next.add(userId);
        return next;
      });
      console.error('Unfollow failed', e);
      throw e;
    }
  }, [token]);

  return (
    <FollowContext.Provider value={{
      followingIds,
      isFollowing,
      follow,
      unfollow,
      refreshFollowing,
      loading
    }}>
      {children}
    </FollowContext.Provider>
  );
}

export const useFollow = () => {
  const ctx = useContext(FollowContext);
  if (!ctx) {
    // Safe fallback (during early renders or outside provider)
    return {
      followingIds: new Set<number>(),
      isFollowing: () => false,
      follow: async () => {},
      unfollow: async () => {},
      refreshFollowing: async () => {},
      loading: false
    };
  }
  return ctx;
};
