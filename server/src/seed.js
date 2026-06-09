import { initDB, getDB } from './db.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seed() {
  try {
    // Resolve the database file path (same logic as in db.js)
    const dbFile = process.env.DB_PATH || './butuz.db';
    const fullDbPath = path.resolve(__dirname, '..', dbFile);

    // Try to physically delete the database file for a true fresh start.
    // This often fails if the server is still running (file is locked by SQLite).
    const dbFiles = [
      fullDbPath,
      `${fullDbPath}-wal`,
      `${fullDbPath}-shm`,
      `${fullDbPath}-journal`
    ];
    let deletedFile = false;
    dbFiles.forEach(f => {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
          deletedFile = true;
        } catch (e) {
          // ignore - file is locked
        }
      }
    });

    if (deletedFile) {
      console.log(`🗑️  Deleted database file: ${dbFile}`);
    } else {
      console.log('ℹ️  Could not delete the database file (server is probably still running and holding the lock).');
      console.log('   Performing full data wipe via SQL instead (this should still work).');
    }

    // Clean uploaded files (avatars, post images etc.)
    const uploadsDir = path.resolve(__dirname, '..', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      try {
        fs.rmSync(uploadsDir, { recursive: true, force: true });
        fs.mkdirSync(uploadsDir, { recursive: true });
        console.log('🗑️  Cleaned uploads directory (avatars, images, etc.)');
      } catch (e) {
        console.log('ℹ️  Could not fully clean uploads folder:', e.message);
      }
    }

    // Re-initialize (or connect to) the database
    await initDB();
    const db = getDB();

    // Disable foreign keys temporarily for safe bulk delete
    await db.run('PRAGMA foreign_keys = OFF');

    // Full wipe of ALL user data and history
    console.log('Wiping all records from the database...');
    await db.run('DELETE FROM direct_messages');
    await db.run('DELETE FROM notifications');
    await db.run('DELETE FROM comment_likes');
    await db.run('DELETE FROM comments');
    await db.run('DELETE FROM bookmarks');
    await db.run('DELETE FROM likes');
    await db.run('DELETE FROM posts');
    await db.run('DELETE FROM follows');
    await db.run('DELETE FROM users');

    // Re-enable foreign keys and vacuum to clean up the file
    await db.run('PRAGMA foreign_keys = ON');
    await db.run('VACUUM');

    console.log('\n✅ Database completely cleaned.');
    console.log('ALL users and their entire history have been removed:');
    console.log('  - Users, emails, passwords, avatars (DB + files)');
    console.log('  - Posts, comments, likes, bookmarks');
    console.log('  - Follows / subscriptions');
    console.log('  - Private messages');
    console.log('  - Notifications');
    console.log('The database is now 100% empty (zero accounts).');
    console.log('Restart the server and register your first user.');
  } catch (error) {
    console.error('Seed / cleanup error:', error);
  }
}

seed();
