import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import { hashPassword, newId, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { parseDurationSeconds } from '../lib/time.js';
import type { AccessTokenPayload } from '../plugins/auth.js';

const uidSchema = z
  .string()
  .trim()
  .regex(/^\d{5,20}$/, 'UID Binance — это число из 5–20 цифр');

const passwordSchema = z.string().min(8, 'Пароль минимум 8 символов').max(128);

const activateSchema = z.object({
  token: z.string().trim().min(10, 'Некорректный токен доступа'),
  binanceUid: uidSchema,
  nickname: z.string().trim().min(1).max(64).optional(),
  password: passwordSchema,
});

const loginSchema = z.object({
  binanceUid: uidSchema,
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** id записи refresh-токена — нужен для цепочки ротации. */
  refreshTokenId: string;
};

/** Выпускает access + refresh. familyId связывает цепочку ротаций одного устройства. */
async function issueTokens(
  app: FastifyInstance,
  req: FastifyRequest,
  user: User,
  familyId: string = newId(),
): Promise<TokenPair> {
  const payload: AccessTokenPayload = {
    sub: user.id,
    role: user.role,
    teamId: user.teamId,
    uid: user.binanceUid,
    typ: 'access',
  };
  const accessToken = app.jwt.sign(payload);

  const refreshToken = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const stored = await prisma.refreshToken.create({
    data: {
      tokenHash: sha256(refreshToken),
      familyId,
      userId: user.id,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 255) || null,
      ip: req.ip,
      expiresAt,
    },
    select: { id: true },
  });

  return {
    accessToken,
    refreshToken,
    refreshTokenId: stored.id,
    // TTL берём из той же настройки, которой подписан JWT, — иначе клиент
    // будет считать токен живым дольше, чем он есть.
    expiresIn: parseDurationSeconds(env.ACCESS_TOKEN_TTL),
  };
}

/** Наружу отдаём только сами токены — внутренний id записи клиенту не нужен. */
const publicTokens = ({ accessToken, refreshToken, expiresIn }: TokenPair) => ({
  accessToken,
  refreshToken,
  expiresIn,
});

function publicUser(user: User) {
  return {
    id: user.id,
    binanceUid: user.binanceUid,
    nickname: user.nickname,
    role: user.role,
    status: user.status,
    teamId: user.teamId,
    subscription: {
      plan: user.subscriptionPlan,
      status: user.subscriptionStatus,
      until: user.subscriptionUntil,
    },
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Логин-эндпоинты брутфорсятся — отдельный жёсткий лимит.
  const strictLimit = {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  };

  app.post('/auth/activate', strictLimit, async (req) => {
    const body = activateSchema.parse(req.body);

    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash: sha256(body.token) },
    });

    if (!invite || invite.revokedAt) {
      throw unauthorized('Токен доступа не найден или отозван', 'INVITE_INVALID');
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Срок действия токена истёк', 'INVITE_EXPIRED');
    }
    if (invite.uses >= invite.maxUses) {
      throw unauthorized('Токен уже использован', 'INVITE_USED');
    }

    const existing = await prisma.user.findUnique({ where: { binanceUid: body.binanceUid } });
    if (existing) {
      throw conflict('Аккаунт с таким UID Binance уже зарегистрирован', 'UID_TAKEN');
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          binanceUid: body.binanceUid,
          nickname: body.nickname ?? null,
          passwordHash: await hashPassword(body.password),
          role: invite.role,
          teamId: invite.teamId,
        },
      });

      await tx.inviteToken.update({
        where: { id: invite.id },
        data: {
          uses: { increment: 1 },
          usedById: created.id,
          usedAt: new Date(),
        },
      });

      return created;
    });

    await audit({
      actorId: user.id,
      action: 'auth.activate',
      targetType: 'user',
      targetId: user.id,
      meta: { inviteId: invite.id, teamId: invite.teamId },
      ip: req.ip,
    });

    const tokens = await issueTokens(app, req, user);
    return { user: publicUser(user), ...publicTokens(tokens) };
  });

  app.post('/auth/login', strictLimit, async (req) => {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { binanceUid: body.binanceUid } });
    // Одинаковый ответ для «нет пользователя» и «неверный пароль» — не даём перебирать UID.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('Неверный UID или пароль', 'BAD_CREDENTIALS');
    }
    if (user.status === 'BLOCKED') {
      throw forbidden(user.blockReason || 'Аккаунт заблокирован', 'USER_BLOCKED');
    }

    const tokens = await issueTokens(app, req, user);
    await audit({ actorId: user.id, action: 'auth.login', ip: req.ip });
    return { user: publicUser(user), ...publicTokens(tokens) };
  });

  app.post('/auth/refresh', strictLimit, async (req) => {
    const body = refreshSchema.parse(req.body);
    const tokenHash = sha256(body.refreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored) throw unauthorized('Сессия не найдена', 'REFRESH_INVALID');

    // Повторное предъявление уже отозванного токена — признак кражи:
    // гасим всю семью, пользователь перелогинится.
    if (stored.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit({
        actorId: stored.userId,
        action: 'auth.refresh_reuse_detected',
        meta: { familyId: stored.familyId },
        ip: req.ip,
      });
      throw unauthorized('Сессия отозвана, войдите заново', 'REFRESH_REUSED');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw unauthorized('Сессия истекла', 'REFRESH_EXPIRED');
    }
    if (stored.user.status === 'BLOCKED') {
      throw forbidden(stored.user.blockReason || 'Аккаунт заблокирован', 'USER_BLOCKED');
    }

    const tokens = await issueTokens(app, req, stored.user, stored.familyId);

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: tokens.refreshTokenId },
    });

    return { user: publicUser(stored.user), ...publicTokens(tokens) };
  });

  app.post('/auth/logout', async (req) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Не передан refreshToken');

    await prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(parsed.data.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { ok: true };
  });

  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const auth = req.auth!;
    const team = auth.teamId
      ? await prisma.team.findUnique({
          where: { id: auth.teamId },
          select: { id: true, name: true, slug: true, ownerId: true },
        })
      : null;

    const stats = await prisma.order.groupBy({
      by: ['status'],
      where: { userId: auth.user.id },
      _count: { _all: true },
    });

    return {
      user: publicUser(auth.user),
      team,
      orders: Object.fromEntries(stats.map((s) => [s.status, s._count._all])),
    };
  });

  app.post('/me/password', { preHandler: [app.authenticate] }, async (req) => {
    const body = z
      .object({ currentPassword: z.string().min(1), newPassword: passwordSchema })
      .parse(req.body);
    const auth = req.auth!;

    if (!(await verifyPassword(body.currentPassword, auth.user.passwordHash))) {
      throw unauthorized('Текущий пароль неверен', 'BAD_CREDENTIALS');
    }

    await prisma.user.update({
      where: { id: auth.user.id },
      data: { passwordHash: await hashPassword(body.newPassword) },
    });
    // Смена пароля закрывает все прочие сессии.
    await prisma.refreshToken.updateMany({
      where: { userId: auth.user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit({ actorId: auth.user.id, action: 'auth.password_changed', ip: req.ip });

    return { ok: true };
  });
}
