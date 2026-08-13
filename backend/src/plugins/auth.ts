import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Role, type User } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { conflict, forbidden, paymentRequired, unauthorized } from '../lib/errors.js';

export type AccessTokenPayload = {
  sub: string;
  role: Role;
  teamId: string | null;
  uid: string;
  typ: 'access';
};

export type AuthContext = {
  user: User;
  role: Role;
  teamId: string | null;
  isAdmin: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Role[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireTeam: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSubscription: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

/**
 * Регистрируем прямым вызовом из app.ts (без fastify-plugin), чтобы декораторы
 * попали в корневой инстанс и были видны во всех роутерах.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.ACCESS_TOKEN_TTL },
  });

  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    let payload: AccessTokenPayload;
    try {
      payload = await req.jwtVerify<AccessTokenPayload>();
    } catch {
      throw unauthorized('Токен недействителен или истёк', 'TOKEN_INVALID');
    }

    if (payload.typ !== 'access') {
      throw unauthorized('Неверный тип токена', 'TOKEN_INVALID');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw unauthorized('Пользователь не найден', 'USER_NOT_FOUND');
    if (user.status === 'BLOCKED') {
      throw forbidden(user.blockReason || 'Аккаунт заблокирован', 'USER_BLOCKED');
    }

    // Привязка учётки к аккаунту биржи: одна лицензия — один UID.
    const headerUid = req.headers['x-binance-uid'];
    if (typeof headerUid === 'string' && headerUid && headerUid !== user.binanceUid) {
      throw conflict(
        'Аккаунт расширения привязан к другому UID Binance',
        'UID_MISMATCH',
      );
    }

    req.auth = {
      user,
      role: user.role,
      teamId: user.teamId,
      isAdmin: user.role === Role.ADMIN,
    };

    // lastSeenAt обновляем не чаще раза в 5 минут, чтобы не писать в БД на каждый запрос.
    const stale = !user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 5 * 60_000;
    if (stale) {
      void prisma.user
        .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
  });

  app.decorate(
    'requireRole',
    (...roles: Role[]) =>
      async (req: FastifyRequest, _reply: FastifyReply) => {
        const auth = req.auth;
        if (!auth) throw unauthorized();
        if (!roles.includes(auth.role)) throw forbidden('Действие доступно только: ' + roles.join(', '));
      },
  );

  app.decorate('requireTeam', async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.auth;
    if (!auth) throw unauthorized();
    if (!auth.teamId) throw forbidden('Вы не состоите в команде', 'NO_TEAM');
  });

  app.decorate('requireSubscription', async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.auth;
    if (!auth) throw unauthorized();
    if (auth.isAdmin) return;
    const { subscriptionPlan, subscriptionStatus, subscriptionUntil } = auth.user;
    if (subscriptionPlan === 'FREE') return; // сейчас всё бесплатно
    const expired =
      subscriptionStatus !== 'ACTIVE' ||
      (subscriptionUntil !== null && subscriptionUntil.getTime() < Date.now());
    if (expired) throw paymentRequired();
  });
}
