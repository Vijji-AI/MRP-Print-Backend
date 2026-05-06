import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { printRunDTO, customerDTO } from '../lib/dto';
import { requireAuth, requireCustomer } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();
// requireAuth must run first so req.auth is populated before requireCustomer
// reads req.auth.role. Without this, requireCustomer always 401s.
router.use(requireAuth);
router.use(requireCustomer);

const recordSchema = z.object({
  sampleId: z.string().optional(),
  sampleName: z.string().min(1).max(200),
  labelCount: z.number().int().min(1).max(100_000),
});

router.get('/', async (req, res, next) => {
  try {
    const list = await prisma.printRun.findMany({
      where: { customerId: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(list.map(printRunDTO));
  } catch (e) { next(e); }
});

router.post('/', validate(recordSchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    const body = req.body as z.infer<typeof recordSchema>;
    const [run, customer] = await prisma.$transaction([
      prisma.printRun.create({
        data: {
          customerId: auth.sub,
          sampleId: body.sampleId ?? null,
          sampleName: body.sampleName,
          labelCount: body.labelCount,
        },
      }),
      prisma.customer.update({
        where: { id: auth.sub },
        data: { totalPrints: { increment: body.labelCount } },
      }),
    ]);
    res.status(201).json({ run: printRunDTO(run), user: customerDTO(customer) });
  } catch (e) { next(e); }
});

export default router;
