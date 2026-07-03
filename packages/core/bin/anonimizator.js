#!/usr/bin/env node
/**
 * CLI anonimizatora: czyta tekst z plików lub stdin, pisze zredagowany tekst na stdout.
 * Statystyki (co zamaskowano) idą na stderr, żeby nie mieszać ich z wynikiem w potokach.
 *
 *   anonimizator plik.txt                # wynik na stdout
 *   anonimizator plik.txt --out czysty.txt
 *   type dokument.txt | anonimizator     # (Windows) stdin → stdout
 *   cat dokument.txt | anonimizator      # (Linux/macOS)
 *   anonimizator plik.txt --cicho        # bez statystyk na stderr
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { redactPII, describeFindings } from '../dist/index.js';

const HELP = `anonimizator — lokalna redakcja polskich danych osobowych (PII)

Użycie:
  anonimizator [plik...]           zredaguj pliki, wynik na stdout
  anonimizator --out wynik.txt     zapisz wynik do pliku zamiast stdout
  anonimizator --cicho             nie wypisuj statystyk na stderr
  anonimizator --help              ta pomoc

Bez argumentów czyta ze stdin. Nic nie jest wysyłane przez sieć —
cała redakcja odbywa się lokalnie.`;

const args = process.argv.slice(2);
const files = [];
let outPath = null;
let quiet = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') {
    console.log(HELP);
    process.exit(0);
  } else if (a === '--out' || a === '-o') {
    outPath = args[++i];
    if (!outPath) {
      console.error('Błąd: --out wymaga ścieżki pliku.');
      process.exit(2);
    }
  } else if (a === '--cicho' || a === '-q' || a === '--quiet') {
    quiet = true;
  } else if (a.startsWith('-')) {
    console.error(`Nieznana opcja: ${a}\n`);
    console.error(HELP);
    process.exit(2);
  } else {
    files.push(a);
  }
}

let input;
try {
  input = files.length > 0
    ? files.map((f) => readFileSync(f, 'utf8')).join('\n')
    : readFileSync(0, 'utf8'); // stdin
} catch (err) {
  console.error(`Błąd odczytu: ${err.message}`);
  process.exit(1);
}

const { redacted, found } = redactPII(input);

if (outPath) {
  writeFileSync(outPath, redacted, 'utf8');
} else {
  process.stdout.write(redacted);
}

if (!quiet) {
  if (found.length === 0) {
    console.error('Nie wykryto danych osobowych.');
  } else {
    const total = found.reduce((s, f) => s + f.count, 0);
    console.error(`Zamaskowano ${total} wystąpień: ${describeFindings(found).join(', ')}.`);
  }
}
