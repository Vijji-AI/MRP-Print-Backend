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
  fontSize?: number;       // px, as authored on the frontend (any positive int)
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  // Per-line layout extras (frontend types.ts has the prose). 0 means no effect.
  leftMargin?: number;     // extra left indent in px
  letterSpacing?: number;  // tracking, in px
  // Date-field controls (only meaningful for kind === 'date').
  dateMode?: 'today' | 'custom';
  dateFormat?: string;     // tokens: YYYY YY MMM MM DD D · default "DD/MM/YYYY"
}

export type LabelRow = Record<string, string | number | null | undefined>;

export interface RenderInput {
  widthMm: number;
  heightMm: number;
  /** PDF page dimensions. Defaults to widthMm × heightMm when not provided.
   *  Set this to the customer's chosen paper/label size so the PDF page
   *  matches the physical media loaded in the printer. */
  pageWidthMm?: number;
  pageHeightMm?: number;
  fields: SampleField[];
  /** Already expanded — one row per physical label to print (qty already applied). */
  rows: LabelRow[];
}

// ---------- Unit helpers ----------

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const mmToPt = (mm: number) => (mm / MM_PER_INCH) * PT_PER_INCH;
// CSS px → PDF points conversion (1 CSS px = 1/96 inch, 1 pt = 1/72 inch).
//
// We previously multiplied this by an extra 0.5 "thermal printer
// compensation" factor to keep text from looking oversized on 203 DPI
// thermal heads. That heuristic backfired on regular printers and on
// PDFs viewed in normal readers — the rendered text came out half the
// physical size the customer authored, leaving roughly the lower half of
// every label blank.
//
// We now treat the customer's authored px size as the canonical physical
// size: 14px on the screen editor = 14px ≈ 10.5pt in the printed PDF,
// regardless of the printer's DPI. The page itself is sized to the
// sample's real mm dimensions, so type sized in points lands at the same
// physical size on any printer.
const pxToPt = (px: number) => px * (72 / 96);

// ---------- Markdown sentinel expansion ----------
//
// When the customer uses the markdown editor (SampleEditorForm step 2), the
// sample is saved as a single-element fields array:
//   { id: '__markdown__', kind: 'custom', label: '__markdown__',
//     staticValue: <md>, columnKey: JSON.stringify(fontSizes) }
//
// We expand it to real SampleField[] here so the rest of the renderer works
// unchanged. Font sizes are read from columnKey (JSON) and fall back to
// defaults when missing (e.g. older saves without custom sizes).

interface MdSizes { h1: number; h2: number; h3: number; h4: number; plain: number; bold: number }
const DEFAULT_MD_SIZES: MdSizes = { h1: 24, h2: 18, h3: 14, h4: 12, plain: 11, bold: 11 };

function expandMarkdownSentinel(fields: SampleField[]): SampleField[] {
  if (fields.length !== 1) return fields;
  const f0 = fields[0];
  // Check both id and label — resilient against JSON serialisation quirks
  // (Prisma Json returns the parsed value but field name collisions are possible)
  if (f0.id !== '__markdown__' && f0.label !== '__markdown__') return fields;
  const md = f0.staticValue ?? '';
  if (!md.trim()) return [];

  // Read custom font sizes saved by the editor (stored as JSON in columnKey)
  let sz: MdSizes = DEFAULT_MD_SIZES;
  try {
    if (f0.columnKey) sz = { ...DEFAULT_MD_SIZES, ...JSON.parse(f0.columnKey) };
  } catch { /* ignore */ }

  return md
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')
    .map((line, i): SampleField => {
      const id = `md-${i}`;
      const t  = line.trim();

      const bc = t.match(/^\[barcode:(\S+)\]$/i);
      if (bc) return { id, kind: 'barcode', label: 'Barcode', columnKey: bc[1] };

      const qr = t.match(/^\[qr:(\S+)\]$/i);
      if (qr) return { id, kind: 'qrcode', label: 'QR', columnKey: qr[1] };

      const h4 = t.match(/^####\s+(.*)/);
      if (h4) return { id, kind: 'text', label: 'H4', staticValue: h4[1].replace(/\*\*/g, ''), fontSize: sz.h4, bold: false };

      const h3 = t.match(/^###\s+(.*)/);
      if (h3) return { id, kind: 'text', label: 'H3', staticValue: h3[1].replace(/\*\*/g, ''), fontSize: sz.h3, bold: true };

      const h2 = t.match(/^##\s+(.*)/);
      if (h2) return { id, kind: 'text', label: 'H2', staticValue: h2[1].replace(/\*\*/g, ''), fontSize: sz.h2, bold: true };

      const h1 = t.match(/^#\s+(.*)/);
      if (h1) return { id, kind: 'text', label: 'H1', staticValue: h1[1].replace(/\*\*/g, ''), fontSize: sz.h1, bold: true };

      const bLine = t.match(/^\*\*(.+)\*\*$/);
      if (bLine) return { id, kind: 'text', label: 'Bold', staticValue: bLine[1], fontSize: sz.bold, bold: true };

      return { id, kind: 'text', label: 'Text', staticValue: t.replace(/\*\*/g, ''), fontSize: sz.plain, bold: false };
    });
}

// ---------- Public entry point ----------

export async function renderLabelsPDF(input: RenderInput): Promise<Buffer> {
  // Expand markdown sentinel before anything else.
  const resolvedInput: RenderInput = {
    ...input,
    fields: expandMarkdownSentinel(input.fields),
  };

  // Content drawing area — the sample's own label dimensions.
  const contentWidthPt  = mmToPt(resolvedInput.widthMm);
  const contentHeightPt = mmToPt(resolvedInput.heightMm);

  // PDF page dimensions — use the caller-supplied paper size when available;
  // otherwise fall back to the label size so every page exactly fits one label.
  const pageWidthPt  = resolvedInput.pageWidthMm  ? mmToPt(resolvedInput.pageWidthMm)  : contentWidthPt;
  const pageHeightPt = resolvedInput.pageHeightMm ? mmToPt(resolvedInput.pageHeightMm) : contentHeightPt;

  // Keep backward-compat aliases so renderOneLabel still compiles.
  const widthPt  = contentWidthPt;
  const heightPt = contentHeightPt;

  const doc = new PDFDocument({
    size: [pageWidthPt, pageHeightPt],
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
  if (resolvedInput.rows.length === 0) {
    doc.addPage({ size: [pageWidthPt, pageHeightPt], margin: 0 });
  }

  for (const row of resolvedInput.rows) {
    doc.addPage({ size: [pageWidthPt, pageHeightPt], margin: 0 });
    // eslint-disable-next-line no-await-in-loop -- pdfkit is sequential anyway
    await renderOneLabel(doc, row, resolvedInput.fields, widthPt, heightPt);
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
    // Strip any markdown bold markers (**) that may have leaked through if the
    // sentinel expansion was skipped — they should never appear in printed output.
    const text =
      f.kind === 'mrp'
        ? `MRP Rs. ${value || '—'}`
        : (value || '').replace(/\*\*/g, ''); // empty when unbound — just skip blank lines on label
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

    // ── Per-line layout extras ────────────────────────────────────────────
    // leftMargin (px) shifts the x-origin of this line to the right; the
    // available drawing width shrinks accordingly so wrapping still respects
    // the global right edge. letterSpacing (px) maps to PDFKit's
    // characterSpacing option (in PDF points). Both default to 0 when unset
    // so existing samples are unaffected.
    const leftMarginPt    = pxToPt(f.leftMargin    ?? 0);
    const letterSpacingPt = pxToPt(f.letterSpacing ?? 0);
    const xStart          = padPt + leftMarginPt;
    const drawWidth       = Math.max(1, innerWidth - leftMarginPt);

    // Wrap to drawWidth; clip at remaining height so we never spill onto
    // adjacent labels.
    const lineHeightPt = fontSizePt * 1.15;
    doc.text(text, xStart, yCursor, {
      width: drawWidth,
      height: Math.max(lineHeightPt, remainingY()),
      align: f.align ?? 'left',
      lineBreak: true,
      ellipsis: true,
      characterSpacing: letterSpacingPt,
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

/**
 * Normalize a column key for fuzzy matching: lowercase, trim, then drop every
 * non-alphanumeric character. This makes the lookup tolerant of all the ways
 * the same column name shows up in the wild:
 *
 *   "Part No"   → "partno"
 *   "part_no"   → "partno"
 *   "part-no"   → "partno"
 *   " PART NO " → "partno"
 *   "Part No."  → "partno"
 *
 * This is critical because the customer's authored placeholder ("{Part No}")
 * and the Excel header ("part_no" or "Part_Number") frequently disagree in
 * subtle ways. Without normalization the placeholder prints as literal text
 * in the PDF — which is exactly what we were seeing.
 */
function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Build a normalized → value index over a row, keyed by `normalizeKey(k)`.
 * The first occurrence wins when two columns normalize to the same string
 * (avoids ambiguity when, say, both "Part No" and "Part-No" are present).
 */
function buildRowIndex(row: LabelRow): Map<string, string | number | null | undefined> {
  const idx = new Map<string, string | number | null | undefined>();
  for (const [k, v] of Object.entries(row)) {
    const nk = normalizeKey(k);
    if (nk && !idx.has(nk)) idx.set(nk, v);
  }
  return idx;
}

/**
 * Interpolate `{column_key}` placeholders in `template` from `row`.
 *
 * Enables mixed static + dynamic text, e.g.:
 *   template = "HS CODE: {hs_code}"   row = { "HS Code": "0901110010" }
 *   result   = "HS CODE: 0901110010"
 *
 * Lookup strategy (in order):
 *   1. Exact key match              — "Part No" → row["Part No"]
 *   2. Trimmed key match            — " Part No " → row["Part No"]
 *   3. Normalized fuzzy match       — "Part No" → "partno" → row["Part_No"]
 *
 * Placeholders whose key is absent or blank are left unchanged so the
 * customer can see which column key is missing.
 */
function interpolateTemplate(template: string, row: LabelRow): string {
  if (!template || !template.includes('{')) return template;
  const idx = buildRowIndex(row);
  return template.replace(/\{([^}]+)\}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    // 1. Exact
    let val: string | number | null | undefined = row[key];
    // 2. Original (handles "{ Part No }" preserving surrounding whitespace)
    if (val === undefined) val = row[rawKey];
    // 3. Normalized fuzzy match
    if (val === undefined) val = idx.get(normalizeKey(key));
    if (val === undefined || val === null) return match; // leave placeholder visible
    const s = String(val).trim();
    return s !== '' ? s : match;
  });
}

/**
 * Look up a column key in a row, trying exact match first, then trimmed,
 * then normalized (case-insensitive + non-alphanumerics stripped). Handles
 * the common discrepancies between the column key authored in the sample
 * editor and the actual Excel header — e.g. "Part No" vs "part_no" vs "Part-No".
 */
function lookupColumn(key: string, row: LabelRow): string | number | null | undefined {
  // 1. Exact match
  let val = row[key];
  if (val !== undefined) return val;
  // 2. Trimmed exact match
  const trimmed = key.trim();
  if (trimmed !== key) { val = row[trimmed]; if (val !== undefined) return val; }
  // 3. Normalized fuzzy match
  const norm = normalizeKey(trimmed);
  if (!norm) return undefined;
  for (const [k, v] of Object.entries(row)) {
    if (normalizeKey(k) === norm) return v;
  }
  return undefined;
}

// Date-format token replacer. Same fixed grammar the frontend uses
// (frontend/src/components/SampleEditorForm.tsx formatDateToken) — keep the
// three copies (here, the editor, LabelPreview) in sync if you extend it.
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateToken(d: Date, fmt: string): string {
  const Y = String(d.getFullYear());
  const M = d.getMonth() + 1;
  const D = d.getDate();
  return fmt
    .replace(/YYYY/g, Y)
    .replace(/YY/g,   Y.slice(-2))
    .replace(/MMM/g,  MONTH_SHORT[d.getMonth()])
    .replace(/MM/g,   String(M).padStart(2, '0'))
    .replace(/DD/g,   String(D).padStart(2, '0'))
    .replace(/(?<![A-Za-z])M(?![A-Za-z])/g, String(M))
    .replace(/(?<![A-Za-z])D(?![A-Za-z])/g, String(D));
}

function resolveValue(f: SampleField, row: LabelRow): string {
  // Date kind: autofill mode renders today's date formatted per dateFormat;
  // custom mode prints whatever the customer typed in staticValue verbatim.
  if (f.kind === 'date') {
    if (f.dateMode === 'custom') return f.staticValue ?? '';
    return formatDateToken(new Date(), f.dateFormat || 'DD/MM/YYYY');
  }
  if (f.kind === 'text') {
    // Text fields are always static, but support {placeholder} interpolation.
    return interpolateTemplate(f.staticValue ?? '', row);
  }
  // Use the Excel value only when it's actually present AND non-blank.
  // Empty strings and whitespace-only cells must fall through to the
  // static value — otherwise blank Excel cells silently produce blank
  // labels and the "Fallback / static value" the customer authored is
  // never honored.
  if (f.columnKey) {
    const raw = lookupColumn(f.columnKey, row);
    if (raw !== undefined && raw !== null) {
      const s = String(raw).trim();
      if (s !== '') return s;
    }
  }
  // Fallback: staticValue supports {placeholder} templates resolved from row
  // data, enabling mixed static+dynamic output like "HS CODE: {hs_code}".
  return interpolateTemplate(f.staticValue ?? '', row);
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
