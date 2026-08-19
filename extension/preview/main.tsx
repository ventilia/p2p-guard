// настоящие компоненты продукта поверх заглушек chrome.* и fetch
// каждый блок в своём Shadow DOM: имена классов у них пересекаются
import './mockChrome';
import {
  patchSettings,
  resetPanel,
  showScenario,
  setBinanceSessionScenario,
  setTheme as setMockTheme,
} from './mockChrome';
import { installAdminMock } from './adminMock';
import { closeOrderPage, openOrderPage } from './orderPage';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from '../src/content/Panel';
import { App as PopupApp } from '../src/popup/App';
import { App as AdminApp } from '../../admin/src/App';
import { panelStyles } from '../src/content/styles';
import { popupStyles } from '../src/popup/styles';

// подставляются сборщиком: шрифт как data-URI, CSS админки из её файла
declare const __FONT_URL__: string;
declare const __ADMIN_CSS__: string;

installAdminMock();

// в проде панель висит поверх страницы, на стенде — в потоке
const PANEL_OVERRIDE = `
.root { position: static !important; max-height: none !important; width: 384px; }
.fab { position: static !important; }
`;

// попап — окно 380px, на стенде показываем карточкой
const POPUP_OVERRIDE = `
:host { display: block; }
body { max-height: none !important; }
.popup-shell {
  width: 380px; max-height: 620px; overflow: hidden;
  border: 1px solid var(--line); border-radius: 0;
  background: var(--bg); color: var(--text);
  display: flex; flex-direction: column;
}
`;

// админка на весь экран, на стенде ограничиваем высоту
const ADMIN_OVERRIDE = `
:host { display: block; }
.layout {
  min-height: 0; height: 640px;
  background: var(--bg);
  border: 1px solid var(--line-strong);
  overflow: hidden;
}
.sidebar { height: auto; position: static; }
.content { overflow-y: auto; }
.login-screen { min-height: 640px; background: var(--bg); }
`;

function mountInShadow(host: HTMLElement, css: string, render: (container: HTMLElement) => void): void {
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);

  const container = document.createElement('div');
  shadow.appendChild(container);
  render(container);
}

function Toolbar() {
  const [scenario, setScenario] = useState('scam');
  const [session, setSession] = useState<'ok' | 'logged-out' | 'mismatch'>('ok');
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');

  const pick = (name: 'scam' | 'clean' | 'loading' | 'unauthorized') => {
    setScenario(name);
    showScenario(name);
  };

  const flipTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setThemeState(next);
    setMockTheme(next);
    // попап и админка живут вне chrome.storage, атрибут ставим руками
    // у попапа переменные на .popup-shell, у админки — на самом host
    document.getElementById('popup-host')?.shadowRoot?.querySelector('div')?.setAttribute('data-theme', next);
    document.getElementById('admin-host')?.setAttribute('data-theme', next);
    document.documentElement.dataset.stand = next;
  };

  const buttons: { key: 'scam' | 'clean' | 'loading' | 'unauthorized'; label: string }[] = [
    { key: 'scam', label: 'Мошенник' },
    { key: 'clean', label: 'Чистый контрагент' },
    { key: 'loading', label: 'Загрузка' },
    { key: 'unauthorized', label: 'Не авторизован' },
  ];

  return (
    <div className="toolbar">
      <span className="toolbar-label">Сценарий:</span>
      {buttons.map((b) => (
        <button
          key={b.key}
          className={`toolbar-btn ${scenario === b.key ? 'active' : ''}`}
          onClick={() => pick(b.key)}
        >
          {b.label}
        </button>
      ))}
      <button
        className="toolbar-btn"
        onClick={() => {
          setScenario('scam');
          resetPanel();
        }}
      >
        ↺ Сбросить
      </button>

      <span className="toolbar-sep" />
      <span className="toolbar-label">Сессия Binance:</span>
      {(
        [
          { key: 'ok', label: 'Есть' },
          { key: 'logged-out', label: 'Не вошёл' },
          { key: 'mismatch', label: 'Другой аккаунт' },
        ] as const
      ).map((b) => (
        <button
          key={b.key}
          className={`toolbar-btn ${session === b.key ? 'active' : ''}`}
          onClick={() => {
            setSession(b.key);
            setBinanceSessionScenario(b.key);
            // карточка сессии читает состояние при монтировании, перерисуем попап
            remountPopup();
          }}
        >
          {b.label}
        </button>
      ))}

      <span className="toolbar-sep" />
      <button className="toolbar-btn accent" onClick={() => openDemoOrder()}>
        ▦ Открыть демо-ордер Binance
      </button>

      <span className="toolbar-sep" />
      {/* Показывает, что состояние попапа переживает закрытие. */}
      <button className="toolbar-btn" onClick={() => remountPopup()} title="Как будто закрыли и открыли попап">
        ⟳ Переоткрыть попап
      </button>
      <button className="toolbar-btn" onClick={flipTheme}>
        {theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
      </button>
    </div>
  );
}

const toolbarHost = document.getElementById('toolbar');
if (toolbarHost) createRoot(toolbarHost).render(<Toolbar />);

// панель в потоке страницы — чтобы её было видно рядом с попапом
let standPanel: ReturnType<typeof createRoot> | null = null;
const panelHost = document.getElementById('panel-host');

if (panelHost) {
  mountInShadow(panelHost, panelStyles(__FONT_URL__) + PANEL_OVERRIDE, (container) => {
    container.id = 'stand-panel';
    standPanel = createRoot(container);
    standPanel.render(
      <StrictMode>
        <Panel />
      </StrictMode>,
    );
  });
}

// вторая копия панели — уже без правок позиционирования, ровно как в проде:
// так на стенде работает настоящая привязка к чату, а не её имитация
let demoPanel: ReturnType<typeof createRoot> | null = null;
let demoHost: HTMLElement | null = null;

function unmountDemoPanel(): void {
  demoPanel?.unmount();
  demoPanel = null;
  demoHost?.remove();
  demoHost = null;

  // возвращаем панель на стенд
  const container = document.getElementById('panel-host')?.shadowRoot?.getElementById('stand-panel');
  if (container && !standPanel) {
    standPanel = createRoot(container);
    standPanel.render(
      <StrictMode>
        <Panel />
      </StrictMode>,
    );
  }
}

function openDemoOrder(): void {
  // две панели не должны одновременно тянуть высоту одного чата
  standPanel?.unmount();
  standPanel = null;

  openOrderPage(
    unmountDemoPanel,
    (panelPlacement) => patchSettings({ panelPlacement }),
    (patch) => patchSettings(patch),
  );

  demoHost = document.createElement('div');
  // тот же id, что в проде: стенд должен проверять настоящий перенос host
  demoHost.id = 'p2p-guard-root';
  document.body.appendChild(demoHost);

  mountInShadow(demoHost, panelStyles(__FONT_URL__), (container) => {
    demoPanel = createRoot(container);
    demoPanel.render(
      <StrictMode>
        <Panel />
      </StrictMode>,
    );
  });
}

// имитирует поведение Chrome: при каждом открытии попап монтируется с нуля
let popupRoot: ReturnType<typeof createRoot> | null = null;

function remountPopup(): void {
  const host = document.getElementById('popup-host');
  const container = host?.shadowRoot?.querySelector<HTMLElement>('.popup-shell');
  if (!container) return;

  popupRoot?.unmount();
  popupRoot = createRoot(container);
  popupRoot.render(
    <StrictMode>
      <PopupApp />
    </StrictMode>,
  );
}

const popupHost = document.getElementById('popup-host');
if (popupHost) {
  mountInShadow(popupHost, popupStyles(__FONT_URL__, '.popup-shell') + POPUP_OVERRIDE, (container) => {
    container.className = 'popup-shell';
    container.dataset.theme = 'light';
    popupRoot = createRoot(container);
    popupRoot.render(
      <StrictMode>
        <PopupApp />
      </StrictMode>,
    );
  });
}

const adminHost = document.getElementById('admin-host');
if (adminHost) {
  adminHost.dataset.theme = 'light';
  mountInShadow(adminHost, __ADMIN_CSS__ + ADMIN_OVERRIDE, (container) => {
    createRoot(container).render(
      <StrictMode>
        <AdminApp />
      </StrictMode>,
    );
  });
}
