import type { FastifyInstance } from 'fastify';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { auditFromRequest } from '../lib/audit.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';

const noteSchema = z.object({
  counterpartyId: z.string().min(1),
  text: z.string().trim().max(2000),
});

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };
  const teamAuth = { preHandler: [app.authenticate, app.requireSubscription, app.requireTeam] };

  // состав команды и статистика по каждому участнику
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

  // тимлид выдаёт токен на вступление в свою команду
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

    // сырой токен показываем один раз, в БД лежит только хэш
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

  // заметка видна только своей команде
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

  // вступление для уже зарегистрированного: на /auth/activate токен работает
  // только для нового аккаунта
  app.post('/teams/join', auth, async (req) => {
    const body = z.object({ token: z.string().trim().min(10) }).parse(req.body);
    const ctx = req.auth!;

    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash: sha256(body.token) },
      include: { team: { select: { id: true, name: true, slug: true } } },
    });

    if (!invite || invite.revokedAt) {
      throw unauthorized('Токен не найден или отозван', 'INVITE_INVALID');
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Срок действия токена истёк', 'INVITE_EXPIRED');
    }
    if (invite.uses >= invite.maxUses) {
      throw unauthorized('Токен уже использован', 'INVITE_USED');
    }
    if (!invite.teamId || !invite.team) {
      throw badRequest('Этот токен не привязан к команде');
    }
    if (ctx.teamId === invite.teamId) {
      throw badRequest('Вы уже состоите в этой команде');
    }
    if (ctx.teamId) {
      throw conflict(
        'Сначала выйдите из текущей команды — состоять можно только в одной',
        'ALREADY_IN_TEAM',
      );
    }

    // роль из токена применяем только на повышение, админа понижать нельзя
    const nextRole =
      ctx.role === Role.ADMIN
        ? Role.ADMIN
        : invite.role === Role.TEAM_LEAD
          ? Role.TEAM_LEAD
          : ctx.role;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: ctx.user.id },
        data: { teamId: invite.teamId, role: nextRole },
      }),
      prisma.inviteToken.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 }, usedById: ctx.user.id, usedAt: new Date() },
      }),
    ]);

    await auditFromRequest(req, {
      action: 'team.joined',
      targetType: 'team',
      targetId: invite.teamId,
      meta: { inviteId: invite.id },
    });

    return { ok: true, team: invite.team, role: nextRole };
  });

  // пользователь заводит свою команду и становится тимлидом
  app.post('/teams', auth, async (req) => {
    const body = z.object({ name: z.string().trim().min(2).max(64) }).parse(req.body);
    const ctx = req.auth!;

    if (ctx.teamId) {
      throw conflict(
        'Вы уже состоите в команде — состоять можно только в одной',
        'ALREADY_IN_TEAM',
      );
    }

    // названия повторяются, а slug уникален — при коллизии дописываем суффикс
    const base = slugify(body.name) || 'team';
    let slug = base;
    for (let i = 2; await prisma.team.findUnique({ where: { slug } }); i += 1) {
      slug = `${base}-${i}`;
      if (i > 50) {
        slug = `${base}-${Date.now().toString(36)}`;
        break;
      }
    }

    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: { name: body.name, slug, ownerId: ctx.user.id },
      });
      await tx.user.update({
        where: { id: ctx.user.id },
        // админа не понижаем
        data: { teamId: created.id, role: ctx.isAdmin ? Role.ADMIN : Role.TEAM_LEAD },
      });
      return created;
    });

    await auditFromRequest(req, {
      action: 'team.created',
      targetType: 'team',
      targetId: team.id,
      meta: { name: team.name },
    });

    return {
      ok: true,
      team: { id: team.id, name: team.name, slug: team.slug },
      role: ctx.isAdmin ? Role.ADMIN : Role.TEAM_LEAD,
    };
  });

  // владелец уйти не может, сначала передать команду
  app.post('/teams/leave', teamAuth, async (req) => {
    const ctx = req.auth!;
    const teamId = ctx.teamId!;

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (team?.ownerId === ctx.user.id) {
      throw badRequest('Вы владелец команды. Сначала назначьте другого тимлида.');
    }

    await prisma.user.update({
      where: { id: ctx.user.id },
      data: { teamId: null, role: ctx.role === Role.TEAM_LEAD ? Role.USER : ctx.role },
    });

    await auditFromRequest(req, {
      action: 'team.left',
      targetType: 'team',
      targetId: teamId,
    });

    return { ok: true };
  });

  // список для выпадашек, без приватных данных
  app.get('/teams', auth, async () => {
    const teams = await prisma.team.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, _count: { select: { members: true } } },
    });
    return { items: teams.map((t) => ({ ...t, members: t._count.members })) };
  });
}
