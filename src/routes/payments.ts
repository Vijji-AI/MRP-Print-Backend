import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { paymentDTO } from '../lib/dto';
import { notFound } from '../lib/errors';
import { requireAuth, requireCustomer } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
// requireAuth must run first so req.auth is populated before requireCustomer
// reads req.auth.role. Without this, requireCustomer always 401s.
router.use(requireAuth);
router.use(requireCustomer);

const createSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  method: z.enum(['khalti', 'esewa']),
  planMonths: z.number().int().min(1).max(36),
});

// GET /api/payments — own payment history
router.get('/', async (req, res, next) => {
  try {
    const list = await prisma.payment.findMany({
      where: { customerId: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true } } },
    });
    res.json(list.map(paymentDTO));
  } catch (e) { next(e); }
});

// POST /api/payments — record a new (mock) payment + extend subscription optimistically
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    const body = req.body as z.infer<typeof createSchema>;
    const txnRef = `${body.method.toUpperCase()}-${cryptoRandom()}`;
    const customer = await prisma.customer.findUnique({ where: { id: auth.sub } });
    if (!customer) throw notFound('Customer not found');

    const start = customer.subscriptionUntil && customer.subscriptionUntil > new Date()
      ? new Date(customer.subscriptionUntil)
      : new Date();
    start.setMonth(start.getMonth() + body.planMonths);

    const [payment] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          customerId: auth.sub,
          amount: body.amount,
          method: body.method,
          planMonths: body.planMonths,
          txnRef,
          status: 'pending',
        },
        include: { customer: { select: { name: true } } },
      }),
      prisma.customer.update({
        where: { id: auth.sub },
        data: {
          subscriptionStatus: 'active',
          subscriptionUntil: start,
        },
      }),
    ]);

    res.status(201).json(paymentDTO(payment));
  } catch (e) { next(e); }
});

function cryptoRandom() {
  // small unique-ish ref for the mock txn id
  return Math.random().toString(36).slice(2, 10).toUpperCase() +
    Date.now().toString(36).slice(-4).toUpperCase();
}

export default router;
