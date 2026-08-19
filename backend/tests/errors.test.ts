// форма ошибок наружу: расширение реагирует на error.code, а не на текст
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { rateLimitError, registerErrorHandler } from '../src/plugins/security.js';
import { badRequest, notFound } from '../src/lib/errors.js';

async function buildTestApp() {
  const app = Fastify();
  await app.register(rateLimit, {
    global: true,
    max: 1,
    timeWindow: '1 minute',
    errorResponseBuilder: rateLimitError,
  });

  app.get('/ok', async () => ({ ok: true }));
  app.get('/boom', async () => {
    throw notFound('Контрагент не найден');
  });
  app.get('/bad', async () => {
    throw badRequest('Плохой запрос');
  });
  app.get('/zod', async () => {
    z.object({ uid: z.string().min(4) }).parse({ uid: 'x' });
    return { ok: true };
  });

  registerErrorHandler(app);
  await app.ready();
  return app;
}

describe('обработчик ошибок', () => {
  it('превышение лимита отдаёт 429 и код RATE_LIMITED, а не 500', async () => {
    const app = await buildTestApp();

    const first = await app.inject({ method: 'GET', url: '/ok' });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({ method: 'GET', url: '/ok' });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'RATE_LIMITED');

    await app.close();
  });

  it('доменные ошибки сохраняют свой статус и код', async () => {
    const app = await buildTestApp();

    const missing = await app.inject({ method: 'GET', url: '/boom' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'NOT_FOUND');

    await app.close();
  });

  it('ошибка разбора превращается в VALIDATION_ERROR с подробностями', async () => {
    const app = await buildTestApp();

    const invalid = await app.inject({ method: 'GET', url: '/zod' });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(invalid.json().error.details));

    await app.close();
  });

  it('неизвестный маршрут отвечает нашим форматом, а не фастифаевским', async () => {
    const app = await buildTestApp();

    const missing = await app.inject({ method: 'GET', url: '/нет-такого' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'NOT_FOUND');

    await app.close();
  });
});
