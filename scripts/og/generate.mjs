/**
 * Generator obrazów społecznościowych landingu (uruchamiany RĘCZNIE, nie w buildzie):
 *   - apps/landing/public/og.png              (1200×630 — og:image / twitter:image)
 *   - apps/landing/public/apple-touch-icon.png (180×180 — ikona na ekranie iOS)
 *
 * Renderuje kartę HTML w headless Chromium (playwright-core). Fonty marki wtapiane
 * base64 z apps/landing/src/fonts (lokalne woff2 — zgodnie z zasadą marki: zero CDN).
 * Znak marki = kopia parawanMark() z apps/landing/src/icons.ts (stałe barwy).
 *
 * Użycie:  node scripts/og/generate.mjs
 */
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fontsDir = path.join(root, 'apps', 'landing', 'src', 'fonts');
const outDir = path.join(root, 'apps', 'landing', 'public');

async function fontFace(file, family, weight) {
  const b64 = (await readFile(path.join(fontsDir, file))).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}

/* Znak marki „Parawan" — kopia parawanMark() z apps/landing/src/icons.ts. */
function parawanMark(primary = '#0B3D2E', light = '#859E97') {
  const pole = (x, y1) =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y1 + 176}" stroke="${primary}" stroke-width="14" stroke-linecap="round"/>`;
  return (
    '<svg viewBox="14 48 292 235" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible">' +
    `<polygon points="30,74 95,112 95,270 30,232" fill="${primary}"/>` +
    `<polygon points="95,112 160,74 160,232 95,270" fill="${light}"/>` +
    `<polygon points="160,74 225,112 225,270 160,232" fill="${primary}"/>` +
    `<polygon points="225,112 290,74 290,232 225,270" fill="${light}"/>` +
    `<path d="M30 74 L95 112 L160 74 L225 112 L290 74" fill="none" stroke="${primary}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` +
    pole(30, 56) + pole(95, 94) + pole(160, 56) + pole(225, 94) + pole(290, 56) +
    '</svg>'
  );
}

const fonts = [
  await fontFace('archivo-latin.woff2', 'Archivo', '100 900'),
  await fontFace('archivo-latinext.woff2', 'Archivo', '100 900'),
  await fontFace('plexmono-600-latin.woff2', 'IBM Plex Mono', '600'),
  await fontFace('plexmono-600-latinext.woff2', 'IBM Plex Mono', '600'),
].join('\n');

const chip = (label, color, bg, border) =>
  `<span style="font-family:'IBM Plex Mono';font-weight:600;font-size:22px;color:${color};background:${bg};border:2px solid ${border};border-radius:10px;padding:8px 18px;white-space:nowrap">[${label}]</span>`;

const ogHtml = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
${fonts}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;font-family:'Archivo',sans-serif;color:#17251e;
  background:radial-gradient(900px 500px at 18% -10%, rgba(11,61,46,.10), transparent 70%),
             radial-gradient(700px 420px at 105% 115%, rgba(185,121,31,.10), transparent 70%), #efede6;}
.card{position:relative;height:100%;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between}
.bar{position:absolute;top:0;left:0;right:0;height:8px;background:linear-gradient(90deg,#0b3d2e,#8a5a12)}
.brand{display:flex;align-items:center;gap:20px}
.brand .mk{width:74px;height:66px}
.brand b{font-size:44px;font-weight:900;letter-spacing:-.02em;text-transform:uppercase;color:#0b3d2e}
h1{font-size:62px;font-weight:900;letter-spacing:-.03em;line-height:1.08;color:#0b3d2e;max-width:1000px}
h1 .hl{color:#8a5a12}
.chips{display:flex;flex-wrap:wrap;gap:14px}
.foot{display:flex;align-items:center;gap:16px;font-family:'IBM Plex Mono';font-weight:600;font-size:22px;color:#566259}
.foot b{color:#0b3d2e}
.foot .sep{color:#8a5a12}
</style></head><body>
<div class="card">
  <div class="bar"></div>
  <div class="brand"><span class="mk">${parawanMark()}</span><b>Parawan</b></div>
  <h1>Usuń dane osobowe z&nbsp;tekstu, <span class="hl">zanim wyjdą z&nbsp;Twojego komputera.</span></h1>
  <div class="chips">
    ${chip('PESEL', '#8a5f00', 'rgba(217,169,73,.12)', 'rgba(217,169,73,.55)')}
    ${chip('IMIĘ I NAZWISKO', '#5b3fa8', 'rgba(165,150,232,.12)', 'rgba(165,150,232,.55)')}
    ${chip('NR-KONTA', '#127049', 'rgba(111,199,155,.12)', 'rgba(111,199,155,.55)')}
    ${chip('ADRES', '#2f5fc0', 'rgba(126,166,232,.12)', 'rgba(126,166,232,.55)')}
    ${chip('TELEFON', '#0c7288', 'rgba(103,200,220,.12)', 'rgba(103,200,220,.55)')}
  </div>
  <div class="foot"><b>parawan.karolwilczynski.com</b><span class="sep">·</span>100% lokalnie<span class="sep">·</span>offline<span class="sep">·</span>bez AI<span class="sep">·</span>open source</div>
</div>
</body></html>`;

const iconHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0}
body{width:180px;height:180px;overflow:hidden;background:#efede6;display:grid;place-items:center}
.mk{width:132px;height:118px}
</style></head><body><span class="mk">${parawanMark()}</span></body></html>`;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // Brak pobranego Chromium w cache — użyj systemowego Chrome/Edge.
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      return await chromium.launch({ channel: 'msedge' });
    }
  }
}

await mkdir(outDir, { recursive: true });
const browser = await launch();
try {
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await og.setContent(ogHtml, { waitUntil: 'networkidle' });
  await og.evaluate(() => document.fonts.ready);
  await writeFile(path.join(outDir, 'og.png'), await og.screenshot({ type: 'png' }));

  const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  await icon.setContent(iconHtml, { waitUntil: 'networkidle' });
  await writeFile(path.join(outDir, 'apple-touch-icon.png'), await icon.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}
console.log('Zapisano: apps/landing/public/og.png (1200×630) i apple-touch-icon.png (180×180)');
