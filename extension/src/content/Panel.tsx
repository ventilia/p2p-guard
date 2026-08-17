import { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from '../shared/messages.js';
import {
  IconAlert,
  IconMinimize,
  IconMoon,
  IconRefresh,
  LogoMark,
  IconSun,
} from '../shared/icons.js';
import { DossierView, type DossierActions } from '../ui/dossier.js';
import type { PanelState, Settings } from '../shared/types.js';

// единая точка вызова background с обработкой ответа-состояния
function usePanelAction(applyState: (state: PanelState) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (request: Parameters<typeof sendMessage>[0]) => {
      setBusy(true);
      setError(null);
      const response = await sendMessage<PanelState | null>(request);
      setBusy(false);

      if (!response.ok) {
        setError(response.error.message);
        return false;
      }
      if (response.data && typeof response.data === 'object' && 'status' in response.data) {
        applyState(response.data);
      }
      return true;
    },
    [applyState],
  );

  return { run, busy, error, setError };
}

// запасной ввод, если контрагент не определился сам
function ManualLookup({ busy, onLookup }: { busy: boolean; onLookup: (uid: string) => void }) {
  const [uid, setUid] = useState('');

  return (
    <div className="card">
      <div className="card-title">Указать контрагента вручную</div>
      <input
        value={uid}
        placeholder="UID контрагента с Binance"
        onChange={(e) => setUid(e.target.value.trim())}
      />
      <div className="actions" style={{ marginTop: 7 }}>
        <button className="btn primary" disabled={busy || uid.length < 4} onClick={() => onLookup(uid)}>
          Показать досье
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        UID виден в ссылке на профиль контрагента на странице объявления (advertiserNo).
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  intercept: 'данные ордера',
  api: 'запрос к Binance',
  dom: 'разбор страницы',
  manual: 'UID указан вручную',
};

export function Panel() {
  const [state, setState] = useState<PanelState>({ status: 'idle' });
  const [theme, setTheme] = useState<Settings['theme']>('light');
  const [collapsed, setCollapsed] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const applyState = useCallback((next: PanelState) => setState(next), []);
  const { run, busy, error, setError } = usePanelAction(applyState);

  // подписка на пуши background и запрос состояния при монтировании
  useEffect(() => {
    let alive = true;

    const listener = (message: { type?: string; state?: PanelState; settings?: Settings }) => {
      if (message?.type === 'PANEL_STATE' && message.state) setState(message.state);
      // тему меняют из попапа, панель перекрашивается без перезагрузки
      if (message?.type === 'SETTINGS_CHANGED' && message.settings?.theme) {
        setTheme(message.settings.theme);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    void sendMessage<PanelState>({ type: 'GET_PANEL_STATE' }).then((response) => {
      if (alive && response.ok && response.data) setState(response.data);
    });
    void sendMessage<Settings>({ type: 'GET_SETTINGS' }).then((response) => {
      if (alive && response.ok && response.data?.theme) setTheme(response.data.theme);
    });

    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // перетаскивание за шапку
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setOffset({
        x: drag.baseX + (e.clientX - drag.startX),
        y: drag.baseY + (e.clientY - drag.startY),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };

  const toggleTheme = () => {
    const next: Settings['theme'] = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    void sendMessage({ type: 'SET_SETTINGS', patch: { theme: next } });
  };

  if (state.status === 'idle') return null;

  const transform = `translate(${offset.x}px, ${offset.y}px)`;
  const ready = state.status === 'ready' ? state : null;

  if (collapsed) {
    const level = ready?.dossier.risk.level ?? null;
    return (
      <button
        className="fab"
        data-theme={theme}
        style={{ transform }}
        onClick={() => setCollapsed(false)}
        title="P2P Guard"
      >
        <LogoMark size={26} />
        {level ? <span className={`fab-dot ${level}`} /> : null}
      </button>
    );
  }

  const dossier = ready?.dossier ?? null;

  const actions: DossierActions = {
    busy,
    isAdmin: ready?.role === 'ADMIN',
    hasTeam: ready?.hasTeam ?? false,
    onReview: (rating, tag, text) =>
      dossier &&
      void run({ type: 'SUBMIT_REVIEW', counterpartyId: dossier.counterparty.id, rating, tag, text }),
    onDeleteReview: (reviewId) => void run({ type: 'DELETE_REVIEW', reviewId }),
    onTeamNote: (text) =>
      dossier && void run({ type: 'SAVE_TEAM_NOTE', counterpartyId: dossier.counterparty.id, text }),
    onBlacklist: (reason, severity, scope) =>
      dossier &&
      void run({
        type: 'ADD_BLACKLIST',
        counterpartyId: dossier.counterparty.id,
        reason,
        severity,
        scope,
      }),
    onRevokeBlacklist: (entryId) => void run({ type: 'REVOKE_BLACKLIST', entryId }),
  };

  return (
    <div className="root" data-theme={theme} style={{ transform }}>
      <div className="header" onMouseDown={startDrag}>
        <LogoMark size={26} />
        <div>
          <div className="title">P2P Guard</div>
          {ready ? <div className="subtitle">источник: {SOURCE_LABEL[ready.source]}</div> : null}
        </div>
        <div className="spacer" />
        <button className="icon-btn" title="Сменить тему" onClick={toggleTheme}>
          {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>
        {ready ? (
          <button
            className="icon-btn"
            title="Обновить"
            disabled={busy}
            onClick={() => void run({ type: 'REFRESH_DOSSIER' })}
          >
            <IconRefresh size={15} />
          </button>
        ) : null}
        <button className="icon-btn" title="Свернуть" onClick={() => setCollapsed(true)}>
          <IconMinimize size={15} />
        </button>
      </div>

      <div className="body">
        {error ? (
          <div className="alert bad" onClick={() => setError(null)}>
            <IconAlert size={15} />
            <span>{error}</span>
          </div>
        ) : null}

        {state.status === 'loading' ? (
          <div className="center">
            <div className="spinner" />
            <div className="muted">Собираем досье…</div>
          </div>
        ) : null}

        {state.status === 'unauthorized' ? (
          <div className="center">
            <div className="muted">{state.message}</div>
            <div className="hint">Откройте значок расширения и войдите</div>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <>
            <div className="alert bad">
              <IconAlert size={15} />
              <span>{state.message}</span>
            </div>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => void run({ type: 'REFRESH_DOSSIER' })}>
                Повторить
              </button>
            </div>
            {state.canRetryManually ? (
              <ManualLookup busy={busy} onLookup={(uid) => void run({ type: 'MANUAL_LOOKUP', uid })} />
            ) : null}
          </>
        ) : null}

        {ready?.requisiteAlert ? (
          <div className="alert">
            <IconAlert size={15} />
            <span>
              В чате появился новый реквизит <b>{ready.requisiteAlert.mask}</b>. Платите только по
              данным из ордера.
            </span>
          </div>
        ) : null}

        {dossier ? <DossierView dossier={dossier} actions={actions} templates={ready?.templates} /> : null}
      </div>
    </div>
  );
}
