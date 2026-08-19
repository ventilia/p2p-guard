// место для панели на странице ордера
//
// Панель встраивается В ВЁРСТКУ биржи обычным блоком, а не висит поверх неё.
// Считать координаты нельзя: столбец чата у Binance position:fixed, в потоке
// места не занимает, и его top при прокрутке не меняется. Любая позиция,
// посчитанная от него и сложенная с прокруткой, убегает вниз вместе со
// страницей — панель мелькала и пропадала. Поэтому мы отдаём раскладку
// браузеру: вставляем host в поточного родителя чата и лишь сдвигаем
// отступами.
//
// Чат ищем от поля ввода вверх: классы у биржи генерируемые, поле ввода есть
// всегда.

import { findChatInput } from './chatInput.js';

export type Viewport = { width: number; height: number };

const GAP = 12;
// уже колонки чата панель делать незачем: там нечего показывать
const MIN_WIDTH = 320;

/** Столбец чата: от поля ввода поднимаемся, пока блок растёт по высоте. */
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

export const HOST_ID = 'p2p-guard-root';

/**
 * Переносит host в вёрстку биржи или обратно в корень документа.
 *
 * В потоке блок раскладывает браузер: координаты считать не нужно и панель не
 * убегает при прокрутке. Пока чат не найден, host висит в корне и панель
 * работает накладкой.
 */
export function moveHost(intoPage: boolean): void {
  const host = document.getElementById(HOST_ID);
  if (!host) return;

  const target = intoPage ? findHostParent() : document.documentElement;
  if (!target || host.parentElement === target) return;

  target.appendChild(host);
}

/**
 * Куда встраивать блок.
 *
 * Поточный родитель фиксированного чата: сам чат места не занимает, поэтому
 * наш блок встаёт в начало его ячейки, а вниз мы его опускаем отступом.
 */
export function findHostParent(): HTMLElement | null {
  return findChatColumn()?.parentElement ?? null;
}

export type FlowStyle = {
  width: number;
  marginTop: number;
  // отрицательный, когда панель шире колонки: так она уходит влево
  marginLeft: number;
  maxHeight: number;
};

/**
 * Отступы для блока в потоке.
 *
 * Правый край держим на правом крае чата, влево растём на свободное место
 * страницы. Верхний отступ равен высоте чата — так блок оказывается точно
 * под перепиской и дальше живёт по обычным правилам вёрстки.
 */
export function flowStyle(
  chat: { width: number; height: number },
  panel: { width: number; height: number },
  view: Viewport,
): FlowStyle {
  const width = Math.min(
    Math.max(panel.width, chat.width, MIN_WIDTH),
    Math.max(chat.width, view.width - GAP * 2),
  );

  return {
    width,
    marginTop: chat.height + GAP,
    marginLeft: chat.width - width,
    maxHeight: panel.height,
  };
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

/**
 * Применяет размеры к host и выравнивает его правый край по чату.
 *
 * Где именно окажется блок, посчитать нельзя: чат у биржи position:fixed, в
 * потоке его нет, и наш блок садится следом за колонкой ордера. Поэтому
 * ставим отступ в ноль, меряем, куда он встал, и одним шагом сдвигаем влево.
 * Замер не зависит от прокрутки, поэтому повторов и дрожания не будет.
 */
function applyFlowToHost(host: HTMLElement, chat: DOMRect, style: FlowStyle): void {
  // родитель у биржи флексовый: без запрета сжатия ширину урежут
  host.style.flex = '0 0 auto';
  host.style.width = `${style.width}px`;
  host.style.marginTop = `${style.marginTop}px`;
  host.style.marginLeft = '0px';

  const natural = host.getBoundingClientRect();
  const shift = Math.round(chat.right - (natural.left + style.width));

  // правый край чата заведомо внутри окна, поэтому сдвиг безопасен в обе стороны
  host.style.marginLeft = `${shift}px`;
}

function resetHost(host: HTMLElement): void {
  host.style.flex = '';
  host.style.width = '';
  host.style.marginTop = '';
  host.style.marginLeft = '';
}

export function computeLayout(
  placement: 'chat-bottom' | 'floating',
  panel: { width: number; height: number },
): Layout {
  const view: Viewport = { width: window.innerWidth, height: window.innerHeight };
  const host = document.getElementById(HOST_ID);

  const chat = placement === 'floating' ? null : findChatColumn();
  if (!chat) {
    if (host) resetHost(host);
    return { mode: 'floating', box: floatingBox(panel.width, panel.height, view) };
  }

  const rect = chat.getBoundingClientRect();
  const style = flowStyle({ width: rect.width, height: rect.height }, panel, view);
  if (host) applyFlowToHost(host, rect, style);

  return { mode: 'flow', maxHeight: style.maxHeight };
}

/**
 * Пересчитывает раскладку при изменениях страницы.
 * Чат появляется не сразу и меняет размеры при ресайзе, поэтому одного замера
 * мало. За прокруткой следить не нужно: блок в потоке едет сам.
 */
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
