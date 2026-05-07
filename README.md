# PrintMRP

A clean, monochromatic POS-style web app for designing and printing MRP labels.
Customer site (sample builder, Excel-driven print runs, mock Khalti / eSewa) and
admin portal (verify payments, manage customers, create samples on their behalf).

```
.
├── frontend/                 React + Vite + TypeScript + nginx (Dockerfile)
├── backend/                  Express + Prisma + PostgreSQL (Dockerfile)
├── docker-compose.yml        full stack: db + backend + frontend
├── .env.example              copy to .env and fill in secrets
├── DEPLOY.md                 step-by-step Hostinger VPS deploy guide
└── sample-products.xlsx      20-row sample for testing print runs
```

---

## Quick start — one command

You need **Docker Desktop** (or Docker Engine on Linux) installed.

```bash
cp .env.example .env          # optional — defaults work for local dev
docker compose up -d --build
```

Wait ~30 seconds for the images to build and the DB to come up, then open
**http://localhost** in your browser.

- Sign in to the **Admin Portal** with `admin@printmrp.app` / the password from
  `.env` (default `admin123`).
- Sign up as a customer, or have the admin create one for you.
- Try a print run: customer → **Samples → New sample** → save → **Print Run** →
  upload `sample-products.xlsx` from the project root → review → print.

### What just happened

```
[ Browser ] ──> [ frontend container :80 ]
                       │  /        →  static React build (nginx)
                       │  /api/*   →  reverse-proxy to:
                       ▼
              [ backend container :4000 ] ──> [ db container :5432 ]
                                                 (printmrp_pgdata volume)
```

Three containers, one volume, one host port. Migrations and the admin seed run
automatically on backend startup (idempotent — safe to restart).

---

## Common commands

```bash
docker compose ps                 # what's running
docker compose logs -f            # tail everything
docker compose logs -f backend    # just the API

docker compose restart backend    # restart one service
docker compose up -d --build      # rebuild + restart after a code change
docker compose down               # stop, KEEP data
docker compose down -v            # stop + DELETE the database (DESTRUCTIVE)

docker compose exec db psql -U printmrp printmrp        # open psql
docker compose exec -T db pg_dump -U printmrp printmrp > backup.sql   # backup
```

The smoke-test script under `backend/scripts/smoke-test.sh` walks through the
full happy path (signup → sample → payment → admin verify → print) and tells
you exactly which endpoint failed if anything's wrong.

```bash
brew install jq           # macOS prerequisite
bash backend/scripts/smoke-test.sh
```

---

## Working on the code without Docker

If you want hot-reload dev servers instead of rebuilding the images:

```bash
# Terminal 1 — start just the database in Docker
docker compose up -d db

# Terminal 2 — backend with watch mode
cd backend
cp .env.example .env
sed -i '' 's/db:5432/localhost:5432/' .env   # macOS; use sed -i ... on Linux
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                  # API on http://localhost:4000

# Terminal 3 — frontend with HMR
cd frontend
echo 'VITE_API_URL=http://localhost:4000' > .env.local
npm install
npm run dev                  # app on http://localhost:5173
```

---

## Deploy to a VPS

See [DEPLOY.md](./DEPLOY.md). One-command Docker path takes ~15 minutes from
zero on a fresh Hostinger Ubuntu VPS. Bare-metal alternative also documented if
you can't run Docker.

---

## What's where

| Path | What lives there |
| --- | --- |
| `docker-compose.yml` | Three services: db, backend, frontend |
| `backend/Dockerfile` | Multi-stage Node 20 image; runs migrate + seed + start |
| `frontend/Dockerfile` | Multi-stage; vite build → nginx serves + proxies `/api/` |
| `frontend/nginx.conf` | SPA fallback + reverse-proxy config |
| `frontend/src/lib/api.ts` | All API calls. Token persisted in localStorage. |
| `frontend/src/lib/auth.tsx` | Auth context (signup / login / me / logout) |
| `frontend/src/pages/customer/*` | Dashboard, Samples, SampleEditor, PrintFlow, Billing, Settings |
| `frontend/src/pages/admin/*` | Admin Dashboard, Customers, Samples, Payments |
| `backend/prisma/schema.prisma` | Data model |
| `backend/src/routes/*` | auth, samples, payments, settings, prints, admin |
| `backend/README.md` | API surface in detail |

---

## Verified

- `frontend` builds cleanly (299 modules, ~660 kB JS).
- `backend` `tsc` compiles with no errors.
- The Prisma schema runs against a real PostgreSQL 16/18 instance — every
  read/write the backend performs has been smoke-tested with raw SQL.
- `docker-compose.yml` validates with `docker compose config`.
