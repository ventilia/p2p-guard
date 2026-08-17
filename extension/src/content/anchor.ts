// поиск чата на странице ордера и расчёт места под панель
//
// вёрстка снята с живой страницы /ru/fiatOrderDetail: чат — фиксированный
// столбец справа (div.flex.fixed.z-[999]) высотой во весь экран, внутри него
// шапка, лента сообщений и поле ввода. Значит «под чатом» = подрезать чат по
// высоте и занять освободившийся низ, иначе панель просто накроет переписку.
//
// селекторы биржи меняются, поэтому чат ищем от поля ввода вверх, а классы
// используем лишь как подсказку

import type { PanelPlacement } from '../shared/types.js';
import { findChatInput } from './chatInput.js';

export type AnchorBox = { top: number; left: number; width: number; height: number };

const GAP = 8;
const MIN_CHAT_HEIGHT = 220;

// столбец чата: от поля ввода поднимаемся, пока блок растёт по высоте
function findChatColumn(): HTMLElement | null {
  const input = findChatInput();
  if (!input) return null;

  let best: HTMLElement | null = null;
  let node: HTMLElement | null = input.parentElement;

  for (let depth = 0; node && depth < 10; node = node.parentElement, depth += 1) {
    const rect = node.getBoundingClientRect();
    // столбец чата заметно выше поля ввода и не шире половины экрана
    if (rect.height > 260 && rect.width > 200 && rect.width < window.innerWidth * 0.6) {
      best = node;
    }
    // выше по дереву начинается общий контейнер страницы, дальше не идём
    if (rect.width > window.innerWidth * 0.7) break;
  }

  return best;
}

// у подрезанного чата надо уметь вернуть исходную высоту, а ещё помнить, какой
// она была: без этого каждый пересчёт мерил уже подрезанный чат и ужимал его
// снова — за несколько тиков переписка схлопывалась в полоску
let shrunk: {
  el: HTMLElement;
  height: string;
  minHeight: string;
  naturalHeight: number;
} | null = null;

function restoreChat(): void {
  if (!shrunk) return;
  shrunk.el.style.height = shrunk.height;
  shrunk.el.style.minHeight = shrunk.minHeight;
  shrunk = null;
}

// высота чата до наших правок
function naturalHeightOf(el: HTMLElement, rect: DOMRect): number {
  return shrunk?.el === el ? shrunk.naturalHeight : rect.height;
}

function shrinkChat(el: HTMLElement, height: number, naturalHeight: number): void {
  if (shrunk && shrunk.el !== el) restoreChat();
  if (!shrunk) {
    shrunk = { el, height: el.style.height, minHeight: el.style.minHeight, naturalHeight };
  }
  el.style.height = `${height}px`;
  el.style.minHeight = `${height}px`;
}

export type Layout = { box: AnchorBox; anchored: boolean };
export type Viewport = { width: number; height: number };

// свободная позиция: правый верх, как было до привязки
export function floatingBox(width: number, height: number, view: Viewport): AnchorBox {
  return {
    top: 76,
    left: Math.max(GAP, view.width - width - 20),
    width,
    height: Math.min(height, view.height - 110),
  };
}

/**
 * Геометрия без DOM: по прямоугольнику чата считает место для панели и новую
 * высоту чата. Вынесено отдельно, потому что это единственная часть привязки,
 * где легко ошибиться на пиксель, и её нужно уметь проверить тестом.
 */
export function placeBox(
  placement: Exclude<PanelPlacement, 'floating'>,
  chat: AnchorBox,
  width: number,
  height: number,
  view: Viewport,
): { box: AnchorBox; chatHeight: number | null } {
  if (placement === 'chat-left') {
    const panelWidth = Math.min(width, chat.left - GAP * 2);
    return {
      box: {
        top: chat.top,
        left: Math.max(GAP, chat.left - panelWidth - GAP),
        width: Math.max(240, panelWidth),
        height: Math.min(height, view.height - chat.top - GAP),
      },
      chatHeight: null,
    };
  }

  // chat-bottom: отдаём панели низ столбца, чат ужимаем на её высоту
  const available = chat.height - GAP;
  const panelHeight = Math.min(height, Math.max(160, available - MIN_CHAT_HEIGHT));
  const chatHeight = available - panelHeight;

  return {
    box: {
      top: chat.top + chatHeight + GAP,
      left: chat.left,
      width: chat.width,
      height: panelHeight,
    },
    chatHeight,
  };
}

/**
 * Считает место под панель и, если надо, освобождает его в чате.
 * Возвращает anchored=false, когда чат не найден — тогда панель висит свободно.
 */
export function computeLayout(placement: PanelPlacement, width: number, height: number): Layout {
  const view: Viewport = { width: window.innerWidth, height: window.innerHeight };

  const chat = placement === 'floating' ? null : findChatColumn();
  if (!chat) {
    restoreChat();
    return { box: floatingBox(width, height, view), anchored: false };
  }

  const rect = chat.getBoundingClientRect();
  // считаем всегда от исходной высоты, иначе расчёт съедает сам себя
  const natural = naturalHeightOf(chat, rect);
  const placed = placeBox(
    placement as Exclude<PanelPlacement, 'floating'>,
    { top: rect.top, left: rect.left, width: rect.width, height: natural },
    width,
    height,
    view,
  );

  if (placed.chatHeight === null) restoreChat();
  else shrinkChat(chat, placed.chatHeight, natural);

  return { box: placed.box, anchored: true };
}

export function releaseChat(): void {
  restoreChat();
}

/**
 * Пересчитывает раскладку при любых изменениях страницы.
 * Чат появляется не сразу и переезжает при ресайзе, поэтому одного замера мало.
 */
export function watchLayout(compute: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(compute);
  };

  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);

  const observer = new MutationObserver(schedule);
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  // страховка на случай, если чат перерисовался без мутаций в наблюдаемом поддереве
  const timer = window.setInterval(schedule, 2000);

  compute();

  return () => {
    cancelAnimationFrame(frame);
    window.clearInterval(timer);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    observer.disconnect();
    restoreChat();
  };
}
