import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

/** scrypt из stdlib — без нативных зависимостей, собирается везде. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEY_LEN) return false;

  const actual = await scrypt(password, salt, KEY_LEN);
  return timingSafeEqual(actual, expected);
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Случайный токен для инвайтов и refresh-сессий. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const newId = () => randomUUID();

/** Только цифры — под сравнение карт и телефонов. */
export const normalizeDigits = (value: string) => value.replace(/\D+/g, '');

/** 4276123412341234 → 4276••••1234, +79161234567 → +7916•••4567 */
export function maskRequisite(digits: string): string {
  if (digits.length <= 4) return '•'.repeat(digits.length);
  const head = digits.slice(0, Math.min(4, digits.length - 4));
  const tail = digits.slice(-4);
  return `${head}${'•'.repeat(Math.max(3, digits.length - head.length - 4))}${tail}`;
}

/** UID контрагента в UI показываем как «•••221» — как в аналоге. */
export function maskUid(uid: string): string {
  if (uid.length <= 3) return `•••${uid}`;
  return `•••${uid.slice(-3)}`;
}
