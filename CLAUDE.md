# CLAUDE.md — przewodnik po repozytorium anonimizator

Lokalny anonimizator polskich danych osobowych (PII). **Wszystko działa lokalnie**, tekst nigdy nie
opuszcza komputera. Zasada nadrzędna: **precyzja > nadmaskowanie** (nadmaskowanie gorsze niż drobny
wyciek) — patrz `docs/SOTA-ANALIZA.md`.

## Struktura (monorepo, npm workspaces)

- `packages/core/` — pakiet npm `anonimizator`. **Jedyne źródło prawdy logiki**, ZERO zależności,
  działa w Node/Deno/Bun/przeglądarce. `src/index.ts` = silnik `redactPII()` (regexy + sumy
  kontrolne + kotwice kontekstowe). `src/surnames.ts` = słownik nazwisk (+ rozszerzenie z PESEL) i
  morfologia. `src/ner-postprocess.ts` = wspólny post-processing wyjścia neuronowego NER.
  `src/ner-client.ts` (usługa HTTP), `src/llm-client.ts` (Ollama) = opcjonalne warstwy AI (fail-safe).
- `apps/web/` — pakiet `anonimizator-web`. UI budowane Vite `vite-plugin-singlefile` do JEDNEGO
  samowystarczalnego `index.html`. Flaga `VITE_EDITION=urzednik` produkuje edycję „czysty HTML"
  (bez AI, `[data-full]` ukryte). `src/ner-browser.ts` = NER ONNX w przeglądarce (opcjonalny).
- `services/ner/` — opcjonalna usługa Docker (Python, spaCy/HerBERT). `launcher/` — mini-serwer
  HTTP dla warstwy AI (bo `file://` blokuje WASM). `scripts/build-onnx-pack/` — build paczki modelu.
- `scripts/benchmark/` — deterministyczny benchmark precision/recall/F1 (`dataset.mjs` + `run.mjs`).

## Dwa produkty (patrz pamięć `dwie-edycje-html-i-ai`)

1. **Single-HTML deterministyczny (fosa)** — jeden plik, `file://`, zero instalacji. Przechodzi przez
   blokady firmowe/urzędowe (to dokument, nie program). WYŁĄCZNIE deterministyka. To edycja `urzednik`.
2. **Pełna / AI** — z launcherem HTTP + modelem ONNX; dla maszyn bez blokad. Recall na rzadkich
   nazwiskach. **NIE rozbijać na osobne repo** — separacja artefaktu jest już przy buildzie.

## Komendy

```bash
npm ci
npm run build -w anonimizator                     # rdzeń → dist (tsc)
npm run test  -w anonimizator                     # testy rdzenia (vitest)
npx tsc -p apps/web/tsconfig.json                 # typecheck web (jak CI)
npm run test  -w anonimizator-web                 # testy web
npm run build -w anonimizator-web                 # edycja pełna → dist/index.html
VITE_EDITION=urzednik npm run build -w anonimizator-web   # edycja urząd (bez AI)
node scripts/benchmark/run.mjs                    # benchmark (core; onnx jeśli lib+model)
node scripts/benchmark/run.mjs --check            # BRAMKA regresji rdzenia (używana w CI)
```

CI (`.github/workflows/ci.yml`): build+test core → tsc web → test web → build web → bramka benchmarku.
Release (`.github/workflows/release.yml`, tag `v*`): dwa artefakty — `Anonimizator.html` (urząd) i
`Anonimizator-AI.zip` (pełna). Model ONNX to osobny release `models-fastpdn-onnx-v1`.

## Konwencje detekcji (index.ts)

- **Sumy kontrolne** (PESEL/NIP/REGON/IBAN/dowód) tną fałszywe trafienia. Ale przy **silnej etykiecie**
  („PESEL:", „NIP", „REGON", „konto/rachunek/IBAN") maskujemy MIMO złej sumy (numer bywa z literówką).
- **Kotwice kontekstowe** dla typów bez sumy (paszport, KRS, prawo jazdy, nr rejestracyjny, VIN, data ur.).
- **Kolejność przebiegów ma znaczenie**: ochrona URL-i (sentinel + maskowanie parametrów wewnątrz)
  → e-mail → identyfikatory techniczne (token/MAC/IP/VIN) → pola formularza/XML/JSON/login →
  najdłuższe ciągi cyfr (IBAN 26 → PESEL 11 → NIP 10 → REGON) → krótsze (telefon 9, kod 5). MAC PRZED IPv6.
  W telefonie tryb KOTWICOWY przed prefiksowym „+48" (placeholder nie może przerwać łańcucha wyliczenia).
- **Idempotencja**: placeholdery nie zawierają cyfr ani „@", więc ponowny przebieg ich nie pożre.
- Nowy typ PII = dodać do `PiiType`, `MASK`, `HUMAN_LABEL` (index.ts), do `MASK_GROUPS` (apps/web/main.ts),
  do tabeli w README, oraz testy (index.test.ts) i przypadki benchmarku (dataset.mjs).

## Weryfikacja zmian w detekcji

Sam benchmark nie wystarcza — sprawdzaj zmiany wieloagentowo/adwersarialnie na realistycznych pismach
(patrz pamięć `weryfikacja-precyzji-audyt-adwersarialny`). UX weryfikuj zrzutami (Playwright).

## Język

Cała komunikacja, komentarze i teksty UI po polsku (z pełną ortografią i diakrytyką).
