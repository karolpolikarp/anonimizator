/**
 * Ekstrakcja tekstu z PDF — w całości lokalnie (pdf.js, legacy build).
 *
 * Build single-file nie może dołączyć osobnego pliku workera, więc moduł workera
 * importujemy NA GŁÓWNYM WĄTKU i podstawiamy jako `globalThis.pdfjsWorker` —
 * pdf.js wykrywa go i używa „fake workera" (oficjalna ścieżka awaryjna).
 * Dla naszego zastosowania (jeden dokument, sama warstwa tekstu) to w zupełności
 * wystarcza. Legacy build działa też w Node, więc ten moduł jest testowalny w vitest.
 */

import { getDocument, InvalidPDFException, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/** Wyciągnij warstwę tekstową z PDF-a. Rzuca Error z polskim komunikatem. */
export async function extractPdfText(buf: Uint8Array): Promise<string> {
  const task = getDocument({
    data: buf,
    disableFontFace: true,
    useSystemFonts: true,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err instanceof PasswordException) {
      throw new Error('Ten PDF jest zaszyfrowany hasłem — zdejmij hasło i spróbuj ponownie.');
    }
    if (err instanceof InvalidPDFException) {
      throw new Error('Nie udało się odczytać pliku — to nie wygląda na poprawny PDF.');
    }
    throw new Error('Nie udało się odczytać PDF-a.');
  }

  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const parts: string[] = [];
      for (const item of tc.items) {
        if ('str' in item) {
          parts.push(item.str);
          parts.push(item.hasEOL ? '\n' : ' ');
        }
      }
      pages.push(parts.join('').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim());
    }
    const text = pages.filter(Boolean).join('\n\n').trim();
    if (!text) {
      throw new Error(
        'Ten PDF nie zawiera warstwy tekstowej — to prawdopodobnie skan. ' +
          'OCR nie jest wspierany; wklej tekst ręcznie.',
      );
    }
    return text;
  } finally {
    // destroy żyje na loading tasku (w v6 dokument nie ma własnego destroy)
    void task.destroy();
  }
}
