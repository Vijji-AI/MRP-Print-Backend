import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { printRunDTO, customerDTO } from '../lib/dto';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { requireAuth, requireCustomer } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { renderLabelsPDF, type SampleField } from '../lib/pdfRender';

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

// ---------- PDF generation ----------
//
// POST /api/prints/pdf
// Body: { sampleId, paperSize: name, rows: [{...}, ...] }
// Returns: application/pdf binary, one page per row at exact mm dimensions.
//
// We deliberately keep this customer-scoped (the route inherits requireCustomer
// from above): a customer can only render PDFs for their own samples.

const BUILTIN_PAPER_SIZES: Record<string, { widthMm: number; heightMm: number }> = {
  'Label-50x30':  { widthMm:  50, heightMm:  30 },
  'Label-70x40':  { widthMm:  70, heightMm:  40 },
  'Label-100x50': { widthMm: 100, heightMm:  50 },
  A4:             { widthMm: 210, heightMm: 297 },
  A5:             { widthMm: 148, heightMm: 210 },
  Letter:         { widthMm: 216, heightMm: 279 },
};

const pdfBodySchema = z.object({
  sampleId: z.string().min(1),
  paperSize: z.string().min(1).max(80),
  // Each entry is one physical label. Frontend expands qty before sending.
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()])))
    .min(1, 'At least one row is required.')
    .max(10000, 'Too many labels in one request.'),
});

router.post('/pdf', validate(pdfBodySchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    const { sampleId, paperSize, rows } = req.body as z.infer<typeof pdfBodySchema>;

    const sample = await prisma.sample.findUnique({ where: { id: sampleId } });
    if (!sample) throw notFound('Sample not found');
    if (sample.customerId !== auth.sub) throw forbidden();

    // Resolve paper size: built-in first, then customer's custom list.
    let dims = BUILTIN_PAPER_SIZES[paperSize];
    if (!dims) {
      const custom = await prisma.paperSize.findUnique({
        where: { customerId_name: { customerId: auth.sub, name: paperSize } },
      });
      if (!custom) throw badRequest(`Unknown paper size: ${paperSize}`);
      dims = { widthMm: custom.widthMm, heightMm: custom.heightMm };
    }

    const pdf = await renderLabelsPDF({
      widthMm: dims.widthMm,
      heightMm: dims.heightMm,
      fields: sample.fields as unknown as SampleField[],
      rows,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeFilename(sample.name)}-labels.pdf"`,
    );
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  } catch (e) { next(e); }
});

function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'labels';
}

export default router;
