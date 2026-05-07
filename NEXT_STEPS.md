# Next Steps: Your Complete Setup

## 📋 What Was Created

Your PrintMRP backend now has a **complete CI/CD pipeline** with automatic VPS deployment:

```
Your Local Machine
    ↓ git push origin master
GitHub Repository
    ↓ GitHub Actions runs
Tests & Build (TypeScript linting, Docker build)
    ↓ If successful
SSH Deploy Job
    ↓ Connects to VPS via SSH
VPS: git pull → docker compose up -d --build
    ↓ Health check passes
Production Live ✨
```

---

## 🚀 What To Do NOW

### IMMEDIATELY (Required - 30 minutes)

#### 1. ⚙️ Set Up VPS (10 min)

```bash
# SSH to your VPS
ssh user@your-vps-ip

# Create project directory and clone
mkdir -p /home/user/projects
cd /home/user/projects
git clone https://github.com/Vijji-AI/MRP-Print-Backend.git
cd MRP-Print-Backend

# Create production config
cp .env.example .env
nano .env

# ⚠️ MUST EDIT THESE IN .env:
# - POSTGRES_PASSWORD=use-a-strong-password
# - JWT_SECRET=run: openssl rand -hex 64 (on local machine)
# - CORS_ORIGINS=https://yourfrontend.com
# - SEED_ADMIN_EMAIL=admin@yourdomain.com
# - SEED_ADMIN_PASSWORD=secure-password
```

#### 2. 🔑 Generate SSH Deploy Key (5 min)

```bash
# Still on VPS:
ssh-keygen -t ed25519 -f ~/.ssh/github-actions -N ""

# Show private key (copy entire content)
cat ~/.ssh/github-actions

# Setup authorization
cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**⚠️ SAVE THE PRIVATE KEY OUTPUT** (you'll paste this into GitHub)

#### 3. 🧪 Test VPS Deployment (5 min)

```bash
# Still on VPS, in the project directory:
./deploy-backend.sh up

# Verify it works
curl http://localhost:4000/health

# Should output: {"status":"ok"}

# Stop it
./deploy-backend.sh down
```

#### 4. 🔐 Add GitHub Secrets (10 min)

Go to: https://github.com/Vijji-AI/MRP-Print-Backend/settings/secrets/actions

Click **New repository secret** and add:

| Name | Value |
|------|-------|
| `VPS_HOST` | Your VPS IP or domain (e.g., 192.168.1.100) |
| `VPS_USER` | SSH username (e.g., ubuntu) |
| `VPS_PROJECT_PATH` | `/home/user/projects/MRP-Print-Backend` |
| `VPS_DEPLOY_KEY` | Paste entire content of private key from step 2 |

---

### AFTER SETUP (Verify it works)

#### 5. 🧪 Test Deployment (5 min)

```bash
# On your local machine:
cd /root/printing-mrp

# Make a small test change
echo "// test deployment" >> backend/src/index.ts

# Commit and push
git add backend/
git commit -m "test: trigger automatic deployment"
git push origin master
```

#### 6. 👀 Monitor GitHub Actions

1. Go to: https://github.com/Vijji-AI/MRP-Print-Backend/actions
2. Click the latest workflow run
3. Watch the jobs:
   - `test` job should pass ✅
   - `deploy` job should pass ✅
4. Entire process takes 2-5 minutes

#### 7. ✅ Verify Production

```bash
# SSH to VPS
ssh user@your-vps-ip
cd /home/user/projects/MRP-Print-Backend

# Check containers
./deploy-backend.sh ps

# View logs
./deploy-backend.sh logs

# Test API
curl http://localhost:4000/health
```

---

## 📖 Documentation

After setup is complete, refer to these for:

| Document | Read When |
|----------|-----------|
| **QUICK_START_VPS_DEPLOYMENT.md** | ← START HERE (5-step overview) |
| **DEPLOYMENT_FLOW.md** | Understanding the automated workflow |
| **VPS_DEPLOYMENT_SETUP.md** | Detailed VPS setup & troubleshooting |
| **DEPLOY_BACKEND.md** | Local development & manual deployment |
| **GITHUB_ACTIONS_SETUP.md** | GitHub Actions workflow details |

---

## 🎯 Your Normal Workflow (After Setup)

Once everything is configured, this is all you do:

```bash
# 1. Make changes
nano backend/src/something.ts

# 2. Commit and push
git add backend/
git commit -m "feat: your feature here"
git push origin master

# 3. GitHub automatically:
#    - Tests code
#    - Builds Docker
#    - Deploys to VPS
#    - Verifies health
#    (2-5 minutes)

# 4. Done! Your VPS is updated ✨
```

No manual deployment steps needed!

---

## 🚨 If Something Goes Wrong

### Deploy fails in GitHub Actions
```
→ Go to Actions tab
→ Click the failed workflow
→ Expand the failing job
→ Check the error message
→ Most common: SSH secrets are wrong
→ Fix secrets, re-test
```

### Backend doesn't start on VPS
```bash
ssh user@your-vps-ip
cd /path/to/project

# Check logs
docker compose -f docker-compose.backend.yml logs backend

# Check containers
docker compose -f docker-compose.backend.yml ps

# Restart manually
./deploy-backend.sh restart
```

### SSH connection fails
```bash
# Verify you can SSH with the key:
ssh -i ~/.ssh/github-actions user@your-vps-ip

# Check .ssh permissions on VPS:
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

---

## ✨ Quick Checklist

Before you start:
- [ ] VPS is reachable via SSH
- [ ] Docker & Docker Compose installed on VPS
- [ ] Git installed on VPS

During setup:
- [ ] Repository cloned on VPS
- [ ] `.env` created and configured
- [ ] SSH deploy key generated
- [ ] Test deployment works on VPS
- [ ] GitHub secrets added (all 4)

After setup:
- [ ] Test push to master completed
- [ ] GitHub Actions workflow passed
- [ ] Backend is running on VPS
- [ ] Health check returns ok

---

## 🎉 Summary

You now have:
✅ Automated CI/CD with GitHub Actions
✅ Automatic SSH deployment to VPS
✅ One-command deployment script
✅ Production `.env` configuration
✅ Complete documentation

**Next action**: Follow the **IMMEDIATELY** section above (30 minutes of work).

Then everything is automatic! 🚀

---

## 💬 Need Help?

1. Check **QUICK_START_VPS_DEPLOYMENT.md** for step-by-step guide
2. Check **DEPLOYMENT_FLOW.md** for troubleshooting
3. Check **VPS_DEPLOYMENT_SETUP.md** for detailed setup

All the information you need is in the markdown files in this directory!

---

**Ready? Start with Step 1 above! 👇**
