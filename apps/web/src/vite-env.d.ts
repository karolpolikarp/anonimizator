/// <reference types="vite/client" />

// TS 6.0 (TS2882) wymaga deklaracji dla side-effect importów zasobów;
// vite/client pokrywa *.css, deklaracja niżej jest jawnym fallbackiem.
declare module '*.css';
