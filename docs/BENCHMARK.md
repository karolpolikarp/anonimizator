# Benchmark anonimizacji — precision / recall

- **Data uruchomienia:** 2026-07-07
- **Wersja rdzenia (`anonimizator`):** 0.22.0
- **Zbiór ewaluacyjny:** 159 syntetycznych zdań (deterministyczny, seed `20260704`), 164 elementów do zamaskowania (mustMask), 170 elementów do zachowania (mustKeep)
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

Liczności kategorii: osoby-podstawowe — 23, osoby-odmiana — 32, osoby-rzadkie — 24, strukturalne — 40, negatywy — 40.

### Warstwy

- **T0+T1 core** — redactPII() — regex + sumy kontrolne + słownik (in-process, offline)
- **core+spacy** — POMINIĘTA: usługa `http://127.0.0.1:8090` niedostępna w chwili uruchomienia (health-check).
- **core+fastpdn** — POMINIĘTA: usługa `http://127.0.0.1:8091` niedostępna w chwili uruchomienia (health-check).

## Wyniki

| Warstwa | Recall (łącznie) | Precision-proxy (łącznie) | Porażki (przypadki) | Czas | Wynik ≠ core |
|---|---|---|---|---|---|
| T0+T1 core | 100.0% (164/164) | 99.4% (169/170) | 1 | 0.0 s | — |

### Recall per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy |
|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | — |

### Precision-proxy per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy |
|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | 97.7% |

(„—" = brak elementów danego rodzaju w kategorii, np. negatywy nie mają mustMask.)

## Najczęstsze porażki

Legenda: **przeszło** = element mustMask pozostał w wyniku (wyciek PII);
**zjedzono** = element mustKeep został zamaskowany (fałszywy pozytyw).

### T0+T1 core — 1 przypadków z porażką

**Nadmaskowania (zjedzono 1 elem. w 1 przypadkach):**

- `neg-40` (negatywy): zjedzono „Tadeusz" — wynik: _Pan [IMIĘ I NAZWISKO] to najsłynniejsza polska epopeja narodowa._

## Uwagi

- Zbiór jest w pełni syntetyczny — wszystkie dane (PESEL-e, nazwiska, adresy) zostały
  wygenerowane albo wymyślone; nie zawierają danych rzeczywistych osób.
- Kolumna „Wynik ≠ core" pokazuje, w ilu przypadkach warstwa NER faktycznie zmieniła
  wynik względem czystego rdzenia — wartość bliska zeru sugerowałaby, że usługa NER
  nie działała podczas pomiaru (fail-safe po cichu wraca do rdzenia).
- Usługi NER widzą tekst już po redakcji strukturalnej (PESEL/NIP/IBAN zamaskowane
  in-process), zgodnie z architekturą `redactPIIFull`.
- Metryka precision jest przybliżeniem (proxy): mierzy tylko zachowanie wskazanych
  podłańcuchów mustKeep, a nie wszystkich nie-PII tokenów w zdaniu.
