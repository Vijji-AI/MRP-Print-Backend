# VPS Deployment Setup Guide

This guide walks you through setting up automatic deployment from GitHub to your VPS.

## Architecture

```
Your GitHub Push
    ↓
GitHub Actions (test + build)
    ↓
SSH Deploy Job
    ↓
VPS (pull latest code → deploy)
    ↓
Production Live ✨
```

---

## Prerequisites

- VPS with Docker & Docker Compose installed
- SSH access to VPS
- Git installed on VPS
- `curl` available on VPS (for health checks)

---

## Step 1: Prepare Your VPS

### 1.1 SSH into your VPS

```bash
ssh user@your-vps-ip
```

### 1.2 Create deployment directory

```bash
# Create directory for the project
mkdir -p /home/user/projects
cd /home/user/projects

# Clone your GitHub repository
git clone https://github.com/Vijji-AI/MRP-Print-Backend.git
cd MRP-Print-Backend

# Create .env file with production values
cp .env.example .env

# Edit with your production settings
nano .env
```

**Important `.env` values to set:**
```env
# Use a secure database password
POSTGRES_PASSWORD=your-secure-password

# Generate JWT secret: openssl rand -hex 64
JWT_SECRET=your-generated-secret-here

# Set CORS for your frontend domain
CORS_ORIGINS=https://yourfrontend.com

# Don't expose database port in production
# DB_PORT=  (leave empty/commented)

# Set admin credentials
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=secure-admin-password
```

### 1.3 Verify deployment works locally on VPS

```bash
# Test the deployment script locally
./deploy-backend.sh up

# Check it's healthy
curl http://localhost:4000/health

# Stop it
./deploy-backend.sh down
```

---

## Step 2: Create SSH Deploy Key

You need a dedicated SSH key for GitHub Actions to authenticate with your VPS.

### 2.1 Generate SSH key pair on your VPS

```bash
# Generate a new SSH key (no passphrase for CI/CD)
ssh-keygen -t ed25519 -f ~/.ssh/github-actions -N ""

# View the private key (you'll need this for GitHub)
cat ~/.ssh/github-actions
```

### 2.2 Add public key to VPS authorized_keys

```bash
# The public key should already be authorized
# But verify it's in the right place:

cat ~/.ssh/github-actions.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 2.3 Verify SSH key works

From your local machine:
```bash
# Save the private key you copied from VPS
# Create: ~/.ssh/github-actions (with the content from step 2.1)

# Test SSH connection
ssh -i ~/.ssh/github-actions user@your-vps-ip "echo 'SSH key works!'"
```

---

## Step 3: Add GitHub Secrets

Go to your GitHub repository:
**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these secrets (these are **required** for deployment):

### 3.1 VPS_HOST
```
Value: your-vps-ip-or-domain
Example: 192.168.1.100 or vps.example.com
```

### 3.2 VPS_USER
```
Value: the SSH user on your VPS
Example: ubuntu or root
```

### 3.3 VPS_PROJECT_PATH
```
Value: full path to your project on VPS
Example: /home/ubuntu/projects/MRP-Print-Backend
```

### 3.4 VPS_DEPLOY_KEY
```
Value: the PRIVATE key you generated in Step 2.1
(Paste the entire content of ~/.ssh/github-actions)
```

### 3.5 DOCKER_USERNAME & DOCKER_PASSWORD (optional)
```
If you still want to push images to Docker Hub, add these
Otherwise, you can remove the Docker Hub push step from the workflow
```

---

## Step 4: Test the Deployment

### 4.1 Make a test change

```bash
# On your local machine
cd /root/printing-mrp

# Make a small change
echo "// test deployment" >> backend/src/index.ts

# Commit and push
git add backend/src/index.ts
git commit -m "test: trigger deployment"
git push origin master
```

### 4.2 Watch the workflow

1. Go to **Actions** tab on GitHub
2. Click on the latest workflow run
3. Watch the `test` and `deploy` jobs
4. Check logs for any errors

### 4.3 Verify on VPS

```bash
# SSH into your VPS
ssh user@your-vps-ip

# Check if containers are running
cd /path/to/project
./deploy-backend.sh ps

# View logs
./deploy-backend.sh logs

# Check health
curl http://localhost:4000/health
```

---

## Step 5: Configure VPS Firewall & Reverse Proxy (Optional)

If you want the backend accessible from your domain:

### 5.1 Using Nginx as reverse proxy

```bash
# Install nginx on VPS
sudo apt update && sudo apt install -y nginx

# Create config
sudo nano /etc/nginx/sites-available/api.example.com
```

```nginx
server {
    listen 80;
    server_name api.example.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/api.example.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5.2 Get SSL certificate (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --nginx -d api.example.com
```

---

## Monitoring & Troubleshooting

### Check deployment status

```bash
# SSH to VPS
ssh user@your-vps-ip

# Navigate to project
cd /path/to/project

# Check containers
docker compose -f docker-compose.backend.yml ps

# View logs
docker compose -f docker-compose.backend.yml logs -f backend

# Check health
curl http://localhost:4000/health
```

### Common Issues

**Issue: "SSH key rejected"**
```bash
# Verify key permissions on VPS
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh

# Test SSH manually
ssh -i ~/.ssh/github-actions user@your-vps-ip
```

**Issue: "Git pull fails on VPS"**
```bash
# Ensure Git can pull from GitHub
# If private repo, set up Git credentials or deploy key:
cd /path/to/project
git remote -v  # Check remote URL
git pull origin master  # Test manually
```

**Issue: "Docker command not found"**
```bash
# Install Docker on VPS
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER
# (Need to logout/login for this to take effect)
```

**Issue: "Port 4000 already in use"**
```bash
# Change port in .env
nano .env
# Set: APP_PORT=4001

# Or kill the process
lsof -i :4000
kill -9 <PID>
```

---

## Security Best Practices

1. ✅ Use strong passwords in `.env`
2. ✅ Generate JWT_SECRET with `openssl rand -hex 64`
3. ✅ Don't expose database port (leave DB_PORT empty)
4. ✅ Use HTTPS with Let's Encrypt
5. ✅ Restrict CORS_ORIGINS to your frontend domain
6. ✅ Use ed25519 SSH keys (more secure)
7. ✅ Rotate deploy keys periodically
8. ✅ Never commit `.env` file

---

## Updating the Application

Once set up, your deployment is fully automated:

```bash
# On your local machine, make changes
nano backend/src/index.ts

# Commit and push to master
git add backend/
git commit -m "feat: add new feature"
git push origin master

# GitHub Actions automatically:
# 1. Tests the code
# 2. Builds Docker image
# 3. Deploys to VPS
# 4. Verifies health

# Check status in GitHub Actions tab
```

---

## Rollback Procedure

If something goes wrong after deployment:

```bash
# SSH to VPS
ssh user@your-vps-ip
cd /path/to/project

# View previous commits
git log --oneline

# Revert to previous version
git revert <commit-hash>
git push origin master

# Or manually revert
git reset --hard <previous-commit>
git push origin master -f  # Force push only in emergencies!
```

---

## Monitoring in Production

### Set up log monitoring

```bash
# On VPS, keep logs visible
ssh user@your-vps-ip
cd /path/to/project
docker compose -f docker-compose.backend.yml logs -f backend
```

### Health checks from outside

```bash
# Check from anywhere
curl https://api.example.com/health

# Set up automated monitoring (e.g., UptimeRobot)
# Monitor: https://api.example.com/health
# Interval: every 5 minutes
```

---

## Summary

Your deployment flow is now:
```
1. git push origin master
2. GitHub Actions tests & builds
3. GitHub Actions SSHes to VPS
4. VPS pulls latest code
5. VPS runs: docker compose up -d --build
6. VPS verifies health
7. ✨ Production live
```

**Time to production: ~2-5 minutes**

All fully automated! 🚀
