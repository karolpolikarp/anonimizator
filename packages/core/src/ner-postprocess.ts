/**
 * Wspólny post-processing wyjścia neuronowego NER (token-classification) → maski osobowe.
 *
 * JEDNO źródło prawdy dla trzech miejsc, które wcześniej duplikowały tę logikę:
 *  - warstwa przeglądarki   apps/web/src/ner-browser.ts
 *  - przykład Node          examples/ner-onnx-node.mjs
 *  - benchmark              scripts/benchmark/run.mjs
 *
 * KLUCZOWE OGRANICZENIE (zweryfikowane w @huggingface/transformers 3.7.6, issue #359):
 * przeglądarkowy `token-classification` NIE zwraca offsetów `start`/`end` ani nie wspiera
 * `aggregation_strategy` — encja to tylko `{ entity, score, index, word }`, gdzie `word` to
 * fragment subword. Dlatego kandydata LOKALIZUJEMY w tekście sami: przez strumień liter
 * (ignorujący spacje/interpunkcję) z mapą na pozycje oryginału, potem rozszerzamy do granic
 * słowa (odpowiednik `_expand_to_word` z services/ner/app.py). Gdy offsety kiedyś się pojawią
 * (pola `start`/`end`), używamy ich zamiast skanu.
 *
 * FILOZOFIA PROJEKTU: precyzja > recall. Model dokłada tylko PEWNE osoby:
 *  - próg pewności `score` (jak PII_NER_MIN_SCORE w app.py),
 *  - reużyte stoplisty rdzenia (przymiotniki geo/narodowe, słowa instytucji),
 *  - homonimy rzeczowników pospolitych (Wilk, Baran, Lis…) maskowane WYŁĄCZNIE przy bardzo
 *    wysokiej pewności — „Wilk biegał po lesie" nie może zniknąć,
 *  - „prefix-grow" (rozszerzenie krótkiego trafienia na dłuższe słowo) maskuje tylko, gdy
 *    powstałe słowo WYGLĄDA na nazwisko — żeby „Kot"→„Kotłownia" nie zjadło zwykłego wyrazu,
 *  - istniejące placeholdery ([PESEL], [IMIĘ I NAZWISKO]…) są nietykalne (idempotencja).
 *
 * Bez zależności zewnętrznych i bez `throw` — kontrakt fail-safe (`null`) zostaje u wołających
 * (ner-browser.ts / nerRedact), które łapią wyjątki modelu. Działa w Node/przeglądarce/CLI.
 */

import {
  NON_SURNAME_ADJ,
  HOMOGRAPH_SURNAMES,
  isGeoAdjective,
  normalizeSurnameKey,
  looksLikeSurname,
  surnameBase,
} from './surnames.js';
import { LEGAL_ENTITY_WORDS, NON_PERSON_CONTEXT } from './index.js';

const DEFAULT_MASK = '[IMIĘ I NAZWISKO]';
const DEFAULT_MIN_SCORE = 0.5; // == PII_NER_MIN_SCORE (services/ner/app.py)
const DEFAULT_HOMOGRAPH_MIN_SCORE = 0.9;

// Dowolna litera Unicode (nie tylko polska) — strumień liter + boundary. Dzięki temu obce
// nazwiska (Müller, Kovač, Nguyễn) nie gubią końcówek przy dopasowaniu/rozszerzaniu.
const LETTER = /\p{L}/u;
// Wszystko, co NIE jest literą — do wydobycia „gołych" liter kandydata do lokalizacji.
const NON_LETTER_G = /\P{L}/gu;
// Znak „słowa": litera LUB myślnik — do rozszerzania spanu na całe słowo (Nowak-Schmidt, Gz→Gzowski).
// (Nazwiska z apostrofem, np. O'Brien, obejmuje sam strumień liter — obie części są w kandydacie,
// a apostrof leży między dopasowanymi literami; nie trzeba go tu dodawać.)
const WORD_CHAR = /[\p{L}-]/u;
// Istniejące placeholdery rdzenia ([PESEL], [IMIĘ I NAZWISKO], [OSOBA-A]…) — NIE tykać (idempotencja).
const MASK_SPAN = /\[[^\][\n]*\]/gu;

/** Pojedyncza encja z pipeline `token-classification`. `start`/`end` future-proof (dziś brak). */
export interface NerToken {
  entity: string;
  word: string;
  score?: number;
  index?: number;
  start?: number;
  end?: number;
}

export interface NerPostprocessOptions {
  /** Placeholder maski. Domyślnie `[IMIĘ I NAZWISKO]`. */
  mask?: string;
  /** Minimalny score pierwszego tokena grupy (strategia „first"). Domyślnie 0.5. */
  minScore?: number;
  /** Czy etykieta oznacza osobę. Domyślnie: `nam_liv_person` / `PER` / `persName`. */
  isPersonLabel?: (entity: string) => boolean;
  /** Odrzuć kandydata (true ⇒ NIE maskuj). Domyślnie: przymiotniki geo + słowa instytucji. */
  isStopword?: (candidate: string) => boolean;
  /** Czy kandydat to homonim rzeczownika pospolitego (Wilk, Baran…). Domyślnie: HOMOGRAPH_SURNAMES. */
  isHomograph?: (candidate: string) => boolean;
  /** Homonim maskujemy tylko przy score >= tej wartości. Domyślnie 0.9. */
  homographMinScore?: number;
}

export interface NerPostprocessResult {
  redacted: string;
  found: { type: 'IMIE'; count: number }[];
}

/** Domyślny predykat etykiety osobowej — obejmuje FastPDN (nam_liv_person), wikiann (PER), spaCy. */
export function defaultIsPersonLabel(entity: string): boolean {
  const e = String(entity ?? '');
  return e.includes('nam_liv_person') || e.endsWith('PER') || e.includes('persName');
}

/**
 * Domyślny filtr precyzji: odrzuca kandydatów będących przymiotnikami geo/narodowymi
 * (Warszawski, Mazowiecki, Jagielloński — także w odmianie) lub słowami instytucji
 * (Sąd, Trybunał, Ministerstwo, Najwyższy). Reużywa stoplist rdzenia — brak duplikacji list.
 * Wielowyrazowca odrzuca, gdy KTÓRYKOLWIEK człon jest stoplistą (chroni „Sąd Najwyższy",
 * „Uniwersytet Warszawski" — instytucji model nie ma prawa maskować jako osoby).
 */
export function defaultIsStopword(candidate: string): boolean {
  const w = candidate.toLowerCase().trim();
  if (!w) return true;
  const parts = w.split(/\s+/).filter(Boolean);
  for (const p of parts) {
    if (LEGAL_ENTITY_WORDS.has(p) || NON_PERSON_CONTEXT.has(p)) return true;
    if (NON_SURNAME_ADJ.has(p) || isGeoAdjective(p)) return true;
  }
  return false;
}

/** Domyślny predykat homonimu — sprawdza ostatni człon (pozycję nazwiska), też w odmianie. */
export function defaultIsHomograph(candidate: string): boolean {
  const parts = candidate.toLowerCase().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return HOMOGRAPH_SURNAMES.has(last) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(last));
}

interface Group {
  words: string[];
  headScore: number;
  start?: number;
  end?: number;
}

/** Strumień liter (bez spacji/interpunkcji/myślnika) + mapa na pozycje w oryginale. */
function buildLetterStream(text: string): { stream: string; pos: number[] } {
  let stream = '';
  const pos: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (LETTER.test(ch)) {
      const lo = ch.toLowerCase();
      // Utrzymaj mapę 1:1: gdy toLowerCase rozwija znak (np. „İ"→2 znaki), bierz pierwszy.
      stream += lo.length === 1 ? lo : lo[0];
      pos.push(i);
    }
  }
  return { stream, pos };
}

/** Rozszerz [s,e) do granic słowa — subwordowy match potrafi uciąć „Gz|owski". */
function expandToWord(text: string, s: number, e: number): [number, number] {
  while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
  while (e < text.length && WORD_CHAR.test(text[e])) e++;
  return [s, e];
}

/**
 * Znajdź kandydata w strumieniu liter od indeksu `fromLi`, tylko na GRANICY SŁOWA (poprzedni
 * znak w oryginale nie jest literą — chroni przed „panna" → „annanowak" w środku wyrazu).
 * Zwraca SUROWY span liter (przed rozszerzeniem) w pozycjach oryginału + następny indeks litery.
 */
function locate(
  stream: string,
  pos: number[],
  text: string,
  candLetters: string,
  fromLi: number,
): { rawS: number; rawE: number; nextLi: number } | null {
  if (!candLetters) return null;
  let li = stream.indexOf(candLetters, Math.max(0, fromLi));
  while (li !== -1) {
    const startPos = pos[li];
    if (startPos === 0 || !LETTER.test(text[startPos - 1])) {
      return { rawS: startPos, rawE: pos[li + candLetters.length - 1] + 1, nextLi: li + candLetters.length };
    }
    li = stream.indexOf(candLetters, li + 1);
  }
  return null;
}

/**
 * Czy powierzchniowe słowo (po rozszerzeniu do granic słowa) wygląda na osobę? Bramka „prefix-grow":
 * gdy krótkie trafienie urosło na dłuższe słowo, maskujemy tylko jeśli to naprawdę nazwisko.
 * Wielowyrazowy kandydat = silny sygnał osoby → nie bramkujemy. Pierwszy człon złożenia z myślnikiem
 * też liczy się jako nazwisko (Nowak-Schmidt z tokenem „Nowak").
 */
function surfaceLooksLikePerson(surf: string): boolean {
  if (/\s/.test(surf)) return true;
  const first = surf.split('-')[0];
  return looksLikeSurname(surf) || Boolean(surnameBase(surf)) || looksLikeSurname(first) || Boolean(surnameBase(first));
}

/**
 * Zamień wyjście NER na tekst z zamaskowanymi osobami. Deterministyczne, bez `throw`.
 *
 * @param text   tekst wejściowy (u nas: JUŻ po redakcji strukturalnej — patrz scheduleNer/app.py).
 * @param tokens surowe encje z pipeline `token-classification`.
 */
export function applyNerPersons(
  text: string,
  tokens: NerToken[],
  options: NerPostprocessOptions = {},
): NerPostprocessResult {
  const empty: NerPostprocessResult = { redacted: text, found: [] };
  if (!text || !Array.isArray(tokens) || tokens.length === 0) return empty;

  const mask = options.mask ?? DEFAULT_MASK;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const homographMinScore = options.homographMinScore ?? DEFAULT_HOMOGRAPH_MIN_SCORE;
  const isPersonLabel = options.isPersonLabel ?? defaultIsPersonLabel;
  const isStopword = options.isStopword ?? defaultIsStopword;
  const isHomograph = options.isHomograph ?? defaultIsHomograph;

  // 1) Grupowanie kolejnych tokenów osobowych. Nowy `B-` (albo token osobowy po nie-osobowym)
  //    zamyka grupę — dwie sąsiednie osoby („Kowalski Nowak") nie zlepiają się w jedną.
  const groups: Group[] = [];
  let cur: Group | null = null;
  const flush = () => {
    if (cur && cur.words.length) groups.push(cur);
    cur = null;
  };
  for (const t of tokens) {
    const entity = String(t?.entity ?? '');
    if (isPersonLabel(entity)) {
      const isBegin = /^B[-_]/.test(entity);
      if (!cur || isBegin) {
        flush();
        cur = { words: [], headScore: typeof t.score === 'number' ? t.score : 1 };
      }
      cur.words.push(String(t.word ?? ''));
      if (typeof t.start === 'number' && cur.start === undefined) cur.start = t.start;
      if (typeof t.end === 'number') cur.end = t.end;
    } else {
      flush();
    }
  }
  flush();

  // Zakresy istniejących placeholderów — kandydat nachodzący na maskę jest ODRZUCANY (idempotencja).
  const maskRanges = [...text.matchAll(MASK_SPAN)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const inMask = (s: number, e: number) => maskRanges.some(([ms, me]) => s < me && e > ms);

  // 2) Selekcja + lokalizacja. Skan kursorowy zamiast globalnego indexOf-od-0 (naprawia duplikaty).
  const { stream, pos } = buildLetterStream(text);
  const spans: Array<[number, number]> = [];
  let cursorLi = 0;
  const overlaps = (s: number, e: number) => spans.some(([ps, pe]) => s < pe && e > ps);

  for (const g of groups) {
    if (g.headScore < minScore) continue; // próg pewności (precyzja > recall)

    // Future-proof: jeśli model dostarczył offsety znakowe, użyj ich zamiast skanu.
    if (typeof g.start === 'number' && typeof g.end === 'number' && g.end > g.start) {
      const [s, e] = expandToWord(text, g.start, g.end);
      if (!inMask(s, e) && !overlaps(s, e)) spans.push([s, e]);
      continue;
    }

    const cand = g.words.join(' ').replace(/\s+/g, ' ').trim();
    const candLetters = cand.toLowerCase().replace(NON_LETTER_G, '');
    if (candLetters.length < 2) continue;
    if (isStopword(cand)) continue; // przymiotnik geo / instytucja → nie osoba
    if (isHomograph(cand) && g.headScore < homographMinScore) continue; // homonim tylko przy pewności

    let hit = locate(stream, pos, text, candLetters, cursorLi);
    if (!hit) hit = locate(stream, pos, text, candLetters, 0); // fallback (rozjazd kolejności)
    if (!hit) continue;
    cursorLi = Math.max(cursorLi, hit.nextLi);

    const [s, e] = expandToWord(text, hit.rawS, hit.rawE);
    if (inMask(s, e)) continue; // nie dotykaj istniejącego placeholdera

    // Bramka „prefix-grow": span urósł ponad litery kandydata → maskuj tylko, gdy to nazwisko.
    const surfLetters = text.slice(s, e).toLowerCase().replace(NON_LETTER_G, '');
    if (surfLetters !== candLetters && !surfaceLooksLikePerson(text.slice(s, e).trim())) continue;

    if (!overlaps(s, e)) spans.push([s, e]);
  }

  if (spans.length === 0) return empty;

  // 3) Scal nachodzące/duplikaty (jak app.py).
  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  // 4) Podmiana OD KOŃCA (malejące offsety) — pozycje wcześniejszych spanów się nie przesuwają.
  let redacted = text;
  for (let i = merged.length - 1; i >= 0; i--) {
    const [s, e] = merged[i];
    redacted = redacted.slice(0, s) + mask + redacted.slice(e);
  }
  return { redacted, found: [{ type: 'IMIE', count: merged.length }] };
}
