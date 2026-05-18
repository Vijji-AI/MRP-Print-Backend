import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { subscriptionRequestDTO } from '../lib/dto';
import { forbidden, notFound } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  maxSamples: z.number().int().min(1).max(100),
  maxDevices: z.number().int().min(1).max(20),
  planMonths: z.number().int().min(1).max(24),
  note: z.string().max(500).optional(),
});

// POST /api/subscription-requests — customer submits a plan request
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    if (auth.role !== 'customer') throw forbidden('Only customers can submit subscription requests.');
    const body = req.body as z.infer<typeof createSchema>;
    const created = await prisma.subscriptionRequest.create({
      data: {
        customerId: auth.sub,
        maxSamples: body.maxSamples,
        maxDevices: body.maxDevices,
        planMonths: body.planMonths,
        note: body.note ?? null,
      },
      include: { customer: { select: { name: true, email: true } } },
    });
    res.status(201).json(subscriptionRequestDTO(created));
  } catch (e) { next(e); }
});

// GET /api/subscription-requests — customer sees their own requests;
//   admin can optionally pass ?all=true to see all pending requests
router.get('/', async (req, res, next) => {
  try {
    const auth = req.auth!;
    if (auth.role === 'customer') {
      const list = await prisma.subscriptionRequest.findMany({
        where: { customerId: auth.sub },
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true, email: true } } },
      });
      return res.json(list.map(subscriptionRequestDTO));
    }
    // admin: return all requests (newest first)
    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const list = await prisma.subscriptionRequest.findMany({
      where: statusFilter ? { status: statusFilter } : {},
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true, email: true } } },
    });
    res.json(list.map(subscriptionRequestDTO));
  } catch (e) { next(e); }
});

const updateSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

// PUT /api/subscription-requests/:id — admin approves or rejects a request.
// On approval: updates the customer's maxSamples, maxDevices, and activates
// their subscription for the requested number of months.
router.put('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    if (auth.role !== 'admin') throw forbidden('Only admins can update subscription requests.');

    const sr = await prisma.subscriptionRequest.findUnique({ where: { id: req.params.id } });
    if (!sr) throw notFound('Subscription request not found.');
    if (sr.status !== 'pending') throw forbidden('Request has already been processed.');

    const body = req.body as z.infer<typeof updateSchema>;
    const updated = await prisma.subscriptionRequest.update({
      where: { id: sr.id },
      data: { status: body.status },
      include: { customer: { select: { name: true, email: true } } },
    });

    // On approval: apply the requested plan to the customer account
    if (body.status === 'approved') {
      const until = new Date();
      until.setMonth(until.getMonth() + sr.planMonths);
      await prisma.customer.update({
        where: { id: sr.customerId },
        data: {
          maxSamples: sr.maxSamples,
          maxDevices: sr.maxDevices,
          subscriptionStatus: 'active',
          subscriptionUntil: until,
        },
      });
    }

    res.json(subscriptionRequestDTO(updated));
  } catch (e) { next(e); }
});

export default router;
