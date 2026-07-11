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

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildDataset, SEED } from './dataset.mjs';
import { redactPII } from '../../packages/core/dist/index.js';
import { redactPIIFull, nerHealthCheck } from '../../packages/core/dist/ner-client.js';
import { applyNerPersons } from '../../packages/core/dist/ner-postprocess.js';

// ── Ścieżki wyjściowe (względem pliku, nie CWD — runner działa z dowolnego katalogu) ──
const RESULTS_JSON = fileURLToPath(new URL('./results.json', import.meta.url));
const BENCHMARK_MD = fileURLToPath(new URL('../../docs/BENCHMARK.md', import.meta.url));
const CORE_PKG = fileURLToPath(new URL('../../packages/core/package.json', import.meta.url));

/** Timeout pojedynczego wywołania NER — hojny, bo HerBERT na CPU bywa wolny. */
const NER_TIMEOUT_MS = 20000;
/** Równoległość zapytań do usługi NER (lokalna usługa, nie przeciążamy). */
const CONCURRENCY = 4;

// ── Warstwa ONNX w Node (bez Dockera) — ta sama ścieżka co w przeglądarce ───────────────
// Aktywuje się TYLKO gdy zainstalowany jest `@huggingface/transformers` i lokalnie leży model
// (domyślnie scripts/benchmark/models/<id>/, nadpisywalne przez ONNX_MODELS_DIR/ONNX_MODEL_ID).
// Brak biblioteki lub modelu ⇒ warstwa pominięta z adnotacją — dokładnie jak warstwy HTTP.
const ONNX_MODELS_DIR = process.env.ONNX_MODELS_DIR
  ? process.env.ONNX_MODELS_DIR
  : fileURLToPath(new URL('./models/', import.meta.url));
const ONNX_MODEL_ID = process.env.ONNX_MODEL_ID || 'fastpdn';

let onnxPipe = null;
let onnxProbe = null; // memoizacja: null=niesprawdzone, true/false=wynik

async function onnxAvailable() {
  if (onnxProbe !== null) return onnxProbe;
  onnxProbe = await (async () => {
    const cfg = `${ONNX_MODELS_DIR.replace(/[\\/]$/, '')}/${ONNX_MODEL_ID}/config.json`;
    if (!existsSync(cfg)) return false; // model nie leży lokalnie
    try {
      const T = await import('@huggingface/transformers');
      T.env.allowRemoteModels = false; // zero sieci — model tylko lokalny
      T.env.localModelPath = ONNX_MODELS_DIR;
      onnxPipe = await T.pipeline('token-classification', ONNX_MODEL_ID, { dtype: 'q8' });
      return true;
    } catch {
      return false; // brak @huggingface/transformers albo błąd ładowania modelu
    }
  })();
  return onnxProbe;
}

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
  {
    name: 'core+onnx (Node)',
    desc: 'redactPII() + FastPDN ONNX int8 (q8) w Node przez @huggingface/transformers — bez Dockera',
    url: null,
    probe: onnxAvailable,
    skipReason: 'biblioteka @huggingface/transformers lub lokalny model ONNX niedostępne',
    run: async (text) => {
      const base = redactPII(text).redacted; // NER widzi tekst PO redakcji strukturalnej
      const tokens = await onnxPipe(base, { ignore_labels: [] });
      return applyNerPersons(base, tokens).redacted;
    },
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
// F1 = średnia harmoniczna recall i precision-proxy. Null, gdy którakolwiek składowa nie istnieje
// (np. negatywy nie mają recall) — F1 nie jest wtedy zdefiniowane.
const f1 = (r, p) => (r === null || p === null || r + p === 0 ? null : (2 * r * p) / (r + p));

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

  // Sonda dostępności warstw NER (HTTP: health-check; ONNX-Node: import biblioteki + lokalny
  // model). Warstwa niedostępna jest pomijana z adnotacją — fail-safe, jak w bibliotece.
  const activeLayers = [];
  const skippedLayers = [];
  const WARMUP = 'Rozgrzewka modelu: Jan Testowy z Warszawy.';
  for (const layer of LAYERS) {
    if (!layer.url && !layer.probe) {
      activeLayers.push(layer); // czysty rdzeń — zawsze dostępny, offline
      continue;
    }
    const ok = layer.probe ? await layer.probe() : await nerHealthCheck({ url: layer.url, timeoutMs: 5000 });
    if (ok) {
      // Rozgrzewka: pierwsze wywołanie modelu bywa wolne (ładowanie/JIT) — nie chcemy fałszywego
      // timeoutu ani otwarcia circuit breakera na starcie pomiaru.
      if (layer.url) {
        await redactPIIFull(WARMUP, { url: layer.url, timeoutMs: 60000 });
      } else {
        try {
          await layer.run(WARMUP);
        } catch {
          /* rozgrzewka nie może wywrócić biegu */
        }
      }
      activeLayers.push(layer);
      console.log(`✔ ${layer.name}: dostępna${layer.url ? ` (${layer.url})` : ''}`);
    } else {
      skippedLayers.push(layer);
      console.log(`✖ ${layer.name}: NIEDOSTĘPNA${layer.url ? ` (${layer.url})` : ''} — warstwa pominięta`);
    }
  }
  console.log('');

  // Pomiar per warstwa.
  const layerResults = [];
  for (const layer of activeLayers) {
    const isNer = Boolean(layer.url || layer.probe);
    const t0 = Date.now();
    const coreOutputs = isNer ? await mapPool(cases, 1, async (c) => redactPII(c.text).redacted) : null;
    // ONNX-Node ma jeden pipeline (CPU, nie zrównoleglamy) → concurrency 1; HTTP → CONCURRENCY.
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
      changedVsCore: isNer ? changedVsCore : null,
      recall: pct(agg.maskHit, agg.maskTotal),
      precision: pct(agg.keepHit, agg.keepTotal),
      f1: f1(pct(agg.maskHit, agg.maskTotal), pct(agg.keepHit, agg.keepTotal)),
      agg,
      perCategory: Object.fromEntries(
        [...perCat.entries()].map(([cat, v]) => [
          cat,
          {
            recall: pct(v.maskHit, v.maskTotal),
            precision: pct(v.keepHit, v.keepTotal),
            f1: f1(pct(v.maskHit, v.maskTotal), pct(v.keepHit, v.keepTotal)),
            ...v,
          },
        ]),
      ),
      failures,
      perCase,
    });

    console.log(
      `${layer.name}: recall ${fmtPct(pct(agg.maskHit, agg.maskTotal))}, ` +
        `precision ${fmtPct(pct(agg.keepHit, agg.keepTotal))}, ` +
        `F1 ${fmtPct(f1(pct(agg.maskHit, agg.maskTotal), pct(agg.keepHit, agg.keepTotal)))}, ` +
        `porażek: ${failures.length}, czas: ${(elapsedMs / 1000).toFixed(1)} s` +
        (isNer ? `, wynik różny od core w ${changedVsCore} przypadkach` : ''),
    );
  }

  // ── Tabele na stdout ──
  const catShort = {
    'osoby-podstawowe': 'os-podst',
    'osoby-odmiana': 'os-odmiana',
    'osoby-rzadkie': 'os-rzadkie',
    'osoby-rzadkie-ner': 'os-rz-ner',
    'osoby-slownik': 'os-slownik',
    strukturalne: 'struktur.',
    negatywy: 'negatywy',
  };

  console.log('\n=== RECALL (odsetek mustMask usuniętych) ===');
  printTable(layerResults, categories, catShort, 'recall');
  console.log('\n=== PRECISION-PROXY (odsetek mustKeep zachowanych) ===');
  printTable(layerResults, categories, catShort, 'precision');
  console.log('\n=== F1 (średnia harmoniczna recall i precision-proxy) ===');
  printTable(layerResults, categories, catShort, 'f1');

  // ── Zapis results.json ──
  const resultsPayload = {
    generatedAt: startedAt.toISOString(),
    seed: SEED,
    coreVersion,
    casesTotal: cases.length,
    mustMaskTotal: cases.reduce((a, c) => a + c.mustMask.length, 0),
    mustKeepTotal: cases.reduce((a, c) => a + c.mustKeep.length, 0),
    skippedLayers: skippedLayers.map((l) => ({
      name: l.name,
      url: l.url,
      reason: l.skipReason ?? 'usługa niedostępna (health-check)',
    })),
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

  // ── Bramka regresji (--check): gwarancje na warstwie DETERMINISTYCZNEJ (core), niezależne od
  //    modelu — działa w CI bez pobierania ONNX. Warstwy NER (gdy obecne) nie mogą OBNIŻYĆ recall
  //    ani precyzji względem core. ──
  if (process.argv.includes('--check')) {
    const core = layerResults.find((l) => l.changedVsCore === null); // tylko rdzeń nie jest warstwą NER
    const violations = [];
    if (!core) {
      violations.push('brak warstwy rdzenia (core) w wynikach');
    } else {
      // rdzeń MUSI utrzymać 100% recall tam, gdzie działa deterministycznie
      for (const cat of ['osoby-podstawowe', 'osoby-odmiana', 'osoby-rzadkie', 'osoby-slownik', 'strukturalne']) {
        const r = core.perCategory[cat]?.recall;
        if (r !== null && r !== undefined && r < 1) violations.push(`recall[${cat}] = ${fmtPct(r)} < 100% (regresja detekcji)`);
      }
      if (core.precision !== null && core.precision < 0.98) {
        violations.push(`precision-proxy = ${fmtPct(core.precision)} < 98% (nadmaskowanie)`);
      }
      // warstwy NER nie mogą pogorszyć core (recall ani precyzji łącznej)
      for (const lr of layerResults) {
        if (lr === core) continue;
        if (lr.recall !== null && core.recall !== null && lr.recall < core.recall - 1e-9) {
          violations.push(`${lr.name}: recall ${fmtPct(lr.recall)} < core ${fmtPct(core.recall)} (warstwa NER obniża ochronę)`);
        }
        if (lr.precision !== null && core.precision !== null && lr.precision < core.precision - 1e-9) {
          violations.push(`${lr.name}: precision ${fmtPct(lr.precision)} < core ${fmtPct(core.precision)} (warstwa NER nadmaskowuje)`);
        }
      }
    }
    if (violations.length) {
      console.error('\n❌ BRAMKA BENCHMARKU (--check) — regresja:');
      for (const v of violations) console.error('   - ' + v);
      process.exit(1);
    }
    console.log('\n✔ BRAMKA BENCHMARKU (--check): brak regresji (rdzeń w normie, warstwy NER nie obniżają ochrony).');
  }
}

function printTable(layerResults, categories, catShort, metric) {
  const col = (c) => (catShort[c] ?? c).padStart(11);
  const header = ['Warstwa'.padEnd(16), 'ŁĄCZNIE'.padStart(8), ...categories.map(col)].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const lr of layerResults) {
    const cells = categories.map((cat) => fmtPct(lr.perCategory[cat][metric]).padStart(11));
    console.log([lr.name.padEnd(16), fmtPct(lr[metric]).padStart(8), ...cells].join(' | '));
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
    const why = sl.skipReason ?? `usługa \`${sl.url}\` niedostępna w chwili uruchomienia (health-check)`;
    push(`- **${sl.name}** — POMINIĘTA: ${why}.`);
  }
  push('');
  push(`## Wyniki`);
  push('');
  push(`| Warstwa | Recall (łącznie) | Precision-proxy (łącznie) | F1 | Porażki (przypadki) | Czas | Wynik ≠ core |`);
  push(`|---|---|---|---|---|---|---|`);
  for (const lr of layerResults) {
    push(
      `| ${lr.name} | ${fmtPct(lr.recall)} (${lr.agg.maskHit}/${lr.agg.maskTotal}) | ` +
        `${fmtPct(lr.precision)} (${lr.agg.keepHit}/${lr.agg.keepTotal}) | ${fmtPct(lr.f1)} | ${lr.failures.length} | ` +
        `${(lr.elapsedMs / 1000).toFixed(1)} s | ${lr.changedVsCore === null ? '—' : `${lr.changedVsCore} przyp.`} |`,
    );
  }
  push('');
  push(`F1 liczone jako średnia harmoniczna recall i precision-proxy (łącznie po wszystkich kategoriach`);
  push(`z oboma rodzajami elementów; kategoria „negatywy" nie ma recall, więc nie wchodzi do składowej recall).`);
  push('');
  push(`### Recall per kategoria`);
  push('');
  push(`| Warstwa | ${categories.join(' | ')} |`);
  push(`|---|${categories.map(() => '---').join('|')}|`);
  for (const lr of layerResults) {
    push(`| ${lr.name} | ${categories.map((c) => fmtPct(lr.perCategory[c].recall)).join(' | ')} |`);
  }
  push('');
  push(`### F1 per kategoria`);
  push('');
  push(`| Warstwa | ${categories.join(' | ')} |`);
  push(`|---|${categories.map(() => '---').join('|')}|`);
  for (const lr of layerResults) {
    push(`| ${lr.name} | ${categories.map((c) => fmtPct(lr.perCategory[c].f1)).join(' | ')} |`);
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
  push(`- Kategoria **osoby-rzadkie-ner** to przypadki, które rdzeń deterministyczny PROWADZI`);
  push(`  ŚWIADOMIE do wycieku (nazwiska bez wyzwalacza i bez sufiksu -ski/-cki/-icz/-czyk oraz`);
  push(`  obce) — recall rdzenia jest tu z założenia niski (bliski 0%). Ta kategoria istnieje po to,`);
  push(`  by ZMIERZYĆ przewagę warstwy NER: uruchom benchmark z modelem ONNX, aby zobaczyć wzrost`);
  push(`  recall bez spadku precyzji na negatywach.`);
  push(`- Warstwę **core+onnx (Node)** aktywujesz bez Dockera: \`npm i -D @huggingface/transformers\``);
  push(`  oraz rozpakuj model do \`scripts/benchmark/models/fastpdn/\` (albo wskaż \`ONNX_MODELS_DIR\`).`);
  push(`  Bez biblioteki/modelu warstwa jest pomijana (fail-safe), a raport pokazuje tylko rdzeń.`);
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
