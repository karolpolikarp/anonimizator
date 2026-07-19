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
  // ── Osoby / kontakt / finanse ──
  'dane-osobowe': svg('<circle cx="12" cy="8" r="3.5"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>'),
  login: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
  iban: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/>'),

  // ── Narzędzia / stany ──
  onoff: svg('<path d="M12 3v8.5"/><path d="M6.8 7.2a8 8 0 1 0 10.4 0"/>'),
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
  // plik HTML — dokument z symbolem kodu </>, dla Parawan.html
  'plik-html': svg(
    '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>' +
      '<path d="m10.3 12.4-2.1 2.1 2.1 2.1"/><path d="m13.7 12.4 2.1 2.1-2.1 2.1"/>',
  ),
  wyczysc: svg('<path d="m15.5 5 3.5 3.5a2 2 0 0 1 0 2.8L12 18.3H7l-2.5-2.5a2 2 0 0 1 0-2.8L12.7 5a2 2 0 0 1 2.8 0z"/><line x1="9" y1="10" x2="14" y2="15"/><line x1="7" y1="21" x2="20" y2="21"/>'),
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
