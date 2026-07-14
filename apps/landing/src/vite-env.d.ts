/// <reference types="vite/client" />

// TS 7 (TS2882) wymaga deklaracji dla side-effect importów zasobów;
// vite/client pokrywa *.css, deklaracja niżej jest jawnym fallbackiem.
declare module '*.css';

/** Wersja aplikacji wstrzykiwana przy buildzie (vite define, z package.json). */
declare const __APP_VERSION__: string;
