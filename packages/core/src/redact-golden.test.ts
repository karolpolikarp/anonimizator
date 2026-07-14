/**
 * GOLDEN-MASTER — zamrożony obraz zachowania `redactPII` (sieć bezpieczeństwa refaktoru).
 *
 * Po co: silnik nie miał ani jednego testu pełnego wyniku (`toMatchSnapshot`), więc zestaw
 * asercji jednostkowych + bramka benchmarku NIE gwarantowały identyczności wyniku bit-w-bit.
 * Ten plik zamraża `redactPII(...).redacted` na całym korpusie ewaluacyjnym (ten sam, którego
 * używa benchmark — deterministyczny, seed stały) w trzech wariantach opcji ORAZ na celowanym
 * zbiorze adwersarialnym. Każda zmiana zachowania (nawet o jeden znak) wywala snapshot — to
 * twarde kryterium „zero zmian zachowania" przy sprzątaniu/refaktorze silnika.
 *
 * Snapshot wygenerowano RAZ na wydanym, zweryfikowanym kodzie (v0.46.8 / rdzeń 0.29.2).
 * Jeśli snapshot się rozjedzie po refaktorze, który MIAŁ być czysto strukturalny — to dowód
 * regresji, nie powód do zaktualizowania snapshotu. Snapshot wolno zregenerować WYŁĄCZNIE,
 * gdy zmiana zachowania jest ŚWIADOMA i opisana w CHANGELOG.
 *
 * Korpus pochodzi z `scripts/benchmark/dataset.mjs` (buildDataset() → { seed, cases }).
 * Oracle datasetu importuje walidatory z `packages/core/dist` — dlatego rdzeń musi być
 * zbudowany przed uruchomieniem (`npm run build -w anonimizator`), tak jak w CI.
 */
import { expect, test } from 'vitest';
import { redactPII, type PiiType } from './index';
// dataset.mjs to plain-JS oracle benchmarku (bez deklaracji typów) — import bez typowania.
// @ts-expect-error — brak pliku deklaracji dla modułu .mjs (świadomie, to skrypt benchmarku)
import { buildDataset } from '../../../scripts/benchmark/dataset.mjs';

interface Case {
  id: string;
  category: string;
  text: string;
}
const cases: Case[] = buildDataset().cases;

/** Mapowanie id → wynik redakcji — czytelny, stabilny obraz do snapshotu. */
function redactAll(opts?: { pseudonyms?: boolean; types?: PiiType[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of cases) out[c.id] = redactPII(c.text, opts).redacted;
  return out;
}

test('golden: korpus benchmarku — wariant domyślny (wszystkie typy)', () => {
  expect(redactAll()).toMatchSnapshot();
});

test('golden: korpus benchmarku — pseudonimizacja osób ([OSOBA-A]…)', () => {
  expect(redactAll({ pseudonyms: true })).toMatchSnapshot();
});

// Wariant z filtrem `types` — inna ścieżka bramkowania `on()`. Maskujemy TYLKO dane
// strukturalne (bez osób/adresów), żeby zamrozić także zachowanie filtra typów.
const STRUCT_ONLY: PiiType[] = ['PESEL', 'NIP', 'REGON', 'IBAN', 'NR-KONTA', 'EMAIL', 'TELEFON'];
test('golden: korpus benchmarku — filtr types (tylko strukturalne)', () => {
  expect(redactAll({ types: STRUCT_ONLY })).toMatchSnapshot();
});

// ── Zbiór adwersarialny — celuje w strażniki dotykane przez helpery A2–A5 ──
// Każdy wpis broni konkretnej granicy precyzji (patrz komentarze w index.ts). Zamrożenie ich
// osobno daje czytelny, samodokumentujący się obraz „co ma zostać, a co zniknąć".
const ADVERSARIAL: Record<string, string> = {
  'krs-literal': 'Spółka wpisana do KRS 0000123456 w rejestrze przedsiębiorców.',
  'nip-etykieta': 'NIP: 527-10-40-458 oraz drugi NIP 1234567890 w piśmie.',
  'nip-zla-suma': 'Numer 1234567891 nie jest poprawnym NIP-em (zła suma).',
  'pesel-etykieta-nowa-linia': 'Dane pacjenta\nPESEL:\n44051401359\nOddział: kardiologia',
  'regon-etykieta': 'REGON 123456785 oraz REGON: 00000000 w nagłówku.',
  'iban-i-konto': 'Nr konta do zwrotu: PL61 1090 1014 0000 0712 1981 2874, rachunek bankowy.',
  'karta-visa': 'Do zwrotu na kartę 4111 1111 1111 1111, dziękuję.',
  'karta-mastercard': 'Płatność kartą 5555-5555-5555-4444 zaksięgowana.',
  'karta-amex': 'Karta Amex 378282246310005 na fakturze.',
  'nie-karta-16cyfr': 'Zamówienie nr 1111222233334444 w systemie (to nie karta).',
  'karta-po-art': 'Zgodnie z art. 4111 1111 1111 1111 (odwołanie, nie karta).',
  'legal-ref-nie-telefon': 'Zgodnie z art. 123 456 789 Kodeksu cywilnego oraz § 12 ust. 3.',
  'sygnatura-akt': 'Sygn. akt II CSK 234/19 rozpoznano na rozprawie.',
  'miasto-wielowyraz-kod': 'Adres: 33-300 Nowy Sącz, ul. Długa 5.',
  'miasto-zielona-gora': 'Mieszka w 65-001 Zielona Góra przy alei Wojska Polskiego 1.',
  'miasto-przed-adresem': 'Warszawa, ul. Marszałkowska 1 — siedziba spółki.',
  'adres-pelny': 'Zamieszkały przy ul. Polnej 12/3, 00-950 Warszawa.',
  'telefon-plus48': 'Kontakt telefoniczny: +48 600 700 800 lub 601-202-303.',
  'email-diakrytyka': 'Adres: piotr.wiśniewski@przykład.pl w nagłówku wiadomości.',
  'url-ochrona': 'Zobacz https://example.com/user?name=Kowalski&email=jan@x.pl w systemie.',
  'para-osoba': 'Sprawę prowadzi pan Bąkiewicz wraz z radcą Trzebiatowskim.',
  'pseudonim-powtorzenie': 'Jan Kowalski i Anna Kowalska. Kowalski złożył wniosek, Kowalska podpisała.',
  'lowercase-run': 'od jan kowalski dostałem pismo, z marek górski rozmawiałem wczoraj.',
  'xml-json-klucze': '{"firstName":"Jan","lastName":"Kowalski","pesel":"44051401359"}',
  'dowod-walidacja': 'Dowód osobisty ABA300000 oraz kwota PLN 300000 do wypłaty.',
  'data-urodzenia': 'Ur. 12 marca 1985 r. w Krakowie, obecnie emeryt.',
  'vin-mac-ip': 'VIN: 1HGCM82633A004352, MAC 00:1A:2B:3C:4D:5E, IP 192.168.1.1.',
};

test('golden: zbiór adwersarialny — wariant domyślny', () => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ADVERSARIAL)) out[k] = redactPII(v).redacted;
  expect(out).toMatchSnapshot();
});

test('golden: zbiór adwersarialny — pseudonimizacja', () => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ADVERSARIAL)) out[k] = redactPII(v, { pseudonyms: true }).redacted;
  expect(out).toMatchSnapshot();
});

// ── Idempotencja — placeholdery nie zawierają cyfr ani „@", więc drugi przebieg nic nie zmienia ──
test('idempotencja: redactPII(redactPII(x)) === redactPII(x) na całym korpusie', () => {
  for (const c of cases) {
    const once = redactPII(c.text).redacted;
    const twice = redactPII(once).redacted;
    expect(twice).toBe(once);
  }
});

test('idempotencja: także z pseudonimizacją', () => {
  for (const c of cases) {
    const once = redactPII(c.text, { pseudonyms: true }).redacted;
    const twice = redactPII(once, { pseudonyms: true }).redacted;
    expect(twice).toBe(once);
  }
});
