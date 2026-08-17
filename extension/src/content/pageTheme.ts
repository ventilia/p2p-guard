// тема самой страницы биржи
//
// Binance помечает её классом на обёртке: div.theme-root.dark — это видно в
// разметке страницы ордера. Когда у пользователя выбрано «как в системе»,
// честнее подстроиться под биржу, а не под настройку ОС: панель висит на её
// странице, и светлая карточка поверх тёмного интерфейса выглядит чужеродной

export type PageTheme = 'light' | 'dark' | null;

export function detectPageTheme(): PageTheme {
  const root = document.querySelector('.theme-root');
  if (root) {
    if (root.classList.contains('dark')) return 'dark';
    if (root.classList.contains('light')) return 'light';
  }

  const marked = document.documentElement.dataset.theme ?? document.body?.dataset.theme;
  if (marked === 'dark' || marked === 'light') return marked;

  // запасной вариант: судим по яркости фона страницы
  const background = getComputedStyle(document.body ?? document.documentElement).backgroundColor;
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(background);
  if (!rgb) return null;

  const luma = 0.2126 * Number(rgb[1]) + 0.7152 * Number(rgb[2]) + 0.0722 * Number(rgb[3]);
  return luma < 128 ? 'dark' : 'light';
}

// биржа умеет переключать тему на лету, поэтому следим за классом обёртки
export function watchPageTheme(onChange: (theme: PageTheme) => void): () => void {
  const emit = () => onChange(detectPageTheme());

  const observer = new MutationObserver(emit);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
    subtree: true,
  });

  emit();
  return () => observer.disconnect();
}
