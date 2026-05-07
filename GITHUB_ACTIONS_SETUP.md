# GitHub Actions CI/CD Setup Guide

## Overview
The CI/CD pipeline (`.github/workflows/backend-ci.yml`) automatically:
- **Tests** the backend on every push/PR to `master`
- **Builds** Docker images
- **Pushes** images to Docker Hub
- **Deploys** via webhook (optional)

## Prerequisites

1. **GitHub Repository**: https://github.com/Vijji-AI/MRP-Print-Backend
2. **Docker Hub Account**: https://hub.docker.com (free tier is sufficient)
3. **Repository Access**: Push access to deploy branch

## Step 1: Generate Docker Hub Token

1. Go to https://hub.docker.com/settings/security
2. Click **"New Access Token"**
3. Name it: `github-actions`
4. Give it read/write permissions
5. Copy the token

## Step 2: Add GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"** and add:

### Required Secrets:
```
DOCKER_USERNAME = your-docker-hub-username
DOCKER_PASSWORD = your-docker-hub-token (from Step 1)
```

### Optional Secrets:
```
DEPLOY_WEBHOOK_URL = https://your-deployment-endpoint.com/deploy
```

## Step 3: Configure Repository Branch Protection (Recommended)

1. Go to **Settings** → **Branches**
2. Click **"Add rule"** under "Branch protection rules"
3. For pattern: `master`
4. Enable:
   - ✅ "Require a pull request before merging"
   - ✅ "Require status checks to pass before merging"
   - Select `test` as the required check

This ensures CI passes before merging to master.

## Workflow Triggers

The pipeline runs when:
- Push to `master` branch AND changes in `backend/**` or workflow file
- Pull request to `master` with changes in `backend/**`

Example triggers:
```bash
# ✅ TRIGGERS CI
git push origin master                    # (backend/ changed)
git push origin feature-branch            # (after PR to master)

# ❌ DOES NOT TRIGGER
git push origin dev-branch                # (not master)
git push origin master                    # (frontend/ changed only)
```

## Understanding the Workflow

### Test Job (Runs always)
```
✓ Checkout code
✓ Setup Node.js 20 + npm cache
✓ npm ci (clean install)
✓ npm run lint (TypeScript check)
✓ npm run build
✓ Docker build
✓ Push to Docker Hub (only on push, not PR)
```

### Deploy Job (Runs after test on master push only)
```
✓ Webhook POST to DEPLOY_WEBHOOK_URL (if configured)
```

## Docker Image Tags

When you push to master, the following images are created:

```
your-username/mrp-backend:latest              # Latest version
your-username/mrp-backend:abc123def456...     # Specific commit SHA
```

You can pull and run:
```bash
docker pull your-username/mrp-backend:latest
docker run -p 4000:4000 -e DATABASE_URL=... your-username/mrp-backend:latest
```

## Monitoring Workflow Runs

1. Go to **Actions** tab in your GitHub repository
2. Click on a workflow run to see details
3. View logs for each job

### Common Issues & Fixes

**Issue**: Test fails with TypeScript errors
```
Solution: Fix the errors locally and push again
git push origin master
```

**Issue**: Docker push fails (invalid credentials)
```
Solution: Verify DOCKER_USERNAME and DOCKER_PASSWORD in secrets
- Go to Settings → Secrets
- Click on each secret to edit
- Ensure Docker Hub credentials are correct
```

**Issue**: Database connection error in CI
```
Solution: The CI uses a temporary PostgreSQL service
- No action needed, database is auto-configured
- Check logs for the actual error
```

## Manual Deployment (Without Webhook)

If you don't have a webhook URL, manually pull and deploy:

```bash
# SSH into your server
ssh user@your-server.com

# Pull latest image
docker pull your-username/mrp-backend:latest

# Stop and remove old container
docker compose -f docker-compose.backend.yml down

# Update to use the image (edit docker-compose.backend.yml to reference the image)
# Or use docker run directly:
docker run -d \
  --name printmrp-api \
  -p 4000:4000 \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="..." \
  --restart unless-stopped \
  your-username/mrp-backend:latest
```

## Webhook Deployment (Advanced)

If you have a deployment webhook endpoint, add it as a secret:

```
DEPLOY_WEBHOOK_URL = https://your-deploy-service.com/deploy
```

The workflow will POST:
```json
{
  "ref": "refs/heads/master",
  "sha": "abc123def456..."
}
```

## Removing Docker Push (Local-Only Testing)

If you want to skip Docker Hub and just test locally:

Edit `.github/workflows/backend-ci.yml`:
```yaml
- name: Log in to Docker Hub
  if: never  # ← Disable this step
```

## Environment Variables for Container

When running the Docker image in production, provide:

```bash
docker run -d \
  -e DATABASE_URL="postgresql://user:pass@db-host:5432/dbname" \
  -e JWT_SECRET="your-secret-key" \
  -e SEED_ADMIN_EMAIL="admin@example.com" \
  -e SEED_ADMIN_PASSWORD="secure-password" \
  -e CORS_ORIGINS="https://yourfrontend.com" \
  -p 4000:4000 \
  your-username/mrp-backend:latest
```

## Troubleshooting

### 1. Workflow not triggering
- Check you pushed to `master` (not another branch)
- Verify file changes in `backend/**` or workflow file
- Go to Actions tab and see if it's queued

### 2. Build fails locally but passes in CI
- Check Node version: `node --version` (CI uses v20)
- Clear cache: `rm -rf node_modules package-lock.json && npm install`
- Check `.env` file isn't interfering

### 3. Docker push fails
- Verify credentials: `docker login` locally
- Check token hasn't expired
- Ensure Docker Hub org/repo exists

### 4. Linter errors
- Run locally: `cd backend && npm run lint`
- Fix TypeScript errors
- Commit and push again

## Next Steps

1. ✅ Set up GitHub secrets (DOCKER_USERNAME, DOCKER_PASSWORD)
2. ✅ Push code to master branch
3. ✅ Watch Actions tab for workflow run
4. ✅ Verify Docker image was pushed to Docker Hub
5. ✅ Deploy image to production server

Need help? Check `.github/workflows/backend-ci.yml` for the full configuration.
