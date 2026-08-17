// Chrome убивает попап при закрытии вместе со всем React-стейтом
// поэтому вкладку, запрос и досье держим в storage.session — кэш на сеанс
import type { Dossier } from '../shared/types.js';

const KEY = 'pg.popup.state';

// попап держит только самое частое: оценить контрагента и настройки
// разбор досье, команда и шаблоны живут в панели ордера
export type PopupTab = 'review' | 'settings';

export type PopupState = {
  tab: PopupTab;
  query: string;
  dossier: Dossier | null;
  savedAt: number;
};

const EMPTY: PopupState = { tab: 'review', query: '', dossier: null, savedAt: 0 };

// полчаса: дальше показывать «как было» уже вводит в заблуждение
const MAX_AGE_MS = 30 * 60_000;

export async function loadPopupState(): Promise<PopupState> {
  try {
    const stored = await chrome.storage.session.get(KEY);
    const saved = stored[KEY] as PopupState | undefined;
    if (!saved) return EMPTY;
    if (Date.now() - saved.savedAt > MAX_AGE_MS) return { ...EMPTY, tab: saved.tab };
    return { ...EMPTY, ...saved };
  } catch {
    return EMPTY;
  }
}

// записи выстраиваем в очередь: без этого два быстрых вызова читают одно и то же
// состояние и второй затирает патч первого
let writeQueue: Promise<void> = Promise.resolve();

export function savePopupState(patch: Partial<Omit<PopupState, 'savedAt'>>): void {
  // не ждём результата: попап может закрыться в любой момент
  writeQueue = writeQueue.then(async () => {
    try {
      const current = await loadPopupState();
      await chrome.storage.session.set({
        [KEY]: { ...current, ...patch, savedAt: Date.now() },
      });
    } catch {
      // не критично, просто не восстановимся
    }
  });
}

export async function clearPopupState(): Promise<void> {
  try {
    await chrome.storage.session.remove(KEY);
  } catch {
    // не критично
  }
}
