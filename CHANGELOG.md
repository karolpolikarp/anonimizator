# Changelog

## v0.19.0 — 2026-07-06

Wydanie skrojone pod główną grupę docelową — **urzędników** (feedback z testów na realnych
pismach). Wersja dla prawników/zaawansowanych przyjdzie osobno.

- **Release = jeden plik + instrukcja.** Zasób wydania to teraz `Anonimizator.html`
  (samowystarczalny, podwójny klik) i `JAK-UZYC.txt` — koniec z ZIP-em, launcherem i AI
  w paczce. **Cała wiedza (NER, launcher, ONNX, LLM) zostaje w repozytorium** — znika
  wyłącznie z wydania. Build „urzędnik" (`VITE_EDITION=urzednik`) ukrywa warstwę AI/NER
  (elementy `[data-full]`) już od pierwszego malowania, bez mignięcia.
- **Telefony stacjonarne z +48** — naprawiony realny błąd z pism: numer
  `+48 22 245 59 22` (podział 2-3-2-2) zostawał jawny, bo detektor zakładał tylko układ
  3-3-3. Teraz prefiks `+48/0048` dopuszcza dowolne grupowanie 9 cyfr, a słowa
  kontekstowe (`tel.`, `telefon`, `kom.`, `fax`) też wyzwalają maskowanie stacjonarnych.
- **Nr dowodu osobistego z kontekstem** — słowa `dowód/dowodu/seria i numer/nr dowodu`
  (z diakrytykiem i bez) maskują numer `ABC 123456` nawet bez poprawnej sumy kontrolnej;
  bez kontekstu nadal wymagana suma (mało fałszywych trafień). „dowód zakupu" nie jest
  mylony z dowodem osobistym.

## v0.18.0 — 2026-07-06

- **AI jednym kliknięciem, bez Dockera** — launcher `START-ANONIMIZATOR.bat` +
  `launcher/serve.ps1`: mini-serwer na `127.0.0.1` (zwykły `TcpListener`, bez uprawnień
  administratora, bez zależności) podaje aplikację po `http`, dzięki czemu model
  ONNX w przeglądarce rusza po podwójnym kliknięciu. Launcher trafia do paczki offline;
  instrukcja krok po kroku: [`docs/AI-BEZ-DOCKERA.md`](./docs/AI-BEZ-DOCKERA.md).
  Odpowiedź na feedback: „większość urzędników nie zainstaluje Dockera”.
- **NER przeprojektowany na „AI, opcjonalne”** — karta zwinięta domyślnie (mniej
  natłoku), prowadzi ścieżką przeglądarkową (Docker zdegradowany do „zaawansowane”),
  status widoczny na zwiniętym nagłówku. Selektor źródła zawsze dostępny (koniec
  uwięzienia użytkowników Dockera bez paczki ONNX).
- **Czytelniejsza legenda kategorii** — duże kolorowe kropki zamiast maleńkich ikon,
  wyraźniejsze etykiety i kontrast (feedback: „wiersz słabo widoczny, ikonki za małe”).
- **Mniej natłoku** — tabela „Co wykrywa” zwinięta domyślnie (czysty widok narzędzia,
  szczegóły po kliknięciu).

## v0.16.0 — 2026-07-05

- **Ikony wróciły** (sprite użytkownika) — nagłówek, przyciski, karty ustawień;
  na stonowanych kafelkach wpasowanych w ton enterprise.
- **Wypełnienie ekranu**: sekcja „Co wykrywa" w układzie dwukolumnowym —
  tabela + boczna kolumna trzech kart („Dlaczego mało fałszywych trafień",
  „Ograniczenia", „Wskazówki" ze skrótami klawiszowymi w stylu <kbd>);
  całość poszerzona do 1320 px. Koniec pustych flanków na szerokich ekranach.

## v0.15.0 — 2026-07-05

**Ułożenie treści** (architektura informacji):

- Hero odchudzone: wielkie pudło prywatności → smukła linijka pod badge'ami
  (komunikat „100% Offline" niesie już badge); mniej dublowania, szybciej do narzędzia.
- **Kroki 1→4 przeniesione NAD narzędzie** jako kompaktowy poziomy pasek
  (numer + tytuł + krótki opis) — edukacja przed użyciem, bez spychania panelu;
  znika duża sekcja kroków z dołu strony.
- **Tabela „Co wykrywa" pogrupowana kategoriami** w kolejności: identyfikatory →
  finanse → kontakt → adres/czas → osoby, z kolorowymi kropkami zgodnymi ze
  znacznikami w wyniku — treść strony i wynik mówią jednym językiem;
  zaktualizowany opis wiersza „Imię i nazwisko" (~230 nazwisk z odmianą).

## v0.14.0 — 2026-07-05

**Repozycjonowanie stylu: dark enterprise zamiast „cyber-gaming"** (feedback:
„zbyt gamingowo, za mało profesjonalnie"):

- Usunięte: siatka i kolorowe poświaty tła, neonowe glow na kartach/CTA/badge'ach,
  gradientowy tytuł, prefiks `//` nagłówków, kreskówkowe ikony ze sprite'a
  w przyciskach (zostaje favicon).
- W zamian: płaskie powierzchnie z subtelną elewacją, czysty wordmark, jednolite
  spokojne badge'e, pełny solidny akcent #3663d9, minimalistyczne kroki 1→4,
  mniejsze promienie (8–12px), typografia w duchu Linear/Vercel.
- Kolory znaczników PII zostają (funkcja czytania wyniku), ale w stonowanych
  odcieniach; przekreślenia w Porównaniu przygaszone.

## v0.13.0 — 2026-07-05

**Przestrzeń i hierarchia** (feedback: „więcej oddechu, lepszy układ, lepsza kolejność"):

- Wycentrowane hero z dużym światłem (tytuł 2.9rem, tagline, badge'e i plakietka
  prywatności na osi), sekcje rozsunięte do 5.5–6rem, stopka wycentrowana.
- **Ustawienia w dwóch kartach obok siebie** („Co maskować" | „Dokładniejsze
  wykrywanie nazwisk") — koniec pionowego ścisku pod narzędziem; na mobile
  wracają do jednej kolumny.
- Większe wszystko: padding paneli 1.75rem, pola 360px z paddingiem 1.3rem,
  odstęp paneli 2rem, kroki z gap 2rem, komórki tabeli 0.85/1.2rem,
  delikatniejsza siatka tła.

## v0.12.0 — 2026-07-04

- **Widok „Porównanie"** — recenzja jak w Wordzie: oryginalna wartość przekreślona
  na czerwono obok kolorowego znacznika, w jednym dokumencie. Przełącznik
  Wynik | Porównanie w panelu wyniku; po wczytaniu pliku (DOCX/PDF/TXT) tryb
  porównania włącza się automatycznie. Diff w O(n) bez bibliotek (nie-maskowe
  segmenty wyniku występują w oryginale dosłownie i po kolei).
- **Oddech**: większe światło w całym układzie (padding paneli/pól/tabeli,
  odstępy sekcji 4rem, delikatniejsza siatka tła) — czytelniej i bardziej
  profesjonalnie, klimat „2027" bez zmian.

## v0.11.0 — 2026-07-04

**Pełny redesign wizualny „2027"** (kierunek: cyber-privacy, na bazie UI-kitu użytkownika):

- Dark-only: głęboki granat z techniczną siatką i poświatami (czysty CSS, zero
  zewnętrznych zasobów — single-file bez zmian architektury).
- Gradientowy tytuł ze świecącą plakietką, rząd badge'ów (100% Offline / Bezpieczne /
  Open Source·MIT / Reguły+lokalne AI), pasek kroków 1→4, nagłówki sekcji w stylu `//`.
- **Kolorowe znaczniki per kategoria PII** — spójnie w wyniku i chipach:
  osoby=fiolet, kontakt=cyjan, identyfikatory=bursztyn, finanse=zieleń,
  adres/czas=błękit. Wynik czyta się na pierwszy rzut oka.
- Świecące CTA (gradient + glow), neonowe stany hover/focus/drag, tabela
  z hover-em wierszy, sekcja ograniczeń z bursztynową listwą.
- Weryfikacja: pełnostronicowe zrzuty desktop/mobile (0 px poziomego overflow),
  regresja NER ONNX 4/4.

## v0.10.0 — 2026-07-04

Duży szlif UX/UI po audycie panelu 5 agentów (5 soczewek, 39 znalezisk — wdrożone
wszystkie P0, komplet P1 i większość P2):

- **Mobile naprawione na dobre**: przyciski przenoszą się do własnego wiersza
  (koniec poziomego overflow), pola krótsze (wynik widoczny bez przewijania),
  fonty pól ≥16 px (iOS nie robi auto-zoomu), cele dotykowe ≥44 px.
- **Dostępność**: panel wyniku to nazwany, fokusowalny region (przewijanie
  z klawiatury); aria-live przeniesione na pasek wyników (czytnik nie czyta całego
  tekstu przy każdym klawiszu); spójny :focus-visible wszędzie; color-scheme
  (natywne kontrolki w kolorach motywu); prefers-reduced-motion.
- **Bezpieczeństwo pracy użytkownika**: upuszczenie pliku GDZIEKOLWIEK wczytuje go
  (wcześniej drop obok pola kasował stronę z tekstem!); link GitHub w nowej karcie;
  notka „⚠️ przejrzyj wynik" bezpośrednio pod wynikiem.
- **Stany**: „Wczytuję…" przy parsowaniu PDF/DOCX, „analizuję…" przy NER + błysk
  po dołożeniu masek, pasek błędów w UI zamiast alert(), martwe Kopiuj/Pobierz
  są teraz disabled, mini-przykład „przed → po" w pustym wyniku.
- **Język i detale**: „Wynik — zanonimizowany", plik zanonimizowany.txt, „Wynik
  skanowania:" przy zeru trafień, etykieta NER od korzyści (nie od akronimu),
  poprawiona podwójna negacja w „Co maskować", kontrast CTA w dark (AA),
  naprawiony promień tabeli, theme-color per motyw, wersja aplikacji w stopce.

## v0.9.1 — 2026-07-04

- **Ikony w interfejsie** (sprite od użytkownika, wycięte i osadzone inline —
  paczka offline nadal jednoplikowa): nagłówek, Przykład/Wczytaj/Wyczyść/Kopiuj/
  Pobierz, „Co maskować", plakietka NER. Świeży zrzut w README.
- **Podpowiedź o warstwie NER**: gdy rdzeń nic nie znajdzie, a NER jest wyłączony,
  pasek wyników podpowiada włączenie NER (feedback: trudne nazwiska bez NER dawały
  mylące zielone „nie wykryto danych osobowych").
- **Benchmark warstwy ONNX (int8)** na tym samym zbiorze 159 przypadków:
  **97,5% recall / 98,8% precision** (~7 ms/tekst na CPU) — recall minimalnie niższy
  od FastPDN w Dockerze (kwantyzacja), precyzja najwyższa ze wszystkich warstw NER.

## v0.9.0 — 2026-07-04

- **NER w przeglądarce (ONNX)** — finał programu SOTA T1–T5: rozpakuj
  `anonimizator-onnx-pack.zip` (z release'u `models-fastpdn-onnx-v1`) obok `index.html`,
  a przy serwowaniu po http w ustawieniach NER pojawia się źródło „w przeglądarce
  (ONNX, bez Dockera)" — pełny recall FastPDN w 100% offline, bez instalowania
  czegokolwiek. E2E zweryfikowane (Playwright): 4/4 trudne nazwiska w odmianie.
  Build aplikacji bez zmian rozmiaru (dynamiczny import spoza bundla); z `file://`
  opcja się nie pojawia (ograniczenie wasm/fetch przeglądarek).

Format wersji: [SemVer](https://semver.org/lang/pl/). Tagi `vX.Y.Z` budują paczkę
offline (`anonimizator-offline.zip`) w [Releases](https://github.com/karolpolikarp/anonimizator/releases).

## v0.8.0 — 2026-07-04

Trzy równoległe fronty programu SOTA (T3+T4+T5) w jednym wydaniu:

- **Benchmark** (`scripts/benchmark`, raport w `docs/BENCHMARK.md`): 159 przypadków
  z odmianą i negatywami. Wyniki: core 86,5% R / 99,4% P; core+FastPDN 99,4% R / 97,1% P.
- **4 fixy rdzenia wykryte benchmarkiem**: REGON ze złą sumą nie jest już zjadany
  przez detektor telefonu; „ur. 12.05.1985" maskowane (bug trailing \b); adresy
  w formach zależnych („na ulicy…"); nazwiska dwuczłonowe po wyzwalaczu w całości
  („Pan Habdank-Wojewódzki"). +4 testy regresyjne.
- **Warstwa LLM** (`anonimizator/llm`): `redactPIIUltra` przez lokalne Ollama
  (np. Bielik-11B) — span-extraction z twardą walidacją, fail-safe, breaker;
  eksperymentalna. +11 testów.
- **FastPDN jako ONNX int8** (release `models-fastpdn-onnx-v1`, 125 MB, CC-BY-4.0
  z atrybucją CLARIN-PL): NER bez Dockera przez transformers.js (~16 ms/akapit CPU);
  przykład `examples/ner-onnx-node.mjs` (zweryfikowany end-to-end).

## v0.7.0 — 2026-07-04

- **Usługa NER z dwoma backendami** (T2): `spacy` (domyślny, lekki) i `herbert`
  (transformers — `clarin-pl/FastPDN`, destylat HerBERT-a trenowany na KPWr).
  Na teście 7 trudnych nazwisk w odmianie: FastPDN 7/7 z kompletnymi spanami
  (w tym „Sarneckiej-Dul"), spaCy 7/7 z uciętym członem po myślniku.
  Wybór: `docker compose build --build-arg NER_BACKEND=herbert`.
- Odrzucony po testach: `pczarnik/herbert-base-ner` (wikiann) — mimo F1≈0,90
  na karcie modelu nie generalizował na realne zdania (szczegóły w SOTA-ANALIZA).
- Naprawa subwordowych offsetów (expand-to-word + scalanie), chunking długich
  tekstów z zakładką, filtr etykiet PER/nam_liv_person.

## v0.6.0 — 2026-07-04

- **Spójna pseudonimizacja** (T1b): opcja `pseudonyms` / flaga CLI `--osoby` /
  checkbox „Rozróżniaj osoby" — każda osoba dostaje stałą etykietę [OSOBA-A]/[OSOBA-B]…,
  zachowywaną w odmianie (Kowalski/Kowalskiego → ta sama litera). Zachowuje strukturę
  relacji w dokumentach prawnych. Ograniczenie: klucz = nazwisko, więc Jan i Anna
  Kowalscy dzielą etykietę. +6 testów.

## v0.5.0 — 2026-07-04

Start programu „najlepszy anonimizator PL 2026/2027" — analiza SOTA i architektura
warstwowa w [docs/SOTA-ANALIZA.md](./docs/SOTA-ANALIZA.md).

- **Słownik ~230 najczęstszych polskich nazwisk z obsługą fleksji** w rdzeniu (T1a):
  maskuje nazwisko występujące samodzielnie („Sprawę Kowalskiego przekazano…"),
  w odmianie przymiotnikowej (-ski/-cki/-dzki, formy żeńskie i mnogie) i rzeczownikowej
  (Nowakowi, Wójcikiem), z ruchomym „e". Nazwiska-homonimy (Wilk, Baran, Mazurek…)
  świadomie wymagają kontekstu — „Wilk biegał po lesie" nie jest maskowane.
  Zero nowych zależności; działa w paczce offline i npm. +8 testów.

## v0.4.0 — 2026-07-04

- **Aplikacja czyta pliki PDF** — pdf.js (legacy build) z fake-workerem w buildzie
  single-file; ekstrakcja w pełni offline, zweryfikowana E2E z `file://`.
  Skany (bez warstwy tekstu) i PDF-y z hasłem dostają jasne polskie komunikaty.
  Paczka offline: ~31 kB → ~1,7 MB (544 kB gzip) — nadal jeden plik.
- 3 testy ekstrakcji PDF (minimalny PDF budowany w teście) + diagnostyczny `?pdftest`.

## v0.3.4 — 2026-07-04

- Zmergowane wszystkie 8 PR-ów Dependabota: TypeScript 6.0, Vitest 4, Vite 8,
  actions/checkout v7, setup-node v6, gh-release v3, minima pip usługi NER.
  Naprawy pod TS 6.0: jawny `rootDir` w buildzie core, `vite-env.d.ts` dla importu CSS.
- 7 testów jednostkowych parsera .docx w CI (dotąd tylko ręczny smoke-test).
- Angielskie streszczenie w README.

## v0.3.3 — 2026-07-04

- Favicon aplikacji (inline SVG — działa też offline) i `theme-color`.
- Szablony zgłoszeń GitHub (nierozpoznane PII / fałszywe trafienie) z ostrzeżeniem,
  by NIE wklejać prawdziwych danych osobowych do publicznych issues.
- Dependabot (npm / pip / GitHub Actions, tygodniowo).
- Zweryfikowany układ mobilny (~500 px, jedna kolumna); odświeżony zrzut w README.

## v0.3.2 — 2026-07-04

Przegląd stabilizacyjny:

- **CI typechekuje aplikację webową** (`tsc --noEmit`) — Vite tylko transpiluje,
  więc błędy typów przechodziły niezauważone.
- Uczciwy komunikat, gdy część typów jest wyłączona w „Co maskować" — zamiast
  mylącego „nie wykryto danych osobowych".
- „Kopiuj" ma fallback, gdy przeglądarka odmówi Clipboard API.
- CLI zdejmuje BOM z plików UTF-8 (Windows/`Out-File`).

## v0.3.1 — 2026-07-04

- UX: „Kopiuj" jako przycisk główny (akcent) + skrót **Ctrl/Cmd+Enter**; licznik
  zamaskowanych wystąpień w pasku „Zamaskowano (N)"; autofocus pola tekstowego.
- Paczka npm: dołączony `LICENSE`; zawartość zweryfikowana `npm publish --dry-run`
  (8 plików, ~11,5 kB). Homepage repo wskazuje najnowszy release.

## v0.3.0 — 2026-07-04

- **Aplikacja czyta pliki .docx** — ekstrakcja tekstu w 100% lokalnie (maleńki `fflate`
  + własny parser `word/document.xml`, bez ciężkich zależności); drag&drop i „Wczytaj plik".
- `CHANGELOG.md`.

## v0.2.1 — 2026-07-04

- **Naprawiona paczka offline**: Chromium blokuje skrypty modułowe i style `crossorigin`
  na `file://`, więc rozbite assety nie działały po podwójnym kliknięciu w Chrome/Edge.
  Teraz build to JEDEN samowystarczalny `index.html` (JS+CSS inline, ~24 kB).
- Zrzut ekranu aplikacji w README; parametr `?demo` autouzupełnia przykład.
- Bezpiecznik renderowania: wyniki > 300 tys. znaków bez podświetleń (ochrona DOM);
  zmierzona wydajność silnika: ~1,45 mln znaków w ~31 ms.

## v0.2.0 — 2026-07-03

- Biblioteka: `redactPII(tekst, { types?, masks? })` — wybór typów do maskowania
  i własne placeholdery; ścieżka bez opcji niezmieniona.
- Aplikacja: panel „Co maskować" (zapamiętywany lokalnie); odznaczenie imion wyłącza NER.
- Badge'e CI/Release/MIT w README.

## v0.1.1 — 2026-07-03

- Przycisk „Przykład" (pokazuje maskowanie + strażnik kontekstu numerów przepisów).
- Drag&drop pliku `.txt` na pole tekstowe.
- `JAK-UZYC.txt` w paczce offline; tematy repo na GitHubie.

## v0.1.0 — 2026-07-03

- Pierwsze wydanie: silnik regex + sumy kontrolne (PESEL/NIP/REGON/IBAN/nr dowodu),
  heurystyka imion i adresów, strażniki kontekstu prawnego; biblioteka npm (zero
  zależności), CLI, aplikacja webowa 100% client-side.
- Opcjonalny lokalny NER (spaCy PL): usługa `services/ner` (Docker) + klient
  `anonimizator/ner` (fail-safe, circuit breaker).
