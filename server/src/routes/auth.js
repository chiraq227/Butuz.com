import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDB } from '../db.js';

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  const { username, email, password, display_name } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (username.length > 32 || display_name && display_name.length > 64) {
    return res.status(400).json({ error: 'Username or display name too long' });
  }

  try {
    const db = getDB();

    // Check if user exists (case-insensitive for username)
    const existing = await db.get(
      'SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR email = ?',
      [username, email]
    );

    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists (usernames are case-insensitive)' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.run(
      `INSERT INTO users (username, email, password, display_name, avatar)
       VALUES (?, ?, ?, ?, ?)`,
      [
        username,
        email,
        hashedPassword,
        display_name || username,
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`
      ]
    );

    const userId = result.lastID;

    const token = jwt.sign(
      { id: userId, username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: userId,
        username,
        email,
        display_name: display_name || username,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        theme: 'default'
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { emailOrUsername, password } = req.body;

  if (!emailOrUsername || !password) {
    return res.status(400).json({ error: 'Email/username and password are required' });
  }

  try {
    const db = getDB();

    const user = await db.get(
      `SELECT * FROM users WHERE email = ? OR LOWER(username) = LOWER(?)`,
      [emailOrUsername, emailOrUsername]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        avatar: user.avatar,
        bio: user.bio,
        theme: user.theme || 'default'
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  // This route expects Authorization header handled by middleware in protected routes
  // For simplicity, we will use a protected version in users route
  res.status(400).json({ error: 'Use /users/me with Authorization header' });
});

export default router;
