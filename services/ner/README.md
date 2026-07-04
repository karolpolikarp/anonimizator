# Anonimizator NER — opcjonalna lokalna usługa (spaCy / HerBERT)

Usługa wykrywania **imion i nazwisk** (encje osobowe) podnosząca skuteczność anonimizatora.
Domyka lukę, której nie złapie warstwa regex+słowniki: rzadkie i odmienione nazwiska bez
wyzwalacza kontekstu („Wczoraj Bąkiewicz podpisał umowę z Szczepankowską").

**Uruchamiasz ją na własnym komputerze** — tekst nadal nie opuszcza Twojej maszyny.
Bez tej usługi anonimizator działa normalnie (warstwa regex + sumy kontrolne + słownik nazwisk).

## Dwa backendy do wyboru (`PII_NER_BACKEND`)

| Backend | Model | Jakość (osoby) | Rozmiar obrazu | Kiedy |
|---|---|---|---|---|
| `spacy` (domyślny) | `pl_core_news_lg` | bardzo dobra (test: 7/7, ale ucina człony po myślniku) | ~1,5 GB | słabszy sprzęt, ARM/Raspberry Pi |
| `herbert` (SOTA PL) | `clarin-pl/FastPDN` (destylat HerBERT, KPWr) | najlepsza (test: 7/7 z kompletnymi spanami, np. „Sarneckiej-Dul" w całości) | ~2,4 GB | nowoczesny komputer, priorytet: recall |

Backend transformerowy: `docker compose build --build-arg NER_BACKEND=herbert` albo
odkomentuj `args` w `docker-compose.yml`. Tuning: `PII_NER_MIN_SCORE` (domyślnie `0.5`),
`PII_NER_AGGREGATION` (domyślnie `simple`).

> Uwaga empiryczna: popularny fine-tune `pczarnik/herbert-base-ner` (wikiann, F1≈0,90
> na własnym teście) w praktyce NIE generalizuje na realne zdania — przegapiał nawet
> mianownikowe nazwiska. Dlatego domyślny model to FastPDN (trenowany na KPWr z pełną
> fleksją). Nie ufaj metrykom z karty modelu — testuj na swoich danych.

## Architektura (fail-safe)

```
aplikacja webowa / biblioteka (anonimizator/ner)
  1. redakcja in-process: PESEL/NIP/IBAN/dowód/e-mail/telefon/adres + heurystyka imion
  2. tekst JUŻ zredagowany strukturalnie ──HTTP POST /redact──► ta usługa (localhost:8090)
  3. spaCy maskuje pozostałe osoby → [IMIĘ I NAZWISKO]
```

**Fail-safe:** gdy usługa jest wyłączona/niedostępna/przekroczy timeout — klient zostaje
przy wyniku warstwy regex. Ochrona nigdy nie spada poniżej poziomu in-process.
Usługa **nigdy nie widzi** surowego PESEL/NIP — te są maskowane, zanim tekst tu trafi.

## Najprościej: Docker

```bash
cd services/ner
docker compose up -d          # buduje obraz (pobiera model ~500 MB) i startuje na 127.0.0.1:8090
curl http://localhost:8090/health
```

Potem w aplikacji webowej zaznacz „Użyj lokalnego NER" — status zmieni się na „aktywny".

## Bez Dockera (Python 3.9+)

```bash
cd services/ner
python -m venv .venv && .venv/Scripts/activate    # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
python -m spacy download pl_core_news_lg
uvicorn app:app --host 127.0.0.1 --port 8090
```

## API

- `GET /health` → `{ "status": "ok", "model": "...", "labels": ["persName"] }`
- `POST /redact` (opcjonalny nagłówek `Authorization: Bearer <PII_NER_API_KEY>`)
  - body: `{ "text": "Sprawę prowadzi Bąkiewicz" }`
  - resp: `{ "redacted": "Sprawę prowadzi [IMIĘ I NAZWISKO]", "found": [{"type":"IMIE","count":1}] }`

## Konfiguracja (zmienne środowiskowe / `.env`)

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PII_NER_MODEL` | `pl_core_news_lg` | `pl_core_news_md` gdy mało RAM |
| `PII_NER_API_KEY` | *(puste = brak auth)* | ustaw, jeśli wystawiasz poza localhost |
| `PII_NER_LABELS` | `persName` | NKJP; `placeName,geogName` dołącz świadomie |
| `PII_NER_MASK` | `[IMIĘ I NAZWISKO]` | musi pasować do maski warstwy regex |
| `PII_NER_CORS_ORIGINS` | `*` | zawęź poza localhost |

## Użycie z biblioteki

```ts
import { redactPIIFull } from 'anonimizator/ner';

const { redacted } = await redactPIIFull(tekst, { url: 'http://127.0.0.1:8090' });
// NER niedostępny? Dostajesz wynik warstwy regex — nigdy mniej.
```

## Wydajność

Pipeline ładowany tylko z komponentami NER (parser/tagger/lemmatizer wyłączone) —
krótki tekst to kilkadziesiąt ms. Długie dokumenty klient przycina (`maxChars`,
domyślnie 20 000 znaków), ogon zostaje na wyniku warstwy regex.
