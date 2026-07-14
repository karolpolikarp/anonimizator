import { expect, test } from 'vitest';
import { extractPdfText } from './pdf';
import { buildMinimalPdf } from './pdf-fixture';

test('wyciąga tekst z poprawnego PDF-a', async () => {
  const pdf = buildMinimalPdf('PESEL 44051401359, Jan Kowalski');
  const text = await extractPdfText(pdf);
  expect(text).toContain('PESEL 44051401359');
  expect(text).toContain('Jan Kowalski');
});

test('plik niebędący PDF-em odrzucony z polskim komunikatem', async () => {
  await expect(extractPdfText(new TextEncoder().encode('to nie pdf'))).rejects.toThrow(
    /nie wygląda na poprawny PDF/,
  );
});

test('PDF bez warstwy tekstowej (pusta strona) → komunikat o skanie', async () => {
  const pdf = buildMinimalPdf('');
  await expect(extractPdfText(pdf)).rejects.toThrow(/warstwy tekstowej/);
});
