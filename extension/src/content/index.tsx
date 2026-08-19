// монтирует панель в Shadow DOM и пересылает перехваченное в background
// в наш API отсюда не ходим, иначе токен окажется в контексте страницы биржи
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './Panel.js';
import { panelStyles } from './styles.js';
import { sendMessage } from '../shared/messages.js';
import {
  onProfilePage,
  openReviewsTab,
  profileUserNo,
  scrapeCounterpartyStats,
  scrapeExchangeReviews,
} from './statsScrape.js';
import type { DomSnapshot } from '../shared/types.js';

const HOST_ID = 'p2p-guard-root';
const CHANNEL = 'p2p-guard';

// хук должен встать до первых запросов страницы, поэтому синхронно и в начало
function injectPageHook(): void {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-hook.js');
    script.async = false;
    script.onload = () => script.remove();
    (document.head ?? document.documentElement).prepend(script);
  } catch (err) {
    console.warn('[P2P Guard] не удалось внедрить хук страницы', err);
  }
}

function mountPanel(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  // URL шрифта берём в рантайме: относительный путь ушёл бы на домен биржи
  style.textContent = panelStyles(chrome.runtime.getURL('fonts/IBMPlexSans.ttf'));
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);

  createRoot(container).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}

// ───────────────────────────── Мост со страницей ─────────────────────────────

function listenPageMessages(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as
      | { source?: string; type?: string; payload?: unknown }
      | null;
    if (!data || data.source !== CHANNEL) return;

    switch (data.type) {
      case 'WS_INTERCEPT':
        void sendMessage({ type: 'WS_MESSAGE', payload: data.payload });
        break;

      case 'NET_CAPTURE': {
        const capture = data.payload as {
          url: string;
          method: string;
          headers: Record<string, string>;
          requestBody: unknown;
          responseBody: unknown;
        };
        void sendMessage({
          type: 'NET_CAPTURE',
          url: capture.url,
          method: capture.method,
          headers: capture.headers ?? {},
          requestBody: capture.requestBody ?? null,
          responseBody: capture.responseBody ?? null,
        });
        break;
      }

      case 'URL_CHANGED': {
        const orderId = orderIdFromUrl(location.href);
        if (orderId) void sendMessage({ type: 'DETECT_ORDER', orderId });
        scheduleScrape();
        break;
      }

      default:
        break;
    }
  });
}

const orderIdFromUrl = (url: string): string | null =>
  /(?:orderNo|orderNumber|adOrderNo|orderId)=(\d{6,32})/i.exec(url)?.[1] ??
  /\/(\d{15,32})(?:\/|$|\?)/.exec(url)?.[1] ??
  null;

// ───────────────────────────── Запасной разбор DOM ─────────────────────────────

// если API недоступен, ник и UID всё равно есть в ссылке на профиль
function scrapeDom(): DomSnapshot | null {
  const snapshot: DomSnapshot = {};

  const orderId = orderIdFromUrl(location.href);
  if (orderId) snapshot.orderId = orderId;

  const profileLink = document.querySelector<HTMLAnchorElement>(
    'a[href*="advertiserNo="], a[href*="userNo="], a[href*="advertiserDetail"]',
  );
  if (profileLink) {
    const uid =
      /(?:advertiserNo|userNo)=([A-Za-z0-9]{6,64})/.exec(profileLink.href)?.[1] ?? undefined;
    if (uid) snapshot.counterpartyUid = uid;

    const text = profileLink.textContent?.trim();
    if (text && text.length <= 64) snapshot.counterpartyNickname = text;
  }

  if (!snapshot.counterpartyUid) {
    // запасной вариант: «UID 421044135» где-нибудь в тексте
    const match = /UID[:\s]+([0-9]{6,20})/i.exec(document.body?.innerText?.slice(0, 20_000) ?? '');
    if (match?.[1]) snapshot.counterpartyUid = match[1];
  }

  // биржа рисует статистику контрагента рядом с чатом — читаем оттуда
  const stats = scrapeCounterpartyStats();
  if (stats) snapshot.stats = stats;

  return snapshot.counterpartyUid || snapshot.orderId || snapshot.stats ? snapshot : null;
}

// страница профиля открывается фоновой вкладкой ради недостающих полей:
// пользователь остаётся в ордере и ничего не замечает
function reportProfile(): void {
  const userNo = profileUserNo();
  if (!userNo) return;

  const stats = scrapeCounterpartyStats();
  if (!stats) return;

  void sendMessage({ type: 'PROFILE_STATS', userNo, stats, reviews: scrapeExchangeReviews() });
}

let scrapeTimer: number | undefined;
let lastScrapeJson = '';

function scheduleScrape(): void {
  window.clearTimeout(scrapeTimer);
  scrapeTimer = window.setTimeout(() => {
    const snapshot = scrapeDom();
    if (!snapshot) return;

    const json = JSON.stringify(snapshot);
    if (json === lastScrapeJson) return;
    lastScrapeJson = json;

    void sendMessage({ type: 'DOM_SNAPSHOT', snapshot });
  }, 800);
}

// профиль рисуется не сразу, поэтому пробуем несколько раз и умолкаем
function watchProfile(): void {
  let left = 14;
  let opened = false;

  const timer = window.setInterval(() => {
    left -= 1;
    const stats = scrapeCounterpartyStats();

    // цифры готовы — открываем вкладку отзывов и даём ей отрисоваться
    if (!opened && stats?.totalOrders !== undefined) {
      opened = true;
      if (openReviewsTab()) return;
    }

    if (opened || left <= 0) {
      window.clearInterval(timer);
      reportProfile();
    }
  }, 700);
}

// слушаем только добавление узлов и схлопываем всплеск в один разбор
function watchDom(): void {
  const observer = new MutationObserver(() => scheduleScrape());
  const target = document.body ?? document.documentElement;
  observer.observe(target, { childList: true, subtree: true });
  scheduleScrape();
}

injectPageHook();
listenPageMessages();

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      mountPanel();
      watchDom();
      if (onProfilePage()) watchProfile();
    },
    { once: true },
  );
} else {
  mountPanel();
  watchDom();
  if (onProfilePage()) watchProfile();
}
