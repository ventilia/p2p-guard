import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { auditFromRequest } from '../lib/audit.js';
import { forbidden, notFound } from '../lib/errors.js';

const createSchema = z.object({
  counterpartyId: z.string().min(1),
  rating: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']),
  text: z.string().trim().min(3, 'Слишком короткий отзыв').max(2000),
  orderRef: z.string().trim().max(64).optional(),
});

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };

  /** Один отзыв на пару (автор, контрагент): повторный вызов правит существующий. */
  app.post('/reviews', auth, async (req) => {
    const body = createSchema.parse(req.body);
    const ctx = req.auth!;

    const counterparty = await prisma.counterparty.findUnique({
      where: { id: body.counterpartyId },
      select: { id: true },
    });
    if (!counterparty) throw notFound('Контрагент не найден');

    const review = await prisma.review.upsert({
      where: {
        counterpartyId_authorId: {
          counterpartyId: counterparty.id,
          authorId: ctx.user.id,
        },
      },
      create: {
        counterpartyId: counterparty.id,
        authorId: ctx.user.id,
        teamId: ctx.teamId,
        rating: body.rating,
        text: body.text,
        orderRef: body.orderRef ?? null,
      },
      update: {
        rating: body.rating,
        text: body.text,
        orderRef: body.orderRef ?? null,
        teamId: ctx.teamId,
      },
    });

    await auditFromRequest(req, {
      action: 'review.upsert',
      targetType: 'counterparty',
      targetId: counterparty.id,
      meta: { rating: body.rating },
    });

    return { id: review.id, createdAt: review.createdAt, updatedAt: review.updatedAt };
  });

  app.delete('/reviews/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const ctx = req.auth!;

    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) throw notFound('Отзыв не найден');
    if (review.authorId !== ctx.user.id && !ctx.isAdmin) {
      throw forbidden('Можно удалять только свой отзыв');
    }

    await prisma.review.delete({ where: { id } });
    await auditFromRequest(req, {
      action: 'review.delete',
      targetType: 'review',
      targetId: id,
      meta: { counterpartyId: review.counterpartyId },
    });

    return { ok: true };
  });

  /** Мои отзывы — для попапа. */
  app.get('/reviews/mine', auth, async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
      .parse(req.query);

    const items = await prisma.review.findMany({
      where: { authorId: req.auth!.user.id },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      include: { counterparty: { select: { id: true, externalId: true, nickname: true } } },
    });

    return { items };
  });
}
