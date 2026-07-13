# anonimizator

Lokalna redakcja polskich danych osobowych (PII) w tekście. Zero zależności — działa w Node,
Deno, Bun i przeglądarce. Zamienia PESEL, NIP, REGON, IBAN/nr konta, nr dowodu, e-mail, telefon,
kod pocztowy, datę urodzenia, adres oraz imię i nazwisko na neutralne placeholdery.

Tam, gdzie format ma sumę kontrolną (PESEL/NIP/REGON/IBAN/dowód), jest ona **walidowana** —
przypadkowe ciągi cyfr (sygnatury, numery przepisów) nie są maskowane. Redakcja jest
idempotentna.

```bash
npm install anonimizator
```

```ts
import { redactPII } from 'anonimizator';

const { redacted, found } = redactPII('Mój PESEL to 44051401359, mail jan@example.com');
// redacted → 'Mój PESEL to [PESEL], mail [EMAIL]'
// found    → [{ type: 'PESEL', count: 1 }, { type: 'EMAIL', count: 1 }]
```

CLI:

```bash
npx anonimizator dokument.txt --out czysty.txt
```

**Ograniczenie:** wykrywanie imion/nazwisk warstwą podstawową jest heurystyczne (słownik
imion + wyzwalacze kontekstu) — zawsze przejrzyj wynik przed udostępnieniem. Recall rzadkich
nazwisk podnosi opcjonalna lokalna usługa NER (fail-safe — jej awaria nigdy nie obniża
ochrony poniżej warstwy regex):

```ts
import { redactPIIFull } from 'anonimizator/ner';

const { redacted } = await redactPIIFull(tekst, { url: 'http://127.0.0.1:8090' });
```

Pełna dokumentacja: <https://github.com/karolpolikarp/parawan>

Licencja: MIT
