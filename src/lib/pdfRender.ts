// Server-side label PDF generation.
//
// Why this exists: browser-based DOM-to-print on thermal label printers is
// unreliable. CSS `mm` units get reinterpreted at print time, fonts shift,
// page-size dialog overrides creep in, headers/footers sneak back. Generating
// a PDF with explicit point coordinates removes the browser layout engine
// from the equation — what's in the PDF is exactly what the printer gets.
//
// Each row produces one PDF page sized exactly to widthMm × heightMm.
// Fields stack top-to-bottom with the same kind/order semantics as
// LabelPreview on the frontend.

import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';

// ---------- Font registration ----------
//
// PDFKit ships with Helvetica only — fine for Latin text, but renders empty
// boxes for Devanagari (Nepali / Hindi) glyphs. We bundle Noto Sans
// Devanagari Regular + Bold under backend/fonts/ and register them here.
//
// We resolve from process.cwd() so dev (`tsx watch`, cwd = backend/) and
// production (`node dist/index.js`, cwd = /app) both find the same files.
// The Dockerfile copies fonts/ into the runtime stage.

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const FONT_DIR = path.resolve(process.cwd(), 'fonts');
const DEV_REGULAR = path.join(FONT_DIR, 'NotoSansDevanagari-Regular.ttf');
const DEV_BOLD    = path.join(FONT_DIR, 'NotoSansDevanagari-Bold.ttf');

// Cache the existence checks so we don't stat the disk on every label.
let devanagariFontsAvailable: boolean | null = null;
function checkDevanagariFonts(): boolean {
  if (devanagariFontsAvailable !== null) return devanagariFontsAvailable;
  try {
    devanagariFontsAvailable =
      fs.existsSync(DEV_REGULAR) && fs.existsSync(DEV_BOLD);
    if (!devanagariFontsAvailable) {
      console.warn(
        `[pdfRender] Devanagari TTFs not found under ${FONT_DIR}. ` +
        `Nepali / Hindi text will fall back to Helvetica and render as boxes.`,
      );
    }
  } catch {
    devanagariFontsAvailable = false;
  }
  return devanagariFontsAvailable;
}

/** Pick a font that can render the given text. Bold variant when requested. */
function fontForText(text: string, bold: boolean): string {
  if (DEVANAGARI_RE.test(text) && checkDevanagariFonts()) {
    // Use the alias we registered on the doc — pdfkit looks it up by name.
    return bold ? 'Devanagari-Bold' : 'Devanagari-Regular';
  }
  return bold ? 'Helvetica-Bold' : 'Helvetica';
}

export type FieldKind =
  | 'text' | 'product' | 'mrp' | 'sku'
  | 'barcode' | 'qrcode' | 'date' | 'custom';

export interface SampleField {
  id: string;
  kind: FieldKind;
  label: string;
  staticValue?: string;
  columnKey?: string;
  fontSize?: number;       // px, as authored on the frontend
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export type LabelRow = Record<string, string | number | null | undefined>;

export interface RenderInput {
  widthMm: number;
  heightMm: number;
  fields: SampleField[];
  /** Already expanded — one row per physical label to print (qty already applied). */
  rows: LabelRow[];
}

// ---------- Unit helpers ----------

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const mmToPt = (mm: number) => (mm / MM_PER_INCH) * PT_PER_INCH;
// LabelPreview uses px sizes authored on screen. Convert px→pt at 96 DPI.
const pxToPt = (px: number) => px * (72 / 96);

// ---------- Public entry point ----------

export async function renderLabelsPDF(input: RenderInput): Promise<Buffer> {
  const widthPt = mmToPt(input.widthMm);
  const heightPt = mmToPt(input.heightMm);

  const doc = new PDFDocument({
    size: [widthPt, heightPt],
    margin: 0,
    autoFirstPage: false,
    info: { Title: 'PrintMRP Labels', Producer: 'PrintMRP' },
  });

  // Register Devanagari fonts under stable aliases so fontForText() can pick
  // them by name regardless of file path. Skipped silently if the TTF files
  // aren't present — Helvetica fallback still works for Latin text.
  if (checkDevanagariFonts()) {
    doc.registerFont('Devanagari-Regular', DEV_REGULAR);
    doc.registerFont('Devanagari-Bold', DEV_BOLD);
  }

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // If there are no rows, emit a single blank page so we don't return an
  // empty PDF (some viewers refuse to open zero-page PDFs).
  if (input.rows.length === 0) {
    doc.addPage({ size: [widthPt, heightPt], margin: 0 });
  }

  for (const row of input.rows) {
    doc.addPage({ size: [widthPt, heightPt], margin: 0 });
    // eslint-disable-next-line no-await-in-loop -- pdfkit is sequential anyway
    await renderOneLabel(doc, row, input.fields, widthPt, heightPt);
  }

  doc.end();
  return done;
}

// ---------- One label ----------

async function renderOneLabel(
  doc: PDFKit.PDFDocument,
  row: LabelRow,
  fields: SampleField[],
  widthPt: number,
  heightPt: number,
): Promise<void> {
  // Fixed 1.5mm inner padding regardless of paper size — paper size only
  // dictates page dimensions; it does NOT scale type or barcode sizes. The
  // customer's per-field fontSize is the sole source of truth for text size.
  const padPt = mmToPt(1.5);
  let yCursor = padPt;
  const innerWidth = widthPt - 2 * padPt;
  const remainingY = () => heightPt - yCursor - padPt;

  // Fixed barcode / QR target sizes in mm. Still clamped to remaining height
  // so they never spill off the label, but no longer scaled by paper area.
  const barcodeMaxMm = 8;
  const qrMaxMm = 10;

  for (const f of fields) {
    if (remainingY() <= 0) break;     // out of room — skip the rest, don't overflow

    if (f.kind === 'barcode') {
      const value = resolveValue(f, row) || '0000000';
      const barcodeHeightPt = Math.min(mmToPt(barcodeMaxMm), remainingY());
      const png = await renderBarcodePNG(value);
      doc.image(png, padPt, yCursor, {
        width: innerWidth,
        height: barcodeHeightPt,
      });
      yCursor += barcodeHeightPt + 2;
      continue;
    }

    if (f.kind === 'qrcode') {
      const value = resolveValue(f, row) || ' ';
      const qrSizePt = Math.min(mmToPt(qrMaxMm), remainingY());
      const png = await renderQRPNG(value);
      // Center horizontally to match the frontend's preview.
      doc.image(png, (widthPt - qrSizePt) / 2, yCursor, {
        width: qrSizePt,
        height: qrSizePt,
      });
      yCursor += qrSizePt + 2;
      continue;
    }

    // Text-like field.
    const value = resolveValue(f, row);
    const text =
      f.kind === 'mrp'
        ? `MRP Rs. ${value || '—'}`
        : (value || ''); // empty when unbound — just skip blank lines on label
    if (!text) continue;

    // Per-field fontSize from the sample editor is the SOLE source of truth.
    // We never scale or override it based on paper size — what the customer
    // sets is exactly what prints. Only when a field has no fontSize at all
    // do we fall back to a small fixed default for that field kind.
    const fontSizePx = f.fontSize ?? defaultPxFor(f.kind);
    const fontSizePt = pxToPt(fontSizePx);
    const isBold = !!f.bold || f.kind === 'mrp' || f.kind === 'product';
    // fontForText auto-switches to the bundled Noto Sans Devanagari when
    // the text contains Devanagari characters, so Nepali product names
    // render as real glyphs instead of empty boxes.
    doc.font(fontForText(text, isBold));
    doc.fontSize(fontSizePt);
    doc.fillColor('#000');

    // Wrap to inner width; clip at remaining height so we never spill onto
    // adjacent labels.
    const lineHeightPt = fontSizePt * 1.15;
    doc.text(text, padPt, yCursor, {
      width: innerWidth,
      height: Math.max(lineHeightPt, remainingY()),
      align: f.align ?? 'left',
      lineBreak: true,
      ellipsis: true,
    });

    // pdfkit advances doc.y after a text() call — use that as the new cursor.
    yCursor = doc.y + 1;
  }
}

/**
 * Fallback px size used ONLY when a field has no `fontSize` set at all.
 * Returns a plain constant per field kind — no paper-size scaling. The
 * customer's authored `fontSize` (set in the sample editor) always wins.
 */
function defaultPxFor(kind: FieldKind): number {
  switch (kind) {
    case 'product': return 14;
    case 'mrp': return 18;
    case 'text':
    case 'sku':
    case 'date':
    case 'custom':
    default: return 11;
  }
}

function resolveValue(f: SampleField, row: LabelRow): string {
  if (f.kind === 'text') return f.staticValue ?? '';
  if (f.columnKey && row[f.columnKey] !== undefined && row[f.columnKey] !== null) {
    return String(row[f.columnKey]);
  }
  return f.staticValue ?? '';
}

// ---------- Barcode / QR helpers ----------

async function renderBarcodePNG(value: string): Promise<Buffer> {
  // Code128 covers everyday SKUs. bwip-js renders at high DPI; we resize
  // when placing in the PDF.
  return await bwipjs.toBuffer({
    bcid: 'code128',
    text: value,
    scale: 4,
    height: 12,
    includetext: false,
    backgroundcolor: 'FFFFFF',
  });
}

async function renderQRPNG(value: string): Promise<Buffer> {
  return await QRCode.toBuffer(value, {
    type: 'png',
    width: 256,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}
