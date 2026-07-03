/**
 * Ekstrakcja tekstu z pliku .docx — w całości lokalnie, bez ciężkich zależności.
 *
 * DOCX to ZIP z XML-em w środku; treść dokumentu żyje w `word/document.xml`,
 * a widoczny tekst — w elementach `<w:t>`. Rozpakowujemy maleńkim `fflate`
 * i zbieramy tekst runów, wstawiając \n za końce akapitów (`</w:p>`) i `<w:br/>`
 * oraz \t za `<w:tab/>`. To świadomie NIE jest pełny konwerter (tabele/format
 * spłaszczają się do tekstu) — do anonimizacji liczy się treść, nie układ.
 */

import { unzipSync, strFromU8 } from 'fflate';

const XML_ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#x?[0-9A-Fa-f]+);/g, (m, ent: string) => {
    if (ent[0] !== '#') return XML_ENTITY[ent] ?? m;
    const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/** Wyciągnij czysty tekst z zawartości pliku .docx. Rzuca Error dla nie-docx. */
export function extractDocxText(buf: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf);
  } catch {
    throw new Error('Nie udało się odczytać pliku — to nie wygląda na poprawny .docx.');
  }
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('Brak word/document.xml — to nie jest dokument Word (.docx).');

  const xml = strFromU8(doc);
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) parts.push(decodeXmlEntities(m[1]));
    else if (m[0].startsWith('<w:tab')) parts.push('\t');
    else parts.push('\n'); // </w:p> lub <w:br/>
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}
