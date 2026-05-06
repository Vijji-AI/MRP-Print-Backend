import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
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
