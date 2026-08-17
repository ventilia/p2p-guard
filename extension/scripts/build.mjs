// esbuild, а не Vite: content script в MV3 должен быть одним IIFE-бандлом
// прод включается флагом --prod: NODE_ENV=... в npm-скрипте на Windows не работает
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const dev = watch || !prod;

// адрес сервера задаётся при сборке: локально это localhost, для боевой
// версии — домен хостинга. Он же попадает в host_permissions манифеста,
// иначе service worker получит отказ ещё до запроса
const apiBaseUrl = process.env.PG_API_URL?.replace(/\/+$/, '') || 'http://localhost:4000/v1';

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  target: ['chrome114'],
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    __API_BASE_URL__: JSON.stringify(apiBaseUrl),
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
  await patchManifest();
}

// в манифест дописываем origin сервера: без него запросы из service worker
// блокируются, а понять это по симптомам тяжело
async function patchManifest() {
  const file = resolve(outdir, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));

  const origin = new URL(apiBaseUrl).origin;
  const pattern = `${origin}/*`;
  const permissions = manifest.host_permissions.filter(
    (p) => !/^https?:\/\/localhost/.test(p) || origin.startsWith('http://localhost'),
  );
  if (!permissions.includes(pattern)) permissions.push(pattern);

  manifest.host_permissions = permissions;
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}
`, 'utf8');
  console.log(`  API: ${apiBaseUrl}`);
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
    console.log(`\n✅ Собрано в extension/dist (${dev ? 'dev' : 'production'})`);
    console.log('   chrome://extensions → «Загрузить распакованное» → выбрать dist\n');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
