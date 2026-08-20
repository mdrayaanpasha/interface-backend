import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { hash, verify } from '../auth/passwords.js';
import { sign } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Columns returned to the client as the user's profile.
const PROFILE_COLS =
  'id, email, display_name, org_name, org_industry, org_country, avatar_seed, created_at';

function randomSeed() {
  return randomBytes(6).toString('hex');
}

function validCreds(email, password) {
  if (!email || !EMAIL_RE.test(email)) return 'a valid email is required';
  if (!password || password.length < 6) return 'password must be at least 6 characters';
  return null;
}

router.post('/signup', async (req, res) => {
  const { email, password } = req.body || {};
  const err = validCreds(email, password);
  if (err) return res.status(400).json({ error: err });

  try {
    const passwordHash = await hash(password);
    const ins = await pool.query(
      `INSERT INTO users (email, password_hash, avatar_seed) VALUES ($1,$2,$3) RETURNING ${PROFILE_COLS}`,
      [email.toLowerCase(), passwordHash, randomSeed()]
    );
    res.status(201).json({ token: sign(ins.rows[0].id), user: ins.rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'email already registered' });
    }
    console.error('[auth] signup failed:', e.message);
    res.status(500).json({ error: 'signup failed' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    const q = await pool.query(
      `SELECT ${PROFILE_COLS}, password_hash FROM users WHERE email=$1`,
      [email.toLowerCase()]
    );
    const user = q.rows[0];
    if (!user || !(await verify(password, user.password_hash))) {
      return res.status(401).json({ error: 'invalid email or password' });
    }
    delete user.password_hash;
    res.json({ token: sign(user.id), user });
  } catch (e) {
    console.error('[auth] login failed:', e.message);
    res.status(500).json({ error: 'login failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const q = await pool.query(`SELECT ${PROFILE_COLS} FROM users WHERE id=$1`, [req.userId]);
  if (!q.rows[0]) return res.status(404).json({ error: 'user not found' });
  res.json({ user: q.rows[0] });
});

// Update editable profile fields. Only whitelisted keys are accepted.
router.put('/profile', requireAuth, async (req, res) => {
  const body = req.body || {};
  const allowed = ['display_name', 'org_name', 'org_industry', 'org_country', 'avatar_seed'];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in body) {
      values.push(body[key] === '' ? null : body[key]);
      updates.push(`${key}=$${values.length}`);
    }
  }
  if (!updates.length) {
    const q = await pool.query(`SELECT ${PROFILE_COLS} FROM users WHERE id=$1`, [req.userId]);
    return res.json({ user: q.rows[0] });
  }
  values.push(req.userId);
  const q = await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING ${PROFILE_COLS}`,
    values
  );
  res.json({ user: q.rows[0] });
});

export default router;
