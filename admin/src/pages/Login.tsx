import { useState } from 'react';
import { DEFAULT_API_BASE, getApiBase, login, setApiBase } from '../api';
import type { Session } from '../types';
import { ErrorBox, errText } from '../ui';
import { IconShield } from '../icons';

export function Login({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [apiBase, setApiBaseValue] = useState(getApiBase());
  const [showApi, setShowApi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (apiBase !== getApiBase()) setApiBase(apiBase);
      onSuccess(await login(uid.trim(), password));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-box">
        <div className="brand" style={{ padding: '0 0 4px' }}>
          <div className="brand-logo">
            <IconShield size={17} />
          </div>
          <div>
            <div className="brand-name">P2P Guard</div>
            <div className="brand-sub">админ-панель</div>
          </div>
        </div>

        <ErrorBox message={error} onClose={() => setError(null)} />

        <div className="card stack">
          <div className="field">
            <label>UID Binance администратора</label>
            <input
              value={uid}
              autoFocus
              placeholder="100000001"
              onChange={(e) => setUid(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>
          <div className="field">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>
          <button className="primary" disabled={busy || !uid.trim() || !password} onClick={() => void submit()}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </div>

        <button className="ghost small" onClick={() => setShowApi((v) => !v)}>
          {showApi ? 'Скрыть адрес API' : 'Адрес API'}
        </button>

        {showApi ? (
          <div className="card">
            <div className="field">
              <label>Базовый URL бэкенда</label>
              <input value={apiBase} onChange={(e) => setApiBaseValue(e.target.value)} />
            </div>
            <div className="stat-sub">По умолчанию: {DEFAULT_API_BASE}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
