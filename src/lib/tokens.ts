import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export type Role = 'customer' | 'admin';

export interface TokenPayload {
  sub: string;       // user id
  role: Role;
  email: string;
  // For customer tokens — binds the JWT to a specific browser. requireAuth
  // verifies the matching Device row still exists, so admin revocation kicks
  // the browser out on its next request. Absent on legacy / admin tokens.
  deviceId?: string;
}

export function signToken(payload: TokenPayload) {
  const opts: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtSecret, opts);
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwtSecret);
  if (typeof decoded === 'string') throw new Error('Invalid token');
  return decoded as TokenPayload;
}
