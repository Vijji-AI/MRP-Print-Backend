import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { sampleDTO } from '../lib/dto';
import { forbidden, notFound } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { parsePdfTable } from '../lib/pdfParse';
import { generateSampleFromImage } from '../lib/visionGenerate';

const router = Router();
router.use(requireAuth);

const fieldSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'product', 'mrp', 'sku', 'barcode', 'qrcode', 'date', 'custom']),
  label: z.string(),
  staticValue: z.string().optional(),
  columnKey: z.string().optional(),
  // Allow any positive font size — the editor now accepts custom px (incl. <8).
  // Capped at 200 to defend against truly malformed inputs.
  fontSize: z.number().int().min(1).max(200).optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  // Per-line layout extras (all optional, all bounded as sanity caps).
  leftMargin: z.number().int().min(0).max(500).optional(),
  letterSpacing: z.number().min(-10).max(50).optional(),
  // Date-field controls — only meaningful when kind === 'date', but we don't
  // refuse them on other kinds (cheap, and stripping them out is a UI concern).
  dateMode: z.enum(['today', 'custom']).optional(),
  dateFormat: z.string().max(40).optional(),
  // When true, this field renders side-by-side with the next one (shares one
  // printed row of the label). Default false → vertical stacking (legacy).
  inlineWithNext: z.boolean().optional(),
});

const sampleBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional().nullable(),
  width: z.number().int().min(10).max(500),
  height: z.number().int().min(10).max(500),
  fields: z.array(fieldSchema),
});

// POST /api/samples/parse-pdf — extract table data from a PDF using Gemini vision.
// Only available to customers whose allowPdf flag is true (enforced here).
// Body: { pdfBase64: string }  (raw base64, no data-URL prefix)
// Response: { columns: string[], rows: Record<string, string|number>[] }
const parsePdfSchema = z.object({
  pdfBase64: z.string().min(100, 'No PDF content received.').max(28_000_000),
});

router.post('/parse-pdf', validate(parsePdfSchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    // Customers: check allowPdf flag. Admins may use this freely (e.g. for testing).
    if (auth.role === 'customer') {
      const customer = await prisma.customer.findUnique({
        where: { id: auth.sub },
        select: { allowPdf: true },
      });
      if (!customer) throw forbidden('Account not found.');
      if (!customer.allowPdf) {
        throw forbidden('PDF import is not enabled for your account. Contact your administrator.');
      }
    }

    const { pdfBase64 } = req.body as z.infer<typeof parsePdfSchema>;
    const result = await parsePdfTable(pdfBase64);
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/samples/generate-from-image — Vision-based sample generation.
// Available to all authenticated users (customers and admins).
// Body: { imageBase64: string, mimeType: string }
// Response: draft Sample shape (no id/customerId) — user reviews before saving.
const generateFromImageSchema = z.object({
  imageBase64: z.string().min(100, 'imageBase64 is required'),
  mimeType: z.string().min(1),
});

router.post('/generate-from-image', validate(generateFromImageSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof generateFromImageSchema>;
    const draft = await generateSampleFromImage({
      imageBase64: body.imageBase64,
      mimeType: body.mimeType,
    });
    res.json(draft);
  } catch (e) { next(e); }
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
