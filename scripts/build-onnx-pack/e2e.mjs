/**
 * Weryfikacja E2E warstwy NER w PRAWDZIWEJ przeglądarce (transformers.js + WASM).
 * Serwuje katalog (edycja AI `index.html` + paczka onnx: vendor/ + models/), ładuje model
 * przez WASM i sprawdza: rzadkie/obce nazwiska zamaskowane, homonim i instytucja — nietknięte.
 *
 * Wymaga: `npm i -D @playwright/test && npx playwright install chromium` (nie jest w zależnościach
 * projektu — to opcjonalne narzędzie deweloperskie). Patrz README.md.
 *
 * Użycie:
 *   E2E_SERVE="C:/…/dist-onnx-pack" [E2E_PORT=8137] node scripts/build-onnx-pack/e2e.mjs
 *   (katalog musi zawierać index.html — zbudowaną edycję AII — oraz vendor/ i models/).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('@playwright/test'));
} catch {
  console.error('Brak @playwright/test. Zainstaluj: npm i -D @playwright/test && npx playwright install chromium');
  process.exit(2);
}

const ROOT = resolve(process.env.E2E_SERVE ?? 'dist-onnx-pack');
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 8137;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = resolve(join(ROOT, rel));
    if (!file.startsWith(ROOT)) return void res.writeHead(403).end();
    const st = await stat(file).catch(() => null);
    if (!st?.isFile()) return void res.writeHead(404).end();
    const headers = {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      // izolacja cross-origin — onnxruntime-web może użyć wątków (SharedArrayBuffer)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (req.method === 'HEAD') return void res.writeHead(200, headers).end();
    res.writeHead(200, headers).end(await readFile(file));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`serwer: http://127.0.0.1:${PORT}  (katalog: ${ROOT})`);

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[console] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

let ok = true;
const check = (cond, msg) => (cond ? console.log('  ✓ ' + msg) : ((ok = false), console.log('  ✗ ' + msg)));

try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?nertest=onnx`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => /aktywny/.test(document.getElementById('ner-status')?.textContent ?? ''), {
    timeout: 120000,
  });
  console.log('  ✓ model załadowany w przeglądarce (status „aktywny")');

  const TEXT =
    'Umowę parafował Nguyen, a pełnomocnikiem był mecenas Schmidt. Lis przebiegł przez drogę. Orzekł Sąd Najwyższy.';
  await page.fill('#input', TEXT);
  await page.waitForFunction(
    () => (document.getElementById('output')?.textContent ?? '').includes('[IMIĘ I NAZWISKO]'),
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500);
  const out = ((await page.locator('#output').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  console.log('\n  WYNIK:', out, '\n');

  check(!out.includes('Nguyen'), 'obce nazwisko „Nguyen" zamaskowane (warstwa ONNX)');
  check(!out.includes('Schmidt'), 'obce nazwisko „Schmidt" zamaskowane (warstwa ONNX)');
  check(out.includes('Lis'), 'homonim „Lis" NIE zamaskowany (precyzja)');
  check(out.includes('Sąd Najwyższy'), 'instytucja „Sąd Najwyższy" NIE zamaskowana (stoplista)');
  await page.screenshot({ path: resolve(process.cwd(), 'e2e-screenshot.png'), fullPage: true });
} catch (e) {
  ok = false;
  console.log('  ✗ WYJĄTEK:', e.message, '\n' + logs.slice(-15).join('\n'));
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + (ok ? '✔ E2E PRZESZŁO' : '✗ E2E NIEUDANE'));
process.exit(ok ? 0 : 1);
