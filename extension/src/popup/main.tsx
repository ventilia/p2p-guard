import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { popupStyles } from './styles.js';

// стили в TS, а не в popup.html: попап и панель делят одни токены
const style = document.createElement('style');
style.textContent = popupStyles('fonts/IBMPlexSans.ttf');
document.head.appendChild(style);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
