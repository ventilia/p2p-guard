// единый формат { error: { code, message, details? } }, расширение реагирует на code
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Требуется авторизация', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);

export const forbidden = (message = 'Недостаточно прав', code = 'FORBIDDEN') =>
  new AppError(403, code, message);

export const notFound = (message = 'Не найдено') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);

export const paymentRequired = (message = 'Подписка истекла') =>
  new AppError(402, 'SUBSCRIPTION_EXPIRED', message);
