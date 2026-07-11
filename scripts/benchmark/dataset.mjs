/**
 * Syntetyczny zbiór ewaluacyjny do benchmarku precision/recall anonimizacji polskiego PII.
 *
 * DETERMINIZM: wszystkie wartości losowe pochodzą z PRNG mulberry32 z STAŁYM ziarnem
 * (SEED poniżej). Brak wywołań Math.random() bez ziarna — dwa uruchomienia generatora
 * dają IDENTYCZNY zbiór (stabilne porównania między wersjami silnika).
 *
 * Format przypadku:
 *   { id, category, text, mustMask: [...], mustKeep: [...] }
 *   - mustMask — dokładne podłańcuchy, które MUSZĄ zniknąć z wyniku redakcji (miara recall);
 *   - mustKeep — podłańcuchy, które MUSZĄ pozostać (miara precision-proxy; „zjedzenie"
 *     ich przez maskę to fałszywy pozytyw).
 *
 * Kategorie:
 *   - osoby-podstawowe — imię+nazwisko w mianowniku (konteksty: urzędowy/prawniczy/czatowy),
 *     formy żeńskie, mnogie, nazwiska dwuczłonowe, wyzwalacze („nazywam się", „Pan/Pani");
 *   - osoby-odmiana   — samo nazwisko w odmianie (dopełniacz/celownik/narzędnik, l.mn.)
 *     oraz odmienione pary „Jana Kowalskiego" (imię odmienione = znany słaby punkt słownika);
 *   - osoby-rzadkie   — nazwiska rzadkie/wymyślone (Bąkiewicz, Krzemieniecka, Gzowski…),
 *     z imieniem słownikowym, z imieniem rzadkim, solo w odmianie, z wyzwalaczem;
 *   - strukturalne    — PESEL/NIP/REGON/IBAN/telefon/e-mail/kod pocztowy/adres/data ur./dowód
 *     (wszystkie sumy kontrolne LICZONE w generatorze i weryfikowane asercją);
 *   - negatywy        — NIE wolno maskować: numery przepisów, sygnatury akt, Dz.U. poz.,
 *     instytucje, homonimy nazwisk (Wilk/Lis/Baran… jako zwierzęta itp.),
 *     ciągi 10–11 cyfr ze złą sumą kontrolną.
 *
 * Generator asercjami pilnuje własnej spójności: każda wartość „ważna" naprawdę przechodzi
 * walidację sum kontrolnych rdzenia, każda „zła" — nie przechodzi, a każdy podłańcuch
 * mustMask/mustKeep faktycznie występuje w tekście przypadku.
 */

import {
  isValidPesel,
  isValidNip,
  isValidRegon9,
  isValidRegon14,
  isValidIban,
  isValidDowod,
} from '../../packages/core/dist/index.js';

/** Stałe ziarno — zmiana ziarna to ŚWIADOMA zmiana wersji zbioru. */
export const SEED = 20260704;

// ============================================================================
// Deterministyczny PRNG (mulberry32) + pomocnicze
// ============================================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const randDigits = (rng, n) => Array.from({ length: n }, () => randInt(rng, 0, 9)).join('');

/** Asercja spójności generatora — błąd tutaj to błąd w SAMYM zbiorze, nie w silniku. */
function assert(cond, msg) {
  if (!cond) throw new Error(`[dataset] Błąd spójności zbioru: ${msg}`);
}

// ============================================================================
// Generatory wartości strukturalnych — sumy kontrolne liczone NA MIEJSCU
// ============================================================================

/** PESEL: data 1950–1999 (miesiąc bez przesunięcia stulecia) + seria + cyfra kontrolna. */
function genPesel(rng) {
  const yy = String(randInt(rng, 50, 99)).padStart(2, '0');
  const mm = String(randInt(rng, 1, 12)).padStart(2, '0');
  const dd = String(randInt(rng, 1, 28)).padStart(2, '0');
  const serial = randDigits(rng, 4);
  const d10 = yy + mm + dd + serial;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d10[i]) * w[i];
  const control = (10 - (sum % 10)) % 10;
  const pesel = d10 + String(control);
  assert(isValidPesel(pesel), `wygenerowany PESEL ${pesel} nie przechodzi walidacji`);
  return pesel;
}

/** NIP: 9 cyfr + cyfra kontrolna (sum%11); wynik 10 jest niedozwolony → losujemy ponownie. */
function genNip(rng) {
  for (;;) {
    const d9 = String(randInt(rng, 1, 9)) + randDigits(rng, 8);
    const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(d9[i]) * w[i];
    const control = sum % 11;
    if (control === 10) continue; // taka kombinacja nie tworzy poprawnego NIP
    const nip = d9 + String(control);
    assert(isValidNip(nip), `wygenerowany NIP ${nip} nie przechodzi walidacji`);
    return nip;
  }
}

/** REGON 9-cyfrowy: 8 cyfr + kontrola (sum%11, 10→0). */
function genRegon9(rng) {
  const d8 = String(randInt(rng, 1, 9)) + randDigits(rng, 7);
  const w = [8, 9, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(d8[i]) * w[i];
  const control = sum % 11 === 10 ? 0 : sum % 11;
  const regon = d8 + String(control);
  assert(isValidRegon9(regon), `wygenerowany REGON9 ${regon} nie przechodzi walidacji`);
  return regon;
}

/** REGON 14-cyfrowy: 13 cyfr + kontrola (sum%11, 10→0). */
function genRegon14(rng) {
  const d13 = String(randInt(rng, 1, 9)) + randDigits(rng, 12);
  const w = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(d13[i]) * w[i];
  const control = sum % 11 === 10 ? 0 : sum % 11;
  const regon = d13 + String(control);
  assert(isValidRegon14(regon), `wygenerowany REGON14 ${regon} nie przechodzi walidacji`);
  return regon;
}

/** mod 97 dla łańcucha IBAN po zamianie liter na liczby (A=10 … Z=35) — bez BigInt. */
function ibanMod97(s) {
  let remainder = 0;
  for (const ch of s) {
    const code = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of code) remainder = (remainder * 10 + Number(c)) % 97;
  }
  return remainder;
}

/**
 * IBAN PL: losowe 24 cyfry BBAN + POLICZONE cyfry kontrolne mod-97
 * (check = 98 − mod97(BBAN + "PL00")). Wynik: „PL" + 26 cyfr (28 znaków).
 */
function genIbanPl(rng) {
  const bban = randDigits(rng, 24);
  const check = String(98 - ibanMod97(bban + 'PL00')).padStart(2, '0');
  const iban = 'PL' + check + bban;
  assert(isValidIban(iban), `wygenerowany IBAN ${iban} nie przechodzi walidacji mod-97`);
  return iban;
}

/**
 * Nr dowodu: 3 litery + cyfra kontrolna (pozycja 4, waga 9) + 5 cyfr.
 * Suma ważona wszystkich 9 znaków (A=10…Z=35) musi być podzielna przez 10;
 * 9d ≡ −S (mod 10), a 9⁻¹ (mod 10) = 9, stąd d = 9·(10 − S%10) mod 10.
 */
function genDowod(rng) {
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + randInt(rng, 0, 25))).join('');
  const tail = randDigits(rng, 5);
  const w = [7, 3, 1, 9, 1, 7, 3, 1, 7];
  const chars = letters + '0' + tail; // miejsce kontrolne tymczasowo 0
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    if (i === 3) continue; // pozycję kontrolną liczymy osobno
    const ch = chars[i];
    const val = /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : Number(ch);
    sum += val * w[i];
  }
  const d = (9 * ((10 - (sum % 10)) % 10)) % 10;
  const dowod = letters + String(d) + tail;
  assert(isValidDowod(dowod), `wygenerowany nr dowodu ${dowod} nie przechodzi walidacji`);
  return dowod;
}

/** Zepsuj sumę kontrolną: podbij ostatnią cyfrę o 1 (mod 10). */
function flipLastDigit(s) {
  const last = Number(s[s.length - 1]);
  return s.slice(0, -1) + String((last + 1) % 10);
}

/** Grupowanie cyfr po 4 (czytelny zapis IBAN/NRB). */
const group4 = (digits) => digits.match(/.{1,4}/g).join(' ');

// ============================================================================
// Budowa zbioru
// ============================================================================

export function buildDataset() {
  const rng = mulberry32(SEED);

  // ── Wartości strukturalne (KOLEJNOŚĆ generacji = stabilność zbioru; nie przestawiać) ──
  const P3 = genPesel(rng);
  const P4 = genPesel(rng);
  const P5 = genPesel(rng);
  const P6 = genPesel(rng);
  const NIP1 = genNip(rng);
  const R9B = genRegon9(rng);
  const R14 = genRegon14(rng);
  const IBAN_A = genIbanPl(rng); // ciągły, z prefiksem PL
  const IBAN_B = genIbanPl(rng); // zapis grupowany spacjami
  const NRB_A = genIbanPl(rng).slice(2); // 26 cyfr (bez PL) — kotwica „konto/rachunek"
  const NRB_B = genIbanPl(rng).slice(2);
  const IBAN_BAD = flipLastDigit(genIbanPl(rng));
  const DOWOD_B = genDowod(rng);

  // Wartości stałe z zadania — weryfikujemy sumy kontrolne przy budowie zbioru.
  assert(isValidPesel('44051401359'), 'stały PESEL 44051401359 powinien być poprawny');
  assert(isValidPesel('90010112349'), 'stały PESEL 90010112349 powinien być poprawny');
  assert(isValidNip('1234563218'), 'stały NIP 1234563218 powinien być poprawny');
  assert(isValidRegon9('123456785'), 'stały REGON 123456785 powinien być poprawny');
  assert(isValidDowod('ABA300000'), 'stały nr dowodu ABA300000 powinien być poprawny');
  // …a wartości celowo błędne NIE mogą przechodzić walidacji:
  assert(!isValidPesel('44051401350'), 'PESEL 44051401350 ma być błędny');
  assert(!isValidNip('1234563210'), 'NIP 1234563210 ma być błędny');
  assert(!isValidRegon9('123456784'), 'REGON 123456784 ma być błędny');
  assert(!isValidIban(IBAN_BAD), `IBAN ${IBAN_BAD} ma być błędny`);
  assert(!isValidDowod('ABA300001'), 'nr dowodu ABA300001 ma być błędny');
  assert(!isValidPesel('12345678901'), 'ciąg 12345678901 ma być błędny jako PESEL');
  assert(!isValidNip('4561237891'), 'ciąg 4561237891 ma być błędny jako NIP');

  const cases = [];
  const counters = new Map();
  /** Dodaj przypadek z automatyczną numeracją w kategorii. */
  const add = (category, prefix, text, mustMask, mustKeep = []) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    cases.push({ id: `${prefix}-${String(n).padStart(2, '0')}`, category, text, mustMask, mustKeep });
  };
  const osp = (t, mm, mk) => add('osoby-podstawowe', 'os-p', t, mm, mk);
  const oso = (t, mm, mk) => add('osoby-odmiana', 'os-o', t, mm, mk);
  const osr = (t, mm, mk) => add('osoby-rzadkie', 'os-r', t, mm, mk);
  // osoby-rzadkie-ner: nazwiska, których rdzeń deterministyczny NIE łapie (brak wyzwalacza,
  // brak sufiksu -ski/-cki/-icz/-czyk, nazwiska obce) — tu warstwa NER ma dać przewagę recall.
  const osrn = (t, mm, mk) => add('osoby-rzadkie-ner', 'os-rn', t, mm, mk);
  // osoby-slownik: częste nazwiska z rozszerzonego słownika PESEL (bez sufiksu -ski/-cki/-icz/-czyk),
  // samodzielnie/w odmianie, bez wyzwalacza — rdzeń deterministyczny łapie je BEZ AI (strażnik słownika).
  const osd = (t, mm, mk) => add('osoby-slownik', 'os-sl', t, mm, mk);
  const str = (t, mm, mk) => add('strukturalne', 'str', t, mm, mk);
  const neg = (t, mk) => add('negatywy', 'neg', t, [], mk);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-PODSTAWOWE — mianownik, konteksty urzędowe/prawnicze/czatowe
  // ──────────────────────────────────────────────────────────────────────────
  osp('Pozwany Jan Kowalski nie stawił się na rozprawie.', ['Jan', 'Kowalski'], ['Pozwany', 'rozprawie']);
  osp('Powódka Anna Nowak wniosła o zasądzenie kosztów.', ['Anna', 'Nowak'], ['Powódka', 'kosztów']);
  osp('Świadek Piotr Wiśniewski zeznał, że widział zdarzenie.', ['Piotr', 'Wiśniewski'], ['Świadek']);
  osp('Umowę podpisała Katarzyna Zielińska w obecności notariusza.', ['Katarzyna', 'Zielińska'], ['notariusza']);
  osp('Wniosek złożył Tomasz Szymański dnia 12 marca.', ['Tomasz', 'Szymański'], ['Wniosek', '12 marca']);
  osp('Magdalena Woźniak została powołana do zarządu.', ['Magdalena', 'Woźniak'], ['zarządu']);
  osp('Krzysztof Kaczmarek prowadzi warsztat przy rynku.', ['Krzysztof', 'Kaczmarek'], ['warsztat']);
  osp('Na spotkanie przyszedł Marek Mazur z dokumentami.', ['Marek', 'Mazur'], ['dokumentami']);
  osp('Ewa Lewandowska odebrała przesyłkę osobiście.', ['Ewa', 'Lewandowska'], ['przesyłkę']);
  osp('hej, pisze do was Jakub Dąbrowski, mam pytanie o umowę', ['Jakub', 'Dąbrowski'], ['umowę']);
  // formy żeńskie
  osp('Anna Kowalska wygrała sprawę w drugiej instancji.', ['Anna', 'Kowalska'], ['instancji']);
  osp('Agnieszka Wiśniewska złożyła reklamację w sklepie.', ['Agnieszka', 'Wiśniewska'], ['reklamację']);
  osp('Nowa księgowa to Joanna Zielińska.', ['Joanna', 'Zielińska'], ['księgowa']);
  // liczba mnoga
  osp('Anna i Jan Kowalscy kupili mieszkanie na osiedlu.', ['Anna', 'Jan', 'Kowalscy'], ['mieszkanie']);
  osp('Państwo Nowakowie wynajmują lokal od miasta.', ['Nowakowie'], ['lokal']);
  // nazwiska dwuczłonowe z myślnikiem
  osp('Maria Nowak-Kowalska reprezentuje spółkę.', ['Maria', 'Nowak-Kowalska'], ['spółkę']);
  osp('Pełnomocnikiem jest Karolina Zielińska-Wójcik.', ['Karolina', 'Zielińska-Wójcik'], ['Pełnomocnikiem']);
  osp('Pismo podpisała Hanna Kowalczyk-Nowak.', ['Hanna', 'Kowalczyk-Nowak'], ['Pismo']);
  // wyzwalacze kontekstu
  osp('Nazywam się Robert Malinowski i piszę w sprawie faktury.', ['Robert', 'Malinowski'], ['faktury']);
  osp('Mam na imię Weronika, nazwisko Sobczak.', ['Weronika', 'Sobczak'], []);
  osp('Pan Wiśniewski nie odpowiada na wezwania.', ['Wiśniewski'], ['nie odpowiada', 'wezwania']);
  osp('Proszę przekazać dokumenty pani Kowalskiej.', ['Kowalskiej'], ['dokumenty']);
  osp('Imię i nazwisko: Adrian Borkowski.', ['Adrian', 'Borkowski'], []);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-ODMIANA — samo nazwisko w przypadku zależnym (bez imienia, bez wyzwalacza)
  // ──────────────────────────────────────────────────────────────────────────
  // odmiana rzeczownikowa: dopełniacz / celownik / narzędnik
  oso('Sprawę Nowaka umorzono z braku dowodów.', ['Nowaka'], ['umorzono', 'dowodów']);
  oso('Sąd doręczył Nowakowi odpis wyroku.', ['Nowakowi'], ['Sąd', 'wyroku']);
  oso('Ugoda zawarta z Nowakiem obowiązuje od stycznia.', ['Nowakiem'], ['Ugoda', 'stycznia']);
  oso('Pełnomocnik Wójcika złożył apelację.', ['Wójcika'], ['apelację']);
  oso('Wierzyciel wystąpił przeciwko Wójcikowi z pozwem.', ['Wójcikowi'], ['Wierzyciel']);
  oso('Negocjacje z Wójcikiem zakończyły się ugodą.', ['Wójcikiem'], ['ugodą']);
  oso('Zeznania Kaczmarka potwierdzili sąsiedzi.', ['Kaczmarka'], ['sąsiedzi']);
  oso('Komornik zajął wynagrodzenie Woźniaka.', ['Woźniaka'], ['Komornik']);
  oso('Grunt należał wcześniej do Kowalczyka.', ['Kowalczyka'], ['Grunt']);
  // odmiana przymiotnikowa (-ski/-cki)
  oso('Wniosek Kowalskiego oddalono w całości.', ['Kowalskiego'], ['Wniosek']);
  oso('Kowalskiemu wręczono wypowiedzenie umowy.', ['Kowalskiemu'], ['wypowiedzenie']);
  oso('Protokół podpisano razem z Kowalskim.', ['Kowalskim'], ['Protokół']);
  oso('Apelacja Wiśniewskiego okazała się skuteczna.', ['Wiśniewskiego'], ['Apelacja']);
  oso('Sąd przyznał Wiśniewskiemu zwrot kosztów.', ['Wiśniewskiemu'], ['zwrot kosztów']);
  oso('Obrońca Zielińskiego wniósł o uniewinnienie.', ['Zielińskiego'], ['Obrońca']);
  // formy żeńskie odmienione
  oso('Zeznania Wiśniewskiej uznano za wiarygodne.', ['Wiśniewskiej'], ['wiarygodne']);
  oso('Sprawę przeciwko Zielińskiej zawieszono.', ['Zielińskiej'], ['zawieszono']);
  oso('Rozmawiałem z Kowalską o warunkach najmu.', ['Kowalską'], ['najmu']);
  oso('Mieszkanie Kamińskiej zostało wycenione.', ['Kamińskiej'], ['wycenione']);
  // liczba mnoga odmieniona
  oso('Nieruchomość Kowalskich objęto hipoteką.', ['Kowalskich'], ['hipoteką']);
  oso('Spadek po Nowakach podzielono na troje dzieci.', ['Nowakach'], ['Spadek']);
  oso('Roszczenia Wiśniewskich przedawniły się w maju.', ['Wiśniewskich'], ['przedawniły']);
  // odmienione pary imię+nazwisko (imię w przypadku zależnym — poza słownikiem mianowników)
  oso('Pozew Jana Kowalskiego wpłynął we wtorek.', ['Jana', 'Kowalskiego'], ['Pozew']);
  oso('Sąd wysłuchał Anny Wiśniewskiej na rozprawie zdalnej.', ['Anny', 'Wiśniewskiej'], ['rozprawie']);
  oso('Zarzuty postawiono Piotrowi Zielińskiemu.', ['Piotrowi', 'Zielińskiemu'], ['Zarzuty']);
  oso('Nagrodę wręczono Magdalenie Woźniak.', ['Magdalenie', 'Woźniak'], ['Nagrodę']);
  // rejestr potoczny/czatowy
  oso('u Szymańskiego w biurze zostawiłem parasol', ['Szymańskiego'], ['parasol']);
  oso('pytałem Lewandowskiego, ale nie odpisał', ['Lewandowskiego'], ['nie odpisał']);
  oso('wczoraj widziałem Dąbrowskiego w urzędzie', ['Dąbrowskiego'], ['urzędzie']);
  oso('Krawczykowi nikt nie uwierzył.', ['Krawczykowi'], ['nie uwierzył']);
  oso('Dokumenty od Grabowskiej dotarły pocztą.', ['Grabowskiej'], ['pocztą']);
  oso('Decyzję wysłano do Jankowskich.', ['Jankowskich'], ['Decyzję']);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-RZADKIE — nazwiska rzadkie/wymyślone (spoza słownika najczęstszych)
  // ──────────────────────────────────────────────────────────────────────────
  // z imieniem słownikowym (kotwica na imieniu powinna działać)
  osr('Marek Bąkiewicz podpisał protokół odbioru.', ['Marek', 'Bąkiewicz'], ['protokół']);
  osr('Alicja Krzemieniecka złożyła wniosek o urlop.', ['Alicja', 'Krzemieniecka'], ['urlop']);
  osr('Tadeusz Gzowski wynajął magazyn pod miastem.', ['Tadeusz', 'Gzowski'], ['magazyn']);
  osr('Ewelina Zdrojewczyk odebrała nagrodę jubileuszową.', ['Ewelina', 'Zdrojewczyk'], ['nagrodę']);
  osr('Norbert Pękalski przesłał ofertę w terminie.', ['Norbert', 'Pękalski'], ['ofertę']);
  // imię rzadkie + nazwisko rzadkie (poza słownikiem imion — pełny test NER)
  osr('Świętomira Gzowska przyszła na przesłuchanie.', ['Świętomira', 'Gzowska'], ['przesłuchanie']);
  osr('Bożydar Krzemieniecki prowadzi kancelarię w Radomiu.', ['Bożydar', 'Krzemieniecki'], ['Radomiu']);
  osr('Protokół sporządził Wieńczysław Trzebiatowski.', ['Wieńczysław', 'Trzebiatowski'], ['Protokół']);
  // solo w odmianie (bez imienia i wyzwalacza — poza zasięgiem słownika rdzenia)
  osr('napisała do mnie Krzemieniecka w sprawie zaliczki', ['Krzemieniecka'], ['zaliczki']);
  osr('sprawę Zdrojewczyka przekazano do prokuratury', ['Zdrojewczyka'], ['prokuratury']);
  osr('list od Gzowskiego leżał na biurku tydzień', ['Gzowskiego'], ['biurku']);
  osr('Bąkiewiczowi zależało na szybkiej wypłacie.', ['Bąkiewiczowi'], ['wypłacie']);
  osr('Zaległości Trzebiatowskiego rosły z miesiąca na miesiąc.', ['Trzebiatowskiego'], ['Zaległości']);
  osr('Wniosek Młodzianowskiej rozpatrzono odmownie.', ['Młodzianowskiej'], ['odmownie']);
  // z wyzwalaczem kontekstu (rdzeń powinien łapać mimo rzadkości)
  osr('Pani Krzemieniecka prosi o kontakt po godzinie 15.', ['Krzemieniecka'], ['po godzinie 15']);
  osr('Proszę o pilny telefon do pana Pękalskiego.', ['Pękalskiego'], ['telefon']);
  osr('Pan Habdank-Wojewódzki oczekuje w sekretariacie.', ['Habdank', 'Wojewódzki'], ['sekretariacie']);
  osr('Nazywam się Melania Szczudłowska i proszę o fakturę korygującą.', ['Melania', 'Szczudłowska'], ['fakturę']);
  // żeńskie rzadkie w mianowniku, solo
  osr('Fiołkowska wygrała przetarg na dostawę mebli.', ['Fiołkowska'], ['przetarg']);
  osr('Opinię przygotowała Gzowska z działu prawnego.', ['Gzowska'], ['działu prawnego']);
  // liczba mnoga rzadkich
  osr('Państwo Bąkiewiczowie odwołali się od decyzji.', ['Bąkiewiczowie'], ['decyzji']);
  osr('Spór z Krzemienieckimi trwa od dwóch lat.', ['Krzemienieckimi'], ['Spór']);
  // dwuczłonowe rzadkie
  osr('Dorota Sajkowska-Mróz podpisała aneks.', ['Dorota', 'Sajkowska-Mróz'], ['aneks']);
  osr('opinia Rzepeckiej-Gil była druzgocąca', ['Rzepeckiej-Gil'], ['opinia']);

  // ──────────────────────────────────────────────────────────────────────────
  // STRUKTURALNE — identyfikatory z POPRAWNYMI sumami kontrolnymi
  // ──────────────────────────────────────────────────────────────────────────
  // PESEL
  str('PESEL: 44051401359', ['44051401359'], ['PESEL:']);
  str('Mój PESEL to 90010112349, proszę o weryfikację.', ['90010112349'], ['weryfikację']);
  str(`Wnioskodawca legitymuje się numerem PESEL ${P3}.`, [P3], ['Wnioskodawca']);
  str(`W formularzu wpisano ${P4} jako identyfikator.`, [P4], ['formularzu']);
  // NIP (ciągiem i z myślnikami — oba układy separatorów)
  str('NIP firmy: 1234563218.', ['1234563218'], ['NIP firmy']);
  str('Faktura wystawiona dla NIP 123-456-32-18.', ['123-456-32-18'], ['Faktura']);
  str('Kontrahent posługuje się NIP 123-45-63-218.', ['123-45-63-218'], ['Kontrahent']);
  str(`Numer identyfikacji podatkowej ${NIP1} należy do spółki.`, [NIP1], ['spółki']);
  // REGON (9-cyfrowy z kotwicą „REGON", 14-cyfrowy samodzielnie)
  str('REGON 123456785 widnieje w rejestrze.', ['123456785'], ['rejestrze']);
  str(`Spółka o numerze REGON: ${R9B} zawiesiła działalność.`, [R9B], ['działalność']);
  str(`${R14} to REGON jednostki lokalnej.`, [R14], ['jednostki lokalnej']);
  // IBAN / numer konta (cyfry kontrolne mod-97 policzone w generatorze)
  str(`Przelew na rachunek ${IBAN_A} do końca miesiąca.`, [IBAN_A], ['Przelew']);
  str(`IBAN: ${'PL' + IBAN_B.slice(2, 4) + ' ' + group4(IBAN_B.slice(4))} (mBank).`, [group4(IBAN_B.slice(4))], ['mBank']);
  str(`Numer konta: ${NRB_A.slice(0, 2) + ' ' + group4(NRB_A.slice(2))} prowadzony w PKO.`, [group4(NRB_A.slice(2))], ['PKO']);
  str(`Zwrot nastąpi na konto ${NRB_B} wskazane w umowie.`, [NRB_B], ['Zwrot', 'umowie']);
  // telefony
  str('Kontakt: +48 601 234 567 po godzinie 17.', ['601 234 567'], ['po godzinie 17']);
  str('Zadzwoń pod 512 345 678 wieczorem.', ['512 345 678'], ['wieczorem']);
  str('Numer telefonu 601-234-567 jest nieaktualny.', ['601-234-567'], ['nieaktualny']);
  str('sms na 728901234 nie doszedł', ['728901234'], ['nie doszedł']);
  str('Infolinia oddzwoni z +48501234567.', ['501234567'], ['Infolinia']);
  // e-maile
  str('Proszę o odpowiedź na jan.kowalski@example.com w tym tygodniu.', ['jan.kowalski@example.com'], ['tygodniu']);
  str('Zgłoszenia przyjmujemy pod adresem biuro+rekrutacja@firma.com.pl.', ['biuro+rekrutacja@firma.com.pl'], ['Zgłoszenia']);
  str('e-mail: a.nowak-wojcik@uw.edu.pl (służbowy)', ['a.nowak-wojcik@uw.edu.pl'], ['służbowy']);
  // kody pocztowe
  // miejscowość po kodzie pocztowym jest maskowana od v0.26 (funkcja „Miejscowość")
  str('Adres do doręczeń: 00-950 Warszawa, skrytka 21.', ['00-950', 'Warszawa'], ['skrytka 21']);
  str('Przesyłkę nadano z kodu 31-042.', ['31-042'], ['nadano']);
  // adresy
  str('Zamieszkały przy ul. Polnej 12/3 w Krakowie.', ['ul. Polnej 12/3'], ['Krakowie']);
  str('Biuro mieści się przy al. Jerozolimskich 44.', ['al. Jerozolimskich 44'], ['Biuro']);
  str('Nowy lokal: os. Piastów 3/12, obok szkoły.', ['os. Piastów 3/12'], ['szkoły']);
  str('Spotkanie odbędzie się na pl. Zbawiciela 5.', ['pl. Zbawiciela 5'], ['Spotkanie']);
  str('Mieszkam na ulicy Krakowskie Przedmieście 26/28.', ['Krakowskie Przedmieście 26/28'], ['Mieszkam']);
  str('ul. Marszałkowska 140 m. 7 to adres korespondencyjny.', ['ul. Marszałkowska 140'], ['korespondencyjny']);
  // daty urodzenia (z jawnym kontekstem)
  // miasto zamieszkania to dana osobowa (decyzja produktowa): marker „zamieszkały w" → maskuj miasto
  str('Wnioskodawca, ur. 12.05.1985, zamieszkały w Łodzi.', ['12.05.1985', 'Łodzi'], ['Wnioskodawca']);
  str('Urodzona 3.04.1992 w Poznaniu.', ['3.04.1992'], ['Poznaniu']);
  str('Data urodzenia: 1990-01-01 (wg aktu).', ['1990-01-01'], ['wg aktu']);
  str('urodzony 07/11/1978 w Gdańsku', ['07/11/1978'], ['Gdańsku']);
  // numery dowodów osobistych
  str('Seria i numer dowodu: ABA300000.', ['ABA300000'], ['Seria i numer']);
  str(`Legitymuje się dowodem ${DOWOD_B}.`, [DOWOD_B], ['Legitymuje']);
  // przypadki łączone (kilka typów PII w jednym zdaniu)
  str(
    `Dłużnik (PESEL ${P5}) zamieszkały przy ul. Długiej 8/2, tel. 604 112 233.`,
    [P5, 'ul. Długiej 8/2', '604 112 233'],
    ['Dłużnik'],
  );
  str(
    `Nadawca Piotr Nowak, konto ${NRB_B}, e-mail piotr.nowak@onet.pl.`,
    ['Piotr', 'Nowak', NRB_B, 'piotr.nowak@onet.pl'],
    ['Nadawca'],
  );
  str(
    `Klientka Anna Zielińska (PESEL ${P6}, tel. 500-600-700) prosi o kontakt.`,
    ['Anna', 'Zielińska', P6, '500-600-700'],
    ['Klientka', 'kontakt'],
  );

  // ──────────────────────────────────────────────────────────────────────────
  // NEGATYWY — tego NIE wolno maskować
  // ──────────────────────────────────────────────────────────────────────────
  // numery przepisów i odwołania do aktów
  neg('Zgodnie z art. 123 456 789 nie stosuje się przepisów przejściowych.', ['123 456 789']);
  neg('Podstawą roszczenia jest art. 415 KC.', ['art. 415 KC']);
  neg('Oskarżono go z art. 148 § 1 Kodeksu karnego.', ['art. 148 § 1', 'Kodeksu karnego']);
  neg('Zastosowanie ma ust. 2 pkt 3 lit. b.', ['ust. 2 pkt 3']);
  neg('Rozporządzenie opublikowano w Dz.U. z 2023 r. poz. 1234.', ['poz. 1234']);
  neg('Przepis § 7 regulaminu pozostaje w mocy.', ['§ 7', 'regulaminu']);
  neg('Zakres art. 10-100 obejmuje przepisy ogólne.', ['10-100']);
  // sygnatury akt
  neg('Wyrok w sprawie II K 123/45 uprawomocnił się.', ['II K 123/45']);
  neg('Sygn. akt III CZP 12/23 — uchwała siedmiu sędziów.', ['III CZP 12/23']);
  neg('Apelację oddalono w sprawie I ACa 1234/22.', ['I ACa 1234/22']);
  // instytucje i akty prawne (wielkie litery, ale to nie osoby)
  neg('Sąd Najwyższy oddalił skargę kasacyjną.', ['Sąd Najwyższy']);
  neg('Trybunał Konstytucyjny odroczył ogłoszenie wyroku.', ['Trybunał Konstytucyjny']);
  neg('Nowelizacja Kodeksu Cywilnego weszła w życie w maju.', ['Kodeksu Cywilnego']);
  neg('Urząd Skarbowy wezwał spółkę do korekty deklaracji.', ['Urząd Skarbowy']);
  neg('Ministerstwo Sprawiedliwości opublikowało projekt ustawy.', ['Ministerstwo Sprawiedliwości']);
  neg('Zakład Ubezpieczeń Społecznych wydał decyzję odmowną.', ['Zakład Ubezpieczeń Społecznych']);
  neg('Naczelny Sąd Administracyjny uchylił zaskarżony wyrok.', ['Naczelny Sąd Administracyjny']);
  neg('Skierowano pytanie do Izby Cywilnej Sądu Najwyższego.', ['Izby Cywilnej']);
  neg('Prokuratura Okręgowa w Warszawie umorzyła śledztwo.', ['Prokuratura Okręgowa', 'Warszawie']);
  neg('Rzecznik Praw Obywatelskich zabrał głos w debacie.', ['Rzecznik Praw Obywatelskich']);
  // homonimy nazwisk — rzeczowniki pospolite, dni, miesiące (kontekst niebędący osobą)
  neg('Wilk biegał po lesie za sarną.', ['Wilk']);
  neg('Lis przemknął przez drogę tuż przed autem.', ['Lis']);
  neg('Baran to pierwszy znak zodiaku.', ['Baran']);
  neg('Mazurek wielkanocny stygł na parapecie.', ['Mazurek']);
  neg('Sowa hukała całą noc pod oknem.', ['Sowa']);
  neg('Kruk krukowi oka nie wykole, jak mówi przysłowie.', ['Kruk']);
  neg('Dudek to ptak o charakterystycznym czubie.', ['Dudek']);
  neg('Kot przewrócił doniczkę z parapetu.', ['Kot']);
  neg('W piątek trzynastego lepiej zostać w domu.', ['piątek']);
  neg('Kwiecień plecień, bo przeplata trochę zimy, trochę lata.', ['Kwiecień']);
  neg('Król wydał ucztę na zamku.', ['Król']);
  // ciągi cyfr ze ZŁĄ sumą kontrolną — muszą zostać nietknięte
  neg('Numer 44051401350 nie przeszedł walidacji w systemie.', ['44051401350']);
  neg('Ciąg 1234563210 to przykładowy identyfikator testowy.', ['1234563210']);
  neg('REGON 123456784 zawiera błąd i został odrzucony.', ['123456784']);
  neg(`Rachunek ${IBAN_BAD} ma błędną sumę kontrolną.`, [IBAN_BAD]);
  // dowód BEZ kontekstu wymaga poprawnej sumy kontrolnej (v0.30) — ABA300001 ma złą sumę,
  // więc (jak sygnatura/kod) pozostaje; realny dowód z kontekstem „dowód…" maskuje gałąź (a)
  neg('Seria ABA300001 nie jest poprawnym numerem dowodu.', ['ABA300001']);
  neg('Wartość 12345678901 pojawiła się w logu importu.', ['12345678901']);
  // ciągi cyfr osłonięte kontekstem numeracyjnym
  neg('Zamówienie nr 987654321 zostało wysłane kurierem.', ['987654321']);
  neg('Faktura VAT nr 4561237891 czeka na akceptację.', ['4561237891']);
  // pułapka wyzwalacza „Pan" — tytuł dzieła, nie osoba
  neg('Pan Tadeusz to najsłynniejsza polska epopeja narodowa.', ['Tadeusz']);
  // przymiotniki geograficzne/instytucjonalne w nazwach własnych — warstwa NER NIE może ich
  // maskować (stoplista NON_SURNAME_ADJ / LEGAL_ENTITY w ner-postprocess). To dowód precyzji AI.
  neg('Uniwersytet Warmiński ogłosił nabór na studia.', ['Warmiński']);
  neg('Kredyt zaciągnięto w Banku Śląskim w zeszłym roku.', ['Śląskim']);
  neg('Komitet Obywatelski wystosował apel do władz.', ['Obywatelski']);
  neg('Powstał Ogólnopolski Związek Przewoźników Drogowych.', ['Ogólnopolski']);
  neg('Uniwersytet Jagielloński świętuje jubileusz.', ['Jagielloński']);
  neg('Skargę rozpoznał Wojewódzki Sąd Administracyjny.', ['Wojewódzki']);
  // dodatkowe sygnatury akt (pilnują, że warstwa NER nie tknie oznaczeń spraw)
  neg('Postanowienie zapadło w sprawie IV CSK 77/24.', ['IV CSK 77/24']);
  neg('Skargę kasacyjną zarejestrowano pod III UK 210/23.', ['III UK 210/23']);
  // instytucje z przymiotnikiem (chronione stoplistą LEGAL_ENTITY/NON_SURNAME_ADJ w NER)
  neg('Sąd Rejonowy w Pruszkowie wydał nakaz.', ['Rejonowy']);
  neg('Prokuratura Krajowa wszczęła postępowanie.', ['Krajowa']);
  neg('Wojewódzki Fundusz Ochrony Środowiska ogłosił nabór.', ['Wojewódzki']);
  neg('Naczelny Sąd Administracyjny oddalił skargę.', ['Naczelny']);
  // homonimy w kontekście rzeczownikowym (warstwa NER nie maskuje homonimów)
  neg('Sroka skakała po świeżo skoszonym trawniku.', ['Sroka']);
  neg('Mróz ściął kałuże twardą skorupą nad ranem.', ['Mróz']);
  neg('Kruk siedział na gałęzi i obserwował drogę.', ['Kruk']);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-RZADKIE-NER — rdzeń deterministyczny je PRZEPUSZCZA (brak wyzwalacza, brak sufiksu
  // -ski/-cki/-icz/-czyk, nazwiska obce). Recall zależy od warstwy NER — to tu dowodzimy jej
  // przewagi. mustKeep pilnuje, że kontekst nie jest zjadany.
  // ──────────────────────────────────────────────────────────────────────────
  osrn('list od Achtelika leżał tydzień na biurku', ['Achtelika'], ['biurku']);
  osrn('sprawę Fąfary umorzono w drugiej instancji', ['Fąfary'], ['umorzono']);
  osrn('zeznania Gągały spisano protokolarnie', ['Gągały'], ['protokolarnie']);
  osrn('wniosek Grzmota rozpatrzono odmownie', ['Grzmota'], ['odmownie']);
  osrn('do akt dołączono notatkę Ciołka z rozmowy', ['Ciołka'], ['notatkę']);
  osrn('reklamację złożył wczoraj Müller osobiście', ['Müller'], ['reklamację']);
  osrn('umowę parafował Nguyen dzień wcześniej', ['Nguyen'], ['umowę']);
  osrn('protokół podpisał Kovač w obecności świadka', ['Kovač'], ['świadka']);
  osrn('opinię biegłego sporządził Popescu w terminie', ['Popescu'], ['opinię']);
  osrn('pełnomocnikiem powoda był mecenas Schmidt', ['Schmidt'], ['powoda']);
  // dalsze rzadkie rodzime bez wyzwalacza/sufiksu -ski/-cki/-icz/-czyk
  osrn('sprawę Pytlaka odroczono do przyszłego miesiąca', ['Pytlaka'], ['odroczono']);
  osrn('zeznania Habaja spisano na komisariacie', ['Habaja'], ['komisariacie']);
  osrn('wniosek Momota oddalono w pierwszej instancji', ['Momota'], ['instancji']);
  osrn('do akt dołączono notatkę Cieciory z narady', ['Cieciory'], ['narady']);
  osrn('pismo od Bździucha wpłynęło z opóźnieniem', ['Bździucha'], ['opóźnieniem']);
  // dalsze nazwiska obce (różne systemy)
  osrn('opinię prawną wydał Petrov zeszłego tygodnia', ['Petrov'], ['opinię']);
  osrn('umowę serwisową parafował Horvat osobiście', ['Horvat'], ['umowę']);
  osrn('reklamację rozpatrzył Weber w dwa dni', ['Weber'], ['reklamację']);
  osrn('kontrakt firmował Rossi przed notariuszem', ['Rossi'], ['kontrakt']);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-SLOWNIK — częste nazwiska z rozszerzonego słownika PESEL (deterministyka, bez AI)
  // ──────────────────────────────────────────────────────────────────────────
  osd('Sprawę Szczepaniaka umorzono w drugiej instancji.', ['Szczepaniaka'], ['umorzono']);
  osd('Zeznania Madeja potwierdzili sąsiedzi.', ['Madeja'], ['sąsiedzi']);
  osd('Wniosek Michalika rozpatrzono odmownie.', ['Michalika'], ['odmownie']);
  osd('list od Ratajczaka leżał tydzień na biurku', ['Ratajczaka'], ['biurku']);
  osd('pismo od Grzelaka wpłynęło z opóźnieniem', ['Grzelaka'], ['opóźnieniem']);
  osd('opinię sporządził biegły Kujawa w terminie', ['Kujawa'], ['opinię']);
  osd('reklamację złożył wczoraj Nguyen osobiście', ['Nguyen'], ['reklamację']);
  osd('umowę serwisową parafował Melnyk', ['Melnyk'], ['umowę']);
  osd('protokół podpisał mecenas Schulz', ['Schulz'], ['protokół']);
  osd('do akt dołączono zeznania świadka Petrova', ['Petrova'], ['akt']);

  // ── Kontrola spójności zbioru ──
  const ids = new Set();
  for (const c of cases) {
    assert(!ids.has(c.id), `zduplikowane id ${c.id}`);
    ids.add(c.id);
    for (const s of c.mustMask) {
      assert(c.text.includes(s), `${c.id}: mustMask "${s}" nie występuje w tekście`);
    }
    for (const s of c.mustKeep) {
      assert(c.text.includes(s), `${c.id}: mustKeep "${s}" nie występuje w tekście`);
    }
  }

  return { seed: SEED, cases };
}

// Uruchomienie bezpośrednie: wypisz statystyki zbioru (szybka kontrola wzrokowa).
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const { cases } = buildDataset();
  const perCat = new Map();
  for (const c of cases) perCat.set(c.category, (perCat.get(c.category) ?? 0) + 1);
  console.log(`Zbiór ewaluacyjny: ${cases.length} przypadków (seed ${SEED})`);
  for (const [cat, n] of perCat) console.log(`  ${cat}: ${n}`);
  const masks = cases.reduce((a, c) => a + c.mustMask.length, 0);
  const keeps = cases.reduce((a, c) => a + c.mustKeep.length, 0);
  console.log(`  mustMask łącznie: ${masks}, mustKeep łącznie: ${keeps}`);
}
