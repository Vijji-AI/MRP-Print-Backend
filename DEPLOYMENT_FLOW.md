# PrintMRP Backend: GitHub → VPS → Production Flow

## 🚀 The Flow (Fully Automated)

```
You Push Code
    ↓
git push origin master
    ↓
GitHub Actions Triggered
    ├─ Run linter (TypeScript)
    ├─ Build backend
    ├─ Build Docker image
    └─ (Optional) Push to Docker Hub
    ↓
Deploy Job (SSH to VPS)
    ├─ Pull latest code
    ├─ Copy .env
    ├─ docker compose down
    ├─ docker compose up -d --build
    └─ Verify health check
    ↓
✨ Production Live
```

**Time to production: 2-5 minutes**

---

## 📋 GitHub Secrets Required

Before the flow works, set these in your GitHub repository:

**Settings** → **Secrets and variables** → **Actions**

| Secret | Example | Description |
|--------|---------|-------------|
| `VPS_HOST` | `192.168.1.100` | IP or domain of your VPS |
| `VPS_USER` | `ubuntu` | SSH username on VPS |
| `VPS_PROJECT_PATH` | `/home/ubuntu/projects/MRP-Print-Backend` | Path to project on VPS |
| `VPS_DEPLOY_KEY` | (private key content) | SSH private key for auth |

**Optional:**
| Secret | Purpose |
|--------|---------|
| `DOCKER_USERNAME` | Push images to Docker Hub |
| `DOCKER_PASSWORD` | Docker Hub token |

---

## ⚙️ VPS Prerequisites

Your VPS needs:
- ✅ Docker & Docker Compose installed
- ✅ Git installed
- ✅ Project cloned: `/path/to/MRP-Print-Backend`
- ✅ `.env` file configured with production values
- ✅ SSH access enabled

---

## 📝 Step-by-Step Setup

### 1. Prepare VPS (One-time)

```bash
# SSH to VPS
ssh user@your-vps-ip

# Create project directory
mkdir -p /home/user/projects
cd /home/user/projects

# Clone repository
git clone https://github.com/Vijji-AI/MRP-Print-Backend.git
cd MRP-Print-Backend

# Create .env with production values
cp .env.example .env
nano .env  # Edit with your settings
```

**Essential .env settings:**
```env
POSTGRES_PASSWORD=secure-password
JWT_SECRET=openssl-rand-hex-64-here
CORS_ORIGINS=https://yourfrontend.com
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=secure-password
```

### 2. Generate SSH Deploy Key

```bash
# On VPS, create deploy key
ssh-keygen -t ed25519 -f ~/.ssh/github-actions -N ""

# Show private key (copy for GitHub)
cat ~/.ssh/github-actions

# Add public key to authorized_keys
cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. Add GitHub Secrets

In your GitHub repository settings, add:

```
VPS_HOST=your-vps-ip-or-domain
VPS_USER=ubuntu
VPS_PROJECT_PATH=/home/ubuntu/projects/MRP-Print-Backend
VPS_DEPLOY_KEY=<content of ~/.ssh/github-actions private key>
```

### 4. Test Deployment

```bash
# Make a small change
echo "// test" >> backend/src/index.ts

# Commit and push
git add backend/
git commit -m "test: trigger deployment"
git push origin master

# Watch GitHub Actions (Actions tab)
# Should complete in 2-5 minutes
```

---

## 🔄 Normal Workflow (After Setup)

```bash
# 1. Make changes locally
nano backend/src/index.ts

# 2. Commit and push
git add backend/
git commit -m "feat: add new feature"
git push origin master

# 3. GitHub Actions automatically:
#    - Tests code
#    - Builds Docker image
#    - Deploys to VPS
#    - Verifies health

# 4. Monitor in GitHub Actions tab
#    (or email notifications if workflow fails)

# Done! Your VPS is updated ✨
```

---

## 🐛 Debugging

### Check GitHub Actions logs

1. Go to **Actions** tab on GitHub
2. Click latest workflow run
3. Expand `test` or `deploy` job
4. Look for errors

### SSH to VPS and check manually

```bash
ssh user@your-vps-ip
cd /path/to/project

# Check containers
docker compose -f docker-compose.backend.yml ps

# View logs
docker compose -f docker-compose.backend.yml logs -f backend

# Test health
curl http://localhost:4000/health
```

### Common Issues

**"Deploy job fails with SSH error"**
- Verify VPS_DEPLOY_KEY is the PRIVATE key (not public)
- Check VPS_HOST is correct IP/domain
- Test SSH manually: `ssh -i key user@host`

**"Git pull fails on VPS"**
- Ensure Git can access your GitHub repo
- If private repo, set up Git credentials

**"Docker build fails"**
- Check Node version: `node --version` (should be 20+)
- Check backend/Dockerfile exists
- View full logs in GitHub Actions

**"Health check fails"**
- Backend might still be starting (takes 30 seconds)
- Check database is running: `docker compose ps`
- Check logs: `docker compose logs backend`

---

## 🔐 Security Checklist

- ✅ JWT_SECRET generated with `openssl rand -hex 64`
- ✅ POSTGRES_PASSWORD is strong and unique
- ✅ CORS_ORIGINS is your domain (not `*`)
- ✅ DB_PORT is NOT exposed in production
- ✅ SSH key is ed25519 or RSA 4096-bit
- ✅ `.env` file never committed to Git
- ✅ Firewall blocks unnecessary ports
- ✅ HTTPS enabled on reverse proxy

---

## 📊 Monitoring Production

### Health endpoint
```bash
curl https://api.yourdomain.com/health
# Response: {"status":"ok"}
```

### Real-time logs (SSH to VPS)
```bash
docker compose -f docker-compose.backend.yml logs -f backend
```

### Set up automated monitoring
- Use UptimeRobot, Better Stack, or similar
- Monitor: `https://api.yourdomain.com/health`
- Check every 5 minutes
- Get alerts if down

---

## 🔄 Rolling Updates

Your deployment is **zero-downtime** because:
1. New container builds while old runs
2. Old container stops only after new passes health check
3. Minimal service interruption

```bash
# Normal deployment flow handles this automatically
# Just push to master, everything else is automatic
git push origin master
# VPS updates with zero downtime ✨
```

---

## 📚 Full Documentation

- **VPS_DEPLOYMENT_SETUP.md** — Detailed setup with all options
- **DEPLOY_BACKEND.md** — Local development & deployment
- **GITHUB_ACTIONS_SETUP.md** — GitHub Actions workflow details

---

## 🎉 You're Ready!

Your workflow is now:
1. **Push code** → `git push origin master`
2. **GitHub tests it** → Automatically runs CI
3. **Deploys to VPS** → Pulls latest, builds, restarts
4. **Production updates** → Health verified
5. **Done** → ~2-5 minutes from push to live

All fully automated. No manual deployment steps needed!
