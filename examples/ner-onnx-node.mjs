/**
 * NER bez Dockera: lokalny FastPDN (ONNX int8) w Node przez transformers.js.
 *
 * Przygotowanie (jednorazowo):
 *   1. npm install @huggingface/transformers anonimizator
 *   2. Pobierz model (125 MB) z release'u projektu:
 *      https://github.com/karolpolikarp/anonimizator/releases/tag/models-fastpdn-onnx-v1
 *      i rozpakuj do ./models/fastpdn (obok tego pliku).
 *   3. node ner-onnx-node.mjs
 *
 * Model: clarin-pl/FastPDN (CC-BY-4.0, CLARIN-PL) — patrz ATTRIBUTION.md w paczce.
 * Wszystko działa offline: env.allowRemoteModels=false, zero żądań sieciowych.
 * Inferencja na CPU to kilkanaście ms na akapit.
 *
 * Selekcja/maskowanie osób to WSPÓLNY moduł rdzenia `anonimizator/ner-postprocess` — ta sama
 * logika (próg score, stoplisty, homonimy, lokalizacja bez offsetów) co w przeglądarce i benchmarku.
 */

import { pipeline, env } from '@huggingface/transformers';
import { redactPII } from 'anonimizator';
import { applyNerPersons } from 'anonimizator/ner-postprocess';

env.localModelPath = new URL('./models/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
env.allowRemoteModels = false;

const ner = await pipeline('token-classification', 'fastpdn', { dtype: 'q8' });

const tekst =
  'Wczoraj Bąkiewicz podpisał umowę z firmą. Zeznania Krzemienieckiej potwierdził ' +
  'świadek Gzowski, PESEL 44051401359, zamieszkały przy ul. Polnej 12/3.';

// 1) ZAWSZE najpierw warstwa deterministyczna (PESEL/adresy/sumy kontrolne).
const base = redactPII(tekst);

// 2) NER dokłada rzadkie/odmienione nazwiska — na tekście JUŻ zredagowanym.
const tokens = await ner(base.redacted, { ignore_labels: [] });
const { redacted } = applyNerPersons(base.redacted, tokens);

console.log('WEJŚCIE:\n' + tekst + '\n');
console.log('WYJŚCIE:\n' + redacted);
