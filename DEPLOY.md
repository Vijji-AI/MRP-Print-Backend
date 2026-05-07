# PrintMRP — Hostinger VPS Deploy Guide

Two paths. Pick one:

- **[Path A — Docker (recommended)](#path-a--docker-recommended)** — one command brings up DB + API + web. ~15 minutes.
- **[Path B — Bare metal](#path-b--bare-metal-no-docker)** — install Node, Postgres, nginx directly. More moving parts, ~45 minutes.

> **Heads up:** every command shows whose prompt to use. `root@vps:#` means run as root,
> `printmrp@vps:$` means run as the `printmrp` user we'll create. Never paste your VPS
> password or SSH key into a chat with anyone.

---

# Path A — Docker (recommended)

## 1. Get into the Hostinger panel

1. Sign in at https://hpanel.hostinger.com.
2. Sidebar → **VPS → Manage** for your server.
3. On the **Overview** tab, write down:
   - **IP address** — looks like `93.127.45.120`. We'll call this `YOUR_VPS_IP`.
   - **Root password** — set one if Hostinger asks. Save it in a password manager.
4. **Operating System** tab → confirm Ubuntu 22.04 or 24.04. Reinstall if not.

## 2. SSH in

```bash
# On your laptop:
ssh root@YOUR_VPS_IP
```

Type `yes` if prompted about the host fingerprint, then enter the root password.

## 3. Create a non-root user

```bash
# As root on the VPS:
apt update && apt upgrade -y
adduser printmrp                # set a strong password when asked
usermod -aG sudo printmrp

# carry SSH access over to the new user (skip if you only use a password)
mkdir -p /home/printmrp/.ssh
cp /root/.ssh/authorized_keys /home/printmrp/.ssh/authorized_keys 2>/dev/null || true
chown -R printmrp:printmrp /home/printmrp/.ssh
chmod 700 /home/printmrp/.ssh

# Add printmrp to the docker group (so we don't need sudo for docker)
# (Docker installation in the next step will create this group.)
```

Log out, then SSH back in as the new user:

```bash
exit
ssh printmrp@YOUR_VPS_IP
```

## 4. Install Docker + the firewall

```bash
# Install Docker Engine + Compose plugin (official repo)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER     # so you don't need sudo for docker
# Log out and back in to pick up the group change:
exit
ssh printmrp@YOUR_VPS_IP

# Verify
docker --version
docker compose version

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw --force enable
sudo ufw status
```

> Hostinger may also have a panel firewall under **VPS → Settings → Security**.
> Make sure ports **22** and **80** are open there too.

## 5. Get the code

If your project is on GitHub:

```bash
cd ~
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git printmrp
cd printmrp
ls
# Should show: backend  frontend  docker-compose.yml  .env.example  README.md  DEPLOY.md
```

If you don't use Git, on your laptop:

```bash
# from the project parent folder on your laptop:
scp -r "MRP Print" printmrp@YOUR_VPS_IP:/home/printmrp/printmrp
```

## 6. Configure secrets

```bash
cd ~/printmrp
cp .env.example .env
nano .env
```

At a minimum, change these:

```dotenv
POSTGRES_PASSWORD=<strong DB password>
JWT_SECRET=<paste output of: openssl rand -hex 64>
SEED_ADMIN_PASSWORD=<strong admin password>
```

Save (`Ctrl+O`, `Enter`) and exit (`Ctrl+X`).

## 7. Bring it up — one command

```bash
docker compose up -d --build
```

That:
- builds the backend image (compiles TypeScript, generates the Prisma client)
- builds the frontend image (Vite build → static files behind nginx)
- pulls Postgres 16
- starts all three; the backend waits for the DB to be healthy, then runs migrations + seeds the admin
- exposes the app on port 80

Watch it come up:

```bash
docker compose ps
docker compose logs -f
# Press Ctrl+C to stop tailing — the containers keep running.
```

When `printmrp-api` and `printmrp-web` show as `running` (and the backend's healthcheck flips to `healthy`), open:

```
http://YOUR_VPS_IP
```

You should see the PrintMRP landing page. Sign in to the **Admin Portal** with
`admin@printmrp.app` and the `SEED_ADMIN_PASSWORD` you set in `.env`.

## 8. Day-to-day operations

### Tail logs
```bash
docker compose logs -f                   # everything
docker compose logs -f backend           # just the API
docker compose logs --tail=200 backend   # last 200 lines
```

### Deploy a new version
```bash
cd ~/printmrp
git pull                                 # or scp up the new code
docker compose up -d --build
```
Migrations run automatically on container start.

### Open the database in psql
```bash
docker compose exec db psql -U printmrp printmrp
```

### Back up the database
```bash
docker compose exec -T db pg_dump -U printmrp printmrp > ~/printmrp-backup-$(date +%Y%m%d).sql
```
Move backups off the VPS to your laptop weekly:
```bash
# From your laptop:
scp printmrp@YOUR_VPS_IP:'~/printmrp-backup-*.sql' .
```

### Reset the database (DESTRUCTIVE — wipes data)
```bash
docker compose down -v
docker compose up -d --build
```

### Stop / start
```bash
docker compose stop          # stop, keep containers
docker compose start         # start them again
docker compose down          # stop + remove containers (volumes preserved)
```

### Reseed the admin
The seed runs automatically on every backend start and is idempotent — so just restart:
```bash
docker compose restart backend
```

## 9. Adding a domain + HTTPS later (optional, ~10 minutes)

Once you have a domain (say `printmrp.example.com`):

1. Registrar → add an **A record** pointing the domain to `YOUR_VPS_IP`.
2. Wait 5–60 minutes. Check with `dig printmrp.example.com +short`.
3. The simplest route is **Caddy in front of the compose stack**. SSH in, then:

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

Replace the file with:

```
printmrp.example.com {
    reverse_proxy localhost:80
}
```

```bash
sudo systemctl restart caddy
```

Caddy fetches a Let's Encrypt cert automatically and renews it. Keep the
compose stack running on port 80 internally; Caddy listens on 443.

You'll also want to free port 80 for Caddy by changing `APP_PORT=8080` in `.env`
and pointing the Caddyfile at `localhost:8080` instead.

## 10. Troubleshooting

### `docker compose up` fails with "no space left"
```bash
docker system df          # what's using space
docker system prune -af   # remove unused images/containers
```

### Frontend loads but API calls 502
Backend hasn't started yet, or its DB isn't ready.
```bash
docker compose ps                     # statuses
docker compose logs --tail=50 backend
docker compose exec backend wget -qO- http://127.0.0.1:4000/health
```

### `prisma migrate deploy` errors with "P1001: can't reach database"
The DB container isn't healthy yet. Check:
```bash
docker compose logs db
docker compose exec db pg_isready -U printmrp
```
If `pg_isready` succeeds, just `docker compose restart backend`.

### "Apple Silicon Mac dev → x86 VPS prod" image mismatch
Don't push images Mac → VPS. **Build on the VPS itself** with `docker compose up --build`. The build is native to the VPS arch and Prisma fetches the matching engine.

### I forgot the admin password
Easiest: change `SEED_ADMIN_PASSWORD` in `.env`, then **and only then** delete the existing admin row:
```bash
docker compose exec db psql -U printmrp printmrp -c 'DELETE FROM "Admin";'
docker compose restart backend
```
The seed will recreate the admin with the new password.

---

# Path B — Bare metal (no Docker)

Use this if you can't or don't want to run Docker. It installs Node, PostgreSQL, and nginx directly on the VPS.

## 1–3. Same as Path A — get a VPS, SSH in, create a `printmrp` user.

## 4. Install the basics

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL + nginx
sudo apt install -y postgresql postgresql-contrib nginx git build-essential
sudo systemctl enable --now postgresql nginx

# PM2 keeps the API running
sudo npm install -g pm2
```

## 5. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

## 6. Create the database

```bash
sudo -u postgres psql
```

```sql
CREATE USER printmrp WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE printmrp OWNER printmrp;
GRANT ALL PRIVILEGES ON DATABASE printmrp TO printmrp;
\q
```

## 7. Get the code, configure backend, start it

```bash
cd ~ && git clone https://github.com/YOU/REPO.git printmrp && cd printmrp/backend
cp .env.example .env
nano .env   # set DATABASE_URL with your CHANGE_ME password, set JWT_SECRET
```

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run build
pm2 start dist/index.js --name printmrp-api
pm2 save
pm2 startup systemd -u printmrp --hp /home/printmrp
# pm2 prints a `sudo env PATH=...` line — copy and run it.
```

## 8. Build the frontend, install with nginx

```bash
cd ~/printmrp/frontend
echo 'VITE_API_URL=' > .env.production
npm install
npm run build

sudo mkdir -p /var/www/printmrp
sudo cp -r dist/* /var/www/printmrp/
sudo chown -R www-data:www-data /var/www/printmrp
```

```bash
sudo nano /etc/nginx/sites-available/printmrp
```

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/printmrp;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location = /health { proxy_pass http://127.0.0.1:4000/health; }
    location ~* \.(js|css|svg|png|jpg|jpeg|gif|woff2?)$ { expires 30d; access_log off; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/printmrp /etc/nginx/sites-enabled/printmrp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://YOUR_VPS_IP`.

## 9. Updates (bare-metal)

```bash
cd ~/printmrp && git pull
cd backend && npm install && npx prisma migrate deploy && npm run build && pm2 restart printmrp-api
cd ../frontend && npm install && npm run build && sudo cp -r dist/* /var/www/printmrp/ && sudo systemctl reload nginx
```

---

## Architecture in one picture (Docker path)

```
[ Browser ] ── http://YOUR_VPS_IP ──> [ frontend container :80 ]
                                              │
                                              │  /        →  static React build
                                              │  /api/*   →  reverse-proxy to:
                                              ▼
                                      [ backend container :4000 ]
                                              │
                                              ▼
                                      [ db container :5432 ]
                                       (printmrp_pgdata volume)
```

Three containers, one volume, one host port. That's it.
