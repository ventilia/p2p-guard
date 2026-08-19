import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env } from '../env.js';
import { sha256 } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export async function registerSecurity(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
// API не отдаёт HTML, CSP тут только мешает
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    credentials: true,
    origin(origin, cb) {
      // запросы без Origin: curl и service worker в части случаев
      if (!origin) return cb(null, true);
      if (env.corsOrigins.includes(origin)) return cb(null, true);
      if (env.ALLOW_ANY_EXTENSION_ORIGIN && origin.startsWith('chrome-extension://')) {
        return cb(null, true);
      }
      cb(new Error(`Origin ${origin} не разрешён CORS-политикой`), false);
    },
    allowedHeaders: ['content-type', 'authorization', 'x-binance-uid', 'x-client-version'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // req.auth в onRequest ещё пуст, а за одним NAT сидит целая команда —
    // поэтому различаем клиентов по токену, а не по IP
    keyGenerator: (req) => {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) return `t:${sha256(header.slice(7))}`;
      return `ip:${req.ip}`;
    },
    errorResponseBuilder: rateLimitError,
  });
}

// ответ на превышение лимита
export const rateLimitError = () =>
  new AppError(429, 'RATE_LIMITED', 'Слишком много запросов, попробуйте позже');

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Некорректные данные запроса',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }

    // ошибки самого fastify: парсинг тела, лимиты, 404 роутера
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;

    if (statusCode >= 500) {
      req.log.error({ err: error }, 'Необработанная ошибка');
      return reply.status(500).send({
        error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' },
      });
    }

    return reply.status(statusCode).send({
      error: {
        code: fastifyError.code ?? 'REQUEST_ERROR',
        message: fastifyError.message ?? 'Ошибка запроса',
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Маршрут ${req.method} ${req.url} не найден` },
    });
  });
}
