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
    'wojciech zbigniew zdzisław zofia zuzanna'
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
    'krajowy krajowa główny główna społecznych'
  ).split(/\s+/),
);

// Alternatywa „Imię" (z wielkiej litery) ze słownika oraz regex „Imię Nazwisko".
// Zakotwiczenie na ZNANYM imieniu (a nie na dwóch wyrazach z wielkiej) eliminuje błąd, w którym
// wyraz poprzedzający imię (np. „Pracownik Tomasz Lewandowski") rozbijał dopasowanie pary.
const NAMES_ALT = [...POLISH_FIRST_NAMES].map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join('|');
const DICT_NAME_RE = new RegExp(
  `\\b(?:${NAMES_ALT})\\s+([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)`,
  'g',
);

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

  // 8) TELEFON — opcjonalny +48, 9 cyfr (grupowane spacją/myślnikiem lub ciągiem). Nie po „art./poz.".
  if (on('TELEFON')) {
    text = text.replace(
      /(?<![\d])(?:\+?\s?48[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}(?![\d])/g,
      (m, offset: number) => {
        if (precededByLegalRef(text, offset)) return m;
        bump('TELEFON');
        return M.TELEFON;
      },
    );
  }

  // 9) NR DOWODU — 3 litery + 6 cyfr + suma kontrolna (np. „ABA300000", „ABC 123456").
  if (on('DOWOD')) {
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
          `[${PL_UP}][${PL_LO}${PL_UP}.-]*(?:\\s+[${PL_UP}0-9][${PL_LO}${PL_UP}0-9.-]*){0,3}\\s+\\d+[A-Za-z]?(?:\\s*/\\s*\\d+[A-Za-z]?)?`,
        'g',
      ),
      () => {
        bump('ADRES');
        return M.ADRES;
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
    text = text.replace(DICT_NAME_RE, (m, surname: string) => {
      if (LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
      bump('IMIE');
      return personMask(surname);
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
