import express from 'express';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getDB } from '../db.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';

// Helper to build casino info for social profiles.
// If hide_balance and not viewing own profile, balances are omitted.
function buildCasinoPublicInfo(casinoRow, isSelf) {
  if (!casinoRow) {
    return {
      casino_level: 1,
      casino_rating: 0,
      casino_vip: false,
      casino_games_played: 0,
      casino_hide_balance: false,
    };
  }

  const hide = !!casinoRow.casino_hide_balance;
  const showBalances = isSelf || !hide;

  const info = {
    casino_level: casinoRow.casino_level || 1,
    casino_rating: casinoRow.casino_rating || 0,
    casino_vip: !!casinoRow.casino_vip,
    casino_games_played: casinoRow.casino_games_played || 0,
    casino_hide_balance: hide,
  };

  if (showBalances) {
    info.casino_balance = casinoRow.casino_balance || 0;
    info.casino_bank_balance = casinoRow.casino_bank_balance || 0;
  }

  return info;
}

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for avatar uploads (reuse similar to posts)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Conditional upload middleware: only use multer for actual multipart uploads.
// This prevents issues when sending plain JSON (e.g. for casino_hide_balance or theme).
const uploadAvatar = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    return upload.single('avatar')(req, res, next);
  }
  // JSON or other body — already parsed by express.json(), skip multer
  next();
};

// Helper to get follow counts + is_following for a target user
async function getFollowInfo(db, targetUserId, currentUserId) {
  // Use subqueries for reliable number results (fixes cases where count was 0 after reload)
  const counts = await db.get(`
    SELECT 
      (SELECT COUNT(*) FROM follows WHERE following_id = ?) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = ?) as following_count
  `, [targetUserId, targetUserId]);

  let isFollowing = false;
  if (currentUserId && currentUserId !== targetUserId) {
    const followRel = await db.get(
      'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
      [currentUserId, targetUserId]
    );
    isFollowing = !!followRel;
  }
  return {
    followers_count: counts ? (counts.followers_count || 0) : 0,
    following_count: counts ? (counts.following_count || 0) : 0,
    is_following: isFollowing
  };
}

// GET /api/users/me - Get current authenticated user (incl. theme + counts)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.get(
      'SELECT id, username, email, display_name, avatar, bio, theme, created_at, public_key, casino_hide_balance FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const followInfo = await getFollowInfo(db, user.id, user.id);

    // Casino public info for social profile integration
    const casinoRow = await db.get(
      `SELECT casino_level, casino_rating, casino_vip, casino_games_played, casino_balance, casino_bank_balance, casino_hide_balance
       FROM users WHERE id = ?`,
      [user.id]
    );

    const isSelfView = true;
    const casinoPublic = buildCasinoPublicInfo(casinoRow, isSelfView);

    res.json({ 
      ...user, 
      created_at: user.created_at ? new Date(user.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      public_key: user.public_key || null,
      ...followInfo,
      ...casinoPublic
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// GET /api/users - List all users (for Friends/Discover page)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const currentUserId = req.user?.id || null;

    const users = await db.all(`
      SELECT id, username, display_name, avatar, bio, created_at, public_key,
        (SELECT COUNT(*) FROM follows WHERE following_id = users.id) as followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = users.id) as following_count
      FROM users
      ORDER BY created_at DESC
      LIMIT 200
    `);

    // Add is_following for each
    const usersWithFollow = await Promise.all(users.map(async (u) => {
      const isFollowing = currentUserId !== u.id ? !!(await db.get(
        'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
        [currentUserId, u.id]
      )) : false;
      return { 
        ...u, 
        created_at: u.created_at ? new Date(u.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
        public_key: u.public_key || null,
        is_following: isFollowing 
      };
    }));

    res.json(usersWithFollow);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /api/users/search?q=... - Search users
router.get('/search', optionalAuthMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const q = (req.query.q || '').trim();
    const currentUserId = req.user?.id || null;

    if (!q || q.length < 1) return res.json([]);

    const users = await db.all(`
      SELECT id, username, display_name, avatar, bio, public_key
      FROM users
      WHERE username LIKE ? OR display_name LIKE ?
      ORDER BY 
        CASE WHEN username LIKE ? THEN 0 ELSE 1 END,
        username
      LIMIT 20
    `, [`%${q}%`, `%${q}%`, `${q}%`]);

    const withFollow = await Promise.all(users.map(async (u) => {
      const isFollowing = currentUserId !== u.id && !!(await db.get(
        'SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?',
        [currentUserId, u.id]
      ));
      return { 
        ...u, 
        created_at: u.created_at ? new Date(u.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
        public_key: u.public_key || null,
        is_following: isFollowing 
      };
    }));

    res.json(withFollow);
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/users/:username - Get public profile + their posts (with follow info)
router.get('/:username', optionalAuthMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { username } = req.params;
    const currentUserId = req.user?.id || null;

    const user = await db.get(
      'SELECT id, username, display_name, avatar, bio, theme, created_at, public_key, casino_hide_balance FROM users WHERE LOWER(username) = LOWER(?)',
      [username]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const posts = await db.all(`
      SELECT 
        p.id,
        p.content,
        p.image,
        p.created_at,
        p.is_pinned,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
        (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      WHERE p.user_id = ?
      ORDER BY p.is_pinned DESC, p.created_at DESC
    `, [currentUserId, currentUserId, user.id]);

    const formattedPosts = posts.map(post => ({
      id: post.id,
      content: post.content,
      image: post.image ? `/uploads/${path.basename(post.image)}` : null,
      created_at: post.created_at ? new Date(post.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      is_pinned: !!post.is_pinned,
      like_count: post.like_count,
      user_liked: !!post.user_liked,
      is_bookmarked: !!post.is_bookmarked,
      comment_count: post.comment_count || 0
    }));

    const postCount = await db.get('SELECT COUNT(*) as count FROM posts WHERE user_id = ?', [user.id]);
    const followInfo = await getFollowInfo(db, user.id, currentUserId);

    const casinoRow = await db.get(
      `SELECT casino_level, casino_rating, casino_vip, casino_games_played, casino_balance, casino_bank_balance, casino_hide_balance
       FROM users WHERE id = ?`,
      [user.id]
    );

    const isSelf = currentUserId === user.id;
    const casinoPublic = buildCasinoPublicInfo(casinoRow, isSelf);

    res.json({
      ...user,
      created_at: user.created_at ? new Date(user.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      public_key: user.public_key || null,
      post_count: postCount.count,
      ...followInfo,
      posts: formattedPosts,
      ...casinoPublic
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// PUT /api/users/me - Update profile (incl. theme for Settings). Supports avatar file upload + remove + auto cleanup + resize.
router.put('/me', authMiddleware, uploadAvatar, async (req, res) => {
  const { display_name, bio, theme } = req.body;
  const userId = req.user.id;
  const username = req.user.username;

  // Basic length / abuse guards
  if (display_name && display_name.length > 64) {
    return res.status(400).json({ error: 'Display name too long (max 64 chars)' });
  }
  if (bio && bio.length > 500) {
    return res.status(400).json({ error: 'Bio too long (max 500 chars)' });
  }

  try {
    const db = getDB();

    const currentUser = await db.get('SELECT avatar FROM users WHERE id = ?', [userId]);
    const oldAvatar = currentUser?.avatar;

    const isRemove = req.body.remove_avatar === 'true';
    let finalAvatar = req.body.avatar;

    if (isRemove) {
      finalAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`;
      if (oldAvatar && !oldAvatar.startsWith('http')) {
        try {
          const oldPath = path.resolve(uploadsDir, path.basename(oldAvatar));
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch (e) {
          console.error('Failed to delete old avatar file on remove', e);
        }
      }
    } else if (req.file) {
      // Resize and compress with sharp
      const sharp = (await import('sharp')).default;
      const resizedFilename = `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
      const resizedPath = path.join(uploadsDir, resizedFilename);

      await sharp(req.file.path)
        .resize(256, 256, { fit: 'cover', position: 'center' })
        .webp({ quality: 80 })
        .toFile(resizedPath);

      fs.unlinkSync(req.file.path); // remove original uploaded file

      finalAvatar = `/uploads/${resizedFilename}`;

      // Auto delete previous local avatar
      if (oldAvatar && !oldAvatar.startsWith('http')) {
        try {
          const oldPath = path.resolve(uploadsDir, path.basename(oldAvatar));
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch (e) {
          console.error('Failed to delete old avatar file on replace', e);
        }
      }
    }

    // Dynamic update
    const updates = [];
    const params = [];

    if (display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(display_name);
    }
    if (bio !== undefined) {
      updates.push('bio = ?');
      params.push(bio);
    }
    if (finalAvatar !== undefined) {
      updates.push('avatar = ?');
      params.push(finalAvatar);
    }
    if (theme !== undefined) {
      updates.push('theme = ?');
      params.push(theme);
    }
    if (req.body.casino_hide_balance !== undefined) {
      updates.push('casino_hide_balance = ?');
      params.push(req.body.casino_hide_balance ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(userId);
      await db.run(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    const updated = await db.get(
      'SELECT id, username, email, display_name, avatar, bio, theme, created_at, casino_hide_balance FROM users WHERE id = ?',
      [userId]
    );

    const followInfo = await getFollowInfo(db, userId, userId);
    res.json({ ...updated, ...followInfo });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Follow a user: POST /api/users/:id/follow
router.post('/:id/follow', authMiddleware, async (req, res) => {
  const targetId = parseInt(req.params.id);
  const followerId = req.user.id;

  if (targetId === followerId) {
    return res.status(400).json({ error: 'Cannot follow yourself' });
  }

  try {
    const db = getDB();
    const target = await db.get('SELECT id FROM users WHERE id = ?', [targetId]);
    if (!target) return res.status(404).json({ error: 'User not found' });

    await db.run(
      'INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)',
      [followerId, targetId]
    );

    // notify the followed user
    await createNotification(db, targetId, followerId, 'follow');

    const info = await getFollowInfo(db, targetId, followerId);
    res.json({ success: true, ...info });
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ error: 'Failed to follow' });
  }
});

// Unfollow: DELETE /api/users/:id/follow
router.delete('/:id/follow', authMiddleware, async (req, res) => {
  const targetId = parseInt(req.params.id);
  const followerId = req.user.id;

  try {
    const db = getDB();
    await db.run(
      'DELETE FROM follows WHERE follower_id = ? AND following_id = ?',
      [followerId, targetId]
    );

    const info = await getFollowInfo(db, targetId, followerId);
    res.json({ success: true, ...info });
  } catch (error) {
    console.error('Unfollow error:', error);
    res.status(500).json({ error: 'Failed to unfollow' });
  }
});

// GET /api/users/me/following - list who I follow
router.get('/me/following', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const current = req.user.id;

    const following = await db.all(`
      SELECT u.id, u.username, u.display_name, u.avatar, u.bio, u.public_key,
             (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as followers_count
      FROM follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
    `, [current]);

    res.json(following);
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Failed to fetch following' });
  }
});

// Helper to create notification (no self-notifs)
async function createNotification(db, userId, actorId, type, postId = null, commentId = null) {
  if (!userId || userId === actorId) return;
  try {
    await db.run(
      `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?, ?, ?, ?, ?)`,
      [userId, actorId, type, postId, commentId]
    );
  } catch (e) {
    console.error('Failed to create notification', e);
  }
}

// GET /api/users/me/notifications - list my notifications (latest first)
router.get('/me/notifications', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    const notifs = await db.all(`
      SELECT 
        n.id, n.type, n.is_read, n.created_at,
        n.post_id, n.comment_id,
        u.id as actor_id, u.username as actor_username, u.display_name as actor_display_name, u.avatar as actor_avatar,
        p.content as post_content,
        c.content as comment_content
      FROM notifications n
      JOIN users u ON n.actor_id = u.id
      LEFT JOIN posts p ON n.post_id = p.id
      LEFT JOIN comments c ON n.comment_id = c.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userId]);

    const formatted = notifs.map(n => ({
      id: n.id,
      type: n.type,
      is_read: !!n.is_read,
      created_at: n.created_at ? new Date(n.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      post_id: n.post_id,
      comment_id: n.comment_id,
      actor: {
        id: n.actor_id,
        username: n.actor_username,
        display_name: n.actor_display_name,
        avatar: n.actor_avatar
      },
      post_snippet: n.post_content ? n.post_content.substring(0, 100) : null,
      comment_snippet: n.comment_content ? n.comment_content.substring(0, 100) : null
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// POST /api/users/me/notifications/:id/read - mark one as read
router.post('/me/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const notifId = parseInt(req.params.id);
    const userId = req.user.id;

    await db.run(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [notifId, userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// POST /api/users/me/notifications/read-all - mark all as read
router.post('/me/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    await db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

export default router;
