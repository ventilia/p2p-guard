import { useEffect, useState } from 'react';
import { getSession, logout, onLogout, type ApiError } from './api';
import {
  IconChart,
  IconKey,
  IconList,
  IconLogout,
  IconMoon,
  IconShield,
  IconSun,
  IconTeam,
  IconUsers,
} from './icons';
import type { Session } from './types';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Users } from './pages/Users';
import { UserCard } from './pages/UserCard';
import { Tokens } from './pages/Tokens';
import { Teams } from './pages/Teams';
import { Audit } from './pages/Audit';

// хэш вместо react-router: шесть экранов и никакого SPA-fallback на хостинге
type Route = { name: 'overview' | 'users' | 'tokens' | 'teams' | 'audit' } | { name: 'user'; id: string };

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [head, param] = raw.split('/');

  if (head === 'users' && param) return { name: 'user', id: param };
  if (head === 'users') return { name: 'users' };
  if (head === 'tokens') return { name: 'tokens' };
  if (head === 'teams') return { name: 'teams' };
  if (head === 'audit') return { name: 'audit' };
  return { name: 'overview' };
}

export function navigate(to: string): void {
  window.location.hash = to;
}

const NAV: { key: Route['name']; path: string; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { key: 'overview', path: '#/', label: 'Сводка', Icon: IconChart },
  { key: 'users', path: '#/users', label: 'Пользователи', Icon: IconUsers },
  { key: 'teams', path: '#/teams', label: 'Команды', Icon: IconTeam },
  { key: 'tokens', path: '#/tokens', label: 'Токены доступа', Icon: IconKey },
  { key: 'audit', path: '#/audit', label: 'Аудит', Icon: IconList },
];

const THEME_KEY = 'pg.admin.theme';
type Theme = 'light' | 'dark' | 'auto';

export function App() {
  const [session, setSessionState] = useState<Session | null>(() => getSession());
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'light',
  );

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // протухшая сессия роняет на экран входа из любого места
  useEffect(() => onLogout(() => setSessionState(null)), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  if (!session) return <Login onSuccess={setSessionState} />;

  const activeKey: Route['name'] = route.name === 'user' ? 'users' : route.name;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <IconShield size={17} />
          </div>
          <div>
            <div className="brand-name">P2P Guard</div>
            <div className="brand-sub">админ-панель</div>
          </div>
        </div>

        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item ${activeKey === item.key ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <item.Icon size={16} />
            {item.label}
          </button>
        ))}

        <div className="sidebar-foot">
          <div className="seg">
            {(['light', 'dark', 'auto'] as Theme[]).map((t) => (
              <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>
                {t === 'light' ? <IconSun size={14} /> : t === 'dark' ? <IconMoon size={14} /> : 'Авто'}
              </button>
            ))}
          </div>
          <div className="sidebar-user">
            {session.user.nickname ?? 'администратор'}
            <br />
            UID {session.user.binanceUid}
          </div>
          <button
            className="ghost"
            onClick={() => {
              void logout();
            }}
          >
            <IconLogout size={15} /> Выйти
          </button>
        </div>
      </aside>

      <main className="content">
        {route.name === 'overview' ? <Overview /> : null}
        {route.name === 'users' ? <Users /> : null}
        {route.name === 'user' ? <UserCard id={route.id} /> : null}
        {route.name === 'tokens' ? <Tokens /> : null}
        {route.name === 'teams' ? <Teams /> : null}
        {route.name === 'audit' ? <Audit /> : null}
      </main>
    </div>
  );
}

export type { ApiError };
