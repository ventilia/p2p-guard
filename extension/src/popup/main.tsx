import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { popupStyles } from './styles.js';

// стили в TS, а не в popup.html: попап и панель делят одни токены
const style = document.createElement('style');
style.textContent = popupStyles('fonts/IBMPlexSans.ttf');
document.head.appendChild(style);

// тему ставим до первого кадра: настройки приезжают асинхронно, и попап
// успевал мигнуть светлым поверх тёмного, а часть узлов оставалась
// перекрашенной наполовину
document.documentElement.dataset.theme = 'auto';
void chrome.storage.local.get('pg.settings').then((data) => {
  const theme = (data['pg.settings'] as { theme?: string } | undefined)?.theme;
  if (theme) document.documentElement.dataset.theme = theme;
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
