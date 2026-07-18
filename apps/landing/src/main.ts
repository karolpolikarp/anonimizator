/**
 * Parawan — landing page. Logika strony:
 *  1) live demo z PRAWDZIWYM silnikiem `redactPII` (import z rdzenia, wtapiany do jednego
 *     pliku) — anonimizacja liczona w przeglądarce, bez żadnego żądania sieciowego;
 *  2) licznik żądań do sieci (dowód „0 żądań” z sekcji „Sprawdź sam”);
 *  3) drobiazgi UI: wersja, przełącznik widoku, kopiowanie, mobilne menu, hydracja ikon.
 *
 * Renderowanie znaczników i widok „Porównanie" są przeniesione z apps/web/src/main.ts,
 * żeby wynik wyglądał identycznie jak w narzędziu (spójność marki).
 */
import './style.css';
import { redactPII, type PiiFinding, type PiiType } from 'anonimizator';
import { hydrateIcons } from './icons';

const $ =<T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

/* ── Wersja (z build define) ── */
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
for (const id of ['ver', 'ver-foot']) {
  const el = $(id);
  if (el) el.textContent = version;
}

/* ── Renderowanie wyniku (znaczniki + widok „Porównanie") — przeniesione z aplikacji ── */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Kategoria wizualna znacznika po nazwie tokenu (spójna z legendą aplikacji). */
type Cat = 'person' | 'contact' | 'ident' | 'fin' | 'place';
function maskCategory(name: string): Cat {
  if (name.startsWith('OSOBA-') || name === 'IMIĘ I NAZWISKO' || name === 'DATA-URODZENIA') return 'person';
  if (name === 'EMAIL' || name === 'TELEFON') return 'contact';
  if (name === 'NR-KONTA') return 'fin';
  if (name === 'ADRES' || name === 'KOD-POCZTOWY' || name === 'MIEJSCOWOŚĆ') return 'place';
  return 'ident';
}

/** Kategoria po typie z silnika (do statystyk). */
function typeCategory(t: PiiType): Cat {
  if (t === 'IMIE' || t === 'DATA-UR') return 'person';
  if (t === 'EMAIL' || t === 'TELEFON') return 'contact';
  if (t === 'IBAN' || t === 'NR-KONTA') return 'fin';
  if (t === 'ADRES' || t === 'KOD-POCZTOWY' || t === 'MIEJSCOWOSC') return 'place';
  return 'ident';
}

const MASK_TOKEN_RE =
  /\[(PESEL|NIP|REGON|NR-KONTA|NR-DOWODU|NR-PASZPORTU|KRS|ZNAK-SPRAWY|PRAWO-JAZDY|NR-REJESTRACYJNY|VIN|IP|MAC|TOKEN|EMAIL|TELEFON|KOD-POCZTOWY|DATA-URODZENIA|ADRES|MIEJSCOWOŚĆ|IMIĘ I NAZWISKO|OSOBA-[A-Z]+)\]/g;

function maskHtml(name: string): string {
  return `<mark class="pii pii-${maskCategory(name)}">[${name}]</mark>`;
}

function highlightMasks(escaped: string): string {
  return escaped.replace(MASK_TOKEN_RE, (_m, name: string) => maskHtml(name));
}

/**
 * Widok „Porównanie": oryginał przekreślony obok kolorowego znacznika. Diff w O(n):
 * nie-maskowe segmenty wyniku występują w oryginale dosłownie i po kolei.
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

/* ── Live demo ── */
const EXAMPLE_TEXT = `Dzień dobry, nazywam się Anna Kowalska (PESEL 44051401359).
Mieszkam przy ul. Polnej 12/3, 00-950 Warszawa.
Proszę o kontakt: anna.kowalska@example.com lub tel. 600 700 800.
Nr konta do zwrotu: PL61 1090 1014 0000 0712 1981 2874.
Sprawę prowadzi pan Bąkiewicz zgodnie z art. 123 456 789 KC.`;

const input = $<HTMLTextAreaElement>('demo-input');
const outputEl = $('demo-output');
const statEl = $('demo-stat');
const viewResultBtn = $('view-result');
const viewCompareBtn = $('view-compare');
const copyBtn = $<HTMLButtonElement>('demo-copy');
const copyLabel = $('demo-copy-label');

let compareMode = false;
let lastRedacted = '';
let lastFound: PiiFinding[] = [];

/** Polska liczba mnoga: 1 → one; końcówka 2–4 poza 12–14 → few; reszta → many. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

function renderStats(found: PiiFinding[]): void {
  if (!statEl) return;
  const total = found.reduce((s, f) => s + f.count, 0);
  if (total === 0) {
    statEl.innerHTML = 'Nie wykryto danych osobowych w tym tekście.';
    return;
  }
  const cats = new Set(found.map((f) => typeCategory(f.type))).size;
  statEl.innerHTML =
    `Zamaskowano <b>${total}</b> ${plural(total, 'fragment', 'fragmenty', 'fragmentów')} ` +
    `w <b>${cats}</b> ${cats === 1 ? 'kategorii' : 'kategoriach'}.`;
}

function renderOutput(): void {
  if (!outputEl) return;
  if (!lastRedacted) {
    outputEl.innerHTML =
      `<span class="placeholder">Tu pojawi się bezpieczny tekst, np. ${maskHtml('IMIĘ I NAZWISKO')}, ` +
      `tel. ${maskHtml('TELEFON')}. Wpisz coś po lewej albo kliknij „Wstaw przykład”.</span>`;
    return;
  }
  outputEl.innerHTML = compareMode
    ? buildCompareHtml(input?.value ?? '', lastRedacted)
    : highlightMasks(escapeHtml(lastRedacted));
}

function analyze(): void {
  if (!input) return;
  const text = input.value;
  if (!text.trim()) {
    lastRedacted = '';
    lastFound = [];
    renderOutput();
    if (statEl) statEl.textContent = 'Wpisz tekst po lewej — statystyki pojawią się tutaj.';
    if (copyBtn) copyBtn.disabled = true;
    return;
  }
  const { redacted, found } = redactPII(text);
  lastRedacted = redacted;
  lastFound = found;
  renderOutput();
  renderStats(found);
  if (copyBtn) copyBtn.disabled = false;
}

let timer: ReturnType<typeof setTimeout> | undefined;
input?.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(analyze, 120);
});

function setView(compare: boolean): void {
  compareMode = compare;
  viewResultBtn?.classList.toggle('on', !compare);
  viewResultBtn?.setAttribute('aria-pressed', String(!compare));
  viewCompareBtn?.classList.toggle('on', compare);
  viewCompareBtn?.setAttribute('aria-pressed', String(compare));
  renderOutput();
}
viewResultBtn?.addEventListener('click', () => setView(false));
viewCompareBtn?.addEventListener('click', () => setView(true));

$('demo-example')?.addEventListener('click', () => {
  if (!input) return;
  input.value = EXAMPLE_TEXT;
  analyze();
  input.focus();
});

$('demo-clear')?.addEventListener('click', () => {
  if (!input) return;
  input.value = '';
  analyze();
  input.focus();
});

copyBtn?.addEventListener('click', async () => {
  if (!lastRedacted) return;
  try {
    await navigator.clipboard.writeText(lastRedacted);
    if (copyLabel) {
      const prev = copyLabel.textContent;
      copyLabel.textContent = 'Skopiowano ✓';
      setTimeout(() => {
        if (copyLabel) copyLabel.textContent = prev;
      }, 1600);
    }
  } catch {
    // Schowek może być niedostępny (np. file:// w części przeglądarek) — cichy no-op.
  }
});

/* ── Licznik żądań sieciowych („Sprawdź sam”): dowód, że strona nie łączy się z siecią.
   Liczymy tylko zasoby o schemacie http(s) — wszystko w tym pliku jest inline (data:),
   więc licznik powinien wynosić 0. To jest prawda weryfikowalna, nie deklaracja. ── */
function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
function updateNetCount(): void {
  const el = $('net-count');
  if (!el) return;
  try {
    const n = performance
      .getEntriesByType('resource')
      .filter((e) => isExternal((e as PerformanceResourceTiming).name)).length;
    el.textContent = String(n);
  } catch {
    /* Resource Timing API niedostępne — zostaw 0. */
  }
}
updateNetCount();
try {
  new PerformanceObserver(updateNetCount).observe({ type: 'resource', buffered: true });
} catch {
  /* PerformanceObserver niedostępny — licznik pozostaje statyczny. */
}

/* ── Mobilne menu ── */
const navToggle = $('nav-toggle');
const navLinks = $('nav-links');
navToggle?.addEventListener('click', () => {
  const open = navLinks?.classList.toggle('open') ?? false;
  navToggle.setAttribute('aria-expanded', String(open));
});
navLinks?.querySelectorAll('a').forEach((a) =>
  a.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle?.setAttribute('aria-expanded', 'false');
  }),
);

/* ── Wejścia sekcji: subtelny fade-up przy wejściu w widok ──
   Pomijamy treść nad zgięciem (żeby nic nie migotało przy starcie) i szanujemy
   preferencję ograniczenia ruchu (wtedy w ogóle nie ukrywamy elementów). */
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
if (!reduceMotion && 'IntersectionObserver' in window) {
  const targets = document.querySelectorAll<HTMLElement>(
    '.sec-head, .grid > .card, .demo-card, .table-wrap, .caveat, .notdo-row, .finalcta',
  );
  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          obs.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
  );
  const vh = window.innerHeight;
  let i = 0;
  targets.forEach((el) => {
    if (el.getBoundingClientRect().top < vh * 0.92) return; // widoczne od razu — zostaw
    el.classList.add('reveal');
    el.style.transitionDelay = `${Math.min((i % 4) * 55, 165)}ms`;
    io.observe(el);
    i++;
  });
}

/* ── Start ── */
hydrateIcons();
if (input) {
  input.value = EXAMPLE_TEXT; // pokaż demo od razu — bez wklejania własnych danych
  analyze();
}
