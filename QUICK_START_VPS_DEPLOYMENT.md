# Quick Start: GitHub → VPS → Production (5 Steps)

## Step 1: Prepare Your VPS (10 minutes, one-time)

```bash
# SSH into your VPS
ssh user@your-vps-ip

# Clone the repository
mkdir -p /home/user/projects
cd /home/user/projects
git clone https://github.com/Vijji-AI/MRP-Print-Backend.git
cd MRP-Print-Backend

# Create production configuration
cp .env.example .env
nano .env  # IMPORTANT: Set production values!
```

**Essential values to set in `.env`:**
```env
POSTGRES_PASSWORD=secure-password-here
JWT_SECRET=run-this-locally: openssl rand -hex 64
CORS_ORIGINS=https://yourfrontend.com
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=secure-password
```

**Test it works:**
```bash
./deploy-backend.sh up
curl http://localhost:4000/health  # Should return ok
./deploy-backend.sh down
```

---

## Step 2: Generate SSH Deploy Key (5 minutes)

```bash
# On your VPS, create deploy key for GitHub
ssh-keygen -t ed25519 -f ~/.ssh/github-actions -N ""

# Show the PRIVATE key (you'll add this to GitHub)
cat ~/.ssh/github-actions

# Add public key to authorized_keys (so GitHub can access)
cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**Copy the ENTIRE content of the private key** (everything from `-----BEGIN` to `-----END`).

---

## Step 3: Add GitHub Secrets (5 minutes)

Go to your GitHub repository:
**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add **4 required secrets:**

### 1. VPS_HOST
- **Value**: Your VPS IP or domain
- **Example**: `192.168.1.100` or `api.example.com`

### 2. VPS_USER
- **Value**: Your SSH username on VPS
- **Example**: `ubuntu` or `root`

### 3. VPS_PROJECT_PATH
- **Value**: Full path to the project on VPS
- **Example**: `/home/ubuntu/projects/MRP-Print-Backend`

### 4. VPS_DEPLOY_KEY
- **Value**: Paste the PRIVATE key from Step 2
- **Important**: This is the KEY CONTENT, not a filename

---

## Step 4: Test the Deployment (5 minutes)

```bash
# On your local machine
cd /root/printing-mrp

# Make a small test change
echo "// deployment test" >> backend/src/index.ts

# Commit and push
git add backend/
git commit -m "test: trigger automatic deployment"
git push origin master
```

**Watch the deployment:**
1. Go to your GitHub repository
2. Click **Actions** tab
3. Click the latest workflow
4. Watch it run (2-5 minutes)
5. Check that both `test` and `deploy` jobs pass ✅

**Verify on VPS:**
```bash
ssh user@your-vps-ip
cd /path/to/MRP-Print-Backend
./deploy-backend.sh ps           # Check containers
./deploy-backend.sh logs         # View logs
curl http://localhost:4000/health # Test API
```

---

## Step 5: You're Done! Start Using It

```bash
# Normal workflow from now on:

# 1. Make changes to backend
nano backend/src/something.ts

# 2. Commit and push to master
git add backend/
git commit -m "feat: describe your change"
git push origin master

# 3. GitHub automatically:
#    ✅ Tests your code
#    ✅ Builds Docker image
#    ✅ Deploys to VPS
#    ✅ Restarts services
#    ✅ Verifies health

# 4. Your VPS is live in 2-5 minutes!
# No manual steps needed 🎉
```

---

## ⚡ Deployment Flow Diagram

```
Local: git push origin master
            ↓
GitHub Actions: Test & Build
            ↓
GitHub Actions: SSH Deploy to VPS
  ├─ git pull origin master
  ├─ docker compose down
  ├─ docker compose up -d --build
  └─ curl health check
            ↓
VPS: Production Updated ✨
```

---

## 🆘 Troubleshooting

### Deploy job fails with "SSH Error"
```bash
# Verify secrets on GitHub:
# Go to Settings → Secrets
# Check each secret is correct:
# - VPS_HOST is IP/domain (not http://)
# - VPS_USER is correct username
# - VPS_PROJECT_PATH is full path
# - VPS_DEPLOY_KEY is PRIVATE key (not public)
```

### Backend doesn't start after deployment
```bash
# SSH to VPS
ssh user@your-vps-ip
cd /path/to/project

# Check logs
./deploy-backend.sh logs

# Check containers
./deploy-backend.sh ps

# Check .env has required values
cat .env | grep -E "JWT_SECRET|POSTGRES_PASSWORD"
```

### "Permission denied" on VPS
```bash
# Fix SSH key permissions
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh

# Verify you can SSH:
ssh -i ~/.ssh/github-actions user@your-vps-ip
```

---

## 📚 Full Documentation

For more detailed information:
- **VPS_DEPLOYMENT_SETUP.md** — Complete VPS setup guide
- **DEPLOYMENT_FLOW.md** — Detailed workflow & monitoring
- **DEPLOY_BACKEND.md** — Local development & manual deployment
- **GITHUB_ACTIONS_SETUP.md** — GitHub Actions details

---

## ✅ Checklist

- [ ] VPS has Docker, Docker Compose, Git
- [ ] Repository cloned on VPS
- [ ] `.env` file created with production values
- [ ] SSH deploy key generated
- [ ] Test deployment works on VPS
- [ ] VPS_HOST secret added (IP/domain)
- [ ] VPS_USER secret added (username)
- [ ] VPS_PROJECT_PATH secret added (full path)
- [ ] VPS_DEPLOY_KEY secret added (private key)
- [ ] Test push to master completed
- [ ] GitHub Actions workflow passed
- [ ] VPS has new containers running
- [ ] Health check endpoint works

---

## 🎉 Done!

Your deployment is now **fully automated**. Every push to master automatically:
1. Tests the code
2. Builds Docker image
3. Deploys to VPS
4. Verifies health

No more manual deployment steps needed! 🚀
