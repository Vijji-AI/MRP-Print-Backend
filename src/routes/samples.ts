import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { sampleDTO } from '../lib/dto';
import { forbidden, notFound } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
router.use(requireAuth);

const fieldSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'product', 'mrp', 'sku', 'barcode', 'qrcode', 'date', 'custom']),
  label: z.string(),
  staticValue: z.string().optional(),
  columnKey: z.string().optional(),
  fontSize: z.number().int().optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
});

const sampleBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional().nullable(),
  width: z.number().int().min(10).max(500),
  height: z.number().int().min(10).max(500),
  fields: z.array(fieldSchema),
});

// GET /api/samples — list (customer: own; admin: all, optionally filter by ?customerId=)
router.get('/', async (req, res, next) => {
  try {
    const auth = req.auth!;
    if (auth.role === 'customer') {
      const list = await prisma.sample.findMany({
        where: { customerId: auth.sub },
        orderBy: { updatedAt: 'desc' },
      });
      return res.json(list.map(sampleDTO));
    }
    // admin
    const where = req.query.customerId
      ? { customerId: String(req.query.customerId) }
      : {};
    const list = await prisma.sample.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    res.json(list.map(sampleDTO));
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const s = await prisma.sample.findUnique({ where: { id: req.params.id } });
    if (!s) throw notFound('Sample not found');
    const auth = req.auth!;
    if (auth.role === 'customer' && s.customerId !== auth.sub) throw forbidden();
    res.json(sampleDTO(s));
  } catch (e) { next(e); }
});

// POST /api/samples — customer creates own; admin must pass ?customerId=
router.post('/', validate(sampleBodySchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    let customerId: string;
    if (auth.role === 'customer') {
      customerId = auth.sub;
    } else {
      const cid = String(req.query.customerId ?? req.body.customerId ?? '');
      if (!cid) throw forbidden('customerId is required when admin creates a sample');
      customerId = cid;
    }

    // Enforce the per-customer sample cap. We do this for admin-on-behalf
    // requests too so the count stays honest; if an admin needs to exceed it,
    // they can raise maxSamples first in the customer edit modal.
    const owner = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { maxSamples: true, name: true },
    });
    if (!owner) throw notFound('Customer not found');
    const currentCount = await prisma.sample.count({ where: { customerId } });
    if (currentCount >= owner.maxSamples) {
      throw forbidden(
        auth.role === 'customer'
          ? `Sample limit reached (${currentCount}/${owner.maxSamples}). Contact your admin to raise it.`
          : `${owner.name} is at their sample limit (${currentCount}/${owner.maxSamples}). Raise it in the Edit Customer modal first.`,
      );
    }

    const body = req.body as z.infer<typeof sampleBodySchema>;
    const created = await prisma.sample.create({
      data: {
        customerId,
        name: body.name,
        description: body.description ?? null,
        width: body.width,
        height: body.height,
        fields: body.fields,
      },
    });
    res.status(201).json(sampleDTO(created));
  } catch (e) { next(e); }
});

router.put('/:id', validate(sampleBodySchema), async (req, res, next) => {
  try {
    const existing = await prisma.sample.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Sample not found');
    const auth = req.auth!;
    if (auth.role === 'customer' && existing.customerId !== auth.sub) throw forbidden();
    const body = req.body as z.infer<typeof sampleBodySchema>;
    const updated = await prisma.sample.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        description: body.description ?? null,
        width: body.width,
        height: body.height,
        fields: body.fields,
      },
    });
    res.json(sampleDTO(updated));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.sample.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Sample not found');
    const auth = req.auth!;
    if (auth.role === 'customer' && existing.customerId !== auth.sub) throw forbidden();
    await prisma.sample.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
