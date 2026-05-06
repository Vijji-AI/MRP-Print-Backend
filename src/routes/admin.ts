import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { customerDTO, deviceDTO, paymentDTO, printRunDTO, adminDTO } from '../lib/dto';
import { hashPassword } from '../lib/passwords';
import { conflict, notFound } from '../lib/errors';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { generateSampleFromImage } from '../lib/visionGenerate';

const router = Router();
// requireAuth must run first so req.auth is populated before requireAdmin
// reads req.auth.role. Without this, requireAdmin always 401s.
router.use(requireAuth);
router.use(requireAdmin);

// ---------- Customers ----------

const customerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(200),
  organization: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
});

const customerUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  organization: z.string().max(120).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  // 0 = no samples allowed (admin must raise it). Upper bound is a sanity cap.
  maxSamples: z.number().int().min(0).max(10000).optional(),
  // 0 = nobody can log in (effectively locks the account). Upper bound sanity.
  maxDevices: z.number().int().min(0).max(100).optional(),
});

const subscriptionSchema = z.object({
  status: z.enum(['inactive', 'active', 'expired']),
  until: z.string().datetime().optional().nullable(),
});

router.get('/customers', async (_req, res, next) => {
  try {
    const list = await prisma.customer.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(list.map(customerDTO));
  } catch (e) { next(e); }
});

router.post('/customers', validate(customerCreateSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof customerCreateSchema>;
    const existing = await prisma.customer.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('An account with that email already exists.');
    const passwordHash = await hashPassword(body.password);
    const created = await prisma.customer.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash,
        organization: body.organization,
        phone: body.phone,
      },
    });
    res.status(201).json(customerDTO(created));
  } catch (e) { next(e); }
});

router.put('/customers/:id', validate(customerUpdateSchema), async (req, res, next) => {
  try {
    const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound('Customer not found');
    const body = req.body as z.infer<typeof customerUpdateSchema>;
    const updated = await prisma.customer.update({
      where: { id: c.id },
      data: {
        name: body.name ?? c.name,
        organization: body.organization === undefined ? c.organization : body.organization ?? null,
        phone: body.phone === undefined ? c.phone : body.phone ?? null,
        maxSamples: body.maxSamples === undefined ? c.maxSamples : body.maxSamples,
        maxDevices: body.maxDevices === undefined ? c.maxDevices : body.maxDevices,
      },
    });
    res.json(customerDTO(updated));
  } catch (e) { next(e); }
});

router.delete('/customers/:id', async (req, res, next) => {
  try {
    const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound('Customer not found');
    await prisma.customer.delete({ where: { id: c.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.put('/customers/:id/subscription', validate(subscriptionSchema), async (req, res, next) => {
  try {
    const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound('Customer not found');
    const body = req.body as z.infer<typeof subscriptionSchema>;
    const updated = await prisma.customer.update({
      where: { id: c.id },
      data: {
        subscriptionStatus: body.status,
        subscriptionUntil:
          body.until !== undefined
            ? body.until
              ? new Date(body.until)
              : null
            : c.subscriptionUntil,
      },
    });
    res.json(customerDTO(updated));
  } catch (e) { next(e); }
});

// ---------- Devices ----------

router.get('/customers/:id/devices', async (req, res, next) => {
  try {
    const c = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound('Customer not found');
    const list = await prisma.device.findMany({
      where: { customerId: c.id },
      orderBy: { lastSeenAt: 'desc' },
    });
    res.json(list.map(deviceDTO));
  } catch (e) { next(e); }
});

router.delete('/customers/:cid/devices/:did', async (req, res, next) => {
  try {
    const d = await prisma.device.findUnique({ where: { id: req.params.did } });
    if (!d || d.customerId !== req.params.cid) throw notFound('Device not found');
    await prisma.device.delete({ where: { id: d.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Payments ----------

const paymentStatusSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']),
});

router.get('/payments', async (_req, res, next) => {
  try {
    const list = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true } } },
    });
    res.json(list.map(paymentDTO));
  } catch (e) { next(e); }
});

router.put('/payments/:id', validate(paymentStatusSchema), async (req, res, next) => {
  try {
    const p = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!p) throw notFound('Payment not found');
    const body = req.body as z.infer<typeof paymentStatusSchema>;
    const updated = await prisma.payment.update({
      where: { id: p.id },
      data: {
        status: body.status,
        verifiedAt: body.status === 'verified' ? new Date() : null,
      },
      include: { customer: { select: { name: true } } },
    });
    res.json(paymentDTO(updated));
  } catch (e) { next(e); }
});

// ---------- Vision-based sample generation ----------
//
// Takes a base64-encoded image of an existing label, returns a draft Sample
// (without id / customerId) that the admin can review and save in the editor.

const generateFromImageSchema = z.object({
  imageBase64: z.string().min(100, 'imageBase64 is required'),
  mimeType: z.string().min(1),
});

router.post(
  '/samples/generate-from-image',
  validate(generateFromImageSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof generateFromImageSchema>;
      const draft = await generateSampleFromImage({
        imageBase64: body.imageBase64,
        mimeType: body.mimeType,
      });
      res.json(draft);
    } catch (e) { next(e); }
  },
);

// ---------- Print runs (admin view) ----------

router.get('/prints', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const list = await prisma.printRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { customer: { select: { name: true, email: true } } },
    });
    res.json(list.map((r) => ({
      ...printRunDTO(r),
      customerName: r.customer.name,
      customerEmail: r.customer.email,
    })));
  } catch (e) { next(e); }
});

// ---------- Admin user management ----------

const adminCreateSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(6).max(200),
});

router.get('/admins', async (_req, res, next) => {
  try {
    const list = await prisma.admin.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(list.map(adminDTO));
  } catch (e) { next(e); }
});

router.post('/admins', validate(adminCreateSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof adminCreateSchema>;
    const existing = await prisma.admin.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('An admin with that email already exists.');
    const passwordHash = await hashPassword(body.password);
    const created = await prisma.admin.create({
      data: { name: body.name, email: body.email, passwordHash },
    });
    res.status(201).json(adminDTO(created));
  } catch (e) { next(e); }
});

router.delete('/admins/:id', async (req, res, next) => {
  try {
    // Prevent an admin from deleting themselves.
    if (req.auth!.sub === req.params.id) {
      res.status(400).json({ error: 'You cannot delete your own admin account.' });
      return;
    }
    const a = await prisma.admin.findUnique({ where: { id: req.params.id } });
    if (!a) throw notFound('Admin not found');
    await prisma.admin.delete({ where: { id: a.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------- Dashboard ----------

router.get('/dashboard', async (_req, res, next) => {
  try {
    const [customers, payments, samplesCount, prints, recentPayments, recentPrintRuns] = await Promise.all([
      prisma.customer.findMany({ orderBy: { totalPrints: 'desc' }, take: 6 }),
      prisma.payment.findMany(),
      prisma.sample.count(),
      prisma.customer.aggregate({ _sum: { totalPrints: true } }),
      prisma.payment.findMany({
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { customer: { select: { name: true } } },
      }),
      prisma.printRun.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { customer: { select: { name: true, email: true } } },
      }),
    ]);

    const verified = payments.filter((p) => p.status === 'verified');
    const pending = payments.filter((p) => p.status === 'pending');
    const revenue = verified.reduce((s, p) => s + p.amount, 0);

    res.json({
      counts: {
        customers: await prisma.customer.count(),
        samples: samplesCount,
        pendingPayments: pending.length,
        verifiedPayments: verified.length,
      },
      revenue,
      totalPrints: prints._sum.totalPrints ?? 0,
      recentPayments: recentPayments.map(paymentDTO),
      topCustomers: customers.map(customerDTO),
      recentPrintRuns: recentPrintRuns.map((r) => ({
        ...printRunDTO(r),
        customerName: r.customer.name,
        customerEmail: r.customer.email,
      })),
    });
  } catch (e) { next(e); }
});

export default router;
