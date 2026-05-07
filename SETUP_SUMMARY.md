# PrintMRP Backend — Complete Setup Summary

## What Was Created

### 1. **CI/CD Pipeline** (GitHub Actions)
- **File**: `.github/workflows/backend-ci.yml`
- **Triggers**: On push/PR to `master` branch with changes in `backend/**`
- **Actions**:
  - ✅ Lints TypeScript code
  - ✅ Builds backend application
  - ✅ Builds Docker image
  - ✅ Pushes to Docker Hub (on master push)
  - ✅ Triggers deployment webhook (optional)

### 2. **Docker Configuration**
- **Backend Dockerfile**: `backend/Dockerfile` (unchanged, already optimized)
- **Backend-Only Compose**: `docker-compose.backend.yml` (new)
  - PostgreSQL 16 database
  - Express API backend
  - Health checks
  - Environment variable support

### 3. **Environment Configuration**
- **Root Config**: `.env.example` (updated)
- **Backend Config**: `backend/.env.example` (unchanged)
- **Gitignore**: Already properly configured to exclude secrets

### 4. **Documentation**
- **Deployment Guide**: `DEPLOY_BACKEND.md`
- **GitHub Actions Guide**: `GITHUB_ACTIONS_SETUP.md`
- **Deployment Script**: `deploy-backend.sh` (executable)
- **This Summary**: `SETUP_SUMMARY.md`

---

## 🚀 Full Deployment Flow: Push → GitHub → VPS → Live

```
git push origin master
    ↓
GitHub Actions (test + build)
    ↓
SSH Deploy to VPS (automatic)
    ↓
✨ Production Live (2-5 min)
```

### Quick Start (Local Testing)

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Optionally customize .env (or use defaults)
# nano .env

# 3. Start backend with database
./deploy-backend.sh up

# 4. View logs
./deploy-backend.sh logs

# 5. Access the API
curl http://localhost:4000/health
```

### Production Deployment (Automatic)

1. **Push code to master**
   ```bash
   git push origin master
   ```

2. **GitHub Actions automatically**:
   - Tests code
   - Builds Docker image
   - Deploys to VPS via SSH
   - Verifies health

3. **Check GitHub Actions** tab for status
4. **Done!** Your VPS is live (~2-5 minutes)

### Common Commands

```bash
# View container status
./deploy-backend.sh ps

# View logs
./deploy-backend.sh logs

# Open database shell
./deploy-backend.sh db-shell

# Run migrations
./deploy-backend.sh migrate

# Seed database
./deploy-backend.sh seed

# Restart backend
./deploy-backend.sh restart

# Stop everything (keep data)
./deploy-backend.sh down

# Stop and delete database (DESTRUCTIVE)
./deploy-backend.sh down-v

# Check health
./deploy-backend.sh health
```

---

## GitHub Actions Setup (Required for CI/CD + Auto-Deployment)

### Step 1: Prepare Your VPS (One-time setup)
Follow detailed guide in `VPS_DEPLOYMENT_SETUP.md`:
1. Clone repository on VPS
2. Create and configure `.env` file with production values
3. Generate SSH deploy key
4. Test deployment locally on VPS

### Step 2: Add GitHub Secrets
Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

**Required for auto-deployment to VPS:**
```
VPS_HOST = your-vps-ip-or-domain
           (Example: 192.168.1.100 or api.example.com)

VPS_USER = ssh-username-on-vps
           (Example: ubuntu)

VPS_PROJECT_PATH = /path/to/project/on/vps
                   (Example: /home/ubuntu/projects/MRP-Print-Backend)

VPS_DEPLOY_KEY = (your-private-ssh-key-content)
                 (Get from: cat ~/.ssh/github-actions on VPS)
```

**Optional (for Docker Hub image storage):**
```
DOCKER_USERNAME = your-docker-hub-username
DOCKER_PASSWORD = your-docker-hub-token
```

### Step 3: Push to GitHub
```bash
git add .github/ docker-compose.backend.yml .env.example GITHUB_ACTIONS_SETUP.md DEPLOY_BACKEND.md deploy-backend.sh SETUP_SUMMARY.md
git commit -m "feat: add CI/CD pipeline and backend-only Docker setup"
git push origin master
```

The workflow will automatically:
1. Run tests
2. Build Docker image
3. Push to Docker Hub as `your-username/mrp-backend:latest`

---

## Production Deployment (Fully Automated)

### ✨ Default: Automatic SSH Deployment

Your workflow is now **fully automated**:

```bash
# On your local machine, make changes
nano backend/src/index.ts

# Commit and push to master
git add backend/
git commit -m "feat: add new feature"
git push origin master

# GitHub Actions automatically:
# 1. Tests your code
# 2. Builds Docker image
# 3. SSHes to VPS
# 4. Pulls latest code
# 5. Runs: docker compose up -d --build
# 6. Verifies health check
# 7. Done ✨ (2-5 minutes)
```

**No manual deployment steps needed!**

### Manual Deployment (If needed)

If you need to manually deploy on VPS:

```bash
# SSH to your VPS
ssh user@your-vps-ip

# Navigate to project
cd /path/to/MRP-Print-Backend

# Pull latest code
git pull origin master

# Deploy
./deploy-backend.sh up

# Monitor
./deploy-backend.sh logs
```

---

## File Structure

```
printing-mrp/
├── .github/
│   └── workflows/
│       └── backend-ci.yml                 # ← GitHub Actions workflow
├── backend/
│   ├── Dockerfile                        # (unchanged)
│   ├── src/
│   ├── prisma/
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.backend.yml             # ← Backend-only compose
├── .env.example                          # ← Updated config template
├── .gitignore                           # (unchanged)
├── deploy-backend.sh                    # ← Deployment script
├── DEPLOY_BACKEND.md                    # ← Deployment guide
├── GITHUB_ACTIONS_SETUP.md              # ← CI/CD setup guide
└── SETUP_SUMMARY.md                     # ← This file
```

---

## Key Configuration Values

### Environment Variables (in .env)
```
POSTGRES_PASSWORD=printmrp         # Database password
DB_PORT=5432                       # PostgreSQL port
JWT_SECRET=your-secret-here        # ⚠️ MUST change in production
JWT_EXPIRES_IN=7d                  # Token expiry
CORS_ORIGINS=*                     # Allowed API origins
SEED_ADMIN_EMAIL=admin@...        # Default admin
SEED_ADMIN_PASSWORD=admin123      # Default password
APP_PORT=4000                     # Backend port
NODE_ENV=production               # Environment
```

### Health Check
```bash
curl http://localhost:4000/health
# Response: {"status":"ok"}
```

---

## Monitoring & Logs

### Real-time Logs
```bash
./deploy-backend.sh logs          # Backend logs
./deploy-backend.sh logs-db       # Database logs
```

### Docker Commands
```bash
# View running containers
docker compose -f docker-compose.backend.yml ps

# Execute commands in container
docker compose -f docker-compose.backend.yml exec backend npm run build

# Check container resources
docker stats
```

---

## Troubleshooting

### Backend won't start
```bash
# Check logs
./deploy-backend.sh logs

# Verify database is running
./deploy-backend.sh ps

# Check health
./deploy-backend.sh health
```

### Database connection errors
```bash
# Open database shell
./deploy-backend.sh db-shell

# Run migrations
./deploy-backend.sh migrate
```

### Port already in use
Edit `.env`:
```
APP_PORT=4001        # Change from 4000 to 4001
```

### GitHub Actions not triggering
- Verify push to `master` branch
- Check that `backend/**` files changed
- View Actions tab for queue status

---

## Next Steps

1. **Test Locally**
   ```bash
   ./deploy-backend.sh up
   curl http://localhost:4000/health
   ```

2. **Set Up GitHub Secrets** (See GITHUB_ACTIONS_SETUP.md)
   - Add DOCKER_USERNAME
   - Add DOCKER_PASSWORD

3. **Commit and Push**
   ```bash
   git add .github/ docker-compose.backend.yml .env.example *.md deploy-backend.sh
   git commit -m "feat: add CI/CD pipeline and backend-only Docker setup"
   git push origin master
   ```

4. **Verify Workflow**
   - Go to Actions tab on GitHub
   - Watch workflow run
   - Verify Docker image pushed to Docker Hub

5. **Deploy to Production**
   - Follow "Production Deployment" section above
   - Monitor with `./deploy-backend.sh logs`

---

## Important Notes

- ⚠️ **JWT_SECRET**: Change in production using `openssl rand -hex 64`
- ⚠️ **POSTGRES_PASSWORD**: Change in production
- ⚠️ **DB_PORT**: Don't expose in production (leave blank)
- ✅ **Frontend**: Already deployed separately, no changes needed
- ✅ **Database**: Automatically migrated on container start
- ✅ **Admin User**: Automatically seeded if it doesn't exist

---

## Support Documentation

- **Deployment Details**: See `DEPLOY_BACKEND.md`
- **CI/CD Setup**: See `GITHUB_ACTIONS_SETUP.md`
- **Script Help**: Run `./deploy-backend.sh` (no args)

---

## Git Commands Reference

```bash
# Initial push to GitHub
git add .
git commit -m "feat: add CI/CD pipeline and backend-only Docker setup"
git push origin master

# After making changes
git add backend/
git commit -m "fix: update backend logic"
git push origin master

# View workflow status
# Go to: https://github.com/Vijji-AI/MRP-Print-Backend/actions
```

---

**Setup Complete! Your backend is now ready for automated CI/CD deployment.** 🚀
