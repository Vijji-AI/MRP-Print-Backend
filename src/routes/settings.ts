import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { paperSizeDTO, settingsDTO } from '../lib/dto';
import { conflict, notFound } from '../lib/errors';
import { requireAuth, requireCustomer } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
// requireAuth must run first so req.auth is populated before requireCustomer
// reads req.auth.role. Without this, requireCustomer always 401s.
router.use(requireAuth);
router.use(requireCustomer);

// paperSize is now a free-form name string. Built-in sizes live in the
// frontend (`BUILTIN_PAPER_SIZES`); custom ones are rows in the PaperSize
// table. The string value here references whichever was selected — built-in
// or custom — and PrintFlow resolves it to mm dimensions at print time.
const settingsSchema = z.object({
  paperSize: z.string().min(1).max(80),
  printer: z.string().min(1).max(120),
  copies: z.number().int().min(1).max(50),
});

router.get('/', async (req, res, next) => {
  try {
    const auth = req.auth!;
    const existing = await prisma.settings.findUnique({ where: { customerId: auth.sub } });
    if (existing) return res.json(settingsDTO(existing));
    // Create default lazily so a fresh customer always has a Settings row.
    const created = await prisma.settings.create({
      data: { customerId: auth.sub },
    });
    res.json(settingsDTO(created));
  } catch (e) { next(e); }
});

router.put('/', validate(settingsSchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    const body = req.body as z.infer<typeof settingsSchema>;
    const updated = await prisma.settings.upsert({
      where: { customerId: auth.sub },
      create: { customerId: auth.sub, ...body },
      update: body,
    });
    res.json(settingsDTO(updated));
  } catch (e) { next(e); }
});

// ---------- Custom paper sizes ----------

const paperSizeBody = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80),
  widthMm: z.number().int().min(10, 'Width must be at least 10mm.').max(1000),
  heightMm: z.number().int().min(10, 'Height must be at least 10mm.').max(1000),
  isLabel: z.boolean().optional().default(true),
});

router.get('/paper-sizes', async (req, res, next) => {
  try {
    const list = await prisma.paperSize.findMany({
      where: { customerId: req.auth!.sub },
      orderBy: { name: 'asc' },
    });
    res.json(list.map(paperSizeDTO));
  } catch (e) { next(e); }
});

router.post('/paper-sizes', validate(paperSizeBody), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof paperSizeBody>;
    const created = await prisma.paperSize.create({
      data: { customerId: req.auth!.sub, ...body },
    });
    res.status(201).json(paperSizeDTO(created));
  } catch (e) {
    // P2002 = unique constraint violation. We have a [customerId, name] unique
    // index, so a duplicate name from the same customer trips it.
    if (isPrismaUniqueErr(e)) return next(conflict('You already have a paper size with that name.'));
    next(e);
  }
});

router.put('/paper-sizes/:id', validate(paperSizeBody), async (req, res, next) => {
  try {
    const existing = await prisma.paperSize.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.customerId !== req.auth!.sub) throw notFound('Paper size not found');
    const body = req.body as z.infer<typeof paperSizeBody>;
    const updated = await prisma.paperSize.update({
      where: { id: existing.id },
      data: body,
    });
    res.json(paperSizeDTO(updated));
  } catch (e) {
    if (isPrismaUniqueErr(e)) return next(conflict('You already have a paper size with that name.'));
    next(e);
  }
});

router.delete('/paper-sizes/:id', async (req, res, next) => {
  try {
    const existing = await prisma.paperSize.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.customerId !== req.auth!.sub) throw notFound('Paper size not found');
    await prisma.paperSize.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

function isPrismaUniqueErr(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002';
}

export default router;
