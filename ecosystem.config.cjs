// PM2 process file for the PrintMRP backend.
//
// Single fork-mode instance is intentional: express-rate-limit uses an
// in-memory store, so running multiple instances would split rate-limit
// counters per process and weaken the auth limiter.
//
// dotenv/config is imported in src/index.ts → src/config.ts, so PM2 does not
// need to pass envs explicitly — the `.env` next to package.json is loaded
// automatically when PM2 starts the process with cwd at the project root.
//
// Usage on the VPS (run from the repo root):
//   npm ci
//   npm run build
//   npx prisma generate
//   npx prisma migrate deploy
//   node prisma/seed.cjs
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup     # survive reboots
//
// Common commands:
//   pm2 status
//   pm2 logs printmrp-api
//   pm2 restart printmrp-api
//   pm2 reload printmrp-api     # zero-downtime restart
//   pm2 stop printmrp-api

module.exports = {
  apps: [
    {
      name: 'printmrp-api',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
