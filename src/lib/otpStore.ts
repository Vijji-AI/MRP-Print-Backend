/**
 * In-memory OTP store.
 *
 * Keyed by normalized phone number. Each entry holds the hashed OTP and an
 * expiry timestamp. Expired entries are cleaned up lazily on read and by a
 * periodic sweep so memory doesn't grow unboundedly.
 *
 * NOTE: This is in-process, so it resets on container restart and is NOT
 * shared across multiple replicas. For a single-VPS deploy that's fine.
 * For multi-replica, swap the Map for a Redis SETEX.
 */

import crypto from 'crypto';

const OTP_TTL_MS   = 5 * 60 * 1000;   // 5 minutes
const OTP_LENGTH   = 6;                // digits
const MAX_ATTEMPTS = 5;                // wrong guesses before the OTP is voided

interface Entry {
  otpHash:    string;   // SHA-256 of the plain OTP — never store plaintext
  expiresAt:  number;   // ms since epoch
  attempts:   number;   // wrong-guess counter
}

const store = new Map<string, Entry>();

// Sweep expired entries every 10 minutes so the Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
}, 10 * 60 * 1000).unref();

// ── Helpers ────────────────────────────────────────────────────────────────

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function normalizePhone(phone: string): string {
  // Strip spaces/dashes so "+977 98-XXXXXXXX" and "+97798XXXXXXXX" are the same key.
  return phone.replace(/[\s\-()]/g, '');
}

function generateOtp(): string {
  // Cryptographically random 6-digit code, zero-padded.
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(OTP_LENGTH, '0');
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a new OTP for `phone`, store its hash, and return the plaintext
 * OTP to be sent via SMS.
 *
 * Calling this again for the same phone before expiry replaces the old code
 * (so "resend" works without leftover codes).
 */
export function createOtp(phone: string): string {
  const otp = generateOtp();
  store.set(normalizePhone(phone), {
    otpHash:   hashOtp(otp),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts:  0,
  });
  return otp;
}

/**
 * Verify an OTP. Returns:
 *   'ok'      — correct, entry removed
 *   'expired' — no entry or TTL elapsed
 *   'wrong'   — wrong code (increments attempt counter)
 *   'locked'  — too many wrong attempts, entry removed
 */
export type VerifyResult = 'ok' | 'expired' | 'wrong' | 'locked';

export function verifyOtp(phone: string, otp: string): VerifyResult {
  const key   = normalizePhone(phone);
  const entry = store.get(key);

  if (!entry || entry.expiresAt < Date.now()) {
    store.delete(key);
    return 'expired';
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    store.delete(key);
    return 'locked';
  }

  if (hashOtp(otp) !== entry.otpHash) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      store.delete(key);
      return 'locked';
    }
    return 'wrong';
  }

  store.delete(key);
  return 'ok';
}
