// место для панели: обычный блок в колонке ордера, прокручивается со страницей
// в полосу чата не заходим — столбец переписки прибит к окну, и блок проходил
// бы сквозь него при прокрутке

import { findChatInput } from './chatInput.js';

export type Viewport = { width: number; height: number };

export const HOST_ID = 'p2p-guard-root';

const GAP = 16;
const MIN_WIDTH = 320;

// столбец чата: от поля ввода поднимаемся, пока блок растёт по высоте
export function findChatColumn(): HTMLElement | null {
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

// колонка с содержимым ордера — соседка чата, которая занимает место в потоке
export function findFlowColumn(chat: HTMLElement): HTMLElement | null {
  let row: HTMLElement | null = chat.parentElement;

  for (let depth = 0; row && depth < 8; row = row.parentElement, depth += 1) {
    if (row.getBoundingClientRect().width < window.innerWidth * 0.5) continue;

    const candidates = Array.from(row.children).filter((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement)) return false;
      if (child.contains(chat) || child.id === HOST_ID) return false;
      return getComputedStyle(child).position !== 'fixed';
    });

    const widest = candidates.sort(
      (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width,
    )[0];

    if (widest && widest.getBoundingClientRect().width > 300) return widest;
  }

  return null;
}

// ширина блока
export function flowWidth(
  column: { left: number; width: number },
  chatLeft: number,
  wanted: number,
  view: Viewport,
): number {
  // два предела сразу: за свою колонку не вылезаем, иначе блок подрежут,
  // и до полосы чата не доходим, иначе они встретятся при прокрутке
  const untilChat = (chatLeft || view.width) - column.left - GAP;
  const limit = Math.max(MIN_WIDTH, Math.min(column.width, untilChat));

  return Math.round(Math.min(Math.max(wanted, MIN_WIDTH), limit));
}

// свободное размещение: накладка в правом верхнем углу окна
export function floatingBox(width: number, height: number, view: Viewport) {
  return {
    top: 76,
    left: Math.max(GAP, view.width - width - 20),
    width,
    height: Math.min(height, view.height - 110),
  };
}

export type Layout =
  | { mode: 'flow'; maxHeight: number }
  | { mode: 'floating'; box: ReturnType<typeof floatingBox> };

function detachHost(host: HTMLElement): void {
  host.style.width = '';
  host.style.marginTop = '';
  host.style.flex = '';
  if (host.parentElement !== document.documentElement) {
    document.documentElement.appendChild(host);
  }
}

export function computeLayout(
  placement: 'chat-bottom' | 'floating',
  panel: { width: number; height: number },
): Layout {
  const view: Viewport = { width: window.innerWidth, height: window.innerHeight };
  const host = document.getElementById(HOST_ID);

  const chat = placement === 'floating' ? null : findChatColumn();
  const column = chat ? findFlowColumn(chat) : null;

  if (!chat || !column || !host) {
    if (host) detachHost(host);
    return { mode: 'floating', box: floatingBox(panel.width, panel.height, view) };
  }

  // host — последний блок колонки ордера, дальше раскладывает браузер
  if (host.parentElement !== column) column.appendChild(host);

  // родитель у биржи бывает флексовым: без запрета сжатия ширину урежут
  host.style.flex = '0 0 auto';
  host.style.marginTop = `${GAP}px`;

  // меряем без своей ширины: так видно, где блок реально начинается внутри
  // колонки. По внешнему краю колонки считать нельзя — её отступы сдвигают
  // содержимое, и панель залезала в полосу чата
  host.style.width = '';
  const natural = host.getBoundingClientRect();

  const width = flowWidth(
    { left: natural.left, width: natural.width },
    chat.getBoundingClientRect().left,
    panel.width,
    view,
  );
  host.style.width = `${width}px`;

  return { mode: 'flow', maxHeight: panel.height };
}

// пересчитывает раскладку при изменениях страницы
export function watchLayout(compute: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(compute);
  };

  window.addEventListener('resize', schedule);

  const observer = new MutationObserver(schedule);
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  const timer = window.setInterval(schedule, 2000);

  compute();

  return () => {
    cancelAnimationFrame(frame);
    window.clearInterval(timer);
    window.removeEventListener('resize', schedule);
    observer.disconnect();
  };
}
