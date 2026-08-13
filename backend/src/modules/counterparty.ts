import type { FastifyInstance } from 'fastify';
import { Prisma, type Counterparty, type OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { maskUid, maskRequisite, normalizeDigits } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { calculateRisk } from '../lib/risk.js';
import type { AuthContext } from '../plugins/auth.js';

/** Снимок публичной статистики с биржи — то, что расширение сумело вытащить. */
const statsSchema = z
  .object({
    registeredDays: z.number().int().nonnegative().nullish(),
    firstOrderDays: z.number().int().nonnegative().nullish(),
    completionRate: z.number().min(0).max(1).nullish(),
    totalOrders: z.number().int().nonnegative().nullish(),
    orders30d: z.number().int().nonnegative().nullish(),
    avgAmountFiat: z.number().nonnegative().nullish(),
    avgAmount30dFiat: z.number().nonnegative().nullish(),
    avgReleaseMinutes: z.number().nonnegative().nullish(),
    avgPayMinutes: z.number().nonnegative().nullish(),
    positiveCount: z.number().int().nonnegative().nullish(),
    negativeCount: z.number().int().nonnegative().nullish(),
    activeOrders: z.number().int().nonnegative().nullish(),
    merchantLevel: z.string().max(32).nullish(),
  })
  .partial();

export type ExchangeStatsSnapshot = z.infer<typeof statsSchema>;

const orderSnapshotSchema = z.object({
  externalId: z.string().trim().min(1).max(64),
  side: z.enum(['BUY', 'SELL']),
  status: z.enum(['PENDING', 'PAID', 'COMPLETED', 'CANCELLED', 'APPEALING', 'UNKNOWN']),
  asset: z.string().trim().max(16).optional(),
  fiat: z.string().trim().max(16).optional(),
  amountFiat: z.number().nonnegative().optional(),
  amountAsset: z.number().nonnegative().optional(),
  price: z.number().nonnegative().optional(),
  createdAtExchange: z.coerce.date().optional(),
});

const lookupSchema = z.object({
  exchange: z.enum(['BINANCE', 'BYBIT', 'HTX', 'OTHER']).default('BINANCE'),
  externalId: z.string().trim().min(1).max(64),
  nickname: z.string().trim().max(64).optional(),
  countryCode: z.string().trim().max(8).optional(),
  maskedPhone: z.string().trim().max(32).optional(),
  stats: statsSchema.optional(),
  order: orderSnapshotSchema.optional(),
});

const zeroCounts = { PENDING: 0, PAID: 0, COMPLETED: 0, CANCELLED: 0, APPEALING: 0, UNKNOWN: 0 };

type StatusCounts = Record<OrderStatus, number>;
type StatusRow = { status: OrderStatus; _count: { _all: number } };

function toCounts(rows: StatusRow[]): StatusCounts {
  const result: StatusCounts = { ...zeroCounts };
  for (const row of rows) result[row.status] = row._count._all;
  return result;
}

const summarize = (c: StatusCounts) => ({
  total: Object.values(c).reduce((a, b) => a + b, 0),
  completed: c.COMPLETED,
  cancelled: c.CANCELLED,
  active: c.PENDING + c.PAID + c.APPEALING,
});

/**
 * Собирает полное досье: ЧС, отзывы, заметку команды, статистику сделок,
 * реквизиты и риск-скор. Всё, что видит карточка расширения.
 */
export async function buildDossier(counterparty: Counterparty, auth: AuthContext) {
  const teamId = auth.teamId;

  const [
    blacklist,
    reviews,
    reviewCountRows,
    note,
    marketRows,
    teamRows,
    ownRows,
    recentOrders,
    reqLinks,
  ] = await Promise.all([
      prisma.blacklistEntry.findMany({
        where: {
          counterpartyId: counterparty.id,
          revokedAt: null,
          OR: [{ scope: 'GLOBAL' }, ...(teamId ? [{ scope: 'TEAM' as const, teamId }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { binanceUid: true, nickname: true } } },
      }),

      prisma.review.findMany({
        where: { counterpartyId: counterparty.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { author: { select: { id: true, binanceUid: true, teamId: true } } },
      }),

      // Счётчики считаем отдельно: список отзывов ограничен сотней,
      // и по нему нельзя судить об общем балансе позитива и негатива.
      prisma.review.groupBy({
        by: ['rating'],
        where: { counterpartyId: counterparty.id },
        _count: { _all: true },
      }),

      teamId
        ? prisma.teamNote.findUnique({
            where: { teamId_counterpartyId: { teamId, counterpartyId: counterparty.id } },
            include: { author: { select: { binanceUid: true, nickname: true } } },
          })
        : Promise.resolve(null),

      prisma.order.groupBy({
        by: ['status'],
        where: { counterpartyId: counterparty.id },
        _count: { _all: true },
      }),

      teamId
        ? prisma.order.groupBy({
            by: ['status'],
            where: { counterpartyId: counterparty.id, teamId },
            _count: { _all: true },
          })
        : Promise.resolve<StatusRow[]>([]),

      prisma.order.groupBy({
        by: ['status'],
        where: { counterpartyId: counterparty.id, userId: auth.user.id },
        _count: { _all: true },
      }),

      prisma.order.findMany({
        where: { counterpartyId: counterparty.id },
        orderBy: { createdAtExchange: 'desc' },
        take: 20,
        include: { user: { select: { binanceUid: true, nickname: true, teamId: true } } },
      }),

      prisma.counterpartyRequisite.findMany({
        where: { counterpartyId: counterparty.id },
        orderBy: { lastSeenAt: 'desc' },
        take: 30,
        include: { requisite: true },
      }),
    ]);

  // Реквизит считается «грязным», если он же засветился у другого контрагента,
  // который лежит в глобальном ЧС.
  const requisiteIds = reqLinks.map((l) => l.requisiteId);
  const flaggedLinks = requisiteIds.length
    ? await prisma.counterpartyRequisite.findMany({
        where: {
          requisiteId: { in: requisiteIds },
          counterpartyId: { not: counterparty.id },
          counterparty: { blacklistItems: { some: { revokedAt: null, scope: 'GLOBAL' } } },
        },
        include: { counterparty: { select: { externalId: true, nickname: true } } },
      })
    : [];

  const flaggedByRequisite = new Map<string, { externalId: string; nickname: string | null }[]>();
  for (const link of flaggedLinks) {
    const list = flaggedByRequisite.get(link.requisiteId) ?? [];
    list.push(link.counterparty);
    flaggedByRequisite.set(link.requisiteId, list);
  }

  const marketCounts = toCounts(marketRows);
  const teamCounts = toCounts(teamRows);
  const ownCounts = toCounts(ownRows);

  const countByRating = (rating: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE') =>
    reviewCountRows.find((r) => r.rating === rating)?._count._all ?? 0;

  const reviewCounts = {
    positive: countByRating('POSITIVE'),
    neutral: countByRating('NEUTRAL'),
    negative: countByRating('NEGATIVE'),
  };

  const stats = (counterparty.exchangeStats ?? {}) as ExchangeStatsSnapshot;

  const market = summarize(marketCounts);
  const team = summarize(teamCounts);
  const own = summarize(ownCounts);

  const risk = calculateRisk({
    globalBlacklist: blacklist.filter((b) => b.scope === 'GLOBAL').length,
    teamBlacklist: blacklist.filter((b) => b.scope === 'TEAM').length,
    blacklistedRequisites: flaggedByRequisite.size,
    reviews: reviewCounts,
    orders: { total: market.total, completed: market.completed, cancelled: market.cancelled },
    teamOrders: { total: team.total, completed: team.completed },
    exchange: {
      registeredDays: stats.registeredDays ?? null,
      completionRate: stats.completionRate ?? null,
      totalOrders: stats.totalOrders ?? null,
      avgReleaseMinutes: stats.avgReleaseMinutes ?? null,
      avgPayMinutes: stats.avgPayMinutes ?? null,
      avgAmountFiat: stats.avgAmountFiat ?? null,
    },
  });

  return {
    counterparty: {
      id: counterparty.id,
      exchange: counterparty.exchange,
      externalId: counterparty.externalId,
      nickname: counterparty.nickname,
      countryCode: counterparty.countryCode,
      maskedPhone: counterparty.maskedPhone,
      firstSeenAt: counterparty.firstSeenAt,
      lastSeenAt: counterparty.lastSeenAt,
    },
    risk,
    exchangeStats: stats,
    blacklist: blacklist.map((b) => ({
      id: b.id,
      scope: b.scope,
      reason: b.reason,
      severity: b.severity,
      source: b.source,
      createdAt: b.createdAt,
      author: b.createdBy ? maskUid(b.createdBy.binanceUid) : null,
      canRevoke: auth.isAdmin || (b.scope === 'TEAM' && b.teamId === teamId),
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt,
      // Личность автора не раскрываем — как в аналоге, показываем маску UID.
      author: `P2P Guard (UID ${maskUid(r.author.binanceUid)})`,
      isOwn: r.authorId === auth.user.id,
      isTeam: Boolean(teamId && r.author.teamId === teamId),
      canDelete: auth.isAdmin || r.authorId === auth.user.id,
    })),
    reviewCounts,
    teamNote: note
      ? {
          text: note.text,
          updatedAt: note.updatedAt,
          author: note.author ? maskUid(note.author.binanceUid) : null,
        }
      : null,
    orders: {
      market,
      team,
      own,
      byStatus: { market: marketCounts, team: teamCounts, own: ownCounts },
      recent: recentOrders.map((o) => ({
        id: o.id,
        externalId: `···${o.externalId.slice(-3)}`,
        side: o.side,
        status: o.status,
        asset: o.asset,
        fiat: o.fiat,
        amountFiat: o.amountFiat ? Number(o.amountFiat) : null,
        createdAt: o.createdAtExchange ?? o.createdAt,
        trader: maskUid(o.user.binanceUid),
        traderNickname: teamId && o.user.teamId === teamId ? o.user.nickname : null,
        isTeam: Boolean(teamId && o.user.teamId === teamId),
      })),
    },
    requisites: reqLinks.map((l) => ({
      id: l.requisiteId,
      type: l.requisite.type,
      mask: l.requisite.mask,
      timesSeen: l.timesSeen,
      lastSeenAt: l.lastSeenAt,
      blacklisted: flaggedByRequisite.has(l.requisiteId),
      alsoUsedBy: (flaggedByRequisite.get(l.requisiteId) ?? []).map(
        (c) => c.nickname ?? maskUid(c.externalId),
      ),
    })),
  };
}

export type Dossier = Awaited<ReturnType<typeof buildDossier>>;

/** Upsert контрагента + мягкое обновление снимка биржевой статистики. */
export async function upsertCounterparty(input: z.infer<typeof lookupSchema>) {
  const now = new Date();
  const base = {
    nickname: input.nickname ?? undefined,
    countryCode: input.countryCode ?? undefined,
    maskedPhone: input.maskedPhone ?? undefined,
    lastSeenAt: now,
    ...(input.stats
      ? { exchangeStats: input.stats as Prisma.InputJsonValue, statsUpdatedAt: now }
      : {}),
  };

  return prisma.counterparty.upsert({
    where: {
      exchange_externalId: { exchange: input.exchange, externalId: input.externalId },
    },
    create: {
      exchange: input.exchange,
      externalId: input.externalId,
      ...base,
    },
    update: base,
  });
}

export async function counterpartyRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };

  /** Главный вызов расширения при открытии ордера. */
  app.post('/counterparties/lookup', auth, async (req) => {
    const body = lookupSchema.parse(req.body);
    const ctx = req.auth!;

    const counterparty = await upsertCounterparty(body);

    if (body.order) {
      const o = body.order;
      const existing = await prisma.order.findUnique({
        where: { exchange_externalId: { exchange: body.exchange, externalId: o.externalId } },
        select: { id: true, userId: true },
      });

      if (!existing) {
        await prisma.order.create({
          data: {
            exchange: body.exchange,
            externalId: o.externalId,
            userId: ctx.user.id,
            teamId: ctx.teamId,
            counterpartyId: counterparty.id,
            side: o.side,
            status: o.status,
            asset: o.asset ?? null,
            fiat: o.fiat ?? null,
            amountFiat: o.amountFiat ?? null,
            amountAsset: o.amountAsset ?? null,
            price: o.price ?? null,
            createdAtExchange: o.createdAtExchange ?? null,
            completedAt: o.status === 'COMPLETED' ? new Date() : null,
          },
        });
      } else if (existing.userId === ctx.user.id) {
        // Чужую запись не трогаем: владелец ордера — тот, кто его создал.
        // Иначе ордер «переезжал» бы в команду случайного зрителя.
        await prisma.order.update({
          where: { id: existing.id },
          data: {
            status: o.status,
            teamId: ctx.teamId,
            counterpartyId: counterparty.id,
            completedAt: o.status === 'COMPLETED' ? new Date() : null,
          },
        });
      }
    }

    return buildDossier(counterparty, ctx);
  });

  app.get('/counterparties/:id/dossier', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const counterparty = await prisma.counterparty.findUnique({ where: { id } });
    if (!counterparty) throw notFound('Контрагент не найден');
    return buildDossier(counterparty, req.auth!);
  });

  /** Поиск по нику / UID / реквизиту — для ручной проверки из попапа. */
  app.get('/counterparties/search', auth, async (req) => {
    const { q, limit } = z
      .object({ q: z.string().trim().min(2).max(64), limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(req.query);

    const digits = normalizeDigits(q);

    const byRequisite = digits.length >= 6
      ? await prisma.counterpartyRequisite.findMany({
          where: { requisite: { value: { contains: digits } } },
          select: { counterpartyId: true },
          take: limit,
        })
      : [];

    const items = await prisma.counterparty.findMany({
      where: {
        OR: [
          { externalId: { contains: q } },
          { nickname: { contains: q, mode: 'insensitive' } },
          ...(byRequisite.length
            ? [{ id: { in: byRequisite.map((r) => r.counterpartyId) } }]
            : []),
        ],
      },
      take: limit,
      orderBy: { lastSeenAt: 'desc' },
      include: {
        _count: { select: { reviews: true, orders: true } },
        blacklistItems: { where: { revokedAt: null }, select: { scope: true } },
      },
    });

    return {
      items: items.map((c) => ({
        id: c.id,
        externalId: c.externalId,
        nickname: c.nickname,
        countryCode: c.countryCode,
        lastSeenAt: c.lastSeenAt,
        reviews: c._count.reviews,
        orders: c._count.orders,
        blacklisted: c.blacklistItems.length > 0,
      })),
    };
  });

  /** Реквизиты, замеченные в чате ордера. */
  app.post('/requisites/observe', auth, async (req) => {
    const body = z
      .object({
        counterpartyId: z.string().min(1),
        items: z
          .array(
            z.object({
              type: z.enum(['CARD', 'PHONE', 'ACCOUNT', 'WALLET']),
              value: z.string().min(4).max(64),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(req.body);

    const counterparty = await prisma.counterparty.findUnique({
      where: { id: body.counterpartyId },
      select: { id: true },
    });
    if (!counterparty) throw notFound('Контрагент не найден');

    const now = new Date();
    let saved = 0;

    for (const item of body.items) {
      const value = normalizeDigits(item.value);
      if (value.length < 6) continue;

      const requisite = await prisma.requisite.upsert({
        where: { type_value: { type: item.type, value } },
        create: { type: item.type, value, mask: maskRequisite(value) },
        update: { lastSeenAt: now },
      });

      await prisma.counterpartyRequisite.upsert({
        where: {
          counterpartyId_requisiteId: {
            counterpartyId: counterparty.id,
            requisiteId: requisite.id,
          },
        },
        create: { counterpartyId: counterparty.id, requisiteId: requisite.id },
        update: { timesSeen: { increment: 1 }, lastSeenAt: now },
      });

      saved += 1;
    }

    return { ok: true, saved };
  });
}
