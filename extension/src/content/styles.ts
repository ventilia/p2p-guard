/**
 * Стили панели. Живут строкой, потому что монтируются в Shadow DOM:
 * так вёрстка Binance не может на нас повлиять, а мы — на неё.
 */
export const panelStyles = `
:host {
  all: initial;
}

* { box-sizing: border-box; }

.root {
  position: fixed;
  z-index: 2147483000;
  top: 84px;
  right: 20px;
  width: 372px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: #e8ecf3;
  background: #14171f;
  border: 1px solid #262b36;
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, .45);
  overflow: hidden;
}

.root.collapsed { max-height: none; }

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #191d27;
  border-bottom: 1px solid #262b36;
  cursor: grab;
  user-select: none;
}
.header:active { cursor: grabbing; }

.logo {
  width: 22px; height: 22px;
  display: grid; place-items: center;
  border-radius: 6px;
  background: linear-gradient(135deg, #f0b90b, #d99e00);
  color: #14171f;
  font-weight: 800;
  font-size: 12px;
  flex: none;
}

.title { font-weight: 700; font-size: 13px; letter-spacing: .2px; }
.spacer { flex: 1; }

.icon-btn {
  border: 0;
  background: transparent;
  color: #8b93a5;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
}
.icon-btn:hover { background: #232834; color: #e8ecf3; }

.body {
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: #2b3140; border-radius: 8px; }

.card {
  background: #191d27;
  border: 1px solid #262b36;
  border-radius: 10px;
  padding: 10px;
}

.card-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .6px;
  color: #7d8698;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.nick-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.nick { font-size: 16px; font-weight: 700; }
.uid { color: #7d8698; font-size: 11px; font-variant-numeric: tabular-nums; }

.risk {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid;
}
.risk-score {
  font-size: 22px;
  font-weight: 800;
  min-width: 42px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.risk-label { font-weight: 700; font-size: 13px; }
.risk-sub { color: #9aa3b5; font-size: 11px; }

.risk.LOW      { background: rgba(46,160,67,.10);  border-color: rgba(46,160,67,.45);  color: #4ade80; }
.risk.MEDIUM   { background: rgba(240,185,11,.10); border-color: rgba(240,185,11,.45); color: #f0b90b; }
.risk.HIGH     { background: rgba(255,138,0,.10);  border-color: rgba(255,138,0,.45);  color: #ff9f45; }
.risk.CRITICAL { background: rgba(240,68,68,.12);  border-color: rgba(240,68,68,.5);   color: #ff6b6b; }

.badges { display: flex; gap: 6px; flex-wrap: wrap; }
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid #2d3341;
  background: #1f242f;
  color: #b9c0cf;
}
.badge.danger  { background: rgba(240,68,68,.14);  border-color: rgba(240,68,68,.45);  color: #ff8080; }
.badge.warn    { background: rgba(240,185,11,.14); border-color: rgba(240,185,11,.4);  color: #f5c542; }
.badge.ok      { background: rgba(46,160,67,.14);  border-color: rgba(46,160,67,.4);   color: #6ee79a; }

.factors { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.factor { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #b9c0cf; }
.factor .impact {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  min-width: 34px;
  text-align: right;
}
.factor .impact.bad  { color: #ff8080; }
.factor .impact.good { color: #6ee79a; }
.factor .detail { color: #6f7889; }

.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat {
  background: #1c2029;
  border: 1px solid #262b36;
  border-radius: 8px;
  padding: 8px;
}
.stat-label { font-size: 10.5px; color: #7d8698; text-transform: uppercase; letter-spacing: .4px; }
.stat-value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
.stat-sub { font-size: 10.5px; color: #6f7889; }
.stat.danger { background: rgba(240,68,68,.08); border-color: rgba(240,68,68,.3); }

.counters { display: flex; gap: 6px; }
.counter {
  flex: 1;
  text-align: center;
  background: #1c2029;
  border: 1px solid #262b36;
  border-radius: 8px;
  padding: 6px 4px;
}
.counter b { display: block; font-size: 14px; font-variant-numeric: tabular-nums; }
.counter span { font-size: 10px; color: #7d8698; }
.counter.good b { color: #6ee79a; }
.counter.bad b  { color: #ff8080; }

.review {
  border-top: 1px solid #232834;
  padding-top: 8px;
  margin-top: 8px;
}
.review:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
.review-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #7d8698;
  margin-bottom: 3px;
}
.review-author { color: #b9c0cf; font-weight: 600; }
.review-text { font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.POSITIVE { background: #4ade80; }
.dot.NEUTRAL  { background: #7d8698; }
.dot.NEGATIVE { background: #ff6b6b; }

table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
th {
  text-align: left;
  font-weight: 600;
  color: #7d8698;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: .4px;
  padding-bottom: 5px;
}
td { padding: 4px 0; border-top: 1px solid #232834; font-variant-numeric: tabular-nums; }
td.buy  { color: #4ade80; font-weight: 700; }
td.sell { color: #ff6b6b; font-weight: 700; }
.status-chip { font-size: 10.5px; padding: 1px 6px; border-radius: 5px; background: #262b36; color: #b9c0cf; }
.status-chip.COMPLETED { background: rgba(46,160,67,.18); color: #6ee79a; }
.status-chip.CANCELLED { background: rgba(240,68,68,.16); color: #ff8080; }
.status-chip.APPEALING { background: rgba(240,185,11,.16); color: #f5c542; }

.req-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-top: 1px solid #232834;
  font-variant-numeric: tabular-nums;
}
.req-row:first-of-type { border-top: 0; }

.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.btn {
  flex: 1;
  min-width: 96px;
  border: 1px solid #2d3341;
  background: #1f242f;
  color: #e8ecf3;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover { background: #262b36; }
.btn.primary { background: #f0b90b; border-color: #f0b90b; color: #14171f; }
.btn.primary:hover { background: #ffc51f; }
.btn.danger { background: rgba(240,68,68,.16); border-color: rgba(240,68,68,.4); color: #ff8080; }
.btn.danger:hover { background: rgba(240,68,68,.26); }
.btn:disabled { opacity: .5; cursor: default; }

textarea, input, select {
  width: 100%;
  background: #1c2029;
  border: 1px solid #2d3341;
  border-radius: 8px;
  color: #e8ecf3;
  padding: 7px 9px;
  font-size: 12.5px;
  font-family: inherit;
  resize: vertical;
}
textarea:focus, input:focus, select:focus { outline: 0; border-color: #f0b90b; }

.rating-row { display: flex; gap: 6px; margin-bottom: 6px; }
.rating-btn {
  flex: 1;
  border: 1px solid #2d3341;
  background: #1c2029;
  color: #b9c0cf;
  border-radius: 8px;
  padding: 6px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.rating-btn.active.POSITIVE { border-color: #4ade80; color: #4ade80; }
.rating-btn.active.NEUTRAL  { border-color: #7d8698; color: #e8ecf3; }
.rating-btn.active.NEGATIVE { border-color: #ff6b6b; color: #ff6b6b; }

.templates { display: flex; flex-wrap: wrap; gap: 5px; }
.template-chip {
  border: 1px solid #2d3341;
  background: #1c2029;
  color: #b9c0cf;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11.5px;
  cursor: pointer;
  font-family: inherit;
}
.template-chip:hover { border-color: #f0b90b; color: #f0b90b; }

.muted { color: #7d8698; font-size: 12px; }
.center { text-align: center; padding: 18px 12px; }
.error {
  background: rgba(240,68,68,.1);
  border: 1px solid rgba(240,68,68,.35);
  color: #ff9b9b;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}
.hint { font-size: 11px; color: #6f7889; margin-top: 4px; }

.spinner {
  width: 18px; height: 18px;
  border: 2px solid #2d3341;
  border-top-color: #f0b90b;
  border-radius: 50%;
  animation: spin .8s linear infinite;
  margin: 0 auto 8px;
}
@keyframes spin { to { transform: rotate(360deg); } }

.fab {
  position: fixed;
  z-index: 2147483000;
  top: 84px;
  right: 20px;
  width: 42px; height: 42px;
  border-radius: 50%;
  border: 1px solid #262b36;
  background: #14171f;
  color: #f0b90b;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 10px 26px rgba(0,0,0,.4);
  font-family: inherit;
  font-size: 13px;
}
.fab .fab-dot {
  position: absolute;
  top: -2px; right: -2px;
  width: 12px; height: 12px;
  border-radius: 50%;
  border: 2px solid #14171f;
}
.fab .fab-dot.LOW      { background: #4ade80; }
.fab .fab-dot.MEDIUM   { background: #f0b90b; }
.fab .fab-dot.HIGH     { background: #ff9f45; }
.fab .fab-dot.CRITICAL { background: #ff4444; }
`;
