import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { settingsDTO } from '../lib/dto';
import { requireAuth, requireCustomer } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
// requireAuth must run first so req.auth is populated before requireCustomer
// reads req.auth.role. Without this, requireCustomer always 401s.
router.use(requireAuth);
router.use(requireCustomer);

const settingsSchema = z.object({
  paperSize: z.enum(['A4', 'A5', 'Letter', 'Label-50x30', 'Label-70x40', 'Label-100x50']),
  printer: z.string().min(1).max(120),
  copies: z.number().int().min(1).max(50),
});

router.get('/', async (req, res, next) => {
  try {
    const auth = req.auth!;
    const existing = await prisma.settings.findUnique({ where: { customerId: auth.sub } });
    if (existing) return res.json(settingsDTO(existing));
    // create default lazily
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

export default router;
