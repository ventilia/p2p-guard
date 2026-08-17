// одна палитра на панель и попап, светлая по умолчанию: страница ордера светлая
// тема переключается атрибутом data-theme, переменные наследуются внутрь Shadow DOM

export type ThemeName = 'light' | 'dark' | 'auto';

// IBM Plex Sans (SIL OFL 1.1), вариативный — жирный не подделывается браузером
// URL подставляется на месте: chrome-extension:// в панели, обычный путь в попапе
export const fontFace = (url: string): string => `
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('${url}') format('truetype-variations');
  font-weight: 100 700;
  font-style: normal;
  font-display: swap;
}
`;

export const FONT_STACK = `'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
export const MONO_STACK = `'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

// нейтральный графит и один акцент
const LIGHT = `
  --bg: #f5f6f8;
  --surface: #ffffff;
  --surface-2: #f7f8fa;
  --surface-3: #eef0f4;
  --line: #e4e7ec;
  --line-strong: #d3d8e0;

  --text: #131720;
  --text-2: #47505f;
  --muted: #7b8494;
  --muted-2: #9aa2b1;

  --accent: #b8860b;
  --accent-bg: #fdf6e3;
  --accent-line: #edd9a3;

  --good: #1a7f37;
  --good-bg: #eaf6ec;
  --good-line: #bfe3c6;

  --warn: #b26a00;
  --warn-bg: #fdf2e0;
  --warn-line: #f0d5a8;

  --bad: #c62828;
  --bad-bg: #fdeded;
  --bad-line: #f3c9c9;

  --shadow: 0 10px 34px rgba(19, 23, 32, .13);
  --shadow-sm: 0 1px 2px rgba(19, 23, 32, .06);
  --overlay: rgba(19, 23, 32, .35);
`;

// те же роли токенов: вёрстка о теме ничего не знает
const DARK = `
  --bg: #0f1218;
  --surface: #171b23;
  --surface-2: #1d222c;
  --surface-3: #232936;
  --line: #272d39;
  --line-strong: #333a48;

  --text: #e9edf4;
  --text-2: #b6bece;
  --muted: #7e8798;
  --muted-2: #666f80;

  --accent: #f0b90b;
  --accent-bg: rgba(240, 185, 11, .12);
  --accent-line: rgba(240, 185, 11, .34);

  --good: #4ec26f;
  --good-bg: rgba(46, 160, 67, .14);
  --good-line: rgba(46, 160, 67, .36);

  --warn: #e0a33a;
  --warn-bg: rgba(217, 158, 0, .15);
  --warn-line: rgba(217, 158, 0, .36);

  --bad: #f3736f;
  --bad-bg: rgba(240, 68, 68, .13);
  --bad-line: rgba(240, 68, 68, .36);

  --shadow: 0 16px 44px rgba(0, 0, 0, .5);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, .3);
  --overlay: rgba(0, 0, 0, .6);
`;

// scope — селектор элемента, который несёт data-theme и является предком вёрстки
// если указать не тот элемент, [data-theme='dark'] просто никогда не совпадёт
// auto отдаёт выбор системе, явные light и dark её перебивают
export const themeVars = (scope: string | string[]): string => {
  const scopes = Array.isArray(scope) ? scope : [scope];
  const sel = (suffix = '') => scopes.map((s) => `${s}${suffix}`).join(', ');

  return `
${sel()} { ${LIGHT} }
${sel("[data-theme='dark']")} { ${DARK} }
@media (prefers-color-scheme: dark) {
  ${sel("[data-theme='auto']")} { ${DARK} }
}
`;
};

// единая шкала риска для панели, попапа и админки
export const RISK_TONE: Record<string, { bg: string; line: string; text: string; label: string }> = {
  LOW: { bg: 'var(--good-bg)', line: 'var(--good-line)', text: 'var(--good)', label: 'Низкий риск' },
  MEDIUM: { bg: 'var(--warn-bg)', line: 'var(--warn-line)', text: 'var(--warn)', label: 'Средний риск' },
  HIGH: { bg: 'var(--bad-bg)', line: 'var(--bad-line)', text: 'var(--bad)', label: 'Высокий риск' },
  CRITICAL: { bg: 'var(--bad-bg)', line: 'var(--bad-line)', text: 'var(--bad)', label: 'Критический риск' },
};
