# Reprodukowalny build paczki „onnx-pack" (NER w przeglądarce, bez Dockera)

Warstwa AI w edycji „pełnej" (`apps/web/src/ner-browser.ts`) ładuje w runtime katalog leżący
**obok `index.html`**:

```
vendor/transformers.web.min.js      # bundel transformers.js (esbuild, browser/ESM)
vendor/ort-wasm-simd-threaded.*     # runtime WASM onnxruntime-web (ładowany przez env.wasmPaths)
models/anonimizator/fastpdn/…       # model FastPDN ONNX int8 (config.json + onnx/ + tokenizer)
```

Ta paczka jest **świadomie poza buildem aplikacji** (single-file HTML zostaje mały) i poza repo
(model ~125 MB). Ten skrypt składa ją reprodukowalnie z zainstalowanych zależności.

## Wymagania

`npm ci` daje `esbuild` i `@huggingface/transformers` (z `onnxruntime-web`) — to wystarcza do
zbudowania **vendora**. Model dostarczasz osobno (niżej).

## Build

```bash
node scripts/build-onnx-pack/build.mjs --out dist-onnx-pack --model-dir <ścieżka-do-modelu>
```

- `--out` — katalog wynikowy (domyślnie `dist-onnx-pack/`, ignorowany przez git).
- `--model-dir` — katalog z modelem FastPDN ONNX int8 (zawiera `config.json` i `onnx/model_quantized.onnx`).
  Pominięty, gdy model już leży w `<out>/models/anonimizator/fastpdn/`.

Vendor JS i pliki `ort-wasm-*` pochodzą z **tej samej** wersji `onnxruntime-web` (spójność ABI) —
dlatego oba bierzemy z `node_modules`.

## Skąd wziąć model

Dwie drogi:

1. **Gotowy (zalecane).** Pobierz `fastpdn-onnx-int8.zip` z release
   [`models-fastpdn-onnx-v1`](https://github.com/karolpolikarp/anonimizator/releases/tag/models-fastpdn-onnx-v1),
   rozpakuj (uwaga: to archiwum `tar` mimo rozszerzenia `.zip` — `tar xf fastpdn-onnx-int8.zip -C model/`)
   i wskaż przez `--model-dir model/`.

2. **Konwersja od zera** (Python) z `clarin-pl/FastPDN` (HerBERT, KPWr, CC-BY-4.0):

   ```bash
   pip install optimum[onnxruntime]
   optimum-cli export onnx --model clarin-pl/FastPDN --task token-classification fastpdn-onnx/
   # kwantyzacja int8 (dynamiczna):
   optimum-cli onnxruntime quantize --avx512 --onnx_model fastpdn-onnx/ -o fastpdn-onnx-int8/
   # transformers.js oczekuje pliku onnx/model_quantized.onnx — dostosuj układ katalogu.
   ```

   Zachowaj atrybucję CC-BY-4.0 (patrz `ATTRIBUTION.md` w paczce modelu).

## Weryfikacja E2E (prawdziwa przeglądarka, WASM)

```bash
# 1) zbuduj edycję AI i dołóż index.html do paczki
npm run build -w anonimizator-web
cp apps/web/dist/index.html dist-onnx-pack/index.html
# 2) opcjonalne narzędzie (nie jest w zależnościach projektu):
npm i -D @playwright/test && npx playwright install chromium
# 3) uruchom weryfikację (serwuje po http, ładuje model przez WASM, sprawdza maskowanie)
E2E_SERVE="$PWD/dist-onnx-pack" node scripts/build-onnx-pack/e2e.mjs
```

`e2e.mjs` sprawdza scenariusz precyzja > recall: obce nazwiska (Nguyen, Schmidt — których rdzeń
nie łapie) są maskowane warstwą ONNX, a homonim „Lis" i instytucja „Sąd Najwyższy" **pozostają**
nietknięte. Zapisuje `e2e-screenshot.png`.

> Uwaga: warstwa AI działa tylko po **http(s)** (przeglądarki blokują WASM/fetch dla `file://`).
> W dystrybucji użytkownik uruchamia `launcher/START-ANONIMIZATOR.bat` (serwer 127.0.0.1).
