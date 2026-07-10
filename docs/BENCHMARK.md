# Benchmark anonimizacji — precision / recall

- **Data uruchomienia:** 2026-07-10
- **Wersja rdzenia (`anonimizator`):** 0.24.0
- **Zbiór ewaluacyjny:** 177 syntetycznych zdań (deterministyczny, seed `20260704`), 175 elementów do zamaskowania (mustMask), 187 elementów do zachowania (mustKeep)
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

Liczności kategorii: osoby-podstawowe — 23, osoby-odmiana — 32, osoby-rzadkie — 24, strukturalne — 40, negatywy — 48, osoby-rzadkie-ner — 10.

### Warstwy

- **T0+T1 core** — redactPII() — regex + sumy kontrolne + słownik (in-process, offline)
- **core+onnx (Node)** — redactPII() + FastPDN ONNX int8 (q8) w Node przez @huggingface/transformers — bez Dockera
- **core+spacy** — POMINIĘTA: usługa `http://127.0.0.1:8090` niedostępna w chwili uruchomienia (health-check).
- **core+fastpdn** — POMINIĘTA: usługa `http://127.0.0.1:8091` niedostępna w chwili uruchomienia (health-check).

## Wyniki

| Warstwa | Recall (łącznie) | Precision-proxy (łącznie) | Porażki (przypadki) | Czas | Wynik ≠ core |
|---|---|---|---|---|---|
| T0+T1 core | 94.3% (165/175) | 98.9% (185/187) | 12 | 0.0 s | — |
| core+onnx (Node) | 95.4% (167/175) | 98.9% (185/187) | 10 | 1.3 s | 2 przyp. |

### Recall per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy | osoby-rzadkie-ner |
|---|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | — | 0.0% |
| core+onnx (Node) | 100.0% | 100.0% | 100.0% | 100.0% | — | 20.0% |

### Precision-proxy per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy | osoby-rzadkie-ner |
|---|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | 96.1% | 100.0% |
| core+onnx (Node) | 100.0% | 100.0% | 100.0% | 100.0% | 96.1% | 100.0% |

(„—" = brak elementów danego rodzaju w kategorii, np. negatywy nie mają mustMask.)

## Najczęstsze porażki

Legenda: **przeszło** = element mustMask pozostał w wyniku (wyciek PII);
**zjedzono** = element mustKeep został zamaskowany (fałszywy pozytyw).

### T0+T1 core — 12 przypadków z porażką

**Wycieki (przeszło 10 elem. w 10 przypadkach):**

- `os-rn-01` (osoby-rzadkie-ner): przeszło „Achtelika" — tekst: _list od Achtelika leżał tydzień na biurku_
- `os-rn-02` (osoby-rzadkie-ner): przeszło „Fąfary" — tekst: _sprawę Fąfary umorzono w drugiej instancji_
- `os-rn-03` (osoby-rzadkie-ner): przeszło „Gągały" — tekst: _zeznania Gągały spisano protokolarnie_
- `os-rn-04` (osoby-rzadkie-ner): przeszło „Grzmota" — tekst: _wniosek Grzmota rozpatrzono odmownie_
- `os-rn-05` (osoby-rzadkie-ner): przeszło „Ciołka" — tekst: _do akt dołączono notatkę Ciołka z rozmowy_
- `os-rn-06` (osoby-rzadkie-ner): przeszło „Müller" — tekst: _reklamację złożył wczoraj Müller osobiście_
- `os-rn-07` (osoby-rzadkie-ner): przeszło „Nguyen" — tekst: _umowę parafował Nguyen dzień wcześniej_
- `os-rn-08` (osoby-rzadkie-ner): przeszło „Kovač" — tekst: _protokół podpisał Kovač w obecności świadka_
- `os-rn-09` (osoby-rzadkie-ner): przeszło „Popescu" — tekst: _opinię biegłego sporządził Popescu w terminie_
- `os-rn-10` (osoby-rzadkie-ner): przeszło „Schmidt" — tekst: _pełnomocnikiem powoda był mecenas Schmidt_

**Nadmaskowania (zjedzono 2 elem. w 2 przypadkach):**

- `neg-09` (negatywy): zjedzono „III CZP 12/23" — wynik: _Sygn. akt [ZNAK-SPRAWY] — uchwała siedmiu sędziów._
- `neg-40` (negatywy): zjedzono „Tadeusz" — wynik: _Pan [IMIĘ I NAZWISKO] to najsłynniejsza polska epopeja narodowa._

### core+onnx (Node) — 10 przypadków z porażką

**Wycieki (przeszło 8 elem. w 8 przypadkach):**

- `os-rn-01` (osoby-rzadkie-ner): przeszło „Achtelika" — tekst: _list od Achtelika leżał tydzień na biurku_
- `os-rn-02` (osoby-rzadkie-ner): przeszło „Fąfary" — tekst: _sprawę Fąfary umorzono w drugiej instancji_
- `os-rn-03` (osoby-rzadkie-ner): przeszło „Gągały" — tekst: _zeznania Gągały spisano protokolarnie_
- `os-rn-04` (osoby-rzadkie-ner): przeszło „Grzmota" — tekst: _wniosek Grzmota rozpatrzono odmownie_
- `os-rn-05` (osoby-rzadkie-ner): przeszło „Ciołka" — tekst: _do akt dołączono notatkę Ciołka z rozmowy_
- `os-rn-08` (osoby-rzadkie-ner): przeszło „Kovač" — tekst: _protokół podpisał Kovač w obecności świadka_
- `os-rn-09` (osoby-rzadkie-ner): przeszło „Popescu" — tekst: _opinię biegłego sporządził Popescu w terminie_
- `os-rn-10` (osoby-rzadkie-ner): przeszło „Schmidt" — tekst: _pełnomocnikiem powoda był mecenas Schmidt_

**Nadmaskowania (zjedzono 2 elem. w 2 przypadkach):**

- `neg-09` (negatywy): zjedzono „III CZP 12/23" — wynik: _Sygn. akt [ZNAK-SPRAWY] — uchwała siedmiu sędziów._
- `neg-40` (negatywy): zjedzono „Tadeusz" — wynik: _Pan [IMIĘ I NAZWISKO] to najsłynniejsza polska epopeja narodowa._

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
