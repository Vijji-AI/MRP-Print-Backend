# PrintMRP — Backend

Express + TypeScript + Prisma + PostgreSQL.

## Quick start (local)

```bash
# 1. Install deps
npm install

# 2. Copy env and fill in DATABASE_URL + JWT_SECRET
cp .env.example .env
# (edit .env)

# 3. Create the database tables
npx prisma migrate dev --name init

# 4. Seed the default admin
npm run seed

# 5. Run the dev server (auto-reloads on changes)
npm run dev
```

The API listens on `http://localhost:4000`. Smoke-test with:

```bash
curl http://localhost:4000/health
```

## Production build

```bash
npm run build       # tsc -> dist/
npm run prisma:migrate   # apply migrations
npm start
```

## API surface

All endpoints live under `/api`. Auth uses a JWT in the `Authorization: Bearer <token>` header.

### Auth (public)
| Method | Path | Body |
| --- | --- | --- |
| POST | `/api/auth/signup` | `{ name, email, password, organization?, phone? }` |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/admin/login` | `{ email, password }` |
| GET  | `/api/auth/me` | — (requires token) |
| POST | `/api/auth/logout` | — |

### Customer (requires customer token)
| Method | Path |
| --- | --- |
| GET / POST | `/api/samples` |
| GET / PUT / DELETE | `/api/samples/:id` |
| GET / PUT | `/api/settings` |
| GET / POST | `/api/payments` |
| GET / POST | `/api/prints` |

### Admin (requires admin token)
| Method | Path |
| --- | --- |
| GET / POST | `/api/admin/customers` |
| PUT / DELETE | `/api/admin/customers/:id` |
| PUT | `/api/admin/customers/:id/subscription` |
| GET | `/api/admin/payments` |
| PUT | `/api/admin/payments/:id` |
| GET / POST | `/api/samples?customerId=…` (admin can filter; POST requires `customerId`) |
| GET | `/api/admin/dashboard` |

## Project layout

```
backend/
  prisma/
    schema.prisma   – data model
    seed.ts         – creates default admin
  src/
    config.ts       – env config
    app.ts          – express app + middleware
    index.ts        – entry
    lib/            – prisma, tokens, passwords, dto, errors
    middleware/     – auth, validate, error handler
    routes/         – auth, samples, payments, settings, prints, admin
```
