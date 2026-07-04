/**
 * NER w przeglądarce (FastPDN ONNX int8 + transformers.js) — bez Dockera i bez sieci.
 *
 * Zasada dystrybucji: build aplikacji NIE zawiera tych megabajtów. Funkcja aktywuje się,
 * gdy obok index.html leży rozpakowany „onnx-pack" (katalogi vendor/ i models/ z release'u
 * models-fastpdn-onnx-v1) i strona jest SERWOWANA po http(s) — z file:// fetch/wasm nie
 * działają, więc w paczce offline opcja po prostu się nie pojawia.
 *
 * Import biblioteki jest dynamiczny z URL wyliczanym w runtime (vite go nie bundluje),
 * model i wasm ładują się wyłącznie z tego samego hosta (allowRemoteModels=false).
 * Fail-safe jak pozostałe warstwy: każdy błąd ⇒ null ⇒ zostaje wynik warstw niższych.
 */

import type { PiiFinding } from 'anonimizator';

const LETTERS = /[a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ-]/;
const MASK = '[IMIĘ I NAZWISKO]';

let pipePromise: Promise<(text: string, opts: object) => Promise<Array<{ entity: string; word: string }>>> | null = null;

export async function browserNerAvailable(): Promise<boolean> {
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const [vendor, model] = await Promise.all([
      fetch(new URL('vendor/transformers.web.min.js', document.baseURI), { method: 'HEAD' }),
      fetch(new URL('models/anonimizator/fastpdn/config.json', document.baseURI), { method: 'HEAD' }),
    ]);
    return vendor.ok && model.ok;
  } catch {
    return false;
  }
}

function getPipeline(onProgress?: (msg: string) => void) {
  if (!pipePromise) {
    pipePromise = (async () => {
      onProgress?.('ładuję bibliotekę…');
      const url = new URL('vendor/transformers.web.min.js', document.baseURI).href;
      const T = await import(/* @vite-ignore */ url);
      T.env.allowRemoteModels = false;
      T.env.allowLocalModels = true; // w przeglądarce domyślnie wyłączone!
      // UWAGA: localModelPath MUSI być względne — absolutny URL http(s) jest traktowany
      // jak zasób zdalny i pomijany w gałęzi lokalnej (zero fetchy, exists=false).
      T.env.localModelPath = 'models/';
      T.env.backends.onnx.wasm.wasmPaths = new URL('vendor/', document.baseURI).href;
      onProgress?.('ładuję model (pierwszy raz: ~125 MB, potem cache przeglądarki)…');
      // dwuczłonowe id — jednoczłonowe nie przechodzi walidacji identyfikatora modelu
      return T.pipeline('token-classification', 'anonimizator/fastpdn', { dtype: 'q8', device: 'wasm' });
    })().catch((err) => {
      pipePromise = null; // pozwól spróbować ponownie
      throw err;
    });
  }
  return pipePromise;
}

/** Sklej sąsiadujące tokeny osobowe w kandydatów; model bywa „częściowy" przy q8. */
function personCandidates(tokens: Array<{ entity: string; word: string }>): string[] {
  const out: string[] = [];
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
  return out
    .map((c) => c.replace(/^[^\p{L}]+|[^\p{L}-]+$/gu, ''))
    .filter((c) => c.length >= 2 && LETTERS.test(c));
}

/** Zamaskuj kandydata, rozszerzając trafienie do granic słowa (np. „Gz" → „Gzowski"). */
function maskCandidate(text: string, cand: string): { text: string; hits: number } {
  let out = text;
  let from = 0;
  let hits = 0;
  for (;;) {
    const idx = out.indexOf(cand, from);
    if (idx === -1) return { text: out, hits };
    let s = idx;
    let e = idx + cand.length;
    while (s > 0 && LETTERS.test(out[s - 1])) s--;
    while (e < out.length && LETTERS.test(out[e])) e++;
    out = out.slice(0, s) + MASK + out.slice(e);
    from = s + MASK.length;
    hits++;
  }
}

/**
 * Zredaguj osoby modelem w przeglądarce. `null` przy JAKIMKOLWIEK problemie —
 * wołający zostaje przy wyniku warstw niższych (identyczny kontrakt jak nerRedact).
 */
export async function browserNerRedact(
  text: string,
  onProgress?: (msg: string) => void,
): Promise<{ redacted: string; found: PiiFinding[] } | null> {
  if (!text) return null;
  try {
    const pipe = await getPipeline(onProgress);
    const tokens = await pipe(text, { ignore_labels: [] });
    let redacted = text;
    let count = 0;
    for (const cand of personCandidates(tokens)) {
      const r = maskCandidate(redacted, cand);
      redacted = r.text;
      count += r.hits;
    }
    return { redacted, found: count > 0 ? [{ type: 'IMIE', count }] : [] };
  } catch {
    return null;
  }
}
