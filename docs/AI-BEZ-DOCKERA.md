# Dokładniejsze wykrywanie nazwisk — AI bez Dockera

Podstawowa wersja Anonimizatora (reguły, słowniki, sumy kontrolne) działa od razu po
otwarciu `index.html` — nic nie musisz instalować. Ta instrukcja dotyczy **opcjonalnego
AI**, które dokłada rzadkie i odmienione nazwiska (np. „sprawa Grzegorzewskiego”,
„zeznanie Bąkiewicza”). Model działa **w całości na Twoim komputerze** — tekst nie jest
nigdzie wysyłany.

Nie potrzebujesz Dockera ani uprawnień administratora. Wystarczy jeden dodatkowy plik
z modelem i podwójne kliknięcie.

## Krok po kroku (Windows)

1. **Pobierz aplikację** — `anonimizator-offline.zip` z
   [Releases](https://github.com/karolpolikarp/anonimizator/releases) i rozpakuj do
   dowolnego folderu.
2. **Pobierz model** — `anonimizator-onnx-pack.zip` z
   [Releases → models-fastpdn-onnx-v1](https://github.com/karolpolikarp/anonimizator/releases/tag/models-fastpdn-onnx-v1)
   (~190 MB). Rozpakuj jego zawartość **do tego samego folderu**, obok `index.html` —
   pojawią się tam katalogi `vendor/` i `models/`.
3. **Uruchom** `START-ANONIMIZATOR.bat` (podwójny klik). Otworzy się okno konsoli i
   przeglądarka pod adresem `http://127.0.0.1:8123`.
4. W sekcji **„Wykrywanie nazwisk AI”** przestaw przełącznik na **Włącz AI**. Status
   zmieni się na „aktywny ✓ (AI w przeglądarce)”. Model ładuje się raz przy pierwszym
   użyciu, potem jest w pamięci przeglądarki.
5. Gotowe. Zamknięcie okna konsoli zatrzymuje aplikację.

## Dlaczego to jest bezpieczne

- `START-ANONIMIZATOR.bat` uruchamia mały serwer, który nasłuchuje **wyłącznie na
  `127.0.0.1`** (pętla lokalna Twojego komputera). Nie jest widoczny w sieci ani dla
  innych urządzeń.
- Model i tekst nie opuszczają przeglądarki — możesz odłączyć internet i sprawdzić,
  że wszystko dalej działa.
- Kod serwera to jeden czytelny plik [`launcher/serve.ps1`](../launcher/serve.ps1)
  (~100 linii, bez zależności) — możesz go przejrzeć.

## Dlaczego potrzebny jest ten launcher (a nie sam `index.html`)

Przeglądarki blokują wczytywanie modeli AI (WebAssembly + pliki modelu) dla stron
otwartych bezpośrednio z dysku (`file://`). Dlatego sama warstwa AI wymaga podania
strony przez `http://` — i właśnie to robi launcher, lokalnie, jednym kliknięciem.
Wersja bez AI (reguły + słowniki + sumy kontrolne) działa również z `file://`.

## Wariant dla programistów

Jeśli masz Node, zamiast `.bat` możesz serwować folder czymkolwiek, co daje HTTP:

```bash
npx serve apps/web/dist      # albo: npm run preview
```

Alternatywa serwerowa (dla zaawansowanych, wymaga Dockera): usługa NER w
[`services/ner`](../services/ner/README.md) — przełącz wtedy „Skąd model” na
„usługa w Dockerze”.
