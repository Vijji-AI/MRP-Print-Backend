/**
 * SMS abstraction — Aakash SMS (Nepal) with console.log fallback.
 *
 * Set AAKASH_SMS_AUTH_TOKEN in your .env to enable real delivery.
 * Without it the OTP is printed to the server console (useful for dev).
 *
 * Aakash SMS docs: https://aakashsms.com/documentation/
 * API endpoint:    POST https://sms.aakashsms.com/sms/v3/send
 *
 * Phone format:  Aakash expects digits only, no leading '+'.
 *   "+9779812345678"  →  "9779812345678"
 */

const AAKASH_API = 'https://sms.aakashsms.com/sms/v3/send';

/** Strip leading '+' so "+9779812345678" → "9779812345678" */
function normalizeToField(phone: string): string {
  return phone.replace(/^\+/, '').replace(/[\s\-()]/g, '');
}

export async function sendSms(to: string, message: string): Promise<void> {
  // Read lazily so the env var is always current (dotenv loads before first call).
  const authToken = process.env.AAKASH_SMS_AUTH_TOKEN ?? '';

  if (!authToken) {
    // Dev / staging fallback: log to console so you can still test the flow.
    console.log(`\n[SMS] ──────────────────────────────`);
    console.log(`[SMS] To:      ${to}`);
    console.log(`[SMS] Message: ${message}`);
    console.log(`[SMS] (AAKASH_SMS_AUTH_TOKEN not set — SMS not actually sent)`);
    console.log(`[SMS] ──────────────────────────────\n`);
    return;
  }

  const toField = normalizeToField(to);

  // Aakash SMS HTTP API (POST form-encoded)
  const params = new URLSearchParams({
    auth_token: authToken,
    to:         toField,
    text:       message,
  });

  console.log(`[SMS] Sending to ${toField} via Aakash SMS…`);

  let res: Response;
  try {
    res = await fetch(AAKASH_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });
  } catch (err) {
    console.error('[SMS] Network error reaching Aakash SMS API:', err);
    throw new Error('Could not reach SMS gateway. Please try again.');
  }

  // Read body once (don't clone — that causes "body already consumed" issues).
  const bodyText = await res.text().catch(() => '');
  console.log(`[SMS] Aakash response ${res.status}: ${bodyText}`);

  if (!res.ok) {
    throw new Error(`SMS delivery failed (HTTP ${res.status}): ${bodyText}`);
  }

  // Aakash returns JSON even on success — check for API-level error flag.
  let json: { error?: boolean; status?: string; message?: string } | null = null;
  try { json = bodyText ? JSON.parse(bodyText) : null; } catch { /* not JSON */ }

  if (json?.error === true || json?.status === 'error') {
    console.error(`[SMS] Aakash API error: ${json.message ?? bodyText}`);
    throw new Error(`SMS delivery failed: ${json.message ?? 'Unknown error from gateway'}`);
  }

  console.log(`[SMS] OTP sent successfully to ${toField}`);
}
