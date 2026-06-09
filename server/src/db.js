import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;
let isUsingTurso = false;

/**
 * Creates a thin adapter so the rest of the code can use the same
 * db.get(sql, params), db.all(sql, params), db.run(sql, params), db.exec(sql)
 * interface whether we are on local SQLite or Turso (libSQL).
 */
function createTursoAdapter(client) {
  return {
    async get(sql, params = []) {
      const result = await client.execute({ sql, args: params || [] });
      return result.rows.length > 0 ? result.rows[0] : undefined;
    },
    async all(sql, params = []) {
      const result = await client.execute({ sql, args: params || [] });
      return result.rows;
    },
    async run(sql, params = []) {
      const result = await client.execute({ sql, args: params || [] });
      return {
        lastID: result.lastInsertRowid,
        changes: result.rowsAffected || 0,
      };
    },
    async exec(sql) {
      // Turso execute supports one statement. For big schema blocks we split by semicolon.
      // This is "good enough" for our CREATE TABLE / ALTER / PRAGMA blocks.
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      for (const stmt of statements) {
        try {
          await client.execute(stmt);
        } catch (e) {
          // Ignore "already exists" type errors for CREATE IF NOT EXISTS / ALTER
          if (!/already exists|duplicate column/i.test(e.message || '')) {
            throw e;
          }
        }
      }
    },
  };
}

export async function initDB() {
  // === TURSO (recommended for production / free hosting) ===
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    isUsingTurso = true;
    const { createClient } = await import('@libsql/client');

    const turso = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    db = createTursoAdapter(turso);

    console.log('Using Turso (libSQL) database');

    // Turso doesn't need the same PRAGMAs. We still want foreign keys.
    await db.exec('PRAGMA foreign_keys = ON;');

    // Create tables + migrations (the big block below)
  } else {
    // === LOCAL SQLITE (development) ===
    const dbPath = process.env.DB_PATH || './butuz.db';
    const fullPath = path.resolve(__dirname, '..', dbPath);

    db = await open({
      filename: fullPath,
      driver: sqlite3.Database
    });

    console.log(`Using local SQLite database: ${dbPath}`);

    // Enable foreign keys
    await db.exec('PRAGMA foreign_keys = ON');

    // Production/beta robustness for SQLite (concurrent reads/writes friendly, less locking)
    await db.exec('PRAGMA journal_mode = WAL;');
    await db.exec('PRAGMA synchronous = NORMAL;');
    await db.exec('PRAGMA temp_store = MEMORY;');
    await db.exec('PRAGMA mmap_size = 30000000000;'); // ~30MB mmap if supported (harmless if not)
  }

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      bio TEXT,
      theme TEXT DEFAULT 'default',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      image TEXT,
      is_pinned BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      comment_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, comment_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,      -- recipient
      actor_id INTEGER NOT NULL,     -- who performed the action
      type TEXT NOT NULL,            -- 'follow', 'like', 'comment', 'bookmark', 'like_comment'
      post_id INTEGER,
      comment_id INTEGER,
      is_read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );
  `);

  // Safe column additions for existing DBs (SQLite ignores if column exists in recent versions, use try/catch)
  try { await db.exec(`ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'default'`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN theme TEXT`); } catch (_) {} // older sqlite may complain on duplicate, ignored
  try { await db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`); } catch (_) {}
  // E2EE: per-user public key (JWK JSON). Private key NEVER leaves the client browser.
  try { await db.exec(`ALTER TABLE users ADD COLUMN public_key TEXT`); } catch (_) {}

  // Case-insensitive unique usernames: prevent "butuz", "Butuz", "BUTUZ" etc. from coexisting.
  // Only exact match (ignoring case) is allowed. Variants with numbers (e.g. butuz1) are different.
  try { await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))`); } catch (_) {}

  // Performance indexes for common queries (feed, likes, messages, follows) - safe IF NOT EXISTS
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts (user_id, created_at DESC)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_likes_post ON likes (post_id)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_likes_user_post ON likes (user_id, post_id)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks (user_id, created_at DESC)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_recipient_read ON messages (recipient_id, read, created_at)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient ON direct_messages (recipient_id, created_at)`); } catch (_) {}
  try { await db.exec(`CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id)`); } catch (_) {}

  try { await db.exec(`ALTER TABLE posts ADD COLUMN comment_count INTEGER DEFAULT 0`); } catch (_) {} // if needed for denormalized, but we use subquery
  try { await db.exec(`ALTER TABLE posts ADD COLUMN is_pinned BOOLEAN DEFAULT 0`); } catch (_) {}

  // ============================================
  // BUTUZ CASINO INTEGRATION - full port from butuz-cas-bu
  // ============================================
  // Per-user casino economy (separate from main social, but linked 1:1 by user id)
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_balance INTEGER DEFAULT 1000000`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_bank_balance INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_level INTEGER DEFAULT 1`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_xp INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_rating INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_vip INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_games_played INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_total_won INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_total_lost INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_daily_last TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_streak INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_last_bet INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_joined TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_mining TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_businesses TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_achievements TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_transfers TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_banned INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE users ADD COLUMN casino_hide_balance INTEGER DEFAULT 0`); } catch (_) {}

  // Active game sessions for interactive games (mines, blackjack)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS casino_game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_type TEXT NOT NULL,
      bet INTEGER NOT NULL,
      state TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // PvP rooms for dice and coin (persistent across requests)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS casino_pvp_rooms (
      room_id TEXT PRIMARY KEY,
      game_type TEXT NOT NULL, -- 'dice' or 'coin'
      p1_id INTEGER NOT NULL,
      p2_id INTEGER,
      bet INTEGER NOT NULL,
      p1_choice TEXT,
      p2_choice TEXT,
      status TEXT DEFAULT 'wait', -- wait, choosing, finished
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (p1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (p2_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Timed interest deposits (срочные вклады). Money locked until matures_at; higher rate => lower max principal allowed per tier.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS casino_deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tier_id TEXT NOT NULL,
      principal INTEGER NOT NULL,
      rate REAL NOT NULL,          -- e.g. 12 for 12%
      term_days INTEGER NOT NULL,
      start_at TEXT NOT NULL,
      matures_at TEXT NOT NULL,
      claimed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Admin action audit log (for casino admin panel accountability)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS casino_admin_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_username TEXT NOT NULL DEFAULT 'butuz',
      target_username TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Regular messages (simple chats) — plaintext content. Fast, works for any users immediately, perfect async.
  // Extended with optional media attachments (photo / video / voice). Media is stored as files in /uploads (same as posts).
  // Note: content can be empty string ('') for pure-media messages. Legacy DBs may still have NOT NULL on content,
  // so we always insert '' instead of NULL (see messages route + migration below).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      content TEXT,
      media_path TEXT,
      media_type TEXT,           -- 'image' | 'video' | 'voice'
      media_duration INTEGER,    -- seconds (mainly for voice)
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read INTEGER DEFAULT 0,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Secret / E2EE direct messages. Server stores ONLY ciphertext + iv. No plaintext ever.
  // Used exclusively for "Секретный чат" mode (full end-to-end, keys never leave client).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read INTEGER DEFAULT 0,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Add read columns for existing DBs (idempotent)
  try { await db.exec(`ALTER TABLE messages ADD COLUMN read INTEGER DEFAULT 0`); } catch (_) {}
  try { await db.exec(`ALTER TABLE direct_messages ADD COLUMN read INTEGER DEFAULT 0`); } catch (_) {}

  // Media attachment columns for regular messages (idempotent, safe for existing DBs)
  try { await db.exec(`ALTER TABLE messages ADD COLUMN media_path TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE messages ADD COLUMN media_type TEXT`); } catch (_) {}
  try { await db.exec(`ALTER TABLE messages ADD COLUMN media_duration INTEGER`); } catch (_) {}

  // Ensure no NULLs in content for old rows (NOT NULL constraint still exists on legacy DBs).
  // We now allow empty string for pure-media messages.
  try { await db.run(`UPDATE messages SET content = '' WHERE content IS NULL`); } catch (_) {}

  // For new users on fresh hosting DBs, ensure defaults if needed (register always sets avatar)

  console.log('Database initialized successfully');
  return db;
}

export function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}
