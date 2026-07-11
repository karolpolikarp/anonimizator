import { redactPII, type PiiFinding, type PiiType } from 'anonimizator';
import { mergeFindings, nerHealthCheck, nerRedact } from 'anonimizator/ner';
import { extractDocxText } from './docx';
import { extractPdfText } from './pdf';
import { browserNerAvailable, browserNerRedact } from './ner-browser';
import './style.css';

// Ikony — inline SVG (jedno źródło prawdy, kolor z currentColor). Zero rastrów.
import { icon, hydrateIcons } from './icons';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLDivElement>('output');
const findingsCard = $<HTMLElement>('findings');
const findingsChips = $<HTMLSpanElement>('findings-chips');
const findingsStatus = $<HTMLSpanElement>('findings-status');
const statCount = $<HTMLElement>('stat-count');
const statCats = $<HTMLElement>('stat-cats');
const srcMeta = $<HTMLSpanElement>('src-meta');
const copyBtn = $<HTMLButtonElement>('copy');
const copyLabel = $<HTMLSpanElement>('copy-label');
const downloadBtn = $<HTMLButtonElement>('download');
const clearBtn = $<HTMLButtonElement>('clear');
const exampleBtn = $<HTMLButtonElement>('example');
const loadFileBtn = $<HTMLButtonElement>('load-file');
const loadFileLabel = $<HTMLSpanElement>('load-file-label');
const fileInput = $<HTMLInputElement>('file-input');
const nerEnabledBox = $<HTMLInputElement>('ner-enabled');
const nerDetails = $<HTMLDivElement>('ner-details');
const nerSourceSel = $<HTMLSelectElement>('ner-source');
const nerUrlInput = $<HTMLInputElement>('ner-url');
const nerStatus = $<HTMLSpanElement>('ner-status');
const nerPill = $<HTMLSpanElement>('ner-pill');
const viewResultBtn = $<HTMLButtonElement>('view-result');
const viewCompareBtn = $<HTMLButtonElement>('view-compare');
const appError = $<HTMLParagraphElement>('app-error');
const maskNav = $<HTMLSpanElement>('mask-nav');
const maskPrev = $<HTMLButtonElement>('mask-prev');
const maskNext = $<HTMLButtonElement>('mask-next');
const maskCount = $<HTMLSpanElement>('mask-count');
const maskStatus = $<HTMLSpanElement>('mask-status');

let lastRedacted = '';
let lastInput = '';
let viewMode: 'result' | 'compare' = 'result';
let maskEls: HTMLElement[] = []; // znaczniki w wyniku, w kolejności dokumentu
let maskIdx = -1; // bieżący znacznik w przeglądaniu (-1 = żaden)

// Edycja „urzędnik" (release dla głównej grupy docelowej): build BEZ warstwy AI/NER.
// Kod NER zostaje w repozytorium — tu tylko usuwamy elementy oznaczone [data-full] z DOM,
// żeby interfejs był maksymalnie prosty. Flagę podstawia Vite przy buildzie (VITE_EDITION).
const CLERK_EDITION = import.meta.env.VITE_EDITION === 'urzednik';
if (CLERK_EDITION) {
  for (const el of document.querySelectorAll('[data-full]')) el.remove();
  // Edycja urzędnik nie ma warstwy AI — usuwamy wzmianki o niej z nagłówka (uczciwość).
  const sub = document.getElementById('hero-sub');
  if (sub) sub.textContent = 'Lokalny anonimizator polskich danych osobowych';
  const badge = document.getElementById('badge-ai-txt');
  if (badge) badge.textContent = 'Reguły + sumy kontrolne';
  const step2 = document.getElementById('step2-sub');
  if (step2) step2.textContent = 'reguły, słowniki i sumy kontrolne';
}

/* ── Kategorie i metadane typów PII (jedna rodzina kolorów w całej aplikacji) ── */

type Cat = 'person' | 'contact' | 'ident' | 'fin' | 'place';

/** Kategoria wizualna znacznika po nazwie tokenu (spójna z legendą i tabelą). */
function maskCategory(name: string): Cat {
  if (name.startsWith('OSOBA-') || name === 'IMIĘ I NAZWISKO') return 'person';
  if (name === 'EMAIL' || name === 'TELEFON') return 'contact';
  if (name === 'NR-KONTA') return 'fin';
  if (name === 'ADRES' || name === 'KOD-POCZTOWY' || name === 'DATA-URODZENIA' || name === 'MIEJSCOWOŚĆ') return 'place';
  return 'ident'; // PESEL / NIP / REGON / NR-DOWODU
}

/** Tooltipy znaczników w wyniku: kategoria · metoda wykrycia. */
const MASK_TIP: Record<string, string> = {
  PESEL: 'Identyfikatory · 11 cyfr, suma kontrolna poprawna',
  NIP: 'Identyfikatory · 10 cyfr, suma kontrolna poprawna',
  REGON: 'Identyfikatory · suma kontrolna poprawna',
  'NR-DOWODU': 'Identyfikatory · 3 litery + 6 cyfr, suma kontrolna poprawna',
  'NR-PASZPORTU': 'Identyfikatory · kontekst „paszport" + 2 litery + 7 cyfr',
  KRS: 'Identyfikatory · kontekst „KRS" + 10 cyfr',
  'ZNAK-SPRAWY': 'Identyfikatory · znak sprawy/pisma (JRWA) lub sygnatura akt',
  'PRAWO-JAZDY': 'Identyfikatory · kontekst „prawo jazdy" + numer z cyfrą',
  'NR-REJESTRACYJNY': 'Identyfikatory · kontekst „rejestracyjny/tablica" + tablica',
  VIN: 'Identyfikatory · 17 znaków bez I/O/Q; kontekst „VIN" lub układ VIN',
  IP: 'Identyfikatory · adres IPv4 (oktety 0–255) lub IPv6',
  MAC: 'Identyfikatory · 6 par hex (00:1A:2B:3C:4D:5E)',
  TOKEN: 'Identyfikatory · token/JWT (eyJ…) — może dawać dostęp',
  'NR-KONTA': 'Finanse · IBAN (mod 97) lub kontekst „konto/rachunek”',
  EMAIL: 'Kontakt · wzorzec adresu e-mail',
  TELEFON: 'Kontakt · 9 cyfr, opcjonalnie +48',
  ADRES: 'Adres i czas · wzorzec ul./al./os./pl. + nazwa + numer',
  'KOD-POCZTOWY': 'Adres i czas · wzorzec XX-XXX',
  'MIEJSCOWOŚĆ': 'Adres i czas · miejscowość po kodzie pocztowym',
  'DATA-URODZENIA': 'Adres i czas · data z kontekstem „ur./urodzony”',
  'IMIĘ I NAZWISKO': 'Osoby · słownik imion/nazwisk lub wyzwalacz kontekstu; opcjonalnie NER',
};

function maskTip(name: string): string {
  if (name.startsWith('OSOBA-')) return `Osoby · spójna etykieta tej samej osoby (${name})`;
  return MASK_TIP[name] ?? 'Wykryta dana osobowa';
}

/* ── Przełączniki „Co maskować" (generowane, z ikonami i kodami znaczników) ── */

interface MaskGroup {
  key: string;
  label: string;
  types: PiiType[];
  cat: Cat;
  icon: string;
  code: string;
  tip: string;
  full?: boolean;
}

const MASK_GROUPS: MaskGroup[] = [
  { key: 'pesel', label: 'PESEL', types: ['PESEL'], cat: 'ident', icon: 'pesel', code: '[PESEL]', tip: '11 cyfr + walidacja sumy kontrolnej' },
  { key: 'nip', label: 'NIP', types: ['NIP'], cat: 'ident', icon: 'nip', code: '[NIP]', tip: '10 cyfr (także z myślnikami) + suma kontrolna' },
  { key: 'regon', label: 'REGON', types: ['REGON'], cat: 'ident', icon: 'dane-id', code: '[REGON]', tip: '9 lub 14 cyfr + suma kontrolna' },
  { key: 'dowod', label: 'Nr dowodu osobistego', types: ['DOWOD'], cat: 'ident', icon: 'numer-dok', code: '[NR-DOWODU]', tip: '3 litery + 6 cyfr + suma kontrolna' },
  { key: 'paszport', label: 'Nr paszportu', types: ['PASZPORT'], cat: 'ident', icon: 'numer-dok', code: '[NR-PASZPORTU]', tip: 'Kontekst „paszport" + 2 litery + 7 cyfr' },
  { key: 'krs', label: 'Numer KRS', types: ['KRS'], cat: 'ident', icon: 'dane-id', code: '[KRS]', tip: 'Kontekst „KRS" + 10 cyfr' },
  { key: 'znak', label: 'Znak sprawy / pisma', types: ['ZNAK-SPRAWY'], cat: 'ident', icon: 'numer-dok', code: '[ZNAK-SPRAWY]', tip: 'Znak sprawy/pisma wg JRWA (ABC-def.123.77.2016) lub sygnatura akt („Sygn. akt II CSK 234/19")' },
  { key: 'prawojazdy', label: 'Nr prawa jazdy', types: ['PRAWO-JAZDY'], cat: 'ident', icon: 'numer-dok', code: '[PRAWO-JAZDY]', tip: 'Kontekst „prawo jazdy" + numer (z cyfrą)' },
  { key: 'rejestracja', label: 'Nr rejestracyjny', types: ['NR-REJESTRACYJNY'], cat: 'ident', icon: 'numer-dok', code: '[NR-REJESTRACYJNY]', tip: 'Kontekst „rejestracyjny/tablica" + tablica (WI1234K)' },
  { key: 'vin', label: 'VIN', types: ['VIN'], cat: 'ident', icon: 'dane-id', code: '[VIN]', tip: '17 znaków bez I/O/Q; kontekst „VIN/nadwozia" lub wyraźny układ VIN' },
  { key: 'ip', label: 'Adres IP', types: ['IP'], cat: 'ident', icon: 'dane-id', code: '[IP]', tip: 'IPv4 (oktety 0–255) oraz IPv6' },
  { key: 'mac', label: 'Adres MAC', types: ['MAC'], cat: 'ident', icon: 'dane-id', code: '[MAC]', tip: '6 par hex (00:1A:2B:3C:4D:5E)' },
  { key: 'token', label: 'Token / JWT', types: ['TOKEN'], cat: 'ident', icon: 'login', code: '[TOKEN]', tip: 'Token JWT (eyJ…) — może dawać dostęp' },
  { key: 'konto', label: 'IBAN / nr konta', types: ['IBAN', 'NR-KONTA'], cat: 'fin', icon: 'iban', code: '[NR-KONTA]', tip: 'Walidacja mod 97 lub kontekst „konto/rachunek”' },
  { key: 'email', label: 'E-mail', types: ['EMAIL'], cat: 'contact', icon: 'login', code: '[EMAIL]', tip: 'Wzorzec adresu e-mail' },
  { key: 'telefon', label: 'Telefon', types: ['TELEFON'], cat: 'contact', icon: 'telefon', code: '[TELEFON]', tip: '9 cyfr, opcjonalnie prefiks +48' },
  { key: 'adres', label: 'Adres', types: ['ADRES'], cat: 'place', icon: 'dom', code: '[ADRES]', tip: 'ul./al./os./pl. + nazwa + numer' },
  { key: 'kod', label: 'Kod pocztowy', types: ['KOD-POCZTOWY'], cat: 'place', icon: 'mapa-pl', code: '[KOD-POCZTOWY]', tip: 'Wzorzec XX-XXX' },
  { key: 'miejscowosc', label: 'Miejscowość', types: ['MIEJSCOWOSC'], cat: 'place', icon: 'mapa-pl', code: '[MIEJSCOWOŚĆ]', tip: 'Miejscowość po kodzie pocztowym (w adresie)' },
  { key: 'dataur', label: 'Data urodzenia', types: ['DATA-UR'], cat: 'place', icon: 'kalendarz', code: '[DATA-URODZENIA]', tip: 'Data z kontekstem „ur./urodzony”' },
  { key: 'imie', label: 'Imię i nazwisko', types: ['IMIE'], cat: 'person', icon: 'dane-osobowe', code: '[IMIĘ I NAZWISKO]', tip: 'Słownik ~200 imion i ~230 nazwisk z odmianą + morfologia i wyzwalacze kontekstu; wykrywanie heurystyczne, odznaczenie wyłącza też NER' },
];

// W edycji „urzędnik" nie ma NER — usuwamy wzmianki z etykiet/tooltipów tej warstwy.
if (CLERK_EDITION) {
  const imie = MASK_GROUPS.find((g) => g.key === 'imie');
  if (imie) {
    imie.tip = 'Słownik ~200 imion i ~230 nazwisk z odmianą + morfologia i wyzwalacze kontekstu; wykrywanie heurystyczne';
  }
  MASK_TIP['IMIĘ I NAZWISKO'] = 'Osoby · słownik imion/nazwisk lub wyzwalacz kontekstu';
}

const maskTogglesEl = $<HTMLSpanElement>('mask-toggles');
const disabledGroups = new Set<string>(
  (localStorage.getItem('mask-disabled') ?? '').split(',').filter(Boolean),
);

/** Buduje jeden przełącznik typu PII. */
function buildToggle(g: MaskGroup): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = `tg${g.full ? ' tg-full' : ''}`;
  label.dataset.tip = g.tip;

  const ic = document.createElement('span');
  ic.className = `ic ic-s c-${g.cat}`;
  const gi = document.createElement('i');
  gi.className = 'gi';
  gi.innerHTML = icon(g.icon);
  ic.append(gi);

  const t = document.createElement('span');
  t.className = 'tg-t';
  const b = document.createElement('b');
  b.textContent = g.label;
  const code = document.createElement('code');
  code.textContent = g.code;
  t.append(b, code);

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'sw';
  box.checked = !disabledGroups.has(g.key);
  box.setAttribute('aria-label', `Maskuj: ${g.label}`);
  box.addEventListener('change', () => {
    if (box.checked) disabledGroups.delete(g.key);
    else disabledGroups.add(g.key);
    localStorage.setItem('mask-disabled', [...disabledGroups].join(','));
    update();
  });

  label.append(ic, t, box);
  return label;
}

// Grupowanie po KATEGORIACH (jak w legendzie) — porządek zamiast płaskiej, poszarpanej siatki.
const CAT_LABELS: Record<Cat, string> = {
  ident: 'Identyfikatory',
  contact: 'Kontakt',
  fin: 'Finanse',
  place: 'Adres i czas',
  person: 'Dane osobowe',
};
const CAT_ORDER: Cat[] = ['ident', 'contact', 'fin', 'place', 'person'];

function buildCatSection(cat: Cat, groups: MaskGroup[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'tg-cat';
  const h = document.createElement('div');
  h.className = 'tg-cat-h';
  const dot = document.createElement('span');
  dot.className = `dot dot-${cat}`;
  const hl = document.createElement('span');
  hl.textContent = CAT_LABELS[cat];
  h.append(dot, hl);
  const body = document.createElement('div');
  body.className = 'tg-cat-body';
  for (const g of groups) body.append(buildToggle(g));
  section.append(h, body);
  return section;
}

// „Identyfikatory" (najliczniejsza grupa) dostają pełną szerokość — same wypełniają rzędy.
// Pozostałe, małe kategorie (Kontakt/Finanse/Adres/Osoby) pakujemy w jeden wspólny pas obok
// siebie, zamiast czterech osobnych, w większości pustych rzędów — lepsze wykorzystanie miejsca.
const restRow = document.createElement('div');
restRow.className = 'tg-cat-row';
for (const cat of CAT_ORDER) {
  const groups = MASK_GROUPS.filter((g) => g.cat === cat);
  if (!groups.length) continue;
  const section = buildCatSection(cat, groups);
  if (cat === 'ident') maskTogglesEl.append(section);
  else restRow.append(section);
}
if (restRow.childElementCount) maskTogglesEl.append(restRow);

/** Typy aktywne wg przełączników; undefined = wszystkie. */
function activeTypes(): PiiType[] | undefined {
  if (disabledGroups.size === 0) return undefined;
  return MASK_GROUPS.filter((g) => !disabledGroups.has(g.key)).flatMap((g) => g.types);
}

function imieEnabled(): boolean {
  return !disabledGroups.has('imie');
}

const pseudonymsBox = $<HTMLInputElement>('pseudonyms');
pseudonymsBox.checked = localStorage.getItem('pseudonyms') === '1';
pseudonymsBox.addEventListener('change', () => {
  localStorage.setItem('pseudonyms', pseudonymsBox.checked ? '1' : '');
  update();
});

/* ── Renderowanie wyniku (numerowane linie, kolorowe znaczniki, tooltips) ── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MASK_TOKEN_RE =
  /\[(PESEL|NIP|REGON|NR-KONTA|NR-DOWODU|NR-PASZPORTU|KRS|ZNAK-SPRAWY|PRAWO-JAZDY|NR-REJESTRACYJNY|VIN|IP|MAC|TOKEN|EMAIL|TELEFON|KOD-POCZTOWY|DATA-URODZENIA|ADRES|MIEJSCOWOŚĆ|IMIĘ I NAZWISKO|OSOBA-[A-Z]+)\]/g;

function maskHtml(name: string): string {
  return `<mark class="pii pii-${maskCategory(name)}" data-tip="${escapeHtml(maskTip(name))}" tabindex="0">[${name}]</mark>`;
}

/** Podświetl znaczniki w zanonimizowanym (zescape'owanym) tekście. */
function highlightMasks(escaped: string): string {
  return escaped.replace(MASK_TOKEN_RE, (_m, name: string) => maskHtml(name));
}

/** Owiń HTML w numerowane linie edytora (.cl / .no). */
function wrapLines(html: string): string {
  return html
    .split('\n')
    .map(
      (line, i) =>
        `<div class="cl"><span class="no">${i + 1}</span><span>${line || '&nbsp;'}</span></div>`,
    )
    .join('');
}

/**
 * Widok „Porównanie": oryginał przekreślony obok kolorowego znacznika (jak recenzja
 * Worda). Diff w O(n): nie-maskowe segmenty wyniku występują w oryginale dosłownie
 * i po kolei — luka między nimi to zamaskowana wartość.
 */
function buildCompareHtml(original: string, redacted: string): string {
  const tokens = redacted.split(MASK_TOKEN_RE);
  let html = '';
  let pos = 0;
  let pending: string[] = [];

  const flush = (gapEnd: number) => {
    if (pending.length) {
      const orig = original.slice(pos, gapEnd);
      if (orig) html += `<del>${escapeHtml(orig)}</del> `;
      for (const name of pending) html += maskHtml(name);
      pending = [];
    }
    pos = gapEnd;
  };

  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 1) {
      pending.push(tokens[i]);
      continue;
    }
    const lit = tokens[i];
    if (!lit) continue;
    const idx = original.indexOf(lit, pos);
    flush(idx === -1 ? pos : idx);
    html += escapeHtml(lit);
    pos += lit.length;
  }
  flush(original.length);
  return html;
}

const HIGHLIGHT_LIMIT = 300_000;

function renderOutput(): void {
  if (!lastRedacted) return;
  output.classList.remove('plain');
  if (lastRedacted.length > HIGHLIGHT_LIMIT) {
    output.classList.add('plain');
    output.textContent = lastRedacted;
  } else {
    const html =
      viewMode === 'compare'
        ? buildCompareHtml(lastInput, lastRedacted)
        : highlightMasks(escapeHtml(lastRedacted));
    output.innerHTML = wrapLines(html);
  }
  refreshMaskNav();
}

function setViewMode(mode: 'result' | 'compare'): void {
  viewMode = mode;
  viewResultBtn.classList.toggle('on', mode === 'result');
  viewCompareBtn.classList.toggle('on', mode === 'compare');
  viewResultBtn.setAttribute('aria-pressed', String(mode === 'result'));
  viewCompareBtn.setAttribute('aria-pressed', String(mode === 'compare'));
  renderOutput();
}

viewResultBtn.addEventListener('click', () => setViewMode('result'));
viewCompareBtn.addEventListener('click', () => setViewMode('compare'));

/* ── Przeglądanie zamaskowanych fragmentów — strzałki, klik, klawiatura ── */

/** Etykieta pseudonimu ([OSOBA-A]) — pozwala podświetlić WSZYSTKIE wystąpienia tej samej osoby. */
function personLabel(el: HTMLElement): string | null {
  return /^\[OSOBA-[A-Z]+\]$/.test(el.textContent ?? '') ? el.textContent : null;
}

function updateMaskCount(): void {
  const n = maskEls.length;
  maskCount.textContent = n ? `${maskIdx + 1} / ${n}` : '0 / 0';
  maskPrev.disabled = n === 0;
  maskNext.disabled = n === 0;
}

function goToMask(i: number, scroll = true): void {
  const n = maskEls.length;
  if (!n) return;
  maskIdx = ((i % n) + n) % n; // zawijanie na końcach
  for (const el of maskEls) el.classList.remove('pii-active', 'pii-linked');
  const el = maskEls[maskIdx];
  el.classList.add('pii-active');
  const label = personLabel(el); // ta sama osoba → podświetl powiązane wystąpienia
  if (label) for (const o of maskEls) if (o !== el && o.textContent === label) o.classList.add('pii-linked');
  if (scroll) {
    const er = el.getBoundingClientRect();
    const or = output.getBoundingClientRect();
    output.scrollTop += er.top - or.top - (output.clientHeight - er.height) / 2;
  }
  // NIE fokusujemy znacznika — inaczej sam „powód" (tooltip) wyskakiwałby przy każdym przejściu.
  // Bieżący znacznik wskazuje pierścień; powód pokazuje się po NAJECHANIU. Czytnik ekranu dostaje
  // zwięzły komunikat przez #mask-status (aria-live).
  maskStatus.textContent = `Fragment ${maskIdx + 1} z ${n}: ${el.textContent}.`;
  updateMaskCount();
}

/** Po każdym renderze wyniku: zbierz znaczniki, wyzeruj przegląd, pokaż/ukryj nawigację. */
function refreshMaskNav(): void {
  maskEls = [...output.querySelectorAll<HTMLElement>('mark.pii')];
  maskIdx = -1;
  maskNav.hidden = maskEls.length === 0;
  updateMaskCount();
}

const goToPrevMask = (): void => goToMask(maskIdx <= 0 ? maskEls.length - 1 : maskIdx - 1);

maskPrev.addEventListener('click', goToPrevMask);
maskNext.addEventListener('click', () => goToMask(maskIdx + 1));

// Klik w znacznik → uczyń go bieżącym (bez przewijania — użytkownik już na niego patrzy).
output.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.('mark.pii') as HTMLElement | null;
  const at = el ? maskEls.indexOf(el) : -1;
  if (at !== -1) goToMask(at, false);
});

// Klawiatura: ↓/→ następny, ↑/← poprzedni — gdy fokus jest w wyniku LUB na strzałkach nawigacji
// (dzięki temu po kliknięciu ‹/› strzałki nadal działają, mimo że nie fokusujemy znacznika).
document.addEventListener('keydown', (e) => {
  if (!maskEls.length || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const ae = document.activeElement;
  if (ae !== output && !output.contains(ae) && !maskNav.contains(ae)) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); goToMask(maskIdx + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); goToPrevMask(); }
});

// Synchroniczne przewijanie źródła i wyniku — przewijasz jedno, drugie podąża (jak w recenzji
// dokumentu). Proporcjonalnie (treści mają różną długość), z blokadą pętli sprzężenia zwrotnego.
let syncingScroll = false;
function linkScroll(from: HTMLElement, to: HTMLElement): void {
  from.addEventListener('scroll', () => {
    if (syncingScroll) return;
    syncingScroll = true;
    const fromMax = from.scrollHeight - from.clientHeight;
    const toMax = to.scrollHeight - to.clientHeight;
    to.scrollTop = fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
    requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });
}
linkScroll(input, output);
linkScroll(output, input);

// Rozszerzanie okien — czytelny, symetryczny uchwyt u dołu KAŻDEGO okna (źródła i wyniku).
// Przeciąganie dowolnego z nich zmienia wspólną wysokość --ed-h, więc oba okna rosną i maleją
// równocześnie i równo. Uchwyt jest widoczny, obsługiwany myszą, dotykiem i klawiaturą (↑/↓),
// a dwuklik przywraca domyślną wysokość. Intuicyjniej niż drobny natywny trójkącik w rogu.
const MIN_ED_H = 220;
const grips: HTMLElement[] = [];

const maxEdH = (): number => Math.max(MIN_ED_H, window.innerHeight - 140);
const clampEdH = (px: number): number => Math.max(MIN_ED_H, Math.min(Math.round(px), maxEdH()));

function applyEditorHeight(px: number): void {
  const h = clampEdH(px);
  document.documentElement.style.setProperty('--ed-h', `${h}px`);
  for (const g of grips) g.setAttribute('aria-valuenow', String(h));
}
function resetEditorHeight(): void {
  document.documentElement.style.removeProperty('--ed-h');
  for (const g of grips) g.setAttribute('aria-valuenow', String(input.offsetHeight));
}

function makeGrip(): HTMLElement {
  const g = document.createElement('div');
  g.className = 'ed-grip';
  g.tabIndex = 0;
  g.setAttribute('role', 'separator');
  g.setAttribute('aria-orientation', 'horizontal');
  g.setAttribute('aria-label', 'Zmień wysokość okien — przeciągnij lub użyj strzałek ↑ ↓');
  g.setAttribute('aria-valuemin', String(MIN_ED_H));
  g.dataset.tip = 'Przeciągnij, aby zmienić wysokość obu okien · strzałki ↑ ↓ · dwuklik = reset';
  g.innerHTML = '<span class="ed-grip-bar"></span>';

  let startY = 0;
  let startH = 0;
  let dragging = false;
  g.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = input.offsetHeight;
    g.setPointerCapture(e.pointerId);
    document.body.classList.add('ed-resizing');
    e.preventDefault();
  });
  g.addEventListener('pointermove', (e) => {
    if (dragging) applyEditorHeight(startH + (e.clientY - startY));
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try {
      g.releasePointerCapture(e.pointerId);
    } catch {
      /* wskaźnik mógł już zniknąć */
    }
    document.body.classList.remove('ed-resizing');
  };
  g.addEventListener('pointerup', endDrag);
  g.addEventListener('pointercancel', endDrag);
  g.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 20;
    if (e.key === 'ArrowUp') {
      applyEditorHeight(input.offsetHeight - step);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      applyEditorHeight(input.offsetHeight + step);
      e.preventDefault();
    }
  });
  g.addEventListener('dblclick', resetEditorHeight);
  return g;
}

const inputGrip = makeGrip();
const outputGrip = makeGrip();
grips.push(inputGrip, outputGrip);
input.parentElement?.append(inputGrip); // .card-b okna źródła
output.parentElement?.append(outputGrip); // .card-b okna wyniku
for (const g of grips) g.setAttribute('aria-valuenow', String(input.offsetHeight));

/* ── Pasek „Zamaskowano" (chipy z ikonami, licznik, kategorie) ── */

const CHIP_META: Record<string, { label: string; cat: Cat; icon: string }> = {
  IMIE: { label: 'imię i nazwisko', cat: 'person', icon: 'dane-osobowe' },
  PESEL: { label: 'PESEL', cat: 'ident', icon: 'pesel' },
  NIP: { label: 'NIP', cat: 'ident', icon: 'nip' },
  REGON: { label: 'REGON', cat: 'ident', icon: 'dane-id' },
  DOWOD: { label: 'nr dowodu', cat: 'ident', icon: 'numer-dok' },
  PASZPORT: { label: 'nr paszportu', cat: 'ident', icon: 'numer-dok' },
  KRS: { label: 'numer KRS', cat: 'ident', icon: 'dane-id' },
  'ZNAK-SPRAWY': { label: 'znak sprawy', cat: 'ident', icon: 'numer-dok' },
  IBAN: { label: 'nr konta', cat: 'fin', icon: 'iban' },
  'NR-KONTA': { label: 'nr konta', cat: 'fin', icon: 'iban' },
  EMAIL: { label: 'e-mail', cat: 'contact', icon: 'login' },
  TELEFON: { label: 'telefon', cat: 'contact', icon: 'telefon' },
  ADRES: { label: 'adres', cat: 'place', icon: 'dom' },
  'KOD-POCZTOWY': { label: 'kod pocztowy', cat: 'place', icon: 'mapa-pl' },
  MIEJSCOWOSC: { label: 'miejscowość', cat: 'place', icon: 'mapa-pl' },
  'DATA-UR': { label: 'data urodzenia', cat: 'place', icon: 'kalendarz' },
};

function renderFindings(found: PiiFinding[]): void {
  findingsCard.hidden = false;
  // koercja licznika do liczby — obrona przed nie-liczbowym count z warstwy NER (XSS/NaN)
  const total = found.reduce((s, f) => s + (Number(f.count) || 0), 0);
  const byLabel = new Map<string, { count: number; cat: Cat; icon: string }>();
  for (const f of found) {
    const meta = CHIP_META[f.type] ?? { label: String(f.type), cat: 'ident' as Cat, icon: 'dane-id' };
    const prev = byLabel.get(meta.label);
    byLabel.set(meta.label, { count: (prev?.count ?? 0) + (Number(f.count) || 0), cat: meta.cat, icon: meta.icon });
  }
  const cats = new Set([...byLabel.values()].map((v) => v.cat)).size;
  statCount.textContent = String(total);
  statCats.textContent = String(cats);

  if (found.length === 0) {
    const clean = disabledGroups.size > 0
      ? '<span class="chip chip-hint">nic nie zamaskowano, część typów jest wyłączona w „Co maskować”</span>'
      : '<span class="chip chip-ok">nie wykryto danych osobowych</span>';
    const hint = !CLERK_EDITION && !nerEnabledBox.checked
      ? ' <span class="chip chip-hint">💡 rzadkie nazwiska złapie „Dokładniejsze wykrywanie nazwisk” poniżej</span>'
      : '';
    findingsChips.innerHTML = clean + hint;
    findingsStatus.textContent = disabledGroups.size > 0 ? 'Nic nie zamaskowano.' : 'Nie wykryto danych osobowych.';
    return;
  }
  // zwięzły komunikat dla czytnika ekranu (jeden, po debounce — nie zalewa)
  findingsStatus.textContent = `Zamaskowano ${total} ${total === 1 ? 'fragment' : 'fragmentów'} w ${cats} ${cats === 1 ? 'kategorii' : 'kategoriach'}.`;
  findingsChips.innerHTML = [...byLabel.entries()]
    .map(
      ([label, v]) =>
        `<button type="button" class="chip chip-nav ch-${v.cat}" data-cat="${v.cat}" ` +
        `data-tip="Przejdź do fragmentów tej kategorii w wyniku"><i class="gi">${icon(v.icon)}</i>` +
        `${escapeHtml(label)} <span class="x">×${v.count}</span></button>`,
    )
    .join(' ');
}

// Klik w chip „Zamaskowano" → skok do kolejnego znacznika tej kategorii w wyniku (cyklicznie).
findingsChips.addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement | null)?.closest?.('button.chip-nav') as HTMLElement | null;
  const cat = chip?.dataset.cat;
  if (!cat || !maskEls.length) return;
  const cls = `pii-${cat}`;
  const n = maskEls.length;
  for (let step = 1; step <= n; step++) {
    const j = (((maskIdx + step) % n) + n) % n;
    if (maskEls[j].classList.contains(cls)) { goToMask(j); return; }
  }
});

/* ── Główny przepływ ── */

function setResultActions(on: boolean): void {
  copyBtn.disabled = !on;
  downloadBtn.disabled = !on;
}

function updateSrcMeta(text: string): void {
  const lines = text ? text.split('\n').length : 0;
  srcMeta.textContent = `${lines} wierszy · ${text.length} znaków · plik możesz upuścić w dowolnym miejscu strony`;
}

function renderResult(redacted: string, found: PiiFinding[]): void {
  lastRedacted = redacted;
  lastInput = input.value;
  setResultActions(true);
  renderOutput();
  renderFindings(found);
}

function update(): void {
  const text = input.value;
  nerSeq++; // unieważnij spóźnioną odpowiedź NER
  updateSrcMeta(text);
  if (!text.trim()) {
    output.classList.remove('plain');
    output.innerHTML =
      '<span class="placeholder">Tu pojawi się zanonimizowany tekst, np.:<br><br>' +
      'Jan Kowalski, tel. 600 700 800<br>→ ' +
      `${maskHtml('IMIĘ I NAZWISKO')}, tel. ${maskHtml('TELEFON')}</span>`;
    findingsCard.hidden = true;
    lastRedacted = '';
    maskEls = [];
    maskIdx = -1;
    maskNav.hidden = true; // placeholder zawiera przykładowe znaczniki — nie nawigujemy po nich
    setResultActions(false);
    return;
  }
  const { redacted, found } = redactPII(text, {
    types: activeTypes(),
    pseudonyms: pseudonymsBox.checked,
  });
  renderResult(redacted, found);
  scheduleNer(redacted, found);
}

// Debounce: przy szybkim pisaniu nie odpalaj pełnego pipeline'u (26 przebiegów + przerender)
// na każdy znak. Licznik znaków/wierszy aktualizujemy NATYCHMIAST (tani), redakcję po ~140 ms.
let updateTimer: ReturnType<typeof setTimeout> | undefined;
input.addEventListener('input', () => {
  updateSrcMeta(input.value);
  clearTimeout(updateTimer);
  updateTimer = setTimeout(update, 140);
});

/* ── NER (usługa lokalna / ONNX w przeglądarce) — fail-safe ── */

let nerSeq = 0;
let nerTimer: ReturnType<typeof setTimeout> | undefined;

function nerConfig() {
  return { url: nerUrlInput.value.trim(), timeoutMs: 5000 };
}

function nerSource(): 'http' | 'onnx' {
  return nerSourceSel.value === 'onnx' ? 'onnx' : 'http';
}

function setNerStatus(ok: boolean | null): void {
  const viaOnnx = nerSource() === 'onnx' ? ' (ONNX w przeglądarce)' : '';
  if (ok === null) {
    nerStatus.textContent = 'sprawdzam…';
    nerStatus.className = 'sub ner-status';
    nerPill.textContent = 'sprawdzam';
    nerPill.className = 'pill-off';
  } else if (ok) {
    nerStatus.textContent = `aktywny ✓${viaOnnx}`;
    nerStatus.className = 'sub ner-status ner-ok';
    nerPill.textContent = 'aktywny';
    nerPill.className = 'pill-off pill-on';
  } else {
    nerStatus.textContent = 'niedostępny, działa warstwa reguł i słowników';
    nerStatus.className = 'sub ner-status ner-fail';
    nerPill.textContent = 'niedostępny';
    nerPill.className = 'pill-off';
  }
}

function scheduleNer(baseRedacted: string, baseFound: PiiFinding[]): void {
  if (!nerEnabledBox.checked) return;
  if (nerSource() === 'http' && !nerUrlInput.value.trim()) return;
  if (!imieEnabled()) return; // odznaczone imiona — NER nie ma czego dokładać
  const seq = ++nerSeq;
  clearTimeout(nerTimer);
  nerStatus.textContent = 'analizuję…';
  nerStatus.className = 'sub ner-status';
  output.setAttribute('aria-busy', 'true');
  nerTimer = setTimeout(async () => {
    const ner =
      nerSource() === 'onnx'
        ? await browserNerRedact(baseRedacted, (msg) => {
            if (seq === nerSeq) nerStatus.textContent = msg;
          })
        : await nerRedact(baseRedacted, nerConfig());
    if (seq !== nerSeq) return;
    output.removeAttribute('aria-busy');
    if (!ner) {
      setNerStatus(false);
      return;
    }
    setNerStatus(true);
    renderResult(ner.redacted, mergeFindings(baseFound, ner.found));
    output.classList.remove('ner-updated');
    void output.offsetWidth;
    output.classList.add('ner-updated');
  }, 400);
}

async function checkNer(): Promise<void> {
  if (!nerEnabledBox.checked) {
    nerStatus.textContent = 'wymaga jednorazowego uruchomienia usługi';
    nerStatus.className = 'sub ner-status';
    nerPill.textContent = 'wyłączony';
    nerPill.className = 'pill-off';
    return;
  }
  setNerStatus(null);
  setNerStatus(nerSource() === 'onnx' ? await browserNerAvailable() : await nerHealthCheck(nerConfig()));
}

nerEnabledBox.addEventListener('change', () => {
  nerDetails.hidden = !nerEnabledBox.checked;
  localStorage.setItem('ner-enabled', nerEnabledBox.checked ? '1' : '');
  checkNer();
  update();
});

nerUrlInput.addEventListener('change', () => {
  localStorage.setItem('ner-url', nerUrlInput.value.trim());
  checkNer();
  update();
});

// Adres usługi (Docker) ma sens tylko dla źródła „http" — dla przeglądarki go chowamy.
function syncUrlRowVisibility(): void {
  nerUrlInput.closest('.ner-row')?.toggleAttribute('hidden', nerSource() === 'onnx');
}

nerSourceSel.addEventListener('change', () => {
  localStorage.setItem('ner-source', nerSourceSel.value);
  syncUrlRowVisibility();
  checkNer();
  update();
});

// Źródło modelu: przywróć zapamiętany wybór, w przeciwnym razie zostaje domyślne
// „w przeglądarce" (pierwsza opcja). Selektor jest zawsze widoczny — użytkownik
// Dockera może przełączyć na „usługa w Dockerze" nawet bez paczki ONNX.
const savedSource = localStorage.getItem('ner-source');
if (savedSource === 'http' || savedSource === 'onnx') nerSourceSel.value = savedSource;
syncUrlRowVisibility();

const savedUrl = localStorage.getItem('ner-url');
if (savedUrl) nerUrlInput.value = savedUrl;
if (localStorage.getItem('ner-enabled')) {
  nerEnabledBox.checked = true;
  nerDetails.hidden = false;
}
checkNer();

/* ── Akcje ── */

let errorTimer: ReturnType<typeof setTimeout> | undefined;

function showError(msg: string): void {
  appError.textContent = msg;
  appError.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (appError.hidden = true), 8000);
}

clearBtn.addEventListener('click', () => {
  input.value = '';
  update();
  input.focus();
});

function flashCopy(text: string): void {
  const prev = copyLabel.textContent;
  copyLabel.textContent = text;
  setTimeout(() => (copyLabel.textContent = prev), 1500);
}

copyBtn.addEventListener('click', async () => {
  if (!lastRedacted) return;
  try {
    await navigator.clipboard.writeText(lastRedacted);
    flashCopy('Skopiowano ✓');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = lastRedacted;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    flashCopy(ok ? 'Skopiowano ✓' : 'Kopiuj');
    if (!ok) showError('Kopiowanie zablokowane przez przeglądarkę: zaznacz wynik i naciśnij Ctrl+C.');
  }
});

downloadBtn.addEventListener('click', () => {
  if (!lastRedacted) return;
  const blob = new Blob([lastRedacted], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zanonimizowany.txt';
  a.click();
  URL.revokeObjectURL(url);
});

// Przykład: maskowanie + strażnik kontekstu (art. 123 456 789 celowo zostaje)
const EXAMPLE_TEXT = `Dzień dobry, nazywam się Anna Kowalska (PESEL 44051401359).
Mieszkam przy ul. Polnej 12/3, 00-950 Warszawa.
Proszę o kontakt: anna.kowalska@example.com lub tel. 600 700 800.
Nr konta do zwrotu: PL61 1090 1014 0000 0712 1981 2874.
Sprawę prowadzi pan Bąkiewicz zgodnie z art. 123 456 789 KC.`;

exampleBtn.addEventListener('click', () => {
  input.value = EXAMPLE_TEXT;
  update();
  input.focus();
});

loadFileBtn.addEventListener('click', () => fileInput.click());

function loadTextFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    input.value = String(reader.result ?? '');
    update();
  };
  reader.readAsText(file);
}

async function loadAnyFile(file: File): Promise<void> {
  const isDocx = /\.docx$/i.test(file.name);
  const isPdf = /\.pdf$/i.test(file.name);
  if (!isDocx && !isPdf) {
    loadTextFile(file);
    return;
  }
  loadFileBtn.disabled = true;
  loadFileBtn.classList.add('busy');
  const prevLabel = loadFileLabel.textContent;
  loadFileLabel.textContent = 'Wczytuję';
  output.setAttribute('aria-busy', 'true');
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    input.value = isDocx ? extractDocxText(buf) : await extractPdfText(buf);
    update();
    // dokumenty najlepiej przegląda się w trybie recenzji
    setViewMode('compare');
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Nie udało się odczytać pliku.');
  } finally {
    loadFileBtn.disabled = false;
    loadFileBtn.classList.remove('busy');
    loadFileLabel.textContent = prevLabel;
    output.removeAttribute('aria-busy');
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void loadAnyFile(file);
  fileInput.value = '';
});

// drag&drop: na pole i GDZIEKOLWIEK na stronie (domyślna nawigacja = utrata pracy)
input.addEventListener('dragover', (e) => {
  e.preventDefault();
  input.classList.add('dragover');
});
input.addEventListener('dragleave', () => input.classList.remove('dragover'));
input.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  input.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadAnyFile(file);
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadAnyFile(file);
});

// Ctrl/Cmd+Enter — kopiuj wynik
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    copyBtn.click();
  }
});

/* ── Parametry URL i start ── */

const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  input.value = EXAMPLE_TEXT;
} else if (matchMedia('(pointer: fine)').matches) {
  input.focus();
}

// ?nertest=onnx — E2E ścieżki NER w przeglądarce
if (params.get('nertest') === 'onnx') {
  input.value =
    'Wczoraj Bąkiewicz podpisał umowę z Szczepankowską. Zeznania Krzemienieckiej ' +
    'potwierdził świadek Gzowski.';
  nerEnabledBox.checked = true;
  nerDetails.hidden = false;
  nerSourceSel.value = 'onnx';
  checkNer();
}

// ?pdftest — samodiagnostyka ścieżki PDF (fake worker w buildzie single-file)
if (params.has('pdftest')) {
  const body = 'BT /F1 12 Tf 72 720 Td (PDFTEST PESEL 44051401359) Tj ET';
  const objs = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${body.length}>>stream\n${body}\nendstream endobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ];
  let off = '%PDF-1.4\n'.length;
  const offs = objs.map((o) => {
    const cur = off;
    off += o.length;
    return cur;
  });
  const xref =
    'xref\n0 6\n0000000000 65535 f \n' +
    offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  const pdfBytes = new TextEncoder().encode(
    '%PDF-1.4\n' + objs.join('') + xref + `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${off}\n%%EOF`,
  );
  extractPdfText(pdfBytes)
    .then((t) => {
      input.value = `[PDF OK] ${t}`;
      update();
    })
    .catch((e) => {
      input.value = `[PDF FAIL] ${e instanceof Error ? e.message : e}`;
      update();
    });
}

$('app-version-top').textContent = __APP_VERSION__;

// Podmień wszystkie statyczne <i class="gi" data-i="…"> z index.html na inline SVG.
hydrateIcons();

// Dostępność: treść podpowiedzi żyje tylko w CSS ::after (niewidoczna dla czytników ekranu).
// Nadaj statycznym elementom [data-tip] bez własnej nazwy aria-label = treść podpowiedzi.
document.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => {
  if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && el.dataset.tip) {
    el.setAttribute('aria-label', el.dataset.tip);
    if (el.classList.contains('help')) el.setAttribute('role', 'note');
  }
});

update();
