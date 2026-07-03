import { redactPII, type PiiFinding } from 'anonimizator';
import { mergeFindings, nerHealthCheck, nerRedact } from 'anonimizator/ner';
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
const nerUrlInput = $<HTMLInputElement>('ner-url');
const nerStatus = $<HTMLSpanElement>('ner-status');

let lastRedacted = '';

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
    /\[(PESEL|NIP|REGON|NR-KONTA|NR-DOWODU|EMAIL|TELEFON|KOD-POCZTOWY|DATA-URODZENIA|ADRES|IMIĘ I NAZWISKO)\]/g,
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

function renderResult(redacted: string, found: PiiFinding[]): void {
  lastRedacted = redacted;
  output.innerHTML = highlightMasks(escapeHtml(redacted));
  findingsBar.hidden = false;
  if (found.length === 0) {
    findingsChips.innerHTML = '<span class="chip chip-ok">nie wykryto danych osobowych</span>';
  } else {
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

function scheduleNer(baseRedacted: string, baseFound: PiiFinding[]): void {
  if (!nerEnabledBox.checked || !nerUrlInput.value.trim()) return;
  const seq = ++nerSeq;
  clearTimeout(nerTimer);
  nerTimer = setTimeout(async () => {
    const ner = await nerRedact(baseRedacted, nerConfig());
    if (seq !== nerSeq) return; // w międzyczasie użytkownik zmienił tekst
    if (!ner) {
      setNerStatus(false);
      return;
    }
    setNerStatus(true);
    renderResult(ner.redacted, mergeFindings(baseFound, ner.found));
  }, 400);
}

function setNerStatus(ok: boolean | null): void {
  if (ok === null) {
    nerStatus.textContent = 'sprawdzam…';
    nerStatus.className = 'ner-status';
  } else if (ok) {
    nerStatus.textContent = 'aktywny ✓';
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
  setNerStatus(await nerHealthCheck(nerConfig()));
}

function update(): void {
  const text = input.value;
  nerSeq++; // unieważnij ewentualną spóźnioną odpowiedź NER
  if (!text.trim()) {
    output.innerHTML = '<span class="placeholder">Tu pojawi się zredagowany tekst.</span>';
    findingsBar.hidden = true;
    lastRedacted = '';
    return;
  }
  const { redacted, found } = redactPII(text);
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

copyBtn.addEventListener('click', async () => {
  if (!lastRedacted) return;
  await navigator.clipboard.writeText(lastRedacted);
  const prev = copyBtn.textContent;
  copyBtn.textContent = 'Skopiowano ✓';
  setTimeout(() => (copyBtn.textContent = prev), 1500);
});

downloadBtn.addEventListener('click', () => {
  if (!lastRedacted) return;
  const blob = new Blob([lastRedacted], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'zredagowany.txt';
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

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  loadTextFile(file);
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
  input.classList.remove('dragover');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadTextFile(file);
});

update();
