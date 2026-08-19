// профиль контрагента, пока пользователь остаётся в ордере: половины полей на
// странице ордера нет, а прямой запрос биржа отбивает антифродом
// открываем профиль неактивной вкладкой, читаем и сразу закрываем

import type { ExchangeAd, ExchangeReview, ExchangeStats } from '../shared/types.js';

const PROFILE_URL = 'https://c2c.binance.com/ru/advertiserDetail?advertiserNo=';

// профиль меняется медленно, а лишняя вкладка заметна — ходим редко
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = 'pg.profileCache';
// вкладка фоновая: React грузит профиль не мгновенно, а таймеры в ней Chrome
// притормаживает. Пятнадцати секунд не хватало, и вкладку закрывали пустой
const WAIT_MS = 90_000;

type CacheEntry = {
  at: number;
  stats: ExchangeStats;
  reviews?: ExchangeReview[];
  ads?: ExchangeAd[];
};
type Cache = Record<string, CacheEntry>;

// чтобы не открыть две вкладки на одного контрагента
const inFlight = new Set<string>();
// вкладки, открытые нами: их закрываем, чужие не трогаем
const ourTabs = new Set<number>();

async function readCache(): Promise<Cache> {
  try {
    const stored = await chrome.storage.local.get(CACHE_KEY);
    return (stored[CACHE_KEY] as Cache | undefined) ?? {};
  } catch {
    return {};
  }
}

async function writeCache(
  userNo: string,
  stats: ExchangeStats,
  reviews?: ExchangeReview[],
  ads?: ExchangeAd[],
): Promise<void> {
  try {
    const cache = await readCache();
    cache[userNo] = { at: Date.now(), stats, reviews, ads };

    // не копим бесконечно: держим последние два десятка
    const fresh = Object.entries(cache)
      .filter(([, e]) => Date.now() - e.at < CACHE_TTL_MS)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 20);

    await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(fresh) });
  } catch {
    // кэш не критичен
  }
}

// контент-скрипт прочитал профиль и прислал цифры
export async function acceptProfileStats(
  userNo: string,
  stats: ExchangeStats,
  reviews?: ExchangeReview[],
  ads?: ExchangeAd[],
  tabId?: number,
): Promise<void> {
  await writeCache(userNo, stats, reviews, ads);
  inFlight.delete(userNo);

  if (tabId !== undefined && ourTabs.has(tabId)) {
    ourTabs.delete(tabId);
    chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

// готовые данные профиля, если ходили за ними недавно
export async function readProfileStats(userNo: string): Promise<CacheEntry | null> {
  const cache = await readCache();
  const hit = cache[userNo];
  return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit : null;
}

// открывает профиль фоновой вкладкой и уходит
export async function startProfileProbe(userNo: string): Promise<void> {
  if (inFlight.has(userNo)) return;
  if (await readProfileStats(userNo)) return;

  inFlight.add(userNo);

  try {
    const tab = await chrome.tabs.create({
      url: PROFILE_URL + encodeURIComponent(userNo),
      active: false,
    });
    if (tab.id !== undefined) ourTabs.add(tab.id);
  } catch (err) {
    console.warn('[P2P Guard] не удалось открыть профиль контрагента', err);
    inFlight.delete(userNo);
    return;
  }

  // страница может не отчитаться: вкладку всё равно надо убрать
  setTimeout(() => {
    if (!inFlight.has(userNo)) return;
    inFlight.delete(userNo);
    closeOurTabs();
  }, WAIT_MS);
}

function closeOurTabs(): void {
  for (const tabId of [...ourTabs]) {
    ourTabs.delete(tabId);
    chrome.tabs.remove(tabId).catch(() => undefined);
  }
}
