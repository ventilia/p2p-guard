import type { RequisiteType } from './types.js';

// алгоритм Луна отсекает случайные числа из чата
export function isValidCard(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// российские и казахстанские мобильные плюс общий международный формат
function isValidPhone(digits: string): boolean {
  if (digits.length < 10 || digits.length > 15) return false;
  // 79161234567 / 89161234567 / 9161234567
  if (/^[78]\d{10}$/.test(digits)) return true;
  if (/^9\d{9}$/.test(digits)) return true;
  return digits.length >= 11;
}

export type ParsedRequisite = { type: RequisiteType; value: string };

// консервативно: лучше пропустить реквизит, чем засорить базу мусором
export function extractRequisites(text: string): ParsedRequisite[] {
  if (!text) return [];

  const found = new Map<string, ParsedRequisite>();

  // карты: группы цифр, возможно через пробел или дефис
  const cardCandidates = text.match(/\b(?:\d[ \-]?){12,22}\b/g) ?? [];
  for (const raw of cardCandidates) {
    const digits = raw.replace(/\D+/g, '');
    if (isValidCard(digits)) {
      found.set(`CARD:${digits}`, { type: 'CARD', value: digits });
    }
  }

  // телефоны: с ведущим + или 8/7
  const phoneCandidates = text.match(/(?:\+?\d[\d \-()]{8,18}\d)/g) ?? [];
  for (const raw of phoneCandidates) {
    const digits = raw.replace(/\D+/g, '');
    if (found.has(`CARD:${digits}`)) continue;
    if (isValidCard(digits)) continue;
    if (isValidPhone(digits)) {
      const normalized = digits.length === 10 && digits.startsWith('9') ? `7${digits}` : digits;
      found.set(`PHONE:${normalized}`, { type: 'PHONE', value: normalized });
    }
  }

  return [...found.values()];
}

// 4276123412341234 → 4276••••1234
export function maskRequisite(digits: string): string {
  if (digits.length <= 4) return '•'.repeat(digits.length);
  const head = digits.slice(0, Math.min(4, digits.length - 4));
  const tail = digits.slice(-4);
  return `${head}${'•'.repeat(Math.max(3, digits.length - head.length - 4))}${tail}`;
}
