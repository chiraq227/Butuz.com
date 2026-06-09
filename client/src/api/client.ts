const API_BASE = '/api';

interface RequestOptions extends RequestInit {
  token?: string;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { token, ...fetchOptions } = options;

  const headers: HeadersInit = {
    ...fetchOptions.headers,
  };

  // Only set Content-Type for requests that typically have a body.
  // Sending it on GET can cause 400 Bad Request on some proxies/servers (e.g. Render + strict parsers).
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const hasBody = !!fetchOptions.body;
  if (hasBody || !['GET', 'HEAD'].includes(method)) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  let authToken = token;
  if (!authToken) {
    // Fallback for background polling (MessageNotificationManager etc.)
    // when context might not have propagated the token yet.
    authToken = localStorage.getItem('butuz_token') || undefined;
  }
  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...fetchOptions,
      headers,
    });
  } catch (networkErr: any) {
    const msg = networkErr.message || '';
    const hint = msg.includes('ECONNREFUSED') || msg.includes('fetch failed')
      ? 'Backend is down (ECONNREFUSED). Make sure you ran "npm run dev" (or separately "npm run dev:server" in server folder).'
      : 'Could not connect to server. Is the backend running on port 5001?';
    throw new Error(`Network error: ${msg || hint} (start backend with "npm run dev" from project root)`);
  }

  const contentType = response.headers.get('content-type') || '';
  let data: any;

  try {
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      // Fallback for non-JSON (e.g. HTML error pages from proxy when backend is down)
      const text = await response.text();
      const isProxyError = text.includes('ECONNREFUSED') || text.includes('http proxy error') || response.status === 504 || response.status === 502;

      data = { 
        error: isProxyError 
          ? 'Backend server is not running (ECONNREFUSED). Start it with "npm run dev:server" (or "npm run dev" from project root).'
          : (text || 'Non-JSON response'),
        status: response.status,
        _raw: text?.substring(0, 300) 
      };
    }
  } catch (parseErr) {
    // If json() fails (empty body, malformed)
    data = { error: 'Failed to parse server response (Unexpected end of JSON input)' };
  }

  if (!response.ok) {
    const message = data?.error || data?.message || `Request failed with status ${response.status}`;
    const full = data?._raw ? `${message} | Server said: ${data._raw}` : message;

    // Auto-recover from stale/invalid tokens.
    if (response.status === 401) {
      const isInvalidToken = /invalid or expired token/i.test(message);
      const isNoToken = /no token provided/i.test(message);

      if (isInvalidToken || isNoToken) {
        try {
          localStorage.removeItem('butuz_token');
          localStorage.removeItem('butuz_user');
        } catch {}
        setTimeout(() => {
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }, 30);
      }
    }

    throw new Error(full);
  }

  return data as T;
}

export const api = {
  // Auth
  register: (data: { username: string; email: string; password: string; display_name?: string }) =>
    request<{ token: string; user: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { emailOrUsername: string; password: string }) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Posts
  getPosts: (token?: string) =>
    request<any[]>('/posts', { token }),

  createPost: (formData: FormData, token: string) =>
    fetch(`${API_BASE}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }).then(async (res) => {
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('Backend is not responding (Non-JSON). Is the server running? Run "npm run dev" from the project root.');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to create post');
      return data;
    }),

  toggleLike: (postId: number, token: string) =>
    request<{ liked: boolean; like_count: number }>(`/posts/${postId}/like`, {
      method: 'POST',
      token,
    }),

  deletePost: (postId: number, token: string) =>
    request<{ message: string }>(`/posts/${postId}`, {
      method: 'DELETE',
      token,
    }),

  // Users
  getMe: (token: string) =>
    request<any>('/users/me', { token }),

  getUserProfile: (username: string, token?: string) =>
    request<any>(`/users/${username}`, { token }),

  updateProfile: (data: any, token: string) => {
    if (data instanceof FormData) {
      return fetch(`${API_BASE}/users/me`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: data,
      }).then(async (res) => {
        let result: any;
        try {
          result = await res.json();
        } catch {
          throw new Error('Backend is not responding (Non-JSON). Is the server running? Run "npm run dev" from the project root.');
        }
        if (!res.ok) throw new Error(result.error || 'Failed to update profile');
        return result;
      });
    }
    return request<any>('/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
      token,
    });
  },

  // Discover / Friends
  getUsers: (token: string) =>
    request<any[]>('/users', { token }),

  getFollowing: (token: string) =>
    request<any[]>('/users/me/following', { token }),

  followUser: (userId: number, token: string) =>
    request<any>(`/users/${userId}/follow`, { method: 'POST', token }),

  unfollowUser: (userId: number, token: string) =>
    request<any>(`/users/${userId}/follow`, { method: 'DELETE', token }),

  // Search
  searchUsers: (q: string, token: string) =>
    request<any[]>(`/users/search?q=${encodeURIComponent(q)}`, { token }),

  searchPosts: (q: string, token: string) =>
    request<any[]>(`/posts/search?q=${encodeURIComponent(q)}`, { token }),

  // Bookmarks
  toggleBookmark: (postId: number, token: string) =>
    request<{ bookmarked: boolean }>(`/posts/${postId}/bookmark`, {
      method: 'POST',
      token,
    }),

  getBookmarks: (token: string) =>
    request<any[]>('/posts/bookmarks', { token }),

  // Pin post
  pinPost: (postId: number, token: string) =>
    request<{ is_pinned: boolean }>(`/posts/${postId}/pin`, {
      method: 'POST',
      token,
    }),

  // Comments
  getComments: (postId: number, token?: string) =>
    request<any[]>(`/posts/${postId}/comments`, { token }),

  createComment: (postId: number, content: string, token: string) =>
    request<any>(`/posts/${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
      token,
    }),

  deleteComment: (commentId: number, token: string) =>
    request(`/posts/comments/${commentId}`, {
      method: 'DELETE',
      token,
    }),

  toggleCommentLike: (commentId: number, token: string) =>
    request<{ liked: boolean; like_count: number }>(`/posts/comments/${commentId}/like`, {
      method: 'POST',
      token,
    }),

  // Notifications
  getNotifications: (token: string) =>
    request<any[]>('/users/me/notifications', { token }),

  markNotificationRead: (id: number, token: string) =>
    request(`/users/me/notifications/${id}/read`, {
      method: 'POST',
      token,
    }),

  markAllNotificationsRead: (token: string) =>
    request('/users/me/notifications/read-all', {
      method: 'POST',
      token,
    }),

  sendMessage: (recipientId: number, content: string, token: string) =>
    request<any>('/messages', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: recipientId, content }),
      token,
    }),

  // Send regular message that may contain a media attachment (photo, video or voice recording).
  // Uses FormData. `content` can be empty string for pure media messages.
  sendMessageWithMedia: (recipientId: number, content: string, file: File, token: string, duration?: number) => {
    const formData = new FormData();
    formData.append('recipient_id', String(recipientId));
    if (content && content.trim()) formData.append('content', content.trim());
    formData.append('media', file);
    if (duration != null) formData.append('duration', String(duration));

    return fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }).then(async (res) => {
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error('Backend is not responding (Non-JSON). Is the server running? Run "npm run dev" from the project root.');
      }
      if (!res.ok) throw new Error(data.error || 'Failed to send message with media');
      return data;
    });
  },

  getMessages: (otherUserId: number, token: string) =>
    request<Array<{
      id: number;
      sender_id: number;
      recipient_id: number;
      content: string | null;
      media_url?: string | null;
      media_type?: 'image' | 'video' | 'voice' | null;
      media_duration?: number | null;
      created_at: string | null;
    }>>('/messages/' + otherUserId, { token }),

  getConversations: (token: string, mode: 'regular' | 'secret' = 'regular') =>
    request<Array<{
      user: { id: number; username: string; display_name: string; avatar: string; has_public_key: boolean };
      last_at: string | null;
      mode?: string;
    }>>(`/messages/conversations?mode=${mode}`, { token }),

  uploadPublicKey: (publicKey: string, token: string) =>
    request<{ success: boolean }>('/messages/keys', {
      method: 'POST',
      body: JSON.stringify({ public_key: publicKey }),
      token,
    }),

  getPublicKey: (userId: number, token: string) =>
    request<{ user_id: number; username: string; public_key: string }>('/messages/keys/' + userId, { token }),

  sendSecretMessage: (recipientId: number, ciphertext: string, iv: string, token: string) =>
    request<any>('/messages/secret', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: recipientId, ciphertext, iv }),
      token,
    }),

  getSecretConversations: (token: string) =>
    request<Array<{
      user: { id: number; username: string; display_name: string; avatar: string; has_public_key: boolean };
      last_at: string | null;
    }>>('/messages/secret/conversations', { token }),

  getSecretMessages: (otherUserId: number, token: string) =>
    request<Array<{
      id: number;
      sender_id: number;
      recipient_id: number;
      ciphertext: string;
      iv: string;
      created_at: string | null;
    }>>('/messages/secret/' + otherUserId, { token }),

  // Unread message support (badge + incoming toasts)
  getUnreadMessageCount: (token: string) =>
    request<{ count: number }>('/messages/unread-count', { token }),
  getUnreadMessages: (token: string) =>
    request<any[]>('/messages/unread', { token }),

  // ===== BUTUZ CASINO (full integration) =====
  casinoProfile: (token: string) => request<any>('/casino/profile', { token }),
  casinoLeaderboard: (token: string) => request<any[]>('/casino/leaderboard', { token }),

  casinoDailyClaim: (token: string) => request<any>('/casino/bonus/claim', { method: 'POST', token }),

  // Games
  playSlots: (bet: number, token: string) => request<any>('/casino/games/slots/play', { method: 'POST', body: JSON.stringify({ bet }), token }),
  playCoin: (bet: number, side: 'heads'|'tails', token: string) => request<any>('/casino/games/coin/play', { method: 'POST', body: JSON.stringify({ bet, side }), token }),

  // Coin PvP (rooms)
  coinPvpRooms: (token: string) => request<any[]>('/casino/pvp/coin/rooms', { token }),
  coinPvpRoom: (roomId: string, token: string) => request<any>(`/casino/pvp/coin/room/${roomId}`, { token }),
  coinPvpCreate: (bet: number, side: 'heads'|'tails', token: string) =>
    request<any>('/casino/pvp/coin/create', { method: 'POST', body: JSON.stringify({ bet, side }), token }),
  coinPvpJoin: (roomId: string, token: string) =>
    request<any>('/casino/pvp/coin/join', { method: 'POST', body: JSON.stringify({ roomId }), token }),
  coinPvpChoose: (roomId: string, side: 'heads'|'tails', token: string) =>
    request<any>('/casino/pvp/coin/choose', { method: 'POST', body: JSON.stringify({ roomId, side }), token }),
  coinPvpCancel: (roomId: string, token: string) =>
    request<any>('/casino/pvp/coin/cancel', { method: 'POST', body: JSON.stringify({ roomId }), token }),
  coinPvpReveal: (roomId: string, token: string) =>
    request<any>('/casino/pvp/coin/reveal', { method: 'POST', body: JSON.stringify({ roomId }), token }),
  playDice: (bet: number, betType: string, target?: number, token?: string) => request<any>('/casino/games/dice/play', { method: 'POST', body: JSON.stringify({ bet, betType, target }), token }),
  playRoulette: (bet: number, betType: string, target?: number, token?: string) => request<any>('/casino/games/roulette/play', { method: 'POST', body: JSON.stringify({ bet, betType, target }), token }),
  playPlinko: (bet: number, risk: 'low'|'medium'|'high', rows: 8|12|16, token: string) =>
    request<any>('/casino/games/plinko/play', { method: 'POST', body: JSON.stringify({ bet, risk, rows }), token }),

  // Mines (session based)
  minesStart: (bet: number, minesCount: number, token: string) => request<any>('/casino/games/mines/start', { method: 'POST', body: JSON.stringify({ bet, minesCount }), token }),
  minesOpen: (sessionId: number, cell: number, token: string) => request<any>('/casino/games/mines/open', { method: 'POST', body: JSON.stringify({ sessionId, cell }), token }),
  minesCashout: (sessionId: number, token: string) => request<any>('/casino/games/mines/cashout', { method: 'POST', body: JSON.stringify({ sessionId }), token }),

  // Blackjack
  bjStart: (bet: number, token: string) => request<any>('/casino/games/blackjack/start', { method: 'POST', body: JSON.stringify({ bet }), token }),
  bjHit: (sessionId: number, token: string) => request<any>('/casino/games/blackjack/hit', { method: 'POST', body: JSON.stringify({ sessionId }), token }),
  bjStand: (sessionId: number, token: string) => request<any>('/casino/games/blackjack/stand', { method: 'POST', body: JSON.stringify({ sessionId }), token }),
  bjDouble: (sessionId: number, token: string) => request<any>('/casino/games/blackjack/double', { method: 'POST', body: JSON.stringify({ sessionId }), token }),
  bjSplit: (sessionId: number, token: string) => request<any>('/casino/games/blackjack/split', { method: 'POST', body: JSON.stringify({ sessionId }), token }),

  // Bank (instant 0% + timed deposits)
  casinoBank: (token: string) => request<any>('/casino/bank', { token }),
  bankFull: (token: string) => request<any>('/casino/bank/full', { token }),
  bankDeposit: (amount: number, token: string) => request<any>('/casino/bank/deposit', { method: 'POST', body: JSON.stringify({ amount }), token }),
  bankWithdraw: (amount: number, token: string) => request<any>('/casino/bank/withdraw', { method: 'POST', body: JSON.stringify({ amount }), token }),
  bankOpenDeposit: (tierId: string, amount: number, token: string) => request<any>('/casino/bank/deposits/open', { method: 'POST', body: JSON.stringify({ tierId, amount }), token }),
  bankClaimDeposit: (depositId: number, token: string) => request<any>('/casino/bank/deposits/claim', { method: 'POST', body: JSON.stringify({ depositId }), token }),

  // Farm
  farmStatus: (token: string) => request<any>('/casino/farm', { token }),
  farmCollect: (token: string) => request<any>('/casino/farm/collect', { method: 'POST', token }),
  farmUpgrade: (token: string) => request<any>('/casino/farm/upgrade', { method: 'POST', token }),
  farmBuyExtra: (amount: number, token: string) => request<any>('/casino/farm/buy-extra', { method: 'POST', body: JSON.stringify({ amount }), token }),

  // Businesses
  businessesList: (token: string) => request<any>('/casino/businesses', { token }),
  bizBuy: (id: number, token: string) => request<any>('/casino/businesses/buy', { method: 'POST', body: JSON.stringify({ id }), token }),
  bizTask: (bizId: number, taskId: string, token: string) => request<any>('/casino/businesses/task', { method: 'POST', body: JSON.stringify({ bizId, taskId }), token }),
  bizSell: (id: number, token: string) => request<any>('/casino/businesses/sell', { method: 'POST', body: JSON.stringify({ id }), token }),

  // Shop
  shopStatus: (token: string) => request<any>('/casino/shop', { token }),
  buyRating: (amount: number, token: string) => request<any>('/casino/shop/buy-rating', { method: 'POST', body: JSON.stringify({ amount }), token }),
  sellRating: (amount: number, token: string) => request<any>('/casino/shop/sell-rating', { method: 'POST', body: JSON.stringify({ amount }), token }),
  buyVip: (token: string) => request<any>('/casino/shop/buy-vip', { method: 'POST', token }),

  // Transfers
  casinoTransfer: (targetUsername: string, amount: number, token: string) =>
    request<any>('/casino/transfer', { method: 'POST', body: JSON.stringify({ targetUsername, amount }), token }),

  // Admin (only works for 'butuz')
  adminUsers: (q: string, token: string) => request<any>(`/casino/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`, { token }),
  adminGive: (username: string, amount: number, token: string) => request<any>('/casino/admin/give', { method: 'POST', body: JSON.stringify({ username, amount }), token }),
  adminTake: (username: string, amount: number, token: string) => request<any>('/casino/admin/take', { method: 'POST', body: JSON.stringify({ username, amount }), token }),
  adminGiveRating: (username: string, amount: number, token: string) => request<any>('/casino/admin/giverating', { method: 'POST', body: JSON.stringify({ username, amount }), token }),
  adminTakeRating: (username: string, amount: number, token: string) => request<any>('/casino/admin/takerating', { method: 'POST', body: JSON.stringify({ username, amount }), token }),
  adminVipToggle: (username: string, token: string) => request<any>('/casino/admin/vip', { method: 'POST', body: JSON.stringify({ username }), token }),
  adminBan: (username: string, ban: boolean, token: string) => request<any>('/casino/admin/ban', { method: 'POST', body: JSON.stringify({ username, ban }), token }),
  adminBroadcast: (text: string, token: string) => request<any>('/casino/admin/broadcast', { method: 'POST', body: JSON.stringify({ text }), token }),
  adminUserInfo: (username: string, token: string) => request<any>(`/casino/admin/userinfo?username=${encodeURIComponent(username)}`, { token }),
  // Extended admin for farms etc.
  adminSetFarm: (username: string, level: number, extra: number, token: string) => request<any>('/casino/admin/setfarm', { method: 'POST', body: JSON.stringify({ username, level, extra }), token }),
  adminResetFarm: (username: string, token: string) => request<any>('/casino/admin/resetfarm', { method: 'POST', body: JSON.stringify({ username }), token }),
  // Extra powerful admin
  adminSetBalance: (username: string, amount: number, token: string) => request<any>('/casino/admin/setbalance', { method: 'POST', body: JSON.stringify({ username, amount }), token }),
  adminSetRating: (username: string, amount: number, token: string) => request<any>('/casino/admin/setrating', { method: 'POST', body: JSON.stringify({ username, amount }), token }),
  adminGiveBusiness: (username: string, id: number, token: string) => request<any>('/casino/admin/givebusiness', { method: 'POST', body: JSON.stringify({ username, id }), token }),
  adminClearBizCooldowns: (username: string, token: string) => request<any>('/casino/admin/clearbizcooldowns', { method: 'POST', body: JSON.stringify({ username }), token }),
  adminSetLevel: (username: string, level: number, token: string) => request<any>('/casino/admin/setlevel', { method: 'POST', body: JSON.stringify({ username, level }), token }),
  adminStats: (token: string) => request<any>('/casino/admin/stats', { token }),
  adminLogs: (token: string, limit?: number) => request<any>(`/casino/admin/logs${limit ? `?limit=${limit}` : ''}`, { token }),
  // Enhanced admin users with filters: filter=all|vip|banned , sort=id|balance|rating|level , dir=desc|asc
  adminUsersAdvanced: (params: Record<string, string | number>, token: string) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([,v]) => v != null && v !== '').map(([k,v]) => [k, String(v)])
    ).toString();
    return request<any>(`/casino/admin/users${qs ? `?${qs}` : ''}`, { token });
  },
  adminMassGive: (amount: number, mode: 'ALL'|'ALL_NONBANNED'|'LIST', usernames?: string[], token?: string) =>
    request<any>('/casino/admin/mass-give', { method: 'POST', body: JSON.stringify({ amount, mode, usernames }), token }),
};
