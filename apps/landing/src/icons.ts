/**
 * Zestaw ikon jako inline SVG (jeden spójny styl: linia 1.8, zaokrąglone końce,
 * siatka 24×24). Kolor bierze się z `currentColor` — dzięki temu w kontenerze
 * kategorii (.ic.c-person itd.) glif przyjmuje kolor tej kategorii, a w przycisku
 * kolor tekstu przycisku. Zero rastrów, zero zewnętrznych assetów — wszystko wjeżdża
 * inline do jednego pliku HTML (build jednoplikowy). Klucz = nazwa (dawniej nazwa PNG).
 *
 * Renderowanie: elementy `<i class="gi" data-i="NAZWA">` są „hydratowane" w main.ts
 * (innerHTML = ICONS[name]); ikony dynamiczne (przełączniki, chipy) korzystają z tego
 * samego źródła. To jedno źródło prawdy dla całej ikonografii.
 */

const A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body: string): string => `<svg ${A} aria-hidden="true">${body}</svg>`;
const dot = (cx: number, cy: number, r = 1): string =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;

export const ICONS: Record<string, string> = {
  // ── Osoby ──
  'dane-osobowe': svg('<circle cx="12" cy="8" r="3.5"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>'),
  losowanie: svg(
    '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/>' +
      '<path d="M16 5.2a3 3 0 0 1 0 5.6"/><path d="M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/>',
  ),

  // ── Identyfikatory ──
  pesel: svg(
    '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="6" y="9" width="4.5" height="6" rx="1"/>' +
      '<line x1="13" y1="10" x2="18" y2="10"/><line x1="13" y1="14" x2="18" y2="14"/>',
  ),
  nip: svg(
    '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>' +
      '<line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>',
  ),
  'dane-id': svg(
    '<path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><path d="M15 9h3a1 1 0 0 1 1 1v11"/>' +
      '<line x1="3" y1="21" x2="21" y2="21"/><line x1="8" y1="7" x2="9" y2="7"/><line x1="11" y1="7" x2="12" y2="7"/>' +
      '<line x1="8" y1="11" x2="9" y2="11"/><line x1="11" y1="11" x2="12" y2="11"/><line x1="8" y1="15" x2="9" y2="15"/><line x1="11" y1="15" x2="12" y2="15"/>',
  ),
  'numer-dok': svg(
    '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="9" cy="9" r="2"/>' +
      '<path d="M6 15.5a3 3 0 0 1 6 0"/><line x1="14" y1="8" x2="18" y2="8"/><line x1="14" y1="12" x2="18" y2="12"/>',
  ),

  // ── Finanse ──
  iban: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>'),

  // ── Kontakt ──
  login: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
  telefon: svg('<path d="M6.5 3h3l1.4 4.5-2 1.4a12 12 0 0 0 5.2 5.2l1.4-2 4.5 1.4v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3z"/>'),

  // ── Adres i czas ──
  dom: svg('<path d="M4 11 12 4l8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/><rect x="10" y="14" width="4" height="6"/>'),
  'mapa-pl': svg('<path d="m9 4 6 2 5.2-2v14L15 20l-6-2-5.2 2V6z"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/>'),
  kalendarz: svg(
    '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>' +
      '<line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/>',
  ),

  // ── Narzędzia / stany ──
  haslo: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' + dot(12, 15.5, 1.3)),
  onoff: svg('<path d="M12 3v8.5"/><path d="M6.8 7.2a8 8 0 1 0 10.4 0"/>'),
  ustawienia: svg(
    '<circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M19.4 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1"/>',
  ),
  // suwaki/przełączniki — dobór, co maskować (dwie ścieżki z gałkami)
  suwaki: svg(
    '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/>' +
      '<circle cx="15" cy="8" r="2.7" fill="currentColor" stroke="none"/>' +
      '<circle cx="9" cy="16" r="2.7" fill="currentColor" stroke="none"/>',
  ),
  podglad: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  maskowanie: svg('<path d="M12 3 5 6v5c0 4.6 3 7.6 7 9 4-1.4 7-4.4 7-9V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>'),
  przyklad: svg('<path d="M9.5 18h5"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.6 1 1.4 1.1 2.4h5.4c.1-1 .5-1.8 1.1-2.4A6 6 0 0 0 12 3z"/>'),
  'plik-txt': svg(
    '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>' +
      '<line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12.5" y2="17"/>',
  ),
  wyczysc: svg('<path d="m15.5 5 3.5 3.5a2 2 0 0 1 0 2.8L12 18.3H7l-2.5-2.5a2 2 0 0 1 0-2.8L12.7 5a2 2 0 0 1 2.8 0z"/><line x1="9" y1="10" x2="14" y2="15"/><line x1="7" y1="21" x2="20" y2="21"/>'),
  kosz: svg(
    '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>' +
      '<path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  ),
  kopiuj: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  regula: svg(
    '<line x1="12" y1="4" x2="12" y2="20"/><line x1="7" y1="20" x2="17" y2="20"/><line x1="4.5" y1="7" x2="19.5" y2="7"/>' +
      '<path d="M4.5 7 2 12.5a3 3 0 0 0 5 0z"/><path d="M19.5 7 17 12.5a3 3 0 0 0 5 0z"/>' + dot(12, 4, 1.2),
  ),
  sprawdz: svg('<circle cx="11" cy="11" r="6.2"/><line x1="20" y1="20" x2="15.6" y2="15.6"/>'),
  suma: svg(
    '<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="3" rx="0.6"/>' +
      dot(9, 13) + dot(12, 13) + dot(15, 13) + dot(9, 17) + dot(12, 17) + dot(15, 17),
  ),
  szablon: svg(
    '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3" rx="1"/>' +
      '<line x1="8.5" y1="11" x2="15.5" y2="11"/><line x1="8.5" y1="15" x2="13" y2="15"/>',
  ),
  walidacja: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  ostrzezenie: svg('<path d="M12 4 2.6 20h18.8z"/><line x1="12" y1="10" x2="12" y2="14"/>' + dot(12, 17, 1.1)),
  anonimizuj: svg(
    '<path d="M12 3 5 6v5c0 4.6 3 7.6 7 9 4-1.4 7-4.4 7-9V6z"/>' +
      '<rect x="9.3" y="11" width="5.4" height="4.6" rx="1"/><path d="M10.4 11v-1a1.6 1.6 0 0 1 3.2 0v1"/>',
  ),
  ner: svg(
    '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/>' +
      '<path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  ),

  // Znak marki „Parawan" (dwutonowy, stałe barwy) — patrz parawanMark() niżej.
  'parawan-mark': parawanMark(),
};

/**
 * Znak marki „Parawan" — parawan złożony w harmonijkę, widok Z GÓRY (wariant „accordion").
 * Dwutonowy: panele tylne w kolorze głównym marki, panele przednie rozjaśnione (światło na
 * złożeniach), na wierzchu słupki przy każdym zgięciu. To ZNAK MARKI o stałych barwach —
 * świadomie NIE dziedziczy `currentColor`. Własny viewBox skaluje się do kontenera `.gi`.
 * Współrzędne wyliczone z generatora makiety (nPanels=4, x0=30…x1=290, drop=158, opaque).
 */
export function parawanMark(primary = '#0B3D2E', light = '#859E97'): string {
  const pole = (x: number, y1: number): string =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y1 + 176}" stroke="${primary}" stroke-width="14" stroke-linecap="round"/>`;
  return (
    '<svg viewBox="14 48 292 235" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ' +
    'aria-hidden="true" style="display:block;overflow:visible">' +
    // panele od lewej: tył (główny) / przód (jasny) / tył / przód
    `<polygon points="30,74 95,112 95,270 30,232" fill="${primary}"/>` +
    `<polygon points="95,112 160,74 160,232 95,270" fill="${light}"/>` +
    `<polygon points="160,74 225,112 225,270 160,232" fill="${primary}"/>` +
    `<polygon points="225,112 290,74 290,232 225,270" fill="${light}"/>` +
    // górny szew — zygzak złożeń
    `<path d="M30 74 L95 112 L160 74 L225 112 L290 74" fill="none" stroke="${primary}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` +
    // słupki przy każdym złożeniu (na wierzchu)
    pole(30, 56) + pole(95, 94) + pole(160, 56) + pole(225, 94) + pole(290, 56) +
    '</svg>'
  );
}

/** Zwraca inline SVG dla nazwy (pusty string, gdy brak — bezpieczne dla DOM). */
export function icon(name: string): string {
  return ICONS[name] ?? '';
}

/**
 * Podmienia wszystkie `<i class="gi" data-i="NAZWA">` w danym korzeniu na inline SVG.
 * Wywoływane po załadowaniu (main.ts) i po każdym renderze dynamicznych fragmentów.
 */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('i.gi[data-i]').forEach((el) => {
    if (el.dataset.done === '1') return;
    const svgMarkup = ICONS[el.dataset.i ?? ''];
    if (svgMarkup) {
      el.innerHTML = svgMarkup;
      el.dataset.done = '1';
    }
  });
}
