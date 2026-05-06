import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return next(parsed.error);
    // overwrite with parsed/coerced values
    (req as any)[source] = parsed.data;
    next();
  };
}
