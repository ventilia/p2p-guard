import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { auditFromRequest } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

const createSchema = z.object({
  counterpartyId: z.string().min(1),
  // в GLOBAL пишет только админ, это общая база на всех
  scope: z.enum(['GLOBAL', 'TEAM']).default('TEAM'),
  reason: z.string().trim().min(3, 'Опишите причину').max(1000),
  severity: z.number().int().min(1).max(3).default(2),
});

export async function blacklistRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };

  app.post('/blacklist', auth, async (req) => {
    const body = createSchema.parse(req.body);
    const ctx = req.auth!;

    if (body.scope === 'GLOBAL' && !ctx.isAdmin) {
      throw forbidden('В общий чёрный список добавляет только администратор', 'GLOBAL_BL_FORBIDDEN');
    }
    if (body.scope === 'TEAM' && !ctx.teamId) {
      throw badRequest('Вы не состоите в команде — доступен только общий список');
    }

    const counterparty = await prisma.counterparty.findUnique({
      where: { id: body.counterpartyId },
      select: { id: true },
    });
    if (!counterparty) throw notFound('Контрагент не найден');

    // повторное добавление не плодит дубли, обновляем действующую запись
    const existing = await prisma.blacklistEntry.findFirst({
      where: {
        counterpartyId: counterparty.id,
        scope: body.scope,
        teamId: body.scope === 'TEAM' ? ctx.teamId : null,
        revokedAt: null,
      },
    });

    const entry = existing
      ? await prisma.blacklistEntry.update({
          where: { id: existing.id },
          data: { reason: body.reason, severity: body.severity },
        })
      : await prisma.blacklistEntry.create({
          data: {
            counterpartyId: counterparty.id,
            scope: body.scope,
            teamId: body.scope === 'TEAM' ? ctx.teamId : null,
            reason: body.reason,
            severity: body.severity,
            source: 'manual',
            createdById: ctx.user.id,
          },
        });

    await auditFromRequest(req, {
      action: 'blacklist.add',
      targetType: 'counterparty',
      targetId: counterparty.id,
      meta: { scope: body.scope, severity: body.severity },
    });

    return { id: entry.id, scope: entry.scope, createdAt: entry.createdAt };
  });

  app.delete('/blacklist/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const ctx = req.auth!;

    const entry = await prisma.blacklistEntry.findUnique({ where: { id } });
    if (!entry || entry.revokedAt) throw notFound('Запись не найдена');

    const canRevoke =
      ctx.isAdmin || (entry.scope === 'TEAM' && entry.teamId !== null && entry.teamId === ctx.teamId);
    if (!canRevoke) throw forbidden('Нельзя снять чужую запись чёрного списка');

    await prisma.blacklistEntry.update({ where: { id }, data: { revokedAt: new Date() } });
    await auditFromRequest(req, {
      action: 'blacklist.revoke',
      targetType: 'blacklist',
      targetId: id,
      meta: { counterpartyId: entry.counterpartyId, scope: entry.scope },
    });

    return { ok: true };
  });

  // лента: общий ЧС плюс свой командный
  app.get('/blacklist', auth, async (req) => {
    const { limit, offset } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const ctx = req.auth!;

    const where = {
      revokedAt: null,
      OR: [
        { scope: 'GLOBAL' as const },
        ...(ctx.teamId ? [{ scope: 'TEAM' as const, teamId: ctx.teamId }] : []),
      ],
    };

    const [items, total] = await Promise.all([
      prisma.blacklistEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          counterparty: { select: { id: true, externalId: true, nickname: true, countryCode: true } },
        },
      }),
      prisma.blacklistEntry.count({ where }),
    ]);

    return { items, total, limit, offset };
  });
}
