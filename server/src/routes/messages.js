import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getDB } from '../db.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } from '../lib/cloudinary.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads dir (shared with posts)
const uploadsDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer for message attachments (images, videos, voice)
const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const rand = crypto.randomBytes(12).toString('hex');
    let ext = path.extname(file.originalname || '').toLowerCase();
    if (!/^\.(jpe?g|png|gif|webp|mp4|webm|mov|mp3|wav|ogg|m4a|mpeg)$/.test(ext)) ext = '.bin';
    cb(null, `${Date.now()}-${rand}${ext}`);
  }
});

const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — reasonable for chat voice/video
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic|heif|avif|mp4|webm|mov|mpeg|mp3|wav|ogg|oga/;
    const originalName = file.originalname || '';
    const ext = allowed.test(path.extname(originalName).toLowerCase());
    const mime = allowed.test(file.mimetype || '');
    if (ext || mime) {
      cb(null, true);
    } else {
      cb(new Error('Неподдерживаемый тип файла (только изображения, видео и аудио)'));
    }
  }
});

// POST /api/messages/keys - Upload public key for secret chats
router.post('/keys', authMiddleware, async (req, res) => {
  const { public_key } = req.body; // expect JSON.stringify(jwk) or raw JWK string
  const userId = req.user.id;

  if (!public_key || typeof public_key !== 'string' || public_key.length < 10) {
    return res.status(400).json({ error: 'Valid public_key (JWK) is required' });
  }

  try {
    const db = getDB();
    await db.run('UPDATE users SET public_key = ? WHERE id = ?', [public_key, userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Upload public key error:', error);
    res.status(500).json({ error: 'Failed to save public key' });
  }
});

// GET /api/messages/keys/:userId - Get public key for secret chat
router.get('/keys/:userId', authMiddleware, async (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (!targetId) return res.status(400).json({ error: 'Invalid userId' });

  try {
    const db = getDB();
    const row = await db.get('SELECT id, username, public_key FROM users WHERE id = ?', [targetId]);
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (!row.public_key) {
      return res.status(404).json({ error: 'User has not enabled encrypted messaging yet' });
    }
    res.json({ user_id: row.id, username: row.username, public_key: row.public_key });
  } catch (error) {
    console.error('Get public key error:', error);
    res.status(500).json({ error: 'Failed to fetch public key' });
  }
});

// POST /api/messages — send regular message (text and/or media attachment)
// Supports both JSON (text only) and multipart/form-data (when attaching photo/video/voice)
router.post('/', authMiddleware, mediaUpload.single('media'), async (req, res) => {
  const senderId = req.user.id;

  // When using FormData, fields come as strings
  const recipientId = parseInt(req.body.recipient_id);
  const text = (req.body.content || '').trim();
  const clientDuration = req.body.duration ? parseInt(req.body.duration) : null;

  if (!recipientId) {
    return res.status(400).json({ error: 'recipient_id is required' });
  }
  if (recipientId === senderId) {
    return res.status(400).json({ error: 'Cannot message yourself' });
  }

  // Either text or media (or both) must be present
  const hasMedia = !!req.file;
  if (!text && !hasMedia) {
    return res.status(400).json({ error: 'Message must contain either text or a media attachment' });
  }
  if (text && text.length > 4000) {
    return res.status(400).json({ error: 'Message text too long (max 4000 chars)' });
  }

  try {
    const db = getDB();
    const recipient = await db.get('SELECT id FROM users WHERE id = ?', [recipientId]);
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    let mediaPath = null;
    let mediaType = null;
    let mediaDuration = null;

    if (hasMedia && req.file) {
      const uploadedFull = req.file.path;

      const mime = req.file.mimetype || '';
      const ext = path.extname(req.file.originalname || '').toLowerCase();

      if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/.test(ext)) {
        mediaType = 'image';
      } else if (mime.startsWith('video/') || /\.(mp4|webm|mov)$/.test(ext)) {
        mediaType = 'video';
      } else if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|oga|m4a)$/.test(ext)) {
        mediaType = 'voice';
        mediaDuration = clientDuration || null; // client should send duration for voice
      } else {
        mediaType = 'file'; // fallback
      }

      // Upload to Cloudinary
      try {
        const folder = mediaType === 'image' ? 'butuz/messages/images' : mediaType === 'video' ? 'butuz/messages/videos' : 'butuz/messages/audio';
        const resourceType = mediaType === 'image' ? 'image' : 'video'; // voice as video resource in cloudinary
        const cloudResult = await uploadToCloudinary(uploadedFull, {
          folder,
          resource_type: resourceType,
        });
        mediaPath = cloudResult.url; // full cloudinary url
      } catch (cloudErr) {
        console.error('Cloudinary message media upload failed:', cloudErr.message);
        const hasCloudinaryConfig = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
        if (hasCloudinaryConfig) {
          try { fs.unlinkSync(uploadedFull); } catch (_) {}
          throw new Error('Failed to upload media to permanent storage.');
        } else {
          console.warn('Falling back to local storage for message media (no Cloudinary config)');
          mediaPath = path.basename(uploadedFull);
        }
      }
    }

    const result = await db.run(
      `INSERT INTO messages (sender_id, recipient_id, content, media_path, media_type, media_duration)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [senderId, recipientId, text || '', mediaPath, mediaType, mediaDuration]
    );

    const created = await db.get(
      'SELECT id, sender_id, recipient_id, content, media_path, media_type, media_duration, created_at FROM messages WHERE id = ?',
      [result.lastID]
    );

    if (!created) {
      throw new Error('Could not retrieve the created message after insert');
    }

    const mediaUrl = created.media_path
      ? (created.media_path.startsWith('http') ? created.media_path : `/uploads/${path.basename(created.media_path)}`)
      : null;

    res.status(201).json({
      id: created.id,
      sender_id: created.sender_id,
      recipient_id: created.recipient_id,
      content: created.content,
      media_url: mediaUrl,
      media_type: created.media_type,
      media_duration: created.media_duration,
      created_at: created.created_at ? new Date(created.created_at.replace(' ', 'T') + 'Z').toISOString() : null
    });
  } catch (error) {
    console.error('Send regular message (with media) error:', error);
    // Clean up uploaded file on DB failure
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/messages/conversations — list of regular conversations
router.get('/conversations', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const mode = (req.query.mode || 'regular').toString();

  try {
    const db = getDB();
    const table = mode === 'secret' ? 'direct_messages' : 'messages';

    const rows = await db.all(`
      SELECT 
        other_id,
        MAX(created_at) as last_at,
        (SELECT content FROM ${table} mm 
          WHERE (mm.sender_id = ? OR mm.recipient_id = ?) 
            AND (CASE WHEN mm.sender_id = ? THEN mm.recipient_id ELSE mm.sender_id END) = main.other_id 
          ORDER BY mm.created_at DESC, mm.id DESC 
          LIMIT 1) as last_text
      FROM (
        SELECT 
          CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as other_id,
          created_at
        FROM ${table}
        WHERE sender_id = ? OR recipient_id = ?
      ) as main
      GROUP BY other_id
      ORDER BY last_at DESC
      LIMIT 100
    `, [userId, userId, userId, userId, userId, userId]);

    if (rows.length === 0) {
      return res.json([]);
    }

    const otherIds = rows.map(r => r.other_id);
    const placeholders = otherIds.map(() => '?').join(',');

    const users = await db.all(`
      SELECT id, username, display_name, avatar, public_key
      FROM users
      WHERE id IN (${placeholders})
    `, otherIds);

    const byId = Object.fromEntries(users.map(u => [u.id, u]));
    const convos = rows
      .map(r => {
        const u = byId[r.other_id];
        if (!u) return null;
        return {
          user: {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar: u.avatar,
            has_public_key: !!u.public_key
          },
          last_at: r.last_at ? new Date(r.last_at.replace(' ', 'T') + 'Z').toISOString() : null,
          mode
        };
      })
      .filter(Boolean);

    res.json(convos);
  } catch (error) {
    console.error('Conversations error:', error);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// GET /api/messages/unread-count — total unread (regular + secret) for badge + toasts
// IMPORTANT: must be registered BEFORE the /:userId param route, otherwise "unread-count" gets captured as userId and returns 400.
router.get('/unread-count', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const db = getDB();
    const reg = await db.get(
      `SELECT COUNT(*) as c FROM messages WHERE recipient_id = ? AND read = 0`,
      [userId]
    );
    const sec = await db.get(
      `SELECT COUNT(*) as c FROM direct_messages WHERE recipient_id = ? AND read = 0`,
      [userId]
    );
    const count = (reg?.c || 0) + (sec?.c || 0);
    res.json({ count });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to count unread' });
  }
});

// GET /api/messages/unread — recent unread messages for toasts (includes sender info)
// Must be before /:userId too.
router.get('/unread', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(10, Math.max(1, parseInt(req.query.limit) || 5));
  try {
    const db = getDB();

    const reg = await db.all(`
      SELECT 
        m.id,
        m.sender_id,
        m.content as text,
        m.created_at,
        'regular' as mode,
        u.username as sender_username,
        u.display_name as sender_name,
        u.avatar as sender_avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.recipient_id = ? AND m.read = 0
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?
    `, [userId, limit]);

    const sec = await db.all(`
      SELECT 
        dm.id,
        dm.sender_id,
        NULL as text,
        dm.created_at,
        'secret' as mode,
        u.username as sender_username,
        u.display_name as sender_name,
        u.avatar as sender_avatar
      FROM direct_messages dm
      JOIN users u ON u.id = dm.sender_id
      WHERE dm.recipient_id = ? AND dm.read = 0
      ORDER BY dm.created_at DESC, dm.id DESC
      LIMIT ?
    `, [userId, limit]);

    const all = [...reg, ...sec]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, limit)
      .map(r => ({
        id: r.id,
        sender_id: r.sender_id,
        text: r.text || null,
        mode: r.mode,
        created_at: r.created_at ? new Date(r.created_at.replace(' ', 'T') + 'Z').toISOString() : null,
        sender: {
          id: r.sender_id,
          username: r.sender_username,
          display_name: r.sender_name,
          avatar: r.sender_avatar
        }
      }));

    res.json(all);
  } catch (error) {
    console.error('Unread messages error:', error);
    res.status(500).json({ error: 'Failed to load unread messages' });
  }
});

// GET /api/messages/:userId — regular message history
router.get('/:userId', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const otherId = parseInt(req.params.userId);
  if (!otherId) return res.status(400).json({ error: 'Invalid userId' });

  // default to regular messages
  try {
    const db = getDB();

    const msgs = await db.all(`
      SELECT id, sender_id, recipient_id, content, media_path, media_type, media_duration, created_at
      FROM messages
      WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
      ORDER BY created_at ASC, id ASC
      LIMIT 500
    `, [userId, otherId, otherId, userId]);

    const formatted = msgs.map(m => ({
      id: m.id,
      sender_id: m.sender_id,
      recipient_id: m.recipient_id,
      content: m.content,
      media_url: m.media_path ? `/uploads/${path.basename(m.media_path)}` : null,
      media_type: m.media_type,
      media_duration: m.media_duration,
      created_at: m.created_at ? new Date(m.created_at.replace(' ', 'T') + 'Z').toISOString() : null
    }));

    // Mark incoming messages as read when the user opens the chat
    try {
      await db.run(
        `UPDATE messages SET read = 1 WHERE recipient_id = ? AND sender_id = ? AND read = 0`,
        [userId, otherId]
      );
    } catch (e) { /* non-fatal */ }

    res.json(formatted);
  } catch (error) {
    console.error('Get regular messages error:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /api/messages/secret — send encrypted message (ciphertext only)
router.post('/secret', authMiddleware, async (req, res) => {
  const senderId = req.user.id;
  const { recipient_id, ciphertext, iv } = req.body;

  const recipientId = parseInt(recipient_id);
  if (!recipientId || !ciphertext || !iv) {
    return res.status(400).json({ error: 'recipient_id, ciphertext and iv are required' });
  }
  if (recipientId === senderId) {
    return res.status(400).json({ error: 'Cannot message yourself' });
  }

  try {
    const db = getDB();

    const recipient = await db.get('SELECT id FROM users WHERE id = ?', [recipientId]);
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const recWithKey = await db.get('SELECT public_key FROM users WHERE id = ?', [recipientId]);
    if (!recWithKey?.public_key) {
      return res.status(400).json({ error: 'Recipient has not enabled secret chats yet. Ask them to open Messages → Секретные чаты once.' });
    }

    const result = await db.run(
      `INSERT INTO direct_messages (sender_id, recipient_id, ciphertext, iv) VALUES (?, ?, ?, ?)`,
      [senderId, recipientId, ciphertext, iv]
    );

    const created = await db.get(
      'SELECT id, sender_id, recipient_id, ciphertext, iv, created_at FROM direct_messages WHERE id = ?',
      [result.lastID]
    );

    res.status(201).json({
      id: created.id,
      sender_id: created.sender_id,
      recipient_id: created.recipient_id,
      ciphertext: created.ciphertext,
      iv: created.iv,
      created_at: created.created_at ? new Date(created.created_at.replace(' ', 'T') + 'Z').toISOString() : null
    });
  } catch (error) {
    console.error('Send secret message error:', error);
    res.status(500).json({ error: 'Failed to send secret message' });
  }
});

// GET /api/messages/secret/conversations — list of secret conversations
router.get('/secret/conversations', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const db = getDB();

    const rows = await db.all(`
      SELECT 
        other_id,
        MAX(created_at) as last_at
      FROM (
        SELECT 
          CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as other_id,
          created_at
        FROM direct_messages
        WHERE sender_id = ? OR recipient_id = ?
      )
      GROUP BY other_id
      ORDER BY last_at DESC
      LIMIT 100
    `, [userId, userId, userId]);

    if (rows.length === 0) {
      return res.json([]);
    }

    const otherIds = rows.map(r => r.other_id);
    const placeholders = otherIds.map(() => '?').join(',');

    const users = await db.all(`
      SELECT id, username, display_name, avatar, public_key
      FROM users
      WHERE id IN (${placeholders})
    `, otherIds);

    const byId = Object.fromEntries(users.map(u => [u.id, u]));
    const convos = rows
      .map(r => {
        const u = byId[r.other_id];
        if (!u) return null;
        return {
          user: {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar: u.avatar,
            has_public_key: !!u.public_key
          },
          last_at: r.last_at ? new Date(r.last_at.replace(' ', 'T') + 'Z').toISOString() : null,
          mode: 'secret'
        };
      })
      .filter(Boolean);

    res.json(convos);
  } catch (error) {
    console.error('Secret conversations error:', error);
    res.status(500).json({ error: 'Failed to load secret conversations' });
  }
});

// GET /api/messages/secret/:userId — secret message history (encrypted)
router.get('/secret/:userId', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const otherId = parseInt(req.params.userId);
  if (!otherId) return res.status(400).json({ error: 'Invalid userId' });

  try {
    const db = getDB();

    const msgs = await db.all(`
      SELECT id, sender_id, recipient_id, ciphertext, iv, created_at
      FROM direct_messages
      WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
      ORDER BY created_at ASC, id ASC
      LIMIT 500
    `, [userId, otherId, otherId, userId]);

    const formatted = msgs.map(m => ({
      id: m.id,
      sender_id: m.sender_id,
      recipient_id: m.recipient_id,
      ciphertext: m.ciphertext,
      iv: m.iv,
      created_at: m.created_at ? new Date(m.created_at.replace(' ', 'T') + 'Z').toISOString() : null
    }));

    // Mark incoming secret messages as read when the user opens the chat
    try {
      await db.run(
        `UPDATE direct_messages SET read = 1 WHERE recipient_id = ? AND sender_id = ? AND read = 0`,
        [userId, otherId]
      );
    } catch (e) { /* non-fatal */ }

    res.json(formatted);
  } catch (error) {
    console.error('Get secret messages error:', error);
    res.status(500).json({ error: 'Failed to load secret messages' });
  }
});

export default router;
