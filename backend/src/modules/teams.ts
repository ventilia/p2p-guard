import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { auditFromRequest } from '../lib/audit.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';

const noteSchema = z.object({
  counterpartyId: z.string().min(1),
  text: z.string().trim().max(2000),
});

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };
  const teamAuth = { preHandler: [app.authenticate, app.requireSubscription, app.requireTeam] };

  /** Состав команды + агрегированная статистика по каждому участнику. */
  app.get('/teams/me', teamAuth, async (req) => {
    const ctx = req.auth!;
    const teamId = ctx.teamId!;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            binanceUid: true,
            nickname: true,
            role: true,
            status: true,
            createdAt: true,
            lastSeenAt: true,
          },
        },
      },
    });
    if (!team) throw notFound('Команда не найдена');

    const [orderStats, volume] = await Promise.all([
      prisma.order.groupBy({
        by: ['userId', 'status'],
        where: { teamId },
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ['userId'],
        where: { teamId, status: 'COMPLETED' },
        _sum: { amountFiat: true },
      }),
    ]);

    const volumeByUser = new Map(volume.map((v) => [v.userId, Number(v._sum.amountFiat ?? 0)]));

    const members = team.members.map((m) => {
      const rows = orderStats.filter((s) => s.userId === m.id);
      const count = (status: string) =>
        rows.find((r) => r.status === status)?._count._all ?? 0;
      return {
        ...m,
        isOwner: m.id === team.ownerId,
        stats: {
          total: rows.reduce((sum, r) => sum + r._count._all, 0),
          completed: count('COMPLETED'),
          cancelled: count('CANCELLED'),
          volumeFiat: volumeByUser.get(m.id) ?? 0,
        },
      };
    });

    return {
      team: { id: team.id, name: team.name, slug: team.slug, ownerId: team.ownerId },
      isLead: ctx.role === Role.TEAM_LEAD || ctx.isAdmin || team.ownerId === ctx.user.id,
      members,
    };
  });

  /** Тимлид выдаёт токен на вступление в свою команду. */
  app.post('/teams/me/invites', teamAuth, async (req) => {
    const ctx = req.auth!;
    if (ctx.role !== Role.TEAM_LEAD && !ctx.isAdmin) {
      throw forbidden('Токены выдаёт тимлид или администратор');
    }

    const body = z
      .object({
        label: z.string().trim().max(120).optional(),
        maxUses: z.number().int().min(1).max(100).default(1),
        expiresInDays: z.number().int().min(1).max(365).default(14),
      })
      .parse(req.body ?? {});

    const token = randomToken(24);
    const invite = await prisma.inviteToken.create({
      data: {
        tokenHash: sha256(token),
        label: body.label ?? null,
        role: Role.USER,
        teamId: ctx.teamId,
        maxUses: body.maxUses,
        expiresAt: new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000),
        createdById: ctx.user.id,
      },
    });

    await auditFromRequest(req, {
      action: 'team.invite_created',
      targetType: 'team',
      targetId: ctx.teamId!,
      meta: { inviteId: invite.id, maxUses: body.maxUses },
    });

    // Сырой токен показываем один раз — в БД лежит только хэш.
    return { id: invite.id, token, expiresAt: invite.expiresAt, maxUses: invite.maxUses };
  });

  app.delete('/teams/me/members/:userId', teamAuth, async (req) => {
    const { userId } = z.object({ userId: z.string().min(1) }).parse(req.params);
    const ctx = req.auth!;
    if (ctx.role !== Role.TEAM_LEAD && !ctx.isAdmin) {
      throw forbidden('Исключать участников может только тимлид');
    }

    const member = await prisma.user.findUnique({ where: { id: userId } });
    if (!member || member.teamId !== ctx.teamId) throw notFound('Участник не найден в вашей команде');

    const team = await prisma.team.findUnique({ where: { id: ctx.teamId! } });
    if (team?.ownerId === userId) throw badRequest('Нельзя исключить владельца команды');

    await prisma.user.update({ where: { id: userId }, data: { teamId: null } });
    await auditFromRequest(req, {
      action: 'team.member_removed',
      targetType: 'user',
      targetId: userId,
      meta: { teamId: ctx.teamId },
    });

    return { ok: true };
  });

  /** Заметка команды по контрагенту — видна только своей команде. */
  app.put('/teams/notes', teamAuth, async (req) => {
    const body = noteSchema.parse(req.body);
    const ctx = req.auth!;
    const teamId = ctx.teamId!;

    const counterparty = await prisma.counterparty.findUnique({
      where: { id: body.counterpartyId },
      select: { id: true },
    });
    if (!counterparty) throw notFound('Контрагент не найден');

    if (!body.text) {
      await prisma.teamNote.deleteMany({ where: { teamId, counterpartyId: counterparty.id } });
      return { ok: true, deleted: true };
    }

    const note = await prisma.teamNote.upsert({
      where: { teamId_counterpartyId: { teamId, counterpartyId: counterparty.id } },
      create: {
        teamId,
        counterpartyId: counterparty.id,
        text: body.text,
        authorId: ctx.user.id,
      },
      update: { text: body.text, authorId: ctx.user.id },
    });

    return { ok: true, updatedAt: note.updatedAt };
  });

  /** Список команд — для выпадашек (без приватных данных). */
  app.get('/teams', auth, async () => {
    const teams = await prisma.team.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, _count: { select: { members: true } } },
    });
    return { items: teams.map((t) => ({ ...t, members: t._count.members })) };
  });
}
