import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getDB } from '../db.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';
import { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } from '../lib/cloudinary.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config for post uploads (images + videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Use crypto for less predictable filenames (reduces enumeration of /uploads)
    const rand = crypto.randomBytes(12).toString('hex');
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!/^\.(jpe?g|png|gif|webp|mp4|webm|mov|avi)$/.test(ext)) ext = '.bin';
    cb(null, `${Date.now()}-${rand}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (images ~5-8MB, videos up to ~25MB)
  fileFilter: (req, file, cb) => {
    // Support modern formats including HEIC (iPhone), AVIF etc.
    const allowedTypes = /jpeg|jpg|png|gif|webp|heic|heif|avif|mp4|webm|mov|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname || '').toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype || '');
    if (extname || mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только изображения и видео'));
    }
  }
});

// GET /api/posts - Get all posts (feed) - includes is_bookmarked for current user
router.get('/', optionalAuthMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const currentUserId = req.user?.id || null;

    const posts = await db.all(`
      SELECT 
        p.id,
        p.content,
        p.image,
        p.created_at,
        p.is_pinned,
        u.id as user_id,
        u.username,
        u.display_name,
        u.avatar,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
        (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
      LIMIT 100
    `, [currentUserId, currentUserId]);

    const formatted = posts.map(post => ({
      id: post.id,
      content: post.content,
      image: post.image
        ? (post.image.startsWith('http') ? post.image : `/uploads/${path.basename(post.image)}`)
        : null,
      created_at: post.created_at ? new Date(post.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      is_pinned: !!post.is_pinned,
      user: {
        id: post.user_id,
        username: post.username,
        display_name: post.display_name,
        avatar: post.avatar
      },
      like_count: post.like_count,
      user_liked: !!post.user_liked,
      is_bookmarked: !!post.is_bookmarked,
      comment_count: post.comment_count || 0
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// POST /api/posts - Create new post (auth required)
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
  const { content } = req.body;
  const userId = req.user.id;

  const hasText = content && content.trim().length > 0;
  const hasMedia = !!req.file;

  if (!hasText && !hasMedia) {
    return res.status(400).json({ error: 'Post must have text or an attached photo/video' });
  }
  if (hasText && content.trim().length > 1250) {
    return res.status(400).json({ error: 'Post content is too long (maximum 1250 characters)' });
  }

  try {
    const db = getDB();
    let imagePath = null;

    if (req.file) {
      const uploadedFull = req.file.path;
      const originalName = req.file.originalname || '';
      const isImage = /\.(jpe?g|png|gif|webp)$/i.test(originalName) || (req.file.mimetype || '').startsWith('image/');

      let localToUpload = uploadedFull;
      let processedLocal = null;

      if (isImage) {
        // Optimize post image locally first
        try {
          const sharp = (await import('sharp')).default;
          const processedFilename = `post-${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;
          const processedPath = path.join(uploadsDir, processedFilename);

          await sharp(uploadedFull)
            .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(processedPath);

          try { fs.unlinkSync(uploadedFull); } catch (_) {}
          localToUpload = processedPath;
          processedLocal = processedPath;
        } catch (sharpErr) {
          console.warn('Sharp post image optimize failed, uploading original to Cloudinary:', sharpErr.message);
        }
      }

      // Upload to Cloudinary (images and videos)
      try {
        const cloudResult = await uploadToCloudinary(localToUpload, {
          folder: isImage ? 'butuz/posts/images' : 'butuz/posts/videos',
          resource_type: isImage ? 'image' : 'video',
        });
        imagePath = cloudResult.url; // store full cloudinary secure_url
      } catch (cloudErr) {
        console.warn('Cloudinary upload failed for post media, falling back to local storage:', cloudErr.message);
        // Fallback: store basename for local /uploads serving
        imagePath = path.basename(localToUpload || uploadedFull);
      }
    }

    const result = await db.run(
      `INSERT INTO posts (user_id, content, image) VALUES (?, ?, ?)`,
      [userId, content.trim(), imagePath]
    );

    const newPost = await db.get(`
      SELECT 
        p.id,
        p.content,
        p.image,
        p.created_at,
        p.is_pinned,
        u.id as user_id,
        u.username,
        u.display_name,
        u.avatar
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `, [result.lastID]);

    const postImage = newPost.image
      ? (newPost.image.startsWith('http') ? newPost.image : `/uploads/${path.basename(newPost.image)}`)
      : null;

    res.status(201).json({
      id: newPost.id,
      content: newPost.content,
      image: postImage,
      created_at: newPost.created_at ? new Date(newPost.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      user: {
        id: newPost.user_id,
        username: newPost.username,
        display_name: newPost.display_name,
        avatar: newPost.avatar
      },
      like_count: 0,
      user_liked: false,
      comment_count: 0,
      is_pinned: false
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// POST /api/posts/:id/like - Toggle like on post
router.post('/:id/like', authMiddleware, async (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    const db = getDB();

    // Check if post exists
    const post = await db.get('SELECT id, user_id FROM posts WHERE id = ?', [postId]);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if already liked
    const existingLike = await db.get(
      'SELECT id FROM likes WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );

    if (existingLike) {
      // Unlike
      await db.run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
      const count = await db.get('SELECT COUNT(*) as count FROM likes WHERE post_id = ?', [postId]);
      return res.json({ liked: false, like_count: count.count });
    } else {
      // Like
      await db.run('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId]);
      const count = await db.get('SELECT COUNT(*) as count FROM likes WHERE post_id = ?', [postId]);
      await createNotification(db, post.user_id, userId, 'like', postId);
      return res.json({ liked: true, like_count: count.count });
    }
  } catch (error) {
    console.error('Like error:', error);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// DELETE /api/posts/:id - Delete own post (auth required)
router.delete('/:id', authMiddleware, async (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    const db = getDB();

    const post = await db.get('SELECT user_id, image FROM posts WHERE id = ?', [postId]);
    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (post.user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }

    // Delete media: Cloudinary or local
    if (post.image) {
      if (post.image.includes('cloudinary.com')) {
        const pubId = getPublicIdFromUrl(post.image);
        if (pubId) {
          const isVideo = post.image.includes('/video/') || /\.(mp4|webm|mov)/i.test(post.image);
          await deleteFromCloudinary(pubId, isVideo ? 'video' : 'image');
        }
      } else {
        const fname = path.basename(post.image);
        const full = path.join(uploadsDir, fname);
        if (fs.existsSync(full)) {
          try { fs.unlinkSync(full); } catch (e) { console.error('Failed to delete post media', e); }
        }
      }
    }

    await db.run('DELETE FROM posts WHERE id = ?', [postId]);
    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

// POST /api/posts/:id/bookmark - Toggle bookmark
router.post('/:id/bookmark', authMiddleware, async (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    const db = getDB();

    const post = await db.get('SELECT id, user_id FROM posts WHERE id = ?', [postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const existing = await db.get(
      'SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );

    if (existing) {
      await db.run('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?', [userId, postId]);
      return res.json({ bookmarked: false });
    } else {
      await db.run('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)', [userId, postId]);
      await createNotification(db, post.user_id, userId, 'bookmark', postId);
      return res.json({ bookmarked: true });
    }
  } catch (error) {
    console.error('Bookmark error:', error);
    res.status(500).json({ error: 'Failed to toggle bookmark' });
  }
});

// Helper for notifications (duplicate from users for post actions)
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

// POST /api/posts/:id/pin - toggle pin for own post (only one pinned per user)
router.post('/:id/pin', authMiddleware, async (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    const db = getDB();
    const post = await db.get('SELECT user_id, is_pinned FROM posts WHERE id = ?', [postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.user_id !== userId) return res.status(403).json({ error: 'You can only pin your own posts' });

    if (post.is_pinned) {
      // unpin
      await db.run('UPDATE posts SET is_pinned = 0 WHERE id = ?', [postId]);
      return res.json({ is_pinned: false });
    } else {
      // unpin any other pinned by this user first
      await db.run('UPDATE posts SET is_pinned = 0 WHERE user_id = ? AND is_pinned = 1', [userId]);
      // pin this one
      await db.run('UPDATE posts SET is_pinned = 1 WHERE id = ?', [postId]);
      return res.json({ is_pinned: true });
    }
  } catch (error) {
    console.error('Pin post error:', error);
    res.status(500).json({ error: 'Failed to pin post' });
  }
});

// GET /api/posts/bookmarks - Get my bookmarked posts (full feed-like response)
router.get('/bookmarks', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const userId = req.user.id;

    const posts = await db.all(`
      SELECT 
        p.id,
        p.content,
        p.image,
        p.created_at,
        p.is_pinned,
        u.id as user_id,
        u.username,
        u.display_name,
        u.avatar,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
        1 as is_bookmarked,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id
      JOIN users u ON p.user_id = u.id
      WHERE b.user_id = ?
      ORDER BY b.created_at DESC
      LIMIT 100
    `, [userId, userId]);

    const formatted = posts.map(post => ({
      id: post.id,
      content: post.content,
      image: post.image
        ? (post.image.startsWith('http') ? post.image : `/uploads/${path.basename(post.image)}`)
        : null,
      created_at: post.created_at ? new Date(post.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      user: {
        id: post.user_id,
        username: post.username,
        display_name: post.display_name,
        avatar: post.avatar
      },
      like_count: post.like_count,
      user_liked: !!post.user_liked,
      is_bookmarked: true
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

// GET /api/posts/search?q=... - Search posts
router.get('/search', optionalAuthMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const q = (req.query.q || '').trim();
    const currentUserId = req.user?.id || null;

    if (!q || q.length < 2) return res.json([]);

    const posts = await db.all(`
      SELECT 
        p.id,
        p.content,
        p.image,
        p.created_at,
        p.is_pinned,
        u.id as user_id,
        u.username,
        u.display_name,
        u.avatar,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as like_count,
        (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as user_liked,
        (SELECT COUNT(*) FROM bookmarks WHERE post_id = p.id AND user_id = ?) as is_bookmarked,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.content LIKE ?
      ORDER BY p.created_at DESC
      LIMIT 30
    `, [currentUserId, currentUserId, `%${q}%`]);

    const formatted = posts.map(post => ({
      id: post.id,
      content: post.content,
      image: post.image
        ? (post.image.startsWith('http') ? post.image : `/uploads/${path.basename(post.image)}`)
        : null,
      created_at: post.created_at ? new Date(post.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      is_pinned: !!post.is_pinned,
      user: {
        id: post.user_id,
        username: post.username,
        display_name: post.display_name,
        avatar: post.avatar
      },
      like_count: post.like_count,
      user_liked: !!post.user_liked,
      is_bookmarked: !!post.is_bookmarked,
      comment_count: post.comment_count || 0
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Post search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ===== COMMENTS =====

// GET /api/posts/:postId/comments - get comments sorted by likes desc (most popular first)
router.get('/:postId/comments', optionalAuthMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const postId = parseInt(req.params.postId);
    const currentUserId = req.user?.id || null;

    const post = await db.get('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const comments = await db.all(`
      SELECT 
        c.id,
        c.content,
        c.created_at,
        u.id as user_id,
        u.username,
        u.display_name,
        u.avatar,
        (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) as like_count,
        (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id AND user_id = ?) as user_liked
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY like_count DESC, c.created_at DESC
    `, [currentUserId, postId]);

    const formatted = comments.map(c => ({
      id: c.id,
      content: c.content,
      created_at: c.created_at ? new Date(c.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      user: {
        id: c.user_id,
        username: c.username,
        display_name: c.display_name,
        avatar: c.avatar
      },
      like_count: c.like_count,
      user_liked: !!c.user_liked
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/posts/:postId/comments - add comment
router.post('/:postId/comments', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const postId = parseInt(req.params.postId);
    const userId = req.user.id;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    if (content.trim().length > 2000) {
      return res.status(400).json({ error: 'Comment too long (max 2000 characters)' });
    }

    const post = await db.get('SELECT id, user_id FROM posts WHERE id = ?', [postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const result = await db.run(
      'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)',
      [postId, userId, content.trim()]
    );

    await createNotification(db, post.user_id, userId, 'comment', postId, result.lastID);

    const newComment = await db.get(`
      SELECT 
        c.id, c.content, c.created_at,
        u.id as user_id, u.username, u.display_name, u.avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `, [result.lastID]);

    res.status(201).json({
      id: newComment.id,
      content: newComment.content,
      created_at: newComment.created_at ? new Date(newComment.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
      user: {
        id: newComment.user_id,
        username: newComment.username,
        display_name: newComment.display_name,
        avatar: newComment.avatar
      },
      like_count: 0,
      user_liked: false
    });
  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// DELETE /api/posts/comments/:commentId - delete own comment
router.delete('/comments/:commentId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.id;

    const comment = await db.get('SELECT user_id FROM comments WHERE id = ?', [commentId]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.user_id !== userId) return res.status(403).json({ error: 'You can only delete your own comments' });

    await db.run('DELETE FROM comments WHERE id = ?', [commentId]);
    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// POST /api/posts/comments/:commentId/like - toggle like on comment
router.post('/comments/:commentId/like', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const commentId = parseInt(req.params.commentId);
    const userId = req.user.id;

    const comment = await db.get('SELECT id, user_id FROM comments WHERE id = ?', [commentId]);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const existing = await db.get(
      'SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?',
      [userId, commentId]
    );

    if (existing) {
      await db.run('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?', [userId, commentId]);
      const count = await db.get('SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?', [commentId]);
      return res.json({ liked: false, like_count: count.count });
    } else {
      await db.run('INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)', [userId, commentId]);
      const count = await db.get('SELECT COUNT(*) as count FROM comment_likes WHERE comment_id = ?', [commentId]);
      await createNotification(db, comment.user_id, userId, 'like_comment', null, commentId);
      return res.json({ liked: true, like_count: count.count });
    }
  } catch (error) {
    console.error('Comment like error:', error);
    res.status(500).json({ error: 'Failed to toggle comment like' });
  }
});

export default router;
