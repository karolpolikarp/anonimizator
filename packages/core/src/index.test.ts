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
