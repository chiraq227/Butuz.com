import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import compression from 'compression';
import helmet from 'helmet';
import { initDB } from './db.js';
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import usersRoutes from './routes/users.js';
import messagesRoutes from './routes/messages.js';
import casinoRoutes from './routes/casino.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JWT secret validation.
// In production: hard fail on weak/missing secret (security).
// In development: if .env has placeholder/weak value, auto-generate a strong one and
// PERSIST it into server/.env so sessions survive `node --watch` restarts and dev reloads.
let JWT_SECRET = process.env.JWT_SECRET || '';

const isWeakSecret = !JWT_SECRET ||
  JWT_SECRET.length < 32 ||
  JWT_SECRET === 'your_super_secret_jwt_key_change_in_production' ||
  JWT_SECRET.includes('CHANGE_ME') ||
  JWT_SECRET.includes('super_secret');

if (isWeakSecret) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod') {
    console.error('FATAL: JWT_SECRET is missing, too short (<32 chars), or uses default placeholder.');
    console.error('   Generate a strong one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    console.error('   Put it in server/.env as JWT_SECRET=... (never commit .env)');
    process.exit(1);
  } else {
    // Dev: generate a strong secret and save it to .env for persistence across restarts
    const crypto = await import('crypto');
    const newSecret = crypto.randomBytes(48).toString('hex');

    const envPath = path.resolve(__dirname, '../.env');
    try {
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (/^JWT_SECRET=/m.test(envContent) || envContent.includes('JWT_SECRET=')) {
        envContent = envContent.replace(/JWT_SECRET=.*/g, `JWT_SECRET=${newSecret}`);
      } else {
        // ensure trailing newline then append
        if (envContent.length > 0 && !envContent.endsWith('\n')) envContent += '\n';
        envContent += `JWT_SECRET=${newSecret}\n`;
      }
      fs.writeFileSync(envPath, envContent);
      console.log('\n✅  Generated and saved a strong JWT_SECRET to server/.env');
      console.log('    Login sessions will now persist across server restarts (including --watch).\n');
    } catch (e) {
      console.warn('\n⚠️  Could not write JWT_SECRET to server/.env — using ephemeral secret for this run only.');
      console.warn('    Put a permanent one in server/.env to avoid "invalid or expired token" after restarts.\n');
    }

    JWT_SECRET = newSecret;
  }
}

// Expose for other modules if needed (auth routes read directly from process.env, so we also set it)
process.env.JWT_SECRET = JWT_SECRET;

const app = express();
const PORT = process.env.PORT || 5001;
const isProd = process.env.NODE_ENV === 'production';

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.CLIENT_URL, // e.g. https://yourdomain.com for production
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // IMPORTANT: Never blindly allow all origins in production.
    // Only allow explicitly configured origins (or same-origin when no Origin header).
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers (always, relaxed for SPA in dev)
app.use(helmet({
  contentSecurityPolicy: isProd ? undefined : false, // enable strict CSP in prod if you can
  crossOriginEmbedderPolicy: false,
}));

if (isProd) {
  app.use(compression());
}

// Simple in-memory rate limiter (no extra deps) to protect auth and sensitive actions.
// Includes periodic cleanup to prevent memory leak over long beta runs.
const rateLimitStore = new Map();

function createRateLimiter(windowMs, max, message = 'Too many attempts, please try again later.') {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = rateLimitStore.get(ip);

    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      rateLimitStore.set(ip, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }

    next();
  };
}

// Cleanup old rate limit entries every 5 minutes (prevents unbounded growth during beta)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.start > 30 * 60 * 1000) { // keep max 30min old entries
      rateLimitStore.delete(ip);
    }
  }
}, 5 * 60 * 1000);

const authLimiter = createRateLimiter(15 * 60 * 1000, 20);
const sensitiveLimiter = createRateLimiter(60 * 1000, 60, 'Too many requests, slow down.');
const writeActionLimiter = createRateLimiter(60 * 1000, 30, 'Too many actions, please slow down.');

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/casino', sensitiveLimiter);
app.use('/api/admin', sensitiveLimiter);

// Protect write-heavy / abuse-prone endpoints (beta spam / DoS mitigation)
app.use('/api/posts', (req, res, next) => {
  if (req.method === 'POST') return writeActionLimiter(req, res, next);
  next();
});
app.use('/api/messages', (req, res, next) => {
  if (req.method === 'POST') return writeActionLimiter(req, res, next);
  next();
});
// Follow/unfollow + profile updates (prefix match works reliably)
app.use('/api/users', (req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.path.includes('/follow') || req.method === 'PUT') {
    return writeActionLimiter(req, res, next);
  }
  next();
});

// Serve uploaded images (public by design for posts; message media is also accessible via direct URL)
// For stronger privacy in future: move behind auth middleware that verifies sender/recipient relationship.
app.use('/uploads', express.static(path.resolve(__dirname, '../uploads'), {
  maxAge: '7d',
  etag: true,
  index: false,           // prevent directory listing
  dotfiles: 'deny'
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/casino', casinoRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Butuz.com API is running' });
});

// Serve React client in production (for single-hosting deploys)
// This block must come *after* the API routes so that API calls are not caught by the SPA fallback.
if (isProd) {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist, {
    maxAge: '1y',
    etag: true,
    index: false,
  }));

  // SPA fallback for client-side routes (must be after API routes)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('Request error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large (max 25MB for posts, 15MB for messages, 5MB for avatars).' });
  }
  // In production do not leak internal details
  res.status(500).json({ error: isProd ? 'Internal server error' : (err.message || 'Something went wrong') });
});

// Start server
async function start() {
  try {
    await initDB();

    const server = app.listen(PORT, () => {
      const isProd = process.env.NODE_ENV === 'production';
      const mode = isProd ? 'PRODUCTION' : 'development';
      const baseUrl = isProd 
        ? (process.env.CLIENT_URL || `https://your-app.onrender.com`) 
        : `http://localhost:${PORT}`;

      console.log(`\n🚀 Butuz.com server running in ${mode} mode`);
      console.log(`📡 API ready at ${baseUrl}/api`);
      if (isProd) {
        console.log(`🌐 Frontend served from the same server (SPA + /uploads)`);
        console.log(`   Make sure CLIENT_URL env var is set to your production domain if needed.`);
      } else {
        console.log(`\nRun "npm run seed" (in server folder) to completely reset the database.\n`);
      }
    });

    // Handle port already in use
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Ошибка: Порт ${PORT} уже занят.`);
        console.error('Возможные причины:');
        console.error('  • Предыдущий запуск сервера всё ещё работает');
        console.error(`  • Другая программа использует порт ${PORT}`);
        console.error('\nРешение:');
        console.error('  1. Остановите предыдущий процесс (Ctrl+C)');
        console.error('  2. Или выполните команду:');
        console.error(`     lsof -ti:${PORT} | xargs kill -9`);
        console.error('\n  3. Или измените порт в файле .env (PORT=5002) и перезапустите.\n');
        process.exit(1);
      } else {
        console.error('Server error:', err);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Останавливаем сервер...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Останавливаем сервер...');
  process.exit(0);
});
