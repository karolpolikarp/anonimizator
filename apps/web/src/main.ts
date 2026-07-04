import { redactPII, type PiiFinding, type PiiType } from 'anonimizator';
import { mergeFindings, nerHealthCheck, nerRedact } from 'anonimizator/ner';
import { extractDocxText } from './docx';
import { extractPdfText } from './pdf';
import { browserNerAvailable, browserNerRedact } from './ner-browser';
import './style.css';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLDivElement>('output');
const findingsBar = $<HTMLElement>('findings');
const findingsChips = $<HTMLSpanElement>('findings-chips');
const copyBtn = $<HTMLButtonElement>('copy');
const downloadBtn = $<HTMLButtonElement>('download');
const clearBtn = $<HTMLButtonElement>('clear');
const exampleBtn = $<HTMLButtonElement>('example');
const loadFileBtn = $<HTMLButtonElement>('load-file');
const fileInput = $<HTMLInputElement>('file-input');
const nerEnabledBox = $<HTMLInputElement>('ner-enabled');
const nerDetails = $<HTMLDivElement>('ner-details');
const nerSourceSel = $<HTMLSelectElement>('ner-source');
const nerUrlInput = $<HTMLInputElement>('ner-url');
const nerStatus = $<HTMLSpanElement>('ner-status');

let lastRedacted = '';

// ── Wybór typów do maskowania (panel „Co maskować") ──
// Grupy logiczne widoczne dla użytkownika; IBAN i NR-KONTA to technicznie dwa typy,
// dla użytkownika — jedno „numer konta".
const MASK_GROUPS: Array<{ key: string; label: string; types: PiiType[] }> = [
  { key: 'pesel', label: 'PESEL', types: ['PESEL'] },
  { key: 'nip', label: 'NIP', types: ['NIP'] },
  { key: 'regon', label: 'REGON', types: ['REGON'] },
  { key: 'konto', label: 'numer konta', types: ['IBAN', 'NR-KONTA'] },
  { key: 'dowod', label: 'nr dowodu', types: ['DOWOD'] },
  { key: 'email', label: 'e-mail', types: ['EMAIL'] },
  { key: 'telefon', label: 'telefon', types: ['TELEFON'] },
  { key: 'kod', label: 'kod pocztowy', types: ['KOD-POCZTOWY'] },
  { key: 'dataur', label: 'data urodzenia', types: ['DATA-UR'] },
  { key: 'adres', label: 'adres', types: ['ADRES'] },
  { key: 'imie', label: 'imię i nazwisko', types: ['IMIE'] },
];

const maskTogglesEl = $<HTMLDivElement>('mask-toggles');
const pseudonymsBox = $<HTMLInputElement>('pseudonyms');
pseudonymsBox.checked = localStorage.getItem('pseudonyms') === '1';
pseudonymsBox.addEventListener('change', () => {
  localStorage.setItem('pseudonyms', pseudonymsBox.checked ? '1' : '');
  update();
});
const disabledGroups = new Set<string>(
  (localStorage.getItem('mask-disabled') ?? '').split(',').filter(Boolean),
);

for (const g of MASK_GROUPS) {
  const label = document.createElement('label');
  label.className = 'mask-toggle';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !disabledGroups.has(g.key);
  box.addEventListener('change', () => {
    if (box.checked) disabledGroups.delete(g.key);
    else disabledGroups.add(g.key);
    localStorage.setItem('mask-disabled', [...disabledGroups].join(','));
    update();
  });
  label.append(box, document.createTextNode(` ${g.label}`));
  maskTogglesEl.append(label);
}

/** Typy aktywne wg checkboxów; undefined = wszystkie (nie przekazujemy opcji). */
function activeTypes(): PiiType[] | undefined {
  if (disabledGroups.size === 0) return undefined;
  return MASK_GROUPS.filter((g) => !disabledGroups.has(g.key)).flatMap((g) => g.types);
}

function imieEnabled(): boolean {
  return !disabledGroups.has('imie');
}

const CHIP_LABEL: Record<string, string> = {
  EMAIL: 'e-mail',
  IBAN: 'nr konta',
  'NR-KONTA': 'nr konta',
  PESEL: 'PESEL',
  NIP: 'NIP',
  REGON: 'REGON',
  TELEFON: 'telefon',
  DOWOD: 'nr dowodu',
  'KOD-POCZTOWY': 'kod pocztowy',
  'DATA-UR': 'data urodzenia',
  ADRES: 'adres',
  IMIE: 'imię i nazwisko',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Podświetl placeholdery ([PESEL], [IMIĘ I NAZWISKO]…) w zredagowanym tekście. */
function highlightMasks(escaped: string): string {
  return escaped.replace(
    /\[(PESEL|NIP|REGON|NR-KONTA|NR-DOWODU|EMAIL|TELEFON|KOD-POCZTOWY|DATA-URODZENIA|ADRES|IMIĘ I NAZWISKO|OSOBA-[A-Z]+)\]/g,
    '<mark class="mask">[$1]</mark>',
  );
}

function renderChips(found: PiiFinding[]): void {
  // scal duplikaty etykiet (IBAN i NR-KONTA mają tę samą etykietę)
  const byLabel = new Map<string, number>();
  for (const f of found) {
    const label = CHIP_LABEL[f.type] ?? f.type;
    byLabel.set(label, (byLabel.get(label) ?? 0) + f.count);
  }
  findingsChips.innerHTML = [...byLabel.entries()]
    .map(([label, count]) => `<span class="chip">${escapeHtml(label)} ×${count}</span>`)
    .join(' ');
}

// Powyżej tego progu rezygnujemy z podświetlania masek (dziesiątki tysięcy elementów <mark>
// potrafią przyciąć DOM); sama redakcja jest szybka (~30 ms na 1,5 mln znaków).
const HIGHLIGHT_LIMIT = 300_000;

function renderResult(redacted: string, found: PiiFinding[]): void {
  lastRedacted = redacted;
  setResultActions(true);
  if (redacted.length > HIGHLIGHT_LIMIT) {
    output.textContent = redacted;
  } else {
    output.innerHTML = highlightMasks(escapeHtml(redacted));
  }
  findingsBar.hidden = false;
  const label = findingsBar.querySelector<HTMLSpanElement>('.findings-label')!;
  if (found.length === 0) {
    label.textContent = 'Wynik skanowania:'; // „Zamaskowano: nie wykryto…" czytało się sprzecznie
    // Gdy użytkownik wyłączył część typów, „nic nie znaleziono" nie oznacza „tekst czysty".
    findingsChips.innerHTML = disabledGroups.size > 0
      ? '<span class="chip">nic nie zamaskowano — część typów jest wyłączona w „Co maskować”</span>'
      : '<span class="chip chip-ok">nie wykryto danych osobowych</span>';
    // Rzadkie nazwiska w odmianie wykrywa dopiero warstwa NER — podpowiedz, gdy wyłączona
    // (feedback usera: wkleił trudne nazwiska, dostał zielone „czysto" i uznał to za bug).
    if (!nerEnabledBox.checked) {
      findingsChips.innerHTML +=
        ' <span class="chip chip-hint">💡 rzadkie nazwiska złapie „Dokładniejsze wykrywanie nazwisk” poniżej</span>';
    }
  } else {
    const total = found.reduce((s, f) => s + f.count, 0);
    label.textContent = `Zamaskowano (${total}):`;
    renderChips(found);
  }
}

// ── Opcjonalny lokalny NER (usługa na komputerze użytkownika, services/ner) ──
// Warstwa regex działa natychmiast; NER dokłada się z opóźnieniem (debounce) i jest
// FAIL-SAFE: gdy usługa nie odpowiada, zostaje wynik warstwy regex. Licznik sekwencji
// odrzuca spóźnione odpowiedzi, żeby stary wynik nie nadpisał nowszego tekstu.
let nerSeq = 0;
let nerTimer: ReturnType<typeof setTimeout> | undefined;

function nerConfig() {
  return { url: nerUrlInput.value.trim(), timeoutMs: 5000 };
}

function nerSource(): 'http' | 'onnx' {
  return nerSourceSel.value === 'onnx' ? 'onnx' : 'http';
}

function scheduleNer(baseRedacted: string, baseFound: PiiFinding[]): void {
  if (!nerEnabledBox.checked) return;
  if (nerSource() === 'http' && !nerUrlInput.value.trim()) return;
  if (!imieEnabled()) return; // użytkownik odznaczył imiona — NER nie ma czego dokładać
  const seq = ++nerSeq;
  clearTimeout(nerTimer);
  nerStatus.textContent = 'analizuję…';
  nerStatus.className = 'ner-status';
  output.setAttribute('aria-busy', 'true');
  nerTimer = setTimeout(async () => {
    const ner =
      nerSource() === 'onnx'
        ? await browserNerRedact(baseRedacted, (msg) => {
            if (seq === nerSeq) nerStatus.textContent = msg;
          })
        : await nerRedact(baseRedacted, nerConfig());
    if (seq !== nerSeq) return; // w międzyczasie użytkownik zmienił tekst
    output.removeAttribute('aria-busy');
    if (!ner) {
      setNerStatus(false);
      return;
    }
    setNerStatus(true);
    renderResult(ner.redacted, mergeFindings(baseFound, ner.found));
    // subtelny błysk: wynik właśnie się zmienił „sam z siebie"
    output.classList.remove('ner-updated');
    void output.offsetWidth; // restart animacji
    output.classList.add('ner-updated');
  }, 400);
}

function setNerStatus(ok: boolean | null): void {
  const viaOnnx = nerSource() === 'onnx' ? ' (ONNX w przeglądarce)' : '';
  if (ok === null) {
    nerStatus.textContent = 'sprawdzam…';
    nerStatus.className = 'ner-status';
  } else if (ok) {
    nerStatus.textContent = `aktywny ✓${viaOnnx}`;
    nerStatus.className = 'ner-status ner-ok';
  } else {
    nerStatus.textContent = 'niedostępny — działa warstwa regex';
    nerStatus.className = 'ner-status ner-fail';
  }
}

async function checkNer(): Promise<void> {
  if (!nerEnabledBox.checked) {
    nerStatus.textContent = '';
    return;
  }
  setNerStatus(null);
  if (nerSource() === 'onnx') {
    setNerStatus(await browserNerAvailable());
  } else {
    setNerStatus(await nerHealthCheck(nerConfig()));
  }
}

function setResultActions(on: boolean): void {
  copyBtn.disabled = !on;
  downloadBtn.disabled = !on;
}

function update(): void {
  const text = input.value;
  nerSeq++; // unieważnij ewentualną spóźnioną odpowiedź NER
  if (!text.trim()) {
    // mini "przed → po" uczy formatu wyniku szybciej niż jakikolwiek opis
    output.innerHTML =
      '<span class="placeholder">Tu pojawi się zanonimizowany tekst, np.:\n\n' +
      'Jan Kowalski, tel. 600 700 800\n→ ' +
      '<mark class="mask">[IMIĘ I NAZWISKO]</mark>, tel. <mark class="mask">[TELEFON]</mark></span>';
    findingsBar.hidden = true;
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

nerSourceSel.addEventListener('change', () => {
  localStorage.setItem('ner-source', nerSourceSel.value);
  nerUrlInput.hidden = nerSource() === 'onnx';
  checkNer();
  update();
});

// pokaż wybór źródła tylko, gdy obok aplikacji leży onnx-pack (vendor/ + models/)
void browserNerAvailable().then((ok) => {
  if (!ok) return;
  nerSourceSel.hidden = false;
  if (localStorage.getItem('ner-source') === 'onnx') {
    nerSourceSel.value = 'onnx';
    nerUrlInput.hidden = true;
    checkNer();
  }
});

// przywróć ustawienia NER z poprzedniej wizyty (localStorage — lokalnie, jak wszystko tutaj)
const savedUrl = localStorage.getItem('ner-url');
if (savedUrl) nerUrlInput.value = savedUrl;
if (localStorage.getItem('ner-enabled')) {
  nerEnabledBox.checked = true;
  nerDetails.hidden = false;
  checkNer();
}

clearBtn.addEventListener('click', () => {
  input.value = '';
  update();
  input.focus();
});

function flashCopyBtn(text: string): void {
  const prev = copyBtn.textContent;
  copyBtn.textContent = text;
  setTimeout(() => (copyBtn.textContent = prev), 1500);
}

copyBtn.addEventListener('click', async () => {
  if (!lastRedacted) return;
  try {
    await navigator.clipboard.writeText(lastRedacted);
    flashCopyBtn('Skopiowano ✓');
  } catch {
    // fallback: przeglądarka odmówiła Clipboard API — kopiujemy przez ukryty textarea
    const ta = document.createElement('textarea');
    ta.value = lastRedacted;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    flashCopyBtn(ok ? 'Skopiowano ✓' : 'Kopiuj');
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

// Przykład pokazuje pełne spektrum: maskowanie PESEL/IBAN/adresu/nazwisk ORAZ strażnik
// kontekstu (numer przepisu „art. 123 456 789" celowo zostaje nietknięty).
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

const appError = $<HTMLParagraphElement>('app-error');
let errorTimer: ReturnType<typeof setTimeout> | undefined;

/** Nietrwały pasek błędu w UI (role=alert) — zamiast blokującego alert(). */
function showError(msg: string): void {
  appError.textContent = msg;
  appError.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (appError.hidden = true), 8000);
}

async function loadAnyFile(file: File): Promise<void> {
  const isDocx = /\.docx$/i.test(file.name);
  const isPdf = /\.pdf$/i.test(file.name);
  if (!isDocx && !isPdf) {
    loadTextFile(file);
    return;
  }
  // duży PDF parsuje się sekundy — bez stanu ładowania wygląda na "nie działa"
  loadFileBtn.disabled = true;
  loadFileBtn.classList.add('busy');
  const prevLabel = loadFileBtn.textContent;
  loadFileBtn.textContent = 'Wczytuję';
  output.setAttribute('aria-busy', 'true');
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    input.value = isDocx ? extractDocxText(buf) : await extractPdfText(buf);
    update();
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Nie udało się odczytać pliku.');
  } finally {
    loadFileBtn.disabled = false;
    loadFileBtn.classList.remove('busy');
    loadFileBtn.textContent = prevLabel;
    output.removeAttribute('aria-busy');
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void loadAnyFile(file);
  fileInput.value = '';
});

// drag&drop pliku wprost na pole tekstowe
input.addEventListener('dragover', (e) => {
  e.preventDefault();
  input.classList.add('dragover');
});
input.addEventListener('dragleave', () => input.classList.remove('dragover'));
input.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation(); // handler na window nie może wczytać pliku drugi raz
  input.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadAnyFile(file);
});

// Upuszczenie pliku GDZIEKOLWIEK na stronie = wczytaj (domyślna nawigacja przeglądarki
// do pliku kasowałaby wpisany tekst — najdotkliwsza możliwa utrata pracy).
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadAnyFile(file);
});

// Ctrl/Cmd+Enter — skopiuj wynik (skrót podpowiadany w title przycisku Kopiuj)
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    copyBtn.click();
  }
});

// ?demo — autouzupełnij przykład (do linków demonstracyjnych i zrzutów ekranu).
// MUSI być po deklaracji EXAMPLE_TEXT (const, TDZ) i tuż przed startowym update().
const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  input.value = EXAMPLE_TEXT;
} else if (matchMedia('(pointer: fine)').matches) {
  // autofocus tylko z myszą/trackpadem — na dotyku wywołuje klawiaturę zasłaniającą pół ekranu
  input.focus();
}

document.getElementById('app-version')!.textContent = __APP_VERSION__;

// ?nertest=onnx — E2E ścieżki NER w przeglądarce: trudne nazwiska, których nie zna
// warstwa deterministyczna, + wymuszone źródło ONNX.
if (params.get('nertest') === 'onnx') {
  input.value =
    'Wczoraj Bąkiewicz podpisał umowę z Szczepankowską. Zeznania Krzemienieckiej ' +
    'potwierdził świadek Gzowski.';
  nerEnabledBox.checked = true;
  nerDetails.hidden = false;
  nerSourceSel.value = 'onnx';
  nerUrlInput.hidden = true;
  checkNer();
}

// ?pdftest — samodiagnostyka ścieżki PDF (fake worker w buildzie single-file):
// generuje minimalny PDF w pamięci i przepuszcza przez ekstraktor.
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

update();
