/**
 * Разведка страницы ордера Binance.
 *
 * Открыть реальный ордер, F12 → Console, вставить весь этот файл, Enter.
 * Результат сам ляжет в буфер обмена — останется вставить его в чат.
 *
 * Собирается только структура: теги, классы, размеры и placeholder'ы.
 * Тексты сообщений, суммы, ники и номера НЕ собираются.
 */
(() => {
  const MAX = (s, n = 120) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}…` : s);

  // короткий путь до узла, чтобы я мог сослаться на него в коде
  const path = (el) => {
    const parts = [];
    for (let node = el, depth = 0; node && node.nodeType === 1 && depth < 5; node = node.parentElement, depth += 1) {
      const tag = node.tagName.toLowerCase();
      const id = node.id ? `#${node.id}` : '';
      const cls =
        typeof node.className === 'string' && node.className.trim()
          ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
      parts.unshift(`${tag}${id}${cls}`);
    }
    return MAX(parts.join(' > '), 220);
  };

  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 20;
  };

  // ─────────────────── поле ввода сообщения ───────────────────

  const PLACEHOLDER_HINT = /сообщ|напиш|введ|message|type|chat/i;
  const CONTAINER_HINT = /chat|message|dialog|conversation/i;

  const scoreInput = (el) => {
    let p = 0;
    const ph = el.getAttribute('placeholder') ?? el.getAttribute('aria-label') ?? '';
    if (PLACEHOLDER_HINT.test(ph)) p += 40;
    for (let n = el, d = 0; n && d < 6; n = n.parentElement, d += 1) {
      if (CONTAINER_HINT.test(`${n.className ?? ''} ${n.id ?? ''}`)) {
        p += 25;
        break;
      }
    }
    if (el.tagName === 'TEXTAREA') p += 15;
    if (el.getBoundingClientRect().top > innerHeight * 0.45) p += 15;
    if (el.getBoundingClientRect().width > 220) p += 10;
    return p;
  };

  const inputs = [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')]
    .filter(visible)
    .map((el) => ({
      path: path(el),
      tag: el.tagName,
      placeholder: MAX(el.getAttribute('placeholder') ?? el.getAttribute('aria-label') ?? '', 60),
      rect: box(el),
      score: scoreInput(el),
    }))
    .sort((a, b) => b.score - a.score);

  // ─────────────────── контейнер чата ───────────────────

  // чат = блок с большим числом однотипных детей, вытянутый по вертикали
  const chatBoxes = [...document.querySelectorAll('div, section, main, aside')]
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const kids = el.children.length;
      const marker = `${el.className ?? ''} ${el.id ?? ''}`;
      let p = 0;
      if (CONTAINER_HINT.test(marker)) p += 40;
      if (kids >= 4) p += 15;
      if (r.height > 260) p += 15;
      if (r.width > 260 && r.width < 760) p += 10;
      if (el.scrollHeight > el.clientHeight + 40) p += 20;
      return { el, p, kids, rect: r };
    })
    .filter((c) => c.p >= 40)
    .sort((a, b) => b.p - a.p)
    .slice(0, 6)
    .map((c) => ({
      path: path(c.el),
      rect: box(c.el),
      children: c.kids,
      scrollable: c.el.scrollHeight > c.el.clientHeight + 40,
      score: c.p,
    }));

  // ─────────────────── крупные блоки раскладки ───────────────────

  const layout = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return visible(el) && r.width > 300 && r.height > 200 && el.children.length > 0;
    })
    .slice(0, 40)
    .map((el) => ({ path: path(el), rect: box(el), display: getComputedStyle(el).display }))
    .filter((x) => x.rect.h > 240)
    .slice(0, 18);

  // ─────────────────── что уже запрашивала страница ───────────────────

  const bapi = performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => /bapi|c2c|otc/i.test(u))
    .map((u) => {
      try {
        const p = new URL(u);
        return p.pathname;
      } catch {
        return MAX(u, 120);
      }
    });

  const report = {
    url: location.pathname + location.search.replace(/=[^&]+/g, '=…'),
    viewport: { w: innerWidth, h: innerHeight },
    iframes: [...document.querySelectorAll('iframe')].filter(visible).map((f) => ({
      src: MAX((f.getAttribute('src') ?? '').split('?')[0], 100),
      rect: box(f),
    })),
    panelMounted: Boolean(document.getElementById('p2p-guard-root')),
    inputCandidates: inputs.slice(0, 6),
    chatCandidates: chatBoxes,
    layout,
    bapiPaths: [...new Set(bapi)].slice(0, 90),
  };

  const text = JSON.stringify(report, null, 2);
  console.log(report);
  try {
    copy(text);
    console.log('%cГотово — отчёт скопирован в буфер обмена', 'color:#1a7f37;font-weight:600');
  } catch {
    console.log('Не удалось скопировать автоматически — выделите вывод выше и скопируйте вручную');
  }
  return report;
})();
