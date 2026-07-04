import { expect, test } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxText } from './docx';

function makeDocx(xmlBody: string): Uint8Array {
  const xml =
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${xmlBody}</w:body></w:document>`;
  return zipSync({
    'word/document.xml': strToU8(xml),
    '[Content_Types].xml': strToU8('<Types/>'),
  });
}

test('akapity rozdzielone nową linią, treść z <w:t> sklejona', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t>Pierwszy </w:t></w:r><w:r><w:t>akapit</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Drugi akapit</w:t></w:r></w:p>',
  );
  expect(extractDocxText(docx)).toBe('Pierwszy akapit\nDrugi akapit');
});

test('<w:br/> i <w:tab/> zamieniane na \\n i \\t', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>b</w:t></w:r>' +
      '<w:r><w:tab/></w:r><w:r><w:t>c</w:t></w:r></w:p>',
  );
  expect(extractDocxText(docx)).toBe('a\nb\tc');
});

test('encje XML dekodowane (w tym numeryczne)', () => {
  const docx = makeDocx('<w:p><w:r><w:t>A &amp; B &lt;x&gt; &#65; &#x42;</w:t></w:r></w:p>');
  expect(extractDocxText(docx)).toBe('A & B <x> A B');
});

test('atrybuty na w:t (xml:space) nie psują ekstrakcji', () => {
  const docx = makeDocx('<w:p><w:r><w:t xml:space="preserve">  ze spacjami  </w:t></w:r></w:p>');
  expect(extractDocxText(docx)).toContain('ze spacjami');
});

test('plik niebędący ZIP-em odrzucony z polskim komunikatem', () => {
  expect(() => extractDocxText(strToU8('to nie zip'))).toThrow(/nie wygląda na poprawny/);
});

test('ZIP bez word/document.xml odrzucony', () => {
  const zip = zipSync({ 'cokolwiek.txt': strToU8('x') });
  expect(() => extractDocxText(zip)).toThrow(/nie jest dokument/);
});

test('tekst z realnym PII przechodzi w całości (do dalszej redakcji)', () => {
  const docx = makeDocx('<w:p><w:r><w:t>PESEL 44051401359, Jan Kowalski</w:t></w:r></w:p>');
  const text = extractDocxText(docx);
  expect(text).toContain('44051401359');
  expect(text).toContain('Jan Kowalski');
});
