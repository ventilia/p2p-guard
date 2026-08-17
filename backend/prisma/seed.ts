// идемпотентно: админ панели и токен доступа для трейдера
// это разные учётки — binanceUid админа синтетический, с биржей не связан
import { PrismaClient, Role } from '@prisma/client';
import { env } from '../src/env.js';
import { hashPassword, randomToken, sha256 } from '../src/lib/crypto.js';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.upsert({
    where: { binanceUid: env.SEED_ADMIN_UID },
    create: {
      binanceUid: env.SEED_ADMIN_UID,
      nickname: 'Администратор',
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: Role.ADMIN,
    },
    update: { role: Role.ADMIN, status: 'ACTIVE' },
  });

  // без привязки к команде: трейдер сам решит, вступить или создать свою
  const token = randomToken(24);
  await prisma.inviteToken.create({
    data: {
      tokenHash: sha256(token),
      label: 'seed: первый трейдер',
      role: Role.USER,
      maxUses: 5,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdById: admin.id,
    },
  });

  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log(' АДМИНИСТРАТОР — только для админ-панели http://127.0.0.1:5174');
  console.log(`   UID:    ${env.SEED_ADMIN_UID}   (синтетический, не аккаунт биржи)`);
  console.log(`   Пароль: ${env.SEED_ADMIN_PASSWORD}`);
  console.log('\n ТОКЕН ДОСТУПА — для активации расширения, 5 использований:');
  console.log(`   ${token}`);
  console.log('\n   Вставьте его в попапе расширения на вкладке «Активация».');
  console.log('   Учётка трейдера создастся с ВАШИМ настоящим UID Binance.');
  console.log('   В расширение под админом не входите — это разные роли.');
  console.log(`${line}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
