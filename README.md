# Anonimizator

Lokalny anonimizator polskich danych osobowych (PII). Zamienia PESEL, NIP, REGON, numery kont,
numery dowodów, e-maile, telefony, adresy oraz imiona i nazwiska na neutralne placeholdery —
**zanim** tekst trafi do czatu z modelem językowym, e-maila, zgłoszenia czy bazy danych.

Trzy formy użycia, jeden silnik:

- **Strona WWW** (`apps/web`) — wklejasz tekst, dostajesz zredagowany. Działa w 100% w przeglądarce:
  żaden znak nie opuszcza Twojego komputera (możesz rozłączyć internet i sprawdzić).
- **Biblioteka npm** (`packages/core`, pakiet `anonimizator`) — zero zależności, działa w Node,
  Deno, Bun i przeglądarce.
- **CLI** — `anonimizator plik.txt`, także stdin → stdout do potoków.

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

Wykrywanie **imion i nazwisk jest heurystyczne** — rzadkie nazwisko bez imienia ze słownika
i bez wyzwalacza kontekstu może przejść niewykryte. To narzędzie pomocnicze: **zawsze przejrzyj
wynik przed udostępnieniem**. Pełny NER (model językowy rozpoznający odmienione i rzadkie
nazwiska) jest na roadmapie jako opcjonalny, również lokalny moduł.

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

## Użycie — strona WWW (deweloperska)

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # statyczne pliki w apps/web/dist — hostuj gdziekolwiek (GitHub Pages, Vercel…)
```

Strona nie ma backendu, analityki ani żadnych zapytań sieciowych — cała logika wykonuje się
w przeglądarce.

## Struktura repozytorium

```
packages/core/    # silnik redakcji (TS, zero zależności) + CLI + testy (Vitest)
apps/web/         # statyczna strona (Vite, bez frameworka)
```

## Testy

```bash
npm test          # 26 testów: sumy kontrolne, maskowanie, fałszywe trafienia, idempotencja
```

## Roadmapa

- [ ] Opcjonalny lokalny NER (rozpoznawanie odmienionych/rzadkich nazwisk) — np. model w
      przeglądarce (ONNX/transformers.js) albo kontener Docker ze spaCy PL, zawsze fail-safe
      do warstwy regex.
- [ ] Konfigurowalne placeholdery i wybór typów do maskowania.
- [ ] Obsługa plików PDF/DOCX w aplikacji webowej (ekstrakcja tekstu lokalnie).

## Pochodzenie

Silnik redakcji został wydzielony z produkcyjnego kodu [JakiePrawo.pl](https://jakieprawo.pl),
gdzie maskuje dane osobowe w pytaniach użytkowników, zanim trafią do modelu językowego
(zgodność z RODO). Reguły i testy regresji pochodzą z realnych przypadków.

## Licencja

MIT
