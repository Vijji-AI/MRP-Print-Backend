import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export const hashPassword = (raw: string) => bcrypt.hash(raw, ROUNDS);
export const verifyPassword = (raw: string, hash: string) =>
  bcrypt.compare(raw, hash);
