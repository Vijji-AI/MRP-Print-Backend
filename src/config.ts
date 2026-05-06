import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// Validate JWT_SECRET strength: short or placeholder secrets let an attacker
// forge any user's token, so we fail fast in production and warn loudly in dev.
function validatedJwtSecret(): string {
  const v = required('JWT_SECRET');
  const looksDefault = v.toLowerCase().includes('change-me') || v === 'secret';
  const tooShort = v.length < 32;
  if (process.env.NODE_ENV === 'production' && (looksDefault || tooShort)) {
    throw new Error(
      'JWT_SECRET is unsafe in production: must be ≥32 random chars and not the default. ' +
      'Generate one with `openssl rand -hex 64`.',
    );
  }
  if (looksDefault || tooShort) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] JWT_SECRET is short or looks like a placeholder. Generate a real one with ' +
      '`openssl rand -hex 64`. This warning becomes a fatal error in production.',
    );
  }
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: validatedJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Vision-based sample generation. Optional — if unset, the
  // /api/admin/samples/generate-from-image endpoint returns 503.
  // The endpoint speaks the OpenAI chat-completions protocol; point
  // openaiBaseUrl at any compatible provider (e.g. Gemini's OpenAI-compat
  // endpoint) and put their API key in openaiApiKey.
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
};
