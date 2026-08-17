import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET должен быть не короче 16 символов'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default(''),
  ALLOW_ANY_EXTENSION_ORIGIN: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SEED_ADMIN_UID: z.string().default('100000001'),
  SEED_ADMIN_PASSWORD: z.string().default('admin12345'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  // падаем сразу и понятно, а не «где-то потом undefined»
  throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
};

export type Env = typeof env;
