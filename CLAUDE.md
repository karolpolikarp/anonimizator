# CLAUDE.md — przewodnik po repozytorium anonimizator

Marka produktu: **Parawan** („Dane za parawanem"). Repo/pakiet npm/CLI dalej nazywają się
`anonimizator` (identyfikator techniczny — patrz pamięć `marka-parawan-i-fonty-lokalne`).
Lokalny anonimizator polskich danych osobowych (PII). **Wszystko działa lokalnie**, tekst nigdy nie
opuszcza komputera. Zasada nadrzędna: **precyzja > nadmaskowanie** (nadmaskowanie gorsze niż drobny
wyciek) — patrz pamięć `anonimizacja-precyzja-nad-nadmaskowaniem`.

## JEDEN produkt: samowystarczalny HTML (patrz pamięć `dwie-edycje-html-i-ai`)

To repo produkuje **jeden plik `Parawan.html`** — `file://`, zero instalacji, WYŁĄCZNIE
deterministyka (reguły + słowniki + sumy kontrolne). To jest fosa: przechodzi przez blokady
firmowe/urzędowe (dokument, nie program). Fonty marki są wbudowane lokalnie (woff2 → `data:`),
NIGDY zewnętrzny `<link>`. Warstwa AI (NER/LLM) mieszka w OSOBNYM repo-dodatku
**[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai)** — nie dokładać jej tutaj.

## Struktura (monorepo, npm workspaces)

- `packages/core/` — pakiet npm `anonimizator`. **Jedyne źródło prawdy logiki**, ZERO zależności,
  działa w Node/Deno/Bun/przeglądarce. `src/index.ts` = silnik `redactPII()` (regexy + sumy
  kontrolne + kotwice kontekstowe). `src/surnames.ts` = słownik nazwisk (+ rozszerzenie z PESEL) i
  morfologia. `src/ner-postprocess.ts` / `src/ner-client.ts` / `src/llm-client.ts` = eksporty
  npm (`anonimizator/ner-postprocess`, `/ner`, `/llm`) — SZEW, w który wpina się dodatek AI;
  zostają tu jako część biblioteki, single-HTML ich NIE importuje.
- `apps/web/` — pakiet `anonimizator-web`. UI budowane Vite `vite-plugin-singlefile` do JEDNEGO
  samowystarczalnego `index.html`. Bez warstwy AI (wycięta w v0.45.2 — patrz CHANGELOG).
- `scripts/benchmark/` — deterministyczny benchmark precision/recall/F1 (`dataset.mjs` + `run.mjs`).
  Warstwy NER w run.mjs degradują się łagodnie (health-check → skip), gdy brak usług/modelu.

## Komendy

```bash
npm ci
npm run build -w anonimizator                     # rdzeń → dist (tsc)
npm run test  -w anonimizator                     # testy rdzenia (vitest)
npx tsc -p apps/web/tsconfig.json                 # typecheck web (jak CI)
npm run test  -w anonimizator-web                 # testy web
npm run build -w anonimizator-web                 # single-HTML → apps/web/dist/index.html
node scripts/benchmark/run.mjs --check            # BRAMKA regresji rdzenia (używana w CI)
```

CI (`.github/workflows/ci.yml`): build+test core → tsc web → test web → build web → bramka benchmarku.
Release (`.github/workflows/release.yml`, tag `v*`): jeden artefakt — `Parawan.html` + `JAK-UZYC.txt`.

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
