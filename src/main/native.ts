/**
 * Ładowanie modułów natywnych i wbudowanych niezależnie od formatu modułów.
 *
 * Proces główny jest budowany do CommonJS (esbuild), więc dostępne jest `require`.
 * Testy Vitest uruchamiają te same pliki jako ESM, gdzie `require` nie istnieje -
 * wtedy budujemy je przez `createRequire`.
 */

import { createRequire } from 'node:module';

const fallbackRequire = createRequire(`${process.cwd()}/`);

/** Wczytuje moduł; zwraca `null`, gdy jest niedostępny. */
export function optionalRequire<T = unknown>(name: string): T | null {
  try {
    const req = typeof require === 'function' ? require : fallbackRequire;
    return req(name) as T;
  } catch {
    return null;
  }
}

/** Wczytuje moduł; rzuca czytelny błąd, gdy go nie ma. */
export function requireOrThrow<T = unknown>(name: string): T {
  const mod = optionalRequire<T>(name);
  if (!mod) throw new Error(`Moduł "${name}" jest niedostępny w tym środowisku`);
  return mod;
}
