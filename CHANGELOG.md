# Changelog

## v0.32.0 — 2026-07-06

- **NIP zapisany spacjami już maskowany** — „526 27 35 917" (i grupowanie 3-3-2-2:
  „526 273 59 17") wcześniej wyciekał, bo wzorzec znał tylko myślniki i 10 cyfr ciągiem.
  Separatorem jest teraz **myślnik LUB spacja**; suma kontrolna liczona po samych cyfrach.
- **Przywrócono odczyt PDF w edycji „urzędnik"** — cofnięto odchudzenie z v0.31 (odcięcie pdfjs).
  Obsługa PDF wróciła do obu edycji; plik znów ~1,77 MB. (Odchudzenie okazało się niepotrzebnym
  kosztem funkcjonalności.)

## v0.31.0 — 2026-07-06

- **Edycja „urzędnik" ~94% mniejsza: 1,77 MB → 99 kB.** Odcięto bibliotekę pdfjs (dominowała
  rozmiar) — w tej edycji obsługa PDF nie jest potrzebna. Plik otwiera się natychmiast i łatwo
  go rozesłać e-mailem. Pełna edycja **zachowuje PDF** (ładowany dynamicznie dopiero przy otwarciu
  pliku PDF). Urzędnik przy próbie wczytania PDF pokazuje jasny komunikat (wklej tekst / TXT / DOCX).
- **Wydajność:** regexy wykrywania nazwisk kompilowane raz (moduł), nie przy każdym wywołaniu.
- **Dokumentacja:** README zsynchronizowane z rzeczywistością (recall 100% offline, morfologiczne
  nazwiska, nowe typy: miejscowość i numer paszportu, ulice z liczbą/skrótem).

## v0.30.0 — 2026-07-06

Zbiorcza optymalizacja z wieloagentowego audytu (9 soczewek → backlog). 17 poprawek,
benchmark bez regresji (recall 100%, precyzja 99,4%), 137 testów rdzenia + 10 web.

- **Precyzja (mniej nadmaskowania — czołowy priorytet pisma urzędowego):**
  - „Nazwisko Imię" (reguła odwrócona) nie kasuje już zwykłego wyrazu przed imieniem —
    „Wczoraj Anna", „Umowa Marii", „Witam Ewa" zostają; nagłówki e-maili („From: Ejkszto Anna")
    nadal maskowane.
  - Nazwy komitetów/związków/parków nietknięte: „Komitet Obywatelski", „Hufiec Harcerski",
    „Bieszczadzki Park Narodowy"; pospolite przymiotniki „Niski poziom", „wąski" itd.
  - „Pan/Pani + funkcja" zachowuje rolę: „Pani Minister", „Pan Wojewoda Mazowiecki" bez zmian,
    „Pan Dyrektor Kowalski" → maska tylko nazwiska.
  - Dowód bez kontekstu wymaga poprawnej sumy kontrolnej — sygnatury/kody („RPO 401234",
    „ABC 123456") nie są brane za dowód.
  - Miesiąc „Maja" nie jest już mylony z imieniem („Pierwszego Maja").
- **Recall (mniej wycieków):** nazwisko słownikowe z myślnikiem („Nowak-Schmidt"), imiona/nazwiska
  zaczynające się od Ł/Ś/Ż/Ą (naprawiona granica słowa), odmieniony honoryfik („Panem Kowalskim").
- **Nowy typ: numer paszportu** — `[NR-PASZPORTU]` (kontekst „paszport" + 2 litery + 7 cyfr),
  osobny przełącznik i chip.
- **Wydajność:** koniec O(N²) w rozpoznawaniu nazwisk; debounce redakcji (~140 ms) — płynne pole
  niezależnie od długości tekstu (licznik znaków nadal natychmiastowy).
- **Dostępność (WCAG):** dostępna nazwa głównego pola, `aria-pressed` na przełączniku widoku,
  koniec zalewania czytnika przy pisaniu (jeden zwięzły komunikat po debounce), treść podpowiedzi
  dostępna dla czytników (aria-label z treści tooltipa).
- **Bezpieczeństwo:** `escapeHtml` obejmuje cudzysłowy, licznik z warstwy NER koercjonowany do liczby.

## v0.29.0 — 2026-07-06

- **Przeglądanie zamaskowanych fragmentów w wyniku** (prośba użytkownika: „łatwo przeglądać
  zanonimizowane dane"). W pasku Wyniku pojawia się nawigacja **‹ N / M ›**:
  - **strzałki + licznik** — poprzedni/następny zamaskowany fragment (cyklicznie); bieżący
    dostaje wyraźny pierścień i **automatycznie pokazuje powód wykrycia** (podświetlenie + tooltip);
  - **klik w znacznik** — czyni go bieżącym; dla pseudonimów `[OSOBA-A]` podświetla **wszystkie
    wystąpienia tej samej osoby**;
  - **klik w chip „Zamaskowano"** (np. „PESEL ×3") — skacze po fragmentach danej kategorii;
  - **klawiatura** — ↑/↓ oraz ←/→ przechodzą między maskami, gdy fokus jest na wyniku;
  - działa w widoku „Wynik" i „Porównanie", uwzględnia `prefers-reduced-motion`, większe cele
    dotykowe na mobile, a kopiowany tekst pozostaje czysty (nawigacja to wyłącznie warstwa UI).

## v0.28.0 — 2026-07-06

- **Rzadkie i odmienione nazwiska maskowane BEZ słownika i BEZ AI — rozpoznawanie
  morfologiczne.** Nazwiska o charakterystycznym polskim sufiksie (`-ski/-cki/-dzki` +
  odmiana, `-icz/-wicz`, `-czyk`) są teraz wykrywane po samej formie: „Gzowskiego",
  „Krzemieniecka", „Bąkiewiczowi", „Zdrojewczyka", „Świętomira Gzowska", „Rzepeckiej-Gil".
  Dotąd łapał je tylko opcjonalny NER — teraz działa to w warstwie offline (edycja „urzędnik").
  **Benchmark (offline, bez NER): recall 89% → 100%, rzadkie nazwiska 51% → 100%, precyzja
  99,4%** — poziom NER, ale w jednym pliku HTML bez instalacji.
- **Precyzja utrzymana dzięki trzem zabezpieczeniom:** (1) stoplista przymiotników
  narodowych/regionalnych/miejskich („polski", „śląski", „warszawski", „mazowiecki"…);
  (2) ochrona nazw instytucji — przymiotnik po rzeczowniku z wielkiej litery nie jest
  nazwiskiem („Uniwersytet Warszawski", „Izba Lekarska", „Bank Śląski", „Politechnika Śląska");
  (3) dzierżawczy dopełniacz przy rzeczowniku maskuje SAMO nazwisko, zostawiając wyraz
  („Zaległości Trzebiatowskiego" → „Zaległości [IMIĘ I NAZWISKO]"). Zweryfikowane na
  realnych frazach urzędowych (zero nadmaskowań).
- **Małżonkowie/rodzeństwo o wspólnym nazwisku** („Anna i Jan Kowalscy") maskowani w całości
  — wcześniej pierwsze imię wyciekało.
- Benchmark uzgodniony z aktualną specyfikacją (miejscowość po kodzie, format dowodu).

## v0.27.0 — 2026-07-06

- **Nowe ikony — inline SVG zamiast ciemnych rastrów.** Dotychczasowe ikony były ciemnymi
  kafelkami PNG, które „gryzły się" z jasnym motywem (skarga użytkownika). Cały zestaw
  (30 ikon) przepisany na inline SVG: ostre w każdym rozmiarze, przezroczyste,
  **automatycznie w kolorze kategorii** (osoby fiolet, kontakt turkus, identyfikatory złoto,
  finanse zieleń, adres/czas błękit), znikoma waga, zero zewnętrznych assetów. Jedno źródło
  prawdy (`icons.ts`), spójne w statycznym HTML i elementach dynamicznych.
- **Lifting UX/UI (na bazie wieloperspektywicznej krytyki):**
  - **Rozwarstwienie jasności** tło/pole/karta — koniec „mdłej", płaskiej bieli; karty
    wyraźniej odcinają się od tła, pola edytorów są jaśniejszym panelem.
  - **Typografia**: baza 16px (czytelność dla urzędników), mocniejszy tytuł (hero),
    spójne wagi 600/700, usunięte niespójne rozmiary „.5px".
  - **Stany**: wyłączony przycisk „Kopiuj" nie wygląda już na aktywny (szary, gdy nie ma
    czego kopiować).
  - **Kroki 1–4**: usunięta zdublowana numeracja (kicker „KROK N" wystarcza).
  - **Kontrast/dostępność**: przyciemnione kolory znaczników kontakt/identyfikatory/finanse
    do AA na tle pól; cienie i drobne błędy (`var(--txt)`) zestrojone z jasnym motywem.
  - **Legenda**: pigułki spójne z resztą rodziny (zaokrąglenie 999px), interlinia edytorów
    zbita 1.9 → 1.6.

## v0.26.0 — 2026-07-06

- **Miejscowość w adresie już nie wycieka** — dotąd maskowaliśmy ulicę i kod pocztowy,
  ale nazwa miasta tuż za kodem zostawała jawna („Królewska 27, 00-060 **Warszawa**").
  Teraz cały blok schodzi do `[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]`. Kotwica to kod
  pocztowy: w polskim adresie miejscowość ZAWSZE stoi za kodem („XX-XXX Miasto"), więc
  rozpoznanie jest pozycyjne i pewne. Miasta jedno- i wielowyrazowe („Nowy Sącz"), z
  myślnikiem („Bielsko-Biała") — maskowane w całości; drugi/trzeci człon doklejany tylko
  gdy tworzy znaną wielowyrazową miejscowość (słownik ~75 pozycji), więc następne zdanie
  („00-950 Warszawa. **Sprawę**…") nie jest pożerane.
- **Miasto PRZED adresem bez kodu też maskowane** — „Warszawa, ul. Królewska 27",
  „Zielona Góra, ul. Długa 5", „Sąd Okręgowy w Poznaniu, ul. …" (także forma zależna).
  Tu nie ma kodu-kotwicy, więc używamy słownika ~250 polskich miast (mianownik + częste
  formy zależne dużych miast) **wyłącznie w pozycji adresowej** „…, ul./[ADRES]". Dzięki
  temu ogon nazwy instytucji NIE jest ruszany („Zarząd Dróg Miejskich, ul. …",
  „Ministerstwo Cyfryzacji, ul. …" → nazwa zostaje).
- **Miasto w WOLNYM TEKŚCIE pozostaje nietknięte** (świadomy wybór: wysoka precyzja, zero
  nadmaskowania) — „mieszka w Warszawie", „dotyczy Warszawy oraz Krakowa", „Sąd Rejonowy
  dla Warszawy-Śródmieścia" bez „, ul./[ADRES]" obok NIE są ruszane. Słownik miast działa
  tylko w pozycji adresowej. Osobny przełącznik „Miejscowość" w „Co maskować".
- **Ulice z liczbą lub skrótem w nazwie już maskowane** — „ul. 3 Maja 1",
  „ul. 11 Listopada 5/3", „ul. gen. Andersa 5", „ul. ks. Popiełuszki 3", „ul. św. Marcin 8".
  Wcześniej wzorzec adresu oczekiwał nazwy z wielkiej litery zaraz po „ul.", więc ulice
  zaczynające się od cyfry lub małego skrótu rangi/tytułu zostawały jawne.

## v0.25.0 — 2026-07-06

- **Dwa imiona + nazwisko — nazwisko już nie wycieka** — „Monika Ewa Nojszewska",
  „Moniką Ewą Nojszewską", „Jan Maria Rokita" maskowane w całości jedną etykietą.
  Wcześniej para zjadała same imiona, a prawdziwe nazwisko zostawało jawne. Logika imion
  przepisana na jedną regułę „imiona (1–2) + nazwisko", kotwiczoną na pierwszym imieniu —
  wyrazy poprzedzające („Pracownik", „Wczoraj") zostają, encje prawne nietknięte.

## v0.24.0 — 2026-07-06

- **Nazwiska w kolejności „Nazwisko Imię" (nagłówki e-maili) maskowane** — listy To/Cc/From
  z Outlooka („Kowalska Ewa", „Ejkszto Anna", „Bryzek-Muszyńska Edyta") są teraz maskowane
  w całości. Wcześniej imię lub całość wyciekało. Reguła wymaga znanego imienia jako drugiego
  słowa i chroni tytuły („Pani Anna" → zostaje „Pani") oraz encje prawne/dokumentowe.
- **+~90 częstych imion w słowniku** (Edyta, Aneta, Iga, Olga, Leon, Fabian, Ksawery…) —
  luka pokrycia wykryta na realnych nagłówkach.

## v0.23.0 — 2026-07-06

- **Adres bez prefiksu „ul." też maskowany** — ulica rozpoznawana po sąsiedztwie kodu
  pocztowego: „Królewska 27, 00-060 Warszawa" i „Aleje Jerozolimskie 100, …" → `[ADRES]`.
  Kotwica na (już zamaskowanym) kodzie pocztowym daje wysoką precyzję — „Rozdział 5",
  „Załącznik 2" czy „poz. 5" nie są mylone z adresem. Zamyka lukę z realnego pisma
  urzędowego, gdzie ulica bez „ul." zostawała jawna.

## v0.22.0 — 2026-07-06

- **Numer wersji w nagłówku + link „sprawdź najnowszą"** — pod tytułem widnieje teraz
  „wersja X · sprawdź najnowszą ↗" prowadząca do strony wydań. Rozwiązuje powracające
  zamieszanie: użytkownik testował stary, wcześniej pobrany plik, nie wiedząc, że jest
  nieaktualny — teraz od razu porówna numer.
- **Edycja urzędnik bez wzmianek o AI** — nagłówek, plakietka i krok „Analiza" nie mówią
  już o „lokalnym AI/NER" (którego w tej edycji nie ma) — spójny, uczciwy przekaz dla
  głównej grupy docelowej.

## v0.21.0 — 2026-07-06

- **Imiona w ODMIANIE nie wyciekają już obok nazwiska** — „Anną Kowalską", „Janem
  Nowakiem", „Annę Wiśniewską" maskowane w całości. Wcześniej słownik znał tylko mianownik,
  więc nazwisko znikało, a imię („Anną") zostawało jawne. Teraz imię rozpoznajemy po rdzeniu
  słownikowym + końcówce fleksyjnej (para „imię-jak + nazwisko" → jedna maska). Encje prawne
  („Sąd Najwyższy", „Kodeks Cywilny") i miasta („w Warszawie") pozostają nietknięte.

  Uwaga dla użytkowników: to poprawka w kodzie — pobierz świeży `Anonimizator.html`
  z tego wydania (stary, wcześniej zapisany plik nie ma tych zmian).

## v0.20.0 — 2026-07-06

- **Jasny, przyjazny motyw** (feedback: „zrób bardziej przyjazną kolorystykę") — cała
  aplikacja przełączona z ciemnego „enterprise" na jasny, bliski oprogramowaniu
  biurowemu/urzędowemu: białe karty, delikatne błękity, przyciemnione kolory kategorii
  dla kontrastu. Zweryfikowane zrzutem (obie edycje).
- **Koniec dziury obok „Co maskować"** — po usunięciu karty NER w edycji urzędnik
  „Co maskować" rozciąga się na całą szerokość, a przełączniki układają się w responsywną
  siatkę (5 w rzędzie zamiast 2). Struktura strony bez pustych flanków.
- **Numer dowodu wykrywany także BEZ kontekstu** — sam format „3 wielkie litery + 6 cyfr"
  (`ABC 123456`, `ABC123456`) jest maskowany, bo to charakterystyczny układ dowodu; wyjątek:
  kody walut (`PLN 123456`). Rozszerzone też wyzwalacze kontekstowe (legitymacja, dokument
  tożsamości, „dowód osobisty nr …"). Kompromis: numer typu `FVS 202401` też zostanie
  zamaskowany — świadomie w stronę bezpieczeństwa.

## v0.19.0 — 2026-07-06

Wydanie skrojone pod główną grupę docelową — **urzędników** (feedback z testów na realnych
pismach). Wersja dla prawników/zaawansowanych przyjdzie osobno.

- **Release = jeden plik + instrukcja.** Zasób wydania to teraz `Anonimizator.html`
  (samowystarczalny, podwójny klik) i `JAK-UZYC.txt` — koniec z ZIP-em, launcherem i AI
  w paczce. **Cała wiedza (NER, launcher, ONNX, LLM) zostaje w repozytorium** — znika
  wyłącznie z wydania. Build „urzędnik" (`VITE_EDITION=urzednik`) ukrywa warstwę AI/NER
  (elementy `[data-full]`) już od pierwszego malowania, bez mignięcia.
- **Telefony stacjonarne z +48** — naprawiony realny błąd z pism: numer
  `+48 22 245 59 22` (podział 2-3-2-2) zostawał jawny, bo detektor zakładał tylko układ
  3-3-3. Teraz prefiks `+48/0048` dopuszcza dowolne grupowanie 9 cyfr, a słowa
  kontekstowe (`tel.`, `telefon`, `kom.`, `fax`) też wyzwalają maskowanie stacjonarnych.
- **Nr dowodu osobistego z kontekstem** — słowa `dowód/dowodu/seria i numer/nr dowodu`
  (z diakrytykiem i bez) maskują numer `ABC 123456` nawet bez poprawnej sumy kontrolnej;
  bez kontekstu nadal wymagana suma (mało fałszywych trafień). „dowód zakupu" nie jest
  mylony z dowodem osobistym.

## v0.18.0 — 2026-07-06

- **AI jednym kliknięciem, bez Dockera** — launcher `START-ANONIMIZATOR.bat` +
  `launcher/serve.ps1`: mini-serwer na `127.0.0.1` (zwykły `TcpListener`, bez uprawnień
  administratora, bez zależności) podaje aplikację po `http`, dzięki czemu model
  ONNX w przeglądarce rusza po podwójnym kliknięciu. Launcher trafia do paczki offline;
  instrukcja krok po kroku: [`docs/AI-BEZ-DOCKERA.md`](./docs/AI-BEZ-DOCKERA.md).
  Odpowiedź na feedback: „większość urzędników nie zainstaluje Dockera”.
- **NER przeprojektowany na „AI, opcjonalne”** — karta zwinięta domyślnie (mniej
  natłoku), prowadzi ścieżką przeglądarkową (Docker zdegradowany do „zaawansowane”),
  status widoczny na zwiniętym nagłówku. Selektor źródła zawsze dostępny (koniec
  uwięzienia użytkowników Dockera bez paczki ONNX).
- **Czytelniejsza legenda kategorii** — duże kolorowe kropki zamiast maleńkich ikon,
  wyraźniejsze etykiety i kontrast (feedback: „wiersz słabo widoczny, ikonki za małe”).
- **Mniej natłoku** — tabela „Co wykrywa” zwinięta domyślnie (czysty widok narzędzia,
  szczegóły po kliknięciu).

## v0.16.0 — 2026-07-05

- **Ikony wróciły** (sprite użytkownika) — nagłówek, przyciski, karty ustawień;
  na stonowanych kafelkach wpasowanych w ton enterprise.
- **Wypełnienie ekranu**: sekcja „Co wykrywa" w układzie dwukolumnowym —
  tabela + boczna kolumna trzech kart („Dlaczego mało fałszywych trafień",
  „Ograniczenia", „Wskazówki" ze skrótami klawiszowymi w stylu <kbd>);
  całość poszerzona do 1320 px. Koniec pustych flanków na szerokich ekranach.

## v0.15.0 — 2026-07-05

**Ułożenie treści** (architektura informacji):

- Hero odchudzone: wielkie pudło prywatności → smukła linijka pod badge'ami
  (komunikat „100% Offline" niesie już badge); mniej dublowania, szybciej do narzędzia.
- **Kroki 1→4 przeniesione NAD narzędzie** jako kompaktowy poziomy pasek
  (numer + tytuł + krótki opis) — edukacja przed użyciem, bez spychania panelu;
  znika duża sekcja kroków z dołu strony.
- **Tabela „Co wykrywa" pogrupowana kategoriami** w kolejności: identyfikatory →
  finanse → kontakt → adres/czas → osoby, z kolorowymi kropkami zgodnymi ze
  znacznikami w wyniku — treść strony i wynik mówią jednym językiem;
  zaktualizowany opis wiersza „Imię i nazwisko" (~230 nazwisk z odmianą).

## v0.14.0 — 2026-07-05

**Repozycjonowanie stylu: dark enterprise zamiast „cyber-gaming"** (feedback:
„zbyt gamingowo, za mało profesjonalnie"):

- Usunięte: siatka i kolorowe poświaty tła, neonowe glow na kartach/CTA/badge'ach,
  gradientowy tytuł, prefiks `//` nagłówków, kreskówkowe ikony ze sprite'a
  w przyciskach (zostaje favicon).
- W zamian: płaskie powierzchnie z subtelną elewacją, czysty wordmark, jednolite
  spokojne badge'e, pełny solidny akcent #3663d9, minimalistyczne kroki 1→4,
  mniejsze promienie (8–12px), typografia w duchu Linear/Vercel.
- Kolory znaczników PII zostają (funkcja czytania wyniku), ale w stonowanych
  odcieniach; przekreślenia w Porównaniu przygaszone.

## v0.13.0 — 2026-07-05

**Przestrzeń i hierarchia** (feedback: „więcej oddechu, lepszy układ, lepsza kolejność"):

- Wycentrowane hero z dużym światłem (tytuł 2.9rem, tagline, badge'e i plakietka
  prywatności na osi), sekcje rozsunięte do 5.5–6rem, stopka wycentrowana.
- **Ustawienia w dwóch kartach obok siebie** („Co maskować" | „Dokładniejsze
  wykrywanie nazwisk") — koniec pionowego ścisku pod narzędziem; na mobile
  wracają do jednej kolumny.
- Większe wszystko: padding paneli 1.75rem, pola 360px z paddingiem 1.3rem,
  odstęp paneli 2rem, kroki z gap 2rem, komórki tabeli 0.85/1.2rem,
  delikatniejsza siatka tła.

## v0.12.0 — 2026-07-04

- **Widok „Porównanie"** — recenzja jak w Wordzie: oryginalna wartość przekreślona
  na czerwono obok kolorowego znacznika, w jednym dokumencie. Przełącznik
  Wynik | Porównanie w panelu wyniku; po wczytaniu pliku (DOCX/PDF/TXT) tryb
  porównania włącza się automatycznie. Diff w O(n) bez bibliotek (nie-maskowe
  segmenty wyniku występują w oryginale dosłownie i po kolei).
- **Oddech**: większe światło w całym układzie (padding paneli/pól/tabeli,
  odstępy sekcji 4rem, delikatniejsza siatka tła) — czytelniej i bardziej
  profesjonalnie, klimat „2027" bez zmian.

## v0.11.0 — 2026-07-04

**Pełny redesign wizualny „2027"** (kierunek: cyber-privacy, na bazie UI-kitu użytkownika):

- Dark-only: głęboki granat z techniczną siatką i poświatami (czysty CSS, zero
  zewnętrznych zasobów — single-file bez zmian architektury).
- Gradientowy tytuł ze świecącą plakietką, rząd badge'ów (100% Offline / Bezpieczne /
  Open Source·MIT / Reguły+lokalne AI), pasek kroków 1→4, nagłówki sekcji w stylu `//`.
- **Kolorowe znaczniki per kategoria PII** — spójnie w wyniku i chipach:
  osoby=fiolet, kontakt=cyjan, identyfikatory=bursztyn, finanse=zieleń,
  adres/czas=błękit. Wynik czyta się na pierwszy rzut oka.
- Świecące CTA (gradient + glow), neonowe stany hover/focus/drag, tabela
  z hover-em wierszy, sekcja ograniczeń z bursztynową listwą.
- Weryfikacja: pełnostronicowe zrzuty desktop/mobile (0 px poziomego overflow),
  regresja NER ONNX 4/4.

## v0.10.0 — 2026-07-04

Duży szlif UX/UI po audycie panelu 5 agentów (5 soczewek, 39 znalezisk — wdrożone
wszystkie P0, komplet P1 i większość P2):

- **Mobile naprawione na dobre**: przyciski przenoszą się do własnego wiersza
  (koniec poziomego overflow), pola krótsze (wynik widoczny bez przewijania),
  fonty pól ≥16 px (iOS nie robi auto-zoomu), cele dotykowe ≥44 px.
- **Dostępność**: panel wyniku to nazwany, fokusowalny region (przewijanie
  z klawiatury); aria-live przeniesione na pasek wyników (czytnik nie czyta całego
  tekstu przy każdym klawiszu); spójny :focus-visible wszędzie; color-scheme
  (natywne kontrolki w kolorach motywu); prefers-reduced-motion.
- **Bezpieczeństwo pracy użytkownika**: upuszczenie pliku GDZIEKOLWIEK wczytuje go
  (wcześniej drop obok pola kasował stronę z tekstem!); link GitHub w nowej karcie;
  notka „⚠️ przejrzyj wynik" bezpośrednio pod wynikiem.
- **Stany**: „Wczytuję…" przy parsowaniu PDF/DOCX, „analizuję…" przy NER + błysk
  po dołożeniu masek, pasek błędów w UI zamiast alert(), martwe Kopiuj/Pobierz
  są teraz disabled, mini-przykład „przed → po" w pustym wyniku.
- **Język i detale**: „Wynik — zanonimizowany", plik zanonimizowany.txt, „Wynik
  skanowania:" przy zeru trafień, etykieta NER od korzyści (nie od akronimu),
  poprawiona podwójna negacja w „Co maskować", kontrast CTA w dark (AA),
  naprawiony promień tabeli, theme-color per motyw, wersja aplikacji w stopce.

## v0.9.1 — 2026-07-04

- **Ikony w interfejsie** (sprite od użytkownika, wycięte i osadzone inline —
  paczka offline nadal jednoplikowa): nagłówek, Przykład/Wczytaj/Wyczyść/Kopiuj/
  Pobierz, „Co maskować", plakietka NER. Świeży zrzut w README.
- **Podpowiedź o warstwie NER**: gdy rdzeń nic nie znajdzie, a NER jest wyłączony,
  pasek wyników podpowiada włączenie NER (feedback: trudne nazwiska bez NER dawały
  mylące zielone „nie wykryto danych osobowych").
- **Benchmark warstwy ONNX (int8)** na tym samym zbiorze 159 przypadków:
  **97,5% recall / 98,8% precision** (~7 ms/tekst na CPU) — recall minimalnie niższy
  od FastPDN w Dockerze (kwantyzacja), precyzja najwyższa ze wszystkich warstw NER.

## v0.9.0 — 2026-07-04

- **NER w przeglądarce (ONNX)** — finał programu SOTA T1–T5: rozpakuj
  `anonimizator-onnx-pack.zip` (z release'u `models-fastpdn-onnx-v1`) obok `index.html`,
  a przy serwowaniu po http w ustawieniach NER pojawia się źródło „w przeglądarce
  (ONNX, bez Dockera)" — pełny recall FastPDN w 100% offline, bez instalowania
  czegokolwiek. E2E zweryfikowane (Playwright): 4/4 trudne nazwiska w odmianie.
  Build aplikacji bez zmian rozmiaru (dynamiczny import spoza bundla); z `file://`
  opcja się nie pojawia (ograniczenie wasm/fetch przeglądarek).

Format wersji: [SemVer](https://semver.org/lang/pl/). Tagi `vX.Y.Z` budują paczkę
offline (`anonimizator-offline.zip`) w [Releases](https://github.com/karolpolikarp/anonimizator/releases).

## v0.8.0 — 2026-07-04

Trzy równoległe fronty programu SOTA (T3+T4+T5) w jednym wydaniu:

- **Benchmark** (`scripts/benchmark`, raport w `docs/BENCHMARK.md`): 159 przypadków
  z odmianą i negatywami. Wyniki: core 86,5% R / 99,4% P; core+FastPDN 99,4% R / 97,1% P.
- **4 fixy rdzenia wykryte benchmarkiem**: REGON ze złą sumą nie jest już zjadany
  przez detektor telefonu; „ur. 12.05.1985" maskowane (bug trailing \b); adresy
  w formach zależnych („na ulicy…"); nazwiska dwuczłonowe po wyzwalaczu w całości
  („Pan Habdank-Wojewódzki"). +4 testy regresyjne.
- **Warstwa LLM** (`anonimizator/llm`): `redactPIIUltra` przez lokalne Ollama
  (np. Bielik-11B) — span-extraction z twardą walidacją, fail-safe, breaker;
  eksperymentalna. +11 testów.
- **FastPDN jako ONNX int8** (release `models-fastpdn-onnx-v1`, 125 MB, CC-BY-4.0
  z atrybucją CLARIN-PL): NER bez Dockera przez transformers.js (~16 ms/akapit CPU);
  przykład `examples/ner-onnx-node.mjs` (zweryfikowany end-to-end).

## v0.7.0 — 2026-07-04

- **Usługa NER z dwoma backendami** (T2): `spacy` (domyślny, lekki) i `herbert`
  (transformers — `clarin-pl/FastPDN`, destylat HerBERT-a trenowany na KPWr).
  Na teście 7 trudnych nazwisk w odmianie: FastPDN 7/7 z kompletnymi spanami
  (w tym „Sarneckiej-Dul"), spaCy 7/7 z uciętym członem po myślniku.
  Wybór: `docker compose build --build-arg NER_BACKEND=herbert`.
- Odrzucony po testach: `pczarnik/herbert-base-ner` (wikiann) — mimo F1≈0,90
  na karcie modelu nie generalizował na realne zdania (szczegóły w SOTA-ANALIZA).
- Naprawa subwordowych offsetów (expand-to-word + scalanie), chunking długich
  tekstów z zakładką, filtr etykiet PER/nam_liv_person.

## v0.6.0 — 2026-07-04

- **Spójna pseudonimizacja** (T1b): opcja `pseudonyms` / flaga CLI `--osoby` /
  checkbox „Rozróżniaj osoby" — każda osoba dostaje stałą etykietę [OSOBA-A]/[OSOBA-B]…,
  zachowywaną w odmianie (Kowalski/Kowalskiego → ta sama litera). Zachowuje strukturę
  relacji w dokumentach prawnych. Ograniczenie: klucz = nazwisko, więc Jan i Anna
  Kowalscy dzielą etykietę. +6 testów.

## v0.5.0 — 2026-07-04

Start programu „najlepszy anonimizator PL 2026/2027" — analiza SOTA i architektura
warstwowa w [docs/SOTA-ANALIZA.md](./docs/SOTA-ANALIZA.md).

- **Słownik ~230 najczęstszych polskich nazwisk z obsługą fleksji** w rdzeniu (T1a):
  maskuje nazwisko występujące samodzielnie („Sprawę Kowalskiego przekazano…"),
  w odmianie przymiotnikowej (-ski/-cki/-dzki, formy żeńskie i mnogie) i rzeczownikowej
  (Nowakowi, Wójcikiem), z ruchomym „e". Nazwiska-homonimy (Wilk, Baran, Mazurek…)
  świadomie wymagają kontekstu — „Wilk biegał po lesie" nie jest maskowane.
  Zero nowych zależności; działa w paczce offline i npm. +8 testów.

## v0.4.0 — 2026-07-04

- **Aplikacja czyta pliki PDF** — pdf.js (legacy build) z fake-workerem w buildzie
  single-file; ekstrakcja w pełni offline, zweryfikowana E2E z `file://`.
  Skany (bez warstwy tekstu) i PDF-y z hasłem dostają jasne polskie komunikaty.
  Paczka offline: ~31 kB → ~1,7 MB (544 kB gzip) — nadal jeden plik.
- 3 testy ekstrakcji PDF (minimalny PDF budowany w teście) + diagnostyczny `?pdftest`.

## v0.3.4 — 2026-07-04

- Zmergowane wszystkie 8 PR-ów Dependabota: TypeScript 6.0, Vitest 4, Vite 8,
  actions/checkout v7, setup-node v6, gh-release v3, minima pip usługi NER.
  Naprawy pod TS 6.0: jawny `rootDir` w buildzie core, `vite-env.d.ts` dla importu CSS.
- 7 testów jednostkowych parsera .docx w CI (dotąd tylko ręczny smoke-test).
- Angielskie streszczenie w README.

## v0.3.3 — 2026-07-04

- Favicon aplikacji (inline SVG — działa też offline) i `theme-color`.
- Szablony zgłoszeń GitHub (nierozpoznane PII / fałszywe trafienie) z ostrzeżeniem,
  by NIE wklejać prawdziwych danych osobowych do publicznych issues.
- Dependabot (npm / pip / GitHub Actions, tygodniowo).
- Zweryfikowany układ mobilny (~500 px, jedna kolumna); odświeżony zrzut w README.

## v0.3.2 — 2026-07-04

Przegląd stabilizacyjny:

- **CI typechekuje aplikację webową** (`tsc --noEmit`) — Vite tylko transpiluje,
  więc błędy typów przechodziły niezauważone.
- Uczciwy komunikat, gdy część typów jest wyłączona w „Co maskować" — zamiast
  mylącego „nie wykryto danych osobowych".
- „Kopiuj" ma fallback, gdy przeglądarka odmówi Clipboard API.
- CLI zdejmuje BOM z plików UTF-8 (Windows/`Out-File`).

## v0.3.1 — 2026-07-04

- UX: „Kopiuj" jako przycisk główny (akcent) + skrót **Ctrl/Cmd+Enter**; licznik
  zamaskowanych wystąpień w pasku „Zamaskowano (N)"; autofocus pola tekstowego.
- Paczka npm: dołączony `LICENSE`; zawartość zweryfikowana `npm publish --dry-run`
  (8 plików, ~11,5 kB). Homepage repo wskazuje najnowszy release.

## v0.3.0 — 2026-07-04

- **Aplikacja czyta pliki .docx** — ekstrakcja tekstu w 100% lokalnie (maleńki `fflate`
  + własny parser `word/document.xml`, bez ciężkich zależności); drag&drop i „Wczytaj plik".
- `CHANGELOG.md`.

## v0.2.1 — 2026-07-04

- **Naprawiona paczka offline**: Chromium blokuje skrypty modułowe i style `crossorigin`
  na `file://`, więc rozbite assety nie działały po podwójnym kliknięciu w Chrome/Edge.
  Teraz build to JEDEN samowystarczalny `index.html` (JS+CSS inline, ~24 kB).
- Zrzut ekranu aplikacji w README; parametr `?demo` autouzupełnia przykład.
- Bezpiecznik renderowania: wyniki > 300 tys. znaków bez podświetleń (ochrona DOM);
  zmierzona wydajność silnika: ~1,45 mln znaków w ~31 ms.

## v0.2.0 — 2026-07-03

- Biblioteka: `redactPII(tekst, { types?, masks? })` — wybór typów do maskowania
  i własne placeholdery; ścieżka bez opcji niezmieniona.
- Aplikacja: panel „Co maskować" (zapamiętywany lokalnie); odznaczenie imion wyłącza NER.
- Badge'e CI/Release/MIT w README.

## v0.1.1 — 2026-07-03

- Przycisk „Przykład" (pokazuje maskowanie + strażnik kontekstu numerów przepisów).
- Drag&drop pliku `.txt` na pole tekstowe.
- `JAK-UZYC.txt` w paczce offline; tematy repo na GitHubie.

## v0.1.0 — 2026-07-03

- Pierwsze wydanie: silnik regex + sumy kontrolne (PESEL/NIP/REGON/IBAN/nr dowodu),
  heurystyka imion i adresów, strażniki kontekstu prawnego; biblioteka npm (zero
  zależności), CLI, aplikacja webowa 100% client-side.
- Opcjonalny lokalny NER (spaCy PL): usługa `services/ner` (Docker) + klient
  `anonimizator/ner` (fail-safe, circuit breaker).
