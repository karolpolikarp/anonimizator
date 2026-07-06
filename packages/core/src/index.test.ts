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
test('miasto w TEKŚCIE (bez kodu) NIE jest maskowane', () => {
  const r = redactPII('Powód mieszka w Warszawie i pracuje w Krakowie');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  expect(r.redacted).toBe('Powód mieszka w Warszawie i pracuje w Krakowie');
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
test('REGON ze złą sumą NIE jest zjadany przez detektor telefonu', () => {
  const r = redactPII('Firma o REGON 123456784 w rejestrze');
  expect(r.redacted.includes('[TELEFON]')).toBe(false);
  expect(r.redacted).toContain('123456784');
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
