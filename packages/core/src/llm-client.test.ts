import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { redactPII } from './index';
import { llmRedact, redactPIIUltra, resetLlmBreakers } from './llm-client';
import { resetNerBreakers } from './ner-client';

beforeEach(() => {
  resetLlmBreakers();
  resetNerBreakers();
});
afterEach(() => vi.unstubAllGlobals());

const CFG = { model: 'SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M' };

/** Zbuduj odpowiedź Ollamy (/api/chat, stream:false) z podanym contentem wiadomości. */
function ollamaResponse(content: string): Response {
  return new Response(
    JSON.stringify({ message: { role: 'assistant', content }, done: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

test('llmRedact — happy path: LLM wskazuje kandydatów, kod maskuje; kontrakt z Ollamą', async () => {
  let requestUrl = '';
  let body: {
    model: string;
    stream: boolean;
    format: string;
    options: { temperature: number };
    messages: { role: string; content: string }[];
  } = null as never;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      requestUrl = String(url);
      body = JSON.parse(String(init?.body));
      return ollamaResponse(JSON.stringify({ pii: ['Bąkiewicz', 'Szczepankowską'] }));
    }),
  );

  const text = 'Wczoraj Bąkiewicz podpisał umowę z Szczepankowską.';
  const r = await llmRedact(text, CFG);
  expect(r?.redacted).toBe('Wczoraj [IMIĘ I NAZWISKO] podpisał umowę z [IMIĘ I NAZWISKO].');
  expect(r?.found).toEqual([{ type: 'IMIE', count: 2 }]);

  // kontrakt: domyślny URL, bez streamu, format json, temperatura 0, system po polsku
  expect(requestUrl).toBe('http://127.0.0.1:11434/api/chat');
  expect(body.model).toBe(CFG.model);
  expect(body.stream).toBe(false);
  expect(body.format).toBe('json');
  expect(body.options.temperature).toBe(0);
  expect(body.messages[0].role).toBe('system');
  expect(body.messages[0].content).toContain('detektorem danych osobowych');
  expect(body.messages[1]).toEqual({ role: 'user', content: text });
});

test('llmRedact — twarda walidacja: halucynacje, placeholdery i złe długości ODRZUCONE', async () => {
  const longRun = 'y'.repeat(81); // obecny w tekście, ale > 80 znaków
  const text = `Maska [PESEL], U ${longRun} oraz Bąkiewicz.`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ollamaResponse(
        JSON.stringify({
          pii: [
            'Całkowicie Zmyślony Fragment', // halucynacja — nie występuje w tekście
            '[PESEL]', // placeholder w całości
            'PESEL', // fragment znanego placeholdera
            'U', // za krótki (< 2 znaki)
            longRun, // za długi (> 80 znaków)
            42, // nie-string
            'Bąkiewicz', // JEDYNY prawidłowy kandydat
          ],
        }),
      ),
    ),
  );

  const r = await llmRedact(text, CFG);
  expect(r?.redacted).toBe(`Maska [PESEL], U ${longRun} oraz [IMIĘ I NAZWISKO].`);
  expect(r?.found).toEqual([{ type: 'IMIE', count: 1 }]);
});

test('llmRedact — zły JSON lub brak listy "pii" → null (fail-safe)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ollamaResponse('to nie jest {json')));
  expect(await llmRedact('Pan Iksiński', CFG)).toBeNull();

  resetLlmBreakers();
  vi.stubGlobal('fetch', vi.fn(async () => ollamaResponse(JSON.stringify({ nie_pii: [] }))));
  expect(await llmRedact('Pan Iksiński', CFG)).toBeNull();
});

test('llmRedact — HTTP 500 ×3 otwiera breaker; 4. wywołanie bez fetch', async () => {
  const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);

  expect(await llmRedact('Pan Iksiński', CFG)).toBeNull();
  expect(await llmRedact('Pan Iksiński', CFG)).toBeNull();
  expect(await llmRedact('Pan Iksiński', CFG)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  // 4. wywołanie: breaker OPEN → w ogóle nie strzela HTTP
  expect(await llmRedact('Pan Iksiński', CFG)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('llmRedact — NIGDY nie zmienia tekstu poza zamianą kandydatów (reszta znak w znak)', async () => {
  // Nadgorliwy model zwraca też własną „przepisaną" wersję — MUSI być zignorowana.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ollamaResponse(
        JSON.stringify({
          pii: ['Jan Iksiński'],
          redacted: 'CAŁKOWICIE INNY TEKST PODSUNIĘTY PRZEZ MODEL',
        }),
      ),
    ),
  );

  const text = 'Ala ma kota. Jan Iksiński mieszka w Radomiu, a Jan Iksiński pracuje zdalnie. Koniec.';
  const r = await llmRedact(text, CFG);
  // jedyna dozwolona różnica: wystąpienia kandydata → maska
  expect(r?.redacted).toBe(text.split('Jan Iksiński').join('[IMIĘ I NAZWISKO]'));
  expect(r?.found).toEqual([{ type: 'IMIE', count: 2 }]);
  // odwrócenie maski odtwarza oryginał — dowód, że reszta znaków jest nietknięta
  expect(r?.redacted.split('[IMIĘ I NAZWISKO]').join('Jan Iksiński')).toBe(text);
});

test('llmRedact — max 100 kandydatów (nadmiarowi ignorowani)', async () => {
  const words = Array.from({ length: 150 }, (_, i) => `osoba${String(i).padStart(3, '0')}x`);
  const text = words.join(' ');
  vi.stubGlobal('fetch', vi.fn(async () => ollamaResponse(JSON.stringify({ pii: words }))));

  const r = await llmRedact(text, CFG);
  expect(r?.found).toEqual([{ type: 'IMIE', count: 100 }]);
  expect(r?.redacted).not.toContain('osoba099x'); // w limicie — zamaskowany
  expect(r?.redacted).toContain('osoba100x'); // poza limitem — nietknięty
});

// Bez konfiguracji redactPIIUltra MUSI zachowywać się identycznie jak in-process —
// to gwarancja fail-safe: brak/awaria NER i LLM nigdy nie obniża ochrony in-process.
test('redactPIIUltra bez configów == redactPII (fail-safe, zero ruchu sieciowego)', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const samples = [
    'PESEL 44051401359, Jan Kowalski, mail x@y.pl, tel +48 600 700 800',
    'ul. Marszałkowska 10/5, NIP 123-456-32-18',
    'Czy pracodawca może odmówić urlopu zgodnie z art. 167 KP?',
    '',
  ];
  for (const s of samples) {
    const ultra = await redactPIIUltra(s);
    const base = redactPII(s);
    expect(ultra.redacted).toBe(base.redacted);
    expect(ultra.found).toEqual(base.found);
  }
  expect(fetchMock).not.toHaveBeenCalled();
});

test('redactPIIUltra — LLM widzi tekst JUŻ po redakcji strukturalnej; znaleziska scalone', async () => {
  let seenByLlm = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seenByLlm = body.messages[1].content;
      return ollamaResponse(JSON.stringify({ pii: ['Bąkiewicz'] }));
    }),
  );

  const r = await redactPIIUltra('Wczoraj Bąkiewicz podał PESEL 44051401359', { llm: CFG });
  expect(seenByLlm.includes('44051401359')).toBe(false);
  expect(seenByLlm).toContain('[PESEL]');
  expect(r.redacted).toContain('[PESEL]');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Bąkiewicz')).toBe(false);
  expect(r.found.map((f) => f.type).sort()).toEqual(['IMIE', 'PESEL']);
});

test('redactPIIUltra — kompozycja NER→LLM: LLM widzi wynik NER, awarie żadnej warstwy nie psują reszty', async () => {
  let seenByLlm = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/redact')) {
        // symulacja NER: maskuje jedno nazwisko
        const { text } = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            redacted: String(text).replace('Szczepankowską', '[IMIĘ I NAZWISKO]'),
            found: [{ type: 'IMIE', count: 1 }],
          }),
          { status: 200 },
        );
      }
      // Ollama: dostaje tekst po NER i wskazuje pozostałe nazwisko
      seenByLlm = JSON.parse(String(init?.body)).messages[1].content;
      return ollamaResponse(JSON.stringify({ pii: ['Bąkiewicz'] }));
    }),
  );

  const r = await redactPIIUltra('Umowa: Bąkiewicz i Szczepankowską, PESEL 44051401359.', {
    ner: { url: 'http://127.0.0.1:8090' },
    llm: CFG,
  });
  expect(seenByLlm).toContain('[IMIĘ I NAZWISKO]'); // wynik NER widoczny dla LLM
  expect(seenByLlm.includes('Szczepankowską')).toBe(false);
  expect(r.redacted.includes('Bąkiewicz')).toBe(false);
  expect(r.redacted.includes('Szczepankowską')).toBe(false);
  expect(r.found.find((f) => f.type === 'IMIE')?.count).toBe(2); // NER (1) + LLM (1)
  expect(r.found.find((f) => f.type === 'PESEL')?.count).toBe(1);
});

test('redactPIIUltra — awaria LLM nie obniża ochrony (wynik == in-process)', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }),
  );
  const input = 'PESEL 44051401359, Jan Kowalski';
  const ultra = await redactPIIUltra(input, { llm: CFG });
  const base = redactPII(input);
  expect(ultra.redacted).toBe(base.redacted);
  expect(ultra.found).toEqual(base.found);
});
