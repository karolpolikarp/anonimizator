# Analiza SOTA: najlepszy anonimizator języka polskiego 2026/2027

Data analizy: 2026-07-04. Cel: maksymalna skuteczność (recall) przy zachowaniu filozofii
projektu — **wszystko lokalnie, fail-closed, deterministyczny rdzeń zawsze działa**.

## Krajobraz technologii (stan na 2026)

| Podejście | Przykłady | Polski? | Ocena dla nas |
|---|---|---|---|
| Reguły + sumy kontrolne | nasz rdzeń; Presidio (wzorce) | ✅ | Nie do zastąpienia dla PESEL/NIP/IBAN — 100% precyzji na walidowalnych ID. Zostaje fundamentem. |
| Słowniki + fleksja | rejestr PESEL (nazwiska), NKJP | ✅ | **Nisko wiszący owoc**: top-nazwiska pokrywają duży odsetek populacji; deterministyczne, zero instalacji. |
| NER klasyczny (spaCy) | `pl_core_news_lg` (nasz T2 obecnie) | ✅ | Dobry, ale nie SOTA — słabszy recall na odmianie i rzadkich nazwiskach. |
| NER transformer | **HerBERT-NER** (F1≈0,90 PolEval), PolDeepNer2 (CLARIN-PL) | ✅ dedykowany | **SOTA dla polskiego NER.** Naturalny upgrade usługi Dockerowej. |
| Zero-shot NER (GLiNER) | GLiNER2-PII (0.3B, 42 typy, Apache-2.0), gliner_multi_pii-v1 | ⚠️ brak jawnego PL (EN/FR/ES/DE/IT/PT/NL) | Kusząca taksonomia 42 typów PII, ale polski niezweryfikowany — do benchmarku, nie do produkcji na ślepo. |
| LLM lokalny | **Bielik-11B-v3** (GGUF Q4 ~7 GB, Ollama/LM Studio), PLLuM (NASK) | ✅ natywnie | Najlepsze rozumienie kontekstu, ALE: niedeterministyczny, wolny, ciężki (GPU/7 GB), ryzyko przepisania treści. Tylko jako OPCJONALNA warstwa, nigdy rdzeń. |
| LLM chmurowy | GPT/Claude/Gemini | ✅ | ❌ Sprzeczny z celem projektu (dane wychodzą do podmiotu trzeciego). Odrzucone. |

## Decyzja: architektura warstwowa (tiers)

Każda warstwa podnosi recall; awaria wyższej NIGDY nie obniża ochrony niższej (fail-safe,
sprawdzone w praktyce na warstwie NER).

```
T0  Reguły + sumy kontrolne          zawsze, wszędzie (31 kB, przeglądarka/Node/CLI)
T1  Słownik nazwisk + fleksja        zawsze (deterministyczny, w rdzeniu)
    + spójna pseudonimizacja         opcja ([OSOBA-A]/[OSOBA-B] zamiast jednej maski)
T2  NER neuronowy (usługa lokalna)   opcja: spaCy (lekki) | HerBERT-NER (SOTA PL)
T3  LLM lokalny (Ollama/Bielik)      opcja eksperymentalna: "druga opinia"
T4  Benchmark                        zbiór ewaluacyjny PL + miary P/R per typ per warstwa
T5  NER w przeglądarce (ONNX)        transformers.js — recall T2 bez instalacji
```

## Uzasadnienia kluczowych decyzji

**Dlaczego nie LLM w rdzeniu (Bielik/PLLuM)?** Anonimizacja to zadanie bezpieczeństwa:
(1) LLM bywa niedeterministyczny — ten sam tekst może dać różne wyniki; (2) generatywne
przepisywanie tekstu może ZMIENIĆ treść merytoryczną (niedopuszczalne w dokumentach
prawnych); (3) 7 GB + GPU to bariera sprzeczna z "każdy w najprostszy sposób";
(4) prompt-injection: tekst wejściowy może manipulować modelem. LLM ma sens wyłącznie
jako **ekstraktor spanów** (wskazuje fragmenty-kandydatów, maskowanie robi kod) z twardą
walidacją, że wskazane spany istnieją w tekście — nigdy jako przepisywacz.

**Dlaczego HerBERT, a nie GLiNER, jako następca spaCy?** HerBERT jest trenowany na
polskim i zwalidowany (PolEval F1≈0,90); GLiNER-PII nie deklaruje polskiego. GLiNER
zostaje jako kandydat do benchmarku (T4 rozstrzygnie liczbami).

**Dlaczego słownik nazwisk przed upgradem NER?** Zero kosztu dystrybucji (działa w 31 kB
paczki offline i w npm), deterministyczny, natychmiastowy skok recall dla najczęstszych
nazwisk Polaków — także w przypadkach, gdzie NER nie jest zainstalowany (większość
użytkowników ZIP-a).

**Pułapka homonimów**: wiele polskich nazwisk to rzeczowniki pospolite (Baran, Lis, Wilk,
Mazur, Sowa, Mucha, Kot…). Zasada: nazwisko-homonim maskujemy TYLKO z kontekstem
(imię obok / tytuł „Pan"), nazwisko jednoznaczne (Kowalski, Wiśniewski…) — także solo.
Lepiej stracić trochę recall niż maskować „Wilk biegał po lesie".

## Plan wykonania

- [x] T1a: słownik ~300 najczęstszych nazwisk (rejestr PESEL) + obsługa fleksji
      (-ski/-cki/-dzki + końcówki rzeczownikowe) + strażnik homonimów.
- [ ] T1b: spójna pseudonimizacja (opcjonalna: [OSOBA-A], [OSOBA-B]…).
- [x] T2: `services/ner` z wyborem backendu: `spacy` | `herbert` (transformers).
      **Wynik empiryczny (2026-07-04):** `pczarnik/herbert-base-ner` (wikiann, „F1 0,896")
      poległ na realnych zdaniach — na 7 osób wykrył fragment jednej; fine-tune'y wikiann
      nie generalizują (Wikipedia ≈ mianowniki). Wybrany model: **`clarin-pl/FastPDN`**
      (destylat HerBERT-a, KPWr z pełną fleksją) — 7/7 osób z kompletnymi spanami,
      lepszy od spaCy (który ucinał człon po myślniku: „[MASKA]-Dul"). Wniosek
      metodologiczny: metryka z karty modelu ≠ jakość na docelowej dystrybucji tekstów.
- [x] T3: `anonimizator/llm` — `redactPIIUltra` przez lokalne Ollama (Bielik), tryb
      span-extraction z twardą walidacją (halucynacje/injection ⇒ co najwyżej NADmaskowanie),
      fail-safe + breaker; 11 testów mockowych (Ollama nieobecna lokalnie — bez testu live).
- [x] T4: `scripts/benchmark` — 159 przypadków (seed 20260704), raport w docs/BENCHMARK.md.
      **Wyniki po fixach z benchmarku:** core 86,5% R / 99,4% P (strukturalne 100%);
      core+spaCy 99,4% R / 94,7% P; core+FastPDN **99,4% R / 97,1% P** (najlepszy).
      Benchmark wykrył i pozwolił naprawić 4 bugi rdzenia (REGON→telefon, „ur. ",
      „na ulicy…", nazwiska dwuczłonowe po wyzwalaczu).
- [x] T5: NER bez Dockera — konwersja FastPDN→ONNX int8 (125 MB, release
      `models-fastpdn-onnx-v1`, atrybucja CC-BY-4.0), przykład Node
      (`examples/ner-onnx-node.mjs`, ~16 ms CPU) ORAZ integracja w UI przeglądarki:
      drop-in „onnx-pack" (vendor+model obok index.html) wykrywany automatycznie,
      źródło „w przeglądarce (ONNX)" w ustawieniach NER, E2E zweryfikowane Playwrightem.
      Pułapki udokumentowane w kodzie: `transformers.web.min.js` z npm NIE jest
      samowystarczalny (goły import onnxruntime-web → własny bundle esbuildem);
      `env.allowLocalModels=true` konieczne w przeglądarce; `localModelPath` MUSI być
      względne (absolutny URL → gałąź lokalna pomijana); id modelu musi być dwuczłonowe.

## Źródła

- GLiNER: https://github.com/urchade/GLiNER · GLiNER2-PII: https://arxiv.org/abs/2605.09973
  · https://huggingface.co/fastino/gliner2-privacy-filter-PII-multi (języki: EN/FR/ES/DE/IT/PT/NL)
  · https://huggingface.co/urchade/gliner_multi_pii-v1
- HerBERT: https://huggingface.co/docs/transformers/model_doc/herbert (KLEJ/PolEval)
- PolDeepNer2: https://github.com/CLARIN-PL/PolDeepNer2
- Bielik GGUF w LM Studio/Ollama: https://ainarzedziapolska.lovable.app/blog/lm-studio-po-polsku-2026
  · PLLuM: https://www.poradyodo.pl/ado/pllum-powstaje-polski-model-ai-13033.html
