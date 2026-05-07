# PrintMRP Backend Deployment Guide

## Quick Start (Local)

### Prerequisites
- Docker & Docker Compose installed
- PostgreSQL 16 (via Docker)

### Development Setup
```bash
cd printing-mrp
docker compose -f docker-compose.backend.yml up -d --build
```

Backend will be available at: `http://localhost:4000`

### Useful Commands
```bash
# View logs
docker compose -f docker-compose.backend.yml logs -f backend

# Access the database
docker compose -f docker-compose.backend.yml exec db psql -U printmrp -d printmrp

# Run migrations
docker compose -f docker-compose.backend.yml exec backend npm run prisma:migrate:dev

# Rebuild without cache
docker compose -f docker-compose.backend.yml up -d --build --no-cache

# Stop everything
docker compose -f docker-compose.backend.yml down

# Stop and delete database
docker compose -f docker-compose.backend.yml down -v
```

## Environment Variables

Create a `.env` file in the project root to override defaults:

```env
# Database
POSTGRES_PASSWORD=your-secure-password
DB_PORT=5432

# JWT
JWT_SECRET=your-long-random-secret-here
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGINS=http://localhost:3000,https://yourfrontend.com

# Admin seeding
SEED_ADMIN_EMAIL=admin@printmrp.app
SEED_ADMIN_PASSWORD=securepassword
SEED_ADMIN_NAME=Admin User

# Server
APP_PORT=4000
NODE_ENV=production
```

## GitHub Actions CI/CD

### Setup Secrets in GitHub
Go to your repository → Settings → Secrets and variables → Actions

Add these secrets:
- `DOCKER_USERNAME` - Docker Hub username
- `DOCKER_PASSWORD` - Docker Hub token/password
- `DEPLOY_WEBHOOK_URL` - (optional) Webhook URL for deployment notifications

### CI/CD Pipeline
The workflow (`.github/workflows/backend-ci.yml`) automatically:
1. **On Every Push/PR to master:**
   - Runs linter (TypeScript)
   - Builds the application
   - Builds Docker image
   
2. **On Push to master (after successful test):**
   - Pushes Docker image to Docker Hub
   - Triggers deployment webhook (if configured)

## Production Deployment

### Option 1: Docker Compose on VPS/Server
```bash
# SSH into your server
ssh user@your-server.com

# Clone repository
git clone https://github.com/Vijji-AI/MRP-Print-Backend.git
cd MRP-Print-Backend

# Set up environment
cp backend/.env.example .env
# Edit .env with production values
nano .env

# Deploy
docker compose -f docker-compose.backend.yml up -d --build
```

### Option 2: Kubernetes/Container Orchestration
Use the Docker image pushed to Docker Hub:
```
your-username/mrp-backend:latest
```

### Option 3: Traditional Server (Node.js)
```bash
# Install dependencies
cd backend
npm ci --omit=dev

# Set environment variables
export DATABASE_URL="postgresql://printmrp:password@db-host:5432/printmrp"
export JWT_SECRET="your-secret"
export NODE_ENV=production

# Run migrations
npx prisma migrate deploy

# Seed database (idempotent)
node prisma/seed.cjs

# Start server
npm start
# Or use PM2 for process management: pm2 start dist/index.js --name "printmrp-backend"
```

## Health Checks

The backend provides a `/health` endpoint:
```bash
curl http://localhost:4000/health
# Response: {"status":"ok"}
```

Use this for monitoring and load balancer health checks.

## Debugging

### Check Docker container status
```bash
docker compose -f docker-compose.backend.yml ps
```

### View real-time logs
```bash
docker compose -f docker-compose.backend.yml logs -f backend
```

### Inspect container environment
```bash
docker compose -f docker-compose.backend.yml exec backend env
```

### Database connection test
```bash
docker compose -f docker-compose.backend.yml exec backend node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.\$connect().then(() => {
  console.log('✓ Database connected');
  process.exit(0);
}).catch(e => {
  console.error('✗ Database connection failed:', e.message);
  process.exit(1);
});
"
```

## Rolling Back

If a deployment fails, revert to the previous image:
```bash
# Check available image tags
docker images

# Use previous version
docker compose -f docker-compose.backend.yml down
# Edit docker-compose.backend.yml to specify image:tag
docker compose -f docker-compose.backend.yml up -d
```

## Monitoring & Logs

### Using Docker logs
```bash
docker compose -f docker-compose.backend.yml logs --tail=50 -f backend
```

### Persist logs (recommended)
Add to `docker-compose.backend.yml` backend service:
```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

## Troubleshooting

### Database connection errors
- Check `POSTGRES_PASSWORD` matches in `.env` and docker-compose
- Ensure `db` service is healthy: `docker compose ps`
- Check DATABASE_URL format in backend service

### Port conflicts
- Change `APP_PORT` in `.env` if port 4000 is in use
- Ensure port is not blocked by firewall

### Migration failures
- Check database has proper schema: `docker compose exec db psql -U printmrp -d printmrp -c "\dt"`
- Manually rollback if needed: `npm run prisma:migrate -- --skip-validate`

## Performance Tips

1. **Database**: 
   - Use `DB_PORT=` (blank) in production to avoid exposing Postgres
   - Enable connection pooling for high traffic

2. **Backend**:
   - Use `NODE_ENV=production` to enable optimizations
   - Set appropriate `CORS_ORIGINS` (not `*`)

3. **Monitoring**:
   - Enable structured logging
   - Monitor `/health` endpoint
   - Set up alerts for container restarts
