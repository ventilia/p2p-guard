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
const MIN_PANEL_HEIGHT = 160;

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

/**
 * Правки чата надо уметь откатить, а ещё помнить его исходные размеры: без
 * этого каждый пересчёт мерил уже подрезанный чат и ужимал его снова — за
 * несколько тиков переписка схлопывалась в полоску.
 */
let sized: {
  el: HTMLElement;
  height: string;
  minHeight: string;
  width: string;
  natural: { width: number; height: number };
} | null = null;

function restoreChat(): void {
  if (!sized) return;
  sized.el.style.height = sized.height;
  sized.el.style.minHeight = sized.minHeight;
  sized.el.style.width = sized.width;
  sized = null;
}

// размеры чата до наших правок
function naturalOf(el: HTMLElement, rect: DOMRect): { width: number; height: number } {
  return sized?.el === el ? sized.natural : { width: rect.width, height: rect.height };
}

function remember(el: HTMLElement, natural: { width: number; height: number }): void {
  if (sized && sized.el !== el) restoreChat();
  if (sized) return;
  sized = {
    el,
    height: el.style.height,
    minHeight: el.style.minHeight,
    width: el.style.width,
    natural,
  };
}

function applyChatSize(
  el: HTMLElement,
  natural: { width: number; height: number },
  size: { width: number | null; height: number | null },
): void {
  if (size.width === null && size.height === null) {
    restoreChat();
    return;
  }
  remember(el, natural);

  if (size.height === null) {
    el.style.height = sized!.height;
    el.style.minHeight = sized!.minHeight;
  } else {
    el.style.height = `${size.height}px`;
    el.style.minHeight = `${size.height}px`;
  }

  el.style.width = size.width === null ? sized!.width : `${size.width}px`;
}

export type Layout = { box: AnchorBox; anchored: boolean };
export type Viewport = { width: number; height: number };

// пользовательские размеры чата, 0 означает «оставить как у биржи»
export type ChatSize = { width: number; height: number };

// свободная позиция: правый верх, как было до привязки
export function floatingBox(width: number, height: number, view: Viewport): AnchorBox {
  return {
    top: 76,
    left: Math.max(GAP, view.width - width - 20),
    width,
    height: Math.min(height, view.height - 110),
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Геометрия без DOM: по прямоугольнику чата считает место для панели и новые
 * размеры чата. Вынесено отдельно, потому что это единственная часть привязки,
 * где легко ошибиться на пиксель, и её нужно уметь проверить тестом.
 *
 * chat.width/height здесь — ИСХОДНЫЕ размеры столбца, до наших правок.
 */
export function placeBox(
  placement: Exclude<PanelPlacement, 'floating'>,
  chat: AnchorBox,
  panel: { width: number; height: number },
  chatSize: ChatSize,
  view: Viewport,
): { box: AnchorBox; chat: { width: number | null; height: number | null } } {
  // ширину чата задаём одинаково для обоих режимов, если её попросили
  const width =
    chatSize.width > 0
      ? clamp(chatSize.width, 260, Math.max(260, Math.round(view.width * 0.6)))
      : chat.width;
  const chatWidth = chatSize.width > 0 ? width : null;

  if (placement === 'chat-left') {
    // чат мог стать шире, левый край сдвигается вместе с ним
    const left = chat.left - (width - chat.width);
    const panelWidth = Math.min(panel.width, left - GAP * 2);
    return {
      box: {
        top: chat.top,
        left: Math.max(GAP, left - panelWidth - GAP),
        width: Math.max(240, panelWidth),
        height: Math.min(panel.height, view.height - chat.top - GAP),
      },
      chat: { width: chatWidth, height: chatSize.height > 0 ? chatSize.height : null },
    };
  }

  // chat-bottom: колонка делится между чатом и панелью
  const available = chat.height - GAP;
  const maxChat = available - MIN_PANEL_HEIGHT;

  // заданная высота чата главнее: её тянут ползунком и ждут точного результата
  const chatHeight =
    chatSize.height > 0
      ? clamp(chatSize.height, MIN_CHAT_HEIGHT, Math.max(MIN_CHAT_HEIGHT, maxChat))
      : available - Math.min(panel.height, Math.max(MIN_PANEL_HEIGHT, available - MIN_CHAT_HEIGHT));

  const panelHeight = available - chatHeight;

  return {
    box: {
      top: chat.top + chatHeight + GAP,
      left: chat.left + (chat.width - width),
      width,
      height: panelHeight,
    },
    chat: { width: chatWidth, height: chatHeight },
  };
}

/**
 * Считает место под панель и, если надо, меняет размеры чата.
 * Возвращает anchored=false, когда чат не найден — тогда панель висит свободно.
 */
export function computeLayout(
  placement: PanelPlacement,
  panel: { width: number; height: number },
  chatSize: ChatSize,
): Layout {
  const view: Viewport = { width: window.innerWidth, height: window.innerHeight };

  const chat = placement === 'floating' ? null : findChatColumn();
  if (!chat) {
    restoreChat();
    return { box: floatingBox(panel.width, panel.height, view), anchored: false };
  }

  const rect = chat.getBoundingClientRect();
  // считаем всегда от исходных размеров, иначе расчёт съедает сам себя
  const natural = naturalOf(chat, rect);

  const placed = placeBox(
    placement as Exclude<PanelPlacement, 'floating'>,
    { top: rect.top, left: rect.left, width: natural.width, height: natural.height },
    panel,
    chatSize,
    view,
  );

  applyChatSize(chat, natural, placed.chat);

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
