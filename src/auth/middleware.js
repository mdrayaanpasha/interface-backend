import { verifyToken } from './jwt.js';

/** Express middleware: require a valid Bearer token, set req.userId. */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    return res.status(401).json({ error: 'authentication required' });
  }
  req.userId = userId;
  next();
}
