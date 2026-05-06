// Plain CommonJS so it runs in the production runtime image without tsx/TypeScript.
//
// UPSERT semantics, scoped by email:
//   - If an admin with SEED_ADMIN_EMAIL exists, this updates their name +
//     password hash to match the env. Lets you change SEED_ADMIN_PASSWORD
//     and re-seed to rotate credentials.
//   - If not, it creates one.
//
// This means renaming SEED_ADMIN_EMAIL leaves the old admin intact alongside
// the new one. To clean up, run scripts/reset-admin.sh.

require('dotenv/config');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@printmrp.app').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const name = process.env.SEED_ADMIN_NAME || 'PrintMRP Admin';

  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    await prisma.admin.update({
      where: { email },
      data: { name, passwordHash },
    });
    console.log(`Admin updated: ${email}  (password reset to env value)`);
  } else {
    const admin = await prisma.admin.create({
      data: { email, name, passwordHash },
    });
    console.log(`Admin created: ${admin.email}  (id=${admin.id})`);
  }

  // Helpful reminder if more than one admin row is hanging around — that
  // usually means SEED_ADMIN_EMAIL was changed without deleting the old row.
  const all = await prisma.admin.findMany({ select: { email: true } });
  if (all.length > 1) {
    console.log(`\nNote: ${all.length} admin rows exist:`);
    for (const a of all) console.log(`  - ${a.email}`);
    console.log('Run scripts/reset-admin.sh to wipe them and re-seed.');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
