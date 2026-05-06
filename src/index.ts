import { config } from './config';
import { createApp } from './app';
import { prisma } from './lib/prisma';

async function main() {
  // verify DB connection on boot
  await prisma.$connect();
  const app = createApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`PrintMRP API listening on http://localhost:${config.port}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start', e);
  process.exit(1);
});
