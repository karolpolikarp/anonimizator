<div align="center">

<img src="docs/parawan-banner.svg" alt="Parawan: lokalny anonimizator polskich danych osobowych" width="820">

<br>

**Usuwa dane osobowe z tekstu, zanim wkleisz go do czatu AI, wyślesz mailem albo udostępnisz gdziekolwiek dalej.**
Wszystko dzieje się na Twoim komputerze. Nic nie trafia do internetu.

<br>

[![CI](https://github.com/karolpolikarp/parawan/actions/workflows/ci.yml/badge.svg)](https://github.com/karolpolikarp/parawan/actions/workflows/ci.yml)
[![Wersja](https://img.shields.io/github/v/release/karolpolikarp/parawan?style=flat-square&color=0B3D2E&label=wersja)](https://github.com/karolpolikarp/parawan/releases/latest)
[![Licencja Apache 2.0](https://img.shields.io/badge/licencja-Apache%202.0-0B3D2E?style=flat-square)](./LICENSE)

![100% offline](https://img.shields.io/badge/aplikacja-100%25%20offline-0B3D2E?style=flat-square)
![bez AI](https://img.shields.io/badge/detekcja-bez%20AI-B9791F?style=flat-square)
![jeden plik HTML](https://img.shields.io/badge/dystrybucja-jeden%20plik%20HTML-0B3D2E?style=flat-square)
![zero zależności](https://img.shields.io/badge/zale%C5%BCno%C5%9Bci-zero-0B3D2E?style=flat-square)
![po polsku](https://img.shields.io/badge/j%C4%99zyk-polski-B9791F?style=flat-square)

**[🔗 parawan.karolwilczynski.com](https://parawan.karolwilczynski.com)** — strona produktu z **demo na żywo** (anonimizacja w przeglądarce, bez wysyłki)

</div>

---

**Parawan** to lokalny anonimizator polskich danych osobowych (PII). Zamienia PESEL, NIP, REGON, KRS, KSeF,
numery kont, numery dowodów i paszportów, prawo jazdy, nr rejestracyjny, VIN, adres IP/MAC, token,
e-maile, telefony, adresy, miejscowości, daty urodzenia oraz imiona i nazwiska na neutralne
etykiety, na przykład `Jan Kowalski` → `[IMIĘ I NAZWISKO]`, `44051401359` → `[PESEL]`.

> [!IMPORTANT]
> **Nikt nie serwuje niczego centralnie i nie przetwarza Twoich danych.** Pobierasz jeden plik
> i otwierasz go na własnym komputerze, cała anonimizacja dzieje się lokalnie, w Twojej
> przeglądarce. **Możesz rozłączyć internet i sprawdzić, że działa tak samo.**

<div align="center">

<img src="docs/screenshot.png" alt="Aplikacja Parawan, po lewej tekst źródłowy, po prawej wynik z kolorowymi znacznikami zamaskowanych danych" width="880">

<sub>Po lewej wklejasz tekst, po prawej od razu masz wersję z zamaskowanymi danymi. Każda kategoria ma swój kolor.</sub>

</div>

## ⬇️ Pobierz i użyj (30 sekund)

> [!TIP]
> Nie musisz nic instalować ani znać się na komputerach. To jeden plik, który otwierasz jak zdjęcie.

1. Wejdź w [**najnowsze wydanie (Releases)**](https://github.com/karolpolikarp/parawan/releases/latest)
   i pobierz **`Parawan.html`** (jeden plik, nic nie trzeba rozpakowywać).
2. Otwórz go **podwójnym kliknięciem**, uruchomi się w przeglądarce, prosto z dysku:
   bez serwera, bez instalacji, bez internetu.
3. **Wklej tekst** albo **upuść plik** (`.txt`, `.docx`, `.pdf`), po prawej dostajesz wersję
   zredagowaną do skopiowania. Word i PDF są czytane w całości lokalnie, jak wszystko tutaj.

> [!NOTE]
> W nagłówku aplikacji jest numer wersji z linkiem „sprawdź najnowszą", jeśli kiedyś coś nie
> działa, najpierw porównaj numer i pobierz świeży plik. Obok w wydaniu jest też `JAK-UZYC.txt`
> z tą samą instrukcją do wydrukowania lub rozesłania.

Działa też na komputerach **z blokadami firmowymi**, bo to zwykły dokument HTML,
a nie program do zainstalowania (`.exe`, `.bat`, serwer). To jest cała idea Parawana.

## 🟢 Jak to działa (w uproszczeniu)

> Ta sekcja jest dla **każdego**, także bez wiedzy technicznej. Reszta README jest bardziej techniczna.

**Co to robi.** Znajduje w tekście dane osobowe i zamienia je na neutralne etykiety, np.
`Jan Kowalski` → `[IMIĘ I NAZWISKO]`, `44051401359` → `[PESEL]`. Dzięki temu możesz spokojnie
wysłać treść dalej (do czatu z AI, e-maila, zgłoszenia), nie ujawniając, kogo dotyczy.

**Jak rozpoznaje dane (bez „sztucznej inteligencji").** To **deterministyczne reguły**: te same
dane zawsze dają ten sam wynik, nic nie „zgaduje" modelem:

- 🟤 **PESEL, NIP, REGON, numer konta (IBAN), numer dowodu, numer karty (Luhn)** mają *cyfrę/sumę kontrolną*, wbudowany
  w numer sprawdzian poprawności. Parawan go **przelicza**, więc przypadkowy ciąg cyfr (numer sprawy,
  sygnatura) **nie** zostanie pomylony z PESEL-em. → *mało fałszywych trafień.*
- 🔵 **E-mail** ma znak `@`, **telefon** to 9 cyfr, **kod pocztowy** to `XX-XXX`, rozpoznawane po wzorze.
- 🟣 **Imiona i nazwiska**: po słowniku polskich imion i nazwisk, po końcówkach (`-ski`, `-cki`,
  `-icz`) oraz po kontekście („Pan…", „zamieszkały w…", nagłówki formularzy).
- 📍 **Miejscowość** maskuje w kontekście adresu („ul. Kwiatowa 5, **Warszawa**"), ale **nie**
  w zwykłym zdaniu („spotkanie w Łodzi") ani w nazwie instytucji („Sąd Okręgowy w Katowicach"),
  żeby nie zasłaniać za dużo.

**Co możesz sam ustawić.** W panelu „Co maskować" włączasz i wyłączasz poszczególne rodzaje danych.
Opcja „Rozróżniaj osoby" nadaje tej samej osobie stałą etykietę (`[OSOBA-A]`, `[OSOBA-B]`),
przydatne w umowach i pismach, gdzie trzeba wiedzieć, kto jest kim, bez podawania nazwisk.

```text
Nazywam się Jan Kowalski, PESEL 44051401359, ul. Polna 12/3, tel. 600 700 800.
                                    │  za parawan…
                                    ▼
Nazywam się [IMIĘ I NAZWISKO], PESEL [PESEL], [ADRES], tel. [TELEFON].
```

## 🔒 Prywatność w praktyce: jak sprawdzić, że nic nie wychodzi

> [!IMPORTANT]
> **Gdzie trafiają Twoje dane? Nigdzie.** Aplikacja to jeden plik na Twoim komputerze. Cała praca
> dzieje się w przeglądarce. Nie ma logowania, konta ani chmury.

**Czego Parawan NIE robi** (świadomie):

| ❌ Nie robi tego | ✅ Zamiast tego |
|---|---|
| nie wysyła tekstu na serwer ani do internetu | wszystko liczy lokalnie, w przeglądarce |
| nie ma konta, logowania ani chmury | otwierasz plik i od razu działasz |
| nie zbiera analityki ani „telemetrii" | zero śledzenia, zero ciasteczek |
| nie używa modeli AI (w tym pliku) | wyłącznie reguły + słowniki + sumy kontrolne |
| nie dociąga niczego w tle podczas pracy | plik jest samowystarczalny (fonty, kod, wszystko w środku) |

**Skąd pewność, że tak jest naprawdę:**

1. **Sprawdź sam**, odłącz internet (wyłącz Wi-Fi / wyjmij kabel) i użyj aplikacji; zadziała tak samo.
2. **Kod jest otwarty** (Apache 2.0), każdy może go przeczytać albo poprosić o sprawdzenie
   znajomego informatyka. Nic nie jest ukryte.
3. **Plik jest samodzielny**, cały kod, fonty i słowniki są w jednym `Parawan.html`, bez pobierania.

## 🎨 Kolory znaczników

Każda kategoria danych ma swój kolor, ten sam w wyniku, w podsumowaniu i w tabeli niżej:

![Osoby](https://img.shields.io/badge/Osoby-%E2%97%8F-5B3FA8?style=flat-square)
![Kontakt](https://img.shields.io/badge/Kontakt-%E2%97%8F-0C7288?style=flat-square)
![Identyfikatory](https://img.shields.io/badge/Identyfikatory-%E2%97%8F-8A5F00?style=flat-square)
![Finanse](https://img.shields.io/badge/Finanse-%E2%97%8F-127049?style=flat-square)
![Adres](https://img.shields.io/badge/Adres-%E2%97%8F-2F5FC0?style=flat-square)

## 📋 Co wykrywa

Ponad 20 typów danych w 5 kategoriach, każdy z **walidacją** (suma kontrolna) albo **kotwicą
kontekstową**, dlatego trafień „na ślepo" jest mało.

| Dane | Metoda | Placeholder |
|---|---|---|
| 🟤 PESEL | 11 cyfr + suma kontrolna (lub przy etykiecie „PESEL" mimo złej sumy) | `[PESEL]` |
| 🟤 NIP | 10 cyfr (też z myślnikami) + suma kontrolna (lub przy etykiecie „NIP") | `[NIP]` |
| 🟤 REGON | 9/14 cyfr + suma kontrolna (lub przy etykiecie „REGON") | `[REGON]` |
| 🟢 IBAN / nr konta | mod 97 lub kontekst „konto/rachunek/IBAN" (też format IBAN mimo złej sumy) | `[NR-KONTA]` |
| 🟢 Karta płatnicza | kontekst „karta/Visa/Mastercard/Amex…" + 13–19 cyfr, prefiks sieci + suma Luhna | `[NR-KARTY]` |
| 🟤 Nr dowodu | 3 litery + 6 cyfr (+ suma kontrolna bez kontekstu) | `[NR-DOWODU]` |
| 🟤 Nr paszportu | kontekst „paszport" + 2 litery + 7 cyfr | `[NR-PASZPORTU]` |
| 🟤 Numer KRS | kontekst „KRS" + 10 cyfr (też z zerami wiodącymi) | `[KRS]` |
| 🟤 Numer KSeF | słowo „KSeF" gdziekolwiek w dokumencie + numer faktury `NIP-RRRRMMDD-znaki-suma` (też stary format 36-znakowy) z **sumą kontrolną NIP-u** w pierwszym członie | `[NR-KSEF]` |
| 🟤 Nr prawa jazdy | kontekst „prawo jazdy" + numer (z cyfrą) | `[PRAWO-JAZDY]` |
| 🟤 Nr rejestracyjny | kontekst „rejestracyjny/tablica/pojazd" + tablica (np. WI1234K); wyliczenia po przecinku i „oraz/i" z walidacją wyróżnika wojewódzkiego | `[NR-REJESTRACYJNY]` |
| 🟤 VIN | 17 znaków bez I/O/Q; kontekst „VIN/nadwozia" lub wyraźny układ VIN | `[VIN]` |
| 🟤 Adres IP | IPv4 (oktety 0–255) oraz IPv6 (numery wersji „1.2.3.4" pomijane) | `[IP]` |
| 🟤 Adres MAC | 6 par hex (00:1A:2B:3C:4D:5E) | `[MAC]` |
| 🟤 Token / JWT | `eyJ…` (base64), może dawać dostęp | `[TOKEN]` |
| 🟤 Login | kontekst „login/username/nazwa użytkownika" + wartość (też w cudzysłowie) | `[LOGIN]` |
| 🔗 URL | całe adresy chronione; wewnątrz maskowane wartości parametrów osobowych (`?user=`, `?email=`, `?token=`…) | wg typu |
| 🔵 E-mail | wzorzec adresu (w URL-ach także forma `%40`) | `[EMAIL]` |
| 🔵 Telefon | 9 cyfr, opcjonalnie +48 (też „+48.512.345.678"), nawiasy, kropki z kotwicą; wyliczenia po przecinku i „oraz/i" | `[TELEFON]` |
| 🔵 Kod pocztowy | XX-XXX | `[KOD-POCZTOWY]` |
| 🟣 Data urodzenia | data z kontekstem „ur./urodzony", cyfrowa i słowna („5 maja 1985") | `[DATA-URODZENIA]` |
| 🔵 Adres | ul./al./os./pl. + nazwa + numer (też „3 Maja", „gen./ks./św.") | `[ADRES]` |
| 🔵 Miejscowość | w adresie i przy zamieszkaniu; **nie** w prozie/instytucji | `[MIEJSCOWOŚĆ]` |
| 🟣 Imię i nazwisko | słownik imion + nazwisk (z odmianą), **morfologia** (-ski/-cki/-icz/-czyk), kolejność odwrócona, wyzwalacze kontekstu | `[IMIĘ I NAZWISKO]` |
| 🧩 Pola formularza / XML / JSON | „Nazwisko:", tag `<Surname>`, klucz `"lastName"` jako kotwica, maskowana sama wartość, struktura zostaje | wg typu |
| 🔎 Błędy OCR | homoglify 0→O / 1→l walidowane słownikiem („J0AN K0WALSKI", „uI. Lip0wa 15") | wg typu |

## ⚠️ Ograniczenia (koniecznie przeczytaj)

> [!WARNING]
> To narzędzie **pomocnicze, nie gwarancja**. **Zawsze przejrzyj wynik przed udostępnieniem.**
> Wynik masz od razu obok, z podświetleniem, strzałkami `‹ ›` przejdziesz po kolei przez
> zamaskowane fragmenty, a najechanie kursorem pokaże powód każdej maski.

Wykrywanie **imion i nazwisk warstwą podstawową jest heurystyczne**. Łapie nazwiska ze słownika
(z odmianą), nazwiska o charakterystycznym polskim sufiksie **morfologicznie** (-ski/-cki/-dzki,
-icz/-wicz, -czyk, także rzadkie i odmienione, np. „Gzowskiego", „Bąkiewiczowi"), pary imię+nazwisko
i kolejność odwróconą oraz wyzwalacze kontekstu. Poza zasięgiem warstwy offline zostają głównie
**nazwiska bez polskiego sufiksu, spoza słownika i bez kontekstu** (np. obce: „Nguyen", „Grynberg").
Domyka je opcjonalny dodatek AI (osobny projekt, niżej).

> [!NOTE]
> Benchmark warstwy offline (deterministyczny zbiór, [`docs/BENCHMARK.md`](docs/BENCHMARK.md)):
> **recall 100%, precyzja-proxy 99,4%** (rdzeń, bez NER).

## 🤖 Rozszerzenie AI (osobny dodatek, tylko lokalnie)

Nazwiska **bez polskiego sufiksu, spoza słownika i bez kontekstu** domyka **opcjonalny dodatek AI**
w osobnym repozytorium: [**anonimizator-ai**](https://github.com/karolpolikarp/anonimizator-ai).

- Warstwa NER (spaCy/HerBERT/ONNX) i eksperymentalny lokalny LLM, wszystko **na Twoim komputerze**.
- Architektura **fail-safe**: AI dostaje tekst już po redakcji strukturalnej i może jedynie
  zamaskować *więcej*, nigdy odsłonić. **Ten plik `Parawan.html` działa bez niego.**
- Po co osobno: AI wymaga mini-serwera i pobrania modelu (~125 MB), to łamie obietnicę „jeden plik,
  zero instalacji", która jest wartością główną Parawana.

---

<details>
<summary><b>👩‍💻 Dla programistów: biblioteka, CLI, build</b> (kliknij, aby rozwinąć)</summary>

<br>

Silnik to pakiet npm `anonimizator` (nazwa techniczna pakietu; marka produktu to **Parawan**).
Zero zależności, działa w Node, Deno, Bun i przeglądarce.

### Biblioteka

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
redactPII(tekst, { types: ['PESEL', 'EMAIL'] });        // maskuj tylko PESEL i e-mail
redactPII(tekst, { masks: { PESEL: '[UKRYTO]' } });     // własny placeholder (bez cyfr i „@")

// spójna pseudonimizacja: ta sama osoba → ta sama etykieta (także w odmianie)
redactPII('Kowalski pozwał Nowaka. Kowalskiemu zależy na ugodzie.', { pseudonyms: true });
// → '[OSOBA-A] pozwał [OSOBA-B]. [OSOBA-A] zależy na ugodzie.'
```

Eksportowane są też walidatory sum kontrolnych: `isValidPesel`, `isValidNip`, `isValidRegon9`,
`isValidRegon14`, `isValidIban`, `isValidDowod`.

> `found` zawiera wyłącznie typ i liczbę wystąpień (**nigdy oryginalne wartości**), więc można go
> bezpiecznie logować.

### CLI

```bash
npx anonimizator dokument.txt                  # wynik na stdout, statystyki na stderr
npx anonimizator dokument.txt --out czysty.txt
type dokument.txt | npx anonimizator           # Windows
cat  dokument.txt | npx anonimizator           # Linux/macOS
```

### Uruchomienie z kodu

```bash
npm install
npm run dev        # http://localhost:5173 (hot reload)
npm run build      # apps/web/dist/index.html, działa też otwarty prosto z dysku (file://)
npm test
```

Aplikacja nie ma backendu, analityki ani żadnych zapytań sieciowych, cała logika wykonuje się
w przeglądarce, a plik HTML nie łączy się z niczym.

### Struktura repozytorium

```
packages/core/    # silnik redakcji (TS, zero zależności) + CLI + testy (Vitest)
apps/web/         # aplikacja (Vite, bez frameworka) → jeden samowystarczalny HTML, działa z file://
```

Warstwa AI (NER/LLM) jest osobnym dodatkiem
([anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai)). Rdzeń nadal eksportuje
wejścia `anonimizator/ner`, `anonimizator/ner-postprocess`, `anonimizator/llm`, to szew, w który
wpina się dodatek.

</details>

## 🐛 Znalazłeś błąd? Pomóż ulepszyć Parawana

- **Coś nie zostało zamaskowane** (a powinno) → [zgłoś nierozpoznane PII](https://github.com/karolpolikarp/parawan/issues/new?template=nierozpoznane-pii.md)
- **Zamaskowało za dużo** (coś, co nie jest daną osobową) → [zgłoś fałszywe trafienie](https://github.com/karolpolikarp/parawan/issues/new?template=falszywe-trafienie.md)

W zgłoszeniu **nie podawaj prawdziwych danych osobowych**, wystarczy przykład o tym samym kształcie
(np. `Nguyen` zamiast prawdziwego nazwiska). PR-y mile widziane.

## 📜 Pochodzenie

Silnik redakcji został wydzielony z produkcyjnego kodu [JakiePrawo.pl](https://jakieprawo.pl),
gdzie maskuje dane osobowe w pytaniach użytkowników, zanim trafią do modelu językowego (zgodność
z RODO, zasada minimalizacji danych). Reguły i testy regresji pochodzą z realnych przypadków.

## 🇬🇧 English (summary)

**Parawan** is a local-first redactor for Polish PII: PESEL, NIP, REGON, IBAN and national ID numbers
are validated against their checksums (very few false positives); e-mails, phones, addresses and
person names are matched heuristically, **no AI, deterministic rules only**. Ships as a
zero-dependency npm library + CLI (`anonimizator`) and a **single-file offline web app** (grab
`Parawan.html` from Releases and just double-click it, nothing ever leaves your machine). An optional
local-only AI add-on for rare/foreign surnames lives in a separate repo:
[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai). Apache 2.0 licensed.

## ⚖️ Licencja

Apache 2.0, patrz [LICENSE](./LICENSE) i [NOTICE](./NOTICE). Wydania do v0.45.0 włącznie były
publikowane na licencji MIT. Fonty marki (Archivo, IBM Plex Mono), SIL OFL 1.1, patrz
[`apps/web/src/fonts/LICENSE-FONTS.md`](apps/web/src/fonts/LICENSE-FONTS.md).
