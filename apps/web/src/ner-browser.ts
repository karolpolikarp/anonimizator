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
 *
 * Post-processing (grupowanie, próg score, stoplisty rdzenia, homonimy, lokalizacja bez
 * offsetów, maskowanie) jest w JEDNYM współdzielonym module rdzenia `anonimizator/ner-postprocess`
 * — ta sama logika co w benchmarku i przykładzie Node. Tu zostaje tylko ładowanie modelu.
 */

import type { PiiFinding } from 'anonimizator';
import { applyNerPersons, type NerToken } from 'anonimizator/ner-postprocess';

type Pipe = (text: string, opts: object) => Promise<NerToken[]>;

/**
 * Realny loader modelu (dynamiczny import vendora + pipeline). Wydzielony, by test mógł go
 * podmienić bez WASM/sieci (patrz __setPipelineLoaderForTests). Nie cache'uje sam — cache jest
 * w getPipeline.
 */
async function loadPipeline(onProgress?: (msg: string) => void): Promise<Pipe> {
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
}

let pipelineLoader: (onProgress?: (msg: string) => void) => Promise<Pipe> = loadPipeline;
let pipePromise: Promise<Pipe> | null = null;

/** Tylko do testów: wstrzyknij fałszywy loader (bez modelu/WASM) i wyzeruj cache. `null` = reset. */
export function __setPipelineLoaderForTests(
  loader: ((onProgress?: (msg: string) => void) => Promise<Pipe>) | null,
): void {
  pipelineLoader = loader ?? loadPipeline;
  pipePromise = null;
}

function getPipeline(onProgress?: (msg: string) => void) {
  if (!pipePromise) {
    pipePromise = pipelineLoader(onProgress).catch((err) => {
      pipePromise = null; // pozwól spróbować ponownie
      throw err;
    });
  }
  return pipePromise;
}

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

/**
 * Zredaguj osoby modelem w przeglądarce. `null` przy JAKIMKOLWIEK problemie —
 * wołający zostaje przy wyniku warstw niższych (identyczny kontrakt jak nerRedact).
 * Cała selekcja/maskowanie w `applyNerPersons` (wspólny moduł, z domyślnymi stoplistami rdzenia).
 */
export async function browserNerRedact(
  text: string,
  onProgress?: (msg: string) => void,
): Promise<{ redacted: string; found: PiiFinding[] } | null> {
  if (!text) return null;
  try {
    const pipe = await getPipeline(onProgress);
    const tokens = await pipe(text, { ignore_labels: [] });
    const { redacted, found } = applyNerPersons(text, tokens);
    return { redacted, found };
  } catch {
    return null;
  }
}
