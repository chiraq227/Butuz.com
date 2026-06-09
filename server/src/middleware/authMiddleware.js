import jwt from 'jsonwebtoken';

export function authMiddleware(req, res, next) {
  // Use req.get() which is case-insensitive and more reliable across proxies (Cloudflare, Render, etc.)
  const authHeader = req.get('Authorization') || req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Optional auth middleware.
 * If a valid Bearer token is provided, sets req.user.
 * If no token or invalid token, continues without error (guest mode).
 * Useful for public endpoints that want to personalize (likes, is_following, etc.).
 */
export function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.get('Authorization') || req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    // Invalid token — treat as guest, do not block the request
    req.user = null;
  }
  next();
}
