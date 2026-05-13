# PrintMRP Backend — Hostinger VPS Deploy (bare-metal + PM2)

This walks you through deploying the API to a fresh Hostinger KVM VPS,
connecting to your existing Supabase Postgres, and putting nginx in front
of PM2 so the API is reachable over `http://<vps-ip>` (and HTTPS once you
attach a domain).

Prereqs:
- Hostinger VPS with Ubuntu 22.04 or 24.04
- Root password (Hostinger panel → VPS → Overview)
- Your Supabase Session Pooler `DATABASE_URL` (we already built it)

---

## 1. SSH into the VPS

From your laptop (PowerShell or any terminal):

```
ssh root@<YOUR_VPS_IP>
```

Type `yes` on the host fingerprint prompt, then the root password.

## 2. Create a non-root user

```bash
apt update && apt upgrade -y
adduser printmrp                # set a strong password
usermod -aG sudo printmrp

# carry SSH access over (skip if you only use a password)
mkdir -p /home/printmrp/.ssh
cp /root/.ssh/authorized_keys /home/printmrp/.ssh/authorized_keys 2>/dev/null || true
chown -R printmrp:printmrp /home/printmrp/.ssh
chmod 700 /home/printmrp/.ssh

exit
ssh printmrp@<YOUR_VPS_IP>
```

## 3. Install Node.js 20, nginx, git, PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git build-essential
sudo systemctl enable --now nginx

sudo npm install -g pm2
node -v && npm -v && pm2 -v
```

## 4. Firewall (Ubuntu UFW)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

> Also confirm Hostinger's panel firewall (VPS → Settings → Security) allows
> ports **22** and **80** (and **443** once you add HTTPS).

## 5. Clone the repo

Pick the path that matches how this code lives:

**A) From GitHub (recommended once pushed):**
```bash
cd ~
git clone https://github.com/<you>/<repo>.git printmrp-backend
cd printmrp-backend
```

**B) From your laptop (no GitHub):** on your laptop run:
```powershell
scp -r "E:\vijji\MRP-Print-Backend" printmrp@<YOUR_VPS_IP>:/home/printmrp/printmrp-backend
```
Then on the VPS: `cd ~/printmrp-backend`

## 6. Drop in the production `.env`

The repo includes `.env.production` (already prepared on your machine, **gitignored**). Copy it to the VPS path it expects (`.env`):

From your laptop:
```powershell
scp "E:\vijji\MRP-Print-Backend\.env.production" printmrp@<YOUR_VPS_IP>:/home/printmrp/printmrp-backend/.env
```

Or paste the contents directly on the VPS:
```bash
cd ~/printmrp-backend
nano .env       # paste the .env.production contents, save
chmod 600 .env  # only your user can read it
```

> The `DATABASE_URL` should already point at the Supabase Session Pooler with
> your real password. If you ever rotate it: edit `.env` then `pm2 restart printmrp-api`.

## 7. Install deps, build, migrate, seed

```bash
cd ~/printmrp-backend
npm ci                          # clean install from package-lock.json
npx prisma generate
npx prisma migrate deploy       # applies prisma/migrations/* to Supabase
node prisma/seed.cjs            # creates/updates the admin row
npm run build                   # tsc → dist/
```

If `prisma migrate deploy` errors with auth, the password in `.env` is wrong.
Fix and re-run.

## 8. Start under PM2

```bash
cd ~/printmrp-backend
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs printmrp-api --lines 50
```

Make PM2 survive reboots:
```bash
pm2 save
pm2 startup systemd -u printmrp --hp /home/printmrp
# PM2 prints a `sudo env PATH=... pm2 ...` line — copy/paste and run it.
```

Quick local probe (still on the VPS):
```bash
curl http://127.0.0.1:4000/health
```
You should see a JSON response with `"ok": true`.

## 9. Put nginx in front of PM2

```bash
sudo nano /etc/nginx/sites-available/printmrp-api
```

Paste:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    # Increase if you ever upload bigger label images via the vision endpoint
    client_max_body_size 15m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

Enable + reload:
```bash
sudo ln -s /etc/nginx/sites-available/printmrp-api /etc/nginx/sites-enabled/printmrp-api
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Verify from your laptop:
```
http://<YOUR_VPS_IP>/health
```

## 10. Add a domain + HTTPS (optional, recommended)

1. In your DNS provider, add an **A record** for `api.example.com` → `<YOUR_VPS_IP>`.
2. Wait for DNS to propagate (`dig api.example.com +short` should return the IP).
3. Edit the nginx site:
   ```bash
   sudo nano /etc/nginx/sites-available/printmrp-api
   ```
   Change `server_name _;` → `server_name api.example.com;`
4. Install certbot and issue a cert:
   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d api.example.com
   sudo systemctl reload nginx
   ```
5. Tighten CORS — edit `.env` and change `CORS_ORIGINS="*"` to your actual
   frontend origin(s), then `pm2 restart printmrp-api`.

## 11. PM2 cheat-sheet

### One-shot first deploy

```bash
cd ~/printmrp-backend

# 1. Install deps + build
npm ci
npx prisma generate
npm run build

# 2. Apply DB schema + seed admin
npx prisma migrate deploy
node prisma/seed.cjs

# 3. Start under PM2
mkdir -p logs
pm2 start ecosystem.config.cjs

# 4. Persist across reboots
pm2 save
pm2 startup systemd -u $USER --hp $HOME
# ↑ copy/paste the `sudo env PATH=...` line PM2 prints, then run it.

# 5. Sanity check
pm2 status
pm2 logs printmrp-api --lines 30
curl http://127.0.0.1:4000/health
```

### Redeploy after a code change

```bash
cd ~/printmrp-backend
git pull                        # or scp the new code up
npm ci
npx prisma migrate deploy       # no-op if schema unchanged
npm run build
pm2 reload printmrp-api         # zero-downtime restart
```

### Drop-and-recreate DB (DESTRUCTIVE)

```bash
cd ~/printmrp-backend
npx prisma migrate reset --force --skip-seed
node prisma/seed.cjs
pm2 restart printmrp-api
```

### Update env vars (PM2 caches them — must `--update-env`)

```bash
cd ~/printmrp-backend
nano .env
pm2 restart printmrp-api --update-env
```

### Common PM2 commands

```bash
pm2 status                          # process overview
pm2 logs printmrp-api               # tail logs live
pm2 logs printmrp-api --lines 200   # last 200 lines
pm2 logs printmrp-api --err         # errors only
pm2 restart printmrp-api            # hard restart
pm2 reload printmrp-api             # zero-downtime restart
pm2 stop printmrp-api               # stop, keep record
pm2 delete printmrp-api             # remove entirely
pm2 monit                           # interactive CPU/mem dashboard
pm2 save                            # snapshot current process list
pm2 resurrect                       # restore snapshot after reboot
```

## 12. Troubleshooting

**`Authentication failed against database server`**
DB password in `.env` doesn't match Supabase. Reset it in
Supabase → Project Settings → Database → "Database password", paste the
new value into `.env`, then `pm2 restart printmrp-api`.

**`P1001: can't reach database`**
DNS/network issue. From the VPS try:
```bash
nslookup aws-1-ap-northeast-1.pooler.supabase.com
curl -v https://aws-1-ap-northeast-1.pooler.supabase.com:5432 2>&1 | head -5
```
If nslookup fails, the VPS DNS is broken. If `curl` fails to connect, an
egress firewall is blocking port 5432.

**`502 Bad Gateway` from nginx**
PM2 process is down or not listening on 4000:
```bash
pm2 status
pm2 logs printmrp-api --err --lines 100
ss -tlnp | grep 4000
```

**Forgot admin password**
Change `SEED_ADMIN_PASSWORD` in `.env`, then re-seed (idempotent — updates
the existing row's password):
```bash
node prisma/seed.cjs
pm2 restart printmrp-api
```

**CORS errors in the frontend**
`CORS_ORIGINS` in `.env` must list the frontend's exact origin (scheme +
host + optional port). After editing: `pm2 restart printmrp-api`.

---

## Architecture

```
[ Browser / Frontend ] ──https──> [ nginx :80/:443 ]
                                        │
                                        │  proxy_pass
                                        ▼
                                  [ PM2 → node :4000 ]
                                        │
                                        │  TLS
                                        ▼
                          [ Supabase Postgres (pooler:5432) ]
```

One node process behind nginx. Database is fully managed by Supabase — no
local Postgres on the VPS.
