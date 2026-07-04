/**
 * Benchmark precision/recall anonimizacji polskiego PII — runner (Node ESM, zero zależności).
 *
 * Warstwy porównywane:
 *   1. "T0+T1 core"   — czysta redakcja in-process: redactPII() (regex + sumy kontrolne
 *      + słownik imion/nazwisk); działa zawsze, offline.
 *   2. "core+spacy"   — redactPIIFull() z usługą NER spaCy (pl_core_news_lg) na
 *      http://127.0.0.1:8090 — NER widzi tekst PO redakcji strukturalnej.
 *   3. "core+fastpdn" — redactPIIFull() z usługą NER FastPDN/HerBERT (clarin-pl/FastPDN)
 *      na http://127.0.0.1:8091.
 *
 * Usługi NER są opcjonalne: przed startem robimy health-check (GET /health); niedostępna
 * warstwa jest pomijana z adnotacją w raporcie (fail-safe — dokładnie jak w bibliotece).
 *
 * Metryki (na poziomie POJEDYNCZYCH podłańcuchów, nie całych zdań):
 *   - recall           = odsetek elementów mustMask NIEOBECNYCH w wyniku redakcji
 *                        (element „przeszedł" = wyciek PII);
 *   - precision-proxy  = odsetek elementów mustKeep ZACHOWANYCH w wyniku
 *                        (element „zjedzony" = fałszywy pozytyw / nadmaskowanie).
 *
 * Wyjście:
 *   - czytelne tabele na stdout,
 *   - docs/BENCHMARK.md (tabele, metodologia, sekcja „Najczęstsze porażki"),
 *   - scripts/benchmark/results.json (pełny zrzut per przypadek).
 *
 * Uruchomienie (z katalogu głównego repo, po zbudowaniu rdzenia):
 *   npm run build -w anonimizator
 *   node scripts/benchmark/run.mjs
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildDataset, SEED } from './dataset.mjs';
import { redactPII } from '../../packages/core/dist/index.js';
import { redactPIIFull, nerHealthCheck } from '../../packages/core/dist/ner-client.js';

// ── Ścieżki wyjściowe (względem pliku, nie CWD — runner działa z dowolnego katalogu) ──
const RESULTS_JSON = fileURLToPath(new URL('./results.json', import.meta.url));
const BENCHMARK_MD = fileURLToPath(new URL('../../docs/BENCHMARK.md', import.meta.url));
const CORE_PKG = fileURLToPath(new URL('../../packages/core/package.json', import.meta.url));

/** Timeout pojedynczego wywołania NER — hojny, bo HerBERT na CPU bywa wolny. */
const NER_TIMEOUT_MS = 20000;
/** Równoległość zapytań do usługi NER (lokalna usługa, nie przeciążamy). */
const CONCURRENCY = 4;

// ── Definicje warstw ──
const LAYERS = [
  {
    name: 'T0+T1 core',
    desc: 'redactPII() — regex + sumy kontrolne + słownik (in-process, offline)',
    url: null,
    run: async (text) => redactPII(text).redacted,
  },
  {
    name: 'core+spacy',
    desc: 'redactPIIFull() + NER spaCy pl_core_news_lg (127.0.0.1:8090)',
    url: 'http://127.0.0.1:8090',
    run: async (text) =>
      (await redactPIIFull(text, { url: 'http://127.0.0.1:8090', timeoutMs: NER_TIMEOUT_MS })).redacted,
  },
  {
    name: 'core+fastpdn',
    desc: 'redactPIIFull() + NER FastPDN/HerBERT (127.0.0.1:8091)',
    url: 'http://127.0.0.1:8091',
    run: async (text) =>
      (await redactPIIFull(text, { url: 'http://127.0.0.1:8091', timeoutMs: NER_TIMEOUT_MS })).redacted,
  },
];

// ── Pomocnicze ──

/** Prosty limiter równoległości (bez zależności zewnętrznych). */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const pct = (num, den) => (den === 0 ? null : num / den);
const fmtPct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

/** Ocena jednego przypadku: co przeszło (wyciek) i co zostało zjedzone (nadmaskowanie). */
function evaluateCase(c, redacted) {
  const leaked = c.mustMask.filter((s) => redacted.includes(s));
  const eaten = c.mustKeep.filter((s) => !redacted.includes(s));
  return { leaked, eaten };
}

// ── Główny przebieg ──

async function main() {
  const startedAt = new Date();
  const coreVersion = JSON.parse(readFileSync(CORE_PKG, 'utf8')).version;
  const { cases } = buildDataset();
  const categories = [...new Set(cases.map((c) => c.category))];

  console.log(`Benchmark anonimizatora — ${cases.length} przypadków (seed ${SEED}), core v${coreVersion}\n`);

  // Health-check usług NER; warstwa bez zdrowej usługi jest pomijana z adnotacją.
  const activeLayers = [];
  const skippedLayers = [];
  for (const layer of LAYERS) {
    if (!layer.url) {
      activeLayers.push(layer);
      continue;
    }
    const healthy = await nerHealthCheck({ url: layer.url, timeoutMs: 5000 });
    if (healthy) {
      // Rozgrzewka: pierwsze wywołanie modelu bywa wolne — nie chcemy fałszywego timeoutu
      // ani otwarcia circuit breakera na starcie pomiaru.
      await redactPIIFull('Rozgrzewka modelu: Jan Testowy z Warszawy.', {
        url: layer.url,
        timeoutMs: 60000,
      });
      activeLayers.push(layer);
      console.log(`✔ ${layer.name}: usługa dostępna (${layer.url})`);
    } else {
      skippedLayers.push(layer);
      console.log(`✖ ${layer.name}: usługa NIEDOSTĘPNA (${layer.url}) — warstwa pominięta`);
    }
  }
  console.log('');

  // Pomiar per warstwa.
  const layerResults = [];
  for (const layer of activeLayers) {
    const t0 = Date.now();
    const coreOutputs = layer.url ? await mapPool(cases, 1, async (c) => redactPII(c.text).redacted) : null;
    const outputs = await mapPool(cases, layer.url ? CONCURRENCY : 1, (c) => layer.run(c.text));
    const elapsedMs = Date.now() - t0;

    // Agregacja metryk: globalnie i per kategoria.
    const agg = { maskTotal: 0, maskHit: 0, keepTotal: 0, keepHit: 0 };
    const perCat = new Map(categories.map((cat) => [cat, { maskTotal: 0, maskHit: 0, keepTotal: 0, keepHit: 0 }]));
    const failures = [];
    const perCase = [];
    let changedVsCore = 0;

    cases.forEach((c, i) => {
      const redacted = outputs[i];
      const { leaked, eaten } = evaluateCase(c, redacted);
      const cat = perCat.get(c.category);
      agg.maskTotal += c.mustMask.length;
      agg.maskHit += c.mustMask.length - leaked.length;
      agg.keepTotal += c.mustKeep.length;
      agg.keepHit += c.mustKeep.length - eaten.length;
      cat.maskTotal += c.mustMask.length;
      cat.maskHit += c.mustMask.length - leaked.length;
      cat.keepTotal += c.mustKeep.length;
      cat.keepHit += c.mustKeep.length - eaten.length;
      if (coreOutputs && redacted !== coreOutputs[i]) changedVsCore++;
      if (leaked.length > 0 || eaten.length > 0) {
        failures.push({ id: c.id, category: c.category, text: c.text, leaked, eaten, redacted });
      }
      perCase.push({ id: c.id, leaked, eaten });
    });

    layerResults.push({
      name: layer.name,
      desc: layer.desc,
      elapsedMs,
      changedVsCore: layer.url ? changedVsCore : null,
      recall: pct(agg.maskHit, agg.maskTotal),
      precision: pct(agg.keepHit, agg.keepTotal),
      agg,
      perCategory: Object.fromEntries(
        [...perCat.entries()].map(([cat, v]) => [
          cat,
          { recall: pct(v.maskHit, v.maskTotal), precision: pct(v.keepHit, v.keepTotal), ...v },
        ]),
      ),
      failures,
      perCase,
    });

    console.log(
      `${layer.name}: recall ${fmtPct(pct(agg.maskHit, agg.maskTotal))}, ` +
        `precision ${fmtPct(pct(agg.keepHit, agg.keepTotal))}, ` +
        `porażek: ${failures.length}, czas: ${(elapsedMs / 1000).toFixed(1)} s` +
        (layer.url ? `, wynik różny od core w ${changedVsCore} przypadkach` : ''),
    );
  }

  // ── Tabele na stdout ──
  const catShort = {
    'osoby-podstawowe': 'os-podst',
    'osoby-odmiana': 'os-odmiana',
    'osoby-rzadkie': 'os-rzadkie',
    strukturalne: 'struktur.',
    negatywy: 'negatywy',
  };

  console.log('\n=== RECALL (odsetek mustMask usuniętych) ===');
  printTable(layerResults, categories, catShort, 'recall');
  console.log('\n=== PRECISION-PROXY (odsetek mustKeep zachowanych) ===');
  printTable(layerResults, categories, catShort, 'precision');

  // ── Zapis results.json ──
  const resultsPayload = {
    generatedAt: startedAt.toISOString(),
    seed: SEED,
    coreVersion,
    casesTotal: cases.length,
    mustMaskTotal: cases.reduce((a, c) => a + c.mustMask.length, 0),
    mustKeepTotal: cases.reduce((a, c) => a + c.mustKeep.length, 0),
    skippedLayers: skippedLayers.map((l) => ({ name: l.name, url: l.url, reason: 'usługa niedostępna (health-check)' })),
    layers: layerResults.map(({ perCase, failures, ...rest }) => ({
      ...rest,
      failures,
      perCase,
    })),
  };
  writeFileSync(RESULTS_JSON, JSON.stringify(resultsPayload, null, 2) + '\n', 'utf8');
  console.log(`\nZapisano: ${RESULTS_JSON}`);

  // ── Zapis docs/BENCHMARK.md ──
  writeFileSync(BENCHMARK_MD, buildMarkdown({ startedAt, coreVersion, cases, categories, layerResults, skippedLayers }), 'utf8');
  console.log(`Zapisano: ${BENCHMARK_MD}`);
}

function printTable(layerResults, categories, catShort, metric) {
  const header = ['Warstwa'.padEnd(14), 'ŁĄCZNIE'.padStart(8), ...categories.map((c) => catShort[c].padStart(11))].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const lr of layerResults) {
    const cells = categories.map((cat) => fmtPct(lr.perCategory[cat][metric]).padStart(11));
    console.log([lr.name.padEnd(14), fmtPct(lr[metric]).padStart(8), ...cells].join(' | '));
  }
}

// ── Generowanie raportu Markdown ──

function buildMarkdown({ startedAt, coreVersion, cases, categories, layerResults, skippedLayers }) {
  const date = startedAt.toISOString().slice(0, 10);
  const perCatCount = new Map();
  for (const c of cases) perCatCount.set(c.category, (perCatCount.get(c.category) ?? 0) + 1);
  const mustMaskTotal = cases.reduce((a, c) => a + c.mustMask.length, 0);
  const mustKeepTotal = cases.reduce((a, c) => a + c.mustKeep.length, 0);

  const lines = [];
  const push = (...xs) => lines.push(...xs);

  push(`# Benchmark anonimizacji — precision / recall`);
  push('');
  push(`- **Data uruchomienia:** ${date}`);
  push(`- **Wersja rdzenia (\`anonimizator\`):** ${coreVersion}`);
  push(`- **Zbiór ewaluacyjny:** ${cases.length} syntetycznych zdań (deterministyczny, seed \`${SEED}\`), ` +
    `${mustMaskTotal} elementów do zamaskowania (mustMask), ${mustKeepTotal} elementów do zachowania (mustKeep)`);
  push(`- **Reprodukcja:** \`npm run build -w anonimizator && node scripts/benchmark/run.mjs\``);
  push('');
  push(`## Metodologia`);
  push('');
  push(`Każdy przypadek testowy to zdanie z listą **mustMask** (dokładne podłańcuchy, które MUSZĄ`);
  push(`zniknąć z wyniku redakcji — PESEL-e, nazwiska w odmianie itd.) oraz **mustKeep** (podłańcuchy,`);
  push(`które MUSZĄ pozostać — numery przepisów, sygnatury akt, instytucje, homonimy nazwisk).`);
  push('');
  push(`- **recall** — odsetek elementów mustMask nieobecnych w wyniku (miara skuteczności anonimizacji;`);
  push(`  element obecny w wyniku = wyciek danych osobowych);`);
  push(`- **precision-proxy** — odsetek elementów mustKeep zachowanych w wyniku (miara nadmaskowania;`);
  push(`  element usunięty = fałszywy pozytyw, który psuje użyteczność tekstu).`);
  push('');
  push(`Wszystkie identyfikatory w zbiorze mają **poprawne sumy kontrolne** policzone w generatorze`);
  push(`(PESEL, NIP, REGON, IBAN mod-97, nr dowodu), a negatywy zawierają m.in. ciągi o celowo`);
  push(`**błędnych** sumach kontrolnych — silnik ma je zostawić w spokoju.`);
  push('');
  push(`Liczności kategorii: ${[...perCatCount.entries()].map(([c, n]) => `${c} — ${n}`).join(', ')}.`);
  push('');
  push(`### Warstwy`);
  push('');
  for (const lr of layerResults) push(`- **${lr.name}** — ${lr.desc}`);
  for (const sl of skippedLayers) {
    push(`- **${sl.name}** — POMINIĘTA: usługa \`${sl.url}\` niedostępna w chwili uruchomienia (health-check).`);
  }
  push('');
  push(`## Wyniki`);
  push('');
  push(`| Warstwa | Recall (łącznie) | Precision-proxy (łącznie) | Porażki (przypadki) | Czas | Wynik ≠ core |`);
  push(`|---|---|---|---|---|---|`);
  for (const lr of layerResults) {
    push(
      `| ${lr.name} | ${fmtPct(lr.recall)} (${lr.agg.maskHit}/${lr.agg.maskTotal}) | ` +
        `${fmtPct(lr.precision)} (${lr.agg.keepHit}/${lr.agg.keepTotal}) | ${lr.failures.length} | ` +
        `${(lr.elapsedMs / 1000).toFixed(1)} s | ${lr.changedVsCore === null ? '—' : `${lr.changedVsCore} przyp.`} |`,
    );
  }
  push('');
  push(`### Recall per kategoria`);
  push('');
  push(`| Warstwa | ${categories.join(' | ')} |`);
  push(`|---|${categories.map(() => '---').join('|')}|`);
  for (const lr of layerResults) {
    push(`| ${lr.name} | ${categories.map((c) => fmtPct(lr.perCategory[c].recall)).join(' | ')} |`);
  }
  push('');
  push(`### Precision-proxy per kategoria`);
  push('');
  push(`| Warstwa | ${categories.join(' | ')} |`);
  push(`|---|${categories.map(() => '---').join('|')}|`);
  for (const lr of layerResults) {
    push(`| ${lr.name} | ${categories.map((c) => fmtPct(lr.perCategory[c].precision)).join(' | ')} |`);
  }
  push('');
  push(`(„—" = brak elementów danego rodzaju w kategorii, np. negatywy nie mają mustMask.)`);
  push('');
  push(`## Najczęstsze porażki`);
  push('');
  push(`Legenda: **przeszło** = element mustMask pozostał w wyniku (wyciek PII);`);
  push(`**zjedzono** = element mustKeep został zamaskowany (fałszywy pozytyw).`);
  push('');
  for (const lr of layerResults) {
    push(`### ${lr.name} — ${lr.failures.length} przypadków z porażką`);
    push('');
    if (lr.failures.length === 0) {
      push(`Brak porażek.`);
      push('');
      continue;
    }
    const leaks = lr.failures.filter((f) => f.leaked.length > 0);
    const eats = lr.failures.filter((f) => f.eaten.length > 0);
    if (leaks.length > 0) {
      push(`**Wycieki (przeszło ${leaks.reduce((a, f) => a + f.leaked.length, 0)} elem. w ${leaks.length} przypadkach):**`);
      push('');
      for (const f of leaks) {
        push(`- \`${f.id}\` (${f.category}): przeszło ${f.leaked.map((s) => `„${s}"`).join(', ')} — tekst: _${f.text}_`);
      }
      push('');
    }
    if (eats.length > 0) {
      push(`**Nadmaskowania (zjedzono ${eats.reduce((a, f) => a + f.eaten.length, 0)} elem. w ${eats.length} przypadkach):**`);
      push('');
      for (const f of eats) {
        push(`- \`${f.id}\` (${f.category}): zjedzono ${f.eaten.map((s) => `„${s}"`).join(', ')} — wynik: _${f.redacted}_`);
      }
      push('');
    }
  }
  push(`## Uwagi`);
  push('');
  push(`- Zbiór jest w pełni syntetyczny — wszystkie dane (PESEL-e, nazwiska, adresy) zostały`);
  push(`  wygenerowane albo wymyślone; nie zawierają danych rzeczywistych osób.`);
  push(`- Kolumna „Wynik ≠ core" pokazuje, w ilu przypadkach warstwa NER faktycznie zmieniła`);
  push(`  wynik względem czystego rdzenia — wartość bliska zeru sugerowałaby, że usługa NER`);
  push(`  nie działała podczas pomiaru (fail-safe po cichu wraca do rdzenia).`);
  push(`- Usługi NER widzą tekst już po redakcji strukturalnej (PESEL/NIP/IBAN zamaskowane`);
  push(`  in-process), zgodnie z architekturą \`redactPIIFull\`.`);
  push(`- Metryka precision jest przybliżeniem (proxy): mierzy tylko zachowanie wskazanych`);
  push(`  podłańcuchów mustKeep, a nie wszystkich nie-PII tokenów w zdaniu.`);
  push('');
  return lines.join('\n');
}

main().catch((err) => {
  console.error('Benchmark zakończony błędem:', err);
  process.exit(1);
});
