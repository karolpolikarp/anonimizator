/**
 * Buduje minimalny, POPRAWNY plik PDF z jedną warstwą tekstową. Dane są czysto ASCII, więc
 * offsety bajtowe w tabeli xref są równe długościom stringów (bez liczenia bajtów UTF-8).
 *
 * Jedno źródło współdzielone przez DWA miejsca:
 *  - test ekstrakcji tekstu (`pdf.test.ts`),
 *  - samodiagnostykę ścieżki PDF w buildzie single-file (`main.ts`, parametr `?pdftest`).
 * Dzięki temu generator PDF-a nie żyje w dwóch niezależnych kopiach.
 */
export function buildMinimalPdf(text: string): Uint8Array {
  const header = '%PDF-1.4\n';
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ];
  let offset = header.length;
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(offset);
    offset += o.length;
  }
  const pad = (n: number): string => String(n).padStart(10, '0');
  const xref =
    'xref\n0 6\n0000000000 65535 f \n' + offsets.map((o) => `${pad(o)} 00000 n \n`).join('');
  const trailer = `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${offset}\n%%EOF`;
  return new TextEncoder().encode(header + objects.join('') + xref + trailer);
}
