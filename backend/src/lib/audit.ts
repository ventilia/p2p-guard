import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

type AuditInput = {
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
};

/**
 * Аудит пишем «мягко»: падение лога не должно валить бизнес-операцию.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        meta: (input.meta ?? {}) as object,
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] не удалось записать событие', input.action, err);
  }
}

export function auditFromRequest(
  req: FastifyRequest,
  input: Omit<AuditInput, 'actorId' | 'ip'> & { actorId?: string | null },
) {
  return audit({
    ...input,
    actorId: input.actorId ?? req.auth?.user.id ?? null,
    ip: req.ip,
  });
}
