/**
 * EKSPERYMENTALNA warstwa LLM przez LOKALNE Ollama (np. Bielik) — tryb SPAN-EXTRACTION.
 *
 * LLM wyłącznie WSKAZUJE kandydatów (fragmenty tekstu wyglądające na dane osobowe),
 * a maskowanie wykonuje kod biblioteki po TWARDEJ walidacji. LLM NIGDY nie przepisuje
 * tekstu — jego ewentualna „propozycja" zredagowanej wersji jest ignorowana. To zamyka
 * dwie klasy ryzyk naraz: halucynację (kandydat nieobecny w tekście jest odrzucany)
 * i prompt-injection (złośliwy tekst może co najwyżej skłonić model do wskazania
 * niewinnych fragmentów → NADmaskowanie, nigdy ODmaskowanie).
 *
 * FAIL-SAFE (nie fail-open): gdy Ollama jest niedostępna, przekroczy timeout, zwróci
 * zły JSON albo circuit breaker jest otwarty — `llmRedact` zwraca `null`, a wołający
 * ZOSTAJE przy wyniku wcześniejszych warstw. Awaria LLM nigdy nie obniża ochrony.
 *
 * Zero zależności: `fetch`/`AbortController` są standardem w Node 18+, Deno, Bun
 * i przeglądarce. Konfiguracja jest JAWNA (parametr), nie z env — biblioteka nie czyta
 * środowiska.
 */

import { redactPII, type PiiFinding, type RedactionResult } from './index.js';
import { mergeFindings, nerRedact, type NerConfig } from './ner-client.js';

export interface LlmConfig {
  /** Bazowy URL Ollamy. Domyślnie `http://127.0.0.1:11434`. */
  url?: string;
  /** Nazwa modelu w Ollamie, np. `'SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M'`. Wymagane. */
  model: string;
  /** Twarda granica oczekiwania na LLM (lokalne modele bywają wolne). Domyślnie 60 000 ms. */
  timeoutMs?: number;
  /** Limit znaków wysyłanych do LLM — ogon dłuższego tekstu zostaje przy wcześniejszych warstwach. Domyślnie 6000. */
  maxChars?: number;
}

const DEFAULT_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_CHARS = 6000;

// ── Twarde granice walidacji kandydatów (obrona przed halucynacją/injection) ──
const MAX_CANDIDATES = 100;
const MIN_CANDIDATE_LEN = 2;
const MAX_CANDIDATE_LEN = 80;

/** Kandydat będący W CAŁOŚCI placeholderem w nawiasach kwadratowych — odrzucany. */
const PLACEHOLDER_ONLY = /^\[[^\[\]]*\]$/;

/**
 * Lustro placeholderów `MASK` z `index.ts` (+ maska osób z pseudonimizacji).
 * Kandydat będący placeholderem lub jego fragmentem (np. `PESEL`, `IMIĘ I NAZWISKO`)
 * jest odrzucany — chroni idempotencję: LLM nie może „przemaskować" wyników
 * wcześniejszych warstw ani rozbić istniejących masek.
 */
const KNOWN_MASKS = [
  '[EMAIL]',
  '[NR-KONTA]',
  '[PESEL]',
  '[NIP]',
  '[REGON]',
  '[TELEFON]',
  '[NR-DOWODU]',
  '[KOD-POCZTOWY]',
  '[DATA-URODZENIA]',
  '[ADRES]',
  '[IMIĘ I NAZWISKO]',
];

/** Maska nakładana na kandydatów LLM — spójna z `MASK.IMIE` z `index.ts`. */
const LLM_MASK = '[IMIĘ I NAZWISKO]';

const SYSTEM_PROMPT =
  'Jesteś detektorem danych osobowych w polskim tekście. ' +
  'Zwróć WYŁĄCZNIE JSON w formacie {"pii": ["dokładny fragment", ...]} ' +
  'z fragmentami tekstu będącymi imionami i nazwiskami lub innymi danymi osobowymi. ' +
  'Kopiuj fragmenty ZNAK W ZNAK, dokładnie tak, jak występują w tekście. ' +
  'Jeśli w tekście nie ma danych osobowych, zwróć {"pii": []}. ' +
  'Nie dodawaj wyjaśnień ani żadnego tekstu poza JSON.';

// ── Minimalny circuit breaker (per URL) ──
// Jak w ner-client: LLM to wzbogacenie, nie ścieżka krytyczna; gdy Ollama pada,
// szybko przestajemy ją odpytywać i jedziemy na wcześniejszych warstwach.
const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 30000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const breakers = new Map<string, BreakerState>();

function breakerFor(url: string): BreakerState {
  let b = breakers.get(url);
  if (!b) {
    b = { failures: 0, openedAt: null };
    breakers.set(url, b);
  }
  return b;
}

function breakerIsOpen(b: BreakerState, now: number): boolean {
  if (b.openedAt === null) return false;
  if (now - b.openedAt >= RESET_TIMEOUT_MS) {
    // half-open: przepuść jedną próbę
    b.openedAt = null;
    b.failures = FAILURE_THRESHOLD - 1;
    return false;
  }
  return true;
}

/** Testy/diagnostyka: wyzeruj stan breakerów. */
export function resetLlmBreakers(): void {
  breakers.clear();
}

/**
 * Zwaliduj surową listę kandydatów z LLM przeciwko PEŁNEMU tekstowi.
 * Akceptowane są wyłącznie stringi 2..80 znaków, występujące w tekście DOSŁOWNIE
 * (indexOf), niebędące placeholderem ani jego fragmentem; max 100 sztuk, bez duplikatów.
 */
function validateCandidates(raw: unknown[], text: string): string[] {
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (accepted.length >= MAX_CANDIDATES) break;
    if (typeof c !== 'string') continue;
    if (c.length < MIN_CANDIDATE_LEN || c.length > MAX_CANDIDATE_LEN) continue;
    if (PLACEHOLDER_ONLY.test(c)) continue;
    if (KNOWN_MASKS.some((m) => m.includes(c))) continue;
    if (text.indexOf(c) === -1) continue; // halucynacja — fragment nie występuje w tekście
    if (seen.has(c)) continue;
    seen.add(c);
    accepted.push(c);
  }
  return accepted;
}

/**
 * Wskaż i zamaskuj dane osobowe przez lokalny LLM (Ollama, span-extraction).
 * Zwraca `null` przy JAKIMKOLWIEK problemie (niedostępna/timeout/zły JSON/pusty wynik/
 * otwarty breaker) — wołający zostaje przy wyniku wcześniejszych warstw.
 *
 * Tekst wysyłany do LLM jest przycinany do `maxChars`, ale zamiana kandydatów obejmuje
 * CAŁY tekst (maskowanie nigdy nie zmniejsza ochrony). Zamianę wykonuje kod: wszystkie
 * wystąpienia każdego zaakceptowanego kandydata → `[IMIĘ I NAZWISKO]`.
 */
export async function llmRedact(
  text: string,
  config: LlmConfig,
): Promise<{ redacted: string; found: PiiFinding[] } | null> {
  if (!config?.model || !text || text.length === 0) return null;

  const url = (config.url && config.url.length > 0 ? config.url : DEFAULT_URL).replace(/\/$/, '');
  const b = breakerFor(url);
  if (breakerIsOpen(b, Date.now())) return null;

  const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxChars = config.maxChars && config.maxChars > 0 ? config.maxChars : DEFAULT_MAX_CHARS;

  // Ogranicz koszt/latencję: LLM widzi tylko pierwsze N znaków. Ogon dłuższego dokumentu
  // pozostaje pod ochroną wcześniejszych warstw (regex + sumy kontrolne, ew. NER).
  const head = text.length > maxChars ? text.slice(0, maxChars) : text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: head },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: unknown } };
    const content = data?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('Nieprawidłowa odpowiedź Ollamy');
    }

    // Parsowanie defensywne: model MA zwrócić {"pii": [...]} — wszystko inne to błąd.
    // Ewentualne dodatkowe pola (np. „redacted" od nadgorliwego modelu) są IGNOROWANE:
    // LLM nigdy nie przepisuje tekstu.
    const parsed = JSON.parse(content) as unknown;
    const pii = (parsed as { pii?: unknown })?.pii;
    if (!Array.isArray(pii)) throw new Error('Brak listy "pii" w odpowiedzi LLM');

    // Sukces protokołu (nawet jeśli lista pusta) — breaker się zamyka.
    b.failures = 0;
    b.openedAt = null;

    const candidates = validateCandidates(pii, text);

    // Maskowanie robi KOD, nie LLM: wszystkie wystąpienia kandydata w całym tekście.
    let redacted = text;
    let count = 0;
    for (const c of candidates) {
      const parts = redacted.split(c);
      if (parts.length === 1) continue; // zniknął po wcześniejszej zamianie (nakładanie)
      count += parts.length - 1;
      redacted = parts.join(LLM_MASK);
    }

    if (count === 0) return null; // pusty wynik — nic do zamiany, zostajemy przy wejściu
    return { redacted, found: [{ type: 'IMIE', count }] };
  } catch {
    b.failures += 1;
    if (b.failures >= FAILURE_THRESHOLD) b.openedAt = Date.now();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Maksymalna redakcja: in-process (ZAWSZE) → NER (gdy skonfigurowany) → LLM (gdy
 * skonfigurowany). Kolejność jest istotna: LLM widzi tekst JUŻ po redakcji strukturalnej
 * (i ewentualnym NER) — surowy PESEL/NIP nigdy nie trafia do modelu, nawet na localhost.
 *
 * Każda warstwa jest fail-safe: jej awaria zostawia wynik warstw wcześniejszych.
 * Bez `opts` zachowuje się IDENTYCZNIE jak `redactPII` (gwarancja fail-safe).
 */
export async function redactPIIUltra(
  input: string,
  opts?: { ner?: NerConfig; llm?: LlmConfig },
): Promise<RedactionResult> {
  const base = redactPII(input);
  if (!input || input.length === 0) return base;

  let redacted = base.redacted;
  let found = base.found;

  if (opts?.ner?.url) {
    const ner = await nerRedact(redacted, opts.ner);
    if (ner) {
      redacted = ner.redacted;
      found = mergeFindings(found, ner.found);
    }
  }

  if (opts?.llm?.model) {
    const llm = await llmRedact(redacted, opts.llm);
    if (llm) {
      redacted = llm.redacted;
      found = mergeFindings(found, llm.found);
    }
  }

  return { redacted, found };
}
