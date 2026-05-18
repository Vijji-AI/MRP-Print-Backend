import { PrismaClient, Prisma } from '@prisma/client';

// ── Retry middleware for transient Postgres connection errors ───────────────
//
// Supabase (and any managed Postgres) periodically kicks open connections —
// during maintenance restarts, free-tier auto-pause wakeups, or pool recycling
// under load. Those events arrive as SQLSTATE 57P01 ("terminating connection
// due to administrator command") and a small family of 08xxx connection-class
// states. Prisma surfaces them as P1017 / P1001 / P2024 etc.
//
// Without retry, every request that happens to be in flight when the burst
// hits returns a 500 to the customer — even though Prisma has already opened
// a fresh connection and the next call would succeed. So we wrap every
// operation in a short exponential-backoff retry that ONLY triggers on
// connection-class errors. Application-level errors (validation, unique
// constraint, not-found, etc.) propagate unchanged so we don't accidentally
// hide real bugs.
//
// Why $extends and not $use:
//   • $use middleware is being deprecated in favour of client extensions.
//   • $extends is the supported path in Prisma 5.x and works for $allOperations.

const CONNECTION_PRISMA_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database server reached but timed out
  'P1008', // Operations timed out
  'P1017', // Server has closed the connection
  'P2024', // Timed out fetching a new connection from the pool
]);

// Postgres SQLSTATEs that mean "the connection itself died" — distinct from
// application errors like 23505 (unique violation) which we must NOT retry.
const CONNECTION_SQLSTATES = new Set([
  '57P01', // admin_shutdown — what triggered this whole file
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (DB starting up)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
]);

function isRetryableConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  // Prisma surfaces server-side disconnects through PrismaClientKnownRequestError
  // with a P-code (and often the original SQLSTATE in meta.code).
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (CONNECTION_PRISMA_CODES.has(err.code)) return true;
    const sqlState = (err.meta as { code?: string } | undefined)?.code;
    if (sqlState && CONNECTION_SQLSTATES.has(sqlState)) return true;
  }
  // PrismaClientInitializationError fires when the very first connect fails
  // (e.g. database paused on Supabase free tier). Always safe to retry.
  if (err instanceof Prisma.PrismaClientInitializationError) return true;

  // Belt-and-braces: when Prisma can't classify the error it sometimes lets the
  // raw libpq message through. Match the canonical wording for those cases so
  // we don't miss a real connection drop just because the type info was lost.
  const msg = err.message;
  if (
    msg.includes('terminating connection due to administrator command') ||
    msg.includes('Connection terminated unexpectedly') ||
    msg.includes('Server has closed the connection') ||
    msg.includes("Can't reach database server") ||
    msg.includes('SQLSTATE 57P01') ||
    msg.includes('SQLSTATE 08')
  ) {
    return true;
  }
  return false;
}

const MAX_RETRIES        = 3;
const BASE_BACKOFF_MS    = 50;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

declare global {
  // eslint-disable-next-line no-var
  var __prisma: ReturnType<typeof buildClient> | undefined;
}

function buildClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

  return base.$extends({
    name: 'retry-on-connection-error',
    query: {
      $allOperations: async ({ args, query, operation, model }) => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            if (!isRetryableConnectionError(err) || attempt === MAX_RETRIES) {
              throw err;
            }
            // Exponential backoff with ±20% jitter so multiple workers hitting
            // the same DB blip don't synchronize their retries into a thundering
            // herd against a still-recovering Postgres.
            const base = BASE_BACKOFF_MS * 2 ** attempt;
            const jitter = base * 0.2 * (Math.random() * 2 - 1);
            const wait = Math.max(10, Math.round(base + jitter));
            // eslint-disable-next-line no-console
            console.warn(
              `[prisma] connection error on ${model ?? '<raw>'}#${operation} — ` +
              `retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms ` +
              `(${err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : String(err)})`,
            );
            await sleep(wait);
          }
        }
        // Unreachable: the loop either returns or throws on attempt === MAX_RETRIES.
        throw new Error('unreachable');
      },
    },
  });
}

export const prisma = global.__prisma ?? buildClient();

if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;
