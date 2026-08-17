// строкой, чтобы делить дизайн-токены с панелью и не расходиться с ней
import { FONT_STACK, MONO_STACK, fontFace, themeVars } from '../shared/theme.js';

// scope параметром ради стенда: там попап в Shadow DOM, где :root не матчится
export const popupStyles = (fontUrl: string, scope = ':root'): string => `
${fontFace(fontUrl)}
${themeVars(scope)}

* { box-sizing: border-box; }

html, body { margin: 0; padding: 0; }

body, .popup-shell {
  width: 380px;
  min-height: 320px;
  max-height: 600px;
  background: var(--bg);
  color: var(--text);
  font-family: ${FONT_STACK};
  font-size: 13px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}

/* ───────────────────────────── Каркас ───────────────────────────── */

.shell { display: flex; flex-direction: column; height: 100%; }

.top {
  display: flex; align-items: center; gap: 9px;
  padding: 11px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 5;
}
.brand-name { font-weight: 600; font-size: 13.5px; letter-spacing: -.01em; }
.brand-sub { font-size: 10.5px; color: var(--muted); line-height: 1.2; }
.spacer { flex: 1; }

.tabs {
  display: flex; gap: 2px;
  padding: 7px 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  position: sticky; top: 51px; z-index: 4;
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }

.tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 10px;
  border-radius: 0;
  border: 0;
  background: none;
  color: var(--muted);
  font-size: 12px; font-weight: 500;
  cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.tab:hover { background: var(--surface-2); color: var(--text); }
.tab.active { background: var(--surface-3); color: var(--text); }

.content {
  padding: 10px;
  display: flex; flex-direction: column; gap: 9px;
  overflow-y: auto;
  flex: 1;
}
.content::-webkit-scrollbar { width: 9px; }
.content::-webkit-scrollbar-thumb {
  background: var(--line-strong); border-radius: 0; border: 3px solid var(--bg);
}

/* ───────────────────────────── Общее ───────────────────────────── */

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

label { display: block; font-size: 11.5px; color: var(--muted); margin: 9px 0 4px; }
label:first-child { margin-top: 0; }

input, select, textarea {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  color: var(--text);
  padding: 8px 9px;
  font-size: 12.5px;
  font-family: inherit;
  resize: vertical;
}
input:focus, select:focus, textarea:focus {
  outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg);
}
input::placeholder, textarea::placeholder { color: var(--muted-2); }

/* без обводки: форму задаёт заливка, а не рамка */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 0;
  background: var(--surface-3);
  color: var(--text);
  border-radius: 0;
  padding: 9px 12px;
  font-size: 12.5px; font-weight: 500;
  cursor: pointer; font-family: inherit;
}
.btn:hover:not(:disabled) { background: var(--line); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.primary { background: var(--text); color: var(--surface); }
.btn.primary:hover:not(:disabled) { opacity: .88; }
.btn.danger { color: var(--bad); background: var(--bad-bg); }
.btn.danger:hover:not(:disabled) { background: var(--bad-line); color: var(--surface); }
.btn.ghost { background: transparent; color: var(--muted); }
.btn.ghost:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.btn.block { width: 100%; }
.btn.small { padding: 5px 9px; font-size: 11.5px; }

.icon-btn {
  display: grid; place-items: center;
  width: 26px; height: 26px;
  border-radius: 0; border: 0;
  background: transparent; color: var(--muted);
  cursor: pointer; padding: 0; font-family: inherit;
}
.icon-btn:hover { background: var(--surface-3); color: var(--text); }

.row { display: flex; gap: 7px; }
.row > * { flex: 1; }
.row > .fixed { flex: 0 0 auto; }

.actions { display: flex; gap: 6px; flex-wrap: wrap; }

.kv { display: flex; justify-content: space-between; gap: 10px; padding: 4px 0; font-size: 12.5px; }
.kv > span:first-child { color: var(--muted); }
.kv b { font-weight: 600; }

.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2.5px 8px; border-radius: 0;
  font-size: 11px; font-weight: 500;
  background: var(--surface-2); border: 1px solid var(--line); color: var(--text-2);
  white-space: nowrap;
}
.badge.ok { background: var(--good-bg); border-color: var(--good-line); color: var(--good); }
.badge.bad { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); }
.badge.warn { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }
.badge.accent { background: var(--accent-bg); border-color: var(--accent-line); color: var(--accent); }

/* скрытый блок «для администратора» */
.advanced > summary {
  cursor: pointer; list-style: none;
  padding: 7px 0; font-size: 11.5px; color: var(--muted);
  text-align: center;
}
.advanced > summary::-webkit-details-marker { display: none; }
.advanced > summary:hover { color: var(--text); }

/* работает ли автоопределение прямо сейчас */
.status-line {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 10px;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 11.5px; line-height: 1.4;
}
.status-line b { color: var(--text); font-weight: 600; }
.status-line.ok { background: var(--good-bg); color: var(--good); }
.status-line.ok b { color: var(--good); }
.status-line.warn { background: var(--warn-bg); color: var(--warn); }
.status-line svg { flex: 0 0 auto; }

.mono { font-family: ${MONO_STACK}; }
.muted { color: var(--muted); font-size: 12px; }
.hint { font-size: 11px; color: var(--muted); line-height: 1.45; }

.alert {
  display: flex; gap: 8px; align-items: flex-start;
  border-radius: 0; padding: 9px 10px;
  font-size: 12px; line-height: 1.45;
  background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--warn);
}
.alert.bad { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); cursor: pointer; }
.alert.ok { background: var(--good-bg); border-color: var(--good-line); color: var(--good); }

.switch {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 7px 0;
  border-top: 1px solid var(--line);
}
.switch:first-of-type { border-top: 0; }
.switch .k { font-size: 12.5px; }
.switch .d { font-size: 11px; color: var(--muted); }
.switch input { width: auto; }

.seg { display: flex; gap: 3px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 0; padding: 3px; }
.seg button {
  flex: 1; padding: 5px 8px; border-radius: 0;
  border: 0; background: none; color: var(--muted);
  font-size: 11.5px; font-weight: 500; cursor: pointer; font-family: inherit;
}
.seg button.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }

.center { display: grid; place-items: center; gap: 9px; padding: 32px 0; text-align: center; }

/* единственный круг, см. content/styles.ts */
.spinner {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--accent);
  animation: pg-spin .7s linear infinite;
}
@keyframes pg-spin { to { transform: rotate(360deg); } }

/* ───────────────────────────── Поиск ───────────────────────────── */

.result {
  display: flex; align-items: center; gap: 9px;
  padding: 8px; border-radius: 0;
  border: 1px solid var(--line);
  background: var(--surface-2);
  cursor: pointer;
  width: 100%; text-align: left;
  font-family: inherit; color: var(--text);
}
.result:hover { border-color: var(--line-strong); background: var(--surface-3); }
.result + .result { margin-top: 5px; }
.result .n { font-weight: 600; font-size: 12.5px; }
.result .s { font-size: 11px; color: var(--muted); }

.avatar {
  width: 32px; height: 32px; flex: 0 0 auto;
  border-radius: 0;
  display: grid; place-items: center;
  background: var(--surface-3);
  border: 1px solid var(--line);
  color: var(--muted);
}
.avatar .initial { font-size: 13px; font-weight: 600; color: var(--text-2); }

/* ───────────────────────────── Команда ───────────────────────────── */

.member {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 0; border-top: 1px solid var(--line);
}
.member:first-of-type { border-top: 0; }
.member .n { font-weight: 500; font-size: 12.5px; }
.member .s { font-size: 11px; color: var(--muted); }
.member .stat { text-align: right; font-size: 11px; color: var(--muted); }
.member .stat b { display: block; font-size: 12.5px; color: var(--text); font-family: ${MONO_STACK}; }

.token-reveal {
  font-family: ${MONO_STACK};
  background: var(--accent-bg);
  border: 1px dashed var(--accent-line);
  border-radius: 0; padding: 9px;
  word-break: break-all; color: var(--accent);
  font-size: 12px;
}

/* ───────────────────────────── Шаблоны ───────────────────────────── */

.tpl {
  padding: 8px 0; border-top: 1px solid var(--line);
}
.tpl:first-of-type { border-top: 0; }
.tpl-head { display: flex; align-items: center; gap: 6px; }
.tpl-title { font-weight: 500; font-size: 12.5px; flex: 1; }
.tpl-body { font-size: 11.5px; color: var(--muted); margin-top: 3px; }

/* досье в попапе переиспользует классы панели, держим синхронно */
${sharedDossierClasses()}
`;

/* панель и попап живут в разных корнях, поэтому классы досье дублируются */
function sharedDossierClasses(): string {
  return `
.risk {
  display: flex; gap: 11px; align-items: flex-start;
  padding: 11px; border-radius: 0;
  border: 1px solid var(--risk-line); background: var(--risk-bg);
}
.risk-score {
  width: 46px; height: 46px; flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 0; background: var(--surface);
  border: 1px solid var(--risk-line);
  font-size: 19px; font-weight: 600; color: var(--risk-text);
}
.risk-label { font-weight: 600; font-size: 13px; color: var(--risk-text); }
.risk-sub { font-size: 11px; color: var(--muted); margin-bottom: 5px; }
.factors { display: flex; flex-direction: column; gap: 3px; }
.factor { display: flex; gap: 6px; align-items: baseline; font-size: 11.5px; color: var(--text-2); }
.impact { flex: 0 0 auto; min-width: 27px; text-align: right; font-weight: 600; font-size: 11px; font-family: ${MONO_STACK}; }
.impact.bad { color: var(--bad); }
.impact.good { color: var(--good); }
.impact.zero { color: var(--muted-2); }
.factor .detail { color: var(--muted-2); }
.more-btn { margin-top: 5px; background: none; border: 0; padding: 0; color: var(--muted); font-size: 11px; font-family: inherit; cursor: pointer; text-decoration: underline dotted; }

.who { display: flex; gap: 10px; align-items: flex-start; }
.nick { font-size: 15px; font-weight: 600; letter-spacing: -.01em; word-break: break-word; }
.uid { font-family: ${MONO_STACK}; font-size: 11.5px; color: var(--muted); }
.meta-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 1px; }
.badges { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }

.status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 9px; }
.status-cell { display: flex; flex-direction: column; gap: 3px; padding: 7px 9px; border-radius: 0; background: var(--surface-2); border: 1px solid var(--line); }
.status-cell.bad { background: var(--bad-bg); border-color: var(--bad-line); }
.status-cell.warn { background: var(--warn-bg); border-color: var(--warn-line); }
.status-cell .k { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .4px; }
.status-cell .v { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; }
.status-cell.bad .v { color: var(--bad); }
.status-cell.warn .v { color: var(--warn); }

.tag-row { display: flex; gap: 5px; flex-wrap: wrap; }
.tag-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3.5px 9px; border-radius: 0; font-size: 11.5px; font-weight: 500; background: var(--bad-bg); border: 1px solid var(--bad-line); color: var(--bad); }
.tag-chip .n { font-weight: 600; font-family: ${MONO_STACK}; font-size: 11px; }
.tag-chip.mild { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }

.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.stat { padding: 8px 9px; border-radius: 0; background: var(--surface-2); border: 1px solid var(--line); }
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
.counter { padding: 7px 6px; border-radius: 0; background: var(--surface-2); border: 1px solid var(--line); text-align: center; }
.counter b { display: block; font-size: 13px; font-weight: 600; font-family: ${MONO_STACK}; }
.counter .ok { color: var(--good); }
.counter .bad { color: var(--bad); }
.counter .sep { color: var(--muted-2); margin: 0 1px; }
.counter span.k { display: block; font-size: 10px; color: var(--muted); margin-top: 2px; }

table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
th { text-align: left; font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: var(--muted); padding: 5px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 6px; border-bottom: 1px solid var(--line); }
tbody tr:last-child td { border-bottom: 0; }
td.num { text-align: right; font-family: ${MONO_STACK}; }
td.mono { font-family: ${MONO_STACK}; color: var(--muted); }
.buy { color: var(--good); font-weight: 600; }
.sell { color: var(--bad); font-weight: 600; }
.status-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 500; padding: 1.5px 7px; border-radius: 0; background: var(--surface-2); border: 1px solid var(--line); color: var(--text-2); white-space: nowrap; }
.status-chip.COMPLETED { background: var(--good-bg); border-color: var(--good-line); color: var(--good); }
.status-chip.CANCELLED { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); }
.status-chip.APPEALING { background: var(--warn-bg); border-color: var(--warn-line); color: var(--warn); }
.scroll-y { max-height: 168px; overflow-y: auto; }

.review { padding: 8px 0; border-top: 1px solid var(--line); }
.review:first-of-type { border-top: 0; padding-top: 0; }
.review-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.review-author { color: var(--text-2); font-weight: 500; }
.review-text { margin-top: 4px; font-size: 12.5px; color: var(--text); word-break: break-word; }
.review-ava { width: 20px; height: 20px; flex: 0 0 auto; border-radius: 0; display: grid; place-items: center; background: var(--surface-3); color: var(--muted); }

.req-row { display: flex; align-items: center; gap: 7px; padding: 6px 0; border-top: 1px solid var(--line); font-size: 12px; }
.req-row:first-of-type { border-top: 0; }
.req-mask { font-family: ${MONO_STACK}; flex: 1; }

.tag-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 7px; }
.tag-opt { display: flex; align-items: center; gap: 6px; padding: 7px 8px; border-radius: 0; border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2); font-size: 11.5px; font-weight: 500; cursor: pointer; font-family: inherit; text-align: left; }
.tag-opt.active { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); }
.tag-opt.active.neutral { background: var(--accent-bg); border-color: var(--accent-line); color: var(--accent); }

.rating-row { display: flex; gap: 5px; margin-bottom: 7px; }
.rating-btn { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 7px; border-radius: 0; border: 1px solid var(--line); background: var(--surface-2); color: var(--text-2); font-size: 11.5px; font-weight: 500; cursor: pointer; font-family: inherit; }
.rating-btn.POSITIVE.active { background: var(--good-bg); border-color: var(--good-line); color: var(--good); }
.rating-btn.NEUTRAL.active { background: var(--surface-3); border-color: var(--line-strong); color: var(--text); }
.rating-btn.NEGATIVE.active { background: var(--bad-bg); border-color: var(--bad-line); color: var(--bad); }

.templates { display: flex; gap: 5px; flex-wrap: wrap; }
.template-chip { padding: 5px 10px; border-radius: 0; border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--text-2); font-size: 11.5px; cursor: pointer; font-family: inherit; }
.template-chip:hover { background: var(--surface-3); color: var(--text); }
`;
}
