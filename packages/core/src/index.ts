/**
 * Anonimizator — twarda, deterministyczna redakcja polskich danych osobowych (PII).
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

import { normalizeSurnameKey, surnameBase } from './surnames.js';

export type PiiType =
  | 'EMAIL'
  | 'IBAN'
  | 'NR-KONTA'
  | 'PESEL'
  | 'NIP'
  | 'REGON'
  | 'TELEFON'
  | 'DOWOD'
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

/** Etykiety placeholderów (czytelne dla człowieka i modelu, bez cyfr → idempotentne). */
const MASK: Record<PiiType, string> = {
  EMAIL: '[EMAIL]',
  IBAN: '[NR-KONTA]',
  'NR-KONTA': '[NR-KONTA]',
  PESEL: '[PESEL]',
  NIP: '[NIP]',
  REGON: '[REGON]',
  TELEFON: '[TELEFON]',
  DOWOD: '[NR-DOWODU]',
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

/** PESEL: 11 cyfr, wagi [1,3,7,9,1,3,7,9,1,3], cyfra kontrolna = (10 − sum%10)%10. */
export function isValidPesel(s: string): boolean {
  const d = onlyDigits(s);
  if (d.length !== 11) return false;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += d[i] * w[i];
  const control = (10 - (sum % 10)) % 10;
  return control === d[10];
}

/** NIP: 10 cyfr, wagi [6,5,7,2,3,4,5,6,7], kontrola = sum%11 (10 → nieważny). */
export function isValidNip(s: string): boolean {
  const d = onlyDigits(s);
  if (d.length !== 10) return false;
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * w[i];
  const control = sum % 11;
  if (control === 10) return false;
  return control === d[9];
}

/** REGON 9-cyfrowy: wagi [8,9,2,3,4,5,6,7], kontrola = sum%11 (10 → 0). */
export function isValidRegon9(s: string): boolean {
  const d = onlyDigits(s);
  if (d.length !== 9) return false;
  const w = [8, 9, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += d[i] * w[i];
  const control = sum % 11 === 10 ? 0 : sum % 11;
  return control === d[8];
}

/** REGON 14-cyfrowy: wagi [2,4,8,5,0,9,7,3,6,1,2,4,8], kontrola = sum%11 (10 → 0). */
export function isValidRegon14(s: string): boolean {
  const d = onlyDigits(s);
  if (d.length !== 14) return false;
  const w = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += d[i] * w[i];
  const control = sum % 11 === 10 ? 0 : sum % 11;
  return control === d[13];
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

// ============================================================================
// Strażniki kontekstu — nie myl numeru przepisu z numerem identyfikacyjnym
// ============================================================================

/**
 * Czy dopasowanie jest poprzedzone odwołaniem do aktu/przepisu (art., §, ust., poz., Dz.U., sygn.)?
 * Wtedy ciąg cyfr to numer artykułu/pozycji, NIE telefon/PESEL — nie redagujemy.
 * (Dokumenty urzędowe i prawne są pełne takich odwołań — bez tego strażnika toną w maskach.)
 */
function precededByLegalRef(full: string, offset: number): boolean {
  const before = full.slice(Math.max(0, offset - 16), offset);
  // „regon": ciąg po tej kotwicy to (nie)poprawny REGON — obsłużony (albo słusznie
  // odrzucony) przez krok REGON; detektor telefonu nie może go pożerać (bug z benchmarku).
  return /(art\.?|§|ust\.?|pkt|poz\.?|sygn\.?|nr\s|dz\.?\s?u|regon)\s*$/i.test(before);
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
    'krystian leonard iwo alojzy bruno feliks gerard konstanty maksym miron przemek roch salomon tymon tymoteusz'
  ).split(/\s+/),
);

const PL_UP = 'A-ZĄĆĘŁŃÓŚŹŻ';
const PL_LO = 'a-ząćęłńóśźż';

/**
 * Encje prawne/instytucje, których NIE traktujemy jako „imię nazwisko"
 * (np. „Sąd Najwyższy", „Kodeks Cywilny", „Prawo Pracy").
 */
const LEGAL_ENTITY_WORDS = new Set<string>(
  (
    'sąd sądu trybunał trybunału izba kodeks kodeksu ustawa ustawie prawo prawa ordynacja ' +
    'rozporządzenie urząd urzędu ministerstwo sejm senat parlament komisja inspekcja straż ' +
    'policja prokuratura rzecznik cywilny cywilnego karny karnego pracy handlowy administracyjny ' +
    'postępowania wykonawczy skarbowy rzeczpospolita polska polski unia europejska najwyższy ' +
    'apelacyjny okręgowy rejonowy konstytucyjny państwowa narodowy narodowa fundusz zakład ' +
    'krajowy krajowa główny główna społecznych ' +
    // częste rzeczowniki „dokumentowe" — nie mylić z nazwiskiem w parze „Słowo Imię"
    'umowa umowie załącznik rozdział artykuł ustęp punkt pozycja faktura pismo wniosek decyzja ' +
    'departament biuro wydział referat oddział sekcja nowy nowa'
  ).split(/\s+/),
);

/** Tytuły/grzecznościowe — NIE są nazwiskiem w parze „Tytuł Imię" (trigger obsługuje je osobno). */
const TITLE_WORDS = new Set<string>(
  'pan pani pana panu panią panie państwo szanowny szanowna dr prof mgr inż'.split(/\s+/),
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
    // częste formy zależne dużych miast (pozycja „w <mieście>, ul. …")
    'warszawie|warszawy|krakowie|krakowa|łodzi|wrocławiu|wrocławia|poznaniu|poznania|gdańsku|gdańska|' +
    'szczecinie|bydgoszczy|lublinie|lublina|katowicach|gdyni|częstochowie|radomiu|radomia|sosnowcu|' +
    'toruniu|torunia|kielcach|rzeszowie|olsztynie|opolu|płocku|tarnowie|koszalinie|kaliszu|legnicy|' +
    'słupsku|zamościu|chełmie|elblągu|gliwicach|bytomiu|rybniku'
  ).split('|'),
]);

// Rdzenie imion (mianownik bez końcowego „a" dla imion żeńskich) — do rozpoznawania
// form ODMIENIONYCH: „Anną", „Annę", „Janem", „Aleksandrą". Słownik ma tylko mianownik,
// więc bez tego imię w odmianie wyciekało obok zamaskowanego nazwiska.
const FIRST_NAME_STEMS = new Set<string>(
  [...POLISH_FIRST_NAMES].map((n) => (n.endsWith('a') ? n.slice(0, -1) : n)),
);
const NAME_INFLECTIONS = ['', 'a', 'i', 'y', 'ie', 'ę', 'ą', 'o', 'u', 'e', 'em', 'owi'];

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

  let text = input;

  // Kolejność MA znaczenie: najpierw e-mail (zawiera @, nie koliduje z cyframi),
  // potem NAJDŁUŻSZE ciągi cyfr (IBAN 26 → PESEL 11 → NIP 10 → REGON), na końcu krótsze
  // (telefon 9, kod 5). Redakcja dłuższego usuwa ciąg, więc krótszy detektor nie „odgryza" jego części.

  // 1) E-MAIL
  if (on('EMAIL')) {
    text = text.replace(
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
      () => {
        bump('EMAIL');
        return M.EMAIL;
      },
    );
  }

  // 2) IBAN (z prefiksem kraju, walidacja mod 97). Dopuszcza spacje w grupach.
  if (on('IBAN')) {
    text = text.replace(
      /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g,
      (m) => {
        if (isValidIban(m)) {
          bump('IBAN');
          return M.IBAN;
        }
        return m;
      },
    );
  }

  // 3) NR KONTA (NRB) zakotwiczony słowem „konto/rachunek/IBAN" + 26 cyfr (z opcjonalnymi spacjami).
  if (on('NR-KONTA')) {
    text = text.replace(
      /\b(konto|konta|rachunek|rachunku|rachunek bankowy|nr konta|numer konta|iban)\b([\s:.-]*)((?:\d[ ]?){26})(?!\d)/gi,
      (_m, kw, sep) => {
        bump('NR-KONTA');
        return `${kw}${sep}${M['NR-KONTA']}`;
      },
    );
  }

  // 4) PESEL — 11 cyfr + suma kontrolna, nie po „art./poz.".
  if (on('PESEL')) {
    text = text.replace(/(?<![\dA-Za-z])\d{11}(?![\d])/g, (m, offset: number) => {
      if (precededByLegalRef(text, offset)) return m;
      if (isValidPesel(m)) {
        bump('PESEL');
        return M.PESEL;
      }
      return m;
    });
  }

  // 5) NIP — format z separatorami (XXX-XXX-XX-XX / XXX-XX-XX-XXX) lub 10 cyfr ciągiem, + suma kontrolna.
  if (on('NIP')) {
    text = text.replace(
      /(?<![\d])(?:\d{3}-\d{3}-\d{2}-\d{2}|\d{3}-\d{2}-\d{2}-\d{3}|\d{10})(?![\d])/g,
      (m, offset: number) => {
        if (precededByLegalRef(text, offset)) return m;
        if (isValidNip(m)) {
          bump('NIP');
          return M.NIP;
        }
        return m;
      },
    );
  }

  // 6) REGON 14-cyfrowy (jednoznaczny — nie myli się z telefonem/PESEL) + suma kontrolna.
  if (on('REGON')) {
    text = text.replace(/(?<![\d])\d{14}(?![\d])/g, (m) => {
      if (isValidRegon14(m)) {
        bump('REGON');
        return M.REGON;
      }
      return m;
    });

    // 7) REGON 9-cyfrowy — TYLKO zakotwiczony słowem „REGON" (bez tego 9 cyfr to częściej telefon).
    text = text.replace(
      /\b(regon)\b([\s:.-]*)(\d{9})(?![\d])/gi,
      (m, kw, sep, num) => {
        if (isValidRegon9(num)) {
          bump('REGON');
          return `${kw}${sep}${M.REGON}`;
        }
        return m;
      },
    );
  }

  // 8) TELEFON — polskie numery 9-cyfrowe. Trzy tryby, od najpewniejszego:
  //   (a) prefiks międzynarodowy (+48 / 0048) → DOWOLNE grupowanie 9 cyfr. To łapie numery
  //       stacjonarne „+48 22 245 59 22" (podział 2-3-2-2), których sztywny wzorzec 3-3-3
  //       NIE ujmował (realny bug z pism urzędowych — instytucjonalny telefon zostawał jawny);
  //   (b) słowo kontekstowe (tel./telefon/kom./fax/faks) + 9 cyfr w dowolnym grupowaniu;
  //   (c) bez kontekstu → tylko klasyczne 3-3-3 lub 9 cyfr ciągiem (mniej fałszywych trafień).
  if (on('TELEFON')) {
    const hasNineDigits = (s: string) => s.replace(/\D/g, '').length === 9;

    // (a) prefiks +48/0048 — maskujemy RAZEM z prefiksem.
    text = text.replace(
      /(?<![\d])(?:\+|00)\s?48[\s-]?(?:\d[\s-]?){8}\d(?![\d])/g,
      (m, offset: number) => {
        if (precededByLegalRef(text, offset)) return m;
        bump('TELEFON');
        return M.TELEFON;
      },
    );

    // (b) słowo kontekstowe + 9 cyfr (zachowujemy słowo, maskujemy numer).
    text = text.replace(
      /\b(tel\.?|telefon(?:u|em)?|kom\.?|komórk[aiwy]|fax|faks|nr tel\.?)([\s:.-]*)((?:\d[\s-]?){8}\d)(?![\d])/gi,
      (m, kw: string, sep: string, num: string) => {
        if (!hasNineDigits(num)) return m;
        bump('TELEFON');
        return `${kw}${sep}${M.TELEFON}`;
      },
    );

    // (c) fallback bez kontekstu — klasyczne 3-3-3 lub 9 cyfr ciągiem. Nie po „art./poz.".
    text = text.replace(
      /(?<![\d])\d{3}[\s-]?\d{3}[\s-]?\d{3}(?![\d])/g,
      (m, offset: number) => {
        if (precededByLegalRef(text, offset)) return m;
        bump('TELEFON');
        return M.TELEFON;
      },
    );
  }

  // 9) NR DOWODU osobistego — 3 litery + 6 cyfr. Dwa tryby:
  if (on('DOWOD')) {
    // (a) Z KONTEKSTEM („dowód"/„dowodu"/„seria i numer"/„nr dowodu") — maskujemy nawet BEZ
    //     poprawnej sumy kontrolnej. Kontekst to mocny sygnał, a w pismach numer bywa fikcyjny
    //     lub z literówką; zachowujemy słowo kontekstowe, maskujemy sam numer.
    //     „dow[oó]d…" akceptuje pisownię z diakrytykiem i bez; między słowem a numerem
    //     dopuszczamy wypełniacze („nr", „seria", „numer", „osobisty", „służbowy").
    text = text.replace(
      /\b((?:dow[oó]d\w*|dow\.|legitymacj\w*|dokument\w*\s+tożsamości|seria i numer|nr dowodu)(?:\s+(?:osobist\w+|służbow\w+|nr|numer|seria|i))*[\s:.=-]*)([A-Za-z]{3}[\s-]?\d{6})(?!\d)/gi,
      (_m, ctx: string, _num: string) => {
        bump('DOWOD');
        return `${ctx}${M.DOWOD}`;
      },
    );

    // (b) BEZ kontekstu — dokładny format polskiego dowodu: 3 WIELKIE litery + 6 cyfr.
    //     Układ jest na tyle charakterystyczny, że maskujemy go także bez sumy kontrolnej
    //     (numery w pismach bywają testowe albo z literówką). Wyjątek: kody walut
    //     (np. „PLN 123456" to kwota, nie dowód).
    const CURRENCY_CODES = new Set([
      'PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'JPY', 'UAH', 'RUB',
    ]);
    text = text.replace(/\b([A-Z]{3})[\s-]?\d{6}\b/g, (m, letters: string) => {
      if (CURRENCY_CODES.has(letters)) return m;
      bump('DOWOD');
      return M.DOWOD;
    });

    // (c) Litery mieszane/małe (np. „abc123456") — tylko gdy suma kontrolna się zgadza
    //     (bez tego dowolne 3 litery + 6 cyfr dawałyby za dużo fałszywych trafień).
    text = text.replace(/\b[A-Za-z]{3}[\s-]?\d{6}\b/g, (m) => {
      if (isValidDowod(m)) {
        bump('DOWOD');
        return M.DOWOD;
      }
      return m;
    });
  }

  // 10) KOD POCZTOWY — XX-XXX, nie po „art./§" (żeby nie zjeść zakresu „art. 12-345").
  if (on('KOD-POCZTOWY')) {
    text = text.replace(/(?<![\d-])\d{2}-\d{3}(?![\d-])/g, (m, offset: number) => {
      if (precededByLegalRef(text, offset)) return m;
      bump('KOD-POCZTOWY');
      return M['KOD-POCZTOWY'];
    });
  }

  // 11) DATA URODZENIA — tylko z jawnym kontekstem (ur./urodzony/data urodzenia) + data.
  // UWAGA: bez trailing `\b` — po „ur." granica słowa NIE występuje między kropką a spacją,
  // więc wariant „ur. " nigdy się nie dopasowywał (bug z benchmarku). Separator ogranicza sam.
  if (on('DATA-UR')) {
    text = text.replace(
      /\b(ur\.|urodzony|urodzona|urodzeni[ae]|data urodzenia)([\s:.,-]*)(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2})/gi,
      (_m, kw, sep) => {
        bump('DATA-UR');
        return `${kw}${sep}${M['DATA-UR']}`;
      },
    );
  }

  // 12) ADRES — ul./al./os./pl. + nazwa + numer (opcjonalnie /mieszkanie). Wysoka precyzja.
  if (on('ADRES')) {
    text = text.replace(
      new RegExp(
        // też formy zależne: „na ulicy…", „przy alei…", „na osiedlu…", „na placu…"
        `\\b(ul\\.|ulic[aiy]|al\\.|ale[ij][aię]?|os\\.|osiedl[eau]|pl\\.|plac[ua]?)\\s+` +
          // nazwa ulicy może zaczynać się od LICZBY („3 Maja", „11 Listopada") lub od
          // małego SKRÓTU rangi/tytułu („gen. Andersa", „ks. Popiełuszki", „św. Marcin") —
          // bez tego ulice te zostawały jawne (nazwa nie startowała wielką literą).
          `(?:(?:\\d+|gen|płk|ppłk|mjr|kpt|por|ks|św|bp|abp|kard|marsz|prof|dr|inż|hr)\\.?\\s+){0,2}` +
          `[${PL_UP}][${PL_LO}${PL_UP}.-]*(?:\\s+[${PL_UP}0-9][${PL_LO}${PL_UP}0-9.-]*){0,3}\\s+\\d+[A-Za-z]?(?:\\s*/\\s*\\d+[A-Za-z]?)?`,
        'g',
      ),
      () => {
        bump('ADRES');
        return M.ADRES;
      },
    );

    // 12b) ADRES bez prefiksu „ul." — rozpoznawany po SĄSIEDZTWIE kodu pocztowego.
    // Kod pocztowy jest już zamaskowany (krok 10 biegnie wcześniej), więc wzorzec
    // „Nazwa[ Nazwa] Numer, [KOD-POCZTOWY]" pewnie wskazuje ulicę („Królewska 27,
    // 00-060 Warszawa" → „Aleje Jerozolimskie 100…"). Kotwica na placeholderze daje
    // wysoką precyzję — „Rozdział 5" czy „Załącznik 2" nie stoją przed kodem pocztowym.
    const KOD = M['KOD-POCZTOWY'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(
      new RegExp(
        `\\b([${PL_UP}][${PL_LO}]+(?:\\s+[${PL_UP}][${PL_LO}]+){0,2})` +
          `\\s+\\d+[A-Za-z]?(?:\\s*(?:m\\.?|/)\\s*\\d+[A-Za-z]?)?` +
          `(\\s*,?\\s*)(${KOD})`,
        'g',
      ),
      (_m, _street: string, sep: string, kod: string) => {
        bump('ADRES');
        return `${M.ADRES}${sep}${kod}`;
      },
    );
  }

  // 12c) MIEJSCOWOŚĆ — nazwa miejscowości stojąca BEZPOŚREDNIO po kodzie pocztowym.
  // W polskim adresie miejscowość ZAWSZE następuje po kodzie („XX-XXX Miasto"), więc kod
  // (już zamaskowany w kroku 10, ewentualnie surowy gdy maskowanie kodu wyłączone) to
  // niezawodna kotwica: pierwszy wyraz z wielkiej litery za nim to miejscowość, nie fragment
  // zdania. To odróżnia adres od tekstu: „w Warszawie" czy „Sąd dla Warszawy-Śródmieścia"
  // nie mają obok kodu pocztowego, więc reguła ich NIE rusza (zero nadmaskowania w tekście).
  // Miasta jedno- i wielowyrazowe: pierwszy człon maskujemy zawsze (pozycyjnie), kolejne
  // TYLKO gdy tworzą znaną wielowyrazową miejscowość (słownik) — inaczej zostają nietknięte,
  // żeby nie pożreć następnego zdania („[KOD] Warszawa. Sprawę…" → „Sprawę" zostaje).
  if (on('MIEJSCOWOSC')) {
    const KOD = M['KOD-POCZTOWY'].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cap = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)*`;
    text = text.replace(
      new RegExp(`(${KOD}|(?<![\\d-])\\d{2}-\\d{3})(\\s+)(${cap})((?:\\s+${cap}){0,2})`, 'g'),
      (m, anchor: string, sep: string, first: string, restRaw: string, offset: number) => {
        // surowy kod poprzedzony odwołaniem prawnym („poz. 12-345 Rejestr") → nie adres
        if (anchor !== M['KOD-POCZTOWY'] && precededByLegalRef(text, offset)) return m;
        const rest = restRaw.trim() ? restRaw.trim().split(/\s+/) : [];
        // ile kolejnych wyrazów doklejamy: najdłuższe dopasowanie do słownika wielowyrazowego
        let take = 0;
        let combo = first.toLowerCase();
        for (let i = 0; i < rest.length; i++) {
          combo += ' ' + rest[i].toLowerCase();
          if (MULTIWORD_CITIES.has(combo)) take = i + 1;
        }
        bump('MIEJSCOWOSC');
        const leftover = rest.slice(take).join(' ');
        return `${anchor}${sep}${M.MIEJSCOWOSC}${leftover ? ' ' + leftover : ''}`;
      },
    );

    // 12d) MIEJSCOWOŚĆ przed adresem BEZ kodu pocztowego — „Warszawa, ul. …" / „w Poznaniu, [ADRES]".
    // Bez kodu-kotwicy jedynym sygnałem jest bezpośrednio następujący wskaźnik adresu: zamaskowany
    // [ADRES] (krok 12 biegnie wcześniej) albo surowy „ul./al./os./pl.". Żeby NIE ruszyć ogona nazwy
    // instytucji („Zarząd Dróg Miejskich, ul. …"), wymagamy, aby wyraz(y) przed przecinkiem był ZNANĄ
    // miejscowością ze słownika. Słownik działa TYLKO w tej pozycji — „mieszka w Warszawie" (bez
    // „, ul./[ADRES]" obok) nie jest ruszane. Bierzemy NAJDŁUŻSZY pasujący sufiks (do 3 słów:
    // „Zielona Góra", „Nowy Sącz"), a wyrazy przed nim zostawiamy nietknięte.
    const ADR = M.ADRES.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const capCity = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)*`;
    text = text.replace(
      new RegExp(`((?:${capCity}\\s+){0,2}${capCity})(\\s*,?\\s+)(${ADR}|ul\\.|al\\.|os\\.|pl\\.)`, 'g'),
      (m, capRun: string, sep: string, anchor: string) => {
        const words = capRun.split(/\s+/);
        for (let n = Math.min(3, words.length); n >= 1; n--) {
          const cand = words.slice(words.length - n).join(' ').toLowerCase();
          if (POLISH_CITIES.has(cand)) {
            bump('MIEJSCOWOSC');
            const prefix = words.slice(0, words.length - n).join(' ');
            return `${prefix ? prefix + ' ' : ''}${M.MIEJSCOWOSC}${sep}${anchor}`;
          }
        }
        return m;
      },
    );
  }

  // 13) IMIĘ I NAZWISKO — heurystyka:
  //   (a) ZNANE imię ze słownika + następne słowo z wielkiej litery (nazwisko);
  //   (b) wyzwalacz kontekstu („nazywam się", „imię i nazwisko", „Pan/Pani") + 1–2 słowa z wielkiej litery.
  // (a) Zakotwiczamy na imieniu ZE SŁOWNIKA (alternatywa), a NIE na „dwóch słowach z wielkiej litery".
  // Inaczej wyraz z wielkiej przed imieniem („Pracownik Tomasz Lewandowski") jest zżerany jako para
  // „Pracownik Tomasz", a „Tomasz Lewandowski" nigdy się nie dopasowuje.
  if (on('IMIE')) {
    const capWord = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?`;

    // (a) IMIĘ/IMIONA + NAZWISKO — jedno lub dwa imiona (mianownik LUB odmiana) + nazwisko:
    // „Jan Kowalski", „Anną Kowalską", „Monika Ewa Nojszewska", „Prezes Zarządu Jan Kowalski".
    // Kotwiczymy na PIERWSZYM słowie-imieniu w ciągu wyrazów z wielkiej litery: wyrazy przed nim
    // („Pracownik", „Wczoraj") zostają, a całe „imiona+nazwisko" maskujemy JEDNĄ etykietą.
    // To naprawia dwa imiona — wcześniej para zjadała same imiona, a nazwisko zostawało jawne.
    text = text.replace(new RegExp(`\\b${capWord}(?:\\s+${capWord}){1,3}`, 'g'), (m) => {
      const words = m.split(/\s+/);
      let start = 0;
      while (start < words.length && !isFirstNameLike(words[start])) start++;
      if (start >= words.length) return m; // brak imienia w ciągu → zostaw (np. „Sąd Najwyższy")
      let k = start;
      while (k < words.length && isFirstNameLike(words[k]) && !LEGAL_ENTITY_WORDS.has(words[k].toLowerCase())) k++;
      if (k >= words.length) return m; // same imiona, brak nazwiska po nich → zostaw
      const surname = words[k];
      if (LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
      bump('IMIE');
      const prefix = words.slice(0, start).join(' ');
      const rest = words.slice(k + 1).join(' ');
      return [prefix, personMask(surname), rest].filter(Boolean).join(' ');
    });

    // (a3) ODWRÓCONA kolejność „Nazwisko Imię" — częsta w nagłówkach e-maili (To/Cc/From:
    // „Kowalska Ewa", „Ejkszto Anna"). DRUGIE słowo musi być znanym imieniem, pierwsze —
    // nazwiskiem (nie tytuł „Pan/Pani", nie encja prawna/rzeczownik dokumentowy).
    text = text.replace(new RegExp(`\\b(${capWord})\\s+(${capWord})`, 'g'), (m, w1: string, w2: string) => {
      if (!isFirstNameLike(w2)) return m;
      const w1l = w1.toLowerCase();
      if (TITLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2.toLowerCase())) return m;
      bump('IMIE');
      return personMask(w1); // klucz tożsamości = nazwisko (pierwsze słowo)
    });
  }

  // (b) wyzwalacze kontekstu — łapią nazwiska spoza listy imion.
  // UWAGA #1: bez trailing `\b` po wyzwalaczu — „się"/„imię"/„panią" kończą się polską literą (ę/ą),
  // a ASCII `\b` nie stawia granicy po znaku spoza [A-Za-z0-9_]. Separator `[\s:]+` sam ogranicza.
  // UWAGA #2: NIE używamy flagi `i`. Pod `i` klasa [PL_UP] łapie też MAŁE litery, więc grupa
  // „nazwiska" pożerała kolejne małe słowo („Pan Wiśniewski nie" → maskowało także „nie", odwracając
  // sens zdania!). Dlatego wielkość liter wyzwalacza kodujemy jawnie ([Pp]an…), a flaga zostaje samo `g`.
  if (on('IMIE')) {
    // myślnik dozwolony w KAŻDYM członie — „Pan Habdank-Wojewódzki" to jedno nazwisko
    // (bez tego maskowała się połowa, a resztka „-Wojewódzki" zatruwała dalsze warstwy).
    const nameTrigger = new RegExp(
      `\\b([Nn]azywam się|[Mm]am na imię|[Ii]mię i nazwisko|[Ii]mie i nazwisko|[Nn]azwisko:|[Pp]ana|[Pp]anią|[Pp]anu|[Pp]ani|[Pp]an)` +
        `([\\s:]+)([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?(?:\\s+[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)?)`,
      'g',
    );
    text = text.replace(nameTrigger, (m, kw: string, sep: string, name: string) => {
      // nie maskuj, jeśli „nazwa" to encja prawna („Pani Sąd"… praktycznie nie wystąpi, ale chronimy)
      const words = name.split(/\s+/);
      if (LEGAL_ENTITY_WORDS.has(words[0].toLowerCase())) return m;
      bump('IMIE');
      // klucz tożsamości: ostatnie słowo (nazwisko przy „Imię Nazwisko", samo przy pojedynczym)
      return `${kw}${sep}${personMask(words[words.length - 1])}`;
    });
  }

  // (c) SAMODZIELNE nazwisko ze słownika najczęstszych nazwisk (z odmianą):
  // „Sprawę Kowalskiego przekazano…" — bez imienia i bez wyzwalacza. Uruchamiane PO (a)
  // i (b), więc pary/wyzwalacze są już zamaskowane. Słownik zawiera wyłącznie nazwiska
  // jednoznaczne (homonimy typu Wilk/Baran wymagają kontekstu — patrz surnames.ts).
  if (on('IMIE')) {
    text = text.replace(
      new RegExp(`(?<![${PL_UP}${PL_LO}-])[${PL_UP}][${PL_LO}]+(?![${PL_LO}-])`, 'g'),
      (m) => {
        if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
        if (!surnameBase(m)) return m;
        bump('IMIE');
        return personMask(m);
      },
    );
  }

  const found: PiiFinding[] = [...counts.entries()].map(([type, count]) => ({ type, count }));
  return { redacted: text, found };
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
  PESEL: 'PESEL',
  NIP: 'NIP',
  REGON: 'REGON',
  TELEFON: 'numer telefonu',
  DOWOD: 'numer dowodu',
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
