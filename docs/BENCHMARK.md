# Benchmark anonimizacji — precision / recall

- **Data uruchomienia:** 2026-07-13
- **Wersja rdzenia (`anonimizator`):** 0.29.1
- **Zbiór ewaluacyjny:** 260 syntetycznych zdań (deterministyczny, seed `20260704`), 248 elementów do zamaskowania (mustMask), 280 elementów do zachowania (mustKeep)
- **Reprodukcja:** `npm run build -w anonimizator && node scripts/benchmark/run.mjs`

## Metodologia

Każdy przypadek testowy to zdanie z listą **mustMask** (dokładne podłańcuchy, które MUSZĄ
zniknąć z wyniku redakcji — PESEL-e, nazwiska w odmianie itd.) oraz **mustKeep** (podłańcuchy,
które MUSZĄ pozostać — numery przepisów, sygnatury akt, instytucje, homonimy nazwisk).

- **recall** — odsetek elementów mustMask nieobecnych w wyniku (miara skuteczności anonimizacji;
  element obecny w wyniku = wyciek danych osobowych);
- **precision-proxy** — odsetek elementów mustKeep zachowanych w wyniku (miara nadmaskowania;
  element usunięty = fałszywy pozytyw, który psuje użyteczność tekstu).

Wszystkie identyfikatory w zbiorze mają **poprawne sumy kontrolne** policzone w generatorze
(PESEL, NIP, REGON, IBAN mod-97, nr dowodu), a negatywy zawierają m.in. ciągi o celowo
**błędnych** sumach kontrolnych — silnik ma je zostawić w spokoju.

Liczności kategorii: osoby-podstawowe — 23, osoby-odmiana — 32, osoby-rzadkie — 24, strukturalne — 78, negatywy — 74, osoby-rzadkie-ner — 19, osoby-slownik — 10.

### Warstwy

- **T0+T1 core** — redactPII() — regex + sumy kontrolne + słownik (in-process, offline)
- **core+spacy** — POMINIĘTA: usługa `http://127.0.0.1:8090` niedostępna w chwili uruchomienia (health-check).
- **core+fastpdn** — POMINIĘTA: usługa `http://127.0.0.1:8091` niedostępna w chwili uruchomienia (health-check).
- **core+onnx (Node)** — POMINIĘTA: biblioteka @huggingface/transformers lub lokalny model ONNX niedostępne.

## Wyniki

| Warstwa | Recall (łącznie) | Precision-proxy (łącznie) | F1 | Porażki (przypadki) | Czas | Wynik ≠ core |
|---|---|---|---|---|---|---|
| T0+T1 core | 94.0% (233/248) | 99.6% (279/280) | 96.7% | 16 | 0.0 s | — |

F1 liczone jako średnia harmoniczna recall i precision-proxy (łącznie po wszystkich kategoriach
z oboma rodzajami elementów; kategoria „negatywy" nie ma recall, więc nie wchodzi do składowej recall).

### Recall per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy | osoby-rzadkie-ner | osoby-slownik |
|---|---|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | — | 21.1% | 100.0% |

### F1 per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy | osoby-rzadkie-ner | osoby-slownik |
|---|---|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | — | 34.8% | 100.0% |

### Precision-proxy per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy | osoby-rzadkie-ner | osoby-slownik |
|---|---|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | 98.8% | 100.0% | 100.0% |

(„—" = brak elementów danego rodzaju w kategorii, np. negatywy nie mają mustMask.)

## Najczęstsze porażki

Legenda: **przeszło** = element mustMask pozostał w wyniku (wyciek PII);
**zjedzono** = element mustKeep został zamaskowany (fałszywy pozytyw).

### T0+T1 core — 16 przypadków z porażką

**Wycieki (przeszło 15 elem. w 15 przypadkach):**

- `os-rn-01` (osoby-rzadkie-ner): przeszło „Achtelika" — tekst: _list od Achtelika leżał tydzień na biurku_
- `os-rn-02` (osoby-rzadkie-ner): przeszło „Fąfary" — tekst: _sprawę Fąfary umorzono w drugiej instancji_
- `os-rn-03` (osoby-rzadkie-ner): przeszło „Gągały" — tekst: _zeznania Gągały spisano protokolarnie_
- `os-rn-04` (osoby-rzadkie-ner): przeszło „Grzmota" — tekst: _wniosek Grzmota rozpatrzono odmownie_
- `os-rn-05` (osoby-rzadkie-ner): przeszło „Ciołka" — tekst: _do akt dołączono notatkę Ciołka z rozmowy_
- `os-rn-06` (osoby-rzadkie-ner): przeszło „Müller" — tekst: _reklamację złożył wczoraj Müller osobiście_
- `os-rn-08` (osoby-rzadkie-ner): przeszło „Kovač" — tekst: _protokół podpisał Kovač w obecności świadka_
- `os-rn-09` (osoby-rzadkie-ner): przeszło „Popescu" — tekst: _opinię biegłego sporządził Popescu w terminie_
- `os-rn-10` (osoby-rzadkie-ner): przeszło „Schmidt" — tekst: _pełnomocnikiem powoda był mecenas Schmidt_
- `os-rn-12` (osoby-rzadkie-ner): przeszło „Habaja" — tekst: _zeznania Habaja spisano na komisariacie_
- `os-rn-14` (osoby-rzadkie-ner): przeszło „Cieciory" — tekst: _do akt dołączono notatkę Cieciory z narady_
- `os-rn-15` (osoby-rzadkie-ner): przeszło „Bździucha" — tekst: _pismo od Bździucha wpłynęło z opóźnieniem_
- `os-rn-17` (osoby-rzadkie-ner): przeszło „Horvat" — tekst: _umowę serwisową parafował Horvat osobiście_
- `os-rn-18` (osoby-rzadkie-ner): przeszło „Weber" — tekst: _reklamację rozpatrzył Weber w dwa dni_
- `os-rn-19` (osoby-rzadkie-ner): przeszło „Rossi" — tekst: _kontrakt firmował Rossi przed notariuszem_

**Nadmaskowania (zjedzono 1 elem. w 1 przypadkach):**

- `neg-52` (negatywy): zjedzono „Tadeusz" — wynik: _Pan [IMIĘ I NAZWISKO] to najsłynniejsza polska epopeja narodowa._

## Uwagi

- Kategoria **osoby-rzadkie-ner** to przypadki, które rdzeń deterministyczny PROWADZI
  ŚWIADOMIE do wycieku (nazwiska bez wyzwalacza i bez sufiksu -ski/-cki/-icz/-czyk oraz
  obce) — recall rdzenia jest tu z założenia niski (bliski 0%). Ta kategoria istnieje po to,
  by ZMIERZYĆ przewagę warstwy NER: uruchom benchmark z modelem ONNX, aby zobaczyć wzrost
  recall bez spadku precyzji na negatywach.
- Warstwę **core+onnx (Node)** aktywujesz bez Dockera: `npm i -D @huggingface/transformers`
  oraz rozpakuj model do `scripts/benchmark/models/fastpdn/` (albo wskaż `ONNX_MODELS_DIR`).
  Bez biblioteki/modelu warstwa jest pomijana (fail-safe), a raport pokazuje tylko rdzeń.
- Zbiór jest w pełni syntetyczny — wszystkie dane (PESEL-e, nazwiska, adresy) zostały
  wygenerowane albo wymyślone; nie zawierają danych rzeczywistych osób.
- Kolumna „Wynik ≠ core" pokazuje, w ilu przypadkach warstwa NER faktycznie zmieniła
  wynik względem czystego rdzenia — wartość bliska zeru sugerowałaby, że usługa NER
  nie działała podczas pomiaru (fail-safe po cichu wraca do rdzenia).
- Usługi NER widzą tekst już po redakcji strukturalnej (PESEL/NIP/IBAN zamaskowane
  in-process), zgodnie z architekturą `redactPIIFull`.
- Metryka precision jest przybliżeniem (proxy): mierzy tylko zachowanie wskazanych
  podłańcuchów mustKeep, a nie wszystkich nie-PII tokenów w zdaniu.
