/**
 * Poprawa typografii landingu: wstawia twardą spację (U+00A0) po polskich
 * jednoliterowych spójnikach/przyimkach (a i o u w z) w WIDOCZNEJ treści
 * apps/landing/index.html. Pomija tagi, atrybuty, <script> i <style>.
 *
 * Zapobiega „wiszącym" spójnikom na końcu wiersza (polska norma typograficzna).
 * Idempotentny — po spójniku z twardą spacją nic już nie zmienia.
 * Uruchamiaj po każdej edycji treści landingu:  node scripts/typografia/nbsp.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = path.join(root, 'apps', 'landing', 'index.html');
const NBSP = ' ';

let html = await readFile(file, 'utf8');
const parts = html.split(/(<[^>]+>)/);
let inSkip = false;
let touched = 0;

const fixText = (t) => {
  let prev;
  do {
    prev = t;
    // jednoliterowy spójnik po granicy słowa, po nim ZWYKŁA spacja + niepusty znak → twarda spacja
    t = t.replace(/(^|[\s(„»–—-])([aiouwzAIOUWZ]) (?=\S)/g, (_m, pre, w) => `${pre}${w}${NBSP}`);
  } while (t !== prev); // powtórz, by złapać sąsiadujące spójniki („a i", „i z")
  return t;
};

const out = parts.map((tok) => {
  if (tok.startsWith('<')) {
    if (/^<\s*(script|style)\b/i.test(tok)) inSkip = true;
    else if (/^<\s*\/\s*(script|style)\s*>/i.test(tok)) inSkip = false;
    return tok;
  }
  if (inSkip || !tok) return tok;
  const after = fixText(tok);
  if (after !== tok) touched++;
  return after;
});

await writeFile(file, out.join(''), 'utf8');
console.log(`nbsp: poprawiono ${touched} segmentów treści w apps/landing/index.html`);
