import type { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { auditFromRequest } from '../lib/audit.js';
import { hashPassword, randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const admin = { preHandler: [app.authenticate, app.requireRole(Role.ADMIN)] };

  // ─────────────────────────── Сводка ───────────────────────────

  app.get('/admin/overview', admin, async () => {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [users, blocked, teams, counterparties, reviews, blacklist, orders, volume, active30d] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'BLOCKED' } }),
        prisma.team.count(),
        prisma.counterparty.count(),
        prisma.review.count(),
        prisma.blacklistEntry.count({ where: { revokedAt: null } }),
        prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { amountFiat: true } }),
        prisma.user.count({ where: { lastSeenAt: { gte: since30d } } }),
      ]);

    return {
      users,
      blocked,
      activeUsers30d: active30d,
      teams,
      counterparties,
      reviews,
      blacklist,
      orders: Object.fromEntries(orders.map((o) => [o.status, o._count._all])),
      volumeFiat: Number(volume._sum.amountFiat ?? 0),
    };
  });

  // ─────────────────────────── Пользователи ───────────────────────────

  app.get('/admin/users', admin, async (req) => {
    const query = paging
      .extend({
        q: z.string().trim().max(64).optional(),
        status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
        teamId: z.string().optional(),
        role: z.enum(['USER', 'TEAM_LEAD', 'ADMIN']).optional(),
      })
      .parse(req.query);

    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.q
        ? {
            OR: [
              { binanceUid: { contains: query.q } },
              { nickname: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.offset,
        take: query.limit,
        include: {
          team: { select: { id: true, name: true } },
          _count: { select: { orders: true, reviews: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Объём считаем одним запросом на страницу, а не по пользователю в цикле.
    const volumes = await prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: items.map((u) => u.id) }, status: 'COMPLETED' },
      _sum: { amountFiat: true },
      _count: { _all: true },
    });
    const volumeByUser = new Map(
      volumes.map((v) => [v.userId, { volume: Number(v._sum.amountFiat ?? 0), completed: v._count._all }]),
    );

    return {
      items: items.map((u) => ({
        id: u.id,
        binanceUid: u.binanceUid,
        nickname: u.nickname,
        role: u.role,
        status: u.status,
        blockReason: u.blockReason,
        team: u.team,
        subscription: {
          plan: u.subscriptionPlan,
          status: u.subscriptionStatus,
          until: u.subscriptionUntil,
        },
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        orders: u._count.orders,
        reviews: u._count.reviews,
        completedOrders: volumeByUser.get(u.id)?.completed ?? 0,
        volumeFiat: volumeByUser.get(u.id)?.volume ?? 0,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  });

  /** Карточка пользователя: объём, статусы сделок и с кем он торговал. */
  app.get('/admin/users/:id', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);

    const user = await prisma.user.findUnique({
      where: { id },
      include: { team: { select: { id: true, name: true, slug: true } } },
    });
    if (!user) throw notFound('Пользователь не найден');

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byStatus, volumeAll, volume30d, partners, recent, sessions] = await Promise.all([
      prisma.order.groupBy({
        by: ['status'],
        where: { userId: id },
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: { userId: id, status: 'COMPLETED' },
        _sum: { amountFiat: true },
        _avg: { amountFiat: true },
      }),
      prisma.order.aggregate({
        where: { userId: id, status: 'COMPLETED', createdAtExchange: { gte: since30d } },
        _sum: { amountFiat: true },
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ['counterpartyId'],
        where: { userId: id, counterpartyId: { not: null } },
        _count: { _all: true },
        _sum: { amountFiat: true },
        orderBy: { _count: { counterpartyId: 'desc' } },
        take: 15,
      }),
      prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAtExchange: 'desc' },
        take: 25,
        include: { counterparty: { select: { id: true, externalId: true, nickname: true } } },
      }),
      prisma.refreshToken.count({ where: { userId: id, revokedAt: null } }),
    ]);

    const partnerIds = partners.map((p) => p.counterpartyId).filter((v): v is string => v !== null);
    const partnerInfo = await prisma.counterparty.findMany({
      where: { id: { in: partnerIds } },
      select: {
        id: true,
        externalId: true,
        nickname: true,
        countryCode: true,
        blacklistItems: { where: { revokedAt: null }, select: { scope: true } },
      },
    });
    const partnerById = new Map(partnerInfo.map((p) => [p.id, p]));

    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));

    return {
      user: {
        id: user.id,
        binanceUid: user.binanceUid,
        nickname: user.nickname,
        role: user.role,
        status: user.status,
        blockReason: user.blockReason,
        team: user.team,
        subscription: {
          plan: user.subscriptionPlan,
          status: user.subscriptionStatus,
          until: user.subscriptionUntil,
        },
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
        activeSessions: sessions,
      },
      stats: {
        ordersByStatus: counts,
        totalOrders: byStatus.reduce((sum, s) => sum + s._count._all, 0),
        completed: counts.COMPLETED ?? 0,
        cancelled: counts.CANCELLED ?? 0,
        volumeFiat: Number(volumeAll._sum.amountFiat ?? 0),
        avgTicketFiat: Number(volumeAll._avg.amountFiat ?? 0),
        volume30dFiat: Number(volume30d._sum.amountFiat ?? 0),
        completed30d: volume30d._count._all,
      },
      partners: partners.map((p) => {
        const info = p.counterpartyId ? partnerById.get(p.counterpartyId) : undefined;
        return {
          counterpartyId: p.counterpartyId,
          externalId: info?.externalId ?? null,
          nickname: info?.nickname ?? null,
          countryCode: info?.countryCode ?? null,
          blacklisted: (info?.blacklistItems.length ?? 0) > 0,
          orders: p._count._all,
          volumeFiat: Number(p._sum.amountFiat ?? 0),
        };
      }),
      recentOrders: recent.map((o) => ({
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

  app.post('/admin/users/:id/block', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);

    if (id === req.auth!.user.id) throw badRequest('Нельзя заблокировать самого себя');

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('Пользователь не найден');

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { status: 'BLOCKED', blockReason: body.reason },
      }),
      // Блокировка должна действовать сразу — гасим все сессии.
      prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await auditFromRequest(req, {
      action: 'admin.user_blocked',
      targetType: 'user',
      targetId: id,
      meta: { reason: body.reason },
    });

    return { ok: true };
  });

  app.post('/admin/users/:id/unblock', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    await prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE', blockReason: null },
    });
    await auditFromRequest(req, {
      action: 'admin.user_unblocked',
      targetType: 'user',
      targetId: id,
    });
    return { ok: true };
  });

  app.patch('/admin/users/:id', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        role: z.enum(['USER', 'TEAM_LEAD', 'ADMIN']).optional(),
        teamId: z.string().nullable().optional(),
        nickname: z.string().trim().max(64).nullable().optional(),
        password: z.string().min(8).max(128).optional(),
      })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('Пользователь не найден');

    if (body.teamId) {
      const team = await prisma.team.findUnique({ where: { id: body.teamId } });
      if (!team) throw notFound('Команда не найдена');
    }
    if (body.role && id === req.auth!.user.id && body.role !== Role.ADMIN) {
      throw badRequest('Нельзя снять с себя роль администратора');
    }

    await prisma.user.update({
      where: { id },
      data: {
        role: body.role ?? undefined,
        teamId: body.teamId === undefined ? undefined : body.teamId,
        nickname: body.nickname === undefined ? undefined : body.nickname,
        ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      },
    });

    await auditFromRequest(req, {
      action: 'admin.user_updated',
      targetType: 'user',
      targetId: id,
      meta: { role: body.role, teamId: body.teamId, passwordChanged: Boolean(body.password) },
    });

    return { ok: true };
  });

  /** Подписка: продлить / выдать план / отменить. Сейчас все на FREE. */
  app.post('/admin/users/:id/subscription', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        action: z.enum(['extend', 'set', 'cancel']),
        plan: z.enum(['FREE', 'PRO']).optional(),
        days: z.number().int().min(1).max(3650).optional(),
      })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('Пользователь не найден');

    let data: Prisma.UserUpdateInput;

    if (body.action === 'cancel') {
      data = { subscriptionStatus: 'CANCELLED' };
    } else if (body.action === 'set') {
      data = {
        subscriptionPlan: body.plan ?? 'PRO',
        subscriptionStatus: 'ACTIVE',
        subscriptionUntil: body.days
          ? new Date(Date.now() + body.days * 24 * 60 * 60 * 1000)
          : null,
      };
    } else {
      if (!body.days) throw badRequest('Для продления укажите количество дней');
      // Продлеваем от текущей даты окончания, если она в будущем.
      const base =
        user.subscriptionUntil && user.subscriptionUntil.getTime() > Date.now()
          ? user.subscriptionUntil.getTime()
          : Date.now();
      data = {
        subscriptionPlan: body.plan ?? (user.subscriptionPlan === 'FREE' ? 'PRO' : user.subscriptionPlan),
        subscriptionStatus: 'ACTIVE',
        subscriptionUntil: new Date(base + body.days * 24 * 60 * 60 * 1000),
      };
    }

    const updated = await prisma.user.update({ where: { id }, data });

    await auditFromRequest(req, {
      action: 'admin.subscription_changed',
      targetType: 'user',
      targetId: id,
      meta: { ...body },
    });

    return {
      ok: true,
      subscription: {
        plan: updated.subscriptionPlan,
        status: updated.subscriptionStatus,
        until: updated.subscriptionUntil,
      },
    };
  });

  // ─────────────────────────── Токены доступа ───────────────────────────

  app.get('/admin/tokens', admin, async (req) => {
    const query = paging.parse(req.query);

    const [items, total] = await Promise.all([
      prisma.inviteToken.findMany({
        orderBy: { createdAt: 'desc' },
        skip: query.offset,
        take: query.limit,
        include: {
          team: { select: { id: true, name: true } },
          usedBy: { select: { id: true, binanceUid: true, nickname: true } },
          createdBy: { select: { id: true, binanceUid: true } },
        },
      }),
      prisma.inviteToken.count(),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        label: t.label,
        role: t.role,
        team: t.team,
        maxUses: t.maxUses,
        uses: t.uses,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
        usedBy: t.usedBy,
        usedAt: t.usedAt,
        createdAt: t.createdAt,
        createdBy: t.createdBy?.binanceUid ?? null,
        // Сырой токен не хранится, показать повторно нельзя
        status: t.revokedAt
          ? 'REVOKED'
          : t.expiresAt && t.expiresAt.getTime() < Date.now()
            ? 'EXPIRED'
            : t.uses >= t.maxUses
              ? 'USED'
              : 'ACTIVE',
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  });

  app.post('/admin/tokens', admin, async (req) => {
    const body = z
      .object({
        label: z.string().trim().max(120).optional(),
        role: z.enum(['USER', 'TEAM_LEAD', 'ADMIN']).default('USER'),
        teamId: z.string().nullable().optional(),
        maxUses: z.number().int().min(1).max(500).default(1),
        expiresInDays: z.number().int().min(1).max(365).nullable().default(30),
      })
      .parse(req.body ?? {});

    if (body.teamId) {
      const team = await prisma.team.findUnique({ where: { id: body.teamId } });
      if (!team) throw notFound('Команда не найдена');
    }

    const token = randomToken(24);
    const invite = await prisma.inviteToken.create({
      data: {
        tokenHash: sha256(token),
        label: body.label ?? null,
        role: body.role,
        teamId: body.teamId ?? null,
        maxUses: body.maxUses,
        expiresAt: body.expiresInDays
          ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
        createdById: req.auth!.user.id,
      },
    });

    await auditFromRequest(req, {
      action: 'admin.token_created',
      targetType: 'invite_token',
      targetId: invite.id,
      meta: { role: body.role, teamId: body.teamId, maxUses: body.maxUses },
    });

    // Сырое значение отдаём ровно один раз.
    return { id: invite.id, token, expiresAt: invite.expiresAt, maxUses: invite.maxUses };
  });

  app.delete('/admin/tokens/:id', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const invite = await prisma.inviteToken.findUnique({ where: { id } });
    if (!invite) throw notFound('Токен не найден');

    await prisma.inviteToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await auditFromRequest(req, {
      action: 'admin.token_revoked',
      targetType: 'invite_token',
      targetId: id,
    });

    return { ok: true };
  });

  // ─────────────────────────── Команды ───────────────────────────

  app.get('/admin/teams', admin, async () => {
    const teams = await prisma.team.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, binanceUid: true, nickname: true } },
        _count: { select: { members: true, orders: true, notes: true } },
      },
    });

    const volumes = await prisma.order.groupBy({
      by: ['teamId'],
      where: { status: 'COMPLETED', teamId: { not: null } },
      _sum: { amountFiat: true },
    });
    const volumeByTeam = new Map(volumes.map((v) => [v.teamId, Number(v._sum.amountFiat ?? 0)]));

    return {
      items: teams.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        owner: t.owner,
        members: t._count.members,
        orders: t._count.orders,
        notes: t._count.notes,
        volumeFiat: volumeByTeam.get(t.id) ?? 0,
        createdAt: t.createdAt,
      })),
    };
  });

  app.post('/admin/teams', admin, async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(64),
        slug: z.string().trim().max(40).optional(),
        /** UID будущего тимлида: он получит роль TEAM_LEAD и войдёт в команду. */
        ownerUid: z.string().trim().regex(/^\d{5,20}$/).optional(),
      })
      .parse(req.body);

    const slug = slugify(body.slug || body.name) || `team-${Date.now()}`;
    const existing = await prisma.team.findUnique({ where: { slug } });
    if (existing) throw conflict('Команда с таким slug уже существует', 'TEAM_SLUG_TAKEN');

    let ownerId = req.auth!.user.id;
    let owner = null as null | { id: string };

    if (body.ownerUid) {
      const found = await prisma.user.findUnique({ where: { binanceUid: body.ownerUid } });
      if (!found) throw notFound('Пользователь с таким UID не найден');
      ownerId = found.id;
      owner = { id: found.id };
    }

    const team = await prisma.team.create({ data: { name: body.name, slug, ownerId } });

    if (owner) {
      await prisma.user.update({
        where: { id: owner.id },
        data: { teamId: team.id, role: Role.TEAM_LEAD },
      });
    }

    await auditFromRequest(req, {
      action: 'admin.team_created',
      targetType: 'team',
      targetId: team.id,
      meta: { name: body.name, ownerUid: body.ownerUid },
    });

    return { id: team.id, name: team.name, slug: team.slug };
  });

  app.patch('/admin/teams/:id', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(2).max(64).optional(),
        ownerUid: z.string().trim().regex(/^\d{5,20}$/).optional(),
      })
      .parse(req.body);

    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) throw notFound('Команда не найдена');

    let ownerId: string | undefined;
    if (body.ownerUid) {
      const owner = await prisma.user.findUnique({ where: { binanceUid: body.ownerUid } });
      if (!owner) throw notFound('Пользователь с таким UID не найден');
      ownerId = owner.id;
      await prisma.user.update({
        where: { id: owner.id },
        data: { teamId: id, role: Role.TEAM_LEAD },
      });
    }

    await prisma.team.update({
      where: { id },
      data: { name: body.name ?? undefined, ownerId },
    });

    await auditFromRequest(req, {
      action: 'admin.team_updated',
      targetType: 'team',
      targetId: id,
      meta: { ...body },
    });

    return { ok: true };
  });

  app.delete('/admin/teams/:id', admin, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const team = await prisma.team.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
    if (!team) throw notFound('Команда не найдена');
    if (team._count.members > 0) {
      throw badRequest('Сначала уберите всех участников из команды');
    }

    await prisma.team.delete({ where: { id } });
    await auditFromRequest(req, {
      action: 'admin.team_deleted',
      targetType: 'team',
      targetId: id,
    });

    return { ok: true };
  });

  // ─────────────────────────── Аудит ───────────────────────────

  app.get('/admin/audit', admin, async (req) => {
    const query = paging.extend({ action: z.string().max(64).optional() }).parse(req.query);

    const where = query.action ? { action: { contains: query.action } } : {};

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.offset,
        take: query.limit,
        include: { actor: { select: { id: true, binanceUid: true, nickname: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total, limit: query.limit, offset: query.offset };
  });
}
