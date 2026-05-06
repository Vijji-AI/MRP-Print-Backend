import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type TokenPayload } from '../lib/tokens';
import { unauthorized, forbidden } from '../lib/errors';
import { prisma } from '../lib/prisma';

declare global {
  namespace Express {
    interface Request {
      auth?: TokenPayload;
    }
  }
}

function readToken(req: Request): string | null {
  const h = req.header('authorization');
  if (!h) return null;
  if (!h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim() || null;
}

export function authOptional(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next();
  try {
    req.auth = verifyToken(token);
  } catch {
    // ignore — treat as anonymous
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next(unauthorized());
  let payload: TokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
  req.auth = payload;

  // If the customer token is bound to a device, verify that device hasn't
  // been revoked by an admin. Tokens minted before this feature shipped have
  // no deviceId — those keep working until the user signs in again.
  if (payload.role === 'customer' && payload.deviceId) {
    prisma.device
      .findUnique({
        where: { customerId_deviceId: { customerId: payload.sub, deviceId: payload.deviceId } },
        select: { id: true },
      })
      .then((d) => {
        if (!d) return next(unauthorized('Device has been signed out by an admin'));
        // Best-effort lastSeen update; we don't await it to keep the request fast.
        prisma.device
          .update({
            where: { customerId_deviceId: { customerId: payload.sub, deviceId: payload.deviceId! } },
            data: { lastSeenAt: new Date() },
          })
          .catch(() => undefined);
        next();
      })
      .catch((e) => next(e));
    return;
  }
  next();
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.role !== 'customer') return next(forbidden('Customer access required'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.role !== 'admin') return next(forbidden('Admin access required'));
  next();
}
