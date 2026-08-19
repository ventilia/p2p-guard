// строкой, потому что монтируются в Shadow DOM: вёрстка биржи на нас не влияет
// цвета из общих токенов, чтобы панель, попап и админка не расходились
import { FONT_STACK, MONO_STACK, fontFace, themeVars } from '../shared/theme.js';

export const panelStyles = (fontUrl: string): string => `
${fontFace(fontUrl)}
${themeVars(['.root', '.fab'])}

:host {
  all: initial;
  /* all:initial делает host инлайновым — в потоке страницы это ломает раскладку */
  display: block;
  font-family: ${FONT_STACK};
}

* { box-sizing: border-box; }

.root {
  position: fixed;
  z-index: 2147483000;
  top: 76px;
  right: 20px;
  width: 384px;
  max-height: calc(100vh - 110px);
  display: flex;
  flex-direction: column;
  font-family: ${FONT_STACK};
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 0;
  box-shadow: var(--shadow);
  overflow: hidden;
  font-variant-numeric: tabular-nums;
}

.header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  cursor: grab;
  user-select: none;
  flex: 0 0 auto;
}
.header:active { cursor: grabbing; }

.title { font-weight: 600; font-size: 13.5px; letter-spacing: -.01em; }
.subtitle { font-size: 10.5px; color: var(--muted); line-height: 1.2; }
.spacer { flex: 1; }

.icon-btn {
  display: grid; place-items: center;
  width: 26px; height: 26px;
  border-radius: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.icon-btn:hover { background: var(--surface-3); color: var(--text); }
.icon-btn:disabled { opacity: .45; cursor: default; }

.body {
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  background: var(--bg);
}
.body::-webkit-scrollbar { width: 9px; }
.body::-webkit-scrollbar-thumb {
  background: var(--line-strong); border-radius: 0;
  border: 3px solid var(--bg);
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 0;
  padding: 11px;
}

.card-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 10.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .55px;
  color: var(--muted);
  margin-bottom: 9px;
}
.card-title .count { color: var(--muted-2); font-weight: 500; }

.risk {
  display: flex; gap: 11px; align-items: flex-start;
  padding: 11px;
  border-radius: 0;
  border: 1px solid var(--risk-line);
  background: var(--risk-bg);
}
.risk-score {
  width: 46px; height: 46px;
  flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 0;
  background: var(--surface);
  border: 1px solid var(--risk-line);
  font-size: 19px; font-weight: 600;
  color: var(--risk-text);
  letter-spacing: -.02em;
}
.risk-label { font-weight: 600; font-size: 13px; color: var(--risk-text); }
.risk-sub { font-size: 11px; color: var(--muted); margin-bottom: 5px; }

.factors { display: flex; flex-direction: column; gap: 3px; }
.factor { display: flex; gap: 6px; align-items: baseline; font-size: 11.5px; color: var(--text-2); }
.impact {
  flex: 0 0 auto; min-width: 27px; text-align: right;
  font-weight: 600; font-size: 11px;
  font-family: ${MONO_STACK};
}
.impact.bad { color: var(--bad); }
.impact.good { color: var(--good); }
.impact.zero { color: var(--muted-2); }
.factor .detail { color: var(--muted-2); }

.more-btn {
  margin-top: 5px;
  background: none; border: 0; padding: 0;
  color: var(--muted); font-size: 11px; font-family: inherit;
  cursor: pointer; text-decoration: underline dotted;
}
.more-btn:hover { color: var(--text); }

.who { display: flex; gap: 10px; align-items: flex-start; }

/* биржа фото не отдаёт, а рисовать несуществующее лицо нечестно */
.avatar {
  width: 40px; height: 40px; flex: 0 0 auto;
  border-radius: 0;
  display: grid; place-items: center;
  background: var(--surface-3);
  border: 1px solid var(--line);
  color: var(--muted);
  position: relative;
}
.avatar .initial {
  font-size: 15px; font-weight: 600; color: var(--text-2);
  letter-spacing: -.01em;
}

.nick { font-size: 15px; font-weight: 600; letter-spacing: -.01em; word-break: break-word; }
.uid {
  font-family: ${MONO_STACK};
  font-size: 11.5px; color: var(--muted);
}
.meta-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 1px; }

.badges { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }

.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2.5px 8px;
  border-radius: 0;
  font-size: 11px; font-weight: 500;
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text-2);
  white-space: nowrap;
}
.badge.ok { background: var(--good-bg); border-color: var(--good-line); color: var(--good); }
.badge.bad { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); }
.badge.warn { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }
.badge.accent { background: var(--accent-bg); border-color: var(--accent-line); color: var(--accent); }

/* две колонки: своя база и Telegram */
.status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
.status-cell {
  display: flex; flex-direction: column; gap: 3px;
  padding: 7px 9px;
  border-radius: 0;
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.status-cell.bad { background: var(--bad-bg); border-color: var(--bad-line); }
.status-cell.warn { background: var(--warn-bg); border-color: var(--warn-line); }
.status-cell .k { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; }
.status-cell .v { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; }
.status-cell.bad .v { color: var(--bad); }
.status-cell.warn .v { color: var(--warn); }

.tag-row { display: flex; gap: 5px; flex-wrap: wrap; }
.tag-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3.5px 9px;
  border-radius: 0;
  font-size: 11.5px; font-weight: 500;
  background: var(--bad-bg);
  border: 1px solid var(--bad-line);
  color: var(--bad);
}
.tag-chip .n { font-weight: 600; font-family: ${MONO_STACK}; font-size: 11px; }
.tag-chip.mild { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }
.tag-chip.plain { background: var(--surface-2); border-color: var(--line); color: var(--text-2); }

.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }

.stat {
  padding: 8px 9px;
  border-radius: 0;
  background: var(--surface-2);
  border: 1px solid var(--line);
}
.stat.flag { background: var(--bad-bg); border-color: var(--bad-line); }
.stat-name { font-size: 11.5px; font-weight: 600; margin-bottom: 5px; }
.stat.flag .stat-name { color: var(--bad); }
.stat-pair { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.stat-pair + .stat-pair { margin-top: 2px; }
.stat-k { font-size: 10.5px; color: var(--muted); }
.stat-v { font-size: 12.5px; font-weight: 600; font-family: ${MONO_STACK}; }
.stat.flag .stat-v { color: var(--bad); }

.legend { display: flex; gap: 10px; margin-left: auto; font-size: 10.5px; color: var(--muted); }
.legend span { display: inline-flex; align-items: center; gap: 4px; }
.dot-ok, .dot-bad { width: 6px; height: 6px; border-radius: 0; display: inline-block; }
.dot-ok { background: var(--good); }
.dot-bad { background: var(--bad); }

.counters { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.counter {
  padding: 7px 6px;
  border-radius: 0;
  background: var(--surface-2);
  border: 1px solid var(--line);
  text-align: center;
}
.counter b {
  display: block; font-size: 13px; font-weight: 600;
  font-family: ${MONO_STACK};
}
.counter .ok { color: var(--good); }
.counter .bad { color: var(--bad); }
.counter .sep { color: var(--muted-2); margin: 0 1px; }
.counter span.k { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; }

table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
th {
  text-align: left; font-weight: 500; font-size: 10px;
  text-transform: uppercase; letter-spacing: .4px;
  color: var(--muted);
  padding: 5px 6px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
td.num { text-align: right; font-family: ${MONO_STACK}; }
td.mono { font-family: ${MONO_STACK}; color: var(--muted); }
.buy { color: var(--good); font-weight: 600; }
.sell { color: var(--bad); font-weight: 600; }

.status-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10.5px; font-weight: 500;
  padding: 1.5px 7px; border-radius: 0;
  background: var(--surface-2); border: 1px solid var(--line); color: var(--text-2);
  white-space: nowrap;
}
.status-chip.COMPLETED { background: var(--good-bg); border-color: var(--good-line); color: var(--good); }
.status-chip.CANCELLED { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); }
.status-chip.APPEALING { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }

.scroll-y { max-height: 168px; overflow-y: auto; }
.scroll-y::-webkit-scrollbar { width: 7px; }
.scroll-y::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 0; }

.verify { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }

.review { padding: 8px 0; border-top: 1px solid var(--line); }
.review:first-of-type { border-top: 0; padding-top: 0; }
.review-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.review-author { color: var(--text-2); font-weight: 500; }
.review-text { margin-top: 4px; font-size: 12.5px; color: var(--text); word-break: break-word; }

.review-ava {
  width: 20px; height: 20px; flex: 0 0 auto;
  border-radius: 0;
  display: grid; place-items: center;
  background: var(--surface-3); color: var(--muted);
}

.req-row {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 0; border-top: 1px solid var(--line);
  font-size: 12px;
}
.req-row:first-of-type { border-top: 0; }
.req-mask { font-family: ${MONO_STACK}; flex: 1; }

textarea, input, select {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  color: var(--text);
  padding: 7px 9px;
  font-size: 12.5px;
  font-family: inherit;
  resize: vertical;
}
textarea:focus, input:focus, select:focus {
  outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg);
}
textarea::placeholder, input::placeholder { color: var(--muted-2); }

.actions { display: flex; gap: 6px; flex-wrap: wrap; }

/* без обводки: форму задаёт заливка, а не рамка */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  border: 0;
  background: var(--surface-3);
  color: var(--text);
  border-radius: 0;
  padding: 8px 11px;
  font-size: 12.5px; font-weight: 500;
  cursor: pointer; font-family: inherit;
}
.btn:hover:not(:disabled) { background: var(--line); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: var(--text); color: var(--surface); }
.btn.primary:hover:not(:disabled) { opacity: .88; }
.btn.danger { color: var(--bad); background: var(--bad-bg); }
.btn.danger:hover:not(:disabled) { background: var(--bad-line); color: var(--surface); }
.btn.block { width: 100%; justify-content: center; }

/* выбор категории жалобы */
.tag-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 7px; }
.tag-opt {
  display: flex; align-items: center; gap: 6px;
  padding: 8px;
  border-radius: 0;
  border: 0;
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 11.5px; font-weight: 500;
  cursor: pointer; font-family: inherit;
  text-align: left;
}
.tag-opt:hover { background: var(--surface-3); color: var(--text); }
.tag-opt.active { background: var(--bad-bg); color: var(--bad); }
.tag-opt.active.neutral { background: var(--accent-bg); color: var(--accent); }

.rating-row { display: flex; gap: 5px; margin-bottom: 7px; }
.rating-btn {
  flex: 1;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 8px; border-radius: 0;
  border: 0;
  background: var(--surface-2); color: var(--text-2);
  font-size: 11.5px; font-weight: 500; cursor: pointer; font-family: inherit;
}
.rating-btn:hover { background: var(--surface-3); }
.rating-btn.POSITIVE.active { background: var(--good-bg); color: var(--good); }
.rating-btn.NEUTRAL.active { background: var(--surface-3); color: var(--text); }
.rating-btn.NEGATIVE.active { background: var(--bad-bg); color: var(--bad); }

.templates { display: flex; gap: 5px; flex-wrap: wrap; }
.template-chip {
  padding: 6px 10px;
  border-radius: 0;
  border: 0;
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 11.5px; cursor: pointer; font-family: inherit;
}
.template-chip:hover { background: var(--line); color: var(--text); }

.hint { font-size: 11px; color: var(--muted); line-height: 1.45; }
.muted { color: var(--muted); font-size: 12px; }

.alert {
  display: flex; gap: 8px; align-items: flex-start;
  background: var(--warn-bg);
  border: 1px solid var(--warn-line);
  color: var(--warn);
  border-radius: 0;
  padding: 9px 10px;
  font-size: 12px;
  line-height: 1.45;
}
.alert.bad { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); }
.alert b { font-family: ${MONO_STACK}; }

.center { display: grid; place-items: center; gap: 9px; padding: 34px 0; text-align: center; }

/* единственный круг: вращающаяся квадратная рамка читается как баг */
.spinner {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  animation: pg-spin .7s linear infinite;
}
@keyframes pg-spin { to { transform: rotate(360deg); } }

/* свёрнутая панель: тот же знак, что в тулбаре, плюс метка риска */
.fab {
  position: fixed;
  z-index: 2147483000;
  top: 76px; right: 20px;
  width: 40px; height: 40px;
  display: grid; place-items: center;
  border-radius: 0;
  background: var(--surface);
  border: 0;
  padding: 0;
  box-shadow: var(--shadow);
  cursor: pointer;
  font-family: inherit;
}
.fab:hover { opacity: .85; }
.fab-dot {
  position: absolute; top: -3px; right: -3px;
  width: 13px; height: 13px; border-radius: 0;
  border: 2px solid var(--surface);
}
.fab-dot.LOW { background: var(--good); }
.fab-dot.MEDIUM { background: var(--warn); }
.fab-dot.HIGH { background: #e8833a; }
.fab-dot.CRITICAL { background: var(--bad); }
`;
