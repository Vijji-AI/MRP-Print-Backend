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
// Body: { sampleId, rows: [{...}, ...] }
// Returns: application/pdf binary, one page per row sized to sample.width × sample.height.
//
// IMPORTANT: PDF page dimensions ALWAYS equal sample.width × sample.height.
// The sample IS the paper size — the customer designs the label at the exact
// physical dimensions they'll print on, so the rendered blob always matches
// the paper they loaded into the printer.
//
// We previously honored a separate `paperSize` from settings, but that caused
// the printed blob to mismatch the customer's authored label (content in
// top-left corner, blank space filling a larger page). The setting is still
// accepted in the request body for backwards compatibility but is ignored
// when computing page dimensions.
//
// We deliberately keep this customer-scoped (the route inherits requireCustomer
// from above): a customer can only render PDFs for their own samples.

const pdfBodySchema = z.object({
  sampleId:  z.string().min(1),
  // paperSize is still accepted from the client for backwards compatibility
  // but is no longer used for PDF page dimensions — sample.width × sample.height
  // is the single source of truth.
  paperSize: z.string().min(1).max(80).optional(),
  // Each entry is one physical label. Frontend expands qty before sending.
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()])))
    .min(1, 'At least one row is required.')
    .max(10000, 'Too many labels in one request.'),
});

router.post('/pdf', validate(pdfBodySchema), async (req, res, next) => {
  try {
    const auth = req.auth!;
    const { sampleId, rows } = req.body as z.infer<typeof pdfBodySchema>;

    const sample = await prisma.sample.findUnique({ where: { id: sampleId } });
    if (!sample) throw notFound('Sample not found');
    if (sample.customerId !== auth.sub) throw forbidden();

    // Sample IS the paper size — no override. The customer authored the label
    // at the exact physical dimensions they want printed, so the PDF page
    // matches automatically. paperSize from the request body is intentionally
    // ignored here (still accepted for backwards compatibility).
    const pdf = await renderLabelsPDF({
      widthMm:      sample.width,
      heightMm:     sample.height,
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
