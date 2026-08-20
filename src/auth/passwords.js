import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export async function hash(password) {
  return bcrypt.hash(password, ROUNDS);
}

export async function verify(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}
