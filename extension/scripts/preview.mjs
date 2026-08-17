// собирает стенд в один HTML: посмотреть интерфейс без базы, бэкенда и биржи
// рендерятся настоящие компоненты продукта
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'preview/dist');

// data-URI: стенд открывают с file://, куда относительные пути не доедут
async function fontDataUrl() {
  const buf = await readFile(resolve(root, 'public/fonts/IBMPlexSans.ttf'));
  return `data:font/ttf;base64,${buf.toString('base64')}`;
}

// CSS берём из файла админки, чтобы стенд не расходился с продом
async function adminCss() {
  const css = await readFile(resolve(root, '../admin/src/styles.css'), 'utf8');
  return (
    css
      // шрифт уже подключён обвязкой стенда, свой @font-face не нужен
      .replace(/@font-face\s*\{[\s\S]*?\}/g, '')
      // условие у :host пишется в скобках, иначе селектор молча не матчится
      .replace(/:root\[([^\]]+)\]/g, ':host([$1])')
      .replace(/:root/g, ':host')
  );
}

// обвязка стенда: тот же дизайн, что в продукте
const pageCss = (fontUrl) => `
@font-face {
  font-family: 'IBM Plex Sans';
  src: url('${fontUrl}') format('truetype-variations');
  font-weight: 100 700;
  font-style: normal;
  font-display: swap;
}

:root {
  --bg: #f5f6f8;
  --surface: #ffffff;
  --surface-2: #f7f8fa;
  --surface-3: #eef0f4;
  --line: #e4e7ec;
  --line-strong: #d3d8e0;
  --text: #131720;
  --muted: #7b8494;
  --accent: #b8860b;
  --accent-bg: #fdf6e3;
  --accent-line: #edd9a3;
}
:root[data-stand='dark'] {
  --bg: #0f1218;
  --surface: #171b23;
  --surface-2: #1d222c;
  --surface-3: #232936;
  --line: #272d39;
  --line-strong: #333a48;
  --text: #e9edf4;
  --muted: #7e8798;
  --accent: #f0b90b;
  --accent-bg: rgba(240,185,11,.12);
  --accent-line: rgba(240,185,11,.34);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 28px 24px 60px;
  background: var(--bg);
  color: var(--text);
  font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.wrap { max-width: 1240px; margin: 0 auto; }

h1 { font-size: 22px; font-weight: 600; margin: 0 0 6px; letter-spacing: -.015em; }
.lead { color: var(--muted); font-size: 13px; margin: 0 0 16px; max-width: 760px; }

.note {
  background: var(--accent-bg);
  border: 1px solid var(--accent-line);
  color: var(--accent);
  padding: 10px 12px; font-size: 12.5px; margin: 0 0 22px;
}

.toolbar { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 18px; }
.toolbar-label { color: var(--muted); font-size: 12.5px; }
.toolbar-sep { width: 1px; height: 22px; background: var(--line-strong); margin: 0 4px; }
.toolbar-btn {
  border: 1px solid var(--line-strong); background: var(--surface); color: var(--text);
  padding: 6px 11px; font-size: 12.5px; font-weight: 500;
  cursor: pointer; font-family: inherit;
}
.toolbar-btn:hover { background: var(--surface-3); }
.toolbar-btn.active { background: var(--text); border-color: var(--text); color: var(--surface); }

section { margin-bottom: 30px; }
.section-head {
  display: flex; align-items: baseline; gap: 10px;
  padding-bottom: 8px; margin-bottom: 14px;
  border-bottom: 1px solid var(--line-strong);
}
.section-num {
  font-size: 11px; font-weight: 600; color: var(--surface);
  background: var(--text); padding: 2px 7px;
}
.section-title { font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
.section-sub { font-size: 12.5px; color: var(--muted); }

.cols { display: flex; gap: 26px; align-items: flex-start; flex-wrap: wrap; }
.col-sub { font-size: 12px; color: var(--muted); margin-top: 10px; max-width: 384px; }
`;

const page = (script, fontUrl) => `<!doctype html>
<html lang="ru" data-stand="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>P2P Guard — интерфейс</title>
    <style>${pageCss(fontUrl)}</style>
  </head>
  <body>
    <div class="wrap">
      <h1>P2P Guard — интерфейс</h1>
      <p class="lead">
        Все три части продукта на одной странице: панель в ордере, попап расширения
        и админ-панель. Это настоящие компоненты, а не макет.
      </p>

      <div class="note">
        Демо-стенд: сети и биржи здесь нет, данные — фиксированный набор для показа.
        Кнопки живые: отзыв, заметка команды, чёрный список, шаблоны и вкладки
        админки работают.
      </div>

      <div id="toolbar"></div>

      <section>
        <div class="section-head">
          <span class="section-num">1</span>
          <span class="section-title">Панель в ордере</span>
          <span class="section-sub">появляется поверх страницы Binance P2P</span>
        </div>
        <div class="cols">
          <div>
            <div id="panel-host"></div>
            <div class="col-sub">
              Перетаскивается за шапку, сворачивается в кнопку с цветовой меткой риска.
              Риск-скор всегда показывает, из чего он сложился.
            </div>
          </div>
          <div>
            <div id="popup-host"></div>
            <div class="col-sub">
              Попап: проверка контрагента до сделки, команда, шаблоны быстрых
              ответов и настройки. Работает вне страницы ордера.
            </div>
          </div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <span class="section-num">2</span>
          <span class="section-title">Админ-панель</span>
          <span class="section-sub">сводка, пользователи, команды, токены доступа, аудит</span>
        </div>
        <div id="admin-host"></div>
        <div class="col-sub" style="max-width: 100%">
          Переключайтесь по разделам в левом меню — данные подставлены заглушкой,
          но экраны и логика настоящие.
        </div>
      </section>
    </div>

    <script>${script}</script>
  </body>
</html>
`;

async function run() {
  await mkdir(outdir, { recursive: true });
  const fontUrl = await fontDataUrl();

  const result = await build({
    entryPoints: [resolve(root, 'preview/main.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['chrome114'],
    minify: true,
    logLevel: 'info',
    // у админки свой node_modules: без алиаса в бандл попадут две копии React
    alias: {
      react: resolve(root, 'node_modules/react'),
      'react-dom': resolve(root, 'node_modules/react-dom'),
    },
    define: {
      'process.env.NODE_ENV': '"production"',
      __FONT_URL__: JSON.stringify(fontUrl),
      __ADMIN_CSS__: JSON.stringify(await adminCss()),
    },
  });

  const js = result.outputFiles?.[0]?.text;
  if (!js) throw new Error('esbuild не вернул бандл');

  const out = resolve(outdir, 'index.html');
  await writeFile(out, page(js, fontUrl), 'utf8');

  console.log(`\n✅ Стенд собран: ${out}`);
  console.log('   Откройте файл в браузере — сервер не нужен.\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
