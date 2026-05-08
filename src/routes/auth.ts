import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword } from '../lib/passwords';
import { signToken, verifyToken } from '../lib/tokens';
import { adminDTO, customerDTO } from '../lib/dto';
import { conflict, forbidden, unauthorized } from '../lib/errors';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { createOtp, verifyOtp } from '../lib/otpStore';
import { sendSms } from '../lib/sms';

const router = Router();

// ---------- Rate limiting ----------
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

// Tighter limiter for OTP send — prevent SMS spam
const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,   // 10 minutes
  max: 5,                      // 5 OTP sends per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait before requesting another.' },
});

// ---------- Schemas ----------

// Accept "+977XXXXXXXXXX" (13 chars, Nepal mobile) as well as the old flexible
// format for any legacy data or international numbers.
const phoneRegex = /^\+?[\d\s\-()]{7,20}$/;

const otpSendSchema = z.object({
  phone: z.string().trim().regex(phoneRegex, 'Please enter a valid phone number.'),
});

const otpVerifySchema = z.object({
  phone: z.string().trim().regex(phoneRegex, 'Please enter a valid phone number.'),
  otp:   z.string().length(6, 'OTP must be 6 digits.').regex(/^\d+$/, 'OTP must be digits only.'),
});

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(120),
  email: z.string()
    .email('Please enter a valid email address.')
    .max(254)
    .toLowerCase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters.')
    .max(200, 'Password is too long.'),
  phone: z.string()
    .trim()
    .regex(phoneRegex, 'Please enter a valid phone number (digits, spaces, +, -, ( ) only).'),
  organization: z.string().trim().max(120).optional(),
  deviceId: z.string().min(8).max(80).optional(),
  // Short-lived token issued after OTP verification.
  // Required for new signups; optional for dev environments without SMS.
  phoneToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string()
    .email('Please enter a valid email address.')
    .max(254)
    .toLowerCase(),
  password: z.string()
    .min(1, 'Please enter your password.')
    .max(200),
  deviceId: z.string().min(8).max(80).optional(),
});

// Pre-computed bcrypt hash used to "verify" against missing accounts so the
// response time of "no such user" matches "wrong password". This closes the
// timing-based user-enumeration vector. The plaintext for this hash is unknown
// and unused — the verifyPassword call will always return false on it.
const DUMMY_BCRYPT_HASH =
  '$2a$10$CwTycUXWue0Thq9StjUM0uJ8ywazq1nFffHmvN0a/XtIsabNc1H3W';

// ---------- Device helpers ----------

/**
 * Register-or-touch a Device row for a customer at login/signup time.
 * - Returns the deviceId if registered or already known.
 * - Returns null if no deviceId was supplied (legacy clients pre-feature).
 * - Throws 403 when the customer is already at maxDevices and this is a new
 *   browser they've never used before.
 */
async function registerDeviceOrThrow(
  customerId: string,
  deviceId: string | undefined,
  userAgent: string | undefined,
): Promise<string | null> {
  if (!deviceId) return null;
  const existing = await prisma.device.findUnique({
    where: { customerId_deviceId: { customerId, deviceId } },
  });
  if (existing) {
    await prisma.device.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), userAgent: userAgent ?? existing.userAgent },
    });
    return deviceId;
  }
  // New browser. Check the cap.
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { maxDevices: true },
  });
  if (!customer) throw unauthorized();
  const count = await prisma.device.count({ where: { customerId } });
  if (count >= customer.maxDevices) {
    throw forbidden(
      `Device limit reached (${count}/${customer.maxDevices}). ` +
      `Sign out on another device first or contact your admin.`,
    );
  }
  await prisma.device.create({
    data: { customerId, deviceId, userAgent: userAgent ?? null },
  });
  return deviceId;
}

// ---------- OTP helpers ----------

const OTP_TOKEN_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const OTP_TOKEN_TTL    = 10 * 60; // 10 minutes in seconds

function signPhoneToken(phone: string): string {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ phone, purpose: 'phone-verified' }, OTP_TOKEN_SECRET, { expiresIn: OTP_TOKEN_TTL });
}

function verifyPhoneToken(token: string): string | null {
  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, OTP_TOKEN_SECRET) as { phone?: string; purpose?: string };
    if (payload.purpose !== 'phone-verified' || !payload.phone) return null;
    return payload.phone;
  } catch {
    return null;
  }
}

// ---------- Routes ----------

// POST /api/auth/otp/send — send OTP to phone number
router.post('/otp/send', otpSendLimiter, validate(otpSendSchema), async (req, res, next) => {
  try {
    const { phone } = req.body as z.infer<typeof otpSendSchema>;
    const otp = createOtp(phone);
    await sendSms(phone, `Your PrintMRP verification code is: ${otp}. Valid for 5 minutes. Do not share it.`);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/auth/otp/verify — verify OTP, receive short-lived phone token
router.post('/otp/verify', authLimiter, validate(otpVerifySchema), async (req, res, next) => {
  try {
    const { phone, otp } = req.body as z.infer<typeof otpVerifySchema>;
    const result = verifyOtp(phone, otp);

    if (result === 'ok') {
      const phoneToken = signPhoneToken(phone);
      return res.json({ ok: true, phoneToken });
    }
    if (result === 'expired') {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }
    if (result === 'locked') {
      return res.status(429).json({ error: 'Too many wrong attempts. Please request a new OTP.' });
    }
    // 'wrong'
    return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
  } catch (e) { next(e); }
});

router.post('/signup', authLimiter, validate(signupSchema), async (req, res, next) => {
  try {
    const { name, email, password, organization, phone, deviceId, phoneToken } = req.body as z.infer<typeof signupSchema>;
    const existing = await prisma.customer.findUnique({ where: { email } });
    // Note: keeping a clear "already in use" error here because UX requires it
    // (without it, users can't tell why their signup failed). The email-
    // enumeration risk for signups is similar in any product with public
    // signup; the bigger leak (login) is fixed below.
    if (existing) throw conflict('An account with that email already exists.');

    // Phone verification: validate the phoneToken issued after OTP verify.
    // In dev (no AAKASH_SMS_AUTH_TOKEN set) we skip enforcement so local testing
    // still works. In production, always require a valid token.
    const requirePhoneVerification = !!process.env.AAKASH_SMS_AUTH_TOKEN;
    if (requirePhoneVerification) {
      if (!phoneToken) {
        return res.status(400).json({ error: 'Phone number must be verified via OTP before signup.' });
      }
      const verifiedPhone = verifyPhoneToken(phoneToken);
      if (!verifiedPhone) {
        return res.status(400).json({ error: 'Phone verification token is invalid or expired. Please verify again.' });
      }
      // Normalise both sides so "+977 98XXXXXXXX" == "+97798XXXXXXXX"
      const norm = (s: string) => s.replace(/[\s\-()]/g, '');
      if (norm(verifiedPhone) !== norm(phone)) {
        return res.status(400).json({ error: 'Verified phone does not match the submitted phone number.' });
      }
    }

    const passwordHash = await hashPassword(password);
    const customer = await prisma.customer.create({
      data: { name, email, passwordHash, organization, phone },
    });
    const boundDevice = await registerDeviceOrThrow(
      customer.id, deviceId, req.header('user-agent') ?? undefined,
    );
    const token = signToken({
      sub: customer.id, role: 'customer', email: customer.email,
      ...(boundDevice ? { deviceId: boundDevice } : {}),
    });
    res.status(201).json({ token, role: 'customer', user: customerDTO(customer) });
  } catch (e) { next(e); }
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password, deviceId } = req.body as z.infer<typeof loginSchema>;
    const c = await prisma.customer.findUnique({ where: { email } });

    // ALWAYS run bcrypt — even for non-existent accounts — so an attacker
    // can't use response timing to enumerate which emails are registered.
    // The dummy hash is fixed and verifyPassword will always return false on it.
    const ok = await verifyPassword(password, c?.passwordHash ?? DUMMY_BCRYPT_HASH);
    if (!c || !ok) throw unauthorized('Invalid email or password.');

    const boundDevice = await registerDeviceOrThrow(
      c.id, deviceId, req.header('user-agent') ?? undefined,
    );
    const token = signToken({
      sub: c.id, role: 'customer', email: c.email,
      ...(boundDevice ? { deviceId: boundDevice } : {}),
    });
    res.json({ token, role: 'customer', user: customerDTO(c) });
  } catch (e) { next(e); }
});

router.post('/admin/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const a = await prisma.admin.findUnique({ where: { email } });
    const ok = await verifyPassword(password, a?.passwordHash ?? DUMMY_BCRYPT_HASH);
    if (!a || !ok) throw unauthorized('Invalid email or password.');
    const token = signToken({ sub: a.id, role: 'admin', email: a.email });
    res.json({ token, role: 'admin', user: adminDTO(a) });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const auth = req.auth!;
    if (auth.role === 'customer') {
      const c = await prisma.customer.findUnique({ where: { id: auth.sub } });
      if (!c) throw unauthorized('Account no longer exists');
      return res.json({ role: 'customer', user: customerDTO(c) });
    }
    const a = await prisma.admin.findUnique({ where: { id: auth.sub } });
    if (!a) throw unauthorized('Admin no longer exists');
    res.json({ role: 'admin', user: adminDTO(a) });
  } catch (e) { next(e); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  // JWTs are stateless so the token itself can't be invalidated, but we DO
  // remove the device row when a customer logs out: it frees a device slot,
  // and the next request from this browser bearing the (now stale) token
  // gets bounced by requireAuth's device check. Net effect: one-step logout.
  try {
    const auth = req.auth!;
    if (auth.role === 'customer' && auth.deviceId) {
      await prisma.device.deleteMany({
        where: { customerId: auth.sub, deviceId: auth.deviceId },
      });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
