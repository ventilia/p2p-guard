/**
 * Первичное наполнение: администратор, демо-команда и один токен доступа.
 * Запуск: npm run seed (идемпотентно).
 */
import { PrismaClient, Role } from '@prisma/client';
import { env } from '../src/env.js';
import { hashPassword, randomToken, sha256 } from '../src/lib/crypto.js';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.upsert({
    where: { binanceUid: env.SEED_ADMIN_UID },
    create: {
      binanceUid: env.SEED_ADMIN_UID,
      nickname: 'admin',
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: Role.ADMIN,
    },
    update: { role: Role.ADMIN, status: 'ACTIVE' },
  });

  const team = await prisma.team.upsert({
    where: { slug: 'demo' },
    create: { name: 'Demo Team', slug: 'demo', ownerId: admin.id },
    update: {},
  });

  const token = randomToken(24);
  await prisma.inviteToken.create({
    data: {
      tokenHash: sha256(token),
      label: 'seed: первый пользователь',
      role: Role.USER,
      teamId: team.id,
      maxUses: 5,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdById: admin.id,
    },
  });

  console.log('\n─────────────────────────────────────────────');
  console.log(' Администратор создан');
  console.log(`   UID:    ${env.SEED_ADMIN_UID}`);
  console.log(`   Пароль: ${env.SEED_ADMIN_PASSWORD}`);
  console.log(` Команда: ${team.name} (${team.slug})`);
  console.log('\n Токен доступа для активации расширения (5 использований):');
  console.log(`   ${token}`);
  console.log('─────────────────────────────────────────────\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
