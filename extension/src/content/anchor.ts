// место для панели на странице ордера
//
// Панель — САМОСТОЯТЕЛЬНЫЙ блок документа под чатом, а не накладка поверх него.
// Раньше она была fixed и ужимала переписку, чтобы влезть в её колонку: снаружи
// это читалось как часть чата, а на некоторых размерах разъезжалось. Теперь
// вёрстку биржи не трогаем вовсе — блок живёт в координатах документа, ниже
// чата, и прокручивается вместе со страницей.
//
// Чат ищем от поля ввода вверх: классы у биржи генерируемые, а поле ввода есть
// всегда.

import type { PanelPlacement } from '../shared/types.js';
import { findChatInput } from './chatInput.js';

export type AnchorBox = { top: number; left: number; width: number; height: number };
export type Viewport = { width: number; height: number };

const GAP = 12;
// панель не должна быть уже колонки чата: там нечего показывать
const MIN_WIDTH = 320;

// столбец чата: от поля ввода поднимаемся, пока блок растёт по высоте
function findChatColumn(): HTMLElement | null {
  const input = findChatInput();
  if (!input) return null;

  let best: HTMLElement | null = null;
  let node: HTMLElement | null = input.parentElement;

  for (let depth = 0; node && depth < 10; node = node.parentElement, depth += 1) {
    const rect = node.getBoundingClientRect();
    if (rect.height > 260 && rect.width > 200 && rect.width < window.innerWidth * 0.6) {
      best = node;
    }
    if (rect.width > window.innerWidth * 0.7) break;
  }

  return best;
}

/**
 * Координаты блока в документе, а не в окне.
 *
 * anchor — прямоугольник чата в координатах окна, scroll — текущая прокрутка.
 * Панель прижата правым краем к чату и растёт влево: колонка переписки узкая,
 * а слева на странице обычно пусто.
 */
export function documentBox(
  anchor: AnchorBox,
  panel: { width: number; height: number },
  scroll: { x: number; y: number },
  view: Viewport,
): AnchorBox {
  const right = anchor.left + anchor.width;
  const width = Math.min(Math.max(panel.width, anchor.width, MIN_WIDTH), right - GAP);

  return {
    top: anchor.top + anchor.height + GAP + scroll.y,
    left: Math.max(GAP, right - width) + scroll.x,
    width,
    height: panel.height,
  };
}

// свободное размещение: правый верх окна, панель никуда не привязана
export function floatingBox(width: number, height: number, view: Viewport): AnchorBox {
  return {
    top: 76,
    left: Math.max(GAP, view.width - width - 20),
    width,
    height: Math.min(height, view.height - 110),
  };
}

export type Layout = {
  box: AnchorBox;
  // absolute — блок в потоке документа, fixed — накладка поверх окна
  position: 'absolute' | 'fixed';
};

export function computeLayout(
  placement: PanelPlacement,
  panel: { width: number; height: number },
): Layout {
  const view: Viewport = { width: window.innerWidth, height: window.innerHeight };

  const chat = placement === 'floating' ? null : findChatColumn();
  if (!chat) {
    return { box: floatingBox(panel.width, panel.height, view), position: 'fixed' };
  }

  const rect = chat.getBoundingClientRect();
  const scroll = { x: window.scrollX, y: window.scrollY };

  return {
    box: documentBox(
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      panel,
      scroll,
      view,
    ),
    position: 'absolute',
  };
}

/**
 * Пересчитывает раскладку при изменениях страницы.
 * Чат появляется не сразу и переезжает при ресайзе, поэтому одного замера мало.
 */
export function watchLayout(compute: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(compute);
  };

  window.addEventListener('resize', schedule);
  // блок в координатах документа: при прокрутке пересчёт не нужен, но чат
  // фиксированный и его top меняется вместе с ней
  window.addEventListener('scroll', schedule, true);

  const observer = new MutationObserver(schedule);
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  const timer = window.setInterval(schedule, 2000);

  compute();

  return () => {
    cancelAnimationFrame(frame);
    window.clearInterval(timer);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    observer.disconnect();
  };
}
