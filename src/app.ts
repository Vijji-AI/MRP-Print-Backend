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
import subscriptionRequestsRoutes from './routes/subscriptionRequests';
import pricingRoutes from './routes/pricing';
import { errorHandler } from './middleware/error';

const startTime = Date.now();

export function createApp() {
  const app = express();

  // Trust the first reverse proxy in front of us (Caddy / nginx / Traefik)
  // so req.ip and X-Forwarded-* headers reflect the real client. Required
  // for the auth rate limiter to key on the actual user IP rather than the
  // proxy's loopback. Set to 0 if you ever expose the backend directly.
  app.set('trust proxy', 1);

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
        // In development, allow any localhost port (Vite auto-bumps the port
        // when 5173/5174 are already in use, so hardcoding specific ports breaks
        // login whenever a stale dev-server process holds an earlier port).
        if (
          process.env.NODE_ENV !== 'production' &&
          /^https?:\/\/localhost(:\d+)?$/.test(origin)
        ) {
          return cb(null, true);
        }
        cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      pm2:"tested by pm2",
      timestamp: new Date().toISOString(),
      service: 'PrintMRP API',
      version: '1.0.4',
      status: 'operational',
      environment: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()),
      startedAt: new Date(startTime).toISOString(),
      memoryUsage: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      autoDeployed: true,
      test:"123"
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/samples', samplesRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/prints', printsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/subscription-requests', subscriptionRequestsRoutes);
  app.use('/api/pricing', pricingRoutes);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}
