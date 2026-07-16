import { expect, test } from 'vitest';
import {
  redactPII,
  hasPII,
  isValidPesel,
  isValidNip,
  isValidRegon9,
  isValidRegon14,
  isValidIban,
  isValidDowod,
  isValidCard,
} from './index';

// Buduje POPRAWNY IBAN z kodu kraju + BBAN (liczymy cyfry kontrolne mod 97),
// żeby test nie zależał od zapamiętanego wektora.
function makeIban(country: string, bban: string): string {
  const rearranged = bban + country + '00';
  let remainder = 0;
  for (const ch of rearranged.toUpperCase()) {
    const code = /[A-Z]/.test(ch) ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const c of code) remainder = (remainder * 10 + parseInt(c, 10)) % 97;
  }
  const check = (98 - remainder).toString().padStart(2, '0');
  return country + check + bban;
}

// ── Sumy kontrolne: pozytywne wektory ──
test('PESEL — poprawny wektor', () => {
  expect(isValidPesel('44051401359')).toBe(true);
});
test('PESEL — zła cyfra kontrolna odrzucona', () => {
  expect(isValidPesel('44051401358')).toBe(false);
});
test('NIP — poprawny wektor (z separatorami i bez)', () => {
  expect(isValidNip('1234563218')).toBe(true);
  expect(isValidNip('123-456-32-18')).toBe(true);
});
test('NIP — zła suma odrzucona', () => {
  expect(isValidNip('1234563210')).toBe(false);
});
test('REGON9 — poprawny wektor', () => {
  expect(isValidRegon9('123456785')).toBe(true);
});
test('REGON14 — poprawny wektor', () => {
  expect(isValidRegon14('12345678500010')).toBe(true);
});
test('IBAN — kanoniczny DE i wygenerowany PL', () => {
  expect(isValidIban('DE89370400440532013000')).toBe(true);
  const pl = makeIban('PL', '10901014000007121981287'.padEnd(24, '0').slice(0, 24));
  expect(isValidIban(pl)).toBe(true);
});
test('IBAN — zła suma odrzucona', () => {
  expect(isValidIban('DE89370400440532013001')).toBe(false);
});
test('DOWOD — poprawny wektor ABA300000', () => {
  expect(isValidDowod('ABA300000')).toBe(true);
});
test('DOWOD — zła suma odrzucona', () => {
  expect(isValidDowod('ABA300001')).toBe(false);
});
test('KARTA — poprawne numery testowe (z separatorami)', () => {
  expect(isValidCard('4111 1111 1111 1111')).toBe(true); // Visa 16
  expect(isValidCard('4111-1111-1111-1111')).toBe(true); // Visa z myślnikami
  expect(isValidCard('5555555555554444')).toBe(true); // Mastercard
  expect(isValidCard('378282246310005')).toBe(true); // American Express (15)
});
test('KARTA — zły Luhn / brak prefiksu sieci / zła długość odrzucone', () => {
  expect(isValidCard('4111111111111112')).toBe(false); // prefiks Visa, zły Luhn
  expect(isValidCard('1111222233334444')).toBe(false); // brak prefiksu znanej sieci
  expect(isValidCard('411111111111')).toBe(false); // 12 cyfr — za krótkie
  expect(isValidCard('44051401359')).toBe(false); // PESEL (11 cyfr) to nie karta
});
test('KARTA — redakcja: karta Z KONTEKSTEM maskowana', () => {
  expect(redactPII('Karta: 4111 1111 1111 1111.').redacted).toBe('Karta: [NR-KARTY].');
  expect(redactPII('Zapłata kartą 5555-5555-5555-4444 OK').redacted).toBe('Zapłata kartą [NR-KARTY] OK');
  expect(redactPII('nr karty 378282246310005 na fakturze').redacted).toBe('nr karty [NR-KARTY] na fakturze');
});
test('KARTA — BEZ kontekstu karty nie maskuje (precyzja > nadmaskowanie)', () => {
  // IMEI (15 cyfr, ma sumę Luhna, prefiks 35 = zakres JCB) BEZ kontekstu karty — zostaje
  expect(redactPII('IMEI telefonu: 353281112345672').redacted).toBe('IMEI telefonu: 353281112345672');
  // EAN-13 z prefiksem 54 (Mastercard) — kod kreskowy, nie karta
  expect(redactPII('Kod kreskowy EAN 5449000000996').redacted).toBe('Kod kreskowy EAN 5449000000996');
  // 16 cyfr bez prefiksu znanej sieci — nie karta
  expect(redactPII('Zamówienie 1111222233334444 gotowe').redacted).toBe('Zamówienie 1111222233334444 gotowe');
  // po odwołaniu prawnym, bez kontekstu karty — zostaje
  expect(redactPII('zgodnie z art. 4111 1111 1111 1111').redacted).toBe('zgodnie z art. 4111 1111 1111 1111');
});
test('KARTA — nie koliduje z PESEL/NIP/REGON/IBAN', () => {
  expect(redactPII('PESEL 44051401359').redacted).toBe('PESEL [PESEL]');
  expect(redactPII('REGON 123456785').redacted).toBe('REGON [REGON]');
  expect(redactPII('NIP 1234563218').redacted).toBe('NIP [NIP]');
});

// ── Redakcja: maskuje realne PII ──
test('redactPII — PESEL maskowany', () => {
  const r = redactPII('Mój PESEL to 44051401359, proszę o pomoc');
  expect(r.redacted.includes('44051401359')).toBe(false);
  expect(r.redacted).toContain('[PESEL]');
});
test('redactPII — NIP z separatorami maskowany', () => {
  const r = redactPII('Firma NIP 123-456-32-18 zalega');
  expect(r.redacted).toContain('[NIP]');
  expect(/123-456-32-18/.test(r.redacted)).toBe(false);
});
test('redactPII — NIP ze SPACJAMI maskowany (526 27 35 917)', () => {
  const r = redactPII('NIP: 526 27 35 917');
  expect(r.redacted).toContain('[NIP]');
  expect(r.redacted.includes('526 27 35 917')).toBe(false);
  // ten sam numer w grupowaniu 3-3-2-2 spacjami
  expect(redactPII('NIP 526 273 59 17').redacted).toContain('[NIP]');
});
test('redactPII — e-mail i telefon maskowane', () => {
  const r = redactPII('Pisz na jan.kowalski@example.com lub dzwoń +48 600 700 800');
  expect(r.redacted).toContain('[EMAIL]');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('600 700 800')).toBe(false);
});
test('redactPII — IBAN maskowany', () => {
  const iban = makeIban('PL', '109010140000071219812870'.slice(0, 24));
  const r = redactPII(`Przelej na konto ${iban}`);
  expect(r.redacted).toContain('[NR-KONTA]');
});
test('redactPII — adres maskowany', () => {
  const r = redactPII('Mieszkam przy ul. Marszałkowska 10/5 w Warszawie');
  expect(r.redacted).toContain('[ADRES]');
  expect(/Marszałkowska 10/.test(r.redacted)).toBe(false);
});
test('redactPII — imię i nazwisko (słownikowe) maskowane', () => {
  const r = redactPII('Sprawę prowadzi Jan Kowalski od marca');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('redactPII — imię+nazwisko po wyrazie z wielkiej litery (Pracownik Tomasz Lewandowski)', () => {
  // Regresja: detektor par zżerał „Pracownik Tomasz" i gubił „Tomasz Lewandowski".
  const r = redactPII('Pracownik Tomasz Lewandowski, PESEL 90010112349');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Tomasz Lewandowski')).toBe(false);
  expect(r.redacted).toContain('Pracownik');
  expect(r.redacted).toContain('[PESEL]');
});
test('redactPII — nazwisko po wyzwalaczu kontekstu maskowane', () => {
  const r = redactPII('Nazywam się Brzęczyszczykiewicz Grzegorz');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('redactPII — wyzwalacz NIE pożera kolejnego małego słowa (zachowuje sens zdania)', () => {
  // Regresja: pod flagą /i klasa [PL_UP] łapała małe litery, więc „Pan Wiśniewski nie" maskowało
  // też „nie" → „zapłacił" zamiast „nie zapłacił". „nie" MUSI zostać.
  const r = redactPII('Pan Wiśniewski nie zapłacił czynszu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Wiśniewski')).toBe(false);
  expect(r.redacted).toContain('nie zapłacił');
});

// ── Wielkość liter w imionach/nazwiskach (v0.29.6): łapiemy nietypowy zapis w KONTEKŚCIE ──
test('casing — self-ID łapie imię/nazwisko niezależnie od wielkości liter', () => {
  for (const s of [
    'nazywam się pAMELA nOWAK',   // mieszana
    'Nazywam się PAMELA NOWAK',   // WERSALIKI
    'nazywam się pamela nowak',   // małe litery
    'mam na imię PAMELA',         // pojedyncze imię WERSALIKAMI
    'mam na imię pAMELA',         // pojedyncze imię mieszaną
  ]) {
    expect(redactPII(s).redacted, s).toContain('[IMIĘ I NAZWISKO]');
  }
});
test('casing — pole formularza / klucz JSON łapie wartość małą literą', () => {
  expect(redactPII('Imię: pamela').redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(redactPII('Nazwisko: nowak').redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(redactPII('{"firstName":"pamela","lastName":"nowak"}').redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('casing — para imię+nazwisko WERSALIKAMI i małymi literami maskowana', () => {
  expect(redactPII('PAMELA NOWAK złożyła wniosek').redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(redactPII('pisała do nas pamela nowak w tej sprawie').redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('casing — precyzja: „Pan/Pani" + czasownik NIE jest maskowane', () => {
  for (const s of ['Pan był wczoraj w urzędzie', 'Pani ma rację', 'Pana prawa są chronione']) {
    expect(redactPII(s).redacted, s).toBe(s);
  }
});
test('casing — precyzja: „nazywam się" bez nazwy własnej ani słownika zostaje', () => {
  const s = 'nazywam się tak, jak trzeba';
  expect(redactPII(s).redacted).toBe(s);
});
test('casing — precyzja: nagłówki WERSALIKAMI i homonimy małą literą zostają', () => {
  expect(redactPII('USTAWA O OCHRONIE DANYCH').redacted).toBe('USTAWA O OCHRONIE DANYCH');
  expect(redactPII('SĄD OKRĘGOWY W WARSZAWIE').redacted).toBe('SĄD OKRĘGOWY W WARSZAWIE');
  expect(redactPII('to jest jagoda i kalina').redacted).toBe('to jest jagoda i kalina');
});

// ── Tytuł/rola + imię/nazwisko WERSALIKAMI (v0.29.7): „SSO JAN KOWALSKI", „PANEM …", „PAN KOWALSKI" ──
test('all-caps: tytuł/rola WERSALIKAMI + nazwisko maskowane (tytuł zostaje)', () => {
  for (const s of [
    'SSO JAN KOWALSKI',
    'z PANEM MARKIEM WIŚNIEWSKIM',
    'PAN KOWALSKI',
    'POZWANY JAN KOWALSKI',
    'ŚWIADEK ANNA NOWAK',
    'SĘDZIA TRZEBIATOWSKI',
  ]) {
    expect(redactPII(s).redacted, s).toContain('[IMIĘ I NAZWISKO]');
  }
  // tytuł/rola nie znika (sens wiersza zachowany)
  expect(redactPII('SSO JAN KOWALSKI').redacted).toContain('SSO');
  expect(redactPII('PAN KOWALSKI').redacted).toContain('PAN');
});
test('all-caps: precyzja — nagłówki instytucji WERSALIKAMI NIE są maskowane', () => {
  for (const s of [
    'SĄD OKRĘGOWY W WARSZAWIE',
    'NACZELNY SĄD ADMINISTRACYJNY',
    'MINISTERSTWO SPRAWIEDLIWOŚCI',
    'UNIWERSYTET WARSZAWSKI',
    'WOJEWODA MAZOWIECKI',
    'SĘDZIA SĄDU REJONOWEGO',
    'PREZES ZARZĄDU SPÓŁKI',
    'NARODOWY BANK POLSKI',
  ]) {
    expect(redactPII(s).redacted, s).toBe(s);
  }
});
test('redactPII — kod pocztowy i dowód maskowane', () => {
  const r = redactPII('Adres 00-950, dowód ABA300000');
  expect(r.redacted).toContain('[KOD-POCZTOWY]');
  expect(r.redacted).toContain('[NR-DOWODU]');
});

// ── Brak fałszywych trafień na treści prawnej/urzędowej ──
test('redactPII — numer artykułu NIE jest telefonem', () => {
  const r = redactPII('Zgodnie z art. 123 456 789 kodeksu — to numer przepisu');
  expect(r.redacted.includes('[TELEFON]')).toBe(false);
});
test('redactPII — encja prawna NIE jest nazwiskiem', () => {
  const r = redactPII('Sąd Najwyższy oraz Kodeks Cywilny i Prawo Pracy');
  expect(r.redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
});
test('redactPII — losowe 10 cyfr bez poprawnej sumy NIP zostaje', () => {
  // 1234567890 ma sumę kontrolną NIP == 10 (nieważny) → NIE maskujemy.
  const r = redactPII('Sygnatura 1234567890 w aktach');
  expect(r.redacted.includes('[NIP]')).toBe(false);
});
test('redactPII — zwykłe pytanie bez PII nietknięte', () => {
  const q = 'Czy pracodawca może odmówić urlopu na żądanie zgodnie z art. 167 KP?';
  const r = redactPII(q);
  expect(r.redacted).toBe(q);
  expect(r.found.length).toBe(0);
});

// ── Idempotencja ──
test('redactPII — idempotentny (drugi przebieg nic nie zmienia)', () => {
  const once = redactPII('PESEL 44051401359, mail x@y.pl, Jan Kowalski').redacted;
  const twice = redactPII(once).redacted;
  expect(twice).toBe(once);
});

test('hasPII — wykrywa i nie myli się na czystym tekście', () => {
  expect(hasPII('mój nip 1234563218')).toBe(true);
  expect(hasPII('jakie są zasady rozwodu?')).toBe(false);
});

// ── Telefon: numery stacjonarne z prefiksem +48 (bug z pism urzędowych) ──
test('telefon stacjonarny +48 22 245 59 22 (podział 2-3-2-2) maskowany', () => {
  const r = redactPII('telefon: +48 22 245 59 22');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('245 59 22')).toBe(false);
});
test('telefon stacjonarny +48 bez dwukropka maskowany', () => {
  const r = redactPII('telefon +48 22 245 59 22 w godzinach pracy');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('22 245 59 22')).toBe(false);
});
test('telefon ze słowem kontekstowym bez +48 (tel. 22 245 59 22)', () => {
  const r = redactPII('tel. 22 245 59 22');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted).toContain('tel.');
  expect(r.redacted.includes('245 59 22')).toBe(false);
});
test('telefon komórkowy +48 600 700 800 nadal maskowany (regresja)', () => {
  const r = redactPII('dzwoń +48 600 700 800');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('600 700 800')).toBe(false);
});
test('numer artykułu z +48 w pobliżu NIE psuje strażnika przepisów', () => {
  const r = redactPII('zgodnie z art. 123 456 789 kodeksu');
  expect(r.redacted.includes('[TELEFON]')).toBe(false);
});

// ── Nr dowodu osobistego: wykrywanie kontekstowe ──
test('dowód osobisty z kontekstem maskowany nawet bez sumy kontrolnej', () => {
  const r = redactPII('Dowód osobisty ABC 123456 wydany w 2020');
  expect(r.redacted).toContain('[NR-DOWODU]');
  expect(r.redacted.includes('ABC 123456')).toBe(false);
  expect(r.redacted).toContain('Dowód osobisty');
});
test('seria i numer dowodu maskowane', () => {
  const r = redactPII('seria i numer: AGH987654');
  expect(r.redacted).toContain('[NR-DOWODU]');
});
test('dowód zakupu (nie ID) NIE jest maskowany jako dowód osobisty', () => {
  const r = redactPII('dowód zakupu nr 445566 w załączniku');
  expect(r.redacted.includes('[NR-DOWODU]')).toBe(false);
});
test('numer dowodu STANDALONE z POPRAWNĄ sumą maskowany bez kontekstu', () => {
  expect(redactPII('ABA300000').redacted).toBe('[NR-DOWODU]');
  expect(redactPII('ABA 300000').redacted).toBe('[NR-DOWODU]');
});
test('dowód-format bez kontekstu ze ZŁĄ sumą NIE jest maskowany (sygnatury/kody urzędowe)', () => {
  // „ABC 123456" ma złą sumę kontrolną → jak sygnatura/kod zostaje (precyzja)
  expect(redactPII('ABC 123456').redacted.includes('[NR-DOWODU]')).toBe(false);
  expect(redactPII('Sygn. RPO 401234 w aktach').redacted.includes('[NR-DOWODU]')).toBe(false);
});
test('dowód osobisty z wtrąconym „nr" maskowany', () => {
  const r = redactPII('dowód osobisty nr ABC123456');
  expect(r.redacted).toContain('[NR-DOWODU]');
  expect(r.redacted.includes('ABC123456')).toBe(false);
});
test('numer paszportu z kontekstem maskowany (2 litery + 7 cyfr)', () => {
  const r = redactPII('Paszport nr ZS 1234567 wydano w 2020 r.');
  expect(r.redacted).toContain('[NR-PASZPORTU]');
  expect(r.redacted.includes('ZS 1234567')).toBe(false);
});
test('2 litery + 7 cyfr BEZ kontekstu paszportu NIE są maskowane', () => {
  expect(redactPII('Kod AB1234567 systemu').redacted.includes('[NR-PASZPORTU]')).toBe(false);
});
test('numer KRS maskowany (kontekst „KRS" + 10 cyfr, zera wiodące)', () => {
  const r = redactPII('Spółka wpisana pod nr KRS 0000173413 w rejestrze.');
  expect(r.redacted).toContain('[KRS]');
  expect(r.redacted.includes('0000173413')).toBe(false);
  expect(redactPII('KRS: 0000173413').redacted).toContain('[KRS]');
});
test('znak sprawy/pisma (JRWA) maskowany strukturalnie — różne warianty symbolu', () => {
  for (const znak of ['DPR-II.054.3.2026', 'DNW-1.054.1.2024', 'ZP.271.12.2026', 'DC.WAC.5555.30.2026', 'ABC-def.123.77.2016']) {
    const r = redactPII(`Znak pisma: ${znak}`);
    expect(r.redacted).toContain('[ZNAK-SPRAWY]');
    expect(r.redacted.includes(znak)).toBe(false);
  }
  // w środku zdania, bez etykiety
  expect(redactPII('W nawiązaniu do DPR-II.054.3.2026 informujemy...').redacted).toContain('[ZNAK-SPRAWY]');
});
test('sygnatura akt sądowych maskowana z kontekstem', () => {
  const r = redactPII('Sygn. akt II CSK 234/19 w sprawie...');
  expect(r.redacted).toContain('[ZNAK-SPRAWY]');
  expect(r.redacted.includes('234/19')).toBe(false);
});
test('znak sprawy NIE nadmaskowuje dat, odwołań prawnych ani prozy', () => {
  expect(redactPII('Spotkanie odbyło się 12.05.2024 o poranku.').redacted).toBe('Spotkanie odbyło się 12.05.2024 o poranku.');
  expect(redactPII('Zgodnie z art. 5 ust. 1 pkt 3 ustawy.').redacted).toBe('Zgodnie z art. 5 ust. 1 pkt 3 ustawy.');
  expect(redactPII('Rozdział 5.2 opisuje procedurę.').redacted).toBe('Rozdział 5.2 opisuje procedurę.');
  expect(redactPII('Zamieszczono znak drogowy B-2 przy wjeździe.').redacted).toBe('Zamieszczono znak drogowy B-2 przy wjeździe.');
});
test('data urodzenia słowna („ur. 5 maja 1985") maskowana; bez kontekstu nie', () => {
  expect(redactPII('ur. 5 maja 1985 r.').redacted).toContain('[DATA-URODZENIA]');
  expect(redactPII('urodzony 12 grudnia 1970').redacted).toContain('[DATA-URODZENIA]');
  expect(redactPII('W maju 1985 odbyło się spotkanie.').redacted).toBe('W maju 1985 odbyło się spotkanie.');
});

test('pola formularza (etykieta → wartość w następnej linii, WERSALIKI) są maskowane', () => {
  const form =
    '11. Nazwisko\nWILCZYŃSKI\n12. Pierwsze imię\nKAROL\n' +
    '13. Data urodzenia (dzień – miesiąc – rok)\n1994-07-08\n' +
    '18. Ulica\nBŁĘKITNA\n19. Nr domu\n53.0\n21. Miejscowość\nWARSZAWA';
  const out = redactPII(form).redacted;
  expect(out.includes('WILCZYŃSKI')).toBe(false);
  expect(out.includes('KAROL')).toBe(false);
  expect(out.includes('1994-07-08')).toBe(false);
  expect(out.includes('BŁĘKITNA')).toBe(false);
  expect(out.includes('53.0')).toBe(false);
  expect(out).toContain('[IMIĘ I NAZWISKO]');
  expect(out).toContain('[DATA-URODZENIA]');
  expect(out).toContain('[ADRES]');
});

test('pola formularza: administracyjne (kraj/województwo/powiat/gmina) NIE są maskowane', () => {
  const out = redactPII('14. Kraj\nPOLSKA\n15. Województwo\nMAZOWIECKIE\n16. Powiat\nWARSZAWA').redacted;
  expect(out).toContain('POLSKA');
  expect(out).toContain('MAZOWIECKIE');
});

test('pola formularza: same-line z dwukropkiem i puste pole', () => {
  expect(redactPII('Nazwisko: Kowalski').redacted).toContain('[IMIĘ I NAZWISKO]');
  // pole puste („Nr lokalu") — następna linia to kolejna etykieta, nie maskujemy jej
  const out = redactPII('20. Nr lokalu\n21. Miejscowość\nWARSZAWA').redacted;
  expect(out).toContain('21. Miejscowość');
  expect(out.includes('WARSZAWA')).toBe(false);
});

test('precyzja pól formularza: proza z „Ulica"/„Nazwisko" NIE jest nadmaskowana', () => {
  expect(redactPII('Ulica była zamknięta z powodu remontu.').redacted).toBe(
    'Ulica była zamknięta z powodu remontu.',
  );
  // adnotacja przy dacie zachowana
  expect(redactPII('Data urodzenia: 1990-01-01 (wg aktu).').redacted).toBe(
    'Data urodzenia: [DATA-URODZENIA] (wg aktu).',
  );
});

// ── Precyzja po audycie wieloagentowym (nadmaskowanie prozy/układu) ──
test('nagłówek pola nad prozą NIE zjada zdania', () => {
  expect(redactPII('Ulica\nDroga publiczna wraz z chodnikami.').redacted).toBe(
    'Ulica\nDroga publiczna wraz z chodnikami.',
  );
  expect(redactPII('Imię i nazwisko wnioskodawcy wpisujemy w polu 1.\nDane niżej.').redacted).toBe(
    'Imię i nazwisko wnioskodawcy wpisujemy w polu 1.\nDane niżej.',
  );
});

test('puste pole formularza NIE przejmuje następnej etykiety/nagłówka', () => {
  expect(redactPII('Nazwisko:\nRozpoznanie\nastma').redacted).toBe('Nazwisko:\nRozpoznanie\nastma');
  expect(redactPII('Miejsce urodzenia:\nOddział Kardiologiczny').redacted).toBe(
    'Miejsce urodzenia:\nOddział Kardiologiczny',
  );
});

test('nazwisko na końcu wiersza NIE skleja się z następną linią', () => {
  expect(redactPII('dr Anna Nowak\nOddział: kardiologia').redacted).toBe(
    'dr [IMIĘ I NAZWISKO]\nOddział: kardiologia',
  );
});

test('para „rzeczownik/rola + nazwisko" zostawia rzeczownik, maskuje nazwisko', () => {
  expect(redactPII('Pracownik Kowalski otrzymał premię.').redacted).toBe(
    'Pracownik [IMIĘ I NAZWISKO] otrzymał premię.',
  );
  expect(redactPII('Zakład Usługowy Kowalski').redacted).toBe('Zakład Usługowy [IMIĘ I NAZWISKO]');
  // rzadkie imię + nazwisko nadal maskowane w całości (recall zachowany)
  expect(redactPII('Świętomira Gzowska').redacted).toBe('[IMIĘ I NAZWISKO]');
});

test('eponimy medyczne i nazwy ulic (sufiks -ski) NIE są maskowane jako osoby', () => {
  expect(redactPII('Zdiagnozowano chorobę Leśniowskiego-Crohna.').redacted).toBe(
    'Zdiagnozowano chorobę Leśniowskiego-Crohna.',
  );
  expect(redactPII('Dodatni objaw Babińskiego.').redacted).toBe('Dodatni objaw Babińskiego.');
  expect(redactPII('Mieszka przy ulica Puławska.').redacted).toBe('Mieszka przy ulica Puławska.');
  // kontrola: prawdziwe nazwisko w odmianie nadal łapane
  expect(redactPII('sprawę Gzowskiego przekazano').redacted).toContain('[IMIĘ I NAZWISKO]');
});

test('instytucjonalne przymiotniki (-ski) NIE są maskowane', () => {
  expect(redactPII('Zleceniodawca: Ogólnopolski Związek Pracodawców').redacted).toContain(
    'Ogólnopolski Związek',
  );
  expect(redactPII('ukończył Uniwersytet Jagielloński').redacted).toBe('ukończył Uniwersytet Jagielloński');
});
test('kod waluty + kwota NIE jest mylony z dowodem', () => {
  expect(redactPII('PLN 123456').redacted.includes('[NR-DOWODU]')).toBe(false);
  expect(redactPII('EUR 250000').redacted.includes('[NR-DOWODU]')).toBe(false);
});
test('małe litery + 6 cyfr bez sumy kontrolnej NIE są maskowane', () => {
  // „abc123456" (małe) bez poprawnej sumy → zostaje (mniej fałszywych trafień).
  expect(redactPII('kod abc123456 systemu').redacted.includes('[NR-DOWODU]')).toBe(false);
});

// ── Imiona w ODMIANIE (nie tylko mianownik) ──
test('imię w narzędniku + nazwisko (Anną Kowalską) maskowane w całości', () => {
  const r = redactPII('Anną Kowalską, zwaną dalej');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Anną')).toBe(false);
});
test('imię męskie w narzędniku (Janem Kowalskim) maskowane', () => {
  expect(redactPII('podpisano z Janem Nowakiem').redacted.includes('Janem')).toBe(false);
});
test('imię w bierniku (Annę Wiśniewską) maskowane', () => {
  const r = redactPII('reprezentowaną przez Annę Wiśniewską');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Annę')).toBe(false);
});
test('encje prawne z dwóch słów NIE są maskowane jako imię w odmianie', () => {
  for (const t of ['Sąd Najwyższy', 'Kodeks Cywilny', 'Ministerstwo Cyfryzacji', 'Nowy Rok']) {
    expect(redactPII(t).redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
  }
});
test('miasto po przyimku NIE jest maskowane (zamieszkała w Warszawie)', () => {
  expect(redactPII('zamieszkałą w Warszawie przy ulicy').redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
});

// ── Adres bez prefiksu „ul.", rozpoznany po sąsiedztwie kodu pocztowego ──
test('ulica bez „ul." przed kodem pocztowym maskowana (Królewska 27)', () => {
  const r = redactPII('Królewska 27, 00-060 Warszawa');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted).toContain('[KOD-POCZTOWY]');
  expect(r.redacted.includes('Królewska 27')).toBe(false);
});
test('wielowyrazowa ulica bez prefiksu (Aleje Jerozolimskie 100)', () => {
  const r = redactPII('Aleje Jerozolimskie 100, 00-807 Warszawa');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Jerozolimskie')).toBe(false);
});
test('„Rozdział 5"/„Załącznik 2" NIE są adresem (brak kodu pocztowego obok)', () => {
  expect(redactPII('Rozdział 5, zgodnie z ustawą').redacted.includes('[ADRES]')).toBe(false);
  expect(redactPII('Załącznik 2 do pisma').redacted.includes('[ADRES]')).toBe(false);
});

// ── Ulica zaczynająca się od liczby lub skrótu rangi/tytułu ──
test('ulica z liczbą w nazwie („ul. 3 Maja 1")', () => {
  const r = redactPII('mieszka przy ul. 3 Maja 1');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('3 Maja')).toBe(false);
});
test('ulica z liczbą dwucyfrową („ul. 11 Listopada 5/3")', () => {
  const r = redactPII('ul. 11 Listopada 5/3');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Listopada')).toBe(false);
});
test('aleja z liczbą („al. 3 Maja 12")', () => {
  const r = redactPII('al. 3 Maja 12');
  expect(r.redacted).toContain('[ADRES]');
});
test('ulica ze skrótem rangi („ul. gen. Andersa 5")', () => {
  const r = redactPII('ul. gen. Andersa 5');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Andersa')).toBe(false);
});
test('ulica ze skrótem „ks." („ul. ks. Popiełuszki 3")', () => {
  const r = redactPII('ul. ks. Popiełuszki 3');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Popiełuszki')).toBe(false);
});
test('zwykła ulica nadal działa (regresja)', () => {
  const r = redactPII('ul. Marszałkowska 10/5');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Marszałkowska')).toBe(false);
});

// ── MIEJSCOWOŚĆ — miasto po kodzie pocztowym (kotwica = kod), nie w tekście ──
test('miasto po kodzie pocztowym maskowane (Warszawa)', () => {
  const r = redactPII('Królewska 27, 00-060 Warszawa');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Warszawa')).toBe(false);
  // pełny adres schodzi do trzech kotwic, nic nie wycieka
  expect(r.redacted).toBe('[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]');
});
test('miasto po kodzie z prefiksem „ul." (Kraków)', () => {
  const r = redactPII('ul. Floriańska 3, 31-000 Kraków');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Kraków')).toBe(false);
});
test('miasto WIELOWYRAZOWE po kodzie (Nowy Sącz) — oba człony', () => {
  const r = redactPII('Zamieszkały: 33-300 Nowy Sącz, ul. Długa 5');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Nowy')).toBe(false);
  expect(r.redacted.includes('Sącz')).toBe(false);
});
test('miasto z myślnikiem po kodzie (Bielsko-Biała) — jeden token', () => {
  const r = redactPII('adres: 43-300 Bielsko-Biała');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Bielsko')).toBe(false);
});
test('zdanie po miejscowości NIE jest pożerane (kropka granicą)', () => {
  const r = redactPII('Nadano w 00-950 Warszawa. Sprawę rozpatrzył sąd.');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted).toContain('Sprawę rozpatrzył sąd');
});
test('drugi wyraz spoza słownika NIE jest doklejany (Warszawa Zarząd)', () => {
  const r = redactPII('00-950 Warszawa Zarząd Dróg Miejskich');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted).toContain('Zarząd Dróg Miejskich');
});
test('miasto: marker zamieszkania maskuje, zwykły czasownik/proza nie', () => {
  // „mieszka w" to marker zamieszkania → miasto maskowane; „pracuje w" to nie marker → zostaje
  expect(redactPII('Powód mieszka w Warszawie i pracuje w Krakowie').redacted).toBe(
    'Powód mieszka w [MIEJSCOWOŚĆ] i pracuje w Krakowie',
  );
  // czysta proza / instytucja → NIE maskujemy (precyzja)
  expect(redactPII('Spotkanie odbędzie się w Łodzi.').redacted).toBe('Spotkanie odbędzie się w Łodzi.');
  expect(redactPII('Sąd Okręgowy w Katowicach').redacted).toBe('Sąd Okręgowy w Katowicach');
});
test('miasto w kontekście adresu/zamieszkania jest maskowane', () => {
  // po zamaskowanym adresie bez kodu: „[ADRES], Warszawa"
  expect(redactPII('ul. Kwiatowa 5, Warszawa').redacted).toBe('[ADRES], [MIEJSCOWOŚĆ]');
  // markery zamieszkania
  expect(redactPII('zamieszkały w Krakowie przy ul. Długiej').redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(redactPII('mieszka w Sopocie od 2010 roku').redacted).toBe('mieszka w [MIEJSCOWOŚĆ] od 2010 roku');
  expect(redactPII('zam. w Rzeszowie').redacted).toBe('zam. w [MIEJSCOWOŚĆ]');
  expect(redactPII('miejsce zamieszkania: Białystok').redacted).toBe('miejsce zamieszkania: [MIEJSCOWOŚĆ]');
  // kraj/region i lokal NIE są miastem po markerze
  expect(redactPII('zamieszkały w Polsce').redacted).toBe('zamieszkały w Polsce');
});
test('marker zamieszkania NIE maskuje instytucji ani ulicy (bramka słownikowa)', () => {
  // słowo po markerze, które NIE jest znanym miastem → zostaje (instytucja/placówka/ulica)
  expect(redactPII('Interesant mieszka w Sądzie Rejonowym').redacted).toBe('Interesant mieszka w Sądzie Rejonowym');
  expect(redactPII('zamieszkały w Areszcie Śledczym').redacted).toBe('zamieszkały w Areszcie Śledczym');
  expect(redactPII('zamieszkały w Zakładzie Karnym').redacted).toBe('zamieszkały w Zakładzie Karnym');
  // ulica po markerze — nie miasto; adres zdejmie krok ADRES, tu bez korupcji „[MIEJSCOWOŚĆ]c"
  expect(redactPII('Zameldowany: Plac Wolności 2').redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  // miasto wielowyrazowe po markerze
  expect(redactPII('zamieszkały w Zielonej Górze').redacted).toContain('[MIEJSCOWOŚĆ]');
});
test('nazwa sądu z miastem NIE jest ruszana (Warszawy-Śródmieścia)', () => {
  const t = 'Sąd Rejonowy dla Warszawy-Śródmieścia rozpatrzył sprawę';
  expect(redactPII(t).redacted).toBe(t);
});
test('MIEJSCOWOŚĆ ma osobny przełącznik (wyłączona ⇒ miasto zostaje)', () => {
  const r = redactPII('00-060 Warszawa', { types: ['KOD-POCZTOWY'] });
  expect(r.redacted).toContain('[KOD-POCZTOWY]');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  expect(r.redacted).toContain('Warszawa');
});
test('miejscowość — idempotencja (drugi przebieg nic nie psuje)', () => {
  const once = redactPII('Królewska 27, 00-060 Warszawa').redacted;
  expect(redactPII(once).redacted).toBe(once);
});

// ── MIEJSCOWOŚĆ przed adresem BEZ kodu (słownik miast, tylko w pozycji „…, ul.") ──
test('miasto przed adresem bez kodu (Warszawa, ul. …)', () => {
  const r = redactPII('Warszawa, ul. Królewska 27');
  expect(r.redacted).toBe('[MIEJSCOWOŚĆ], [ADRES]');
});
test('miasto WIELOWYRAZOWE przed adresem bez kodu (Zielona Góra, ul. …)', () => {
  const r = redactPII('Zielona Góra, ul. Długa 5');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Zielona')).toBe(false);
  expect(r.redacted.includes('Góra')).toBe(false);
});
test('forma zależna miasta przed adresem (w Poznaniu, ul. …)', () => {
  const r = redactPII('Sąd Okręgowy w Poznaniu, ul. Hejmowskiego 2');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Poznaniu')).toBe(false);
  // nazwa sądu (przed „w") zostaje nietknięta
  expect(r.redacted).toContain('Sąd Okręgowy w');
});
test('miasto z myślnikiem przed adresem (Kędzierzyn-Koźle, ul. …)', () => {
  const r = redactPII('Kędzierzyn-Koźle, ul. Rynek 2');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Kędzierzyn')).toBe(false);
});
test('ogon nazwy instytucji przed adresem NIE jest miastem (Zarząd Dróg Miejskich, ul. …)', () => {
  const r = redactPII('Zarząd Dróg Miejskich, ul. Chmielna 5');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  expect(r.redacted).toContain('Zarząd Dróg Miejskich');
});
test('słownik miast NIE działa w wolnym tekście (bez „, ul./[ADRES]")', () => {
  const r = redactPII('Sprawa dotyczy Warszawy oraz Krakowa i Poznania');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
});
test('miasto przed adresem — idempotencja', () => {
  const once = redactPII('Warszawa, ul. Królewska 27').redacted;
  expect(redactPII(once).redacted).toBe(once);
});
test('miasto przed adresem respektuje przełącznik MIEJSCOWOŚĆ', () => {
  const r = redactPII('Warszawa, ul. Długa 5', { types: ['ADRES'] });
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  expect(r.redacted).toContain('Warszawa');
});

// ── Odwrócona kolejność „Nazwisko Imię" (nagłówki e-maili Outlook) ──
test('„Nazwisko Imię" (Kowalska Ewa) maskowane w całości', () => {
  const r = redactPII('Kowalska Ewa');
  expect(r.redacted).toBe('[IMIĘ I NAZWISKO]');
});
test('nieznane nazwisko + znane imię (Ejkszto Anna) maskowane', () => {
  const r = redactPII('From: Ejkszto Anna');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Ejkszto')).toBe(false);
  expect(r.redacted.includes('Anna')).toBe(false);
});
test('encje prawne w kolejności odwróconej NIE są maskowane', () => {
  for (const t of ['Sąd Najwyższy', 'Kodeks Cywilny', 'Ministerstwo Cyfryzacji', 'Umowa najmu']) {
    expect(redactPII(t).redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
  }
});
test('„Pani Anna" zachowuje tytuł, maskuje imię', () => {
  const r = redactPII('Pani Anna');
  expect(r.redacted).toContain('Pani');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});

// ── DWA imiona + nazwisko (nazwisko nie może zostać jawne) ──
test('dwa imiona w odmianie + nazwisko (Moniką Ewą Nojszewską) — jedna maska', () => {
  const r = redactPII('Moniką Ewą Nojszewską, zwaną dalej');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Nojszewską')).toBe(false);
  expect(r.redacted.includes('Ewą')).toBe(false);
  expect((r.redacted.match(/\[IMIĘ I NAZWISKO\]/g) ?? []).length).toBe(1);
});
test('dwa imiona (mianownik) + nazwisko — nazwisko zamaskowane', () => {
  expect(redactPII('Jan Maria Rokita').redacted.includes('Rokita')).toBe(false);
  expect(redactPII('Monika Ewa Nojszewska').redacted.includes('Nojszewska')).toBe(false);
});
test('wyraz przed imieniem zostaje, para imię+nazwisko maskowana', () => {
  expect(redactPII('Wczoraj Jan Kowalski przyszedł').redacted).toBe('Wczoraj [IMIĘ I NAZWISKO] przyszedł');
});

// ── Anty-nadmaskowanie: realny tekst urzędowy/nazwy własne NIE mogą być ruszane ──
// (blokada regresji dla agresywnych reguł imion/dowodów — nadmaskowanie niszczy sens pisma)
test('instytucje, programy i nazwy własne pozostają nietknięte', () => {
  const clean = [
    'Zgodnie z art. 123 ust. 2 ustawy o finansach publicznych.',
    'Ministerstwo Cyfryzacji oraz Biuro Budżetowo-Finansowe.',
    'Program Operacyjny Polska Cyfrowa',
    'Prezydent Rzeczypospolitej Polskiej',
    'Bank Gospodarstwa Krajowego',
    'Główny Urząd Statystyczny',
    'Krajowy Plan Odbudowy',
    'Sąd Rejonowy dla Warszawy-Śródmieścia',
    'Narodowy Bank Polski',
    'Nowy Rok obchodzony jest pierwszego stycznia.',
    'Faktura VAT numer 445566 z tytułu usług.',
    'Kwota 250000 PLN zostanie przekazana.',
    'Polski Ład',
    'Adam poszedł do sklepu',
  ];
  for (const t of clean) expect(redactPII(t).redacted).toBe(t);
});

// ── Samodzielne nazwiska ze słownika (krok 13c) ──
test('nazwisko solo w odmianie — dopełniacz maskowany', () => {
  const r = redactPII('Sprawę Kowalskiego przekazano do sądu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Kowalskiego')).toBe(false);
});
test('nazwisko solo — forma żeńska -ska maskowana', () => {
  const r = redactPII('Zeznanie złożyła Wiśniewska w czwartek');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('nazwisko solo — celownik rzeczownikowy (Nowakowi)', () => {
  const r = redactPII('Nowakowi doręczono wezwanie');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Nowakowi')).toBe(false);
});
test('nazwisko solo — liczba mnoga (Kowalscy)', () => {
  const r = redactPII('Kowalscy odwołali się od decyzji');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('homonim solo NIE jest maskowany (Wilk, Mazurek)', () => {
  const r = redactPII('Wilk biegał po lesie, a Mazurek wielkanocny był pyszny');
  expect(r.redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
});
test('homonim Z imieniem nadal maskowany (Jan Wilk)', () => {
  const r = redactPII('Jan Wilk mieszka w Poznaniu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Wilk')).toBe(false);
});
test('małe litery NIE są nazwiskiem (kowalski jako przymiotnik)', () => {
  const q = 'zawód kowalski wymaga siły';
  expect(redactPII(q).redacted).toBe(q);
});
// ── IMIĘ + NAZWISKO małymi literami (krok 13a4) — imię ze słownika + nazwisko morfologiczne ──
test('para małymi literami: imię ze słownika + nazwisko (jan kowalski)', () => {
  const r = redactPII('jan kowalski');
  expect(r.redacted).toBe('[IMIĘ I NAZWISKO]');
});
test('para małymi literami: nazwisko dwuczłonowe (anna kowalska-nowak)', () => {
  const r = redactPII('anna kowalska-nowak');
  expect(r.redacted).toBe('[IMIĘ I NAZWISKO]');
});
test('para małymi literami po przyimku (od jan kowalski dostałem list)', () => {
  const r = redactPII('od jan kowalski dostałem list');
  expect(r.redacted).toBe('od [IMIĘ I NAZWISKO] dostałem list');
});
test('dwie osoby małymi literami w jednym ciągu', () => {
  const r = redactPII('do anna nowak i piotr wiśniewski');
  expect(r.redacted).toBe('do [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO]');
});
test('proza małymi literami NIE jest nadmaskowana', () => {
  for (const p of [
    'mam ochotę na kawę ale ala woli herbatę',
    'polski rynek pracy zmienia się szybko',
    'to był ciężki tydzień pełen spotkań',
    'zielona góra świeci jasno nad miastem',
    'jan polski dokument leżał na biurku',
  ]) {
    expect(redactPII(p).redacted).toBe(p);
  }
});
// ── E-mail z polską diakrytyką w części lokalnej — maskuj W CAŁOŚCI (bez wycieku fragmentu) ──
test('e-mail z „ś" w części lokalnej maskowany w całości', () => {
  const r = redactPII('e-mail: piotr.wiśniewski-nowak@poczta.pl');
  expect(r.redacted).toBe('e-mail: [EMAIL]');
});
// ── Kod pocztowy BEZ myślnika przy kotwicy adresowej (krok 10b) ──
test('kod pocztowy bez myślnika po adresie (65048 Zielona Góra)', () => {
  const r = redactPII('ul. Krótka 5, 65048 Zielona Góra');
  expect(r.redacted).toBe('[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]');
});
test('kod pocztowy bez myślnika w nowej linii adresu', () => {
  const r = redactPII('ul. Krótka 5\n65048 Zielona Góra');
  expect(r.redacted).toBe('[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]');
});
test('5 cyfr BEZ kotwicy adresowej NIE są kodem pocztowym', () => {
  for (const q of ['Kwota 50000 Euro do zapłaty', 'Faktura 12345 Netto']) {
    expect(redactPII(q).redacted).toBe(q);
  }
});
test('krok 13c nie psuje idempotencji', () => {
  const once = redactPII('Sprawę Kowalskiego i Wiśniewskiej umorzono').redacted;
  expect(redactPII(once).redacted).toBe(once);
});

// ── Nazwiska rozpoznane MORFOLOGICZNIE (spoza słownika: -ski/-cki/-icz/-czyk) ──
test('rzadkie nazwisko solo w mianowniku (Fiołkowska)', () => {
  const r = redactPII('Fiołkowska wygrała przetarg na dostawę mebli.');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Fiołkowska')).toBe(false);
});
test('rzadkie nazwisko solo w dopełniaczu (Gzowskiego)', () => {
  const r = redactPII('list od Gzowskiego leżał na biurku tydzień');
  expect(r.redacted.includes('Gzowskiego')).toBe(false);
});
test('rzadkie nazwisko -icz w odmianie (Bąkiewiczowi)', () => {
  const r = redactPII('Bąkiewiczowi zależało na szybkiej wypłacie.');
  expect(r.redacted.includes('Bąkiewiczowi')).toBe(false);
});
test('rzadkie nazwisko -czyk w odmianie (Zdrojewczyka)', () => {
  const r = redactPII('sprawę Zdrojewczyka przekazano do prokuratury');
  expect(r.redacted.includes('Zdrojewczyka')).toBe(false);
});
test('para rzadkie imię + rzadkie nazwisko (Świętomira Gzowska) — oba maskowane', () => {
  const r = redactPII('Świętomira Gzowska przyszła na przesłuchanie.');
  expect(r.redacted.includes('Świętomira')).toBe(false);
  expect(r.redacted.includes('Gzowska')).toBe(false);
});
test('nazwisko dwuczłonowe morfologiczne (Rzepeckiej-Gil)', () => {
  const r = redactPII('opinia Rzepeckiej-Gil była druzgocąca');
  expect(r.redacted.includes('Rzepeckiej')).toBe(false);
});
test('małżonkowie o wspólnym nazwisku (Anna i Jan Kowalscy) — nic nie wycieka', () => {
  const r = redactPII('Anna i Jan Kowalscy kupili mieszkanie na osiedlu.');
  expect(r.redacted.includes('Anna')).toBe(false);
  expect(r.redacted.includes('Jan')).toBe(false);
  expect(r.redacted.includes('Kowalscy')).toBe(false);
});

// ── ANTY-NADMASKOWANIE morfologiczne: przymiotnik w nazwie instytucji/geo NIE jest nazwiskiem ──
test('nazwy instytucji z przymiotnikiem -ski/-cki pozostają nietknięte', () => {
  const clean = [
    'Uniwersytet Warszawski ogłosił konkurs.',
    'Izba Lekarska wydała opinię.',
    'Bank Śląski przygotował ofertę.',
    'Sąd Okręgowy w Krakowie wydał wyrok.',
    'Narodowy Bank Polski obniżył stopy.',
    'Politechnika Śląska otworzyła nabór.',
  ];
  for (const t of clean) expect(redactPII(t).redacted).toBe(t);
});
test('rzeczownik przed nazwiskiem w dopełniaczu ZOSTAJE (Zaległości Trzebiatowskiego)', () => {
  const r = redactPII('Zaległości Trzebiatowskiego rosły z miesiąca na miesiąc.');
  expect(r.redacted).toContain('Zaległości'); // rzeczownik pospolity — nie nazwisko
  expect(r.redacted.includes('Trzebiatowskiego')).toBe(false); // nazwisko zamaskowane
});

// ── Poprawki precyzji z audytu optymalizacyjnego (v0.30) ──
test('(a3) zwykły wyraz + imię NIE jest maskowany (Wczoraj Anna, Umowa Marii)', () => {
  expect(redactPII('Wczoraj Anna wróciła z urlopu.').redacted).toBe('Wczoraj Anna wróciła z urlopu.');
  expect(redactPII('Umowa Marii została podpisana.').redacted).toBe('Umowa Marii została podpisana.');
});
test('(a3) „Nazwisko Imię" w nagłówku e-maila nadal maskowane (From: Ejkszto Anna)', () => {
  const r = redactPII('From: Ejkszto Anna');
  expect(r.redacted.includes('Ejkszto')).toBe(false);
});
test('„Komitet Obywatelski" / „Hufiec Harcerski" NIE są osobą', () => {
  expect(redactPII('Komitet Obywatelski poparł uchwałę.').redacted).toBe('Komitet Obywatelski poparł uchwałę.');
});
test('regionalne i pospolite przymiotniki -ski/-cki nietknięte', () => {
  expect(redactPII('Bieszczadzki Park Narodowy wprowadził zakaz.').redacted).toContain('Bieszczadzki Park Narodowy');
  expect(redactPII('Niski poziom wody w rzece.').redacted).toBe('Niski poziom wody w rzece.');
});
test('miesiąc „Maja" nie jest imieniem (Pierwszego Maja)', () => {
  expect(redactPII('Zebranie odbyło się Pierwszego Maja.').redacted).toBe('Zebranie odbyło się Pierwszego Maja.');
});
test('„Pani Minister"/„Pan Wojewoda Mazowiecki" — sama rola/tytuł zostaje', () => {
  expect(redactPII('Pani Minister podpisała rozporządzenie.').redacted).toBe('Pani Minister podpisała rozporządzenie.');
  expect(redactPII('Pan Wojewoda Mazowiecki wydał decyzję.').redacted).toBe('Pan Wojewoda Mazowiecki wydał decyzję.');
});
test('„Pan Dyrektor Kowalski" — rola zostaje, nazwisko maskowane', () => {
  const r = redactPII('Pan Dyrektor Kowalski podpisał pismo.');
  expect(r.redacted).toContain('Pan Dyrektor');
  expect(r.redacted.includes('Kowalski')).toBe(false);
});
test('nazwisko słownikowe z myślnikiem (Nowak-Schmidt) maskowane', () => {
  const r = redactPII('Pozew wniosła Nowak-Schmidt.');
  expect(r.redacted.includes('Nowak-Schmidt')).toBe(false);
});

// ── Regresje z benchmarku (docs/BENCHMARK.md, 2026-07-04) ──
test('REGON ze złą sumą przy etykiecie „REGON" → [REGON] mimo złej sumy (nie telefon)', () => {
  // v0.44: silna etykieta „REGON" maskuje mimo złej sumy kontrolnej (i nie ląduje w telefonie).
  const r = redactPII('Firma o REGON 123456784 w rejestrze');
  expect(r.redacted.includes('[TELEFON]')).toBe(false);
  expect(r.redacted).toContain('[REGON]');
  expect(r.redacted).not.toContain('123456784');
});

// ── v0.44: telefon w nawiasach + maskowanie ID przy silnej etykiecie mimo złej sumy ──
test('telefon w nawiasach z prefiksem +48 maskowany', () => {
  expect(redactPII('tel. +48 (501) 234-567').redacted).toBe('tel. [TELEFON]');
});
test('telefon w nawiasach z kontekstem (bez +48)', () => {
  const r = redactPII('tel. (22) 621-02-03 zadzwoń');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted).not.toContain('621');
});
test('PESEL/NIP/konto ze złą sumą przy silnej etykiecie (też z kwalifikatorem) maskowane', () => {
  expect(redactPII('PESEL 90010112344').redacted).toBe('PESEL [PESEL]');
  expect(redactPII('PESEL wnioskodawcy: 90010112344').redacted).toContain('[PESEL]');
  expect(redactPII('NIP 9452176998').redacted).toBe('NIP [NIP]');
  expect(redactPII('NIP działalności:\n9452176998').redacted).not.toContain('9452176998');
  const konto = redactPII('Konto:\nPL12 1020 5558 1111 2222 3333 4444');
  expect(konto.redacted).toContain('[NR-KONTA]');
  expect(konto.redacted).not.toContain('PL12');
});
test('PESEL bez etykiety i ze złą sumą NIE jest maskowany (precyzja)', () => {
  expect(redactPII('Wartość 90010112344 w logu importu').redacted).toContain('90010112344');
});

// ── v0.44: nowe typy PII ──
test('TOKEN (JWT) maskowany', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc-DEF_123';
  const r = redactPII('Authorization: ' + jwt);
  expect(r.redacted).toContain('[TOKEN]');
  expect(r.redacted).not.toContain('eyJ');
});
test('MAC maskowany (nie mylony z IPv6)', () => {
  expect(redactPII('MAC: 00:1A:2B:3C:4D:5E').redacted).toBe('MAC: [MAC]');
});
test('IPv4 maskowany, ale numer wersji NIE (precyzja)', () => {
  expect(redactPII('IP: 192.168.1.20').redacted).toBe('IP: [IP]');
  expect(redactPII('wersja 1.2.3.4 aplikacji').redacted).toContain('1.2.3.4');
});
test('IPv6 maskowany', () => {
  const r = redactPII('IPv6: 2001:db8::8a2e:370:7334');
  expect(r.redacted).toContain('[IP]');
  expect(r.redacted).not.toContain('8a2e');
});
test('VIN maskowany (kontekst i strukturalnie)', () => {
  expect(redactPII('VIN: WAUZZZ8V4JA123456').redacted).toContain('[VIN]');
  expect(redactPII('Nadwozie WAUZZZ8V4JA123456 sprawne').redacted).toContain('[VIN]');
});
test('prawo jazdy maskowane z kontekstem; „kategorii B" bez cyfry NIE', () => {
  expect(redactPII('Prawo jazdy:\nKR1234567').redacted).toContain('[PRAWO-JAZDY]');
  expect(redactPII('Prawo jazdy kategorii B').redacted).toContain('kategorii');
});
test('prawo jazdy ze slashami maskowane W CAŁOŚCI (bez wycieku fragmentu)', () => {
  const r = redactPII('Prawo jazdy: 12345/67/8901');
  expect(r.redacted).toContain('[PRAWO-JAZDY]');
  expect(r.redacted).not.toMatch(/\d/); // żaden fragment numeru nie zostaje
  // wartość po numerze nie jest pożerana
  const r2 = redactPII('Prawo jazdy nr KR1234567 wydane w 2020 roku.');
  expect(r2.redacted).toContain('[PRAWO-JAZDY]');
  expect(r2.redacted).toContain('wydane');
});
test('nr rejestracyjny maskowany z kontekstem', () => {
  const r = redactPII('Nr rejestracyjny:\nWI1234K');
  expect(r.redacted).toContain('[NR-REJESTRACYJNY]');
  expect(r.redacted).not.toContain('WI1234K');
});
test('nowe typy respektują options.types (wyłączanie)', () => {
  expect(redactPII('IP: 192.168.1.20', { types: [] }).redacted).toBe('IP: 192.168.1.20');
  expect(redactPII('VIN: WAUZZZ8V4JA123456', { types: ['MAC'] }).redacted).toContain('WAUZZZ8V4JA123456');
});
test('„ur. DD.MM.RRRR" maskowane (trailing \\b po kropce nie działał)', () => {
  const r = redactPII('Powód, ur. 12.05.1985, wnosi o zapłatę');
  expect(r.redacted).toContain('[DATA-URODZENIA]');
  expect(r.redacted.includes('12.05.1985')).toBe(false);
});
test('adres w formie zależnej „na ulicy …" maskowany', () => {
  const r = redactPII('Mieszka na ulicy Krakowskie Przedmieście 26/28');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('26/28')).toBe(false);
});
test('nazwisko dwuczłonowe po wyzwalaczu maskowane W CAŁOŚCI', () => {
  const r = redactPII('Pan Habdank-Wojewódzki nie odebrał pisma');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Wojewódzki')).toBe(false);
  expect(r.redacted).toContain('nie odebrał');
});

// ── Pseudonimizacja: spójne etykiety [OSOBA-X] ──
test('pseudonimy — ta sama osoba w odmianie dostaje tę samą etykietę', () => {
  const r = redactPII('Kowalski złożył pozew, a sąd wezwał Kowalskiego ponownie', {
    pseudonyms: true,
  });
  expect(r.redacted.match(/\[OSOBA-A\]/g)?.length).toBe(2);
  expect(r.redacted.includes('[OSOBA-B]')).toBe(false);
});
test('pseudonimy — różne osoby dostają różne etykiety', () => {
  const r = redactPII('Nowak pozwał Wiśniewskiego o zapłatę', { pseudonyms: true });
  expect(r.redacted).toContain('[OSOBA-A]');
  expect(r.redacted).toContain('[OSOBA-B]');
});
test('pseudonimy — para „Imię Nazwisko” i solo-odmiana spójne', () => {
  const r = redactPII('Jan Kowalski wynajął lokal. Kowalskiemu doręczono wypowiedzenie.', {
    pseudonyms: true,
  });
  expect(r.redacted.match(/\[OSOBA-A\]/g)?.length).toBe(2);
  expect(r.redacted.includes('OSOBA-B')).toBe(false);
});
test('pseudonimy — wyzwalacz „Pan” zachowuje sens zdania', () => {
  const r = redactPII('Pan Wiśniewski nie zapłacił czynszu', { pseudonyms: true });
  expect(r.redacted).toContain('[OSOBA-A]');
  expect(r.redacted).toContain('nie zapłacił');
});
test('pseudonimy — wyłączone domyślnie (stara maska)', () => {
  const r = redactPII('Jan Kowalski mieszka tu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('OSOBA')).toBe(false);
});
test('pseudonimy — idempotencja (drugi przebieg nic nie zmienia)', () => {
  const once = redactPII('Nowak i Wiśniewski oraz PESEL 44051401359', { pseudonyms: true }).redacted;
  expect(redactPII(once, { pseudonyms: true }).redacted).toBe(once);
});

// ── Opcje: wybór typów i własne placeholdery ──
test('options.types — maskuje TYLKO wskazane typy', () => {
  const r = redactPII('PESEL 44051401359, mail x@y.pl, Jan Kowalski', { types: ['PESEL'] });
  expect(r.redacted).toContain('[PESEL]');
  expect(r.redacted).toContain('x@y.pl');
  expect(r.redacted).toContain('Jan Kowalski');
  expect(r.found.map((f) => f.type)).toEqual(['PESEL']);
});

test('options.types — pusta lista nic nie maskuje', () => {
  const input = 'PESEL 44051401359, mail x@y.pl';
  const r = redactPII(input, { types: [] });
  expect(r.redacted).toBe(input);
  expect(r.found.length).toBe(0);
});

test('options.masks — własny placeholder, reszta domyślna', () => {
  const r = redactPII('PESEL 44051401359, mail x@y.pl', { masks: { PESEL: '[UKRYTO]' } });
  expect(r.redacted).toContain('[UKRYTO]');
  expect(r.redacted).toContain('[EMAIL]');
});

test('options — brak opcji identyczny z domyślnym wywołaniem', () => {
  const input = 'PESEL 44051401359, NIP 123-456-32-18, Jan Kowalski, ul. Polna 12/3, x@y.pl';
  expect(redactPII(input, {}).redacted).toBe(redactPII(input).redacted);
});

// ============================================================================
// Poprawki po raporcie testów partii 1–3 (v0.44.2)
// ============================================================================

test('sygnatura sądowa z dwuczłonowym wydziałem („II SA/Wa 1234/23") maskowana przy kotwicy', () => {
  const r = redactPII('Sygn. akt: II SA/Wa 1234/23 w toku postępowania.');
  expect(r.redacted).toContain('[ZNAK-SPRAWY]');
  expect(r.redacted.includes('1234/23')).toBe(false);
});
test('sygnatura sądowa BEZ kotwicy (cytowane orzecznictwo) NIE jest maskowana', () => {
  const t = 'Orzeczenie w sprawie III CZP 45/22 oraz wyrok I OSK 1122/21.';
  expect(redactPII(t).redacted).toBe(t);
});

test('KRS z wypełniaczem „pod numerem" maskowany', () => {
  const r = redactPII('spółkę wpisaną do KRS pod numerem 0000123456.');
  expect(r.redacted).toContain('[KRS]');
  expect(r.redacted.includes('0000123456')).toBe(false);
});

test('prawo jazdy w odmianie („prawem jazdy nr") maskowane w całości', () => {
  const r = redactPII('posługujący się prawem jazdy nr 05678/13/1234.');
  expect(r.redacted).toContain('[PRAWO-JAZDY]');
  expect(r.redacted.includes('05678')).toBe(false);
  expect(r.redacted.includes('1234')).toBe(false);
});

test('sekrety prefiksowe (sk_live_/sk_test_/ghp_/github_pat_) maskowane jako TOKEN', () => {
  const r = redactPII('Klucz sk_live_a1b2c3d4e5f6g7h8i9j0 oraz ghp_AbCdEfGh1234567890IjKlMnOpQrStUv.');
  expect(r.redacted.match(/\[TOKEN\]/g)?.length).toBe(2);
  expect(r.redacted.includes('sk_live')).toBe(false);
  expect(r.redacted.includes('ghp_')).toBe(false);
});

test('telefon: wtrącenie po słowie kontekstowym i kierunkowy w nawiasie', () => {
  const r = redactPII('telefon kontaktowy (22) 501-23-45 czynny w godzinach pracy.');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('501-23-45')).toBe(false);
});
test('telefon: format z kropkami wymaga kotwicy; kierunkowy w nawiasie działa bez niej', () => {
  expect(redactPII('Telefon 512.345.678 w aktach.').redacted).toContain('[TELEFON]');
  expect(redactPII('Numery: 512.345.678 w aktach.').redacted.includes('[TELEFON]')).toBe(false);
  expect(redactPII('Dzwonić: (22) 501-23-45 rano.').redacted).toContain('[TELEFON]');
});
test('telefon: goły prefiks „48" maskowany razem z numerem', () => {
  const r = redactPII('kom. 48 512 345 678 dostępny wieczorem.');
  expect(r.redacted).toContain('[TELEFON]');
  expect(/48\s*\[TELEFON\]/.test(r.redacted)).toBe(false);
});
test('telefon: 9 cyfr od zera i numer porządkowy w rejestrze NIE są telefonem', () => {
  const t = 'Numer porządkowy pozycji w rejestrze 000012345 nie jest telefonem. Lp. 123456789.';
  expect(redactPII(t).redacted).toBe(t);
});
test('telefon: kropkowy 3-3-3 nie zjada członów numeru wersji', () => {
  const t = 'Oprogramowanie w wersji 10.0.19045.3803 oraz build 1.234.567.890 działa.';
  expect(redactPII(t).redacted).toBe(t);
});

test('MAC w notacji Cisco (aabb.ccdd.eeff) maskowany; wersja czysto cyfrowa nie', () => {
  const r = redactPII('Interfejs aabb.ccdd.eeff w notacji Cisco.');
  expect(r.redacted).toContain('[MAC]');
  expect(redactPII('Pozycja 1234.5678.9012 w tabeli.').redacted.includes('[MAC]')).toBe(false);
});

test('skompresowany IPv6 przed kropką końca zdania maskowany', () => {
  const r = redactPII('host IPv6 fe80::1ff:fe23:4567:890a. Dalej tekst.');
  expect(r.redacted).toContain('[IP]');
  expect(r.redacted.includes('fe80')).toBe(false);
});

test('data urodzenia z „dnia" i miesiącem rzymskim („ur. dnia 31 XII 2010")', () => {
  const r = redactPII('Zgłaszający, ur. dnia 31 XII 2010, stawił się.');
  expect(r.redacted).toContain('[DATA-URODZENIA]');
  expect(r.redacted.includes('31 XII 2010')).toBe(false);
});

test('NIP z prefiksem kraju „PL" maskowany w całości', () => {
  const r = redactPII('Firma o numerze NIP PL5262735917 wystawiła fakturę.');
  expect(r.redacted).toContain('[NIP]');
  expect(/PL\s*\[NIP\]/.test(r.redacted)).toBe(false);
});

test('miejscowość po markerze urodzenia z datą pomiędzy („ur. … w Krakowie")', () => {
  const r = redactPII('Pani Anna, ur. 08.05.1992 w Krakowie, stawiła się osobiście.');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Krakowie')).toBe(false);
  // goła proza bez markera zostaje
  expect(redactPII('Spotkanie odbyło się w Krakowie.').redacted).toBe('Spotkanie odbyło się w Krakowie.');
});

test('adres z numerem lokalu po „lok."/„m." maskowany w całości', () => {
  const r1 = redactPII('zamieszkały przy ul. Polnej 12 lok. 5 od lat.');
  expect(r1.redacted).toContain('[ADRES]');
  expect(r1.redacted.includes('lok. 5')).toBe(false);
  const r2 = redactPII('adres: ul. Długa 3 m. 7 w centrum.');
  expect(r2.redacted).toContain('[ADRES]');
  expect(r2.redacted.includes('m. 7')).toBe(false);
});

test('inicjał imienia przed zamaskowaną osobą wciągany do maski', () => {
  const r = redactPII('Pełnomocnikiem był mec. J. Kowalski z kancelarii.');
  expect(/\bJ\.\s/.test(r.redacted)).toBe(false);
  // punkt wyliczenia na początku linii zostaje
  const r2 = redactPII('A. Jan Kowalski zeznał, że...');
  expect(r2.redacted.startsWith('A.')).toBe(true);
});

// Poprawki po audycie adwersarialnym v0.44.2
test('kwoty z separatorem tysięcy (kropki/spacje) NIE są telefonem', () => {
  for (const t of [
    'Wartość zamówienia: 123.456.789 zł brutto.',
    'Kwota 512.345.678,00 zł na rachunku.',
    'Kapitał 123 456 789 zł wniesiono.',
  ]) {
    expect(redactPII(t).redacted.includes('[TELEFON]')).toBe(false);
  }
});
test('kropkowy telefon TYLKO z kotwicą; numer seryjny/wersja bez maskowania', () => {
  expect(redactPII('tel. 512.345.678 czynny.').redacted).toContain('[TELEFON]');
  expect(redactPII('Telefony: 512.345.678 w aktach.').redacted).toContain('[TELEFON]');
  const t = 'Numer seryjny urządzenia: 745.812.903. Wersja oprogramowania 512.345.678 wydana.';
  expect(redactPII(t).redacted).toBe(t);
});
test('MAC Cisco czysto cyfrowy maskowany przy etykiecie „MAC", bez etykiety nie', () => {
  expect(redactPII('Adres MAC: 0011.2233.4455 urządzenia.').redacted).toContain('[MAC]');
  expect(redactPII('Pozycja 0011.2233.4455 w tabeli.').redacted.includes('[MAC]')).toBe(false);
});
test('znak sprawy z inicjałami referenta maskowany w całości', () => {
  const r = redactPII('znak sprawy: WKU.5589.12.2026.AB w aktach.');
  expect(r.redacted).toContain('[ZNAK-SPRAWY]');
  expect(r.redacted.includes('.AB')).toBe(false);
});
test('prawo jazdy z wtrąceniem kategorii („kat. B o numerze") maskowane', () => {
  for (const t of [
    'okazał prawo jazdy kat. B o numerze 12345/67/8901',
    'informacje o prawie jazdy kategorii B nr 12345/67/8901',
  ]) {
    const r = redactPII(t);
    expect(r.redacted).toContain('[PRAWO-JAZDY]');
    expect(r.redacted.includes('12345')).toBe(false);
  }
});
test('miasto z myślnikiem i mianownik po „zam." maskowane', () => {
  expect(redactPII('Oskarżony ur. 1.01.1970 w Bielsku-Białej.').redacted).toContain('[MIEJSCOWOŚĆ]');
  const r = redactPII('ur. 3 maja 1980 r. w Poznaniu, zam. Kraków');
  expect(r.redacted.includes('Poznaniu')).toBe(false);
  expect(r.redacted.includes('Kraków')).toBe(false);
});

// ============================================================================
// Tura 2 — raport finalny (N1/N2/N3/B3/B9/B10 + kolejność etykiet)
// ============================================================================

test('tablice rejestracyjne w wyliczeniu z kotwicą pojazdową (N1)', () => {
  const r = redactPII('Pojazd o nr rejestracyjnym WA 12345, drugi pojazd WW 1234A, motocykl ZS 4567, trzeci pojazd WE 123AB.');
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(4);
  const neg = 'Pojazd MERCEDES i auto BMW 320D czekały.';
  expect(redactPII(neg).redacted).toBe(neg);
});

test('NRB bez prefiksu PL z poprawną sumą maskowany; ze złą nie (N3)', () => {
  expect(redactPII('Przelew na 66 1097 1200 0012 3456 7890 1234 wykonano.').redacted).toContain('[NR-KONTA]');
  const bad = 'Ciąg 10 2010 9712 0000 1234 5678 9013 ma złą sumę.';
  expect(redactPII(bad).redacted).toBe(bad);
});

test('wyliczenie telefonów po jednej kotwicy — wszystkie człony maskowane (B3)', () => {
  const r = redactPII('Telefony: 512.345.678, 601 234 567 czynne.');
  expect(r.redacted.match(/\[TELEFON\]/g)?.length).toBe(2);
  expect(r.redacted.includes('512')).toBe(false);
});

test('inicjał + nazwisko, w tym homonim („A. Baran"); patron i wyliczenia zostają (N2)', () => {
  const r = redactPII('Zeznania złożył A. Baran oraz J. Kowalski.', { pseudonyms: true });
  expect(r.redacted.includes('Baran')).toBe(false);
  expect(r.redacted.includes('Kowalski')).toBe(false);
  const neg = 'Szkoła im. A. Mickiewicza. A. Wnioski stron. B. Uzasadnienie.';
  expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
});

test('rzeczowniki pospolite lm. na -ski nie są nazwiskami', () => {
  const t = 'Wnioski dowodowe oddalono. Zapiski z narady. Maski ochronne wydano.';
  expect(redactPII(t).redacted).toBe(t);
});

test('obce nazwiska wieloczłonowe: Jean-Pierre Dubois i Nguyen Van Anh (B9/B10)', () => {
  const r = redactPII('Stawił się Jean-Pierre Dubois oraz Nguyen Van Anh.', { pseudonyms: true });
  expect(r.redacted.includes('Dubois')).toBe(false);
  expect(r.redacted.includes('Jean-Pierre')).toBe(false);
  expect(r.redacted.includes('Van Anh')).toBe(false);
  const neg = 'Dojazd do Bielsko-Biała Centrum oraz stacji Kędzierzyn-Koźle Zachód.';
  expect(redactPII(neg).redacted).toBe(neg);
});

test('etykiety osób idą w kolejności wystąpienia w tekście', () => {
  const r = redactPII('Świadkiem była pani Zaremba. Sprawę Kowalskiego umorzono. Znów Zaremba.', { pseudonyms: true });
  const order = [...r.redacted.matchAll(/\[OSOBA-([A-Z]+)\]/g)].map((m) => m[1]);
  expect(order[0]).toBe('A');
  expect([...new Set(order)]).toEqual([...new Set(order)].sort());
});

// Poprawki po audycie adwersarialnym tury 2 (v0.44.4)
test('kotwica pojazdowa: wtrącenia (siodłowy, o nr), a modele aut zostają', () => {
  const r = redactPII('ciągnik siodłowy GD 890KL oraz pojazd o nr GD 891KL.');
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(2);
  const neg = 'pojazd marki KIA CEED2 oraz auto VW GOLF5.';
  expect(redactPII(neg).redacted).toBe(neg);
});
test('patron ulicy nie jest osobą; „Al." z inicjałem wchodzi w ADRES', () => {
  expect(redactPII('Mieszka przy ul. Rakowieckiej.', { pseudonyms: true }).redacted).toBe('Mieszka przy ul. Rakowieckiej.');
  expect(redactPII('Biuro przy Al. W. Andersa 15 czynne.').redacted).toContain('[ADRES]');
});
test('inicjał + nazwisko po dwukropku (rozdzielnik) maskowane', () => {
  const r = redactPII('Do wiadomości: K. Baran.', { pseudonyms: true });
  expect(r.redacted.includes('Baran')).toBe(false);
});
test('miasta z myślnikiem spoza słownika i firmy nie są obcymi imionami', () => {
  for (const t of [
    'Golub-Dobrzyń Zaprasza turystów. Trasa Golub-Dobrzyń Toruń.',
    'Ruciane-Nida Zaprasza latem.',
    'Napój Coca-Cola Company oraz Rolls-Royce Motor Cars.',
  ]) {
    expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
  }
});
test('cząstka nazwiska w regule imion z myślnikiem („Jean-Claude Van Damme") w całości', () => {
  const r = redactPII('Wystąpił Jean-Claude Van Damme na gali.', { pseudonyms: true });
  expect(r.redacted.includes('Damme')).toBe(false);
  expect(r.redacted.includes('Van')).toBe(false);
});
test('rozszerzona stoplista -ski/-cki (przyciski, klocki, kluski…)', () => {
  const t = 'Przyciski zamontowano. Klocki hamulcowe. Kluski śląskie. Odpryski lakieru. Uzyski energii.';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
});

// ============================================================================
// v0.45.0 — XML/JSON, URL, LOGIN, OCR, telefon z kropkami, tablice w wyliczeniu
// ============================================================================

// ── Struktura XML ──
test('XML: tagi Name/Surname/Street/City to kotwice strukturalne; tagi zostają', () => {
  const t = '<Customer>\n<Name>Jan</Name>\n<Surname>Kowalski</Surname>\n<Phone>+48 501 234 567</Phone>\n<Email>jan@example.com</Email>\n<Street>Leśna 15</Street>\n<City>Warszawa</City>\n</Customer>';
  const r = redactPII(t, { pseudonyms: true });
  expect(r.redacted).toContain('<Name>[IMIĘ I NAZWISKO]</Name>');
  expect(r.redacted).toContain('<Surname>[OSOBA-A]</Surname>');
  expect(r.redacted).toContain('<Phone>[TELEFON]</Phone>');
  expect(r.redacted).toContain('<Email>[EMAIL]</Email>');
  expect(r.redacted).toContain('<Street>[ADRES]</Street>');
  expect(r.redacted).toContain('<City>[MIEJSCOWOŚĆ]</City>');
  // idempotencja: drugi przebieg niczego nie psuje
  expect(redactPII(r.redacted, { pseudonyms: true }).redacted).toBe(r.redacted);
});
test('XML: generyczny <Name> z nazwą produktu/firmy NIE jest osobą', () => {
  const t = '<Name>Produkt X200</Name> oraz <Name>Acme</Name> w katalogu.';
  expect(redactPII(t).redacted).toBe(t);
});

// ── Struktura JSON ──
test('JSON: klucze firstName/lastName/city/street maskują wartość; wynik dalej się parsuje', () => {
  const t = '{\n  "customer": {\n    "firstName": "Jan",\n    "lastName": "Kowalski",\n    "email": "jan@example.com",\n    "phone": "+48 501 234 567",\n    "city": "Warszawa",\n    "street": "Lipowa 12"\n  }\n}';
  const r = redactPII(t, { pseudonyms: true });
  const parsed = JSON.parse(r.redacted); // cudzysłowy i przecinki nietknięte
  expect(parsed.customer.firstName).toBe('[IMIĘ I NAZWISKO]');
  expect(parsed.customer.lastName).toBe('[OSOBA-A]');
  expect(parsed.customer.city).toBe('[MIEJSCOWOŚĆ]');
  expect(parsed.customer.street).toBe('[ADRES]');
  expect(r.redacted.includes('Lipowa')).toBe(false);
  expect(redactPII(r.redacted, { pseudonyms: true }).redacted).toBe(r.redacted);
});
test('JSON: klucze nieosobowe i wartości nie-PII zostają', () => {
  const t = '{ "status": "Aktywny", "name": "Acme Corp", "city": "b/d" }';
  expect(redactPII(t).redacted).toBe(t);
});

// ── URL: ochrona + maskowanie wewnątrz ──
test('URL: parametry osobowe maskowane wewnątrz, struktura adresu zostaje', () => {
  const t = 'Zgłoszenie: https://portal.example.com/ticket?id=123456789&user=tomasz.kaminski&email=jan%40example.com dostępne.';
  const r = redactPII(t);
  expect(r.redacted).toContain('https://portal.example.com/ticket?id=123456789');
  expect(r.redacted).toContain('user=[LOGIN]');
  expect(r.redacted).toContain('email=[EMAIL]');
  expect(r.redacted.includes('tomasz.kaminski')).toBe(false);
  expect(r.redacted.includes('jan%40example.com')).toBe(false);
  expect(redactPII(r.redacted).redacted).toBe(r.redacted);
});
test('URL bez danych osobowych zostaje nietknięty (też z kapitalizowaną ścieżką)', () => {
  const t = 'Repozytorium https://github.com/apache/kafka oraz cennik www.example.com/Cennik-Uslugi.';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
});
test('URL: detektory nazwisk/telefonów nie rozbijają adresu (ochrona sentinelami)', () => {
  const t = 'Profil https://intranet.firma.pl/osoby/Jan-Kowalski?tab=dane w systemie.';
  const r = redactPII(t, { pseudonyms: true });
  // adres pozostaje JEDNYM spójnym URL-em — bez rozerwania maską w środku ścieżki
  expect(r.redacted).toContain('https://intranet.firma.pl/osoby/Jan-Kowalski?tab=dane');
});

// ── LOGIN ──
test('login po kotwicy (też w następnej linii) + powtórzenia w dokumencie', () => {
  const t = 'Login użytkownika:\ntkaminski\n\nNastąpiło poprawne wylogowanie użytkownika "tkaminski" o 16:02.';
  const r = redactPII(t);
  expect(r.redacted.match(/\[LOGIN\]/g)?.length).toBe(2);
  expect(r.redacted.includes('tkaminski')).toBe(false);
  expect(r.redacted).toContain('o 16:02');
});
test('login: identyfikatory systemowe i puste pola zostają', () => {
  const t = 'Identyfikator w systemie:\nUSR-005182\n\nLogin:\nStatus: aktywny';
  const r = redactPII(t).redacted;
  expect(r).toContain('USR-005182');
  expect(r).toContain('Status: aktywny'); // etykieta po pustym „Login:" nie jest wartością
});
test('login respektuje options.types', () => {
  const t = 'Login: tkaminski';
  expect(redactPII(t, { types: [] }).redacted).toBe(t);
  expect(redactPII(t, { types: ['LOGIN'] }).redacted).toContain('[LOGIN]');
});

// ── Telefon z kropkami (mikrotest A) ──
test('telefon: kotwica „Kontakt" + wyliczenie z „oraz", wypełniaczem i prefiksem „+48."', () => {
  const t = 'Kontakt: 512.345.678, +48.512.345.678 oraz stacjonarny 22.501.23.45.';
  const r = redactPII(t);
  expect(r.redacted.match(/\[TELEFON\]/g)?.length).toBe(3);
  expect(r.redacted).not.toMatch(/\d{3}/);
});
test('telefon: człon po „oraz" w wyliczeniu z kotwicą „tel." maskowany', () => {
  const r = redactPII('tel. 512 345 678, 601-234-567 oraz 512.345.678.');
  expect(r.redacted.match(/\[TELEFON\]/g)?.length).toBe(3);
});
test('telefon: pułapki kropkowe (data, wersja, kwota) zostają', () => {
  const t = 'Data 12.05.1990 i wersja 10.2.3 nie są telefonem. Kwota 1.234.567 zł też nie.';
  expect(redactPII(t).redacted).toBe(t);
});

// ── Tablice rejestracyjne w wyliczeniu (mikrotest B) ──
test('tablice: wyliczenie po jednej kotwicy pojazdowej — wszystkie człony', () => {
  const t = 'Zabezpieczono pojazdy: WW 1234A, ZS 4567, WE 123AB, PO 5AB67, KR 8XY90, DW 12345, WGM 1234.';
  const r = redactPII(t);
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(7);
  expect(r.redacted).not.toMatch(/WW|ZS|WE|PO|KR|DW|WGM/);
});
test('tablice: kotwica „parking" z przerwą i kontynuacją „oraz"', () => {
  const r = redactPII('Na parkingu stały też GD 707GG oraz PZE 5U678.');
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(2);
});
test('tablice: pułapki prawne — rozporządzenie (WE) i dyrektywa zostają', () => {
  const t = 'Rozporządzenie (WE) nr 1234/2009 oraz dyrektywa WE 123 to akty prawne, nie tablice.';
  expect(redactPII(t).redacted).toBe(t);
});
test('tablice: idempotencja drugiego przebiegu (kotwica nie zjada „…cyjnym")', () => {
  const r1 = redactPII('Kontrola: pojazd o nr rejestracyjnym WA 12345.').redacted;
  expect(redactPII(r1).redacted).toBe(r1);
});

// ── Miasto po adresie z przyimkiem / nową linią ──
test('miasto po [ADRES] z przyimkiem „w" maskowane; proza bez adresu zostaje', () => {
  const r = redactPII('Biuro przy ul. Morskiej 12 w Gdańsku czynne.');
  expect(r.redacted).toContain('[ADRES] w [MIEJSCOWOŚĆ]');
  const neg = 'Spotkanie projektowe odbyło się w Gdańsku.';
  expect(redactPII(neg).redacted).toBe(neg);
});

// ── Błędy OCR ──
test('OCR: para WERSALIKAMI z homoglifami („J0AN K0WALSKI") maskowana słownikowo', () => {
  const r = redactPII('Zgłoszenie od J0AN K0WALSKI przyjęto.', { pseudonyms: true });
  expect(r.redacted.includes('K0WALSKI')).toBe(false);
  expect(r.redacted.includes('J0AN')).toBe(false);
});
test('OCR: kotwice z homoglifem — „teI:" (telefon) i „uI." (ulica z „Lip0wa")', () => {
  const r = redactPII('teI:\n501234567\n\nuI. Lip0wa 15\n\nWarszawa');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]'); // miasto w bloku adresowym pod [ADRES]
  expect(r.redacted.includes('Lip0wa')).toBe(false);
});
test('WERSALIKI: para słownikowa maskowana, nagłówki i identyfikatory zostają', () => {
  const r = redactPII('Poszkodowany JAN KOWALSKI złożył zeznania.', { pseudonyms: true });
  expect(r.redacted.includes('KOWALSKI')).toBe(false);
  const neg = 'SĄD OKRĘGOWY oddalił. CZĘŚĆ IV. WERSJA KOŃCOWA. BALTIC SOLUTIONS Sp. z o.o. Numer seryjny SN-44A8-9912-XXA oraz LT-8844-PL i USR-005182.';
  expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
});

// Poprawki po audycie adwersarialnym v0.45.0 (obszar URL/LOGIN)
test('URL: JWT i parametry we FRAGMENCIE (#access_token=…) maskowane', () => {
  const t = 'Przekierowanie https://app.firma.pl/callback#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqa293YWxza2kifQ.SfKxwRJSMeKKFQT zapisano w logu.';
  const r = redactPII(t);
  expect(r.redacted).toContain('#access_token=[TOKEN]');
  expect(r.redacted.includes('eyJ')).toBe(false);
  expect(r.redacted).toContain('https://app.firma.pl/callback');
});
test('login w cudzysłowie po dwukropku i w guillemetach maskowany', () => {
  const r1 = redactPII('Login: „jkowalski”, hasło osobno.');
  expect(r1.redacted).toContain('„[LOGIN]”');
  expect(r1.redacted).toContain('hasło osobno');
  const r2 = redactPII('Wylogowanie użytkownika «tkaminski» o 14:32.');
  expect(r2.redacted).toContain('«[LOGIN]»');
});
test('kotwica „Login administratora/serwisowy" łapie wartość', () => {
  expect(redactPII('Login administratora: adm_piotrn').redacted).toContain('[LOGIN]');
  expect(redactPII('Login serwisowy: srv_backup').redacted).toContain('[LOGIN]');
});
test('puste „Login:" przed etykietą dwuwyrazową nie maskuje i nie propaguje', () => {
  const t = 'Login:\nSystem operacyjny: Windows 11 Pro\nUwagi: System uruchamia się poprawnie.';
  expect(redactPII(t).redacted).toBe(t);
});
test('nazwa konta w cudzysłowie („konto „Firmowe”") nie jest loginem', () => {
  const t = 'Środki zaksięgowano na konto „Firmowe”.';
  expect(redactPII(t).redacted).toBe(t);
});

// Poprawki po II raporcie testera (v0.45.1)
test('pola administracyjne: „Powiat: Pruszkowski" / „Województwo" nie są osobą', () => {
  const t = 'Powiat:\nPruszkowski\nWojewództwo:\nMazowieckie';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
  const t2 = 'Powiat: Pruszkowski, województwo mazowieckie.';
  expect(redactPII(t2, { pseudonyms: true }).redacted).toBe(t2);
});
test('imię przed maską w nazwie pliku wciągane do maski (maskuj całość)', () => {
  const r = redactPII('Załącznik: Umowa_Kredytowa_Adam_Kowalski.pdf oraz skan_Jan_Nowak.jpg', { pseudonyms: true });
  expect(r.redacted.includes('Adam')).toBe(false);
  expect(r.redacted.includes('Jan_')).toBe(false);
  expect(r.redacted).toContain('Umowa_Kredytowa_[OSOBA-');
  expect(r.redacted).toContain('.pdf');
});
test('OCR: wielkie I w środku nazwiska („KowaIski") — całe słowo w masce, bez ucięcia', () => {
  const r = redactPII('Zgłosił się Jan KowaIski z dokumentami. Pani Anna NowaIska też.', { pseudonyms: true });
  expect(r.redacted.includes('Iski')).toBe(false);
  expect(r.redacted.includes('Iska')).toBe(false);
  expect(r.redacted.includes('Kowa')).toBe(false);
  // token mieszany nienazwiskowy zostaje (bramka słownikowa)
  const neg = 'Urządzenie McIntosh IIe działa poprawnie.';
  expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
});

// ── Petycja do Urzędu Marszałkowskiego — nad/niedomaskowania z realnego pisma (v0.46.17) ──
// „Urząd/Urzędu Marszałkowski/ego" to nazwa instytucji, NIE osoba — „marszałkowski" trafił do
// NON_SURNAME_ADJ. Osoba nazwiskiem „Marszałkowski" NADAL łapana w parze z imieniem.
test('przymiotnik urzędowy „Marszałkowskiego" nie jest osobą; instytucja zostaje', () => {
  const t = 'platformach społecznościowych Urzędu Marszałkowskiego Województwa Śląskiego w Katowicach';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
  expect(redactPII('Zarząd Marszałkowski przyjął uchwałę', { pseudonyms: true }).redacted).toBe(
    'Zarząd Marszałkowski przyjął uchwałę',
  );
});
test('osoba o nazwisku „Marszałkowski" w parze z imieniem NADAL maskowana', () => {
  const r = redactPII('Petycję podpisał Jan Marszałkowski, przewodniczący.', { pseudonyms: true });
  expect(r.redacted.includes('Marszałkowski,')).toBe(false);
  expect(r.redacted).toContain('[OSOBA-A]');
  // forma żeńska też (Anna Marszałkowska)
  expect(redactPII('Wniosek złożyła Anna Marszałkowska.', { pseudonyms: true }).redacted.includes('Marszałkowska.')).toBe(
    false,
  );
});
test('adres WERSALIKAMI (skan/OCR) maskowany jak zapis małą literą', () => {
  for (const t of ['UL. JULIUSZA LIGONIA 46', 'AL. JANA PAWŁA II 12', 'OS. TYSIĄCLECIA 3', 'PL. DEFILAD 1']) {
    const r = redactPII(t, { pseudonyms: true });
    expect(r.redacted).toBe('[ADRES]');
  }
  // adres OSOBY WERSALIKAMI (dawniej wyciekał) — zamaskowany w całości
  const os = redactPII('Zamieszkały UL. KWIATOWA 5', { pseudonyms: true });
  expect(os.redacted.includes('KWIATOWA')).toBe(false);
  // „UL" bez kropki i numeru to nie adres (brak FP)
  expect(redactPII('UL to skrót od ulica', { pseudonyms: true }).redacted).toBe('UL to skrót od ulica');
});
test('miejscowość z anotacją jednostki TERYT „(miasto)/(gmina …)" maskowana', () => {
  expect(redactPII('Gliwice (miasto)', { pseudonyms: true }).redacted).toBe('[MIEJSCOWOŚĆ] (miasto)');
  expect(redactPII('Nowa Sól (miasto)', { pseudonyms: true }).redacted).toBe('[MIEJSCOWOŚĆ] (miasto)');
  expect(redactPII('Zabłudów (gmina miejsko-wiejska)', { pseudonyms: true }).redacted).toBe(
    '[MIEJSCOWOŚĆ] (gmina miejsko-wiejska)',
  );
  // kotwica „(miasto)" nie maskuje nazwy instytucji ani przymiotnika
  expect(redactPII('Sąd Rejonowy (miasto)', { pseudonyms: true }).redacted).toBe('Sąd Rejonowy (miasto)');
  expect(redactPII('Śląski (miasto)', { pseudonyms: true }).redacted).toBe('Śląski (miasto)');
  // inny rodzaj nawiasu (nie jednostka TERYT) nie wyzwala maski miejscowości
  expect(redactPII('Wisła (rzeka)', { pseudonyms: true }).redacted).toBe('Wisła (rzeka)');
});
