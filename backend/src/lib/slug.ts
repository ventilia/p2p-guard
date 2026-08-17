// кириллицу оставляем: команды называют по-русски, транслитерация читается хуже
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
