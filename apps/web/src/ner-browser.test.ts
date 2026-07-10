import { afterEach, expect, test, vi } from 'vitest';
import { browserNerRedact, browserNerAvailable, __setPipelineLoaderForTests } from './ner-browser';
import type { NerToken } from 'anonimizator/ner-postprocess';

const MASK = '[IMIĘ I NAZWISKO]';

/** Fałszywy pipeline zwracający ustalone tokeny — bez modelu/WASM. */
function fakePipe(tokens: NerToken[]) {
  return async () => tokens;
}

afterEach(() => {
  __setPipelineLoaderForTests(null);
  vi.unstubAllGlobals();
});

test('browserNerRedact maskuje osobę i zwraca wynik warstwy modelu', async () => {
  __setPipelineLoaderForTests(async () => fakePipe([{ entity: 'B-nam_liv_person', word: 'Gzowski', score: 0.9 }]));
  const r = await browserNerRedact('Zeznał świadek Gzowski.');
  expect(r).not.toBeNull();
  expect(r!.redacted).toBe(`Zeznał świadek ${MASK}.`);
  expect(r!.found).toEqual([{ type: 'IMIE', count: 1 }]);
});

test('reużycie stoplisty rdzenia: przymiotnik geo (Śląski) nie jest maskowany', async () => {
  __setPipelineLoaderForTests(async () => fakePipe([{ entity: 'B-nam_liv_person', word: 'Śląski', score: 0.98 }]));
  const r = await browserNerRedact('Bank Śląski ogłosił wyniki.');
  expect(r!.redacted).toBe('Bank Śląski ogłosił wyniki.');
  expect(r!.found).toEqual([]);
});

test('błąd ładowania modelu → null (fail-safe)', async () => {
  __setPipelineLoaderForTests(async () => {
    throw new Error('brak modelu');
  });
  expect(await browserNerRedact('Zeznał Gzowski.')).toBeNull();
});

test('błąd inferencji → null (fail-safe)', async () => {
  __setPipelineLoaderForTests(async () => async () => {
    throw new Error('wasm crash');
  });
  expect(await browserNerRedact('Zeznał Gzowski.')).toBeNull();
});

test('pusty tekst → null', async () => {
  expect(await browserNerRedact('')).toBeNull();
});

test('browserNerAvailable: file:// → false', async () => {
  vi.stubGlobal('location', { protocol: 'file:' });
  expect(await browserNerAvailable()).toBe(false);
});

test('browserNerAvailable: http + oba HEAD OK → true', async () => {
  vi.stubGlobal('location', { protocol: 'http:' });
  vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:8123/' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  expect(await browserNerAvailable()).toBe(true);
});

test('browserNerAvailable: brak pliku modelu (HEAD nie-OK) → false', async () => {
  vi.stubGlobal('location', { protocol: 'http:' });
  vi.stubGlobal('document', { baseURI: 'http://127.0.0.1:8123/' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: URL | string) => ({ ok: String(u).includes('transformers') })),
  );
  expect(await browserNerAvailable()).toBe(false);
});
