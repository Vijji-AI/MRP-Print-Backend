# PrintMRP backend image — multi-stage build for a slim runtime.

# ---------- Build stage ----------
FROM node:20-alpine AS builder

# Prisma needs OpenSSL on alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Install all deps (incl. dev) for the build
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Generate the Prisma client (downloads engine binary for linux-musl)
COPY prisma ./prisma
RUN npx prisma generate

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Strip dev deps for what the runtime needs
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Copy only what we need to run
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

EXPOSE 4000

# Wait for DB, run migrations + seed (idempotent), then start.
# `prisma migrate deploy` is safe to re-run on every container start.
# The seed script no-ops if the admin already exists.
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.cjs && node dist/index.js"]
