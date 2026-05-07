# 🚀 START HERE: Your Complete Backend Deployment Setup

## ⚡ TL;DR (Too Long; Didn't Read)

You now have **fully automated deployment** from GitHub → VPS → Production.

**Your new workflow:**
```bash
git push origin master
# ↓ (2-5 minutes)
# Backend is live on VPS! ✨
```

**Setup time: ~30 minutes**

---

## 📋 The 5 Steps (Follow Exactly)

### Step 1: Set Up VPS (10 min)
```bash
# SSH into your VPS
ssh user@your-vps-ip

# Clone repo and configure
mkdir -p /home/user/projects
cd /home/user/projects
git clone https://github.com/Vijji-AI/MRP-Print-Backend.git
cd MRP-Print-Backend

# Create production config
cp .env.example .env
nano .env  # IMPORTANT: Edit with production values!
```

**Must set these in `.env`:**
```env
POSTGRES_PASSWORD=use-a-strong-password
JWT_SECRET=generate-with: openssl rand -hex 64
CORS_ORIGINS=https://yourfrontend.com
```

**Test it works:**
```bash
./deploy-backend.sh up
curl http://localhost:4000/health  # Should return {"status":"ok"}
./deploy-backend.sh down
```

### Step 2: Generate SSH Key (5 min)
```bash
# Still on VPS:
ssh-keygen -t ed25519 -f ~/.ssh/github-actions -N ""

# Show and COPY the private key
cat ~/.ssh/github-actions

# Setup authorization
cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**⚠️ COPY THE ENTIRE PRIVATE KEY OUTPUT** (you'll paste it into GitHub)

### Step 3: Add GitHub Secrets (5 min)

Go to: **https://github.com/Vijji-AI/MRP-Print-Backend/settings/secrets/actions**

Click **"New repository secret"** and add these **exactly**:

| Name | What to put | Example |
|------|-------------|---------|
| `VPS_HOST` | Your VPS IP or domain | `192.168.1.100` or `api.example.com` |
| `VPS_USER` | SSH username on VPS | `ubuntu` or `root` |
| `VPS_PROJECT_PATH` | Full path on VPS | `/home/ubuntu/projects/MRP-Print-Backend` |
| `VPS_DEPLOY_KEY` | Paste entire private key from Step 2 | (from `cat ~/.ssh/github-actions`) |

### Step 4: Test Deployment (5 min)
```bash
# On your LOCAL machine
cd /root/printing-mrp

# Make a test change
echo "// test deployment" >> backend/src/index.ts

# Commit and push
git add backend/
git commit -m "test: trigger deployment"
git push origin master
```

**Watch it deploy:**
1. Go to: https://github.com/Vijji-AI/MRP-Print-Backend/actions
2. Click the latest workflow
3. Watch the jobs run (2-5 minutes total)
4. Both `test` and `deploy` jobs should pass ✅

### Step 5: Verify on VPS (5 min)
```bash
# SSH to VPS
ssh user@your-vps-ip
cd /path/to/MRP-Print-Backend

# Check it's running
./deploy-backend.sh ps

# View logs
./deploy-backend.sh logs

# Test API
curl http://localhost:4000/health
```

---

## ✅ Done! You're Live!

Your VPS is now automatically updated every time you push to master.

---

## 🎯 Your New Workflow

```bash
# 1. Make changes
nano backend/src/something.ts

# 2. Commit and push
git add backend/
git commit -m "feat: your feature"
git push origin master

# 3. GitHub automatically:
#    - Tests code
#    - Builds Docker
#    - Deploys to VPS
#    - Verifies health
#    (Takes 2-5 minutes)

# 4. Done! VPS is updated ✨
```

**No manual deployment steps needed!**

---

## 📚 Need More Help?

| Document | Read When |
|----------|-----------|
| **NEXT_STEPS.md** | Detailed step-by-step (you just did this!) |
| **QUICK_START_VPS_DEPLOYMENT.md** | 5-step overview + troubleshooting |
| **DEPLOYMENT_FLOW.md** | How the automation works |
| **VPS_DEPLOYMENT_SETUP.md** | Complete VPS details |
| **FILES_OVERVIEW.md** | What each file does |

---

## 🆘 Troubleshooting

### "Deploy job fails with SSH error"
→ Check your 4 GitHub secrets are correct
→ Verify `VPS_DEPLOY_KEY` is the PRIVATE key (not public)
→ Check `VPS_HOST` is IP or domain (not http://)

### "Backend doesn't start after deployment"
→ SSH to VPS
→ Run `./deploy-backend.sh logs` to see error
→ Check `.env` has required values

### "Git pull fails on VPS"
→ Test Git manually on VPS: `git pull origin master`
→ Check you have push access to GitHub repo

### "Port 4000 already in use"
→ Edit `.env`: change `APP_PORT=4000` to `APP_PORT=4001`
→ Push to master and redeploy

---

## 💡 Important Notes

✅ **Security:**
- Never commit `.env` file (already in .gitignore)
- Generate JWT_SECRET with `openssl rand -hex 64`
- Use strong POSTGRES_PASSWORD
- Don't expose DB_PORT in production

✅ **Zero-downtime deploys:**
- New container builds while old runs
- Old stops only after new passes health check
- Service interruption: < 1 second

✅ **Automatic features:**
- Database auto-migrates on startup
- Admin user auto-seeded (safe to run repeatedly)
- Health checks built-in
- Logs easily accessible

---

## 🎉 What You Have Now

✓ Fully automated CI/CD pipeline
✓ GitHub Actions tests & builds
✓ Automatic deployment to VPS
✓ Docker containerization
✓ Production database (PostgreSQL)
✓ Health monitoring
✓ One-command local deployment
✓ Complete documentation
✓ Zero-downtime deployments

---

## 🚀 You're Ready!

Your backend is now production-ready with automated deployment.

**Next time you make changes:**
```bash
git push origin master  # That's all you need to do! 🎉
```

Questions? Check the documentation files listed above.

**Good luck! 🚀**
