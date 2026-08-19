// макет страницы ордера Binance для стенда: раскладка и классы сняты с живой
// страницы, поэтому панель ищет чат тем же кодом, что и на бирже

const CSS = `
#pg-demo-order {
  position: fixed; inset: 0; z-index: 900;
  background: #181A20; color: #EAECEF;
  font-family: 'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  /* на бирже прокручивается сам документ, в макете — этот контейнер */
  overflow-y: auto;
}
#pg-demo-order * { box-sizing: border-box; }

#pg-demo-order .nav {
  height: 64px; display: flex; align-items: center; gap: 26px;
  padding: 0 24px; border-bottom: 1px solid #2B3139; background: #181A20;
}
#pg-demo-order .logo { color: #FCD535; font-weight: 700; letter-spacing: -.02em; }
#pg-demo-order .nav a { color: #EAECEF; font-size: 13px; opacity: .85; }
#pg-demo-order .nav .spacer { flex: 1; }
#pg-demo-order .close {
  border: 1px solid #2B3139; background: #1E2329; color: #EAECEF;
  padding: 6px 12px; font-size: 12px; cursor: pointer; font-family: inherit;
}
#pg-demo-order .ctl {
  display: flex; align-items: center; gap: 6px;
  color: #848E9C; font-size: 11px; white-space: nowrap;
}
#pg-demo-order .ctl input { width: 90px; accent-color: #FCD535; }

/* пропорции сняты с живой страницы, прокручивается сам документ */
#pg-demo-order .container { width: 972px; }
#pg-demo-order .body { display: flex; align-items: flex-start; padding-left: 24px; }
#pg-demo-order .order-col {
  width: 924px; padding: 0 0 40px;
}
#pg-demo-order .order-content { width: 588px; }

#pg-demo-order h2 { font-size: 22px; font-weight: 600; margin: 0 0 4px; }
#pg-demo-order h2 b { color: #FCD535; }
#pg-demo-order .order-no { color: #848E9C; font-size: 12.5px; margin-bottom: 24px; }
#pg-demo-order .order-no span { color: #EAECEF; }

#pg-demo-order .step { display: flex; gap: 12px; margin-bottom: 18px; }
#pg-demo-order .step-num {
  width: 22px; height: 22px; flex: 0 0 auto;
  display: grid; place-items: center;
  background: #FCD535; color: #181A20; font-size: 12px; font-weight: 700;
}
#pg-demo-order .step-title { font-size: 15px; font-weight: 600; }
#pg-demo-order .step-title small { color: #848E9C; font-weight: 400; margin-left: 6px; }

#pg-demo-order .box { border: 1px solid #2B3139; background: #1E2329; margin-top: 12px; }
#pg-demo-order .box-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px; border-bottom: 1px solid #2B3139;
}
#pg-demo-order .box-head b { color: #0ECB81; font-size: 15px; }
#pg-demo-order .row {
  display: flex; justify-content: space-between; gap: 16px;
  padding: 10px 14px; font-size: 13px;
}
#pg-demo-order .row + .row { border-top: 1px solid #2B3139; }
#pg-demo-order .row .k { color: #848E9C; }
#pg-demo-order .row .v { text-align: right; word-break: break-all; }

/* столбец чата: фиксированный и во всю высоту, как на бирже */
#pg-demo-order .chat-fixed {
  position: fixed; top: 64px; right: 0; width: 408px;
  height: calc(100vh - 64px);
  border-left: 1px solid #2B3139; background: #1E2329;
  display: flex; flex-direction: column; z-index: 999;
}
#pg-demo-order .chat-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px; border-bottom: 1px solid #2B3139; flex: 0 0 auto;
}
#pg-demo-order .ava {
  width: 36px; height: 36px; border-radius: 50%;
  background: #2B3139; display: grid; place-items: center;
  color: #848E9C; font-weight: 600;
}
#pg-demo-order .chat-body { flex: 1; overflow-y: auto; padding: 14px; }
#pg-demo-order .stat-box { border: 1px solid #2B3139; padding: 12px; margin-bottom: 14px; }
#pg-demo-order .stat-box h4 { margin: 0 0 10px; font-size: 12px; color: #848E9C; font-weight: 500; }
#pg-demo-order .stat-row {
  display: flex; justify-content: space-between; font-size: 12.5px; padding: 4px 0;
}
#pg-demo-order .stat-row span { color: #848E9C; }
#pg-demo-order .menu-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 13px 2px; border-bottom: 1px solid #2B3139;
  font-size: 13.5px; cursor: pointer;
}
#pg-demo-order .menu-item::after { content: '›'; color: #848E9C; }

#pg-demo-order .chat-input-area {
  flex: 0 0 auto; padding: 12px 14px; border-top: 1px solid #2B3139; background: #181A20;
}
#pg-demo-order .bn-textarea {
  border: 1px solid #2B3139; background: transparent; padding: 8px 10px;
  display: flex; align-items: flex-end; gap: 8px;
}
#pg-demo-order textarea.bn-textarea-input {
  flex: 1; resize: none; height: 22px;
  border: 0; outline: 0; background: transparent; color: #EAECEF;
  font-family: inherit; font-size: 13px;
}
#pg-demo-order .send-btn {
  border: 0; background: #FCD535; color: #181A20;
  padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
}
`;

const HTML = `
<div class="nav">
  <span class="logo">◆ BINANCE</span>
  <a>Купить криптовалюту</a><a>Рынки</a><a>Торговля</a><a>P2P</a>
  <span class="spacer"></span>
  <label class="ctl">Ширина панели<input type="range" id="pg-w" min="720" max="1600" step="20" value="720"></label>
  <button class="close" data-place="chat-bottom">Под чатом</button>
  <button class="close" data-place="floating">Свободно</button>
  <button class="close" id="pg-demo-close">Закрыть</button>
</div>

<div class="container">
<div class="body">
  <div class="order-col"><div class="order-content">
    <h2>Переведите оплату в течение <b>20:25</b></h2>
    <div class="order-no">Номер ордера <span>22922704071463526400</span></div>

    <div class="step">
      <span class="step-num">1</span>
      <div style="flex:1">
        <div class="step-title">Перевод через: Kaspi Bank <small>Советы при совершении оплаты</small></div>
        <div class="box">
          <div class="box-head"><span>Вы платите</span><b>₸ 5,000.00</b></div>
          <div class="row"><span class="k">ФИО</span><span class="v">MANGITBOYEV ZHASLAN</span></div>
          <div class="row"><span class="k">Номер счёта / карты</span><span class="v">https://pay.kaspi.kz/pay/q6zbonwd</span></div>
          <div class="row"><span class="k">Название банка</span><span class="v">Ип Zhasulan</span></div>
          <div class="row"><span class="k">Имя контрагента</span><span class="v">Jasik_2024</span></div>
        </div>
        <div class="box">
          <div class="box-head"><span>Детали ордера</span></div>
          <div class="row"><span class="k">Сумма в фиате</span><span class="v">₸ 5,000.00</span></div>
          <div class="row"><span class="k">Цена</span><span class="v">₸ 536.00</span></div>
          <div class="row"><span class="k">Количество к получению</span><span class="v">9.25 USDT</span></div>
        </div>
      </div>
    </div>

    <div class="step">
      <span class="step-num">2</span>
      <div class="step-title">Отправить квитанцию и уведомить продавца</div>
    </div>
    <div style="height:420px"></div>
  </div></div>

  <div class="chat-fixed">
    <div class="chat-head">
      <div class="ava">J</div>
      <div>
        <div style="font-weight:600">Jasik_2024</div>
        <div style="font-size:11.5px;color:#848E9C">был(а) 22 мин. назад</div>
      </div>
    </div>

    <div class="chat-body">
      <div class="stat-box">
        <h4>Обзор торговли</h4>
        <div class="stat-row"><span>Ордера за 30д</span><b>402 раз(а)</b></div>
        <div class="stat-row"><span>Выполненных заказов за 30д</span><b>99.26%</b></div>
        <div class="stat-row"><span>Средн. время перевода</span><b>4.64 мин</b></div>
        <div class="stat-row"><span>Средн. время оплаты</span><b>2.79 мин</b></div>
      </div>
      <div class="menu-item">Примечание</div>
      <div class="menu-item">Поиск в истории чата</div>
      <div class="menu-item">Поиск по ордерам</div>
      <div class="menu-item">Инфо P2P</div>
      <div class="menu-item">Пожаловаться</div>
    </div>

    <div class="chat-input-area">
      <div class="bn-textarea">
        <textarea class="bn-textarea-input" placeholder="Введите сообщение здесь"></textarea>
        <button class="send-btn">Отправить</button>
      </div>
    </div>
  </div>
</div>
</div>
`;

let host: HTMLElement | null = null;
let onCloseHook: (() => void) | null = null;

export function isOrderPageOpen(): boolean {
  return host !== null;
}

export function openOrderPage(
  onClose: () => void,
  onPlacement: (value: 'chat-bottom' | 'floating') => void,
  onChatSize: (patch: { panelWidth?: number }) => void,
): void {
  if (host) return;
  onCloseHook = onClose;

  const style = document.createElement('style');
  style.id = 'pg-demo-order-css';
  style.textContent = CSS;
  document.head.appendChild(style);

  host = document.createElement('div');
  host.id = 'pg-demo-order';
  // тем же классом биржа помечает свою тему, панель на него и смотрит
  host.className = 'theme-root dark';
  host.innerHTML = HTML;
  document.body.appendChild(host);

  host.querySelector('#pg-demo-close')?.addEventListener('click', () => closeOrderPage());

  for (const button of host.querySelectorAll<HTMLElement>('[data-place]')) {
    button.addEventListener('click', () => {
      onPlacement(button.dataset.place as 'chat-bottom' | 'floating');
    });
  }

  host.querySelector('#pg-w')?.addEventListener('input', (e) => {
    onChatSize({ panelWidth: Number((e.target as HTMLInputElement).value) });
  });
}

export function closeOrderPage(): void {
  if (!host) return;
  // панель успевает вернуть чату исходную высоту до того, как макет исчезнет
  onCloseHook?.();
  onCloseHook = null;
  host.remove();
  document.getElementById('pg-demo-order-css')?.remove();
  host = null;
}
