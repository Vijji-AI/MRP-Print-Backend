// PDF table extraction via Gemini vision.
//
// Accepts a base64-encoded PDF, sends it to the Gemini generateContent API
// (native format — the OpenAI-compat layer does not support PDF inline data),
// and asks the model to produce a JSON table with detected column names and rows.
//
// The API key and model name come from the same config as the rest of the app.
// The native Gemini base URL is derived from config.openaiBaseUrl: strip the
// trailing "/openai" segment if present, otherwise fall back to the public
// Gemini endpoint.

import { z } from 'zod';
import { config } from '../config';
import { HttpError } from './errors';

// ── Output schema ────────────────────────────────────────────────────────────

const parsedTableSchema = z.object({
  columns: z.array(z.string().min(1).max(120)).min(1).max(80),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1).max(5000),
});

export type ParsedPdfTable = z.infer<typeof parsedTableSchema>;

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a data-extraction assistant. The user will give you a PDF document.
Your job is to find the main tabular data in it and return it as a JSON object — no prose, just JSON.

Return exactly this shape:
{
  "columns": ["ColumnA", "ColumnB", ...],  // the detected column headers
  "rows": [
    { "ColumnA": "value", "ColumnB": 123, ... },
    ...
  ]
}

Rules:
- Use the actual header text from the document as column names (trim whitespace).
- If a cell is a number, emit it as a JSON number, not a string.
- If a cell is empty, omit the key for that row entirely (do not emit null or "").
- Include every data row you can find. Ignore page headers, footers, and summary rows.
- If the PDF contains multiple tables, pick the largest / most prominent one.
- Output JSON only, no markdown fences.`;

// ── Gemini native API helper ──────────────────────────────────────────────────

/**
 * Derive the Gemini native REST base URL from the OpenAI-compat base URL the
 * operator configured. Examples:
 *   "https://generativelanguage.googleapis.com/v1beta/openai"
 *   → "https://generativelanguage.googleapis.com/v1beta"
 *
 *   "https://generativelanguage.googleapis.com/v1beta"
 *   → "https://generativelanguage.googleapis.com/v1beta"
 *
 * If the base URL looks like a different provider (e.g. Azure), we still use
 * it as-is and let the caller fail gracefully.
 */
function geminiNativeBase(): string {
  const base = (config.openaiBaseUrl ?? '').replace(/\/+$/, '');
  // Strip "/openai" suffix if present (Gemini compat layer adds it).
  return base.endsWith('/openai') ? base.slice(0, -7) : base;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  error?: { message?: string; code?: number };
}

// ── Public export ─────────────────────────────────────────────────────────────

/**
 * Parse a PDF document and extract the main table as structured JSON.
 *
 * @param pdfBase64 - Raw base64-encoded PDF content (no data-URL prefix).
 * @returns Detected column names and rows ready to populate PrintFlow.
 */
export async function parsePdfTable(pdfBase64: string): Promise<ParsedPdfTable> {
  if (!config.openaiApiKey) {
    throw new HttpError(
      503,
      'PDF parsing is not configured. Set OPENAI_API_KEY (Gemini API key) in the backend .env to enable it.',
    );
  }

  // Very rough size guard — base64 is ~1.37× raw. 20MB raw ≈ 27MB base64.
  if (pdfBase64.length > 28_000_000) {
    throw new HttpError(413, 'PDF is too large. Please upload a file smaller than 20MB.');
  }

  const nativeBase = geminiNativeBase();
  const model = config.openaiModel ?? 'gemini-2.0-flash';

  // Gemini generateContent endpoint: POST /v1beta/models/{model}:generateContent?key={apiKey}
  const url = `${nativeBase}/models/${model}:generateContent?key=${config.openaiApiKey}`;

  const requestBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            text: 'Extract the main table from this PDF and return it as JSON.',
          },
        ],
      },
    ],
    generation_config: {
      response_mime_type: 'application/json',
    },
  };

  console.log('[pdfParse] calling Gemini', { model, urlBase: nativeBase, pdfBytes: Math.round(pdfBase64.length * 0.75) });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    throw new HttpError(502, `Could not reach Gemini API: ${(e as Error).message}`);
  }

  const text = await res.text();
  let geminiJson: GeminiResponse | null = null;
  try { geminiJson = text ? (JSON.parse(text) as GeminiResponse) : null; } catch { /* not json */ }

  if (!res.ok) {
    const msg =
      geminiJson?.error?.message ||
      (text ? text.slice(0, 400) : '') ||
      `Gemini error ${res.status}`;
    console.error('[pdfParse] Gemini upstream error', { status: res.status, body: text.slice(0, 800) });
    throw new HttpError(502, `Gemini API failed (${res.status}): ${msg}`);
  }

  const raw = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) {
    throw new HttpError(502, 'Gemini returned no content. The PDF may have no extractable table data.');
  }

  // Strip markdown fences if the model wrapped the JSON anyway.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  let parsed: unknown;
  try { parsed = JSON.parse(cleaned); }
  catch { throw new HttpError(502, 'Gemini returned non-JSON content — could not parse table.'); }

  const validated = parsedTableSchema.safeParse(parsed);
  if (!validated.success) {
    console.error('[pdfParse] schema mismatch', validated.error.flatten());
    throw new HttpError(
      502,
      'Gemini response did not match the expected table shape. The PDF may not contain a table.',
    );
  }

  console.log('[pdfParse] success', {
    columns: validated.data.columns.length,
    rows: validated.data.rows.length,
  });
  return validated.data;
}
