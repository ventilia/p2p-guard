import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';

const itemSchema = z.object({
  externalId: z.string().trim().min(1).max(64),
  side: z.enum(['BUY', 'SELL']),
  status: z.enum(['PENDING', 'PAID', 'COMPLETED', 'CANCELLED', 'APPEALING', 'UNKNOWN']),
  counterparty: z
    .object({
      externalId: z.string().trim().min(1).max(64),
      nickname: z.string().trim().max(64).optional(),
      countryCode: z.string().trim().max(8).optional(),
    })
    .optional(),
  asset: z.string().trim().max(16).optional(),
  fiat: z.string().trim().max(16).optional(),
  amountFiat: z.number().nonnegative().optional(),
  amountAsset: z.number().nonnegative().optional(),
  price: z.number().nonnegative().optional(),
  createdAtExchange: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
});

const syncSchema = z.object({
  exchange: z.enum(['BINANCE', 'BYBIT', 'HTX', 'OTHER']).default('BINANCE'),
  items: z.array(itemSchema).min(1).max(200),
});

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };

  // пакетная выгрузка из расширения, идемпотентна по (exchange, externalId)
  app.post('/orders/sync', auth, async (req) => {
    const body = syncSchema.parse(req.body);
    const ctx = req.auth!;
    const now = new Date();

    // контрагенты — по разу на уникальный UID, а не на каждый ордер
    const uniqueCounterparties = new Map<string, NonNullable<(typeof body.items)[number]['counterparty']>>();
    for (const item of body.items) {
      if (item.counterparty) uniqueCounterparties.set(item.counterparty.externalId, item.counterparty);
    }

    const counterpartyIdByExternalId = new Map<string, string>();
    for (const cp of uniqueCounterparties.values()) {
      const saved = await prisma.counterparty.upsert({
        where: { exchange_externalId: { exchange: body.exchange, externalId: cp.externalId } },
        create: {
          exchange: body.exchange,
          externalId: cp.externalId,
          nickname: cp.nickname ?? null,
          countryCode: cp.countryCode ?? null,
        },
        update: {
          nickname: cp.nickname ?? undefined,
          countryCode: cp.countryCode ?? undefined,
          lastSeenAt: now,
        },
        select: { id: true },
      });
      counterpartyIdByExternalId.set(cp.externalId, saved.id);
    }

    // одним запросом узнаём, какие ордера уже есть и чьи они
    const existing = await prisma.order.findMany({
      where: {
        exchange: body.exchange,
        externalId: { in: body.items.map((i) => i.externalId) },
      },
      select: { id: true, externalId: true, userId: true, status: true },
    });
    const existingByExternalId = new Map(existing.map((o) => [o.externalId, o]));

    const toCreate: Prisma.OrderCreateManyInput[] = [];
    const toUpdate: { id: string; data: Prisma.OrderUpdateInput }[] = [];
    let skipped = 0;

    for (const item of body.items) {
      const counterpartyId = item.counterparty
        ? (counterpartyIdByExternalId.get(item.counterparty.externalId) ?? null)
        : null;
      const found = existingByExternalId.get(item.externalId);

      if (!found) {
        toCreate.push({
          exchange: body.exchange,
          externalId: item.externalId,
          userId: ctx.user.id,
          teamId: ctx.teamId,
          counterpartyId,
          side: item.side,
          status: item.status,
          asset: item.asset ?? null,
          fiat: item.fiat ?? null,
          amountFiat: item.amountFiat ?? null,
          amountAsset: item.amountAsset ?? null,
          price: item.price ?? null,
          createdAtExchange: item.createdAtExchange ?? null,
          completedAt: item.completedAt ?? null,
        });
        continue;
      }

      // чужие ордера не трогаем
      if (found.userId !== ctx.user.id) {
        skipped += 1;
        continue;
      }

      toUpdate.push({
        id: found.id,
        data: {
          status: item.status,
          team: ctx.teamId ? { connect: { id: ctx.teamId } } : { disconnect: true },
          ...(counterpartyId ? { counterparty: { connect: { id: counterpartyId } } } : {}),
          amountFiat: item.amountFiat ?? undefined,
          amountAsset: item.amountAsset ?? undefined,
          price: item.price ?? undefined,
          completedAt:
            item.completedAt ?? (item.status === 'COMPLETED' ? now : undefined),
        },
      });
    }

    // массовая вставка и точечные обновления в одной транзакции
    const [createResult] = await prisma.$transaction([
      prisma.order.createMany({ data: toCreate, skipDuplicates: true }),
      ...toUpdate.map((u) => prisma.order.update({ where: { id: u.id }, data: u.data })),
    ]);

    return {
      ok: true,
      created: createResult.count,
      updated: toUpdate.length,
      skipped,
    };
  });

  // мои последние ордера для попапа
  app.get('/orders/mine', auth, async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
      .parse(req.query);

    const items = await prisma.order.findMany({
      where: { userId: req.auth!.user.id },
      orderBy: { createdAtExchange: 'desc' },
      take: limit,
      include: { counterparty: { select: { id: true, externalId: true, nickname: true } } },
    });

    return {
      items: items.map((o) => ({
        id: o.id,
        externalId: o.externalId,
        side: o.side,
        status: o.status,
        fiat: o.fiat,
        amountFiat: o.amountFiat ? Number(o.amountFiat) : null,
        createdAt: o.createdAtExchange ?? o.createdAt,
        counterparty: o.counterparty,
      })),
    };
  });
}
