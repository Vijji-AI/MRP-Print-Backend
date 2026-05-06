import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config';
import authRoutes from './routes/auth';
import samplesRoutes from './routes/samples';
import paymentsRoutes from './routes/payments';
import settingsRoutes from './routes/settings';
import printsRoutes from './routes/prints';
import adminRoutes from './routes/admin';
import { errorHandler } from './middleware/error';

export function createApp() {
  const app = express();

  // 10mb fits a downsized base64-encoded label image for the vision endpoint.
  // Tighter request validation happens per-route via Zod.
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (config.corsOrigins.includes('*')) return cb(null, true);
        if (config.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/samples', samplesRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/prints', printsRoutes);
  app.use('/api/admin', adminRoutes);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}
