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

export type Viewport = { width: number; height: number };

/**
 * Правки чата надо уметь откатить, а ещё помнить размеры ДО них: иначе каждый
 * пересчёт мерил уже подрезанный чат и ужимал его снова — за несколько тиков
 * переписка схлопывалась в полоску.
 *
 * Размеры окна храним рядом: после ресайза исходная высота столбца другая, и
 * старый замер отправлял бы панель за пределы экрана.
 */
let sized: {
  el: HTMLElement;
  css: { width: string; height: string; minHeight: string };
  natural: { width: number; height: number };
  view: Viewport;
} | null = null;

function restoreChat(): void {
  if (!sized) return;
  sized.el.style.width = sized.css.width;
  sized.el.style.height = sized.css.height;
  sized.el.style.minHeight = sized.css.minHeight;
  sized = null;
}

export function releaseChat(): void {
  restoreChat();
}

const sameView = (a: Viewport, b: Viewport) => a.width === b.width && a.height === b.height;

/**
 * Задаёт чату размеры и возвращает его исходные габариты.
 * Если что-то из размеров null — эта сторона остаётся такой, какой её сделала биржа.
 */
function applyChatSize(
  el: HTMLElement,
  view: Viewport,
  size: { width: number | null; height: number | null },
  natural: { width: number; height: number },
): void {
  if (size.width === null && size.height === null) {
    restoreChat();
    return;
  }

  // measureNatural к этому моменту уже откатил чужие правки, если они были
  if (!sized) {
    sized = {
      el,
      css: { width: el.style.width, height: el.style.height, minHeight: el.style.minHeight },
      natural,
      view,
    };
  }

  el.style.width = size.width === null ? sized.css.width : `${size.width}px`;

  if (size.height === null) {
    el.style.height = sized.css.height;
    el.style.minHeight = sized.css.minHeight;
  } else {
    el.style.height = `${size.height}px`;
    el.style.minHeight = `${size.height}px`;
  }
}

/**
 * Габариты столбца без наших правок.
 * Если правки уже наложены и окно с тех пор не менялось — берём запомненные,
 * иначе откатываем стили и меряем заново.
 */
function measureNatural(el: HTMLElement, view: Viewport): { width: number; height: number } {
  if (sized && sized.el === el && sameView(sized.view, view)) return sized.natural;

  // другой элемент или другое окно — прежний замер недействителен
  restoreChat();
  const rect = el.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// пользовательские размеры чата, 0 означает «оставить как у биржи»
export type ChatSize = { width: number; height: number };

export type Plan = {
  // что задать столбцу чата; null — не трогать эту сторону
  chat: { width: number | null; height: number | null };
  // какого размера получится панель
  panel: { width: number; height: number };
};

/**
 * Геометрия без DOM: по исходным габаритам столбца решает, каким сделать чат и
 * какого размера будет панель. Позицию здесь НЕ считаем — её берём с живого
 * элемента уже после того, как размеры применены, иначе приходится угадывать,
 * в какую сторону поедет край столбца, и панель разъезжается с чатом.
 */
export function planLayout(
  placement: Exclude<PanelPlacement, 'floating'>,
  natural: { width: number; height: number },
  panel: { width: number; height: number },
  chatSize: ChatSize,
  view: Viewport,
): Plan {
  const maxWidth = Math.max(260, Math.round(view.width * 0.6));
  const width = chatSize.width > 0 ? clamp(chatSize.width, 260, maxWidth) : null;

  if (placement === 'chat-left') {
    // чат не делим, но выше своей колонки он не нужен: столбец начинается не от
    // нуля, поэтому мерить по высоте окна нельзя — вылезет за нижний край
    const maxHeight = Math.max(MIN_CHAT_HEIGHT, natural.height);
    return {
      chat: {
        width,
        height: chatSize.height > 0 ? clamp(chatSize.height, MIN_CHAT_HEIGHT, maxHeight) : null,
      },
      panel: {
        width: panel.width,
        height: Math.min(panel.height, view.height - GAP * 2),
      },
    };
  }

  // chat-bottom: столбец делится между перепиской и панелью
  const available = natural.height - GAP;
  const maxChat = Math.max(MIN_CHAT_HEIGHT, available - MIN_PANEL_HEIGHT);

  // заданная высота чата главнее: её тянут ползунком и ждут точного результата
  const chatHeight =
    chatSize.height > 0
      ? clamp(chatSize.height, MIN_CHAT_HEIGHT, maxChat)
      : clamp(available - panel.height, MIN_CHAT_HEIGHT, maxChat);

  return {
    chat: { width, height: chatHeight },
    panel: { width: width ?? natural.width, height: available - chatHeight },
  };
}

/**
 * Позиция панели относительно ЖИВОГО прямоугольника чата.
 * rect читается после применения размеров, поэтому гадать, куда уехал край
 * столбца при смене ширины, не нужно.
 */
export function panelPosition(
  placement: Exclude<PanelPlacement, 'floating'>,
  rect: AnchorBox,
  panel: { width: number; height: number },
  view: Viewport,
): AnchorBox {
  if (placement === 'chat-left') {
    const width = Math.max(240, Math.min(panel.width, rect.left - GAP * 2));
    return {
      top: rect.top,
      left: Math.max(GAP, rect.left - width - GAP),
      width,
      height: Math.min(panel.height, view.height - rect.top - GAP),
    };
  }

  return {
    top: rect.top + rect.height + GAP,
    left: rect.left,
    width: rect.width,
    height: panel.height,
  };
}

// свободная позиция: правый верх, как было до привязки
export function floatingBox(width: number, height: number, view: Viewport): AnchorBox {
  return {
    top: 76,
    left: Math.max(GAP, view.width - width - 20),
    width,
    height: Math.min(height, view.height - 110),
  };
}

export type Layout = { box: AnchorBox; anchored: boolean };

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

  const kind = placement as Exclude<PanelPlacement, 'floating'>;
  const natural = measureNatural(chat, view);
  const plan = planLayout(kind, natural, panel, chatSize, view);

  applyChatSize(chat, view, plan.chat, natural);

  // меряем уже изменённый столбец: его край мог уехать от смены ширины
  const rect = chat.getBoundingClientRect();
  const box = panelPosition(
    kind,
    { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    plan.panel,
    view,
  );

  return { box, anchored: true };
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
