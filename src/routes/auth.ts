import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashPassword, verifyPassword } from '../lib/passwords';
import { signToken } from '../lib/tokens';
import { adminDTO, customerDTO } from '../lib/dto';
import { conflict, forbidden, unauthorized } from '../lib/errors';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';

const router = Router();

const signupSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(200),
  organization: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  deviceId: z.string().min(8).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
  deviceId: z.string().min(8).max(80).optional(),
});

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

router.post('/signup', validate(signupSchema), async (req, res, next) => {
  try {
    const { name, email, password, organization, phone, deviceId } = req.body as z.infer<typeof signupSchema>;
    const existing = await prisma.customer.findUnique({ where: { email } });
    if (existing) throw conflict('An account with that email already exists.');
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

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password, deviceId } = req.body as z.infer<typeof loginSchema>;
    const c = await prisma.customer.findUnique({ where: { email } });
    if (!c) throw unauthorized('No account with that email.');
    const ok = await verifyPassword(password, c.passwordHash);
    if (!ok) throw unauthorized('Incorrect password.');
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

router.post('/admin/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const a = await prisma.admin.findUnique({ where: { email } });
    if (!a) throw unauthorized('No admin with that email.');
    const ok = await verifyPassword(password, a.passwordHash);
    if (!ok) throw unauthorized('Incorrect password.');
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

router.post('/logout', (_req, res) => {
  // JWTs are stateless. Frontend just discards the token.
  res.json({ ok: true });
});

export default router;
