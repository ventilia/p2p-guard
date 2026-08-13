/**
 * Сборка расширения на esbuild.
 *
 * Почему не Vite: content script в MV3 не может быть ES-модулем, ему нужен
 * один самодостаточный IIFE-бандл. esbuild даёт это без плагинов и без бет.
 *
 *   node scripts/build.mjs           — разовая сборка
 *   node scripts/build.mjs --watch   — пересборка на лету
 */
import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.env.NODE_ENV !== 'production';

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  target: ['chrome114'],
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
  },
};

const targets = [
  {
    entryPoints: [resolve(root, 'src/background/index.ts')],
    outfile: resolve(outdir, 'background.js'),
    format: 'esm', // service worker в MV3 объявлен как "type": "module"
  },
  {
    entryPoints: [resolve(root, 'src/content/index.tsx')],
    outfile: resolve(outdir, 'content.js'),
    format: 'iife',
  },
  {
    entryPoints: [resolve(root, 'src/page/hook.ts')],
    outfile: resolve(outdir, 'page-hook.js'),
    format: 'iife',
  },
  {
    entryPoints: [resolve(root, 'src/popup/main.tsx')],
    outfile: resolve(outdir, 'popup.js'),
    format: 'iife',
  },
];

async function copyStatic() {
  await cp(resolve(root, 'public'), outdir, { recursive: true });
}

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await copyStatic();

  if (watch) {
    const contexts = await Promise.all(
      targets.map((t) => context({ ...common, ...t })),
    );
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('\n👀 Watch-режим. Правки пересобираются автоматически.');
    console.log('   После правки manifest.json/иконок перезапустите сборку.\n');
  } else {
    await Promise.all(targets.map((t) => build({ ...common, ...t })));
    console.log('\n✅ Собрано в extension/dist');
    console.log('   chrome://extensions → «Загрузить распакованное» → выбрать dist\n');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
