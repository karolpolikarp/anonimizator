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
 */

import { pipeline, env } from '@huggingface/transformers';
import { redactPII } from 'anonimizator';

env.localModelPath = new URL('./models/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
env.allowRemoteModels = false;

const LETTERS = /[a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ-]/;

/** Sklej sąsiadujące tokeny osobowe (B-/I-nam_liv_person) w kandydatów-napisy. */
function personCandidates(tokens) {
  const out = [];
  let current = '';
  for (const t of tokens) {
    if (String(t.entity).includes('nam_liv_person')) {
      current += t.word;
    } else if (current) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  // odetnij znaki spoza słowa na brzegach (tokeny potrafią dokleić kropkę)
  return out
    .map((c) => c.replace(/^[^\p{L}]+|[^\p{L}-]+$/gu, ''))
    .filter((c) => c.length >= 2 && LETTERS.test(c));
}

/**
 * Zamaskuj kandydata, rozszerzając trafienie do granic słowa — model bywa „częściowy"
 * (np. tylko „Gz" z „Gzowski", gdy dalsze subwordy wypadną poniżej progu).
 */
function maskCandidate(text, cand) {
  let out = text;
  let from = 0;
  for (;;) {
    const idx = out.indexOf(cand, from);
    if (idx === -1) return out;
    let s = idx;
    let e = idx + cand.length;
    while (s > 0 && LETTERS.test(out[s - 1])) s--;
    while (e < out.length && LETTERS.test(out[e])) e++;
    const mask = '[IMIĘ I NAZWISKO]';
    out = out.slice(0, s) + mask + out.slice(e);
    from = s + mask.length;
  }
}

const ner = await pipeline('token-classification', 'fastpdn', { dtype: 'q8' });

const tekst =
  'Wczoraj Bąkiewicz podpisał umowę z firmą. Zeznania Krzemienieckiej potwierdził ' +
  'świadek Gzowski, PESEL 44051401359, zamieszkały przy ul. Polnej 12/3.';

// 1) ZAWSZE najpierw warstwa deterministyczna (PESEL/adresy/sumy kontrolne).
const base = redactPII(tekst);

// 2) NER dokłada rzadkie/odmienione nazwiska — na tekście JUŻ zredagowanym.
const tokens = await ner(base.redacted, { ignore_labels: [] });
let redacted = base.redacted;
for (const cand of personCandidates(tokens)) {
  redacted = maskCandidate(redacted, cand);
}

console.log('WEJŚCIE:\n' + tekst + '\n');
console.log('WYJŚCIE:\n' + redacted);
