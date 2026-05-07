# Setup Checklist

## ✅ Files Created

### CI/CD Pipeline
- [x] `.github/workflows/backend-ci.yml` — GitHub Actions workflow

### Docker Configuration
- [x] `docker-compose.backend.yml` — Backend-only compose file
- [x] `backend/Dockerfile` — Already exists, optimized

### Environment Configuration
- [x] `.env.example` — Updated with production-ready defaults
- [x] `.gitignore` — Already configured for secrets

### Documentation
- [x] `DEPLOY_BACKEND.md` — Comprehensive deployment guide
- [x] `GITHUB_ACTIONS_SETUP.md` — CI/CD setup instructions
- [x] `SETUP_SUMMARY.md` — Complete overview
- [x] `SETUP_CHECKLIST.md` — This file

### Deployment Script
- [x] `deploy-backend.sh` — One-command deployment helper

---

## 📋 Pre-Deployment Checklist

### Local Testing
- [ ] Run `./deploy-backend.sh up` and verify it starts
- [ ] Test `curl http://localhost:4000/health`
- [ ] Check logs with `./deploy-backend.sh logs`
- [ ] Stop with `./deploy-backend.sh down`

### GitHub Configuration
- [ ] Create Docker Hub account (if not exists)
- [ ] Generate Docker Hub access token
- [ ] Add DOCKER_USERNAME to GitHub secrets
- [ ] Add DOCKER_PASSWORD to GitHub secrets
- [ ] (Optional) Add DEPLOY_WEBHOOK_URL to GitHub secrets

### Code Preparation
- [ ] Verify backend code is in `backend/` directory
- [ ] Check `backend/package.json` exists
- [ ] Verify `backend/Dockerfile` builds locally
- [ ] Ensure `.gitignore` excludes sensitive files

### Git Repository
- [ ] Repository is initialized (`git init` or cloned)
- [ ] Remote points to GitHub repo
- [ ] You have push access to master branch
- [ ] All changes are committed

---

## 🚀 Deployment Checklist

### Step 1: Verify Files
```bash
ls -la .github/workflows/
ls -la docker-compose.backend.yml
ls -la deploy-backend.sh
ls -la DEPLOY_BACKEND.md
```

### Step 2: Test Locally
```bash
./deploy-backend.sh up
curl http://localhost:4000/health
./deploy-backend.sh down
```

### Step 3: Commit Files
```bash
git add .github/
git add docker-compose.backend.yml
git add deploy-backend.sh
git add DEPLOY_BACKEND.md GITHUB_ACTIONS_SETUP.md SETUP_SUMMARY.md
git add .env.example
git commit -m "feat: add CI/CD pipeline and backend-only Docker setup"
```

### Step 4: Push to GitHub
```bash
git push origin master
```

### Step 5: Verify Workflow
1. Go to https://github.com/Vijji-AI/MRP-Print-Backend/actions
2. Watch workflow run
3. Verify "test" job passes
4. Verify Docker image is pushed to Docker Hub

### Step 6: Deploy to Production
```bash
# Option A: Docker Compose
ssh user@production-server.com
cd /path/to/backend
docker compose -f docker-compose.backend.yml up -d

# Option B: Docker image
docker pull your-username/mrp-backend:latest
docker run -d --name api -p 4000:4000 -e DATABASE_URL=... your-username/mrp-backend:latest
```

---

## 🔧 Configuration Defaults

### Local Development
- API Port: 4000
- DB Port: 5432
- Admin Email: admin@printmrp.app
- Admin Password: admin123

### Production (.env should override)
- Set JWT_SECRET with: `openssl rand -hex 64`
- Set POSTGRES_PASSWORD to secure value
- Set CORS_ORIGINS to your frontend domain
- Do NOT expose DB_PORT

---

## 📖 Documentation Map

| Document | Purpose |
|----------|---------|
| `SETUP_SUMMARY.md` | Overview of what was created |
| `GITHUB_ACTIONS_SETUP.md` | Step-by-step GitHub Actions guide |
| `DEPLOY_BACKEND.md` | Detailed deployment instructions |
| `deploy-backend.sh` | Quick deployment commands |
| `SETUP_CHECKLIST.md` | This checklist |

---

## 🆘 Help

### Workflow not running?
1. Verify you pushed to `master` (not another branch)
2. Check file changes in `backend/**` directory
3. Go to Actions tab to see queue status

### Build failing?
1. Run `npm ci` locally to reproduce error
2. Check Node version: `node --version` (should be 20+)
3. Look at workflow logs for specific error

### Docker push failing?
1. Verify DOCKER_USERNAME and DOCKER_PASSWORD in GitHub secrets
2. Test locally: `docker login`
3. Check Docker Hub account permissions

### Backend not starting?
1. Run `./deploy-backend.sh logs` to see error
2. Verify `.env` file exists: `ls -la .env`
3. Check database is running: `./deploy-backend.sh ps`

---

## ✨ You're All Set!

Your backend is now configured for:
- ✅ Automated CI/CD with GitHub Actions
- ✅ Docker containerization
- ✅ Production-ready deployment
- ✅ Easy local development
- ✅ Automated testing on every push

**Next: Follow the "Step 1: Verify Files" section above!**
