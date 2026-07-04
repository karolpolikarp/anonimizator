"""
Anonimizator — opcjonalna LOKALNA usługa NER do wykrywania imion i nazwisk.

Dwa wybieralne backendy (env PII_NER_BACKEND):
  - "spacy"   (domyślny): pl_core_news_lg — lekki (~560 MB obrazu), szybki na CPU/ARM.
  - "herbert" (SOTA PL):  pczarnik/herbert-base-ner (HerBERT fine-tuned, F1≈0.90 wikiann)
                          — wyraźnie lepszy recall na odmianie i rzadkich nazwiskach,
                          cięższy obraz (torch CPU + model ~1 GB).

Rola i architektura bez zmian: usługa działa NA KOMPUTERZE UŻYTKOWNIKA, dostaje tekst
JUŻ po redakcji strukturalnej (PESEL/NIP/IBAN zamaskowane wcześniej), zwraca tekst
z osobami zamienionymi na `[IMIĘ I NAZWISKO]`. Klient jest fail-safe.

Uruchomienie bez Dockera:
    pip install -r requirements.txt              # backend spacy
    python -m spacy download pl_core_news_lg
    # albo backend herbert:
    pip install -r requirements-herbert.txt
    PII_NER_BACKEND=herbert uvicorn app:app --host 127.0.0.1 --port 8090
"""

import os
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BACKEND = os.environ.get("PII_NER_BACKEND", "spacy").strip().lower()
API_KEY = os.environ.get("PII_NER_API_KEY", "")
MASK = os.environ.get("PII_NER_MASK", "[IMIĘ I NAZWISKO]")
CORS_ORIGINS = [o.strip() for o in os.environ.get("PII_NER_CORS_ORIGINS", "*").split(",") if o.strip()]

# ── Backend: spaCy ──────────────────────────────────────────────────────────


def _load_spacy():
    import spacy

    model = os.environ.get("PII_NER_MODEL", "pl_core_news_lg")
    labels = {l.strip() for l in os.environ.get("PII_NER_LABELS", "persName").split(",") if l.strip()}
    exclude = ["parser", "lemmatizer", "tagger", "attribute_ruler", "morphologizer", "senter"]
    try:
        nlp = spacy.load(model, exclude=exclude)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"Nie udało się załadować modelu spaCy '{model}'. "
            f"Zainstaluj: python -m spacy download {model}. Błąd: {exc}"
        ) from exc

    def detect(text: str) -> list[tuple[int, int]]:
        doc = nlp(text)
        return [(e.start_char, e.end_char) for e in doc.ents if e.label_ in labels]

    return detect, {"backend": "spacy", "model": model, "labels": sorted(labels)}


# ── Backend: HerBERT (transformers) ────────────────────────────────────────

# Teksty dłuższe niż limit modelu (512 tokenów) tniemy na fragmenty z zakładką,
# a nachodzące trafienia scalamy.
_CHUNK_CHARS = 1500
_CHUNK_OVERLAP = 200


_WORD_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZąćęłńóśźżĄĆĘŁŃÓŚŹŻ-")


def _expand_to_word(text: str, s: int, e: int) -> tuple[int, int]:
    """Rozszerz span do granic słowa — subwordowe offsety potrafią uciąć „G|zowski"."""
    while s > 0 and text[s - 1] in _WORD_CHARS:
        s -= 1
    while e < len(text) and text[e] in _WORD_CHARS:
        e += 1
    return s, e


def _is_person_label(entity_group: str) -> bool:
    """Etykiety osobowe różnych modeli: PER (wikiann-style), nam_liv_person (KPWr/CLARIN)."""
    return entity_group == "PER" or entity_group.startswith("nam_liv_person")


def _load_herbert():
    from transformers import pipeline

    # Domyślnie clarin-pl/FastPDN (destylat HerBERT-a trenowany na KPWr z pełną fleksją).
    # Empirycznie: fine-tune'y na wikiann (np. pczarnik/herbert-base-ner) NIE generalizują
    # na realne teksty — przegapiały nawet mianownikowe nazwiska. Patrz docs/SOTA-ANALIZA.md.
    model = os.environ.get("PII_NER_MODEL", "clarin-pl/FastPDN")
    min_score = float(os.environ.get("PII_NER_MIN_SCORE", "0.5"))
    strategy = os.environ.get("PII_NER_AGGREGATION", "simple")
    pipe = pipeline("token-classification", model=model, aggregation_strategy=strategy)

    def detect(text: str) -> list[tuple[int, int]]:
        spans: list[tuple[int, int]] = []
        step = _CHUNK_CHARS - _CHUNK_OVERLAP
        for off in range(0, max(len(text), 1), step):
            chunk = text[off : off + _CHUNK_CHARS]
            if not chunk:
                break
            for ent in pipe(chunk):
                if _is_person_label(str(ent.get("entity_group", ""))) and float(ent.get("score", 0)) >= min_score:
                    s, e = _expand_to_word(chunk, int(ent["start"]), int(ent["end"]))
                    spans.append((off + s, off + e))
            if off + _CHUNK_CHARS >= len(text):
                break
        # scal nachodzące/duplikaty z zakładki
        spans.sort()
        merged: list[tuple[int, int]] = []
        for s, e in spans:
            if merged and s <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e))
            else:
                merged.append((s, e))
        return merged

    return detect, {
        "backend": "herbert",
        "model": model,
        "labels": ["PER", "nam_liv_person*"],
        "min_score": min_score,
        "aggregation": strategy,
    }


if BACKEND == "herbert":
    detect_persons, INFO = _load_herbert()
elif BACKEND == "spacy":
    detect_persons, INFO = _load_spacy()
else:
    raise RuntimeError(f"Nieznany PII_NER_BACKEND '{BACKEND}' (dozwolone: spacy, herbert)")

app = FastAPI(title="Anonimizator NER", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class RedactRequest(BaseModel):
    text: str


def _check_auth(authorization: str) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    return {"status": "ok", **INFO}


@app.post("/redact")
def redact(req: RedactRequest, authorization: str = Header(default="")):
    _check_auth(authorization)

    text = req.text or ""
    if not text:
        return {"redacted": text, "found": []}

    spans = detect_persons(text)
    if not spans:
        return {"redacted": text, "found": []}

    # Zamiana od końca (malejące offsety), żeby nie psuć pozycji wcześniejszych encji.
    chars = list(text)
    count = 0
    for s, e in sorted(spans, key=lambda p: p[0], reverse=True):
        chars[s:e] = list(MASK)
        count += 1

    return {"redacted": "".join(chars), "found": [{"type": "IMIE", "count": count}]}
