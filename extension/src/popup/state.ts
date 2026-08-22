// Chrome убивает попап при закрытии, поэтому выбранную вкладку держим
// в storage.session — на сеанс браузера

const KEY = 'pg.popup.state';

// попап держит только самое частое, разбор досье живёт в панели ордера
export type PopupTab = 'review' | 'team' | 'settings';

export type PopupState = { tab: PopupTab };

const EMPTY: PopupState = { tab: 'review' };

const TABS: PopupTab[] = ['review', 'team', 'settings'];

export async function loadPopupState(): Promise<PopupState> {
  try {
    const stored = await chrome.storage.session.get(KEY);
    const saved = stored[KEY] as Partial<PopupState> | undefined;
    // вкладку проверяем: в session мог остаться ключ от прошлой версии
    return saved?.tab && TABS.includes(saved.tab) ? { tab: saved.tab } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function savePopupState(patch: Partial<PopupState>): void {
  // не ждём результата: попап может закрыться в любой момент
  void chrome.storage.session.set({ [KEY]: { ...EMPTY, ...patch } }).catch(() => undefined);
}

export async function clearPopupState(): Promise<void> {
  try {
    await chrome.storage.session.remove(KEY);
  } catch {
    // не критично
  }
}
