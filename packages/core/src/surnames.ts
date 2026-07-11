/**
 * Słownik najczęstszych polskich nazwisk (wg statystyk rejestru PESEL) + obsługa fleksji.
 *
 * Cel: maskować nazwisko WYSTĘPUJĄCE SAMODZIELNIE („Sprawę Kowalskiego przekazano…"),
 * którego nie złapie ani para „Imię Nazwisko", ani wyzwalacz „Pan/Pani…".
 *
 * Zasada bezpieczeństwa: словnik zawiera WYŁĄCZNIE nazwiska jednoznaczne.
 * Nazwiska-homonimy rzeczowników pospolitych (Baran, Wilk, Lis, Mazur, Sowa, Mucha,
 * Kot, Król, Duda, Mróz, Piątek, Kwiecień…) są ŚWIADOMIE pominięte — samodzielne
 * „Wilk biegał po lesie" nie może być maskowane. Te nazwiska i tak są chronione
 * w kontekście (para z imieniem — krok 13a, wyzwalacz „Pan/Pani" — krok 13b),
 * a pełne pokrycie daje opcjonalna warstwa NER. Świadomy kompromis precyzja>recall.
 *
 * Fleksja: odmiana przymiotnikowa (-ski/-cki/-dzki: Kowalskiego→kowalski,
 * Wiśniewskiej→wiśniewski, Kowalscy→kowalski) oraz rzeczownikowa przez odcięcie
 * końcówki (Nowaka→nowak, Wójcikowi→wójcik) z ruchomym „e" (Dudka→dudek — tu akurat
 * homonim, ale mechanizm działa dla Kurka→kurek itd.).
 */

/** Nazwiska jednoznaczne — lowercase, mianownik (forma męska dla -ski/-cki/-dzki). */
const SURNAMES = new Set<string>((
  'nowak kowalski wiśniewski wójcik kowalczyk kamiński lewandowski zieliński szymański ' +
  'woźniak dąbrowski kozłowski jankowski wojciechowski kwiatkowski krawczyk kaczmarek ' +
  'piotrowski grabowski pawłowski michalski nowakowski wieczorek jabłoński adamczyk ' +
  'majewski nowicki olszewski stępień jaworski malinowski pawlak górski witkowski walczak ' +
  'rutkowski michalak szewczyk ostrowski tomaszewski pietrzak zalewski wróblewski ' +
  'marciniak jasiński zawadzki sadowski chmielewski włodarczyk borkowski sokołowski ' +
  'czarnecki sawicki kucharski maciejewski szczepański kubiak kalinowski wysocki adamski ' +
  'kaźmierczak wasilewski sobczak czerwiński andrzejewski cieślak głowacki zakrzewski ' +
  'kołodziej sikorski krajewski gajewski szymczak szulc baranowski laskowski brzeziński ' +
  'makowski ziółkowski przybylski domański nowacki borowski błaszczyk chojnacki ' +
  'ciesielski kaczmarczyk urbański sobolewski olejniczak tomczak stasiak kołodziejczyk ' +
  'olejnik czajkowski stankiewicz wilczyński orłowski konieczny urbaniak markowski ' +
  'michalczyk lipiński romanowski matuszewski kubicki wierzbicki sowiński więcek ' +
  'wesołowski jastrzębski leszczyński chrzanowski mikołajczyk osiński bednarek bednarczyk ' +
  'bednarski kozak popławski janik żukowski wojtas gawlik bielecki śliwiński śliwa ' +
  'kowalewski jakubowski wawrzyniak lisowski janicki janiszewski klimczak klimek kasprzak ' +
  'świątek szymkowiak sienkiewicz łuczak dobrowolski mazurkiewicz kowalik sołtysiak ' +
  'bukowski konopka korzeniowski kosiński kowalczuk lipka łukasik majchrzak markiewicz ' +
  'masłowski matusiak młynarczyk morawski murawski niedźwiedzki niewiadomski pawelec ' +
  'pawlik piasecki pietrzyk rogowski rudnicki rudziński rybarczyk skowroński smoliński ' +
  'stachowiak stachura stefański stolarczyk strzelecki szafrański szostak szydłowski ' +
  'tarnowski trojanowski twardowski urban winiarski wojtczak wojtkowiak wolski woś ' +
  'żebrowski żurawski cichocki głogowski świderski stec ' +
  'krzemiński krzyżanowski kurowski lewicki mielczarek niemczyk pilarski ' +
  'raczyński radecki rogalski rosiński różycki sieradzki wachowiak ' +
  // ── Rozszerzenie: ~900 najczęstszych nazwisk z rejestru PESEL (dane.gov.pl 2023, osoby żyjące,
  //    licencja CC0), BEZ sufiksu -ski/-cki/-icz/-czyk (te i tak łapie morfologia looksLikeSurname).
  //    Odsiane homonimy wyrazów pospolitych: filtr listy częstości korpusu + wieloagentowa
  //    klasyfikacja nazwisko/wyraz (precyzja > recall — „górka/zięba/żurek/bednarz" świadomie
  //    pominięte, łapie je warstwa kontekstowa). Zawiera częste nazwiska obce (ukraińskie,
  //    niemieckie, wietnamskie) — realne w dzisiejszej Polsce. Recall single-HTML bez AI.
  'adach adamczak adamczuk adamek adamiak adamiec adamus ambroziak andrzejak andrzejczak antczak antkowiak antoniak antoniuk antosik augustyniak badura bajorek bakuła balcer balcerek balcerzak banach banasiak banasik banaszak banaszek banaś baraniak barczak barnaś bartczak bartkowiak bartos bartosiak bartosik bartoszek bartyzel basiak batko bator bazan bałdyga bereza bernaś białowąs białoń biedroń bielec bienias bieniek biernat bień bieńko biniek bizoń blicharz bloch bodnar bodziony bogusz boichuk boiko bojko bondar bondarenko bonk borowiak boroń boruta brodziak brożek brożyna bryl bryś brzostek buczak budnik budny bukała błach błachut błasiak błaszak błaszczak błoch cabaj caban cedro ceglarek chmielowiec choma chornyi chowaniec chołuj chrapek chyła cichosz cichoń cierniak cieślar cieślik ciok ciosek cisek ciszek curyło cwalina cwynar cyran czachor czaja czarnik czernik czubak danielak daniluk depta deptuła derda dobek dolata domin dominiak dopierała dorosz dołęga drabik dragan drzymała drężek dudziak dudzic dudzik dulęba dura duraj dutka dybała dyrda dziadosz dębiec fabisiak faron ferenc ficek fila filipczak filipiak firlej fiszer florczak florek fojcik foks foltyn formela formella foryś franczak frontczak frydrych frąckowiak frączek frąszczak frątczak fuchs furmanek furtak fąfara gabor gabrysiak gaca gajos galus gancarz gawin gawor gawryś gałuszka giemza gierczak ginter giza godek golik gondek gonera gontarz gozdek gołda gołdyn gościniak grabiec gralak grela grenda greń grobelny grochal gromek grygiel grzegorek grzelak grzesiak grzesik grzeszczak grzeszczuk grześkowiak gręda gubała gucwa gurgul górak górniak góźdź gądek gębala głodek głuch głuszek havryliuk hawryluk hebda hernik hinc hinz hoffmann hofman hoppe hołda humeniuk hyla idziak idzik ignaczak ignasiak ivanov iwaniec iwaniuk jach jadczak jagieła jagiełło jakubczak jakubek jakubiak jakubiec jakubik jamrozik jamróz janas janczak janeczek janeczko jania janiak janiec jankowiak janota janus jaromin jaros jaroszek jaroń jasek jasiak jasik jaskuła jaszczak jaszczuk jaworek jałocha jańczak jaśkowiak jopek juraszek jurczak jurga juszczak józefiak jóźwiak jóźwik jędrasik jędrzejak jędrzejczak kachel kacprzak kacprzyk kaczmarzyk kaim kalata kalemba kalita karbowiak karbownik kardas kardasz karolak karolczak karpiuk karwat kasperek kasprzyk kazimierczak kałużny kempa kharchenko kielar kiełtyka kijak klich klim klimas kliś kluba kluz klymenko kmieciak kmita knap knapik knop kobiela kobus kobylarz koch kochan kocjan kocot kocoń kolenda kondraciuk kondrat kondratiuk konefał konieczka konior konkel konkol konopko kopera korcz korczak kordek korol korus kosek kosiba kosik kosior kosiorek kosmala kostiuk kotarba kotas kotula koval kovalchuk kovalenko kovalov kowol kozub kozyra kołodziejczak kończak kościelniak kośmider koźlik krasoń kraus krause krauze kravchenko kravchuk kravets krawczak krawczuk kreft kryczka krygier krysa krysiak krystek krysztofiak krzysztofik krzysztoń krzyżaniak królak krężel kubala kubas kubat kubera kubica kubis kubiś kuczek kuczera kujawa kulawik kuleta kuliś kulpa kulyk kumor kupczak kupis kuras kuraś kurdziel kuriata kurzeja kushnir kusiak kustra kusz kuzmenko kułaga kuśmierek kuśmierz kuźma kuźniar kuźnik kwapisz kwaśniak kwaśnik kwiek kwolek kądziela kądziołka kędra kędzia kłusek kłys labuda langer langner lasota latos lehmann leja lenart lesiak levchenko lewczuk leśniak libera ligęza lorek lorenc ludwiczak lysenko machnik machura maciak maciaszek maciejak maciołek maciąg madej madeja magdziak magdziarz magiera majda majer majkut maksymiuk malek malesa marchenko marchuk marcisz marczak marczuk marszał martyniak martyniuk maruszak marut mastalerz masternak matczak mateja matejko matras matusik matuszak matuszczak matuszek matuła matyja matys matysek matysiak matysik mazurczak maćkowiak małek małolepszy małysz meller melnychuk melnyk mentel michalczuk michalec michalik michna michno michoń michta mielcarek mielniczuk mielnik migas mikos mikołajczak mikołajczuk mikrut mikuła milczarek miotk mirga misiura miszczak miszczuk misztal mitura mizera molenda momot morawiec moroz mroczka mrowiec mrozek mrozik mrożek mrzygłód muras musialik musielak musioł nadolny najda nakonieczny nalepa napora narloch nawara nawrat nazaruk nejman neumann nguyen nocoń nogaj nosal nowik nowosad nycz nykiel obara ochman ociepa ogorzałek olczak olech oleksiak oleksiuk oleksy oleszczuk oliinyk olszak orzoł osiak osuch owczarzak ozga ozimek ołdak ożga pabian pacek paduch pajor panasiuk papis parys parzych pasik pastuszak paszek paszko paterek pavlenko pavliuk pawluczuk pawluk pawlus pałys paździor pelc pelczar petrenko petrov pełka piech piecha piechaczek piechnik piechowiak piekut piela pietras pietrasik pietraszek pietraszko pietrucha pietryka pikul pikuła piontek pisarek pisula piszczek piękoś piłat plata plichta podolak podsiadło podsiadły polishchuk polit poloczek polok ponomarenko popek popiel popov potrykus poźniak prokop prokopiuk przybylak przybyłek puchała puzio pyrek pytka pytlak pytlik pyzik pękala rachwał radoń radwan radzik rakoczy rapacz ratajczak rejman richert rojek romanek romaniuk romańczuk rosiak rosiek rosik roszak rozmus rudenko rudnik rusinek rychlik rychter ryczek ryszka rzeszutek rząsa rębisz sajdak salamon samek samsel sasin savchenko savchuk sawa sawczuk sałek schulz sekuła semeniuk sereda shevchenko shevchuk shvets sidor siek sieńko siuda siuta siwiec siwik skoczeń skoczylas skoneczny skonieczny skrzyniarz skrzypczak skupień skuza smolak smolarek smoleń sobala sobiech sobieraj sobik sobkowiak soboń solarz soroka sołtysik spyra stachera stachyra stadnik stanek staniak staniek stanisz staroń starzyk stasik stasiuk staszak stawarz stańczak stańczuk stańko stefaniak stefaniuk stencel stenka stepaniuk steć stolarek struzik stróżyk styś stępniak suder sudoł sulej suliga sulima surmacz suszek sułek sydorenko syrek szafraniec szarek szczepanek szczepaniak szczepanik szcześniak szczypka szczęch szczęśniak szeliga szewczak szewczuk szkudlarek szmidt szmigiel szmit szmyd szmyt sznajder szostek szreder szubert szulik szustak szwarc szydlik szymanek szymaniak szymoniak szymura szyszko talaga tarasiuk targosz tkach tkachenko tkachuk tkocz tomala tomasiak tomasik tomczuk treder trela tworek tyszka urbanek urbanik vasylenko volkov voloshyn wach wadas wajda wajs walas walasek walaszek walczuk waliczek walkowiak wanat wasiak wasiluk waszak waszczuk wawer wawro waśko wcisło wdowiak wegner wencel wenta widera wielgosz wielgus wieliczko wiercioch wilkosz winkler wiszowaty witczak wiącek więch więcław wnęk woch wojas wojcieszak wojda wojdyła wojnar wojtal wojtala wojtasik wojtaszek wojtaś wojtysiak wojtyła wolak wolanin wołoszyn wołowiec woźniczka wrzosek wszołek wypych wójciak włodarczak zadrożny zajdel zapart zaremba zarychta zawadka zawisza zawiślak zdeb zdunek zelek zhuk ziaja ziemba zimoch ziobro zięcina ziętara ziętek zych łabuz łada ławniczak łojek łukasiak łukaszuk łuszcz ślęzak śmigiel świercz świąder święch świętek żygadło'
).split(/\s+/).filter(Boolean));

/**
 * Homonimy rzeczowników pospolitych / dni / miesięcy — NIE maskujemy samodzielnie.
 * Trzymane osobno: dokumentacja kompromisu + punkt zaczepienia dla przyszłej reguły
 * kontekstowej (np. „sędzia Wilk" → maska).
 */
export const HOMOGRAPH_SURNAMES = new Set<string>((
  'mazur mazurek zając baran wilk lis kot kruk sowa mucha wrona sroka czajka gołąb dudek ' +
  'wróbel sikora kania szczygieł skowronek orzeł kaczor piątek sobota niedziela środa ' +
  'kwiecień maj marzec styczeń grudzień lipiec sierpień król kowal rybak krawiec cieśla ' +
  'sołtys turek czech niemiec prus cygan góral polak socha skiba krupa paluch noga żyła ' +
  'duda bąk mróz rak ptak drozd okoń szpak pająk motyl żuk chmiel kalina jagoda gruszka ' +
  'żak kurek sitek gajda jarosz marek bober przybysz dziedzic mroczek starosta'
).split(/\s+/));

// Odmiana przymiotnikowa nazwisk na -ski/-cki/-dzki (też żeńska i mnoga).
const ADJ_RULES: Array<[RegExp, string]> = [
  [/(sk|ck|dzk)iego$/, '$1i'],
  [/(sk|ck|dzk)iemu$/, '$1i'],
  [/(sk|ck|dzk)imi$/, '$1i'],
  [/(sk|ck|dzk)ich$/, '$1i'],
  [/(sk|ck|dzk)im$/, '$1i'],
  [/(sk|ck|dzk)iej$/, '$1i'],
  [/(sk|ck|dzk)ą$/, '$1i'],
  [/(sk|ck|dzk)a$/, '$1i'],
  [/ccy$/, 'cki'],
  [/dzcy$/, 'dzki'],
  [/scy$/, 'ski'],
];

// Końcówki rzeczownikowe (od najdłuższej): Nowakowi, Nowakiem, Nowakowie, Nowaka…
const NOUN_ENDINGS = ['owie', 'ował', 'owi', 'iem', 'ami', 'ach', 'em', 'om', 'ów', 'u', 'a', 'ą', 'ę', 'y', 'o', 'e'];

const NO_E = /([^aeiouąęóy])([^aeiouąęóy])$/; // ruchome „e”: kurk→kurek, wróbl→wróbel

function lookup(candidate: string): string | null {
  if (SURNAMES.has(candidate)) return candidate;
  return null;
}

/**
 * Deterministyczny klucz tożsamości dla pseudonimizacji: forma bazowa ze słownika,
 * a dla nazwisk spoza słownika — normalizacja czysto morfologiczna (reguły przymiotnikowe,
 * potem odcięcie typowej końcówki). Nie musi być poprawna językowo — musi być STABILNA
 * (te same formy tej samej osoby → ten sam klucz). Alternacje tematu (Stępień/Stępnia)
 * mogą dać różne klucze — udokumentowane ograniczenie.
 */
export function normalizeSurnameKey(word: string): string {
  const w = word.toLowerCase();
  const base = surnameBase(w);
  if (base) return base;
  for (const [re, rep] of ADJ_RULES) {
    if (re.test(w)) return w.replace(re, rep);
  }
  for (const end of NOUN_ENDINGS) {
    if (w.length - end.length >= 4 && w.endsWith(end)) return w.slice(0, -end.length);
  }
  return w;
}

/**
 * Zwraca formę bazową nazwiska ze słownika (lowercase) albo null.
 * `word` — pojedynczy token (bez spacji), wielkość liter dowolna.
 */
export function surnameBase(word: string): string | null {
  const w = word.toLowerCase();
  if (w.length < 3) return null;

  const direct = lookup(w);
  if (direct) return direct;

  for (const [re, rep] of ADJ_RULES) {
    if (re.test(w)) {
      const base = lookup(w.replace(re, rep));
      if (base) return base;
    }
  }

  for (const end of NOUN_ENDINGS) {
    if (w.length - end.length >= 3 && w.endsWith(end)) {
      const stem = w.slice(0, -end.length);
      const base = lookup(stem) ?? lookup(stem.replace(NO_E, '$1e$2'));
      if (base) return base;
    }
  }

  return null;
}

// ============================================================================
// Morfologiczny rozpoznawacz nazwisk (poza słownikiem) — recall dla rzadkich nazwisk
// ============================================================================

/**
 * Charakterystyczne polskie sufiksy nazwiskowe (mianownik + częste formy odmienione):
 *  - przymiotnikowe -ski/-cki/-dzki (rodz. żeński -ska, mnogie -scy, przypadki zależne),
 *  - patronimiczne -icz/-wicz/-owicz/-ewicz (+ odmiana),
 *  - -czyk (+ odmiana).
 * To sygnał o wysokiej precyzji: takich końcówek prawie nie mają wyrazy pospolite (poza
 * przymiotnikami geo/narodowymi — te odsiewa NON_SURNAME_ADJ + kontekst w index.ts).
 */
const SURNAME_SUFFIX =
  /(?:sk|ck|dzk)(?:i|a|iego|iej|iemu|im|imi|ich|ą)$|(?:scy|ccy|dzcy)$|icz(?:a|owi|em|owie|ami|ach)?$|czyk(?:a|owi|iem|ami|ach|owie)?$/;

/**
 * Wyrazy z wielkiej litery o końcówce „nazwiskowej", które nazwiskami NIE są:
 * przymiotniki narodowe, regionalne i miejskie (formy bazowe -ski/-cki/-dzki — odmienione
 * warianty sprowadzamy do bazy regułami ADJ_RULES przed sprawdzeniem). Bez tego rozpoznawacz
 * pożerałby „Polski", „Śląski", „Warszawski", „Mazowiecki" w nazwach własnych.
 * UWAGA: nie wpisujemy tu nazwisk-przymiotników (np. „Górski") — te mają zostać maskowane.
 */
export const NON_SURNAME_ADJ = new Set<string>((
  // narodowe / etniczne
  'polski niemiecki francuski rosyjski angielski brytyjski amerykański włoski hiszpański ' +
  'portugalski czeski słowacki ukraiński białoruski litewski łotewski estoński fiński ' +
  'węgierski rumuński bułgarski serbski chorwacki grecki turecki chiński japoński koreański ' +
  'indyjski arabski izraelski żydowski romski cygański europejski azjatycki afrykański ' +
  'skandynawski bałtycki słowiański unijny radziecki sowiecki ' +
  // regiony / województwa
  'mazowiecki małopolski wielkopolski śląski dolnośląski górnośląski pomorski zachodniopomorski ' +
  'kujawski podlaski lubelski lubuski łódzki opolski podkarpacki świętokrzyski warmiński ' +
  'mazurski kaszubski beskidzki tatrzański ' +
  // miejskie
  'warszawski krakowski gdański poznański wrocławski szczeciński bydgoski katowicki radomski ' +
  'toruński kielecki rzeszowski olsztyński gliwicki tarnowski płocki częstochowski gdyński ' +
  // ogólne / instytucjonalne / relacyjne przymiotniki na -ski/-cki/-dzki
  'miejski wiejski wojewódzki morski nadmorski królewski cesarski papieski biskupi diecezjalny ' +
  'boski niebiański ziemski świecki damski męski żeński ludzki dziecięcy ojcowski macierzyński ' +
  'lekarski adwokacki nauczycielski rybacki rycerski sąsiedzki ' +
  // relacyjne (nazwy komitetów/związków/funduszy): „Komitet Obywatelski", „Hufiec Harcerski"
  'obywatelski harcerski sołecki chłopski pański szlachecki żołnierski marynarski kupiecki ' +
  'związkowski ' +
  // ogólnokrajowe / uczelniane (nazwy instytucji): „Ogólnopolski Związek", „Uniwersytet Jagielloński"
  'ogólnopolski wszechpolski ogólnokrajowy jagielloński akademicki uniwersytecki ' +
  'studencki pracowniczy związkowy ' +
  // dalsze regiony / pasma / parki: „Bieszczadzki Park", „Podhalański", „Sądecki"
  'podhalański bieszczadzki karkonoski sądecki gorczański elbląski nadwiślański nadbużański ' +
  'kołobrzeski koszaliński słupski legnicki wałbrzyski jeleniogórski nowosądecki ' +
  // pospolite przymiotniki na -ski/-cki: „Niski poziom", „wąski", „bliski"
  'niski wąski płaski bliski śliski grząski ' +
  // wieloznaczny wyraz o końcówce nazwiskowej, który nazwiskiem nie jest (Znicz Pruszków itp.)
  'znicz'
).split(/\s+/).filter(Boolean));

/**
 * Czy wyraz WYGLĄDA na polskie nazwisko po samej morfologii (bez słownika)?
 * Precyzja: końcówka nazwiskowa + odsianie przymiotników geo/narodowych + min. długość.
 * Kontekst (poprzedzający wyraz, pozycja) rozstrzyga index.ts — tu tylko warstwa leksykalna.
 */
export function looksLikeSurname(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 5) return false;
  if (!SURNAME_SUFFIX.test(w)) return false;
  if (NON_SURNAME_ADJ.has(w)) return false;
  // sprowadź odmieniony przymiotnik do bazy -ski i sprawdź stoplistę raz jeszcze
  for (const [re, rep] of ADJ_RULES) {
    if (re.test(w)) return !NON_SURNAME_ADJ.has(w.replace(re, rep));
  }
  return true;
}

/**
 * Czy wyraz to przymiotnik geograficzny/narodowy/instytucjonalny (Polski, Warszawski,
 * Mazowiecki, Warmińskiego, Jagiellońskiej…), a więc NIE nazwisko? Sprowadza odmianę
 * przymiotnikową do bazy -ski/-cki/-dzki (reguły ADJ_RULES) i sprawdza stoplistę
 * NON_SURNAME_ADJ. Filtr precyzji dla kandydatów z warstwy NER (patrz ner-postprocess.ts).
 * UWAGA: nazwiska-przymiotniki (np. „Górski") NIE są w NON_SURNAME_ADJ → zwraca false.
 */
export function isGeoAdjective(word: string): boolean {
  const w = word.toLowerCase();
  if (NON_SURNAME_ADJ.has(w)) return true;
  for (const [re, rep] of ADJ_RULES) {
    if (re.test(w) && NON_SURNAME_ADJ.has(w.replace(re, rep))) return true;
  }
  return false;
}
