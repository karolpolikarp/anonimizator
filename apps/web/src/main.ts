import { redactPII, type PiiFinding, type PiiType } from 'anonimizator';
import { mergeFindings, nerHealthCheck, nerRedact } from 'anonimizator/ner';
import { extractDocxText } from './docx';
import { extractPdfText } from './pdf';
import { browserNerAvailable, browserNerRedact } from './ner-browser';
import './style.css';

// Ikony (Vite inline'uje je jako data-URI — single-file bez osobnych plików)
import icoDaneOsobowe from './icons/dane-osobowe.png';
import icoPesel from './icons/pesel.png';
import icoNip from './icons/nip.png';
import icoDaneId from './icons/dane-id.png';
import icoNumerDok from './icons/numer-dok.png';
import icoIban from './icons/iban.png';
import icoLogin from './icons/login.png';
import icoTelefon from './icons/telefon.png';
import icoDom from './icons/dom.png';
import icoMapaPl from './icons/mapa-pl.png';
import icoKalendarz from './icons/kalendarz.png';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLDivElement>('output');
const findingsCard = $<HTMLElement>('findings');
const findingsChips = $<HTMLSpanElement>('findings-chips');
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

let lastRedacted = '';
let lastInput = '';
let viewMode: 'result' | 'compare' = 'result';

// Edycja „urzędnik" (release dla głównej grupy docelowej): build BEZ warstwy AI/NER.
// Kod NER zostaje w repozytorium — tu tylko usuwamy elementy oznaczone [data-full] z DOM,
// żeby interfejs był maksymalnie prosty. Flagę podstawia Vite przy buildzie (VITE_EDITION).
const CLERK_EDITION = import.meta.env.VITE_EDITION === 'urzednik';
if (CLERK_EDITION) {
  for (const el of document.querySelectorAll('[data-full]')) el.remove();
  // Edycja urzędnik nie ma warstwy AI — usuwamy wzmianki o niej z nagłówka (uczciwość).
  const sub = document.getElementById('hero-sub');
  if (sub) sub.textContent = 'Lokalny anonimizator polskich danych osobowych — reguły i sumy kontrolne';
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
  { key: 'pesel', label: 'PESEL', types: ['PESEL'], cat: 'ident', icon: icoPesel, code: '[PESEL]', tip: '11 cyfr + walidacja sumy kontrolnej' },
  { key: 'nip', label: 'NIP', types: ['NIP'], cat: 'ident', icon: icoNip, code: '[NIP]', tip: '10 cyfr (także z myślnikami) + suma kontrolna' },
  { key: 'regon', label: 'REGON', types: ['REGON'], cat: 'ident', icon: icoDaneId, code: '[REGON]', tip: '9 lub 14 cyfr + suma kontrolna' },
  { key: 'dowod', label: 'Nr dowodu osobistego', types: ['DOWOD'], cat: 'ident', icon: icoNumerDok, code: '[NR-DOWODU]', tip: '3 litery + 6 cyfr + suma kontrolna' },
  { key: 'konto', label: 'IBAN / nr konta', types: ['IBAN', 'NR-KONTA'], cat: 'fin', icon: icoIban, code: '[NR-KONTA]', tip: 'Walidacja mod 97 lub kontekst „konto/rachunek”' },
  { key: 'email', label: 'E-mail', types: ['EMAIL'], cat: 'contact', icon: icoLogin, code: '[EMAIL]', tip: 'Wzorzec adresu e-mail' },
  { key: 'telefon', label: 'Telefon', types: ['TELEFON'], cat: 'contact', icon: icoTelefon, code: '[TELEFON]', tip: '9 cyfr, opcjonalnie prefiks +48' },
  { key: 'adres', label: 'Adres', types: ['ADRES'], cat: 'place', icon: icoDom, code: '[ADRES]', tip: 'ul./al./os./pl. + nazwa + numer' },
  { key: 'kod', label: 'Kod pocztowy', types: ['KOD-POCZTOWY'], cat: 'place', icon: icoMapaPl, code: '[KOD-POCZTOWY]', tip: 'Wzorzec XX-XXX' },
  { key: 'miejscowosc', label: 'Miejscowość', types: ['MIEJSCOWOSC'], cat: 'place', icon: icoMapaPl, code: '[MIEJSCOWOŚĆ]', tip: 'Miejscowość po kodzie pocztowym (w adresie)' },
  { key: 'dataur', label: 'Data urodzenia', types: ['DATA-UR'], cat: 'place', icon: icoKalendarz, code: '[DATA-URODZENIA]', tip: 'Data z kontekstem „ur./urodzony”' },
  { key: 'imie', label: 'Imię i nazwisko', types: ['IMIE'], cat: 'person', icon: icoDaneOsobowe, code: '[IMIĘ I NAZWISKO] — wykrywanie heurystyczne; odznaczenie wyłącza też NER', tip: 'Słownik ~200 imion i ~230 nazwisk z odmianą + wyzwalacze kontekstu; odznaczenie wyłącza też NER', full: true },
];

// W edycji „urzędnik" nie ma NER — usuwamy wzmianki z etykiet/tooltipów tej warstwy.
if (CLERK_EDITION) {
  const imie = MASK_GROUPS.find((g) => g.key === 'imie');
  if (imie) {
    imie.code = '[IMIĘ I NAZWISKO] — wykrywanie heurystyczne';
    imie.tip = 'Słownik ~200 imion i ~230 nazwisk z odmianą + wyzwalacze kontekstu';
  }
  MASK_TIP['IMIĘ I NAZWISKO'] = 'Osoby · słownik imion/nazwisk lub wyzwalacz kontekstu';
}

const maskTogglesEl = $<HTMLSpanElement>('mask-toggles');
const disabledGroups = new Set<string>(
  (localStorage.getItem('mask-disabled') ?? '').split(',').filter(Boolean),
);

for (const g of MASK_GROUPS) {
  const label = document.createElement('label');
  label.className = `tg${g.full ? ' tg-full' : ''}`;
  label.dataset.tip = g.tip;

  const ic = document.createElement('span');
  ic.className = `ic ic-s c-${g.cat}`;
  const img = document.createElement('img');
  img.src = g.icon;
  img.alt = '';
  ic.append(img);

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
  maskTogglesEl.append(label);
}

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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const MASK_TOKEN_RE =
  /\[(PESEL|NIP|REGON|NR-KONTA|NR-DOWODU|EMAIL|TELEFON|KOD-POCZTOWY|DATA-URODZENIA|ADRES|MIEJSCOWOŚĆ|IMIĘ I NAZWISKO|OSOBA-[A-Z]+)\]/g;

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
    return;
  }
  const html =
    viewMode === 'compare'
      ? buildCompareHtml(lastInput, lastRedacted)
      : highlightMasks(escapeHtml(lastRedacted));
  output.innerHTML = wrapLines(html);
}

function setViewMode(mode: 'result' | 'compare'): void {
  viewMode = mode;
  viewResultBtn.classList.toggle('on', mode === 'result');
  viewCompareBtn.classList.toggle('on', mode === 'compare');
  renderOutput();
}

viewResultBtn.addEventListener('click', () => setViewMode('result'));
viewCompareBtn.addEventListener('click', () => setViewMode('compare'));

/* ── Pasek „Zamaskowano" (chipy z ikonami, licznik, kategorie) ── */

const CHIP_META: Record<string, { label: string; cat: Cat; icon: string }> = {
  IMIE: { label: 'imię i nazwisko', cat: 'person', icon: icoDaneOsobowe },
  PESEL: { label: 'PESEL', cat: 'ident', icon: icoPesel },
  NIP: { label: 'NIP', cat: 'ident', icon: icoNip },
  REGON: { label: 'REGON', cat: 'ident', icon: icoDaneId },
  DOWOD: { label: 'nr dowodu', cat: 'ident', icon: icoNumerDok },
  IBAN: { label: 'nr konta', cat: 'fin', icon: icoIban },
  'NR-KONTA': { label: 'nr konta', cat: 'fin', icon: icoIban },
  EMAIL: { label: 'e-mail', cat: 'contact', icon: icoLogin },
  TELEFON: { label: 'telefon', cat: 'contact', icon: icoTelefon },
  ADRES: { label: 'adres', cat: 'place', icon: icoDom },
  'KOD-POCZTOWY': { label: 'kod pocztowy', cat: 'place', icon: icoMapaPl },
  MIEJSCOWOSC: { label: 'miejscowość', cat: 'place', icon: icoMapaPl },
  'DATA-UR': { label: 'data urodzenia', cat: 'place', icon: icoKalendarz },
};

function renderFindings(found: PiiFinding[]): void {
  findingsCard.hidden = false;
  const total = found.reduce((s, f) => s + f.count, 0);
  const byLabel = new Map<string, { count: number; cat: Cat; icon: string }>();
  for (const f of found) {
    const meta = CHIP_META[f.type] ?? { label: f.type, cat: 'ident' as Cat, icon: icoDaneId };
    const prev = byLabel.get(meta.label);
    byLabel.set(meta.label, { count: (prev?.count ?? 0) + f.count, cat: meta.cat, icon: meta.icon });
  }
  statCount.textContent = String(total);
  statCats.textContent = String(new Set([...byLabel.values()].map((v) => v.cat)).size);

  if (found.length === 0) {
    const clean = disabledGroups.size > 0
      ? '<span class="chip chip-hint">nic nie zamaskowano — część typów jest wyłączona w „Co maskować”</span>'
      : '<span class="chip chip-ok">nie wykryto danych osobowych</span>';
    const hint = !CLERK_EDITION && !nerEnabledBox.checked
      ? ' <span class="chip chip-hint">💡 rzadkie nazwiska złapie „Dokładniejsze wykrywanie nazwisk” poniżej</span>'
      : '';
    findingsChips.innerHTML = clean + hint;
    return;
  }
  findingsChips.innerHTML = [...byLabel.entries()]
    .map(
      ([label, v]) =>
        `<span class="chip ch-${v.cat}"><img src="${v.icon}" alt="" />${escapeHtml(label)} <span class="x">×${v.count}</span></span>`,
    )
    .join(' ');
}

/* ── Główny przepływ ── */

function setResultActions(on: boolean): void {
  copyBtn.disabled = !on;
  downloadBtn.disabled = !on;
}

function updateSrcMeta(text: string): void {
  const lines = text ? text.split('\n').length : 0;
  srcMeta.textContent = `${lines} wierszy · ${text.length} znaków — plik możesz upuścić w dowolnym miejscu strony`;
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

input.addEventListener('input', update);

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
    nerStatus.textContent = 'niedostępny — działa warstwa reguł i słowników';
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
    if (!ok) showError('Kopiowanie zablokowane przez przeglądarkę — zaznacz wynik i naciśnij Ctrl+C.');
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

$('app-version').textContent = __APP_VERSION__;
$('app-version-top').textContent = __APP_VERSION__;

update();
