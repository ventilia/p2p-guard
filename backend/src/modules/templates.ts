import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { forbidden, notFound } from '../lib/errors.js';

const bodySchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  position: z.number().int().min(0).max(999).default(0),
  // шаблон команды видят все участники, создаёт тимлид или админ
  shared: z.boolean().default(false),
});

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate, app.requireSubscription] };

  app.get('/templates', auth, async (req) => {
    const ctx = req.auth!;
    const items = await prisma.messageTemplate.findMany({
      where: {
        OR: [{ userId: ctx.user.id }, ...(ctx.teamId ? [{ teamId: ctx.teamId }] : [])],
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      items: items.map((t) => ({
        id: t.id,
        title: t.title,
        body: t.body,
        position: t.position,
        shared: t.teamId !== null,
        canEdit: t.userId === ctx.user.id || ctx.role === 'TEAM_LEAD' || ctx.isAdmin,
      })),
    };
  });

  app.post('/templates', auth, async (req) => {
    const body = bodySchema.parse(req.body);
    const ctx = req.auth!;

    if (body.shared && !ctx.teamId) throw forbidden('Общий шаблон требует команды');
    if (body.shared && ctx.role !== 'TEAM_LEAD' && !ctx.isAdmin) {
      throw forbidden('Общие шаблоны создаёт тимлид');
    }

    const created = await prisma.messageTemplate.create({
      data: {
        userId: body.shared ? null : ctx.user.id,
        teamId: body.shared ? ctx.teamId : null,
        title: body.title,
        body: body.body,
        position: body.position,
      },
    });

    return { id: created.id };
  });

  app.put('/templates/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = bodySchema.partial().parse(req.body);
    const ctx = req.auth!;

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) throw notFound('Шаблон не найден');

    const canEdit =
      template.userId === ctx.user.id ||
      ctx.isAdmin ||
      (template.teamId !== null && template.teamId === ctx.teamId && ctx.role === 'TEAM_LEAD');
    if (!canEdit) throw forbidden('Нет прав на редактирование шаблона');

    await prisma.messageTemplate.update({
      where: { id },
      data: {
        title: body.title ?? undefined,
        body: body.body ?? undefined,
        position: body.position ?? undefined,
      },
    });

    return { ok: true };
  });

  app.delete('/templates/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const ctx = req.auth!;

    const template = await prisma.messageTemplate.findUnique({ where: { id } });
    if (!template) throw notFound('Шаблон не найден');

    const canDelete =
      template.userId === ctx.user.id ||
      ctx.isAdmin ||
      (template.teamId !== null && template.teamId === ctx.teamId && ctx.role === 'TEAM_LEAD');
    if (!canDelete) throw forbidden('Нет прав на удаление шаблона');

    await prisma.messageTemplate.delete({ where: { id } });
    return { ok: true };
  });
}
