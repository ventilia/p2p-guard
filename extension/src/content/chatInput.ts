// вставка текста в поле чата Binance
// на живой странице поле — textarea.bn-textarea-input с placeholder
// «Введите сообщение здесь», но вёрстка биржи меняется, поэтому известный
// селектор идёт первым, а следом та же эвристика, что и раньше

type Candidate = { el: HTMLElement; score: number };

const PLACEHOLDER_HINT = /сообщ|напиш|введ|message|type|chat/i;
const CONTAINER_HINT = /chat|message|dialog|conversation/i;

// подтверждено разведкой страницы ордера
const KNOWN_INPUT = 'textarea.bn-textarea-input';

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 80 && rect.height > 16;
}

// чем больше баллов, тем вероятнее это поле ввода чата
function score(el: HTMLElement): number {
  let points = 0;
  const rect = el.getBoundingClientRect();

  const placeholder =
    el.getAttribute('placeholder') ?? el.getAttribute('aria-label') ?? el.dataset.placeholder ?? '';
  if (PLACEHOLDER_HINT.test(placeholder)) points += 40;

  // поле ввода чата почти всегда в контейнере с говорящим классом
  for (let node: HTMLElement | null = el, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
    const marker = `${node.className ?? ''} ${node.id ?? ''}`;
    if (typeof marker === 'string' && CONTAINER_HINT.test(marker)) {
      points += 25;
      break;
    }
  }

  // textarea — более вероятный кандидат, чем произвольный contenteditable
  if (el.tagName === 'TEXTAREA') points += 15;

  // ввод сообщения обычно внизу экрана и достаточно широкий
  if (rect.top > window.innerHeight * 0.45) points += 15;
  if (rect.width > 220) points += 10;

  return points;
}

export function findChatInput(): HTMLElement | null {
  const known = document.querySelector<HTMLElement>(KNOWN_INPUT);
  if (known && isVisible(known)) return known;

  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      'textarea:not([readonly]):not([disabled]), [contenteditable="true"]',
    ),
  );

  const candidates: Candidate[] = nodes
    .filter(isVisible)
    .map((el) => ({ el, score: score(el) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.el ?? null;
}

/**
 * React держит значение в своём состоянии и игнорирует прямую запись в value,
 * поэтому пишем через нативный сеттер и сами шлём input — только так фреймворк
 * увидит изменение и кнопка отправки станет активной.
 */
function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

// текст дописываем к тому, что уже набрано, а не затираем чужой черновик
function join(existing: string, addition: string): string {
  const trimmed = existing.trimEnd();
  if (!trimmed) return addition;
  return `${trimmed} ${addition}`;
}

// отправка: сначала ищем кнопку рядом с полем, иначе жмём Enter как человек
function submitChat(el: HTMLElement): void {
  const form = el.closest('form');
  const scope = (form ?? el.parentElement?.parentElement ?? el.parentElement) as HTMLElement | null;

  const button = Array.from(
    scope?.querySelectorAll<HTMLElement>('button, [role="button"]') ?? [],
  ).find((b) => {
    const marker = `${b.className} ${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`;
    return /send|отправ|submit/i.test(marker) && !(b as HTMLButtonElement).disabled;
  });

  if (button) {
    button.click();
    return;
  }

  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    el.dispatchEvent(
      new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
    );
  }
}

export function insertIntoChat(text: string, send = false): boolean {
  const el = findChatInput();
  if (!el) return false;

  el.focus();

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    // при отправке черновик не приклеиваем: уйдёт чужой текст вместе с шаблоном
    setNativeValue(el, send ? text : join(el.value, text));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.setSelectionRange(el.value.length, el.value.length);
    // React обновляет состояние кнопки не синхронно, отправляем следующим тиком
    if (send) setTimeout(() => submitChat(el), 60);
    return true;
  }

  // contenteditable: правим через execCommand, чтобы редактор увидел ввод
  const current = el.textContent ?? '';
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const addition = current.trimEnd() ? ` ${text}` : text;
  if (!document.execCommand('insertText', false, addition)) {
    el.textContent = join(current, text);
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: addition }));
  return true;
}
