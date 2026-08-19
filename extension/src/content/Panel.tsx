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
import { insertIntoChat } from './chatInput.js';
import { computeLayout, moveHost, watchLayout, type Layout } from './anchor.js';
import { detectPageTheme, watchPageTheme, type PageTheme } from './pageTheme.js';
import { DEFAULT_SETTINGS } from '../shared/storage.js';
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [collapsed, setCollapsed] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [layout, setLayout] = useState<Layout | null>(null);
  // синхронно на первом рендере: промежуточное 'auto' красило панель наполовину
  const [pageTheme, setPageTheme] = useState<PageTheme>(() => detectPageTheme());
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // «как в системе» на странице биржи означает «как у биржи»
  const theme = settings.theme === 'auto' && pageTheme ? pageTheme : settings.theme;

  useEffect(() => watchPageTheme(setPageTheme), []);

  const applyState = useCallback((next: PanelState) => setState(next), []);
  const { run, busy, error, setError } = usePanelAction(applyState);

  // подписка на пуши background и запрос состояния при монтировании
  useEffect(() => {
    let alive = true;

    const listener = (message: { type?: string; state?: PanelState; settings?: Settings }) => {
      if (message?.type === 'PANEL_STATE' && message.state) setState(message.state);
      // настройки меняют из попапа, панель переезжает без перезагрузки
      if (message?.type === 'SETTINGS_CHANGED' && message.settings) setSettings(message.settings);
    };
    chrome.runtime.onMessage.addListener(listener);

    void sendMessage<PanelState>({ type: 'GET_PANEL_STATE' }).then((response) => {
      if (alive && response.ok && response.data) setState(response.data);
    });
    void sendMessage<Settings>({ type: 'GET_SETTINGS' }).then((response) => {
      if (alive && response.ok && response.data) setSettings(response.data);
    });

    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  // пока панель свёрнута или скрыта, место под неё считать незачем
  const active = state.status !== 'idle' && !collapsed;

  useEffect(() => {
    if (!active) {
      setLayout(null);
      return undefined;
    }
    return watchLayout(() => {
      const next = computeLayout(settings.panelPlacement, {
        width: settings.panelWidth,
        height: settings.panelHeight,
      });

      // блок живёт в вёрстке биржи, поэтому host переезжает к чату
      moveHost(next.mode === 'flow');

      // сравниваем по значению: иначе каждый кадр давал бы новый рендер
      setLayout((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    });
  }, [active, settings.panelPlacement, settings.panelWidth, settings.panelHeight]);

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
    setSettings((prev) => ({ ...prev, theme: next }));
    void sendMessage({ type: 'SET_SETTINGS', patch: { theme: next } });
  };

  if (state.status === 'idle') return null;

  const transform = `translate(${offset.x}px, ${offset.y}px)`;
  const ready = state.status === 'ready' ? state : null;

  // в потоке позицию считает браузер, мы только задаём размеры и отступы;
  // свободная панель по-прежнему висит поверх окна
  const rootStyle =
    layout?.mode === 'flow'
      ? {
          // размеры и отступы уже на host, здесь только занять его целиком
          position: 'relative' as const,
          // в потоке чат обязан быть сверху: при прокрутке панель уходит под
          // него, а не накрывает переписку
          zIndex: 1,
          top: 'auto' as const,
          left: 'auto' as const,
          right: 'auto' as const,
          width: '100%' as const,
          maxHeight: layout.maxHeight,
        }
      : layout
        ? {
            transform,
            top: layout.box.top,
            left: layout.box.left,
            right: 'auto' as const,
            width: layout.box.width,
            maxHeight: layout.box.height,
          }
        : { transform };

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
    onUseTemplate: (text) => insertIntoChat(text, settings.templateMode === 'send'),
  };

  return (
    <div className="root" data-theme={theme} style={rootStyle}>
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
              В чате появился новый реквизит <b>{ready.requisiteAlert.value}</b>. Платите только по
              данным из ордера.
            </span>
          </div>
        ) : null}

        {dossier ? <DossierView dossier={dossier} actions={actions} templates={ready?.templates} /> : null}
      </div>
    </div>
  );
}
