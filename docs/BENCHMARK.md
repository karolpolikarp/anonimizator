# Benchmark anonimizacji — precision / recall

- **Data uruchomienia:** 2026-07-04
- **Wersja rdzenia (`anonimizator`):** 0.8.0
- **Zbiór ewaluacyjny:** 159 syntetycznych zdań (deterministyczny, seed `20260704`), 163 elementów do zamaskowania (mustMask), 171 elementów do zachowania (mustKeep)
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
- **core+spacy** — redactPIIFull() + NER spaCy pl_core_news_lg (127.0.0.1:8090)
- **core+fastpdn** — redactPIIFull() + NER FastPDN/HerBERT (127.0.0.1:8091)

## Wyniki

| Warstwa | Recall (łącznie) | Precision-proxy (łącznie) | Porażki (przypadki) | Czas | Wynik ≠ core |
|---|---|---|---|---|---|
| T0+T1 core | 86.5% (141/163) | 99.4% (170/171) | 20 | 0.0 s | — |
| core+spacy | 99.4% (162/163) | 94.7% (162/171) | 10 | 0.8 s | 26 przyp. |
| core+fastpdn | 99.4% (162/163) | 97.1% (166/171) | 6 | 3.5 s | 22 przyp. |

### Recall per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy |
|---|---|---|---|---|---|
| T0+T1 core | 97.7% | 88.9% | 51.4% | 100.0% | — |
| core+spacy | 100.0% | 100.0% | 97.1% | 100.0% | — |
| core+fastpdn | 100.0% | 100.0% | 97.1% | 100.0% | — |

### Precision-proxy per kategoria

| Warstwa | osoby-podstawowe | osoby-odmiana | osoby-rzadkie | strukturalne | negatywy |
|---|---|---|---|---|---|
| T0+T1 core | 100.0% | 100.0% | 100.0% | 100.0% | 97.7% |
| core+spacy | 96.0% | 100.0% | 100.0% | 100.0% | 81.4% |
| core+fastpdn | 100.0% | 100.0% | 100.0% | 100.0% | 88.4% |

(„—" = brak elementów danego rodzaju w kategorii, np. negatywy nie mają mustMask.)

## Najczęstsze porażki

Legenda: **przeszło** = element mustMask pozostał w wyniku (wyciek PII);
**zjedzono** = element mustKeep został zamaskowany (fałszywy pozytyw).

### T0+T1 core — 20 przypadków z porażką

**Wycieki (przeszło 22 elem. w 19 przypadkach):**

- `os-p-14` (osoby-podstawowe): przeszło „Anna" — tekst: _Anna i Jan Kowalscy kupili mieszkanie na osiedlu._
- `os-o-23` (osoby-odmiana): przeszło „Jana" — tekst: _Pozew Jana Kowalskiego wpłynął we wtorek._
- `os-o-24` (osoby-odmiana): przeszło „Anny" — tekst: _Sąd wysłuchał Anny Wiśniewskiej na rozprawie zdalnej._
- `os-o-25` (osoby-odmiana): przeszło „Piotrowi" — tekst: _Zarzuty postawiono Piotrowi Zielińskiemu._
- `os-o-26` (osoby-odmiana): przeszło „Magdalenie" — tekst: _Nagrodę wręczono Magdalenie Woźniak._
- `os-r-06` (osoby-rzadkie): przeszło „Świętomira", „Gzowska" — tekst: _Świętomira Gzowska przyszła na przesłuchanie._
- `os-r-07` (osoby-rzadkie): przeszło „Bożydar", „Krzemieniecki" — tekst: _Bożydar Krzemieniecki prowadzi kancelarię w Radomiu._
- `os-r-08` (osoby-rzadkie): przeszło „Wieńczysław", „Trzebiatowski" — tekst: _Protokół sporządził Wieńczysław Trzebiatowski._
- `os-r-09` (osoby-rzadkie): przeszło „Krzemieniecka" — tekst: _napisała do mnie Krzemieniecka w sprawie zaliczki_
- `os-r-10` (osoby-rzadkie): przeszło „Zdrojewczyka" — tekst: _sprawę Zdrojewczyka przekazano do prokuratury_
- `os-r-11` (osoby-rzadkie): przeszło „Gzowskiego" — tekst: _list od Gzowskiego leżał na biurku tydzień_
- `os-r-12` (osoby-rzadkie): przeszło „Bąkiewiczowi" — tekst: _Bąkiewiczowi zależało na szybkiej wypłacie._
- `os-r-13` (osoby-rzadkie): przeszło „Trzebiatowskiego" — tekst: _Zaległości Trzebiatowskiego rosły z miesiąca na miesiąc._
- `os-r-14` (osoby-rzadkie): przeszło „Młodzianowskiej" — tekst: _Wniosek Młodzianowskiej rozpatrzono odmownie._
- `os-r-19` (osoby-rzadkie): przeszło „Fiołkowska" — tekst: _Fiołkowska wygrała przetarg na dostawę mebli._
- `os-r-20` (osoby-rzadkie): przeszło „Gzowska" — tekst: _Opinię przygotowała Gzowska z działu prawnego._
- `os-r-21` (osoby-rzadkie): przeszło „Bąkiewiczowie" — tekst: _Państwo Bąkiewiczowie odwołali się od decyzji._
- `os-r-22` (osoby-rzadkie): przeszło „Krzemienieckimi" — tekst: _Spór z Krzemienieckimi trwa od dwóch lat._
- `os-r-24` (osoby-rzadkie): przeszło „Rzepeckiej-Gil" — tekst: _opinia Rzepeckiej-Gil była druzgocąca_

**Nadmaskowania (zjedzono 1 elem. w 1 przypadkach):**

- `neg-40` (negatywy): zjedzono „Tadeusz" — wynik: _Pan [IMIĘ I NAZWISKO] to najsłynniejsza polska epopeja narodowa._

### core+spacy — 10 przypadków z porażką

**Wycieki (przeszło 1 elem. w 1 przypadkach):**

- `os-r-19` (osoby-rzadkie): przeszło „Fiołkowska" — tekst: _Fiołkowska wygrała przetarg na dostawę mebli._

**Nadmaskowania (zjedzono 9 elem. w 9 przypadkach):**

- `os-p-02` (osoby-podstawowe): zjedzono „Powódka" — wynik: _[IMIĘ I NAZWISKO] [IMIĘ I NAZWISKO] wniosła o zasądzenie kosztów._
- `neg-21` (negatywy): zjedzono „Wilk" — wynik: _[IMIĘ I NAZWISKO] biegał po lesie za sarną._
- `neg-22` (negatywy): zjedzono „Lis" — wynik: _[IMIĘ I NAZWISKO] przemknął przez drogę tuż przed autem._
- `neg-23` (negatywy): zjedzono „Baran" — wynik: _[IMIĘ I NAZWISKO] to pierwszy znak zodiaku._
- `neg-24` (negatywy): zjedzono „Mazurek" — wynik: _[IMIĘ I NAZWISKO] wielkanocny stygł na parapecie._
- `neg-25` (negatywy): zjedzono „Sowa" — wynik: _[IMIĘ I NAZWISKO] hukała całą noc pod oknem._
- `neg-26` (negatywy): zjedzono „Kruk" — wynik: _[IMIĘ I NAZWISKO] krukowi oka nie wykole, jak mówi przysłowie._
- `neg-27` (negatywy): zjedzono „Dudek" — wynik: _[IMIĘ I NAZWISKO] to ptak o charakterystycznym czubie._
- `neg-40` (negatywy): zjedzono „Tadeusz" — wynik: _Pan [IMIĘ I NAZWISKO] to najsłynniejsza polska epopeja narodowa._

### core+fastpdn — 6 przypadków z porażką

**Wycieki (przeszło 1 elem. w 1 przypadkach):**

- `os-r-13` (osoby-rzadkie): przeszło „Trzebiatowskiego" — tekst: _Zaległości Trzebiatowskiego rosły z miesiąca na miesiąc._

**Nadmaskowania (zjedzono 5 elem. w 5 przypadkach):**

- `neg-22` (negatywy): zjedzono „Lis" — wynik: _[IMIĘ I NAZWISKO] przemknął przez drogę tuż przed autem._
- `neg-25` (negatywy): zjedzono „Sowa" — wynik: _[IMIĘ I NAZWISKO] hukała całą noc pod oknem._
- `neg-26` (negatywy): zjedzono „Kruk" — wynik: _[IMIĘ I NAZWISKO] krukowi oka nie wykole, jak mówi przysłowie._
- `neg-27` (negatywy): zjedzono „Dudek" — wynik: _[IMIĘ I NAZWISKO] to ptak o charakterystycznym czubie._
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
