/**
 * Reprodukowalny build paczki „onnx-pack" (vendor + model) dla warstwy NER w przeglądarce.
 *
 * Składa katalog gotowy do położenia OBOK index.html (edycja AI):
 *   <out>/vendor/transformers.web.min.js   — bundel transformers.js (esbuild, browser/ESM)
 *   <out>/vendor/ort-wasm-simd-threaded.*   — runtime WASM onnxruntime-web (ładowany w runtime)
 *   <out>/models/anonimizator/fastpdn/…     — model FastPDN ONNX int8 (config + onnx + tokenizer)
 *
 * Vendor JS i pliki ort MUSZĄ pochodzić z TEJ SAMEJ wersji onnxruntime-web (spójność ABI) —
 * dlatego oba bierzemy z zainstalowanego `@huggingface/transformers` / `onnxruntime-web`.
 *
 * Model: konwersja z clarin-pl/FastPDN do ONNX int8 jest ciężka (Python + optimum) — patrz
 * README.md. W praktyce podaj gotowy model przez `--model-dir <ścieżka>` (np. rozpakowany
 * `fastpdn-onnx-int8.zip` z release'u models-fastpdn-onnx-v1) albo umieść go wcześniej w <out>.
 *
 * Użycie:
 *   node scripts/build-onnx-pack/build.mjs [--out dist-onnx-pack] [--model-dir <ścieżka-do-modelu>]
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, readdir, rm, access, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const OUT = resolve(REPO, arg('--out', 'dist-onnx-pack'));
const MODEL_SRC = arg('--model-dir', null);
const ORT_DIST = resolve(REPO, 'node_modules/onnxruntime-web/dist');
const MODEL_DST = join(OUT, 'models/anonimizator/fastpdn');

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'vendor'), { recursive: true });

  // 1) Vendor JS — bundel transformers.js (browser/ESM). ner-browser.ts robi `await import(url)`
  //    i czyta `T.pipeline` / `T.env`, więc format MUSI być ESM z tymi eksportami.
  const res = await esbuild.build({
    entryPoints: [join(HERE, 'vendor-entry.mjs')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    outfile: join(OUT, 'vendor/transformers.web.min.js'),
    logLevel: 'silent',
  });
  if (res.errors?.length) throw new Error('esbuild: ' + JSON.stringify(res.errors));
  console.log('✔ vendor/transformers.web.min.js (esbuild, browser/ESM)');

  // 2) Runtime WASM onnxruntime-web (ta sama wersja co w bundlu). Ładowane przez env.wasmPaths.
  if (!existsSync(ORT_DIST)) throw new Error(`Brak ${ORT_DIST} — uruchom najpierw npm ci / npm i.`);
  const ort = (await readdir(ORT_DIST)).filter((f) => /^ort-wasm-simd-threaded\..*\.(mjs|wasm)$/.test(f) || /^ort-wasm-simd-threaded\.(mjs|wasm)$/.test(f));
  for (const f of ort) await cp(join(ORT_DIST, f), join(OUT, 'vendor', f));
  console.log(`✔ vendor/ort-wasm-simd-threaded.* (${ort.length} plików z onnxruntime-web)`);

  // 3) Model
  if (MODEL_SRC) {
    await mkdir(MODEL_DST, { recursive: true });
    await cp(resolve(MODEL_SRC), MODEL_DST, { recursive: true });
    console.log(`✔ models/anonimizator/fastpdn/ (skopiowano z ${MODEL_SRC})`);
  } else if (existsSync(join(MODEL_DST, 'config.json'))) {
    console.log('✔ models/anonimizator/fastpdn/ (już obecny w <out>)');
  } else {
    console.log('\n⚠ MODEL nie dostarczony. Podaj `--model-dir <ścieżka>` (rozpakowany model FastPDN');
    console.log('  ONNX int8) albo umieść go w models/anonimizator/fastpdn/. Źródło modelu:');
    console.log('  https://github.com/karolpolikarp/anonimizator/releases/tag/models-fastpdn-onnx-v1');
    console.log('  (konwersja z clarin-pl/FastPDN — patrz scripts/build-onnx-pack/README.md).');
  }

  // Kontrola spójności: config modelu powinien deklarować etykietę osobową nam_liv_person.
  try {
    const cfg = JSON.parse(await readFile(join(MODEL_DST, 'config.json'), 'utf8'));
    const labels = Object.values(cfg.id2label ?? {});
    const hasPerson = labels.some((l) => String(l).includes('nam_liv_person'));
    console.log(`  model: etykiety=${labels.length}, nam_liv_person=${hasPerson ? 'tak' : 'BRAK (?)'} `);
  } catch {
    /* model może być jeszcze niedostarczony */
  }

  console.log(`\nGotowe: ${OUT}`);
  console.log('Weryfikacja: skopiuj zbudowany apps/web/dist/index.html do <out> i zserwuj po http(s)');
  console.log('(patrz README.md — sekcja „Weryfikacja E2E").');
}

main().catch((e) => {
  console.error('build-onnx-pack błąd:', e.message);
  process.exit(1);
});
