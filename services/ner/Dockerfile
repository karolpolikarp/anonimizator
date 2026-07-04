FROM python:3.12-slim

# Backend do wyboru w czasie budowania:
#   spacy   (domyślny) — pl_core_news_lg, lekki i szybki
#   herbert (SOTA PL)  — pczarnik/herbert-base-ner, lepszy recall, większy obraz
ARG NER_BACKEND=spacy
ARG SPACY_MODEL=pl_core_news_lg
ARG HERBERT_MODEL=clarin-pl/FastPDN

# app.py dobiera domyślny model stosownie do backendu — nie ustawiamy PII_NER_MODEL.
ENV PII_NER_BACKEND=${NER_BACKEND}

WORKDIR /app

COPY requirements.txt requirements-herbert.txt ./
RUN if [ "$NER_BACKEND" = "herbert" ]; then \
      pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
      && pip install --no-cache-dir -r requirements-herbert.txt \
      && python -c "from huggingface_hub import snapshot_download; snapshot_download('${HERBERT_MODEL}')"; \
    else \
      pip install --no-cache-dir -r requirements.txt \
      && python -m spacy download ${SPACY_MODEL}; \
    fi

COPY app.py .

EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
