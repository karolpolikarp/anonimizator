import { expect, test } from 'vitest';
import {
  applyNerPersons,
  defaultIsStopword,
  defaultIsHomograph,
  defaultIsPersonLabel,
  type NerToken,
} from './ner-postprocess';

const MASK = '[IMIĘ I NAZWISKO]';

/** Skrót do budowy tokena wyjścia `token-classification` (bez offsetów, jak transformers.js). */
function tok(entity: string, word: string, score = 0.95): NerToken {
  return { entity, word, score };
}
/** Token osobowy: `person(word, score)` = B-, `person(word, score, false)` = I- (kontynuacja). */
function person(word: string, score = 0.95, begin = true): NerToken {
  return tok(`${begin ? 'B' : 'I'}-nam_liv_person`, word, score);
}
const O = (word: string): NerToken => tok('O', word, 0.99);

// ── Grupowanie ──────────────────────────────────────────────────────────────

test('B-/I- ciągłe → jedna maska pokrywa całe imię i nazwisko', () => {
  const text = 'Podpisał Jan Kowalski osobiście.';
  const r = applyNerPersons(text, [person('Jan'), person('Kowalski', 0.9, false)]);
  expect(r.redacted).toBe(`Podpisał ${MASK} osobiście.`);
  expect(r.found).toEqual([{ type: 'IMIE', count: 1 }]);
});

test('sąsiednie osoby bez separatora scalają się w jedną maskę (bezpieczne — oba ukryte)', () => {
  const text = 'Obecni Kowalski Nowak wyszli.';
  const r = applyNerPersons(text, [person('Kowalski'), person('Nowak')]);
  expect(r.redacted).toBe(`Obecni ${MASK} wyszli.`);
  expect(r.found).toEqual([{ type: 'IMIE', count: 1 }]);
});

test('nazwisko pofragmentowane na osobne B- (jak int8 FastPDN) scala się i jest maskowane', () => {
  const text = 'list od Achtelika leżał na biurku';
  // model int8 znakuje subwordy osobno: A|ch|te|lika — każdy jako B-
  const tokens = [
    tok('B-nam_liv_person', 'A', 1.0),
    tok('B-nam_liv_person', 'ch', 0.99),
    tok('B-nam_liv_person', 'te', 0.91),
    tok('B-nam_liv_person', 'lika', 0.98),
  ];
  expect(applyNerPersons(text, tokens).redacted).toBe(`list od ${MASK} leżał na biurku`);
});

test('obce nazwisko tagowane krótkim prefiksem z wielkiej litery — maskowane (Schmi → Schmidt)', () => {
  const text = 'pełnomocnikiem był mecenas Schmidt osobiście';
  expect(applyNerPersons(text, [person('Schmi', 1.0)]).redacted).toBe(
    `pełnomocnikiem był mecenas ${MASK} osobiście`,
  );
});

test('token nie-osobowy zamyka grupę', () => {
  const text = 'Widziałem Kowalskiego wczoraj i Nowaka.';
  const r = applyNerPersons(text, [person('Kowalskiego'), O('wczoraj'), O('i'), person('Nowaka')]);
  expect(r.redacted).toBe(`Widziałem ${MASK} wczoraj i ${MASK}.`);
  expect(r.found[0].count).toBe(2);
});

// ── Próg pewności (precyzja > recall) ────────────────────────────────────────

test('score poniżej progu → grupa odrzucona', () => {
  const text = 'Zeznał Malinowski wczoraj.';
  expect(applyNerPersons(text, [person('Malinowski', 0.3)]).redacted).toBe(text);
});

test('score powyżej progu → maskowane', () => {
  const text = 'Zeznał Malinowski wczoraj.';
  expect(applyNerPersons(text, [person('Malinowski', 0.9)]).redacted).toBe(`Zeznał ${MASK} wczoraj.`);
});

test('konfigurowalny minScore', () => {
  const text = 'Zeznał Malinowski wczoraj.';
  expect(applyNerPersons(text, [person('Malinowski', 0.7)], { minScore: 0.8 }).redacted).toBe(text);
  expect(applyNerPersons(text, [person('Malinowski', 0.7)], { minScore: 0.6 }).redacted).toBe(
    `Zeznał ${MASK} wczoraj.`,
  );
});

// ── Rekonstrukcja i rozszerzenie do granic słowa ─────────────────────────────

test('częściowy subword „Gz" rozszerza się do całego „Gzowski"', () => {
  const text = 'Zeznał świadek Gzowski wczoraj.';
  const r = applyNerPersons(text, [person('Gz', 0.9)]);
  expect(r.redacted).toBe(`Zeznał świadek ${MASK} wczoraj.`);
});

test('nazwisko z myślnikiem pokryte w całości', () => {
  const text = 'Opinię wydała Rzepecka-Gil.';
  const r = applyNerPersons(text, [person('Rzepecka', 0.9), person('Gil', 0.9, false)]);
  expect(r.redacted).toBe(`Opinię wydała ${MASK}.`);
});

// ── Duplikat nazwiska: skan kursorowy (naprawa indexOf-od-0) ──────────────────

test('duplikat nazwiska → oba wystąpienia zamaskowane', () => {
  const text = 'Zeznania Nowaka potwierdził Nowak.';
  const r = applyNerPersons(text, [person('Nowaka'), O('potwierdził'), person('Nowak')]);
  expect(r.redacted).toBe(`Zeznania ${MASK} potwierdził ${MASK}.`);
  expect(r.found[0].count).toBe(2);
});

// ── Stoplista (przymiotniki geo / instytucje) ────────────────────────────────

test('przymiotnik geograficzny nie jest maskowany mimo etykiety osoby', () => {
  const text = 'Uniwersytet Warszawski ogłosił nabór.';
  expect(applyNerPersons(text, [person('Warszawski', 0.98)]).redacted).toBe(text);
});

test('odmieniony przymiotnik geo (Warszawskiego) odsiany', () => {
  const text = 'Rektor Uniwersytetu Warszawskiego wystąpił.';
  expect(applyNerPersons(text, [person('Warszawskiego', 0.97)]).redacted).toBe(text);
});

test('słowo instytucji (Najwyższy) nie jest maskowane', () => {
  const text = 'Sąd Najwyższy orzekł inaczej.';
  expect(applyNerPersons(text, [person('Najwyższy', 0.96)]).redacted).toBe(text);
});

test('nazwisko-przymiotnik Górski NIE jest w stopliście → maskowane', () => {
  const text = 'Zeznał Górski wczoraj.';
  expect(applyNerPersons(text, [person('Górski', 0.9)]).redacted).toBe(`Zeznał ${MASK} wczoraj.`);
});

// ── Homonimy rzeczowników pospolitych ────────────────────────────────────────

test('homonim domyślnie NIE jest maskowany — nawet przy bardzo wysokim score (precyzja > recall)', () => {
  // regresja z benchmarku: int8 FastPDN dawał „Lis przemknął…" score ≥0.9 (fałszywy pozytyw)
  expect(applyNerPersons('Wilk biegał po lesie za sarną.', [person('Wilk', 0.99)]).redacted).toBe(
    'Wilk biegał po lesie za sarną.',
  );
  expect(applyNerPersons('Lis przemknął przez drogę tuż przed autem.', [person('Lis', 0.97)]).redacted).toBe(
    'Lis przemknął przez drogę tuż przed autem.',
  );
});

test('homonim można włączyć opcją homographMinScore (opt-in)', () => {
  const text = 'Orzeczenie wydał sędzia Wilk osobiście.';
  expect(applyNerPersons(text, [person('Wilk', 0.95)], { homographMinScore: 0.9 }).redacted).toBe(
    `Orzeczenie wydał sędzia ${MASK} osobiście.`,
  );
  // poniżej progu opt-in → nie maskuj
  expect(applyNerPersons(text, [person('Wilk', 0.85)], { homographMinScore: 0.9 }).redacted).toBe(text);
});

// ── Rzadkie i obce nazwiska (domena przewagi NER) ────────────────────────────

test('rzadkie rodzime i obce nazwiska maskowane', () => {
  const text = 'Zeznali Achtelik, Nguyen oraz Fąfara.';
  const r = applyNerPersons(text, [person('Achtelik'), O(','), person('Nguyen'), O('oraz'), person('Fąfara')]);
  expect(r.redacted).toBe(`Zeznali ${MASK}, ${MASK} oraz ${MASK}.`);
  expect(r.found[0].count).toBe(3);
});

test('nazwiska obce z diakrytyką spoza polskiej — pokryte w całości (bez gubienia ü/č)', () => {
  const text = 'Reklamację złożył Müller, protokół podpisał Kovač.';
  const r = applyNerPersons(text, [person('Müller'), O(','), person('Kovač')]);
  expect(r.redacted).toBe(`Reklamację złożył ${MASK}, protokół podpisał ${MASK}.`);
  expect(r.found[0].count).toBe(2);
});

// ── Stoplista dla grup wielowyrazowych (regresja audytu: join(' ') vs join('')) ──

test('instytucja dwuwyrazowa (Sąd Najwyższy) NIE jest maskowana mimo etykiety osoby', () => {
  const text = 'Orzekł Sąd Najwyższy w składzie trzech sędziów.';
  const r = applyNerPersons(text, [person('Sąd'), person('Najwyższy', 0.95, false)]);
  expect(r.redacted).toBe(text);
});

test('Uniwersytet Warszawski (dwa tokeny) — odsiany przez stoplistę', () => {
  const text = 'Uniwersytet Warszawski ogłosił nabór.';
  expect(applyNerPersons(text, [person('Uniwersytet'), person('Warszawski', 0.95, false)]).redacted).toBe(text);
});

// ── Ochrona istniejących placeholderów (idempotencja — regresja audytu) ──

test('token trafiający w placeholder [IMIĘ I NAZWISKO] nie koroduje maski', () => {
  const text = 'Strona [IMIĘ I NAZWISKO] wniosła apelację.';
  expect(applyNerPersons(text, [person('IMIĘ', 0.9)]).redacted).toBe(text);
});

test('placeholder chroniony, ale prawdziwe nazwisko obok dalej maskowane', () => {
  const text = 'Zeznał [IMIĘ I NAZWISKO] oraz Gzowski.';
  const r = applyNerPersons(text, [person('IMIĘ', 0.9), O('oraz'), person('Gzowski', 0.9)]);
  expect(r.redacted).toBe('Zeznał [IMIĘ I NAZWISKO] oraz [IMIĘ I NAZWISKO].');
  expect(r.found[0].count).toBe(1);
});

test('token trafiający w placeholder [PESEL] nie jest re-maskowany', () => {
  const text = 'Numer [PESEL] został ukryty.';
  expect(applyNerPersons(text, [person('PESEL', 0.9)]).redacted).toBe(text);
});

// ── Bramka „prefix-grow" (regresja audytu: „Kot"→„Kotłownia") ──

test('krótki homonim NIE rozrasta się na zwykłe słowo (Kot → Kotłownia)', () => {
  const text = 'Zalana została Kotłownia w piwnicy.';
  expect(applyNerPersons(text, [person('Kot', 0.95)]).redacted).toBe(text);
});

test('krótki prefiks NIE rozrasta się na zwykłe słowo (mai → maila)', () => {
  const text = 'Wysłano treść maila do wszystkich stron.';
  expect(applyNerPersons(text, [person('mai', 0.9)]).redacted).toBe(text);
});

test('prefiks rozrasta się, gdy powstałe słowo JEST nazwiskiem (Gz → Gzowski)', () => {
  const text = 'Zeznał świadek Gzowski wczoraj.';
  expect(applyNerPersons(text, [person('Gz', 0.9)]).redacted).toBe(`Zeznał świadek ${MASK} wczoraj.`);
});

test('nazwisko z apostrofem w pełni pokryte (obie części otagowane)', () => {
  const text = "Zeznał świadek O'Brien wczoraj.";
  const r = applyNerPersons(text, [person('O'), person('Brien', 0.9, false)]);
  expect(r.redacted).toBe(`Zeznał świadek ${MASK} wczoraj.`);
});

// ── Rzeczowniki pospolite z wielkiej litery (regresja audytu F1) ──

test('rzeczownik dokumentowy z wielkiej litery NIE jest maskowany (Sprawa/Oświadczenie)', () => {
  expect(applyNerPersons('Sprawa dotyczy zwrotu kaucji.', [person('Sprawa', 0.9)]).redacted).toBe(
    'Sprawa dotyczy zwrotu kaucji.',
  );
  expect(applyNerPersons('Oświadczenie złożono w terminie.', [person('Oświadczenie', 0.95)]).redacted).toBe(
    'Oświadczenie złożono w terminie.',
  );
});

test('częsty rzeczownik przez krótki prefiks NIE jest maskowany (Kotł/Ko → Kotłownia)', () => {
  const text = 'Zalana została Kotłownia w piwnicy.';
  expect(applyNerPersons(text, [person('Kotł', 0.95)]).redacted).toBe(text);
  expect(applyNerPersons(text, [person('Ko', 0.95)]).redacted).toBe(text);
});

test('obce nazwisko przez krótki prefiks NADAL maskowane mimo fixu F1 (Schmi → Schmidt)', () => {
  const text = 'pełnomocnikiem był mecenas Schmidt osobiście';
  expect(applyNerPersons(text, [person('Schmi', 1.0)]).redacted).toBe(
    `pełnomocnikiem był mecenas ${MASK} osobiście`,
  );
});

// ── Wystąpienie w placeholderze nie porzuca grupy (regresja audytu F2) ──

test('kandydat trafiający NAJPIERW w placeholder maskuje prawdziwe późniejsze wystąpienie', () => {
  const text = '[PESEL] podał także Pesel jako pseudonim.';
  expect(applyNerPersons(text, [person('Pesel', 0.9)]).redacted).toBe(
    '[PESEL] podał także [IMIĘ I NAZWISKO] jako pseudonim.',
  );
});

// ── Scalanie i podmiana od końca ─────────────────────────────────────────────

test('wiele osób → poprawne pozycje bez korupcji offsetów (podmiana od końca)', () => {
  const text = 'A Kowalski B Nowak C Wiśniewski D';
  const r = applyNerPersons(text, [person('Kowalski'), O('B'), person('Nowak'), O('C'), person('Wiśniewski')]);
  expect(r.redacted).toBe(`A ${MASK} B ${MASK} C ${MASK} D`);
  expect(r.found[0].count).toBe(3);
});

// ── Przypadki brzegowe ───────────────────────────────────────────────────────

test('pusty tekst / brak tokenów → bez zmian', () => {
  expect(applyNerPersons('', [])).toEqual({ redacted: '', found: [] });
  expect(applyNerPersons('Jakiś tekst.', [])).toEqual({ redacted: 'Jakiś tekst.', found: [] });
});

test('same tokeny nie-osobowe → bez zmian', () => {
  const text = 'To jest zwykłe zdanie.';
  expect(applyNerPersons(text, [O('To'), O('jest'), O('zdanie')]).redacted).toBe(text);
});

test('custom mask', () => {
  const text = 'Zeznał Malinowski.';
  expect(applyNerPersons(text, [person('Malinowski')], { mask: '[OSOBA]' }).redacted).toBe('Zeznał [OSOBA].');
});

test('future-proof: użyj offsetów start/end gdy model je dostarczy', () => {
  const text = 'Zeznał Malinowski wczoraj.';
  // etykieta nie-osobowa, ale niech to nie ma znaczenia — sprawdzamy że gałąź offsetowa działa,
  // gdy tokeny person niosą start/end.
  const t: NerToken = { entity: 'B-nam_liv_person', word: 'X', score: 0.9, start: 7, end: 17 };
  expect(applyNerPersons(text, [t]).redacted).toBe(`Zeznał ${MASK} wczoraj.`);
});

// ── Eksportowane predykaty ───────────────────────────────────────────────────

test('defaultIsPersonLabel rozpoznaje warianty etykiet', () => {
  expect(defaultIsPersonLabel('B-nam_liv_person')).toBe(true);
  expect(defaultIsPersonLabel('I-nam_liv_person')).toBe(true);
  expect(defaultIsPersonLabel('PER')).toBe(true);
  expect(defaultIsPersonLabel('B-PER')).toBe(true);
  expect(defaultIsPersonLabel('persName')).toBe(true);
  expect(defaultIsPersonLabel('O')).toBe(false);
  expect(defaultIsPersonLabel('B-nam_loc_city')).toBe(false);
});

test('defaultIsStopword — geo/instytucje true, nazwiska false', () => {
  expect(defaultIsStopword('Warszawski')).toBe(true);
  expect(defaultIsStopword('Mazowiecki')).toBe(true);
  expect(defaultIsStopword('Jagielloński')).toBe(true);
  expect(defaultIsStopword('Śląski')).toBe(true);
  expect(defaultIsStopword('Sąd')).toBe(true);
  expect(defaultIsStopword('Kowalski')).toBe(false);
  expect(defaultIsStopword('Górski')).toBe(false);
  expect(defaultIsStopword('Nguyen')).toBe(false);
});

test('defaultIsHomograph — homonimy true (też w odmianie), zwykłe nazwiska false', () => {
  expect(defaultIsHomograph('Wilk')).toBe(true);
  expect(defaultIsHomograph('Baran')).toBe(true);
  expect(defaultIsHomograph('Wilka')).toBe(true);
  expect(defaultIsHomograph('Kowalski')).toBe(false);
  expect(defaultIsHomograph('Gzowski')).toBe(false);
});
