# Anonimizator

[![CI](https://github.com/karolpolikarp/anonimizator/actions/workflows/ci.yml/badge.svg)](https://github.com/karolpolikarp/anonimizator/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/karolpolikarp/anonimizator)](https://github.com/karolpolikarp/anonimizator/releases)
[![Licencja MIT](https://img.shields.io/badge/licencja-MIT-blue.svg)](./LICENSE)

Lokalny anonimizator polskich danych osobowych (PII). Zamienia PESEL, NIP, REGON, numery kont,
numery dowodów, e-maile, telefony, adresy oraz imiona i nazwiska na neutralne placeholdery —
**zanim** tekst trafi do czatu z modelem językowym, e-maila, zgłoszenia czy bazy danych.

**Nikt niczego nie serwuje centralnie i nie przetwarza Twoich danych.** Pobierasz aplikację
z tego repozytorium i uruchamiasz na własnym komputerze — cała anonimizacja odbywa się
lokalnie, w Twojej przeglądarce. Możesz rozłączyć internet i sprawdzić.

![Aplikacja Anonimizator — tekst źródłowy po lewej, zredagowany wynik z podświetlonymi maskami po prawej](docs/screenshot.png)

## Pobierz i używaj (bez instalacji)

1. Wejdź w [**Releases**](https://github.com/karolpolikarp/anonimizator/releases) i pobierz
   `anonimizator-offline.zip`.
2. Rozpakuj i otwórz `index.html` **podwójnym kliknięciem** — aplikacja działa prosto z dysku,
   bez serwera, bez instalacji, bez internetu.
3. Wklej tekst albo upuść plik (`.txt`, `.docx`) — po prawej dostajesz wersję zredagowaną
   do skopiowania. Pliki Word są czytane w całości lokalnie, jak wszystko tutaj.

Alternatywnie sklonuj repo i odpal z kodu (sekcja „Dla programistów" niżej).

## Formy użycia — jeden silnik

- **Aplikacja w przeglądarce** (`apps/web`) — patrz wyżej; 100% offline.
- **Biblioteka npm** (`packages/core`, pakiet `anonimizator`) — zero zależności, działa w Node,
  Deno, Bun i przeglądarce.
- **CLI** — `anonimizator plik.txt`, także stdin → stdout do potoków.
- **Opcjonalny lokalny NER** (`services/ner`) — usługa spaCy PL na Twoim komputerze,
  podnosząca wykrywalność rzadkich nazwisk (szczegóły niżej).

```
Nazywam się Jan Kowalski, PESEL 44051401359, ul. Polna 12/3, tel. 600 700 800.
                                    │
                                    ▼
Nazywam się [IMIĘ I NAZWISKO], PESEL [PESEL], [ADRES], tel. [TELEFON].
```

## Dlaczego mało fałszywych trafień

Tam, gdzie format ma **sumę kontrolną** (PESEL, NIP, REGON, IBAN, nr dowodu), anonimizator ją
**weryfikuje** — przypadkowy ciąg 11 cyfr (sygnatura akt, numer sprawy) nie zostanie uznany za
PESEL. Dodatkowo strażnik kontekstu rozpoznaje odwołania do przepisów („art. 123 456 789",
„poz. …", „Dz.U. …") i nie maskuje ich jako telefonów. Redakcja jest **idempotentna** — ponowny
przebieg po zredagowanym tekście niczego nie psuje.

## Co wykrywa

| Dane | Metoda | Placeholder |
|---|---|---|
| PESEL | 11 cyfr + suma kontrolna | `[PESEL]` |
| NIP | 10 cyfr (też z myślnikami) + suma kontrolna | `[NIP]` |
| REGON | 9/14 cyfr + suma kontrolna | `[REGON]` |
| IBAN / nr konta | mod 97 lub kontekst „konto/rachunek" + 26 cyfr | `[NR-KONTA]` |
| Nr dowodu | 3 litery + 6 cyfr + suma kontrolna | `[NR-DOWODU]` |
| E-mail | wzorzec adresu | `[EMAIL]` |
| Telefon | 9 cyfr, opcjonalnie +48 | `[TELEFON]` |
| Kod pocztowy | XX-XXX | `[KOD-POCZTOWY]` |
| Data urodzenia | data z kontekstem „ur./urodzony" | `[DATA-URODZENIA]` |
| Adres | ul./al./os./pl. + nazwa + numer | `[ADRES]` |
| Imię i nazwisko | słownik ~200 polskich imion + wyzwalacze kontekstu („nazywam się", „Pan/Pani") | `[IMIĘ I NAZWISKO]` |

## Ograniczenia (przeczytaj przed użyciem)

Wykrywanie **imion i nazwisk warstwą podstawową jest heurystyczne** — rzadkie nazwisko bez
imienia ze słownika i bez wyzwalacza kontekstu może przejść niewykryte. Lukę domyka opcjonalny
lokalny NER (niżej), ale zasada pozostaje: to narzędzie pomocnicze — **zawsze przejrzyj wynik
przed udostępnieniem**.

## Opcjonalny lokalny NER (rzadkie i odmienione nazwiska)

Zdanie „Wczoraj Bąkiewicz podpisał umowę z Szczepankowską" nie zawiera ani imienia ze słownika,
ani wyzwalacza kontekstu — warstwa regex go nie zamaskuje. Rozwiązaniem jest **NER** (model
spaCy PL rozpoznający osoby z kontekstu zdania), uruchamiany **na Twoim komputerze**:

```bash
cd services/ner
docker compose up -d      # usługa na 127.0.0.1:8090 (tylko localhost)
```

Potem w aplikacji webowej zaznacz „Użyj lokalnego NER". Architektura jest **fail-safe**:

- NER dostaje tekst JUŻ po redakcji strukturalnej — **nigdy nie widzi** surowego PESEL/NIP;
- gdy usługa nie działa / nie odpowiada / przekroczy timeout, wynik zostaje na warstwie
  regex + sumy kontrolne — ochrona nigdy nie spada do zera;
- circuit breaker przestaje odpytywać padniętą usługę (3 porażki → 30 s przerwy).

Z biblioteki: `import { redactPIIFull } from 'anonimizator/ner'` —
`await redactPIIFull(tekst, { url: 'http://127.0.0.1:8090' })`.
Szczegóły: [`services/ner/README.md`](./services/ner/README.md).

## Użycie — biblioteka

```bash
npm install anonimizator
```

```ts
import { redactPII, hasPII, describeFindings } from 'anonimizator';

const { redacted, found } = redactPII('Mój PESEL to 44051401359');
// redacted → 'Mój PESEL to [PESEL]'
// found    → [{ type: 'PESEL', count: 1 }]

hasPII('czysty tekst');            // false
describeFindings(found);           // ['PESEL']
```

Opcjonalny drugi parametr pozwala wybrać typy i podmienić placeholdery:

```ts
// maskuj tylko PESEL i e-mail
redactPII(tekst, { types: ['PESEL', 'EMAIL'] });

// własny placeholder (bez cyfr i „@" — inaczej łamiesz idempotencję)
redactPII(tekst, { masks: { PESEL: '[UKRYTO]' } });
```

Eksportowane są też walidatory sum kontrolnych: `isValidPesel`, `isValidNip`, `isValidRegon9`,
`isValidRegon14`, `isValidIban`, `isValidDowod`.

**Ważne:** `found` zawiera wyłącznie typ i liczbę wystąpień — **nigdy oryginalne wartości**,
więc można go bezpiecznie logować.

## Użycie — CLI

```bash
npx anonimizator dokument.txt                  # wynik na stdout, statystyki na stderr
npx anonimizator dokument.txt --out czysty.txt
type dokument.txt | npx anonimizator           # Windows
cat dokument.txt | npx anonimizator            # Linux/macOS
```

## Dla programistów

```bash
npm install
npm run dev        # http://localhost:5173 (hot reload)
npm run build      # statyczne pliki w apps/web/dist — działają też otwarte prosto z dysku (file://)
npm test
```

Aplikacja nie ma backendu, analityki ani żadnych zapytań sieciowych — cała logika wykonuje
się w przeglądarce. Jedyny wyjątek to świadomie włączony lokalny NER (żądania idą wyłącznie
pod adres localhost wskazany przez użytkownika).

## Struktura repozytorium

```
packages/core/    # silnik redakcji (TS, zero zależności) + klient NER + CLI + testy (Vitest)
apps/web/         # statyczna aplikacja (Vite, bez frameworka), działa z file://
services/ner/     # opcjonalna lokalna usługa NER (Python/FastAPI + spaCy PL, Docker)
```

## Testy

```bash
npm test          # sumy kontrolne, maskowanie, fałszywe trafienia, idempotencja,
                  # opcje types/masks, fail-safe NER (mock), circuit breaker
```

## Roadmapa

- [ ] NER bez Dockera: model ONNX odpalany bezpośrednio w przeglądarce (transformers.js) —
      pełny recall nazwisk bez instalowania czegokolwiek.
- [x] Konfigurowalne placeholdery i wybór typów do maskowania (v0.2.0).
- [x] Obsługa plików DOCX w aplikacji webowej — ekstrakcja tekstu lokalnie (v0.3.0).
- [ ] Obsługa plików PDF (wymaga pdf.js — rozważane vs. rozmiar paczki offline).

## Pochodzenie

Silnik redakcji został wydzielony z produkcyjnego kodu [JakiePrawo.pl](https://jakieprawo.pl),
gdzie maskuje dane osobowe w pytaniach użytkowników, zanim trafią do modelu językowego
(zgodność z RODO). Reguły i testy regresji pochodzą z realnych przypadków.

## English (summary)

**Anonimizator** is a local-first redactor for Polish PII (personal data): PESEL, NIP, REGON,
IBAN and national ID numbers are validated against their checksums (very few false positives);
e-mails, phones, addresses and person names are matched heuristically, with an optional
self-hosted spaCy NER service for rare surnames. Ships as a zero-dependency npm library +
CLI (`anonimizator`), and a single-file offline web app (grab `anonimizator-offline.zip`
from Releases and just open `index.html` — nothing ever leaves your machine). MIT licensed.

## Licencja

MIT
