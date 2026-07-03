import { redactPII, type PiiFinding } from 'anonimizator';
import './style.css';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLDivElement>('output');
const findingsBar = $<HTMLElement>('findings');
const findingsChips = $<HTMLSpanElement>('findings-chips');
const copyBtn = $<HTMLButtonElement>('copy');
const downloadBtn = $<HTMLButtonElement>('download');
const clearBtn = $<HTMLButtonElement>('clear');
const loadFileBtn = $<HTMLButtonElement>('load-file');
const fileInput = $<HTMLInputElement>('file-input');

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

function update(): void {
  const text = input.value;
  if (!text.trim()) {
    output.innerHTML = '<span class="placeholder">Tu pojawi się zredagowany tekst.</span>';
    findingsBar.hidden = true;
    lastRedacted = '';
    return;
  }
  const { redacted, found } = redactPII(text);
  lastRedacted = redacted;
  output.innerHTML = highlightMasks(escapeHtml(redacted));

  if (found.length === 0) {
    findingsBar.hidden = false;
    findingsChips.innerHTML = '<span class="chip chip-ok">nie wykryto danych osobowych</span>';
  } else {
    findingsBar.hidden = false;
    renderChips(found);
  }
}

input.addEventListener('input', update);

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

loadFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    input.value = String(reader.result ?? '');
    update();
  };
  reader.readAsText(file);
  fileInput.value = '';
});

update();
