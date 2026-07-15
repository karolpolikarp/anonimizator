/**
 * Rdzeń „Parawan" (pakiet npm `anonimizator`) — twarda, deterministyczna redakcja
 * polskich danych osobowych (PII).
 *
 * Cel: USUNĄĆ dane osobowe z tekstu, zanim trafi gdziekolwiek dalej (LLM, baza danych,
 * logi, e-mail, cache). To NIE jest „ostrzeżenie" — to redakcja: każde wykryte PII
 * jest zamieniane na neutralny placeholder ([PESEL], [NIP], [IMIĘ I NAZWISKO]…), który
 * zachowuje sens tekstu, ale nie pozwala zidentyfikować osoby.
 *
 * Dwie klasy detekcji:
 *  1. STRUKTURALNE (wysoka pewność) — PESEL, NIP, REGON, IBAN/nr konta, nr dowodu, e-mail,
 *     telefon, kod pocztowy. Tam gdzie istnieje suma kontrolna (PESEL/NIP/REGON/IBAN/dowód)
 *     WALIDUJEMY ją — to tnie fałszywe trafienia (np. sygnatura akt „123456 7890" ≠ NIP).
 *  2. HEURYSTYCZNE (umiarkowana pewność) — imię+nazwisko (słownik polskich imion + wyzwalacze
 *     kontekstu) oraz adres (ul./al./os. + numer). Pełny NER (odmiana, rzadkie nazwiska) wymaga
 *     osobnego modelu — to świadomy kompromis tej warstwy (patrz README: ograniczenia).
 *
 * ZERO zależności i zero API środowiska (brak Deno.env / window / process) — ten sam plik
 * działa identycznie w Node, Deno, Bun i przeglądarce.
 *
 * Funkcja jest idempotentna: placeholdery nie zawierają cyfr ani „@", więc ponowny przebieg
 * (np. dwa niezależne przejścia redakcji) niczego nie psuje.
 */

import { normalizeSurnameKey, surnameBase, looksLikeSurname, NON_SURNAME_ADJ, HOMOGRAPH_SURNAMES } from './surnames.js';

export type PiiType =
  | 'EMAIL'
  | 'IBAN'
  | 'NR-KONTA'
  | 'KARTA'
  | 'PESEL'
  | 'NIP'
  | 'REGON'
  | 'TELEFON'
  | 'DOWOD'
  | 'PASZPORT'
  | 'KRS'
  | 'PRAWO-JAZDY'
  | 'NR-REJESTRACYJNY'
  | 'VIN'
  | 'IP'
  | 'MAC'
  | 'TOKEN'
  | 'LOGIN'
  | 'ZNAK-SPRAWY'
  | 'KOD-POCZTOWY'
  | 'DATA-UR'
  | 'ADRES'
  | 'MIEJSCOWOSC'
  | 'IMIE';

export interface PiiFinding {
  type: PiiType;
  /** liczba wystąpień zredagowanych w tekście (NIGDY nie zapisujemy oryginalnej wartości) */
  count: number;
}

export interface RedactionResult {
  redacted: string;
  found: PiiFinding[];
}

export interface RedactOptions {
  /** Typy do maskowania. Domyślnie (brak pola) — WSZYSTKIE. Pusta lista = nic nie maskuj. */
  types?: PiiType[];
  /**
   * Własne placeholdery per typ. UWAGA na idempotencję: placeholder nie może zawierać cyfr
   * ani „@" — inaczej ponowny przebieg redakcji mógłby go pożreć jako PII.
   */
  masks?: Partial<Record<PiiType, string>>;
  /**
   * Spójna pseudonimizacja osób: zamiast jednej maski [IMIĘ I NAZWISKO] każda osoba
   * dostaje stałą etykietę [OSOBA-A], [OSOBA-B]… — ta sama osoba (także w odmianie:
   * Kowalski/Kowalskiego/Kowalskiemu) zachowuje tę samą literę. Zachowuje strukturę
   * relacji w dokumencie. Klucz tożsamości = znormalizowane nazwisko, więc osoby
   * o tym samym nazwisku (Jan i Anna Kowalscy) dostają wspólną etykietę — ograniczenie.
   */
  pseudonyms?: boolean;
}

/** 0→A, 1→B… 25→Z, 26→AA… (etykiety bez cyfr — idempotencja placeholderów). */
function indexToLetters(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Odwrotność indexToLetters (A→0, B→1… AA→26) — przywracanie sentineli URL. */
function lettersToIndex(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

/** Etykiety placeholderów (czytelne dla człowieka i modelu, bez cyfr → idempotentne). */
const MASK: Record<PiiType, string> = {
  EMAIL: '[EMAIL]',
  IBAN: '[NR-KONTA]',
  'NR-KONTA': '[NR-KONTA]',
  KARTA: '[NR-KARTY]',
  PESEL: '[PESEL]',
  NIP: '[NIP]',
  REGON: '[REGON]',
  TELEFON: '[TELEFON]',
  DOWOD: '[NR-DOWODU]',
  PASZPORT: '[NR-PASZPORTU]',
  KRS: '[KRS]',
  'PRAWO-JAZDY': '[PRAWO-JAZDY]',
  'NR-REJESTRACYJNY': '[NR-REJESTRACYJNY]',
  VIN: '[VIN]',
  IP: '[IP]',
  MAC: '[MAC]',
  TOKEN: '[TOKEN]',
  LOGIN: '[LOGIN]',
  'ZNAK-SPRAWY': '[ZNAK-SPRAWY]',
  'KOD-POCZTOWY': '[KOD-POCZTOWY]',
  'DATA-UR': '[DATA-URODZENIA]',
  ADRES: '[ADRES]',
  MIEJSCOWOSC: '[MIEJSCOWOŚĆ]',
  IMIE: '[IMIĘ I NAZWISKO]',
};

// ============================================================================
// Sumy kontrolne (walidacja tnie false-positive do <5%)
// ============================================================================

const onlyDigits = (s: string): number[] =>
  s.replace(/\D/g, '').split('').map((d) => parseInt(d, 10));

/**
 * Wspólny szkielet walidacji sumy kontrolnej „waga × cyfra" (PESEL/NIP/REGON).
 * Sumujemy iloczyny cyfr 0..len-2 z `weights`, a `control(sum)` zwraca oczekiwaną OSTATNIĄ
 * cyfrę kontrolną — albo `null`, gdy dana suma czyni numer nieważnym (wtedy `null === d[…]`
 * jest zawsze fałszem). Cztery walidatory różnią się tylko długością, wagami i regułą kontroli.
 */
function weightedChecksum(
  s: string,
  len: number,
  weights: number[],
  control: (sum: number) => number | null,
): boolean {
  const d = onlyDigits(s);
  if (d.length !== len) return false;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += d[i] * weights[i];
  return control(sum) === d[len - 1];
}

/** PESEL: 11 cyfr, wagi [1,3,7,9,1,3,7,9,1,3], cyfra kontrolna = (10 − sum%10)%10. */
export function isValidPesel(s: string): boolean {
  return weightedChecksum(s, 11, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3], (sum) => (10 - (sum % 10)) % 10);
}

/** NIP: 10 cyfr, wagi [6,5,7,2,3,4,5,6,7], kontrola = sum%11 (10 → numer nieważny). */
export function isValidNip(s: string): boolean {
  return weightedChecksum(s, 10, [6, 5, 7, 2, 3, 4, 5, 6, 7], (sum) => {
    const c = sum % 11;
    return c === 10 ? null : c;
  });
}

/** REGON 9-cyfrowy: wagi [8,9,2,3,4,5,6,7], kontrola = sum%11 (10 → 0). */
export function isValidRegon9(s: string): boolean {
  return weightedChecksum(s, 9, [8, 9, 2, 3, 4, 5, 6, 7], (sum) => (sum % 11 === 10 ? 0 : sum % 11));
}

/** REGON 14-cyfrowy: wagi [2,4,8,5,0,9,7,3,6,1,2,4,8], kontrola = sum%11 (10 → 0). */
export function isValidRegon14(s: string): boolean {
  return weightedChecksum(
    s,
    14,
    [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8],
    (sum) => (sum % 11 === 10 ? 0 : sum % 11),
  );
}

/** IBAN (dowolny kraj): przenieś 4 pierwsze znaki na koniec, litery→liczby (A=10), mod 97 == 1. */
export function isValidIban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = /[A-Z]/.test(ch) ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const c of code) {
      remainder = (remainder * 10 + parseInt(c, 10)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * Nr dowodu osobistego: 3 litery + 6 cyfr, wagi [7,3,1,9,1,7,3,1,7] (litera A=10…Z=35),
 * suma ważona WSZYSTKICH 9 znaków (cyfra kontrolna na pozycji 4, waga 9) % 10 == 0.
 * Wektor kontrolny: ABA300000 → ważny (7·10+3·11+1·10+9·3 = 140, 140%10=0).
 */
export function isValidDowod(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{3}\d{6}$/.test(s)) return false;
  const w = [7, 3, 1, 9, 1, 7, 3, 1, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const ch = s[i];
    const val = /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : parseInt(ch, 10);
    sum += val * w[i];
  }
  return sum % 10 === 0;
}

/** Suma Luhna (mod 10) — walidacja numerów kart płatniczych. */
function luhnValid(digits: number[]): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let x = digits[i];
    if (double) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Prefiks (IIN) znanej sieci: Visa/Mastercard/Amex/Discover/Diners/JCB. Sam Luhn przepuszcza
 * ~1/10 losowych ciągów — dopiero prefiks + długość + Luhn dają pewność „to naprawdę karta".
 * Maestro i rzadkie sieci (szeroki, mało specyficzny prefiks 50/56–69) celowo pomijamy: ich
 * dodanie zawyżyłoby liczbę fałszywych trafień (precyzja > nadmaskowanie).
 */
function hasCardPrefix(d: number[]): boolean {
  const p2 = d[0] * 10 + d[1];
  const p4 = p2 * 100 + d[2] * 10 + d[3];
  if (d[0] === 4) return true; // Visa
  if (p2 >= 51 && p2 <= 55) return true; // Mastercard
  if (p4 >= 2221 && p4 <= 2720) return true; // Mastercard (seria 2)
  if (p2 === 34 || p2 === 37) return true; // American Express
  if (p2 === 36 || p2 === 38 || p2 === 39) return true; // Diners Club
  if (d[0] === 3 && d[1] === 0 && d[2] <= 5) return true; // Diners 300–305
  if (p4 === 6011 || p2 === 65) return true; // Discover
  if (p2 === 64 && d[2] >= 4 && d[2] <= 9) return true; // Discover 644–649
  if (p4 >= 3528 && p4 <= 3589) return true; // JCB
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return true; // Maestro (szeroki prefiks — bezpieczny TYLKO z kontekstem karty)
  return false;
}

/**
 * Numer karty płatniczej: 13–19 cyfr, prefiks znanej sieci + suma Luhna. Kombinacja tych trzech
 * cech jest bardzo specyficzna (jak IBAN mod-97), więc wystarcza SAMODZIELNIE, bez etykiety.
 */
export function isValidCard(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length < 13 || d.length > 19) return false;
  if (!hasCardPrefix(d)) return false;
  return luhnValid(d);
}

// ============================================================================
// Strażniki kontekstu — nie myl numeru przepisu z numerem identyfikacyjnym
// ============================================================================

/**
 * Czy dopasowanie jest poprzedzone odwołaniem do aktu/przepisu (art., §, ust., poz., Dz.U., sygn.)?
 * Wtedy ciąg cyfr to numer artykułu/pozycji, NIE telefon/PESEL — nie redagujemy.
 * (Dokumenty urzędowe i prawne są pełne takich odwołań — bez tego strażnika toną w maskach.)
 */
function precededByLegalRef(full: string, offset: number): boolean {
  // Okno 24 znaki — mieści dłuższe frazy jak „w rejestrze " czy „porządkowy ".
  const before = full.slice(Math.max(0, offset - 24), offset);
  // „regon": ciąg po tej kotwicy to (nie)poprawny REGON — obsłużony (albo słusznie
  // odrzucony) przez krok REGON; detektor telefonu nie może go pożerać (bug z benchmarku).
  // „lp./porządkow…/rejestr…": numer porządkowy pozycji w rejestrze ≠ telefon.
  // „seryjn…/wersj…": numer seryjny urządzenia i numer wersji ≠ telefon/IP.
  return /(art\.?|§|ust\.?|pkt|poz\.?|sygn\.?|nr\s|dz\.?\s?u|regon|lp\.?|porządkow\w+|rejestr\w*|seryjn\w+|wersj\w+)\s*$/i.test(before);
}

// ============================================================================
// Słownik polskich imion (najczęstsze) — podnosi precyzję detekcji „Imię Nazwisko"
// ============================================================================

const POLISH_FIRST_NAMES = new Set<string>(
  (
    'adam adrian agata agnieszka aleksander aleksandra alicja alina amelia andrzej aniela anna ' +
    'antoni antonina arkadiusz artur bartłomiej bartosz beata bogdan bogumił bogusław bożena ' +
    'cezary daniel danuta dariusz dawid dominik dominika dorota edward elżbieta emil emilia ewa ' +
    'ewelina filip franciszek gabriel gabriela grażyna grzegorz halina hanna helena henryk hubert ' +
    'igor ilona irena iwona izabela jacek jadwiga jakub jan janina janusz jarosław jerzy joanna ' +
    'jolanta józef julia julian justyna kacper kamil kamila karina karol karolina katarzyna kazimierz ' +
    'kinga klaudia konrad krystyna krzysztof lena leszek lidia ludwik łukasz maciej magdalena maja ' +
    'małgorzata marcin marek maria mariola mariusz marta martyna mateusz michał mieczysław mikołaj ' +
    'milena mirosław mirosława monika nadia natalia nikodem nikola norbert oliwia oskar patryk patrycja ' +
    'paulina paweł piotr przemysław rafał radosław renata robert roman ryszard sandra sebastian ' +
    'sławomir stanisław stanisława stefan stefania sylwester sylwia szymon tadeusz teresa tomasz ' +
    'urszula wacław waldemar weronika wiesław wiktor wiktoria wincenty witold władysław włodzimierz ' +
    'wojciech zbigniew zdzisław zofia zuzanna ' +
    // uzupełnienie częstych imion (luka pokrycia wykryta na nagłówkach e-maili urzędowych)
    'edyta aneta iga izabella jagoda klara liliana lucyna łucja marzena nina olga otylia sabina wanda ' +
    'żaneta róża blanka cecylia dagmara diana eliza elwira felicja kalina laura ludmiła malwina michalina ' +
    'oktawia paula rozalia sara wioletta wiola bogna bożena elwira ewelina emilia lena maja pola nadzieja ' +
    'alan borys cyprian damian dionizy erwin ernest fabian gustaw ignacy kajetan kornel ksawery leon lech ' +
    'marceli maurycy maksymilian olaf remigiusz rudolf seweryn teodor tobiasz walenty wit zenon jeremi jędrzej ' +
    'krystian leonard iwo alojzy bruno feliks gerard konstanty maksym miron przemek roch salomon tymon tymoteusz ' +
    // uzupełnienie: częste imiona wcześniej pomijane — bez nich pary „imię nazwisko" pisane
    // WERSALIKAMI lub małymi literami nie były łapane (detekcja par zależy od słownika imion)
    'pamela melania kornelia apolonia sonia tamara żaklina walentyna celina aurelia benedykt alfred edmund herbert oktawian klemens'
  ).split(/\s+/),
);

const PL_UP = 'A-ZĄĆĘŁŃÓŚŹŻ';
const PL_LO = 'a-ząćęłńóśźż';

// Hoisted (nie budować w callbacku .replace — inaczej kompilacja regexu per-match).
// Sprawdza, czy tuż przed dopasowaniem stoi WYRAZ z wielkiej litery + spacja (2. człon złożenia).
const PRECEDED_BY_CAP = new RegExp(`[${PL_UP}][${PL_LO}]+\\s+$`);

// Regexy reguł IMIĘ skompilowane RAZ na moduł (nie przy każdym wywołaniu redactPII).
// Kotwica PL-aware zamiast ASCII \b (działa przed Ł/Ś/Ż/Ą). Bezstanowe użycie przez .replace
// (String.replace zeruje lastIndex), więc współdzielenie RE_PAIR między krokami (a2)/(a3) jest bezpieczne.
const CAP_WORD = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?`;
// Separatory między członami nazwy to [ \t]+ (BEZ \n) — nazwisko na końcu wiersza NIE może
// skleić się z pierwszym wyrazem następnej linii (psuło układ i wciągało etykiety formularzy).
// Prawa granica `(?![PL_UP PL_LO])` na KOŃCU każdego wzorca: bez niej token mieszany
// („KowaIski" z OCR-owym I zamiast l, „McDonald") był dopasowywany DO POŁOWY — wprost
// („Jan Kowa|Iski") albo po backtrackingu („Jan Kow|aIski") — i maska ucinała słowo
// („[OSOBA-A]Iski" — wyciek fragmentu nazwiska; maskuj całość, nie fragment).
const RE_SPOUSES = new RegExp(`(?<![${PL_UP}${PL_LO}-])(${CAP_WORD})[ \\t]+(?:i|oraz)[ \\t]+(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${PL_UP}${PL_LO}])`, 'g');
const RE_NAME_SEQ = new RegExp(`(?<![${PL_UP}${PL_LO}-])${CAP_WORD}(?:[ \\t]+${CAP_WORD}){1,3}(?![${PL_UP}${PL_LO}])`, 'g');
const RE_PAIR = new RegExp(`(?<![${PL_UP}${PL_LO}-])(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${PL_UP}${PL_LO}])`, 'g');
const RE_SOLO_DICT = new RegExp(`(?<![${PL_UP}${PL_LO}-])[${PL_UP}][${PL_LO}]+(?![${PL_LO}${PL_UP}-])`, 'g');
const RE_SOLO_MORPH = new RegExp(`(?<![${PL_UP}${PL_LO}-])${CAP_WORD}(?![${PL_UP}${PL_LO}])`, 'g');
// Ciąg wyrazów MAŁYMI literami — niechlujny zapis (czaty, e-maile, formularze bez wielkich liter).
// Sam wzorzec jest szeroki (łapie całe zdania); PRECYZJĘ daje walidacja w callbacku (a4), która
// szuka W CIĄGU sąsiedztwa „imię (słownik) + nazwisko (morfologia/słownik)" i maskuje TYLKO tę parę.
// Skan całego ciągu (zamiast sztywnej pary) rozwiązuje konsumpcję sąsiadów: „od jan kowalski",
// „z marek górski" — wiodący przyimek nie zjada imienia. Lewa granica odcina fragmenty
// e-maili/URL-i/domen (poprzedzający znak nie może być literą, myślnikiem, „@", kropką ani „/").
const LO_WORD = `[${PL_LO}]+(?:-[${PL_LO}]+)?`;
const RE_LOWER_RUN = new RegExp(
  `(?<![${PL_UP}${PL_LO}@./-])${LO_WORD}(?:[ \\t]+${LO_WORD}){1,6}(?![${PL_UP}${PL_LO}-])`,
  'g',
);
const RE_SURNAME_OBLIQUE =
  /(?:sk|ck|dzk)(?:iego|iej|iemu|im|imi|ich|ą)$|icz(?:a|owi|em|owie|ami|ach)$|czyk(?:a|owi|iem|ami|ach|owie)$/;

// Wyraz z wielkiej litery z myślnikami wielokrotnymi (miejscowości: „Kędzierzyn-Koźle") — '*' (nie '?').
const CAP_CITY = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)*`;
/** Escapuje metaznaki regexu w literale (do budowy wzorca z placeholdera maski). */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Wyrazy (małą literą) po których słowo z sufiksem -ski/-cki/-icz to NIE osoba, lecz eponim
 * medyczny („choroba Leśniowskiego"), nazwa ulicy/miejsca („ulica Puławska") lub termin.
 * Wstrzymują samodzielny detektor morfologiczny/słownikowy nazwiska (kroki 13c/13c2).
 */
export const NON_PERSON_CONTEXT = new Set<string>(
  (
    'choroba chorobę choroby chorobą chorobie objaw objawu objawy objawie zespół zespołu zespole ' +
    'syndrom syndromu próba próbę próby odczyn odczynu test testu testem skala skali skalę metoda ' +
    'metodę metody metodą prawo prawa twierdzenie zasada zasadę reguła reakcja klasyfikacja punkt ' +
    'ulica ulicy ulicę ulicą ulic aleja alei aleję aleją plac placu placem placa rondo ronda most ' +
    'mostu mostem osiedle osiedla osiedlu dzielnica dzielnicy dzielnicę park parku skwer bulwar ' +
    // jednostki administracyjne — „powiat pruszkowski", „gmina …ska" to przymiotnik odmiejscowy,
    // nie nazwisko (pola administracyjne są celowo jawne — patrz komentarz przy FORM_FIELDS)
    'powiat powiatu powiecie powiatem gmina gminy gminie gminą województwo województwa województwie'
  ).split(/\s+/),
);
/**
 * Etykieta pola ADMINISTRACYJNEGO tuż przed wartością („Powiat: Pruszkowski", „Województwo:\n
 * Mazowieckie" — też wartość w następnej linii). Przymiotnik odmiejscowy po niej to nazwa
 * jednostki, NIE nazwisko — bez tego strażnika „Powiat: Pruszkowski" stawał się [OSOBA-X]
 * (prevLowerWord nie widzi etykiety przez dwukropek/nową linię).
 */
const precededByAdminLabel = (t: string, offset: number): boolean =>
  /(?:powiat\w*|gmin[aęyą]|województw[oaeu]m?|dzielnic[aęy])[ \t]*:?[ \t]*\n?[ \t]*$/i.test(
    t.slice(Math.max(0, offset - 24), offset),
  );
/** Ostatni wyraz (małą literą) tuż przed pozycją — do sprawdzenia kontekstu nie-osobowego. */
const prevLowerWord = (text: string, offset: number): string | undefined =>
  text
    .slice(Math.max(0, offset - 40), offset)
    .match(/([\p{Ll}]+)\s*$/u)?.[1]
    ?.toLowerCase();
/** Czy tuż przed pozycją stoi „im." (patron instytucji: „Szkoła im. A. Mickiewicza") albo
 *  skrót ulicy („ul. Rakowieckiej", „al. Sikorskiego" — patron ULICY, nie osoba), ewentualnie
 *  z inicjałem imienia? prevLowerWord tego nie widzi (kropka po skrócie). */
const precededByPatron = (t: string, offset: number): boolean =>
  /\b(?:im|ul|al|pl|os)\.[ \t]+(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/i.test(t.slice(Math.max(0, offset - 12), offset));
/** Kody walut — „PLN 123456" to kwota, nie dowód (wyjątek w kroku DOWÓD bez kontekstu). */
const CURRENCY_CODES = new Set([
  'PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'JPY', 'UAH', 'RUB',
]);

// ── Pola formularza (etykieta → wartość) ──────────────────────────────────────
// Eksporty urzędowe często mają układ „Etykieta\nWARTOŚĆ" (wartość w OSOBNEJ linii,
// nierzadko WERSALIKAMI). Reguły tekstowe tego nie łapią (oczekują „etykieta: wartość"
// w jednej linii i nazwisk pisanych normalnie). Etykieta pola to MOCNA kotwica strukturalna,
// więc precyzja jest wysoka. Maskujemy tylko pola jednoznacznie osobowe — pola administracyjne
// (kraj, województwo, powiat, gmina) zostawiamy: są za szerokie, by same w sobie były PII.
type FormKind = 'name' | 'date' | 'place' | 'addr';
interface FormField {
  re: RegExp; // dopasowuje etykietę (bez numeracji „12. ") do „:" lub końca linii
  type: PiiType;
  mask: string;
  kind: FormKind;
}
const FORM_FIELDS: FormField[] = [
  { re: /^imię\s+i\s+nazwisko$|^nazwisko\s+i\s+imię$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^nazwisk[ao](?:\s+(?:rodowe|panieńskie|poprzednie))?(?:\s+(?:matki|ojca))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^(?:pierwsze\s+|drugie\s+|kolejne\s+)?imi(?:ę|ona)(?:\s+(?:ojca|matki))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^data\s+urodzenia$/i, type: 'DATA-UR', kind: 'date', mask: '[DATA-URODZENIA]' },
  { re: /^miejsce\s+urodzenia$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^miejscowość$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^(?:miejsce|adres)\s+(?:zamieszkania|zameldowania|pobytu)$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^ulica$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
  { re: /^(?:nr|numer)\s+(?:domu|lokalu|mieszkania)$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
];
/** Wartości „puste" pola — nie maskujemy (nie są danymi). */
const FORM_EMPTY_VALUES = new Set([
  'brak', 'niedotyczy', 'nd', 'n/d', 'bd', 'x', 'bez', '.', '-', '–', '—', '',
  'nieznane', 'nieznana', 'nieznany', 'niepodano', 'niepodane',
]);
/**
 * Pierwsze słowa TYPOWYCH etykiet/nagłówków formularza (lowercase). Służy TYLKO do rozpoznania,
 * że „wartość" pustego pola PII to w istocie kolejna etykieta/nagłówek sekcji (a nie dana) —
 * chroni przed maskowaniem np. „Rozpoznanie", „Oddział" po pustym „Nazwisko:".
 */
const FORM_LABEL_WORDS = new Set<string>(
  (
    'nazwisko nazwiska imię imiona imie data miejsce miejscowość ulica nr numer kraj województwo ' +
    'powiat gmina kod pesel nip regon krs telefon tel email e-mail adres rozpoznanie oddział ' +
    'jednostka wydział dział stanowisko zawód wykształcenie obywatelstwo seria dokument płeć stan ' +
    'dane rozdział załącznik punkt pozycja poz specjalność tytuł nazwa firma'
  ).split(' '),
);
/** Wzorzec daty (cyfrowa lub słowna) — do maskowania SAMEJ daty w wartości pola „Data urodzenia". */
const RE_DATE_VALUE =
  /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}/i;
/** Zdejmuje numerację („12. ", „3) ") i białe znaki z brzegów — zostaje sama treść etykiety/wartości. */
const stripFormPrefix = (s: string): string => s.replace(/^[ \t]*\d+[.)][ \t]*/, '').trim();
/** Czy wiersz to etykieta/nagłówek (nie wartość sąsiedniego pola) — chroni pola PUSTE. */
const isFormLabelLine = (line: string): boolean => {
  const t = stripFormPrefix(line);
  const base = t.replace(/\s*:\s*$/, ''); // zdejmij końcowy dwukropek („Imię:")
  if (FORM_FIELDS.some((f) => f.re.test(base))) return true; // znana etykieta pola
  if (/:\s*$/.test(line)) return true; // wiersz kończy się „:" → etykieta, nie wartość
  if (/^\d+[.)]\s+\S/.test(line.trim())) return true; // numerowana etykieta („14. Kraj")
  // krótka fraza zaczynająca się typowym słowem etykiety/nagłówka („Rozpoznanie", „Oddział…")
  const words = base.split(/\s+/);
  return words.length <= 3 && FORM_LABEL_WORDS.has(words[0]?.toLowerCase() ?? '');
};
/** Czy `value` to sensowna wartość danego rodzaju pola (chroni przed prozą, etykietami, „nie dotyczy"). */
const isValidFormValue = (value: string, kind: FormKind): boolean => {
  const t = value.trim();
  if (!t || t.length > 70) return false;
  if (FORM_EMPTY_VALUES.has(t.toLowerCase().replace(/\s+/g, '').replace(/\.$/, ''))) return false;
  if (/^\d+[.)]\s/.test(t)) return false; // kolejna etykieta numerowana
  if (/^(nie\b|nieznan|niepodan|do ustalenia|brak\b|b\/d)/i.test(t)) return false; // frazy proceduralne
  if (kind === 'place') {
    // miejscowość: nazwa własna — pierwsza litera wielka lub WERSALIKI (proza ma małe litery/spójniki)
    return /^\p{Lu}[\p{L}'’.‑-]*(?:[ \t]+\p{Lu}[\p{L}'’.‑-]*){0,3}$/u.test(t);
  }
  if (kind === 'name') {
    // Etykieta pola / klucz strukturalny („Imię:", „firstName") to MOCNA kotwica — maskujemy imię/
    // nazwisko NIEZALEŻNIE od wielkości liter („Imię: pamela", „pAMELA"). Nadal 1–4 wyrazy z samych
    // liter (bez cyfr i prozy); WERSALIKI działały już wcześniej, tu dochodzi zapis małą/mieszaną literą.
    return /^\p{L}[\p{L}'’.‑-]*(?:[ \t]+\p{L}[\p{L}'’.‑-]*){0,3}$/u.test(t);
  }
  if (kind === 'date') return /\d{4}|\d{1,2}[-.\/]\d{1,2}/.test(t);
  // addr: ulica (nazwa własna) lub nr domu (cyfry). Odrzuć zdanie: KAŻDY wyraz musi być nazwą
  // własną (wielka litera / WERSALIKI), tokenem z cyfrą, albo krótką cząstką adresową (m, lok, ul…).
  const toks = t.split(/\s+/);
  if (toks.length > 5) return false;
  const ADDR_PARTICLE = /^(m|lok|ul|al|os|pl|nr|im|św|gen|ks)\.?$/i;
  return (
    /^[\p{Lu}\d]/u.test(t) &&
    toks.every((w) => /^\p{Lu}/u.test(w) || /\d/.test(w) || ADDR_PARTICLE.test(w))
  );
};

/**
 * Encje prawne/instytucje, których NIE traktujemy jako „imię nazwisko"
 * (np. „Sąd Najwyższy", „Kodeks Cywilny", „Prawo Pracy").
 */
export const LEGAL_ENTITY_WORDS = new Set<string>(
  (
    'sąd sądu trybunał trybunału izba kodeks kodeksu ustawa ustawie prawo prawa ordynacja ' +
    'rozporządzenie urząd urzędu ministerstwo sejm senat parlament komisja inspekcja straż ' +
    'policja prokuratura rzecznik cywilny cywilnego karny karnego pracy handlowy administracyjny ' +
    'postępowania wykonawczy skarbowy rzeczpospolita polska polski unia europejska najwyższy ' +
    'apelacyjny okręgowy rejonowy konstytucyjny państwowa narodowy narodowa fundusz zakład ' +
    'krajowy krajowa główny główna społecznych ' +
    // częste rzeczowniki „dokumentowe" — nie mylić z nazwiskiem w parze „Słowo Imię"
    'umowa umowie załącznik rozdział artykuł ustęp punkt pozycja faktura pismo wniosek decyzja ' +
    'departament biuro wydział referat oddział sekcja nowy nowa ' +
    // rzeczowniki instytucjonalne — chronią przymiotnik w nazwie („Uniwersytet Warszawski",
    // „Izba Lekarska", „Bank Śląski") przed morfologicznym rozpoznawaczem nazwisk (krok 13a2)
    'uniwersytet uniwersytetu politechnika akademia akademii instytut instytutu bank banku ' +
    'szpital szpitala teatr muzeum klub związek związku kancelaria kancelarii fundacja fundacji ' +
    'stowarzyszenie spółka spółki spółdzielnia spółdzielni samorząd samorządu rada rady zarząd ' +
    'zarządu gmina gminy powiat powiatu województwo starostwo kuratorium izby prawa ' +
    'komitet komitetu hufiec zespół zespołu koło zrzeszenie komenda komendy ośrodek ośrodka ' +
    'fundusz funduszu centrum agencja agencji dyrekcja dyrekcji park parku'
  ).split(/\s+/),
);

/** Tytuły/grzecznościowe — NIE są nazwiskiem w parze „Tytuł Imię" (trigger obsługuje je osobno). */
const TITLE_WORDS = new Set<string>(
  'pan pani pana panu panią panie państwo szanowny szanowna dr prof mgr inż'.split(/\s+/),
);

/**
 * Role/funkcje/tytuły zawodowe stojące PRZED nazwiskiem („Prezes Gzowski", „Sędzia Trzebiatowski").
 * W parze morfologicznej (krok 13a2) maskujemy wtedy SAMO nazwisko, a rolę zostawiamy —
 * inaczej znikałoby słowo niosące sens („Dyrektor [IMIĘ] podpisał").
 */
const ROLE_WORDS = new Set<string>(
  (
    'prezes prezesa prezesie dyrektor dyrektora dyrektorze minister ministra prezydent prezydenta ' +
    'wiceprezes wicedyrektor wojewoda wojewody starosta starosty burmistrz burmistrza wójt wójta ' +
    'marszałek marszałka sędzia sędziego sędzię prokurator prokuratora adwokat adwokata radca radcy ' +
    'notariusz notariusza komornik komornika kierownik kierownika naczelnik naczelnika inspektor ' +
    'inspektora kurator kuratora rektor rektora dziekan dziekana profesor profesora doktor doktora ' +
    'mecenas mecenasa kanclerz przewodniczący przewodnicząca sekretarz skarbnik pełnomocnik biegły ' +
    'świadek powód pozwany oskarżony wnioskodawca ' +
    // strony/uczestnicy oraz rzeczowniki pospolite stojące przed nazwiskiem (nie osierocaj ich)
    'pracownik pracownica klient klientka pacjent pacjentka najemca wynajmujący właściciel właścicielka ' +
    'dłużnik wierzyciel kupujący sprzedający zleceniodawca zleceniobiorca wykonawca zamawiający konsument ' +
    'ubezpieczony poszkodowany uczestnik członek przedstawiciel abonent użytkownik nabywca darczyńca ' +
    // podmioty gospodarcze i człony ich nazw (finding: „Piekarnia Nowak", „Zakład Usługowy Kowalski")
    'piekarnia tartak gospodarstwo warsztat hurtownia sklep apteka przychodnia restauracja pracownia ' +
    'przedsiębiorstwo usługowy usługowa usługowe handlowy handlowa handlowe produkcyjny produkcyjna ' +
    'rolny rolna rolne transportowy budowlany budowlana wielobranżowy'
  ).split(/\s+/),
);

/**
 * Polskie miejscowości WIELOWYRAZOWE (człony rozdzielone spacją) — używane WYŁĄCZNIE do
 * rozstrzygnięcia, ile słów za kodem pocztowym doklejać do maski miejscowości (krok 12c).
 * Miasta jednowyrazowe NIE muszą tu być — pierwszy wyraz po kodzie i tak jest maskowany
 * pozycyjnie. Nazwy z myślnikiem („Bielsko-Biała") to jeden token, więc też nie wymagają
 * wpisu — dodajemy jednak ich wariant zapisany spacją („bielsko biała"), bo bywa pisany
 * rozłącznie. Nietrafiona/brakująca pozycja degraduje łagodnie: maskujemy sam pierwszy
 * (główny) człon, a zostaje przymiotnik regionalny („[MIEJSCOWOŚĆ] Wielkopolski").
 */
const MULTIWORD_CITIES = new Set<string>(
  (
    'nowy sącz|nowy targ|nowy dwór mazowiecki|nowy dwór gdański|nowy wiśnicz|nowy żmigród|' +
    'nowe miasto lubawskie|nowe miasto nad pilicą|nowe miasto nad wartą|nowa sól|nowa ruda|' +
    'nowa dęba|nowa słupia|stary sącz|zielona góra|jelenia góra|kamienna góra|góra kalwaria|' +
    'góra śląska|dąbrowa górnicza|dąbrowa tarnowska|dąbrowa białostocka|ruda śląska|stalowa wola|' +
    'ostrów wielkopolski|ostrów mazowiecka|ostrowiec świętokrzyski|biała podlaska|biała rawska|' +
    'bielsko biała|wysokie mazowieckie|grodzisk mazowiecki|grodzisk wielkopolski|tomaszów mazowiecki|' +
    'tomaszów lubelski|piotrków trybunalski|rawa mazowiecka|sokołów podlaski|wodzisław śląski|' +
    'aleksandrów kujawski|aleksandrów łódzki|konstantynów łódzki|gorzów wielkopolski|górowo iławeckie|' +
    'szklarska poręba|bystrzyca kłodzka|nowogród bobrzański|maków mazowiecki|maków podhalański|' +
    'mińsk mazowiecki|kostrzyn nad odrą|miejska górka|tarnowskie góry|czerwionka leszczyny|' +
    'sępólno krajeńskie|solec kujawski|środa wielkopolska|środa śląska|oborniki śląskie|brzeg dolny|' +
    'skarżysko kamienna|murowana goślina|miasteczko śląskie|ożarów mazowiecki|kędzierzyn koźle|' +
    'duszniki zdrój|kudowa zdrój|polanica zdrój|lądek zdrój|busko zdrój|rabka zdrój|iwonicz zdrój|' +
    'konstancin jeziorna|jastrzębie zdrój|goczałkowice zdrój|połczyn zdrój|świeradów zdrój'
  ).split('|'),
);

/**
 * Słownik polskich MIAST (mianownik + częste formy zależne dużych miast) — używany WYŁĄCZNIE
 * do rozpoznania miejscowości stojącej PRZED adresem BEZ kodu pocztowego („Warszawa, ul. …",
 * „w Poznaniu, ul. …"), krok 12d. Kotwicą jest wtedy sam wskaźnik adresu (nie kod), więc bez
 * słownika nie odróżnilibyśmy miasta od ogona nazwy instytucji („Zarząd Dróg Miejskich, ul. …").
 * Słownik NIE działa w wolnym tekście — tylko w pozycji „…, ul./[ADRES]" — więc „mieszka w
 * Warszawie" pozostaje nietknięte (zero nadmaskowania). Krótkie, wieloznaczne nazwy (Biała,
 * Wola, Góra, Nowe) celowo POMINIĘTE jako samodzielne — łapiemy je tylko w formie wielowyrazowej.
 */
const POLISH_CITIES = new Set<string>([
  ...MULTIWORD_CITIES,
  ...(
    // mianownik — miasta wojewódzkie, na prawach powiatu i większe ośrodki
    'warszawa|kraków|łódź|wrocław|poznań|gdańsk|szczecin|bydgoszcz|lublin|białystok|katowice|' +
    'gdynia|częstochowa|radom|sosnowiec|toruń|kielce|rzeszów|gliwice|zabrze|olsztyn|bytom|rybnik|' +
    'opole|tychy|elbląg|płock|wałbrzych|włocławek|tarnów|chorzów|koszalin|kalisz|legnica|grudziądz|' +
    'słupsk|jaworzno|konin|piła|inowrocław|lubin|suwałki|stargard|gniezno|głogów|pabianice|leszno|' +
    'żory|zamość|pruszków|łomża|ełk|chełm|mielec|przemyśl|tczew|bełchatów|świdnica|będzin|zgierz|' +
    'racibórz|legionowo|ostrołęka|świętochłowice|zawiercie|starachowice|wejherowo|skierniewice|' +
    'świnoujście|puławy|tarnobrzeg|kutno|nysa|ciechanów|sopot|sieradz|radomsko|kołobrzeg|szczecinek|' +
    'otwock|świdnik|bochnia|oświęcim|krosno|sanok|cieszyn|dębica|jarosław|luboń|malbork|żyrardów|' +
    'kwidzyn|oleśnica|chrzanów|jasło|brodnica|kraśnik|wągrowiec|giżycko|sochaczew|olkusz|świebodzice|' +
    'augustów|brzeg|andrychów|wyszków|bartoszyce|mława|kętrzyn|nakło|turek|świecie|oława|krotoszyn|' +
    'kościan|gostyń|jarocin|śrem|trzebnica|bolesławiec|zgorzelec|lubań|dzierżoniów|kluczbork|brzesko|' +
    'wieliczka|myślenice|gorlice|limanowa|zakopane|trzebinia|libiąż|wadowice|żywiec|pszczyna|mikołów|' +
    'lubliniec|knurów|pyskowice|nowogard|police|goleniów|gryfino|choszczno|wałcz|złotów|chodzież|' +
    'oborniki|wolsztyn|września|środa|krapkowice|kędzierzyn|namysłów|prudnik|strzelce|ozimek|' +
    // miasta z myślnikiem (jeden token — słownik musi mieć formę z myślnikiem)
    'bielsko-biała|kędzierzyn-koźle|jastrzębie-zdrój|skarżysko-kamienna|konstancin-jeziorna|' +
    'kudowa-zdrój|polanica-zdrój|duszniki-zdrój|lądek-zdrój|busko-zdrój|rabka-zdrój|iwonicz-zdrój|' +
    'świeradów-zdrój|połczyn-zdrój|goczałkowice-zdrój|' +
    // formy zależne miast z myślnikiem („ur. w Bielsku-Białej", „zam. w Jastrzębiu-Zdroju")
    'bielsku-białej|bielska-białej|kędzierzynie-koźlu|kędzierzyna-koźla|jastrzębiu-zdroju|' +
    'skarżysku-kamiennej|konstancinie-jeziornie|' +
    // częste formy zależne dużych miast (pozycja „w <mieście>, ul. …")
    'warszawie|warszawy|krakowie|krakowa|łodzi|wrocławiu|wrocławia|poznaniu|poznania|gdańsku|gdańska|' +
    'szczecinie|bydgoszczy|lublinie|lublina|katowicach|gdyni|częstochowie|radomiu|radomia|sosnowcu|' +
    'toruniu|torunia|kielcach|rzeszowie|olsztynie|opolu|płocku|tarnowie|koszalinie|kaliszu|legnicy|' +
    'słupsku|zamościu|chełmie|elblągu|gliwicach|bytomiu|rybniku|' +
    // miejscownik częstych średnich miast (pozycja „zamieszkały/mieszka w <mieście>")
    'sopocie|gnieźnie|inowrocławiu|koninie|głogowie|lesznie|ełku|mielcu|tczewie|będzinie|zgierzu|' +
    'raciborzu|zawierciu|wejherowie|świnoujściu|puławach|kutnie|nysie|ciechanowie|sieradzu|kołobrzegu|' +
    'otwocku|oświęcimiu|krośnie|sanoku|cieszynie|jarosławiu|zakopanem|żywcu|wieliczce|wadowicach|' +
    'pszczynie|mikołowie|jaworznie|dąbrowie|chorzowie|zabrzu|jastrzębiu|tychach|wałbrzychu|włocławku|' +
    'grudziądzu|jeleniej górze|zielonej górze|nowym sączu|nowym targu|nowym dworze|gorzowie|' +
    'stargardzie|świdnicy|piotrkowie|ostrowie|suwałkach|starachowicach|skierniewicach|tarnobrzegu'
  ).split('|'),
]);

// Częste OBCE imiona — bramka dla reguły imion dwuczłonowych z myślnikiem („Jean-Pierre
// Dubois"). Bez tej bramki każda para „Xxx-Yyy Zzz" (miasta spoza słownika, nazwy firm)
// stawałaby się osobą. Wyłącznie imiona praktycznie niewystępujące jako polskie toponimy.
const FOREIGN_GIVEN_NAMES = new Set<string>(
  (
    'jean pierre paul marie anne claude luc marc jacques michel andre andré louis henri ' +
    'francois françois rené rene yves hans karl heinz klaus peter ernst fritz dieter uwe ' +
    'kurt otto rolf wolf horst jurgen jürgen john james david michael mary sarah kevin ' +
    'jose josé juan carlos luis pedro miguel diego pablo ana maria luigi giovanni marco ' +
    'ali ahmed mohamed muhammad omar hassan ibrahim mustafa abdul kim lee chen wang li ' +
    'minh thi anh van duc thu erik lars sven nils per ola'
  ).split(/\s+/),
);

// Rdzenie imion (mianownik bez końcowego „a" dla imion żeńskich) — do rozpoznawania
// form ODMIENIONYCH: „Anną", „Annę", „Janem", „Aleksandrą". Słownik ma tylko mianownik,
// więc bez tego imię w odmianie wyciekało obok zamaskowanego nazwiska.
const FIRST_NAME_STEMS = new Set<string>(
  [...POLISH_FIRST_NAMES].map((n) => (n.endsWith('a') ? n.slice(0, -1) : n)),
);
// UWAGA: BEZ pustego sufiksu '' — mianownik pokrywa POLISH_FIRST_NAMES.has(w), a '' uznawałoby
// rdzeń (np. „maj" z „Maja") za imię → fałszywe trafienia („Pierwszego Maja"). Tylko formy odmienione.
const NAME_INFLECTIONS = ['a', 'i', 'y', 'ie', 'ę', 'ą', 'o', 'u', 'e', 'em', 'owi'];

/** Czy słowo wygląda na polskie imię (mianownik ZE SŁOWNIKA lub jego forma odmieniona)? */
function isFirstNameLike(word: string): boolean {
  const w = word.toLowerCase();
  if (POLISH_FIRST_NAMES.has(w)) return true;
  for (const suf of NAME_INFLECTIONS) {
    const stem = suf ? w.slice(0, -suf.length) : w;
    if (stem.length >= 2 && w.endsWith(suf) && FIRST_NAME_STEMS.has(stem)) return true;
  }
  return false;
}

// ── URL: ochrona + maskowanie WEWNĄTRZ ────────────────────────────────────────
// E-mail — wzorzec współdzielony przez krok 1 i maskowanie wewnątrz URL-i.
// Część lokalna i domena DOPUSZCZAJĄ polskie litery (ąćęłńóśźż…): adres „piotr.wiśniewski@…" musi
// zostać zamaskowany W CAŁOŚCI. Bez tego klasa ASCII zatrzymywała się na „ś" i zostawiała jawny
// fragment nazwiska („piotr.wiś") przed [EMAIL] — wyciek (patrz „maskuj całość, nie fragment").
const RE_EMAIL = /[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+@[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,}/g;
// E-mail zakodowany w URL-u („%40" zamiast „@") — poza URL-em nie występuje.
const RE_EMAIL_URLENC = /[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+%40[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,}/g;
/**
 * Parametry query URL-a o kluczach OSOBOWYCH — klucz to mocna kotwica, maskujemy samą
 * wartość wg typu (?user=[LOGIN]&email=[EMAIL]), struktura URL-a zostaje. Klasa wartości
 * wyklucza „[" — placeholder z poprzedniego przebiegu nie jest ponownie maskowany.
 */
// Prefiks klucza obejmuje też „#" — parametry bywają we FRAGMENCIE URL-a (OAuth implicit
// flow: „callback#access_token=…"), który wcześniej wyciekał.
const URL_PARAM_RULES: Array<{ re: RegExp; type: PiiType }> = [
  { re: /([?&#](?:user(?:name|id)?|login|usr|uid)=)([^&#\s\[\]]+)/gi, type: 'LOGIN' },
  { re: /([?&#](?:e-?mail|mail)=)([^&#\s\[\]]+)/gi, type: 'EMAIL' },
  { re: /([?&#](?:full_?name|first_?name|last_?name|name|imie|nazwisko|osoba)=)([^&#\s\[\]]+)/gi, type: 'IMIE' },
  { re: /([?&#](?:phone|tel(?:efon)?|mobile|msisdn)=)([^&#\s\[\]]+)/gi, type: 'TELEFON' },
  { re: /([?&#]pesel=)(\d+)/gi, type: 'PESEL' },
  { re: /([?&#](?:card(?:number|no)?|karta|nr_?karty|numer_?karty)=)([^&#\s\[\]]+)/gi, type: 'KARTA' },
  { re: /([?&#](?:token|api_?key|secret|auth|access_?token)=)([^&#\s\[\]]+)/gi, type: 'TOKEN' },
];

// ── Klucze strukturalne XML/JSON ──────────────────────────────────────────────
// Tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna jak etykieta formularza —
// maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Klucz normalizujemy (lowercase, bez ._-), więc „first_name"/„FirstName" to jeden wpis.
type StructKind =
  | 'first' | 'surname' | 'fullname' | 'name' | 'phone' | 'email' | 'addr'
  | 'city' | 'postal' | 'birth' | 'login' | 'pesel' | 'nip' | 'regon';
const STRUCT_KEYS = new Map<string, StructKind>(Object.entries({
  imie: 'first', imię: 'first', imiona: 'first', firstname: 'first', givenname: 'first', middlename: 'first',
  nazwisko: 'surname', surname: 'surname', lastname: 'surname', familyname: 'surname',
  fullname: 'fullname', imienazwisko: 'fullname', imięnazwisko: 'fullname', osoba: 'fullname', person: 'fullname',
  name: 'name', // generyczne — bramka słownikowa (bywa nazwą produktu/firmy, nie osoby)
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', tel: 'phone', telefon: 'phone', telephone: 'phone', fax: 'phone',
  email: 'email', mail: 'email',
  street: 'addr', address: 'addr', addressline: 'addr', ulica: 'addr', adres: 'addr',
  city: 'city', town: 'city', miasto: 'city', miejscowosc: 'city', miejscowość: 'city',
  postalcode: 'postal', postcode: 'postal', zipcode: 'postal', zip: 'postal', kodpocztowy: 'postal',
  birthdate: 'birth', dateofbirth: 'birth', dob: 'birth', dataurodzenia: 'birth',
  login: 'login', username: 'login', user: 'login', userid: 'login',
  pesel: 'pesel', nip: 'nip', regon: 'regon',
} as Record<string, StructKind>));
const STRUCT_KIND_TYPE: Record<StructKind, PiiType> = {
  first: 'IMIE', surname: 'IMIE', fullname: 'IMIE', name: 'IMIE', phone: 'TELEFON',
  email: 'EMAIL', addr: 'ADRES', city: 'MIEJSCOWOSC', postal: 'KOD-POCZTOWY',
  birth: 'DATA-UR', login: 'LOGIN', pesel: 'PESEL', nip: 'NIP', regon: 'REGON',
};
const normStructKey = (k: string): string => k.toLowerCase().replace(/[._-]/g, '');

/** Pierwsze litery wyróżników wojewódzkich tablic rejestracyjnych (+ H/U — służby/wojsko).
 *  Walidują CZŁONY WYLICZENIA i tablice po kotwicy z przerwą („ISO 9001" ≠ tablica). */
const PLATE_VOIV_LETTERS = 'BCDEFGHKLNOPRSTUWZ';

// ============================================================================
// Kontekst redakcji + przebiegi (top-level; orkiestrowane przez redactPII)
// ============================================================================

/**
 * Wspólny kontekst przebiegów. `text` jest MUTOWALNE — każdy przebieg robi
 * `ctx.text = ctx.text.replace(...)`. Reszta pól to domknięcia/tablice przygotowane
 * raz w `redactPII` (bump/on/M/personMask) plus bufor sentineli URL.
 */
interface RedactCtx {
  text: string;
  on: (t: PiiType) => boolean;
  bump: (t: PiiType) => void;
  M: Record<PiiType, string>;
  personMask: (surnameToken: string) => string;
  protectedUrls: string[];
}

// Sentinel URL: znaki z Prywatnego Obszaru Użytku (U+E000/U+E001) — bez cyfr, „@" i liter
// słownikowych, więc żaden przebieg go nie rusza. Definiowane przez fromCharCode (identyczne
// z literałami „"/„"), by uniknąć niejednoznaczności escape'ów w narzędziach.
const URL_SENTINEL_OPEN = String.fromCharCode(0xe000);
const URL_SENTINEL_CLOSE = String.fromCharCode(0xe001);
const RE_URL_SENTINEL = new RegExp(`${URL_SENTINEL_OPEN}([A-Z]+)${URL_SENTINEL_CLOSE}`, 'g');

// Fabryka przebiegu „etykieta + separator + wartość": słowo-etykieta (grupa 1) i separator
// (grupa 2) zostają, a wartość (grupa 3) znika pod maską typu. Wspólny kształt dla
// NR-KONTA / PESEL / NIP / REGON / ZNAK-SPRAWY / DATA-UR — regex różny, callback identyczny.
function maskAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType): void {
  ctx.text = ctx.text.replace(re, (_m, kw: string, sep: string) => {
    ctx.bump(type);
    return `${kw}${sep}${ctx.M[type]}`;
  });
}

// Callback stałej maski: bump typu + zwrot placeholdera — dla przebiegów BEZ strażnika i BEZ
// użycia dopasowania (EMAIL/TOKEN/MAC/LOGIN/ADRES/ZNAK…). Zwraca funkcję gotową dla .replace().
function maskConst(ctx: RedactCtx, type: PiiType) {
  return (): string => {
    ctx.bump(type);
    return ctx.M[type];
  };
}

// Dwa wspólne skanery słownika miast (POLISH_CITIES) dla przebiegu MIEJSCOWOŚĆ: najdłuższe
// (do 3 słów) dopasowanie na PREFIKSIE lub SUFIKSIE ciągu wyrazów z wielkiej litery. Zwracają
// część NIEzamaskowaną (leftover/prefix) albo null, gdy żadne znane miasto nie pasuje. bump()
// woła się dokładnie wtedy, gdy miasto trafione.
function cityByPrefix(ctx: RedactCtx, words: string[]): { leftover: string } | null {
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    if (POLISH_CITIES.has(words.slice(0, n).join(' ').toLowerCase())) {
      ctx.bump('MIEJSCOWOSC');
      return { leftover: words.slice(n).join(' ') };
    }
  }
  return null;
}
function cityBySuffix(ctx: RedactCtx, words: string[]): { prefix: string } | null {
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    if (POLISH_CITIES.has(words.slice(words.length - n).join(' ').toLowerCase())) {
      ctx.bump('MIEJSCOWOSC');
      return { prefix: words.slice(0, words.length - n).join(' ') };
    }
  }
  return null;
}

// ═══════════════════════ FAZA 0 · OCHRONA URL (sentinel) ═══════════════════════
// CHRONIMY całe adresy przed pozostałymi przebiegami: bez tego detektory nazwisk/telefonów/
// PESEL gryzły fragmenty URL-a. Najpierw maskujemy PII WEWNĄTRZ (e-maile, wartości parametrów
// ?user=/?email=…), potem podmieniamy URL na sentinel U+E000<litery>U+E001 i przywracamy na
// końcu (finalizePersons). Drugi przebieg jest idempotentny: klasy wartości wykluczają „[".
function passProtectUrls(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(/\b(?:https?:\/\/|www\.)[^\s<>"'„”()]+/g, (raw) => {
    const trailMatch = raw.match(/[.,;:!?\]]+$/); // interpunkcja zdania nie należy do URL-a
    const trail = trailMatch ? trailMatch[0] : '';
    let url = trail ? raw.slice(0, raw.length - trail.length) : raw;
    if (ctx.on('EMAIL')) {
      url = url.replace(RE_EMAIL, () => { ctx.bump('EMAIL'); return ctx.M.EMAIL; });
      url = url.replace(RE_EMAIL_URLENC, () => { ctx.bump('EMAIL'); return ctx.M.EMAIL; });
    }
    if (ctx.on('TOKEN')) {
      // JWT w URL-u (fragment „#access_token=eyJ…") — poza URL-em łapie go passTokens,
      // ale URL jest sentinelowany WCZEŚNIEJ, więc token trzeba zdjąć już tutaj.
      url = url.replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}/g, maskConst(ctx, 'TOKEN'));
    }
    for (const rule of URL_PARAM_RULES) {
      if (!ctx.on(rule.type)) continue;
      url = url.replace(rule.re, (_pm, key: string) => {
        ctx.bump(rule.type);
        return `${key}${ctx.M[rule.type]}`;
      });
    }
    const sentinel = `${URL_SENTINEL_OPEN}${indexToLetters(ctx.protectedUrls.length)}${URL_SENTINEL_CLOSE}`;
    ctx.protectedUrls.push(url);
    return `${sentinel}${trail}`;
  });
}

// ═════════ FAZA 1 · STRUKTURALNE WYSOKIEJ PRECYZJI (etykieta / wzorzec) ═════════
// 1) E-MAIL
function passEmail(ctx: RedactCtx): void {
  if (!ctx.on('EMAIL')) return;
  ctx.text = ctx.text.replace(RE_EMAIL, maskConst(ctx, 'EMAIL'));
}

// 1a) TOKEN (JWT + sekrety prefiksowe): eyJ<base64url>.… oraz sk_live_/ghp_/github_pat_/xox?-.
// „eyJ" = base64 z „{\"" — znikome FP, a token może dawać dostęp, więc maskujemy w całości.
function passTokens(ctx: RedactCtx): void {
  if (!ctx.on('TOKEN')) return;
  ctx.text = ctx.text.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}/g, maskConst(ctx, 'TOKEN'));
  ctx.text = ctx.text.replace(
    /\b(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
    maskConst(ctx, 'TOKEN'),
  );
}

// MAC: 6 par hex po „:"/„-". MUSI biec PRZED IPv6 (MAC pasuje do wzorca grup hex IPv6).
function passMac(ctx: RedactCtx): void {
  if (!ctx.on('MAC')) return;
  ctx.text = ctx.text.replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, maskConst(ctx, 'MAC'));
  // MAC w notacji Cisco: „aabb.ccdd.eeff" (3 grupy po 4 hex). Wymagamy ≥1 LITERY hex.
  ctx.text = ctx.text.replace(
    /\b(?=[0-9A-Fa-f.]*[A-Fa-f])(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}(?![:\w-]|\.\w)/g,
    maskConst(ctx, 'MAC'),
  );
  // Z SILNĄ etykietą „MAC" maskujemy notację Cisco także CZYSTO CYFROWĄ (etykieta wygrywa).
  ctx.text = ctx.text.replace(
    /\b((?:adres\w*\s+)?MAC[\s:.=-]+)((?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4})(?![:\w-]|\.\w)/gi,
    (_m, pre: string) => {
      ctx.bump('MAC');
      return `${pre}${ctx.M.MAC}`;
    },
  );
}

// IP: IPv6 (grupy hex, także skrócone „::") PRZED IPv4 (oktety 0–255). Jeden typ dla obu wersji.
function passIp(ctx: RedactCtx): void {
  if (!ctx.on('IP')) return;
  const H = '[0-9A-Fa-f]{1,4}';
  const IPV6 =
    `(?:${H}:){7}${H}|(?:${H}:){1,7}:|(?:${H}:){1,6}:${H}|(?:${H}:){1,5}(?::${H}){1,2}|` +
    `(?:${H}:){1,4}(?::${H}){1,3}|(?:${H}:){1,3}(?::${H}){1,4}|(?:${H}:){1,2}(?::${H}){1,5}|` +
    `${H}:(?:(?::${H}){1,6})|:(?:(?::${H}){1,7}|:)`;
  // Prawa granica: kropka KOŃCA ZDANIA po adresie jest OK, ale kropka z kolejnym znakiem słownym nie.
  ctx.text = ctx.text.replace(new RegExp(`(?<![:.\\w])(?:${IPV6})(?![:\\w]|\\.\\w)`, 'g'), maskConst(ctx, 'IP'));
  // IPv4: 4 oktety 0–255. Nie po „art./poz." ani po „wersja/ver./v" (numer wersji ≠ IP).
  ctx.text = ctx.text.replace(
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      const before = ctx.text.slice(Math.max(0, offset - 12), offset).toLowerCase();
      if (/(?:wersj\w*|\bver\.?|\bv\.?)\s*$/.test(before)) return m; // numer wersji, nie IP
      ctx.bump('IP');
      return ctx.M.IP;
    },
  );
}

// VIN: 17 znaków, charset bez I/O/Q. Z kontekstem („VIN"/„nadwozia") ZAWSZE; bez kontekstu tylko
// gdy układ jest wyraźnie VIN-owy (WIELKIE litery + ≥4 cyfry + ≥3 litery) — inaczej hash/kod.
function passVin(ctx: RedactCtx): void {
  if (!ctx.on('VIN')) return;
  ctx.text = ctx.text.replace(
    /\b((?:vin|nr\s+vin|numer\s+vin|nr\s+nadwozia|numer\s+nadwozia)[\s:.=-]*)([A-HJ-NPR-Za-hj-npr-z0-9]{17})\b/gi,
    (_m, pre: string) => {
      ctx.bump('VIN');
      return `${pre}${ctx.M.VIN}`;
    },
  );
  ctx.text = ctx.text.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (m) => {
    const digits = (m.match(/\d/g) || []).length;
    const letters = (m.match(/[A-Z]/g) || []).length;
    if (digits >= 4 && letters >= 3) {
      ctx.bump('VIN');
      return ctx.M.VIN;
    }
    return m;
  });
}

// 1b) POLA FORMULARZA — etykieta w linii, wartość w tej samej („Nazwisko: X") lub NASTĘPNEJ
// („Nazwisko\nWILCZYŃSKI"). Kotwica strukturalna o wysokiej precyzji; łapie też WERSALIKI.
// Blok BEZ pojedynczej bramki `on()` — każde pole sprawdza własny typ.
function passFormFields(ctx: RedactCtx): void {
  const lines = ctx.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const bare = stripFormPrefix(lines[i]);
    const field = FORM_FIELDS.find((f) => f.re.test(bare.replace(/\s*:.*$/, '').replace(/\s*\([^)]*\)\s*$/, '')));
    if (!field || !ctx.on(field.type)) continue;
    const colon = bare.match(/:\s*(.+)$/); // „Etykieta: WARTOŚĆ" w tej samej linii
    if (colon) {
      // Data w tej samej linii ma już swój detektor (passBirthDate), więc same-line
      // obsługujemy tylko dla imion/miejsc/adresów.
      if (field.kind === 'date') continue;
      const val = colon[1].trim();
      if (isValidFormValue(val, field.kind)) {
        lines[i] = lines[i].replace(new RegExp(`${escapeRe(val)}\\s*$`), field.mask);
        ctx.bump(field.type);
      }
      continue;
    }
    // wartość w następnej NIEPUSTEJ linii — pomiń puste i podpowiedzi w nawiasach
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || /^\(.*\)$/.test(lines[j].trim()))) j++;
    if (j >= lines.length || isFormLabelLine(lines[j])) continue;
    const val = lines[j].trim();
    if (!isValidFormValue(val, field.kind)) continue;
    if (field.kind === 'date') {
      // maskuj SAMĄ datę w linii wartości (zachowaj adnotacje: „1990-01-01 (wg aktu)")
      if (RE_DATE_VALUE.test(lines[j])) {
        lines[j] = lines[j].replace(RE_DATE_VALUE, field.mask);
        ctx.bump(field.type);
      }
      continue;
    }
    lines[j] = lines[j].replace(/^(\s*)[\s\S]*?(\s*)$/, `$1${field.mask}$2`);
    ctx.bump(field.type);
  }
  ctx.text = lines.join('\n');
}

// 1c) STRUKTURA XML/JSON — tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna.
// Maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Blok BEZ pojedynczej bramki `on()` — structMask sprawdza typ per-wpis.
function passStructured(ctx: RedactCtx): void {
  const structMask = (kind: StructKind, value: string): string | null => {
    const v = value.trim();
    if (!v || v.length > 70 || /[[\]]/.test(v) || v.includes(URL_SENTINEL_OPEN) || v.includes(URL_SENTINEL_CLOSE)) return null;
    if (FORM_EMPTY_VALUES.has(v.toLowerCase().replace(/\s+/g, '').replace(/\.$/, ''))) return null;
    switch (kind) {
      case 'first':
      case 'surname':
      case 'fullname':
        if (!isValidFormValue(v, 'name')) return null;
        break;
      case 'name': {
        // generyczny „name" bywa nazwą produktu/firmy — bramka słownikowa: osoba tylko
        // gdy pierwszy wyraz to imię albo ostatni to nazwisko (słownik/morfologia)
        if (!isValidFormValue(v, 'name')) return null;
        const ws = v.split(/\s+/);
        const last = ws[ws.length - 1];
        if (!isFirstNameLike(ws[0]) && !surnameBase(last) && !looksLikeSurname(last)) return null;
        break;
      }
      case 'city':
        if (!isValidFormValue(v, 'place')) return null;
        break;
      case 'addr':
        if (!isValidFormValue(v, 'addr')) return null;
        break;
      case 'phone':
        if ((v.match(/\d/g) ?? []).length < 6 || /[A-Za-z]{3,}/.test(v)) return null;
        break;
      case 'postal':
        if (!/^\d{2}[- ]?\d{3}$/.test(v)) return null;
        break;
      case 'birth':
        if (!RE_DATE_VALUE.test(v)) return null;
        break;
      case 'login':
        if (!/^[A-Za-z][A-Za-z0-9._@-]{1,63}$/.test(v)) return null;
        break;
      case 'email':
        if (!/\S(?:@|%40|\(at\))\S/i.test(v)) return null;
        break;
      case 'pesel':
        if (!/^\d(?:[ -]?\d){10}$/.test(v)) return null;
        break;
      case 'nip':
        if (!/^(?:PL[- ]?)?\d(?:[ -]?\d){9}$/.test(v)) return null;
        break;
      case 'regon':
        if (!/^\d(?:[ -]?\d){8}(?:(?:[ -]?\d){5})?$/.test(v)) return null;
        break;
    }
    const type = STRUCT_KIND_TYPE[kind];
    if (!ctx.on(type)) return null;
    ctx.bump(type);
    // nazwisko (samo lub na końcu pełnego imienia i nazwiska) → spójna etykieta [OSOBA-X]
    if (kind === 'surname' || kind === 'fullname' || (kind === 'name' && /\s/.test(v))) {
      return ctx.personMask(v.split(/\s+/).pop() as string);
    }
    return ctx.M[type];
  };
  // XML: <Tag>wartość</Tag> (tag może mieć atrybuty; wartość jednoliniowa, bez zagnieżdżeń)
  ctx.text = ctx.text.replace(
    /(<([A-Za-z_][\w.-]{0,40})(?:\s[^<>]*)?>)([^<>\r\n]{1,70})(<\/\s*\2\s*>)/g,
    (m, open: string, tag: string, value: string, close: string) => {
      const kind = STRUCT_KEYS.get(normStructKey(tag));
      if (!kind) return m;
      const mask = structMask(kind, value);
      return mask === null ? m : `${open}${mask}${close}`;
    },
  );
  // JSON: "klucz": "wartość" — maskowana sama wartość między cudzysłowami
  ctx.text = ctx.text.replace(
    /("([A-Za-z_][\w.-]{0,40})"\s*:\s*")([^"\r\n]{1,70})(")/g,
    (m, prefix: string, key: string, value: string, close: string) => {
      const kind = STRUCT_KEYS.get(normStructKey(key));
      if (!kind) return m;
      const mask = structMask(kind, value);
      return mask === null ? m : `${prefix}${mask}${close}`;
    },
  );
}

// 1d) LOGIN — kotwica „login/username/nazwa użytkownika" + wartość-token, także w NASTĘPNEJ
// linii. Złapaną wartość maskujemy też w pozostałych wystąpieniach w dokumencie oraz w
// wariancie w cudzysłowie po „użytkownik/login/konto".
function passLogin(ctx: RedactCtx): void {
  if (!ctx.on('LOGIN')) return;
  const loginValues = new Set<string>();
  ctx.text = ctx.text.replace(
    /((?:\b[Ll]ogin\w{0,3}|\b[Uu]ser(?:name)?|\b[Nn]azwa\s+użytkownika|\b[Ii]dentyfikator\s+użytkownika)(?:\s+(?:użytkownika|administratora|operatora|serwisow\w+|techniczn\w+|w\s+systemie|systemow\w+|domenow\w+|sieciow\w+))?[ \t]*[:=][ \t]*\n?[ \t]*)(["„'«]?)([A-Za-z][A-Za-z0-9._-]{1,62}[A-Za-z0-9])(?!\.?[\p{L}\p{N}_-])(["”'»]?)/gu,
    (m, kw: string, q1: string, val: string, q2: string, offset: number) => {
      if (q1 && !q2) return m; // niedomknięty cudzysłów — to nie wartość pola
      // wartość nie może być kolejną etykietą („Login:\nHasło:") ani pustym oznaczeniem
      if (!q2 && ctx.text[offset + m.length] === ':') return m;
      // wartość w NASTĘPNEJ linii musi wypełniać ją w całości
      if (kw.includes('\n')) {
        const lineEnd = ctx.text.indexOf('\n', offset + kw.length);
        const rest = ctx.text.slice(offset + m.length, lineEnd === -1 ? ctx.text.length : lineEnd);
        if (!/^[\s.,;]*$/.test(rest)) return m;
      }
      if (FORM_EMPTY_VALUES.has(val.toLowerCase()) || FORM_LABEL_WORDS.has(val.toLowerCase())) return m;
      if (val.length >= 4) loginValues.add(val);
      ctx.bump('LOGIN');
      return `${kw}${q1}${ctx.M.LOGIN}${q2}`;
    },
  );
  ctx.text = ctx.text.replace(
    /\b([Uu]żytkownik\w*|[Ll]ogin\w*|[Kk]onto[ \t]+użytkownika)([ \t]+["„'«])([A-Za-z][A-Za-z0-9._-]{2,63})(["”'»])/g,
    (_m, kw: string, q1: string, val: string, q2: string) => {
      if (val.length >= 4) loginValues.add(val);
      ctx.bump('LOGIN');
      return `${kw}${q1}${ctx.M.LOGIN}${q2}`;
    },
  );
  for (const v of loginValues) {
    ctx.text = ctx.text.replace(new RegExp(`(?<![\\w.-])${escapeRe(v)}(?![\\w.-])`, 'g'), maskConst(ctx, 'LOGIN'));
  }
}

// 1e) ZNAK SPRAWY / ZNAK PISMA — sygnatura pisma urzędowego. Biegnie WCZEŚNIE, by zamaskować
// cały znak, zanim krótsze detektory (kod, telefon) odgryzą jego fragmenty cyfrowe. Dwa tryby:
function passZnakSprawy(ctx: RedactCtx): void {
  if (!ctx.on('ZNAK-SPRAWY')) return;
  // (a) STRUKTURALNIE — znak wg JRWA „SYMBOL.klasa.numer.ROK".
  const ZNAK_START = `[${PL_UP}]{2,}[0-9]*(?:-[A-Za-z${PL_UP}${PL_LO}0-9]+)*`;
  const ZNAK_MID = `(?:\\.[A-Za-z${PL_UP}${PL_LO}0-9-]+)*?`;
  ctx.text = ctx.text.replace(
    new RegExp(`(?<![A-Za-z0-9./-])${ZNAK_START}${ZNAK_MID}\\.\\d+\\.(?:19|20)\\d{2}(?:\\.[${PL_UP}]{2,3})?(?!\\d)`, 'g'),
    maskConst(ctx, 'ZNAK-SPRAWY'),
  );
  // (b) Z KONTEKSTEM („Znak sprawy:", „Sygn. akt", „Znak:") — słowo zostaje, maskujemy sam znak.
  const ZNAK_VALUE =
    `(?:[IVXLCDM]{1,4}[ \\t]+)?[${PL_UP}][A-Za-z${PL_LO}]{0,4}(?:/[${PL_UP}][A-Za-z${PL_LO}]{0,3})?[ \\t]+\\d+[ \\t]*/[ \\t]*\\d{2,4}` +
    `|[A-Za-z0-9${PL_UP}${PL_LO}]+(?:[.\\-/][A-Za-z0-9${PL_UP}${PL_LO}]+)+`;
  maskAfterLabel(
    ctx,
    new RegExp(
      `\\b(znak sprawy|znak pisma|nasz znak|wasz znak|sygn\\.?[ \\t]*akt|sygnatura akt|sygn\\.|znak(?=[ \\t]*:))` +
        `([ \\t]*:?[ \\t]*)(${ZNAK_VALUE})`,
      'gi',
    ),
    'ZNAK-SPRAWY',
  );
}

// ═════ FAZA 2 · IDENTYFIKATORY NUMERYCZNE (suma kontrolna / etykieta / długość) ═════
// Najdłuższe ciągi cyfr najpierw (IBAN 26 → PESEL 11 → NIP 10 → REGON), potem krótsze.
// 2) IBAN (z prefiksem kraju, walidacja mod 97). Dopuszcza spacje w grupach.
function passIban(ctx: RedactCtx): void {
  if (!ctx.on('IBAN')) return;
  ctx.text = ctx.text.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, (m) => {
    if (isValidIban(m)) {
      ctx.bump('IBAN');
      return ctx.M.IBAN;
    }
    return m;
  });
}

// 3) NR KONTA (NRB) zakotwiczony słowem „konto/rachunek/IBAN" + 26 cyfr (z opcjonalnymi spacjami).
function passAccount(ctx: RedactCtx): void {
  if (!ctx.on('NR-KONTA')) return;
  maskAfterLabel(
    ctx,
    /\b(konto|konta|rachunek|rachunku|rachunek bankowy|nr konta|numer konta|iban)\b([\s:.-]*)((?:\d[ ]?){25}\d)(?![ ]?\d)/gi,
    'NR-KONTA',
  );
  // (b) z etykietą + wartość w formacie IBAN — maskuj NAWET bez poprawnej sumy mod-97.
  maskAfterLabel(
    ctx,
    /\b((?:konto|konta|rachunek|rachunku|nr konta|numer konta|iban)(?:\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})?)([\s:=.-]+)([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30})(?![A-Z0-9])/gi,
    'NR-KONTA',
  );
  // (c) NRB BEZ prefiksu „PL" i BEZ etykiety — 26 cyfr z POPRAWNĄ sumą (walidacja po dodaniu „PL").
  ctx.text = ctx.text.replace(/(?<!\d[ ]?)(?:\d[ ]?){25}\d(?![ ]?\d)/g, (m) => {
    if (isValidIban('PL' + m.replace(/ /g, ''))) {
      ctx.bump('NR-KONTA');
      return ctx.M['NR-KONTA'];
    }
    return m;
  });
}

// 4) PESEL — 11 cyfr + suma kontrolna, nie po „art./poz.".
function passPesel(ctx: RedactCtx): void {
  if (!ctx.on('PESEL')) return;
  ctx.text = ctx.text.replace(/(?<![\dA-Za-z])\d{11}(?![\d])/g, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    if (isValidPesel(m)) {
      ctx.bump('PESEL');
      return ctx.M.PESEL;
    }
    return m;
  });
  // (b) z SILNĄ etykietą „PESEL" — maskuj 11 cyfr NAWET bez poprawnej sumy (etykieta to sygnał).
  maskAfterLabel(
    ctx,
    /\b(pesel(?:\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})?)([\s:=.-]+)(\d{11})(?![\d])/gi,
    'PESEL',
  );
}

// 5) NIP — separator MYŚLNIK LUB SPACJA lub 10 cyfr ciągiem + suma kontrolna.
function passNip(ctx: RedactCtx): void {
  if (!ctx.on('NIP')) return;
  // Opcjonalny prefiks kraju „PL" maskujemy RAZEM z numerem — maskuj całość, nie fragment.
  ctx.text = ctx.text.replace(
    /(?<![\d])(?:PL[- ]?)?(?:\d{3}[- ]\d{3}[- ]\d{2}[- ]\d{2}|\d{3}[- ]\d{2}[- ]\d{2}[- ]\d{3}|\d{10})(?![\d])/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (isValidNip(m.replace(/^PL[- ]?/, ''))) {
        ctx.bump('NIP');
        return ctx.M.NIP;
      }
      return m;
    },
  );
  // (b) z SILNĄ etykietą „NIP" — maskuj 10 cyfr (dowolny separator) NAWET bez poprawnej sumy.
  maskAfterLabel(
    ctx,
    /\b(nip(?:\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})?)([\s:=.-]+)((?:PL[- ]?)?(?:\d{3}[- ]\d{3}[- ]\d{2}[- ]\d{2}|\d{3}[- ]\d{2}[- ]\d{2}[- ]\d{3}|\d{10}))(?![\d])/gi,
    'NIP',
  );
}

// 6) REGON 14-cyfrowy (jednoznaczny) + suma kontrolna.
function passRegon(ctx: RedactCtx): void {
  if (!ctx.on('REGON')) return;
  ctx.text = ctx.text.replace(/(?<![\d])\d{14}(?![\d])/g, (m) => {
    if (isValidRegon14(m)) {
      ctx.bump('REGON');
      return ctx.M.REGON;
    }
    return m;
  });
  // 6a) REGON z etykietą „REGON" — 9 lub 14 cyfr. Maskuj NAWET bez poprawnej sumy.
  maskAfterLabel(
    ctx,
    /\b(regon(?:\s+[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})?)([\s:=.-]+)(\d{14}|\d{9})(?![\d])/gi,
    'REGON',
  );
}

// 6b) KARTA PŁATNICZA — TYLKO z kontekstem karty („karta/płatnicz/Visa/Mastercard/Maestro/Amex/
// Diners/Discover/JCB/card"): 13–19 cyfr (grupy po 4, sep. spacja/myślnik) + prefiks znanej sieci
// + suma Luhna. Kontekst jest WYMAGANY, bo sam Luhn+prefiks jest zbyt niejednoznaczny: IMEI
// (15 cyfr, MA sumę Luhna, prefiksy 35/37/4…), numery przesyłek/faktur, kody kreskowe (EAN) i
// identyfikatory transakcji też je spełniają. Bez etykiety karty NIE maskujemy (precyzja >
// nadmaskowanie — audyt adwersarialny wykrył 10 fałszywych trafień na wariancie bez kontekstu).
// Biegnie PRZED REGON, żeby kontekst karty wygrał dla 14-cyfrowego numeru (Diners) nad ślepą
// sumą REGON; numer 14-cyfr bez kontekstu karty zostaje dla REGON.
function passCard(ctx: RedactCtx): void {
  if (!ctx.on('KARTA')) return;
  ctx.text = ctx.text.replace(
    /\b((?:kart[a-ząćęłńóśźż]*|card|visa|mastercard|maestro|amex|american\s+express|diners(?:\s+club)?|discover|jcb|płatnicz[a-ząćęłńóśźż]*|kredytow[a-ząćęłńóśźż]*|debetow[a-ząćęłńóśźż]*)(?:[ \t]+(?:nr|numer|no)\.?)?)([\s:="'()<>|.-]+)((?:\d[ -]?){12,18}\d)(?![\d])/gi,
    (m, kw: string, sep: string, num: string) => {
      if (isValidCard(num)) {
        ctx.bump('KARTA');
        return `${kw}${sep}${ctx.M.KARTA}`;
      }
      return m;
    },
  );
}

// 8) TELEFON — polskie numery 9-cyfrowe. Trzy tryby, od najpewniejszego. (b) BIEGNIE PRZED (a),
// by placeholder nie przerwał łańcucha wyliczenia po kotwicy.
function passPhone(ctx: RedactCtx): void {
  if (!ctx.on('TELEFON')) return;
  // (b) słowo kontekstowe + 9 cyfr (zachowujemy słowo, maskujemy numer), także wyliczenie.
  ctx.text = ctx.text.replace(
    /\b(te[li]\.?|telefon\w{0,4}|kom\.?|komórk[aiwy]|fax|faks|nr te[li]\.?|kontakt\w{0,4})((?:\s+(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|telefoniczn\w+))?[\s:.=-]*)((?:\+?48[\s.-]{1,3})?(?:[\s\-().]{0,3}\d){9}(?:\s*(?:,|\boraz\b|\bi\b)\s*(?:(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|kom\.?|tel\.?)\s+)?(?:\+?48[\s.-]{1,3})?(?:[\s\-().]{0,3}\d){9})*)(?!\.?\d)/gi,
    (m, kw: string, sep: string, nums: string) => {
      const parts = nums.split(/\s*(?:,|\boraz\b|\bi\b)\s*/i);
      const validPart = (p: string) => {
        const d = p.replace(/\D/g, '');
        return d.length === 9 || (d.length === 11 && d.startsWith('48'));
      };
      if (!parts.every(validPart)) return m;
      // maskuj każdy 9-cyfrowy człon w miejscu — separatory listy i wypełniacze zostają
      const out = nums.replace(/(?:\+?48[\s.-]{1,3})?(?:[\s\-().]{0,3}\d){9}/g, (seg) => {
        ctx.bump('TELEFON');
        const lead = seg.match(/^\s*/)?.[0] ?? '';
        return `${lead}${ctx.M.TELEFON}`;
      });
      return `${kw}${sep}${out}`;
    },
  );
  // (a) prefiks +48/0048 — maskujemy RAZEM z prefiksem.
  ctx.text = ctx.text.replace(
    /(?<![\d])(?:\+|00)[\s]?48(?:[\s\-().]{0,3}\d){9}(?!\.?\d)/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      ctx.bump('TELEFON');
      return ctx.M.TELEFON;
    },
  );
  // (c) fallback bez kontekstu — klasyczne 3-3-3, 9 cyfr ciągiem lub kierunkowy w nawiasie.
  ctx.text = ctx.text.replace(
    /(?<![\d.])(?:\(\d{2}\)[ \t]?\d{3}[ \t-]?\d{2}[ \t-]?\d{2}|\d{3}[\s-]?\d{3}[\s-]?\d{3})(?!\.?\d)(?![ \t]*(?:,\d{2})?[ \t]*(?:zł|PLN|EUR|USD|gr\b))/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (m.replace(/\D/g, '').startsWith('0')) return m;
      ctx.bump('TELEFON');
      return ctx.M.TELEFON;
    },
  );
}

// 9) NR DOWODU osobistego — 3 litery + 6 cyfr. Trzy tryby (kontekst / dokładny format / mieszane).
function passIdCard(ctx: RedactCtx): void {
  if (!ctx.on('DOWOD')) return;
  // (a) Z KONTEKSTEM — maskujemy nawet BEZ poprawnej sumy kontrolnej.
  ctx.text = ctx.text.replace(
    /\b((?:dow[oó]d\w*|dow\.|legitymacj\w*|dokument\w*\s+tożsamości|seria i numer|nr dowodu)(?:\s+(?:osobist\w+|służbow\w+|nr|numer|seria|i))*[\s:.=-]*)([A-Za-z]{3}[\s-]?\d{6})(?!\d)/gi,
    (_m, pre: string, _num: string) => {
      ctx.bump('DOWOD');
      return `${pre}${ctx.M.DOWOD}`;
    },
  );
  // (b) BEZ kontekstu — 3 WIELKIE litery + 6 cyfr, z poprawną sumą (kody walut wyłączone).
  ctx.text = ctx.text.replace(/\b([A-Z]{3})[\s-]?\d{6}\b/g, (m, letters: string) => {
    if (CURRENCY_CODES.has(letters)) return m;
    if (!isValidDowod(m)) return m;
    ctx.bump('DOWOD');
    return ctx.M.DOWOD;
  });
  // (c) Litery mieszane/małe — tylko gdy suma kontrolna się zgadza.
  ctx.text = ctx.text.replace(/\b[A-Za-z]{3}[\s-]?\d{6}\b/g, (m) => {
    if (isValidDowod(m)) {
      ctx.bump('DOWOD');
      return ctx.M.DOWOD;
    }
    return m;
  });
}

// 9b) NR PASZPORTU — 2 litery + 7 cyfr. TYLKO z kontekstem („paszport"/„dokument podróży").
function passPassport(ctx: RedactCtx): void {
  if (!ctx.on('PASZPORT')) return;
  ctx.text = ctx.text.replace(
    /\b((?:paszport\w*|dokument\w*\s+podróży|nr\s+paszportu|numer\s+paszportu)(?:\s+(?:nr\.?|numer|seria|i))*)([\s:.=-]*)([A-Za-z]{2}[\s-]?\d{7})(?!\d)/gi,
    (_m, pre: string, sep: string) => {
      ctx.bump('PASZPORT');
      return `${pre}${sep}${ctx.M.PASZPORT}`;
    },
  );
}

// 9c) NUMER KRS — 10 cyfr. TYLKO z kontekstem „KRS" (brak publicznej sumy kontrolnej).
function passKrs(ctx: RedactCtx): void {
  if (!ctx.on('KRS')) return;
  ctx.text = ctx.text.replace(
    /\bKRS((?:\s+(?:pod\s+)?(?:nr\.?|numer(?:em)?))?[\s:.=-]*)(\d{10})(?!\d)/gi,
    (_m, sep: string, _num: string) => {
      ctx.bump('KRS');
      return `KRS${sep}${ctx.M.KRS}`;
    },
  );
}

// 9d) PRAWO JAZDY — TYLKO z kontekstem. Numer maskujemy W CAŁOŚCI (z separatorami „/"/„-").
function passDriverLicense(ctx: RedactCtx): void {
  if (!ctx.on('PRAWO-JAZDY')) return;
  ctx.text = ctx.text.replace(
    /\b((?:(?:nr|numer)\s+)?praw(?:o|a|em|ie)\s+jazdy(?:\s+(?:nr\.?|numer(?:u|ze|em)?|seri[ai]|kat\.?|kategori[ai]|o|[ABCDEMT]{1,2}\d?))*[\s:=.-]*)((?=[A-Za-z0-9/-]*\d)[A-Za-z0-9]{4,15}(?:[/-][A-Za-z0-9]{1,6}){0,3})/gi,
    (_m, pre: string) => {
      ctx.bump('PRAWO-JAZDY');
      return `${pre}${ctx.M['PRAWO-JAZDY']}`;
    },
  );
}

// 9e) NR REJESTRACYJNY (tablica) — z kontekstem oraz z kotwicą pojazdową i wyliczeniem.
function passPlate(ctx: RedactCtx): void {
  if (!ctx.on('NR-REJESTRACYJNY')) return;
  ctx.text = ctx.text.replace(
    /\b((?:nr\s+rej\w*|numer\s+rej\w*|rejestracyjn\w*|tablic\w*)(?:\s+(?:nr\.?|numer|pojazdu|rej\w*))*[\s:=.-]*)((?=[A-Z0-9\s-]{0,5}\d)[A-Z]{2,3}[\s-]?[A-Z0-9]{4,5})\b/gi,
    (_m, pre: string) => {
      ctx.bump('NR-REJESTRACYJNY');
      return `${pre}${ctx.M['NR-REJESTRACYJNY']}`;
    },
  );
  // Kotwica POJAZDOWA — wyliczenia pojazdów bez słowa „rejestracyjny".
  ctx.text = ctx.text.replace(
    /\b([Pp]ojazd\w*|[Ss]amoch[oó]d\w*|[Mm]otocykl\w*|[Mm]otorower\w*|[Cc]iągnik\w*|[Pp]rzyczep\w*|[Aa]uto|[Pp]arking\w*|[Zz]aparkowan\w*)((?:\s+(?:o|nr\.?|numerze|siodłow\w+|ciężarow\w+|osobow\w+|dostawcz\w+|specjaln\w+|wolnobieżn\w+))*(?:\s+(?:marki|typu)\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*(?=[\s:=.-]))?(?:\s+[a-ząćęłńóśźż]{1,15}){0,3}[\s:=.-]*)((?!BMW\b)[A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4})\b/g,
    (m, kw: string, sep: string, plate: string) => {
      if (!PLATE_VOIV_LETTERS.includes(plate[0])) return m;
      ctx.bump('NR-REJESTRACYJNY');
      return `${kw}${sep}${ctx.M['NR-REJESTRACYJNY']}`;
    },
  );
  // WYLICZENIE po zamaskowanej tablicy — kolejne człony listy dziedziczą kotwicę pierwszego.
  {
    const REJ = escapeRe(ctx.M['NR-REJESTRACYJNY']);
    const PLATE_ITEM = '(?!BMW\\b)[A-Z]{2,3}[\\s-]?\\d[A-Z0-9]{3,4}';
    ctx.text = ctx.text.replace(
      new RegExp(`(${REJ})((?:(?:\\s*,\\s*|\\s+oraz\\s+|\\s+i\\s+)${PLATE_ITEM}(?![\\w-]))+)`, 'g'),
      (_m, first: string, tail: string) => {
        const maskedTail = tail.replace(new RegExp(PLATE_ITEM, 'g'), (p) => {
          if (!PLATE_VOIV_LETTERS.includes(p[0])) return p;
          ctx.bump('NR-REJESTRACYJNY');
          return ctx.M['NR-REJESTRACYJNY'];
        });
        return `${first}${maskedTail}`;
      },
    );
  }
}

// 10) KOD POCZTOWY — XX-XXX, nie po „art./§".
function passPostal(ctx: RedactCtx): void {
  if (!ctx.on('KOD-POCZTOWY')) return;
  ctx.text = ctx.text.replace(/(?<![\d-])\d{2}-\d{3}(?![\d-])/g, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    ctx.bump('KOD-POCZTOWY');
    return ctx.M['KOD-POCZTOWY'];
  });
}

// ═══════════════════ FAZA 3 · DATA I ADRES / MIEJSCOWOŚĆ ═══════════════════
// Adres i miejscowość kotwiczą na już zamaskowanym [KOD-POCZTOWY]/[ADRES] z wcześniejszych
// przebiegów — dlatego passPostalNoHyphen i passCity biegną tu, a nie w FAZIE 2.
// 11) DATA URODZENIA — tylko z jawnym kontekstem (ur./urodzony/data urodzenia) + data.
function passBirthDate(ctx: RedactCtx): void {
  if (!ctx.on('DATA-UR')) return;
  maskAfterLabel(
    ctx,
    /\b(ur\.|urodzony|urodzona|urodzeni[ae]|data urodzenia)((?:\s+dnia)?[\s:.,-]*)(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:[IVX]{1,4}|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/gi,
    'DATA-UR',
  );
}

// 12) ADRES — ul./al./os./pl. + nazwa + numer (opcjonalnie /mieszkanie). Wysoka precyzja.
function passAddress(ctx: RedactCtx): void {
  if (!ctx.on('ADRES')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b([Uu][lI1]\\.|[Uu]lic[aiy]|[Aa]l\\.|[Aa]le[ij][aię]?|[Oo]s\\.|[Oo]siedl[eau]|[Pp]l\\.|[Pp]lac[ua]?)\\s+` +
        `(?:(?:\\d+|gen|płk|ppłk|mjr|kpt|por|ks|św|bp|abp|kard|marsz|prof|dr|inż|hr)\\.?\\s+|[A-ZĄĆĘŁŃÓŚŹŻ]\\.\\s+){0,2}` +
        `[${PL_UP}][${PL_LO}${PL_UP}01.-]*(?:[ \\t]+[${PL_UP}0-9][${PL_LO}${PL_UP}0-9.-]*){0,3}[ \\t]+\\d+[A-Za-z]?(?:\\s*(?:/|m\\.?|lok\\.?)\\s*\\d+[A-Za-z]?)?`,
      'g',
    ),
    maskConst(ctx, 'ADRES'),
  );
  // 12b) ADRES bez prefiksu „ul." — rozpoznawany po SĄSIEDZTWIE (już zamaskowanego) kodu pocztowego.
  const KOD = escapeRe(ctx.M['KOD-POCZTOWY']);
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b([${PL_UP}][${PL_LO}]+(?:\\s+[${PL_UP}][${PL_LO}]+){0,2})` +
        `\\s+\\d+[A-Za-z]?(?:\\s*(?:m\\.?|lok\\.?|/)\\s*\\d+[A-Za-z]?)?` +
        `(\\s*,?\\s*)(${KOD})`,
      'g',
    ),
    (_m, _street: string, sep: string, kod: string) => {
      ctx.bump('ADRES');
      return `${ctx.M.ADRES}${sep}${kod}`;
    },
  );
}

// 10b) KOD POCZTOWY BEZ MYŚLNIKA („65048") — TYLKO przy mocnej kotwicy adresowej: tuż po
// zamaskowanym [ADRES] i BEZPOŚREDNIO przed miejscowością (wyraz z wielkiej).
function passPostalNoHyphen(ctx: RedactCtx): void {
  if (!ctx.on('KOD-POCZTOWY')) return;
  const ADR = escapeRe(ctx.M.ADRES);
  ctx.text = ctx.text.replace(
    new RegExp(`(${ADR}\\s*,?\\s*)(?<!\\d)\\d{5}(?!\\d)(?=[ \\t]+${CAP_CITY})`, 'g'),
    (_m, pre: string) => {
      ctx.bump('KOD-POCZTOWY');
      return `${pre}${ctx.M['KOD-POCZTOWY']}`;
    },
  );
}

// 12c–12g) MIEJSCOWOŚĆ — nazwa po kodzie pocztowym, przed/po adresie, oraz w kontekście
// zamieszkania/urodzenia. Skanery słownika (cityByPrefix/cityBySuffix) dają precyzję.
function passCity(ctx: RedactCtx): void {
  if (!ctx.on('MIEJSCOWOSC')) return;
  // 12c) MIEJSCOWOŚĆ stojąca BEZPOŚREDNIO po kodzie pocztowym.
  const KOD = escapeRe(ctx.M['KOD-POCZTOWY']);
  ctx.text = ctx.text.replace(
    new RegExp(`(${KOD}|(?<![\\d-])\\d{2}-\\d{3})([ \\t]+)(${CAP_CITY})((?:[ \\t]+${CAP_CITY}){0,2})`, 'g'),
    (m, anchor: string, sep: string, first: string, restRaw: string, offset: number) => {
      // surowy kod poprzedzony odwołaniem prawnym („poz. 12-345 Rejestr") → nie adres
      if (anchor !== ctx.M['KOD-POCZTOWY'] && precededByLegalRef(ctx.text, offset)) return m;
      const rest = restRaw.trim() ? restRaw.trim().split(/\s+/) : [];
      // ile kolejnych wyrazów doklejamy: najdłuższe dopasowanie do słownika wielowyrazowego
      let take = 0;
      let combo = first.toLowerCase();
      for (let i = 0; i < rest.length; i++) {
        combo += ' ' + rest[i].toLowerCase();
        if (MULTIWORD_CITIES.has(combo)) take = i + 1;
      }
      ctx.bump('MIEJSCOWOSC');
      const leftover = rest.slice(take).join(' ');
      return `${anchor}${sep}${ctx.M.MIEJSCOWOSC}${leftover ? ' ' + leftover : ''}`;
    },
  );
  // 12d) MIEJSCOWOŚĆ przed adresem BEZ kodu pocztowego — „Warszawa, ul. …".
  const ADR = escapeRe(ctx.M.ADRES);
  ctx.text = ctx.text.replace(
    new RegExp(`((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})([ \\t]*,?[ \\t]+)(${ADR}|ul\\.|al\\.|os\\.|pl\\.)`, 'g'),
    (m, capRun: string, sep: string, anchor: string) => {
      const r = cityBySuffix(ctx, capRun.split(/\s+/));
      return r ? `${r.prefix ? r.prefix + ' ' : ''}${ctx.M.MIEJSCOWOSC}${sep}${anchor}` : m;
    },
  );
  // 12e) MIEJSCOWOŚĆ tuż PO zamaskowanym adresie bez kodu: „[ADRES], Warszawa".
  ctx.text = ctx.text.replace(
    new RegExp(`(${ADR})([ \\t]*,[ \\t]*|[ \\t]+[Ww]e?[ \\t]+|[ \\t]*\\n(?:[ \\t]*\\n)?[ \\t]*)((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})`, 'g'),
    (m, adr: string, sep: string, run: string) => {
      const r = cityByPrefix(ctx, run.split(/[ \t]+/));
      return r ? `${adr}${sep}${ctx.M.MIEJSCOWOSC}${r.leftover ? ' ' + r.leftover : ''}` : m;
    },
  );
  // 12f) MIEJSCOWOŚĆ w kontekście ZAMIESZKANIA/urodzenia osoby: „zamieszkały w Krakowie".
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b((?:[Zz]am\\.|(?:[Zz]a)?[Mm]ieszka[łl]?\\w*|[Zz]ameldowan\\w*|` +
        `(?:[Mm]iejsce|[Aa]dres)[ \\t]+(?:zamieszkania|zameldowania|pobytu|urodzenia))` +
        `[ \\t]*(?::[ \\t]*|[Ww]e?[ \\t]+|[ \\t]+))` +
        `((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})(?=[ \\t.,;:?!)]|$)`,
      'g',
    ),
    (m, marker: string, run: string) => {
      const r = cityByPrefix(ctx, run.split(/[ \t]+/));
      return r ? `${marker}${ctx.M.MIEJSCOWOSC}${r.leftover ? ' ' + r.leftover : ''}` : m;
    },
  );
  // 12g) MIEJSCOWOŚĆ po markerze URODZENIA, z datą pomiędzy: „ur. [DATA-URODZENIA] w Krakowie".
  const DUR = escapeRe(ctx.M['DATA-UR']);
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b((?:[Uu]r\\.|[Uu]rodzon\\w+)[ \\t]+(?:dnia[ \\t]+)?(?:${DUR}[ \\t]*r?\\.?,?[ \\t]*)?[Ww]e?[ \\t]+)` +
        `((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})(?=[ \\t.,;:?!)]|$)`,
      'g',
    ),
    (m, marker: string, run: string) => {
      const r = cityByPrefix(ctx, run.split(/[ \t]+/));
      return r ? `${marker}${ctx.M.MIEJSCOWOSC}${r.leftover ? ' ' + r.leftover : ''}` : m;
    },
  );
}

// ═══════════════════ FAZA 4 · IMIĘ I NAZWISKO (heurystyka) ═══════════════════
// 13a0–a4) Pary/ciągi imię+nazwisko (mianownik, odmiana, WERSALIKI, małe litery, małżonkowie).
function passPersonPairs(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  // (a0) „Imię i Imię Nazwisko" — małżonkowie/rodzeństwo o WSPÓLNYM nazwisku („Anna i Jan Kowalscy").
  ctx.text = ctx.text.replace(RE_SPOUSES, (m, a: string, b: string, c: string) => {
    if (!isFirstNameLike(a) || !isFirstNameLike(b)) return m;
    if (LEGAL_ENTITY_WORDS.has(c.toLowerCase())) return m;
    ctx.bump('IMIE');
    return `${ctx.personMask(c)} i ${ctx.personMask(c)}`; // wspólne nazwisko = ten sam klucz osoby
  });
  // (a) IMIĘ/IMIONA + NAZWISKO — jedno lub dwa imiona (mianownik LUB odmiana) + nazwisko.
  ctx.text = ctx.text.replace(RE_NAME_SEQ, (m) => {
    const words = m.split(/\s+/);
    let start = 0;
    while (start < words.length && !isFirstNameLike(words[start])) start++;
    if (start >= words.length) return m; // brak imienia w ciągu → zostaw
    let k = start;
    while (k < words.length && isFirstNameLike(words[k]) && !LEGAL_ENTITY_WORDS.has(words[k].toLowerCase())) k++;
    if (k >= words.length) return m; // same imiona, brak nazwiska po nich → zostaw
    const surname = words[k];
    if (LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
    ctx.bump('IMIE');
    const prefix = words.slice(0, start).join(' ');
    const rest = words.slice(k + 1).join(' ');
    return [prefix, ctx.personMask(surname), rest].filter(Boolean).join(' ');
  });
  // (a2) para „Wyraz Nazwisko(morfologiczne)" — sufiks -ski/-cki/-icz/-czyk spoza słownika.
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string) => {
    if (!looksLikeSurname(w2)) return m;
    const w1l = w1.toLowerCase();
    if (RE_SURNAME_OBLIQUE.test(w2.toLowerCase())) {
      ctx.bump('IMIE'); // dzierżawczy dopełniacz → rzeczownik/imię w w1 zostaje
      return `${w1} ${ctx.personMask(w2)}`;
    }
    // mianownik:
    if (LEGAL_ENTITY_WORDS.has(w1l)) return m; // „Nowa Ruda", „Izba …" — raczej nazwa własna
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l)) {
      ctx.bump('IMIE');
      return `${w1} ${ctx.personMask(w2)}`; // „Prezes Gzowski" → rola zostaje
    }
    ctx.bump('IMIE');
    return ctx.personMask(w2); // rzadkie imię + nazwisko (mianownik) → oba
  });
  // (a3) ODWRÓCONA kolejność „Nazwisko Imię" — częsta w nagłówkach e-maili.
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number) => {
    if (!isFirstNameLike(w2)) return m;
    const w1l = w1.toLowerCase();
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2.toLowerCase())) return m;
    const lineStart = ctx.text.lastIndexOf('\n', offset - 1) + 1;
    const headerCtx = /^\s*(to|do|od|from|cc|dw|odbiorca|nadawca|adresat|wysłano|sent)\s*:/i.test(
      ctx.text.slice(lineStart, offset),
    );
    if (!headerCtx && !surnameBase(w1) && !looksLikeSurname(w1)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w1); // klucz tożsamości = nazwisko (pierwsze słowo)
  });
  // (a4) IMIĘ + NAZWISKO MAŁYMI literami — niechlujny zapis (czaty, e-maile, formularze).
  const surnameLikeLo = (w: string): boolean =>
    !NON_SURNAME_ADJ.has(w) &&
    !LEGAL_ENTITY_WORDS.has(w) &&
    (looksLikeSurname(w) ||
      !!surnameBase(w) ||
      (w.includes('-') && w.split('-').some((p) => looksLikeSurname(p) || !!surnameBase(p))));
  ctx.text = ctx.text.replace(RE_LOWER_RUN, (m) => {
    const words = m.split(/([ \t]+)/); // zachowaj separatory (indeksy parzyste = wyrazy)
    let changed = false;
    for (let i = 0; i + 2 < words.length; i += 2) {
      const w1 = words[i];
      const w2 = words[i + 2];
      if (!w1 || !w2) continue;
      const w1l = w1.toLowerCase();
      if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l)) continue;
      if (!isFirstNameLike(w1) || !surnameLikeLo(w2.toLowerCase())) continue;
      ctx.bump('IMIE');
      words[i] = ctx.personMask(w2); // cała para „imię nazwisko" → jedna maska (klucz = nazwisko)
      words[i + 1] = '';
      words[i + 2] = '';
      changed = true;
      i += 2; // pomiń zamaskowane nazwisko
    }
    return changed ? words.join('') : m;
  });
}

// (b) wyzwalacze kontekstu — łapią nazwiska spoza listy imion („Pan Habdank-Wojewódzki").
function passPersonTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const nameTrigger = new RegExp(
    `\\b([Nn]azywam się|[Mm]am na imię|[Ii]mię i nazwisko|[Ii]mie i nazwisko|[Nn]azwisko:|` +
      `[Pp]anowie|[Pp]anami|[Pp]anom|[Pp]anów|[Pp]anem|[Pp]ana|[Pp]anią|[Pp]aniom|[Pp]anu|[Pp]ani|[Pp]an)` +
      `([ \\t:]+)([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?(?:[ \\t]+[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)?)(?![${PL_UP}${PL_LO}])`,
    'g',
  );
  ctx.text = ctx.text.replace(nameTrigger, (m, kw: string, sep: string, name: string) => {
    const words = name.split(/\s+/);
    // odetnij wiodące role/tytuły po wyzwalaczu — „Pan Dyrektor Kowalski" → zachowaj „Dyrektor".
    let s = 0;
    while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
    if (s >= words.length) return m;
    const surname = words[words.length - 1];
    const sl = surname.toLowerCase();
    // „Pan Wojewoda Mazowiecki", „Pani Sąd" — przymiotnik geo/encja to nie nazwisko
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase()) || NON_SURNAME_ADJ.has(sl)) return m;
    ctx.bump('IMIE');
    const kept = words.slice(0, s).join(' ');
    return `${kw}${sep}${kept ? kept + ' ' : ''}${ctx.personMask(surname)}`;
  });
}

// (b2) SILNE wyzwalacze self-ID („nazywam się", „mam na imię") — po nich w polszczyźnie ZAWSZE
// następuje imię/nazwisko, więc łapiemy je NIEZALEŻNIE od wielkości liter („nazywam się pAMELA
// nOWAK", „PAMELA", „pamela"). Świadomie NIE obejmuje „Pan/Pani" (po nich bywa czasownik: „Pan był").
// Precyzja: ufamy wyzwalaczowi tylko gdy kandydat wygląda na nazwę własną (wielka pierwsza litera
// któregoś członu) LUB słownik/morfologia potwierdza imię/nazwisko — inaczej „nazywam się tak jak
// trzeba" (same małe litery, brak potwierdzenia) zostaje nietknięte.
function passPersonStrongTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const AC = `[${PL_UP}${PL_LO}]`;
  const CAND = `${AC}{2,}(?:-${AC}{2,})?`;
  const re = new RegExp(
    `\\b(nazywam się|mam na imię)([ \\t:]+)(${CAND}(?:[ \\t]+${CAND}){0,2})(?![${PL_UP}${PL_LO}])`,
    'gi',
  );
  const startsUpper = (w: string): boolean => new RegExp(`^[${PL_UP}]`).test(w.split('-')[0]);
  ctx.text = ctx.text.replace(re, (m, kw: string, sep: string, name: string) => {
    const words = name.split(/[ \t]+/);
    let s = 0;
    while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
    if (s >= words.length) return m;
    const last = words[words.length - 1];
    const ll = last.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase()) || LEGAL_ENTITY_WORDS.has(ll) || NON_SURNAME_ADJ.has(ll)) return m;
    const cand = words.slice(s);
    const properCase = cand.some(startsUpper); // Titlecase/WERSALIK → traktuj jak nazwę własną
    const dictOk = cand.some((w) => isFirstNameLike(w)) || !!surnameBase(last) || looksLikeSurname(last);
    if (!properCase && !dictOk) return m;
    ctx.bump('IMIE');
    const kept = words.slice(0, s).join(' ');
    return `${kw}${sep}${kept ? kept + ' ' : ''}${ctx.personMask(last)}`;
  });
}

// (c) SAMODZIELNE nazwisko ze słownika najczęstszych nazwisk (z odmianą).
function passPersonSoloDict(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_DICT, (m, offset: number) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    if (!surnameBase(m)) return m;
    // „choroba Kowalskiego", „ulica Kwiatkowska", „im. Mickiewicza" — kontekst nie-osobowy
    if (precededByPatron(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m; // „Powiat: …", „Gmina: …"
    const prev = prevLowerWord(ctx.text, offset);
    if (prev && NON_PERSON_CONTEXT.has(prev)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(m);
  });
}

// (c1a) INICJAŁ + nazwisko („A. Baran", „J. Kowalski"). Inicjał to kotwica OSOBOWA.
function passPersonInitial(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      `(?<!(?:^|\\n)[ \\t]*)(?<!(?<!\\b(?:[Mm]ec|[Pp]rof|[Dd]r|[Mm]gr|[Ii]nż|hab|[Aa]dw|[Kk]s|płk|gen|kpt|mjr|por|sierż|lek|med|[Ss]ędz))[.!?][ \\t]+)\\b[${PL_UP}]\\.[ \\t]+([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)(?![${PL_UP}${PL_LO}])`,
      'g',
    ),
    (m, w2: string, offset: number) => {
      const wl = w2.toLowerCase();
      if (LEGAL_ENTITY_WORDS.has(wl) || NON_SURNAME_ADJ.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return m;
      if (precededByPatron(ctx.text, offset)) return m;
      const prev = prevLowerWord(ctx.text, offset);
      if (prev && NON_PERSON_CONTEXT.has(prev)) return m;
      if (!surnameBase(w2) && !looksLikeSurname(w2) && !HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w2))) return m;
      ctx.bump('IMIE');
      return ctx.personMask(w2);
    },
  );
}

// (c1b) OBCE imię DWUCZŁONOWE z myślnikiem + nazwisko („Jean-Pierre Dubois").
function passPersonForeign(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b([${PL_UP}][${PL_LO}]{1,6}-[${PL_UP}][${PL_LO}]{1,6})[ \\t]+` +
        `((?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]ella|[Dd]i|Da|[Bb]in|[Tt]er|El|Al)[ \\t]+)?` +
        `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)(?![${PL_LO}${PL_UP}])`,
      'g',
    ),
    (m, first: string, w2: string) => {
      const [f1, f2] = first.toLowerCase().split('-');
      if (!FOREIGN_GIVEN_NAMES.has(f1) && !FOREIGN_GIVEN_NAMES.has(f2)) return m;
      const last = w2.split(/[ \t]+/).pop() ?? w2;
      const wl = last.toLowerCase();
      if (LEGAL_ENTITY_WORDS.has(wl) || NON_SURNAME_ADJ.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return m;
      ctx.bump('IMIE');
      return ctx.personMask(last);
    },
  );
}

// (c2) SAMODZIELNE nazwisko rozpoznane MORFOLOGICZNIE (sufiks -ski/-cki/-icz/-czyk).
function passPersonSoloMorph(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_MORPH, (m, offset: number) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    const first = m.split('-')[0];
    // morfologia LUB słownik (słownik łapie formę z myślnikiem: „Nowak-Schmidt")
    if (!looksLikeSurname(m) && !looksLikeSurname(first) && !surnameBase(m) && !surnameBase(first)) return m;
    // drugi człon złożenia z wielkiej litery (np. „… Warszawski") → to przymiotnik nazwy.
    if (PRECEDED_BY_CAP.test(ctx.text.slice(Math.max(0, offset - 40), offset))) return m;
    // eponim/ulica po wyrazie z małej litery oraz patron instytucji
    if (precededByPatron(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m;
    const prev = prevLowerWord(ctx.text, offset);
    if (prev && NON_PERSON_CONTEXT.has(prev)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(first);
  });
}

// (c3) OCR/WERSALIKI: „J0AN K0WALSKI", „JAN KOWALSKI" — para tokenów WERSALIKAMI z homoglifami.
function passPersonOcrPair(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const OCRW = `[${PL_UP}][${PL_UP}01]{1,19}`;
  ctx.text = ctx.text.replace(
    new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])(${OCRW})[ \\t]+(${OCRW})(?![${PL_UP}${PL_LO}0-9-])`, 'g'),
    (m, t1: string, t2: string, offset: number) => {
      const homo1 = /[01]/.test(t1);
      const homo2 = /[01]/.test(t2);
      const allCaps = t1 === t1.toUpperCase() && t2 === t2.toUpperCase();
      if (!homo1 && !homo2 && !allCaps) return m; // zwykłe pary obsłużyły (a)–(c2)
      const norm = (s: string) => s.replace(/0/g, 'o').replace(/1/g, 'l').toLowerCase();
      const n1 = norm(t1);
      const n2 = norm(t2);
      if (LEGAL_ENTITY_WORDS.has(n1) || ROLE_WORDS.has(n1) || TITLE_WORDS.has(n1)) return m;
      if (LEGAL_ENTITY_WORDS.has(n2) || NON_SURNAME_ADJ.has(n2)) return m;
      if (!surnameBase(n2) && !looksLikeSurname(n2)) return m;
      if (precededByPatron(ctx.text, offset)) return m;
      if (!isFirstNameLike(n1) && !homo1) {
        // pierwszy token to nie imię — maskuj SAMO nazwisko, o ile zawiera homoglif
        if (!homo2) return m;
        ctx.bump('IMIE');
        return `${t1} ${ctx.personMask(n2)}`;
      }
      ctx.bump('IMIE');
      return ctx.personMask(n2);
    },
  );
}

// (c4) HOMOGLIF OCR WEWNĄTRZ słowa kapitalizowanego: „Jan KowaIski" (wielkie I zamiast l).
function passPersonOcrMix(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const OCR_MIX = `[${PL_UP}][${PL_LO}]*[I01][${PL_LO}I01]*`;
  ctx.text = ctx.text.replace(
    new RegExp(`(?<![${PL_UP}${PL_LO}0-9-])(?:(${CAP_WORD})[ \\t]+)?(${OCR_MIX})(?![${PL_UP}${PL_LO}0-9-])`, 'g'),
    (m, w1: string | undefined, w2: string) => {
      const n2 = w2[0].toLowerCase() + w2.slice(1).replace(/[I1]/g, 'l').replace(/0/g, 'o').toLowerCase();
      if (!surnameBase(n2) && !looksLikeSurname(n2)) return m;
      ctx.bump('IMIE');
      // znane imię przed nazwiskiem wciągane do maski; inny wyraz („Firma") zostaje
      if (w1 && isFirstNameLike(w1)) return ctx.personMask(n2);
      return `${w1 ? `${w1} ` : ''}${ctx.personMask(n2)}`;
    },
  );
}

// ══════ FAZA 5 · DOMKNIĘCIA OSÓB · STABILNA NUMERACJA · PRZYWRÓCENIE URL ══════
function finalizePersons(ctx: RedactCtx): void {
  // DOMKNIĘCIE: imię słownikowe tuż przed zamaskowaną osobą (także złączone _ lub -) → do maski.
  // Dwa przebiegi: po wciągnięciu jednego imienia przed maską może odsłonić się kolejne.
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(
      new RegExp(`(?<![${PL_UP}${PL_LO}])([${PL_UP}][${PL_LO}]+)[ _-](\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
      (m, w: string, mask: string) => (isFirstNameLike(w) ? mask : m),
    );
  }
  // DOMKNIĘCIE: inicjał imienia tuż przed zamaskowaną osobą („mec. J. [OSOBA-B]") wciąga do maski.
  ctx.text = ctx.text.replace(/(?<!(?:^|\n)[ \t]*)\b[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*(\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])/g, '$1');
  // DOMKNIĘCIE: cząstka obcego nazwiska wieloczłonowego po masce osoby („[OSOBA-F] Van Anh").
  ctx.text = ctx.text.replace(
    /(\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])[ \t]+(?:[Vv][ao]n|[Dd]e[rl]|[Dd]ella|[Bb]in|[Tt]er|D[aei]|De[rl]?|El|Al|L[ae])[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+/g,
    '$1',
  );
  // STABILNA NUMERACJA: etykiety osób wg kolejności PIERWSZEGO wystąpienia w tekście.
  {
    const seen: string[] = [];
    for (const mm of ctx.text.matchAll(/\[OSOBA-([A-Z]+)\]/g)) {
      if (!seen.includes(mm[1])) seen.push(mm[1]);
    }
    const remap = new Map(seen.map((l, i) => [l, indexToLetters(i)]));
    ctx.text = ctx.text.replace(/\[OSOBA-([A-Z]+)\]/g, (_m, l: string) => `[OSOBA-${remap.get(l)}]`);
  }
  // PRZYWRÓCENIE chronionych URL-i (PII wewnątrz nich zamaskowano w passProtectUrls).
  if (ctx.protectedUrls.length) {
    ctx.text = ctx.text.replace(RE_URL_SENTINEL, (mm, letters: string) => ctx.protectedUrls[lettersToIndex(letters)] ?? mm);
  }
}

// ============================================================================
// Główna funkcja redakcji
// ============================================================================

export function redactPII(input: string, options?: RedactOptions): RedactionResult {
  if (!input || typeof input !== 'string') {
    return { redacted: input ?? '', found: [] };
  }

  const counts = new Map<PiiType, number>();
  const bump = (t: PiiType) => counts.set(t, (counts.get(t) ?? 0) + 1);

  // Filtr typów (brak = wszystkie) i ewentualne własne placeholdery.
  const enabled = options?.types ? new Set(options.types) : null;
  const on = (t: PiiType) => enabled === null || enabled.has(t);
  const M: Record<PiiType, string> = options?.masks ? { ...MASK, ...options.masks } : MASK;

  // Pseudonimizacja: klucz (znormalizowane nazwisko) → stała etykieta [OSOBA-X].
  // Etykiety przydzielane w kolejności WYKRYCIA (pary → wyzwalacze → solo), deterministycznie.
  const personLabels = options?.pseudonyms ? new Map<string, string>() : null;
  const personMask = (surnameToken: string): string => {
    if (!personLabels) return M.IMIE;
    const key = normalizeSurnameKey(surnameToken);
    let label = personLabels.get(key);
    if (!label) {
      label = indexToLetters(personLabels.size);
      personLabels.set(key, label);
    }
    return `[OSOBA-${label}]`;
  };

  const ctx: RedactCtx = { text: input, on, bump, M, personMask, protectedUrls: [] };

  // Kolejność MA znaczenie: przebiegi czytają placeholdery poprzednich, a kolejność pierwszego
  // bump danego typu wyznacza kolejność listy `found`. Sekwencja = dawna kolejność fizyczna 1:1.

  // ═══════════════════════ FAZA 0 · OCHRONA URL (sentinel) ═══════════════════════
  passProtectUrls(ctx);

  // ═════════ FAZA 1 · STRUKTURALNE WYSOKIEJ PRECYZJI (etykieta / wzorzec) ═════════
  passEmail(ctx);
  passTokens(ctx);
  passMac(ctx);
  passIp(ctx);
  passVin(ctx);
  passFormFields(ctx);
  passStructured(ctx);
  passLogin(ctx);
  passZnakSprawy(ctx);

  // ═════ FAZA 2 · IDENTYFIKATORY NUMERYCZNE (suma kontrolna / etykieta / długość) ═════
  passIban(ctx);
  passAccount(ctx);
  passPesel(ctx);
  passNip(ctx);
  passCard(ctx);
  passRegon(ctx);
  passPhone(ctx);
  passIdCard(ctx);
  passPassport(ctx);
  passKrs(ctx);
  passDriverLicense(ctx);
  passPlate(ctx);
  passPostal(ctx);

  // ═══════════════════ FAZA 3 · DATA I ADRES / MIEJSCOWOŚĆ ═══════════════════
  passBirthDate(ctx);
  passAddress(ctx);
  passPostalNoHyphen(ctx);
  passCity(ctx);

  // ═══════════════════ FAZA 4 · IMIĘ I NAZWISKO (heurystyka) ═══════════════════
  passPersonPairs(ctx);
  passPersonTrigger(ctx);
  passPersonStrongTrigger(ctx);
  passPersonSoloDict(ctx);
  passPersonInitial(ctx);
  passPersonForeign(ctx);
  passPersonSoloMorph(ctx);
  passPersonOcrPair(ctx);
  passPersonOcrMix(ctx);

  // ══════ FAZA 5 · DOMKNIĘCIA OSÓB · STABILNA NUMERACJA · PRZYWRÓCENIE URL ══════
  finalizePersons(ctx);

  const found: PiiFinding[] = [...counts.entries()].map(([type, count]) => ({ type, count }));
  return { redacted: ctx.text, found };
}

/** Wygodny skrót: czy tekst zawiera jakiekolwiek PII (np. do ostrzeżeń UI). */
export function hasPII(text: string): boolean {
  return redactPII(text).found.length > 0;
}

/** Czytelne etykiety wykrytych typów (np. do komunikatu „Zamaskowano: PESEL, e-mail"). */
const HUMAN_LABEL: Record<PiiType, string> = {
  EMAIL: 'adres e-mail',
  IBAN: 'numer konta',
  'NR-KONTA': 'numer konta',
  KARTA: 'numer karty płatniczej',
  PESEL: 'PESEL',
  NIP: 'NIP',
  REGON: 'REGON',
  TELEFON: 'numer telefonu',
  DOWOD: 'numer dowodu',
  PASZPORT: 'numer paszportu',
  KRS: 'numer KRS',
  'PRAWO-JAZDY': 'nr prawa jazdy',
  'NR-REJESTRACYJNY': 'nr rejestracyjny',
  VIN: 'VIN',
  IP: 'adres IP',
  MAC: 'adres MAC',
  TOKEN: 'token',
  LOGIN: 'login',
  'ZNAK-SPRAWY': 'znak sprawy',
  'KOD-POCZTOWY': 'kod pocztowy',
  'DATA-UR': 'datę urodzenia',
  ADRES: 'adres',
  MIEJSCOWOSC: 'miejscowość',
  IMIE: 'imię i nazwisko',
};

export function describeFindings(found: PiiFinding[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const f of found) {
    const label = HUMAN_LABEL[f.type];
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}
