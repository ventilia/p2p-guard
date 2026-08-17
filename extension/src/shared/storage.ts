import type { Session, Settings } from './types.js';

const KEYS = {
  session: 'pg.session',
  settings: 'pg.settings',
  lastSync: 'pg.lastOrderSync',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: 'http://localhost:4000/v1',
  // выключено намеренно: на страницу биржи не лезем без разрешения
  panelEnabled: false,
  autoSyncOrders: true,
  captureChatRequisites: true,
  theme: 'light',
};

export async function getSession(): Promise<Session | null> {
  const data = await chrome.storage.local.get(KEYS.session);
  return (data[KEYS.session] as Session | undefined) ?? null;
}

export async function setSession(session: Session | null): Promise<void> {
  if (session) await chrome.storage.local.set({ [KEYS.session]: session });
  else await chrome.storage.local.remove(KEYS.session);
}

export async function getSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...((data[KEYS.settings] as Partial<Settings>) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function getLastOrderSync(): Promise<number> {
  const data = await chrome.storage.local.get(KEYS.lastSync);
  return (data[KEYS.lastSync] as number | undefined) ?? 0;
}

export async function setLastOrderSync(ts: number): Promise<void> {
  await chrome.storage.local.set({ [KEYS.lastSync]: ts });
}
