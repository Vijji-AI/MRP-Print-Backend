// Vision-based sample generation.
//
// Given an image of a product label, ask a multimodal LLM (OpenAI vision) to
// produce a structured layout description that maps onto our SampleField
// shape. The result is a draft — the admin reviews and edits in the UI before
// saving. This file isolates the LLM call so the rest of the codebase stays
// model-agnostic; swap the provider here without touching the route.

import { z } from 'zod';
import { config } from '../config';
import { HttpError } from './errors';

// Mirror SampleField from the frontend. Kept loose for what the model returns —
// the UI's DEFAULT_FIELDS shape is the source of truth.
const fieldSchema = z.object({
  kind: z.enum(['text', 'product', 'mrp', 'sku', 'barcode', 'qrcode', 'date', 'custom']),
  label: z.string().min(1).max(80),
  staticValue: z.string().max(200).optional(),
  columnKey: z.string().max(40).optional(),
  fontSize: z.number().int().min(6).max(72).optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
});

const generatedSampleSchema = z.object({
  name: z.string().max(120).optional(),
  description: z.string().max(400).optional(),
  width: z.number().int().min(20).max(300),
  height: z.number().int().min(10).max(300),
  fields: z.array(fieldSchema).min(1).max(20),
});

export type GeneratedSample = z.infer<typeof generatedSampleSchema>;

const SYSTEM_PROMPT = `You analyze product label / sticker images and produce a JSON description for a label-printing app.

Schema you must emit (JSON object, no prose):
{
  "name": string (short title),
  "description": string (one-line summary, optional),
  "width": integer (estimated label width in mm — typical labels are 30–100mm wide),
  "height": integer (estimated label height in mm — typical 20–60mm),
  "fields": [
    {
      "kind": "text"|"product"|"mrp"|"sku"|"barcode"|"qrcode"|"date"|"custom",
      "label": string (human-readable name shown to admins),
      "staticValue": string (optional — text that should print as-is on every label),
      "columnKey": string (optional — Excel column key to pull data from at print time),
      "fontSize": integer (px, optional, 8–48),
      "bold": boolean (optional),
      "align": "left"|"center"|"right" (optional)
    }
  ]
}

Rules for "kind":
- product: the main item/product name (the prominent line)
- mrp: the price / MRP value
- sku: SKU / article / batch code shown as plain text
- barcode: a 1D barcode (the bars themselves, not a printed number)
- qrcode: a QR code
- date: any date value (mfg, exp, packed)
- text: any static label text not driven by data (e.g. "Best before:")
- custom: anything else

Rules for columnKey vs staticValue:
- If a field shows a value that varies per product (the actual product name, price, SKU, barcode value, date), set "columnKey" so it pulls from a spreadsheet at print time. Use sensible keys: "product", "mrp", "sku", "date".
- If a field is the same on every label (e.g. the brand line "ACME Foods", or a fixed disclaimer), set "staticValue" and omit columnKey.

Order fields top-to-bottom as they visually appear in the image. Estimate width/height from the image's aspect ratio assuming a real-world product label. Always include at least one field. Output JSON only.`;

interface OpenAIChatResponse {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
}

export async function generateSampleFromImage(args: {
  imageBase64: string;
  mimeType: string;
}): Promise<GeneratedSample> {
  if (!config.openaiApiKey) {
    throw new HttpError(
      503,
      'Vision sample generation is not configured. Set OPENAI_API_KEY in the backend .env to enable it.',
    );
  }

  const mt = args.mimeType.toLowerCase();
  if (!/^image\/(png|jpeg|jpg|webp)$/.test(mt)) {
    throw new HttpError(400, `Unsupported image type: ${args.mimeType}`);
  }
  // Crude guard against absurdly large payloads — base64 is ~1.37x raw size.
  // Refuse anything > ~6MB raw.
  if (args.imageBase64.length > 8_500_000) {
    throw new HttpError(413, 'Image too large. Please upload a smaller image (≤ 6MB).');
  }

  const dataUrl = `data:${args.mimeType};base64,${args.imageBase64}`;

  const body = {
    model: config.openaiModel,
    response_format: { type: 'json_object' as const },
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Analyze this label and return the JSON.' },
          { type: 'image_url' as const, image_url: { url: dataUrl } },
        ],
      },
    ],
  };

  let res: Response;
  try {
    res = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new HttpError(502, `Could not reach vision API: ${(e as Error).message}`);
  }

  const text = await res.text();
  let json: OpenAIChatResponse | null = null;
  try { json = text ? (JSON.parse(text) as OpenAIChatResponse) : null; } catch { /* not json */ }

  if (!res.ok) {
    // Surface as much of the upstream response as possible — model-name typos
    // and disabled-API errors live in the body, not the status.
    const msg =
      json?.error?.message ||
      (text ? text.slice(0, 400) : '') ||
      `Vision provider error ${res.status}`;
    console.error('[visionGenerate] upstream error', {
      status: res.status,
      url: `${config.openaiBaseUrl}/chat/completions`,
      model: config.openaiModel,
      body: text.slice(0, 800),
    });
    throw new HttpError(502, `Vision API failed (${res.status}): ${msg}`);
  }
  const raw = json?.choices?.[0]?.message?.content;
  if (!raw) throw new HttpError(502, 'Vision API returned no content');

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new HttpError(502, 'Vision API returned non-JSON content'); }

  const validated = generatedSampleSchema.safeParse(parsed);
  if (!validated.success) {
    throw new HttpError(
      502,
      'Vision API returned a response that did not match the expected sample shape.',
      validated.error.flatten(),
    );
  }
  return validated.data;
}
