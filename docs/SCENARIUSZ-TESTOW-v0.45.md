# Scenariusz testów do wykonania — domknięcie weryfikacji v0.45.0

Stan na 2026-07-12. Wydanie v0.45.0 przeszło pełną weryfikację automatyczną:
272 testy rdzenia, 18 testów web, typecheck, build obu edycji, bramka benchmarku
(4 warstwy: core F1 96,7%, +spacy 99,4%, +fastpdn 99,2%, +onnx 99,0%; kategorie
wymagane 100/100). Audyt adwersarialny wykonał się dla 2 z 7 obszarów (URL/LOGIN —
6 znalezisk naprawionych i pokrytych testami; pełny protokół regresyjny — czysto).
**Do dokończenia na potem: 5 obszarów audytu (sekcja 3) + testy ręczne UI (sekcja 2).**

## 1. Szybka weryfikacja automatyczna (przed każdą zmianą detekcji)

```bash
npm run build -w anonimizator && npm run test -w anonimizator
node scripts/benchmark/run.mjs --check
```

## 2. Mikrotesty do wklejenia w UI (oczekiwania przy każdym bloku)

### A. Telefony z kropkami
```
Kontakt: 512.345.678, +48.512.345.678 oraz stacjonarny 22.501.23.45.
Kontrola pozytywna: 600 700 800 i (22) 501-23-45.
```
Oczekiwane: 5 × `[TELEFON]`. Pułapki (mają ZOSTAĆ): `Data 12.05.1990`,
`wersja 10.2.3`, `Kwota 1.234.567 zł`, `Numer seryjny urządzenia: 745.812.903`
(kropkowy bez kotwicy — świadoma polityka).

### B. Tablice w wyliczeniu
```
Zabezpieczono pojazdy: WW 1234A, ZS 4567, WE 123AB, PO 5AB67, KR 8XY90, DW 12345, WGM 1234.
Na parkingu stały też GD 707GG oraz PZE 5U678.
Kontrola pozytywna: pojazd o nr rejestracyjnym WA 12345.
```
Oczekiwane: 10 × `[NR-REJESTRACYJNY]`. Pułapki (mają ZOSTAĆ):
`Rozporządzenie (WE) nr 1234/2009`, `dyrektywa WE 123`, `BMW 320D`, `KIA CEED2`.

### C. XML / JSON
```
<Customer><Name>Jan</Name><Surname>Kowalski</Surname><Street>Leśna 15</Street><City>Warszawa</City></Customer>
{ "firstName": "Jan", "lastName": "Kowalski", "city": "Warszawa", "street": "Lipowa 12" }
```
Oczekiwane: wartości zamaskowane, tagi/cudzysłowy nietknięte, JSON parsowalny.
Pułapka: `<Name>Produkt X200</Name>` zostaje.

### D. Błędny OCR
```
J0AN K0WALSKI
teI:
501234567
uI. Lip0wa 15

Warszawa
```
Oczekiwane: osoba, `[TELEFON]`, `[ADRES]`, `[MIEJSCOWOŚĆ]`. Pułapki (zostają):
`SN-44A8-9912-XXA`, `LT-8844-PL`, `USR-005182`, nagłówki `CZĘŚĆ IV`, `WERSJA KOŃCOWA`.

### E. URL + LOGIN
```
https://portal.example.com/ticket?id=123456789&user=tomasz.kaminski&email=jan%40example.com
https://app.firma.pl/callback#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abcDEF
Login użytkownika:
tkaminski
Wylogowanie użytkownika «tkaminski» o 16:02. Login: „jkowalski”.
```
Oczekiwane: `user=[LOGIN]`, `email=[EMAIL]`, `#access_token=[TOKEN]` (domena
i `id=` zostają, URL NIEROZERWANY); loginy → `[LOGIN]` we wszystkich wystąpieniach.
Pułapki (zostają): `Identyfikator w systemie: USR-005182`, puste `Login:` przed
kolejną etykietą, `konto „Firmowe”`.

### F. Miasto po adresie
```
Biuro przy ul. Morskiej 12 w Gdańsku czynne.
Spotkanie projektowe odbyło się w Gdańsku.
```
Oczekiwane: pierwsza linia `przy [ADRES] w [MIEJSCOWOŚĆ]`; druga NIETKNIĘTA.

## 3. Audyt adwersarialny — obszary do dokończenia (przerwany limitem sesji)

Metoda: patrz pamięć projektu `weryfikacja-precyzji-audyt-adwersarialny` — agenci
generują realistyczne pisma, przepuszczają przez `redactPII()` (import z
`packages/core/dist/index.js`) i zgłaszają wyłącznie twarde defekty (leak /
overmask / broken-structure), każdy weryfikowany reprodukcją + polityką precyzji.

| Obszar | Co atakować |
|---|---|
| telefony | kropki z różnymi kotwicami, wyliczenia z wypełniaczami, przełamania linii; pułapki: kwoty, daty, wersje, numery seryjne, lp., art., godziny |
| tablice | wyliczenia, przerwy kotwica→tablica, formaty tablic; pułapki: normy PN-EN/ISO, drogi DK 91, akty (WE), kody pocztowe obok słowa „pojazd" |
| xml-json | zagnieżdżenia, atrybuty, snake_case, tablice JSON, wartości puste/b.d.; wynik musi się parsować; idempotencja |
| ocr-caps | homoglify 0/1/I, pary WERSALIKAMI; pułapki: nagłówki dokumentów, skróty (VAT UE), identyfikatory, miesiące rzymskie |
| adresy-miasta | bloki wielolinijkowe, „przy … w <miasto>"; pułapki: „w Polsce", „w Areszcie", instytucje za adresem, gołe „w Gdańsku" w prozie (MA zostać) |

## 4. Nie ruszone w tym cyklu (do rozważenia w przyszłości)

Pakiet „enterprise" z raportów testera (I + II, stan po v0.45.1 — poprawione już:
powiat/województwo, imię w nazwie pliku, homoglif I w środku nazwiska):

- **Alias** (`Alias:\nadam1986`) — kandydat na rozszerzenie kotwic typu `LOGIN`.
- **Hostname / nazwa komputera** (`AKOWALSKI-PC`, `AKOWALSKI-LAPTOP`) — nowy typ
  `[HOSTNAME]`? Uwaga: nazwa zawiera nazwisko, więc to realny wyciek.
- **Drukarka / ścieżka UNC** (`\\PRINT01\AdamK`).
- **Loginy w ŚCIEŻKACH URL-i**: `bank.example.com/user/akowalski`,
  `github.com/akowalski`, `gitlab…/akowalski`, `linkedin.com/in/adamkowalski`,
  `sharepoint.com/personal/adam_kowalski_company_com` — dziś świadomie maskujemy
  tylko parametry query (polityka precyzji); segmenty `/user/`, `/in/`, `/personal/`
  to mocne kotwice — do rozszerzenia.
- Uchwyty Teams/Slack/Discord/Telegram, ścieżki plików z nazwiskami
  (`C:\Users\Tomasz Kamiński\…`, `/home/jkowalski`), podpisy `CN=…`, autor dokumentu.
- **Granularność masek w XML/JSON**: tester sugeruje `[IMIĘ]`/`[NAZWISKO]` zamiast
  `[IMIĘ I NAZWISKO]`/`[OSOBA-X]` dla kluczy `firstName`/`lastName` (kosmetyka,
  wymaga nowych placeholderów).
- **HTML**: `<p>Piastów</p>` — goła miejscowość bez kotwicy zostaje (świadoma
  polityka); rozważyć kotwicę strukturalną dla bloków adresowych w HTML.
- Ścieżka wczytywania pliku (.docx/.pdf) i widok Porównanie w UI.
