import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const SECRET = process.env.JWT_SECRET || 'dev-secret';
const EXPIRES_IN = '30d';

export function sign(userId) {
  return jwt.sign({ uid: userId }, SECRET, { expiresIn: EXPIRES_IN });
}

/** Returns the userId, or null if the token is missing/invalid/expired. */
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    return payload.uid ?? null;
  } catch {
    return null;
  }
}
