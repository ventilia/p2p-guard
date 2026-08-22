import Fastify, { type FastifyInstance } from 'fastify';
import { prisma } from './db.js';
import { env } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { registerErrorHandler, registerSecurity } from './plugins/security.js';
import { adminRoutes } from './modules/admin.js';
import { authRoutes } from './modules/auth.js';
import { blacklistRoutes } from './modules/blacklist.js';
import { counterpartyRoutes } from './modules/counterparty.js';
import { orderRoutes } from './modules/orders.js';
import { reviewRoutes } from './modules/reviews.js';
import { teamRoutes } from './modules/teams.js';
import { templateRoutes } from './modules/templates.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.isProd
      ? { level: 'info' }
      : {
          level: 'info',
          transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
        },
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  registerErrorHandler(app);
  await registerSecurity(app);
  await registerAuth(app);

  // без запроса в базу проверка врала бы: сервер отвечает и с погашенной БД
  app.get('/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: true, ts: new Date().toISOString() };
    } catch {
      return reply.status(503).send({ ok: false, db: false, ts: new Date().toISOString() });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(counterpartyRoutes);
      await api.register(reviewRoutes);
      await api.register(blacklistRoutes);
      await api.register(teamRoutes);
      await api.register(orderRoutes);
      await api.register(templateRoutes);
      await api.register(adminRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}
