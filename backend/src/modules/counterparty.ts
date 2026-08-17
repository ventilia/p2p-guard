import type { FastifyInstance } from 'fastify';
import { Prisma, type Counterparty, type OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { maskUid, maskRequisite, normalizeDigits } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { calculateRisk, type ReviewTag } from '../lib/risk.js';
import type { AuthContext } from '../plugins/auth.js';

// снимок публичной статистики биржи — всё, что расширение сумело вытащить
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
    positiveRate: z.number().min(0).max(1).nullish(),
    positiveCount: z.number().int().nonnegative().nullish(),
    negativeCount: z.number().int().nonnegative().nullish(),
    activeOrders: z.number().int().nonnegative().nullish(),
    merchantLevel: z.string().max(32).nullish(),
    // то же, что биржа показывает в карточке контрагента
    completionRate30d: z.number().min(0).max(1).nullish(),
    joinedAt: z.string().max(40).nullish(),
    emailVerified: z.boolean().nullish(),
    phoneVerified: z.boolean().nullish(),
    kycVerified: z.boolean().nullish(),
    feedbackCount: z.number().int().nonnegative().nullish(),
    followers: z.number().int().nonnegative().nullish(),
    blockedBy: z.number().int().nonnegative().nullish(),
  })
  .partial();

export type ExchangeStatsSnapshot = z.infer<typeof statsSchema>;

// отзывы самой биржи: храним рядом со статистикой, отдельной таблицы не заводим
const exchangeReviewSchema = z.object({
  rating: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']),
  text: z.string().max(2000).nullish(),
  author: z.string().max(64).nullish(),
  createdAt: z.string().max(40).nullish(),
});

export type ExchangeReviewSnapshot = z.infer<typeof exchangeReviewSchema>;

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
  exchangeReviews: z.array(exchangeReviewSchema).max(50).optional(),
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

// всё, что видит карточка: ЧС, отзывы, заметка команды, сделки, реквизиты, риск
export async function buildDossier(
  counterparty: Counterparty,
  auth: AuthContext,
  // сумма открытого ордера, риск-скор сравнивает её со средним чеком
  currentOrderFiat?: number | null,
) {
  const teamId = auth.teamId;

  const [
    blacklist,
    reviews,
    reviewCountRows,
    reviewTagRows,
    note,
    marketRows,
    teamRows,
    ownRows,
    recentOrders,
    reqLinks,
    ownVolume,
    ownVolume30d,
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

      // список отзывов ограничен сотней, по нему нельзя судить о балансе
      prisma.review.groupBy({
        by: ['rating'],
        where: { counterpartyId: counterparty.id },
        _count: { _all: true },
      }),

      // категории жалоб весят в риск-скоре отдельно, поэтому считаем по всей базе
      prisma.review.groupBy({
        by: ['tag'],
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

      // средний чек по нашей базе: подстраховка, когда биржа статистику не отдала
      prisma.order.aggregate({
        where: { counterpartyId: counterparty.id, status: 'COMPLETED' },
        _avg: { amountFiat: true },
        _count: { _all: true },
      }),

      prisma.order.aggregate({
        where: {
          counterpartyId: counterparty.id,
          status: 'COMPLETED',
          createdAtExchange: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
        _avg: { amountFiat: true },
        _count: { _all: true },
      }),
    ]);

  // реквизит «грязный», если засветился у другого контрагента из глобального ЧС
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

  const tagCounts = Object.fromEntries(
    reviewTagRows.map((r) => [r.tag, r._count._all]),
  ) as Partial<Record<ReviewTag, number>>;

  const stored = (counterparty.exchangeStats ?? {}) as ExchangeStatsSnapshot;

  // биржа отдаёт статистику не всегда, поэтому недостающее считаем по своей базе
  // и помечаем источник, чтобы карточка не выдавала наши цифры за биржевые
  const fallbackAvg = ownVolume._avg.amountFiat ? Math.round(Number(ownVolume._avg.amountFiat)) : null;
  const fallbackAvg30d = ownVolume30d._avg.amountFiat
    ? Math.round(Number(ownVolume30d._avg.amountFiat))
    : null;

  const stats: ExchangeStatsSnapshot = {
    ...stored,
    avgAmountFiat: stored.avgAmountFiat ?? fallbackAvg,
    avgAmount30dFiat: stored.avgAmount30dFiat ?? fallbackAvg30d,
  };

  const statsSource = {
    avgAmountFiat: stored.avgAmountFiat != null ? 'exchange' : fallbackAvg != null ? 'local' : 'none',
    avgAmount30dFiat:
      stored.avgAmount30dFiat != null ? 'exchange' : fallbackAvg30d != null ? 'local' : 'none',
    // всё остальное приходит только с биржи
    exchange: Object.keys(stored).length > 0,
  } as const;

  const market = summarize(marketCounts);
  const team = summarize(teamCounts);
  const own = summarize(ownCounts);

  const risk = calculateRisk({
    globalBlacklist: blacklist.filter((b) => b.scope === 'GLOBAL').length,
    teamBlacklist: blacklist.filter((b) => b.scope === 'TEAM').length,
    blacklistedRequisites: flaggedByRequisite.size,
    reviews: reviewCounts,
    reviewTags: tagCounts,
    orders: { total: market.total, completed: market.completed, cancelled: market.cancelled },
    teamOrders: { total: team.total, completed: team.completed },
    currentOrderFiat: currentOrderFiat ?? null,
    exchange: {
      registeredDays: stats.registeredDays ?? null,
      firstOrderDays: stats.firstOrderDays ?? null,
      completionRate: stats.completionRate ?? null,
      totalOrders: stats.totalOrders ?? null,
      orders30d: stats.orders30d ?? null,
      avgReleaseMinutes: stats.avgReleaseMinutes ?? null,
      avgPayMinutes: stats.avgPayMinutes ?? null,
      avgAmountFiat: stats.avgAmountFiat ?? null,
      avgAmount30dFiat: stats.avgAmount30dFiat ?? null,
      positiveCount: stats.positiveCount ?? null,
      negativeCount: stats.negativeCount ?? null,
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
    exchangeReviews: (counterparty.exchangeReviews ?? []) as ExchangeReviewSnapshot[],
    statsSource,
    statsUpdatedAt: counterparty.statsUpdatedAt,
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
      tag: r.tag,
      text: r.text,
      createdAt: r.createdAt,
      // личность автора не раскрываем
      author: `P2P Guard (UID ${maskUid(r.author.binanceUid)})`,
      isOwn: r.authorId === auth.user.id,
      isTeam: Boolean(teamId && r.author.teamId === teamId),
      canDelete: auth.isAdmin || r.authorId === auth.user.id,
    })),
    reviewCounts,
    tagCounts,
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

/**
 * Слияние снимков статистики.
 *
 * Заменять снимок целиком нельзя: расширение присылает то, что смогло достать
 * на этот раз, и после перезагрузки страницы перехват может не сработать. Тогда
 * полный профиль затирался бы огрызком, данные пропадали, а риск-скор
 * пересчитывался по обеднённым цифрам.
 */
function mergeStats(
  previous: ExchangeStatsSnapshot | null,
  incoming: ExchangeStatsSnapshot | undefined,
): { changed: boolean; value: ExchangeStatsSnapshot } {
  const base: ExchangeStatsSnapshot = { ...(previous ?? {}) };
  if (!incoming) return { changed: false, value: base };

  let changed = false;
  for (const [key, value] of Object.entries(incoming)) {
    // null и undefined означают «не смогли узнать», а не «стало пусто»
    if (value === null || value === undefined) continue;
    if (base[key as keyof ExchangeStatsSnapshot] === value) continue;
    (base as Record<string, unknown>)[key] = value;
    changed = true;
  }
  return { changed, value: base };
}

export async function upsertCounterparty(input: z.infer<typeof lookupSchema>) {
  const now = new Date();

  const existing = await prisma.counterparty.findUnique({
    where: { exchange_externalId: { exchange: input.exchange, externalId: input.externalId } },
    select: { exchangeStats: true },
  });

  const stats = mergeStats(
    (existing?.exchangeStats ?? null) as ExchangeStatsSnapshot | null,
    input.stats,
  );

  const base = {
    nickname: input.nickname ?? undefined,
    countryCode: input.countryCode ?? undefined,
    maskedPhone: input.maskedPhone ?? undefined,
    lastSeenAt: now,
    // время обновления двигаем только когда что-то реально узнали новое
    ...(stats.changed
      ? { exchangeStats: stats.value as Prisma.InputJsonValue, statsUpdatedAt: now }
      : {}),
    // пустой список — «не смогли прочитать», прошлые отзывы не стираем
    ...(input.exchangeReviews?.length
      ? { exchangeReviews: input.exchangeReviews as unknown as Prisma.InputJsonValue }
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
      ...(input.stats ? { exchangeStats: stats.value as Prisma.InputJsonValue, statsUpdatedAt: now } : {}),
    },
    update: base,
  });
}

export async function counterpartyRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };

  // главный вызов расширения при открытии ордера
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
        // чужую запись не трогаем, иначе ордер переедет к случайному зрителю
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

    return buildDossier(counterparty, ctx, body.order?.amountFiat ?? null);
  });

  app.get('/counterparties/:id/dossier', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    // сумму открытого ордера принимаем и здесь: без неё фактор сравнения с
    // средним чеком пропадал при каждом обновлении, и балл менялся сам собой
    const { orderFiat } = z
      .object({ orderFiat: z.coerce.number().nonnegative().optional() })
      .parse(req.query);

    const counterparty = await prisma.counterparty.findUnique({ where: { id } });
    if (!counterparty) throw notFound('Контрагент не найден');
    return buildDossier(counterparty, req.auth!, orderFiat ?? null);
  });

  // поиск по нику, UID или реквизиту для ручной проверки из попапа
  app.get('/counterparties/search', auth, async (req) => {
    const { q, limit } = z
      .object({ q: z.string().trim().min(2).max(64), limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(req.query);

    const digits = normalizeDigits(q);

    // порядок обязателен: без него срез отдавал случайные связки, и свежий
    // владелец карты мог не попасть в выборку, хотя искали именно его.
    // берём с запасом — у одного контрагента бывает несколько реквизитов
    const byRequisite = digits.length >= 6
      ? await prisma.counterpartyRequisite.findMany({
          where: { requisite: { value: { contains: digits } } },
          select: { counterpartyId: true },
          orderBy: { lastSeenAt: 'desc' },
          take: limit * 5,
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

  // реквизиты, замеченные в чате ордера
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
