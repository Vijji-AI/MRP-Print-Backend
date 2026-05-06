import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      issues: err.flatten(),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
}
