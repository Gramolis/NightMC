/**
 * Analizator lokalnych modów Minecrafta.
 *
 * Czyta pliki `.jar` z katalogu `minecraft/mods` instancji i wyciąga z nich
 * metadane, żeby wykryć typowe przyczyny niedziałającej paczki: duplikaty,
 * zły loader, brakujące zależności, zadeklarowane konflikty i niezgodne
 * wersje Minecrafta.
 *
 * ZASADY BEZPIECZEŃSTWA (nienegocjowalne):
 *  - JAR jest traktowany WYŁĄCZNIE jako archiwum ZIP; nic z niego nie jest
 *    uruchamiane, ładowane jako kod ani przekazywane do Javy,
 *  - nic nie jest rozpakowywane na dysk - czytamy tylko kilka znanych z nazwy
 *    plików metadanych, prosto do pamięci,
 *  - rozmiar odczytywanych metadanych, liczba wpisów i współczynnik kompresji
 *    mają twarde limity (ochrona przed bombą ZIP),
 *  - nazwy wpisów przechodzą przez `sanitizeEntryName` z `zipsafe.ts`
 *    (Zip Slip, ścieżki absolutne, UNC, znaki sterujące),
 *  - archiwa z dowiązaniami symbolicznymi są odrzucane,
 *  - analiza NICZEGO nie zapisuje, nie zmienia ani nie usuwa,
 *  - awaria jednego pliku nie przerywa analizy pozostałych.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { LIMITS } from '../shared/constants.js';
import { hashFile } from './downloader.js';
import { log } from './logging.js';
import { sanitizeEntryName, UnsafeArchiveError } from './zipsafe.js';
import type {
  LoaderId,
  LocalModMetadata,
  ModAnalysisContext,
  ModAnalysisReport,
  ModDependency,
  ModIssue,
  ModIssueSeverity,
  ModMetadataLoader,
  ModMetadataSource,
  UnreadableModFile,
} from '../shared/types.js';

/* ------------------------------------------------------------------ */
/* Limity analizy                                                      */
/* ------------------------------------------------------------------ */

export const ANALYZER_LIMITS = {
  /** Maksymalny rozmiar pojedynczego pliku metadanych czytanego z JAR-a. */
  maxMetadataBytes: 1024 * 1024,
  /** Maksymalna liczba wpisów w JAR-ze branych pod uwagę. */
  maxEntriesScanned: 40_000,
  /** Powyżej tego rozmiaru plik nie wygląda już na moda. */
  maxJarBytes: 512 * 1024 * 1024,
  /** Maksymalna liczba plików analizowanych w jednym przebiegu. */
  maxFiles: 2000,
  /** Podejrzany współczynnik kompresji pojedynczego wpisu. */
  maxCompressionRatio: LIMITS.maxCompressionRatio,
  /** Maksymalna łączna wielkość wpisów zadeklarowana w archiwum. */
  maxDeclaredBytes: LIMITS.maxExtractBytes,
} as const;

/** Pliki metadanych, których szukamy - w kolejności pierwszeństwa. */
const METADATA_ENTRIES: { entry: string; source: ModMetadataSource; loader: ModMetadataLoader }[] = [
  { entry: 'fabric.mod.json', source: 'fabric.mod.json', loader: 'fabric' },
  { entry: 'quilt.mod.json', source: 'quilt.mod.json', loader: 'quilt' },
  { entry: 'META-INF/neoforge.mods.toml', source: 'META-INF/neoforge.mods.toml', loader: 'neoforge' },
  { entry: 'META-INF/mods.toml', source: 'META-INF/mods.toml', loader: 'forge' },
  { entry: 'mcmod.info', source: 'mcmod.info', loader: 'forge' },
];

/**
 * Identyfikatory, które są dostarczane przez samo środowisko, a nie przez
 * osobny plik moda - nie zgłaszamy ich jako brakujących zależności.
 */
export const IMPLICIT_MOD_IDS = new Set([
  'minecraft',
  'java',
  'forge',
  'neoforge',
  'fabricloader',
  'fabric-loader',
  'quilt_loader',
  'quilt_base',
  'quilted_fabric_api',
  'javafml',
  'lowcodefml',
  'mcp',
]);

/* ================================================================== */
/* 1. Minimalny parser TOML (podzbiór używany przez mods.toml)         */
/* ================================================================== */

type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue | undefined;
}

/**
 * Parser świadomie obsługuje tylko podzbiór TOML występujący w `mods.toml`
 * i `neoforge.mods.toml`: tablice tablic (`[[mods]]`, `[[dependencies.x]]`),
 * zwykłe tablice, napisy (proste, dosłowne i wielolinijkowe), liczby i
 * wartości logiczne. Nie jest to pełna implementacja TOML i nie musi nią być -
 * pełny parser to dodatkowa zależność i dodatkowa powierzchnia ataku.
 */
export function parseTomlSubset(input: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root;

  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  const descend = (root0: TomlTable, keyPath: string[], asArray: boolean): TomlTable => {
    let node: TomlTable = root0;
    for (let k = 0; k < keyPath.length; k++) {
      const key = keyPath[k]!;
      const last = k === keyPath.length - 1;
      let child = node[key];
      if (last && asArray) {
        if (!Array.isArray(child)) {
          child = [];
          node[key] = child as TomlValue;
        }
        const arr = child as TomlValue[];
        const fresh: TomlTable = {};
        arr.push(fresh);
        return fresh;
      }
      if (Array.isArray(child)) {
        // Wchodzimy w ostatni element tablicy tablic.
        const arr = child as TomlValue[];
        const tail = arr[arr.length - 1];
        if (tail && typeof tail === 'object' && !Array.isArray(tail)) {
          node = tail as TomlTable;
          continue;
        }
        child = undefined;
      }
      if (!child || typeof child !== 'object') {
        child = {} as TomlTable;
        node[key] = child as TomlValue;
      }
      node = child as TomlTable;
    }
    return node;
  };

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    i++;
    const line = stripComment(raw).trim();
    if (line === '') continue;

    // Nagłówek tabeli / tablicy tabel
    const arrayHeader = /^\[\[\s*([^\]]+?)\s*\]\]$/.exec(line);
    if (arrayHeader) {
      current = descend(root, splitTomlKey(arrayHeader[1]!), true);
      continue;
    }
    const tableHeader = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (tableHeader) {
      current = descend(root, splitTomlKey(tableHeader[1]!), false);
      continue;
    }

    // Para klucz = wartość
    const eq = indexOfTopLevelEquals(line);
    if (eq < 0) continue;
    const key = unquote(line.slice(0, eq).trim());
    let valueText = line.slice(eq + 1).trim();
    if (key === '') continue;

    // Napis wielolinijkowy
    const multi = /^('''|""")/.exec(valueText);
    if (multi) {
      const fence = multi[1]!;
      const body = valueText.slice(fence.length);
      if (body.endsWith(fence) && body.length >= fence.length) {
        current[key] = body.slice(0, -fence.length);
        continue;
      }
      const parts: string[] = [body];
      while (i < lines.length) {
        const next = lines[i] ?? '';
        i++;
        const end = next.indexOf(fence);
        if (end >= 0) {
          parts.push(next.slice(0, end));
          break;
        }
        parts.push(next);
      }
      current[key] = parts.join('\n').replace(/^\n/, '').trim();
      continue;
    }

    // Tablica jednolinijkowa (dopuszczamy proste przypadki)
    if (valueText.startsWith('[')) {
      while (!isBalanced(valueText) && i < lines.length) {
        valueText += ' ' + stripComment(lines[i] ?? '').trim();
        i++;
      }
      current[key] = parseTomlArray(valueText);
      continue;
    }

    current[key] = parseTomlScalar(valueText);
  }

  return root;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function indexOfTopLevelEquals(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '=' && !inSingle && !inDouble) return i;
  }
  return -1;
}

function splitTomlKey(key: string): string[] {
  return key
    .split('.')
    .map((p) => unquote(p.trim()))
    .filter((p) => p !== '');
}

function unquote(text: string): string {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

function isBalanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return depth <= 0;
}

function parseTomlArray(text: string): TomlValue[] {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  return splitTopLevel(inner, ',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => parseTomlScalar(p));
}

function parseTomlScalar(text: string): TomlValue {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return Number.parseFloat(t);
  const s = unquote(t);
  // Odkodowanie sekwencji ucieczki tylko dla napisów w cudzysłowie prostym.
  if (t.startsWith('"')) {
    return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}

/** Dzieli tekst po separatorze, ignorując separatory w nawiasach i cudzysłowach. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (c === '[' || c === '(' || c === '{') depth++;
      else if (c === ']' || c === ')' || c === '}') depth--;
      else if (c === sep && depth === 0) {
        out.push(text.slice(start, i));
        start = i + 1;
      }
    }
  }
  out.push(text.slice(start));
  return out;
}

/* ================================================================== */
/* 2. Porównywanie wersji i zakresów                                   */
/* ================================================================== */

/** Rozbija wersję na segmenty liczbowe i tekstowe (np. "1.20.1-rc2"). */
function versionParts(version: string): { nums: number[]; pre: string } {
  const cleaned = version.trim().replace(/^[vV]/, '');
  const [core = '', ...rest] = cleaned.split(/[-+]/);
  const nums = core.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return { nums, pre: rest.join('-').toLowerCase() };
}

/** Porównanie wersji: -1, 0, 1. Wersja z sufiksem pre-release jest wcześniejsza. */
export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1;
  if (pb.pre === '') return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** Czy tekst wygląda na wersję, którą umiemy porównać. */
function isComparableVersion(version: string): boolean {
  return /^[vV]?\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/.test(version.trim());
}

/**
 * Sprawdza, czy `version` mieści się w `range`.
 *
 * Obsługiwane zapisy:
 *  - Maven / Forge: `[1.20,1.21)`, `[1.20,)`, `(,1.21]`, `[1.20]`,
 *    kilka przedziałów po przecinku na najwyższym poziomie,
 *  - semver / Fabric: `*`, `>=1.20`, `>1.20 <1.21`, `~1.20.1`, `^1.20.1`, `=1.20`,
 *  - alternatywy rozdzielone `||`.
 *
 * Zwraca `null`, gdy zakresu nie da się jednoznacznie zinterpretować -
 * wtedy NIE zgłaszamy problemu, bo wolimy brak alarmu niż fałszywy alarm.
 */
export function satisfiesRange(version: string, range: string | undefined): boolean | null {
  const r = (range ?? '').trim();
  if (r === '' || r === '*') return true;
  if (!isComparableVersion(version)) return null;

  // Alternatywy: wystarczy jedna spełniona.
  if (r.includes('||')) {
    let anyUnknown = false;
    for (const alt of r.split('||')) {
      const res = satisfiesRange(version, alt);
      if (res === true) return true;
      if (res === null) anyUnknown = true;
    }
    return anyUnknown ? null : false;
  }

  // Zapis Maven: co najmniej jeden przedział w nawiasach.
  if (/^[[(]/.test(r)) {
    const intervals = splitMavenIntervals(r);
    if (intervals.length === 0) return null;
    let anyUnknown = false;
    for (const interval of intervals) {
      const res = matchMavenInterval(version, interval);
      if (res === true) return true;
      if (res === null) anyUnknown = true;
    }
    return anyUnknown ? null : false;
  }

  // Zapis semver: koniunkcja warunków rozdzielonych spacją albo przecinkiem.
  const terms = r.split(/[\s,]+/).filter((t) => t !== '');
  if (terms.length === 0) return null;
  let unknown = false;
  for (const term of terms) {
    const res = matchSemverTerm(version, term);
    if (res === false) return false;
    if (res === null) unknown = true;
  }
  return unknown ? null : true;
}

/** Dzieli `[1.0,2.0),[3.0,)` na osobne przedziały. */
function splitMavenIntervals(range: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < range.length; i++) {
    const c = range[i];
    if (c === '[' || c === '(') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === ']' || c === ')') {
      depth--;
      if (depth === 0) out.push(range.slice(start, i + 1));
    }
  }
  return out;
}

function matchMavenInterval(version: string, interval: string): boolean | null {
  const m = /^([[(])\s*(.*?)\s*([\])])$/.exec(interval.trim());
  if (!m) return null;
  const lowerInclusive = m[1] === '[';
  const upperInclusive = m[3] === ']';
  const body = m[2] ?? '';

  const parts = splitTopLevel(body, ',').map((p) => p.trim());
  // `[1.0]` - dokładnie jedna wersja.
  if (parts.length === 1) {
    const only = parts[0]!;
    if (only === '') return null;
    if (!isComparableVersion(only)) return null;
    return lowerInclusive && upperInclusive ? compareVersions(version, only) === 0 : null;
  }
  if (parts.length !== 2) return null;

  const [lowRaw, highRaw] = parts as [string, string];
  if (lowRaw !== '') {
    if (!isComparableVersion(lowRaw)) return null;
    const c = compareVersions(version, lowRaw);
    if (c < 0 || (c === 0 && !lowerInclusive)) return false;
  }
  if (highRaw !== '') {
    if (!isComparableVersion(highRaw)) return null;
    const c = compareVersions(version, highRaw);
    if (c > 0 || (c === 0 && !upperInclusive)) return false;
  }
  return true;
}

function matchSemverTerm(version: string, term: string): boolean | null {
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(term.trim());
  if (!m) return null;
  const op = m[1] ?? '=';
  const target = (m[2] ?? '').trim();
  if (target === '' || target === '*') return true;
  // "1.20.x" / "1.20.*" - dopasowanie po prefiksie.
  if (/[*xX]/.test(target)) {
    const prefix = target.replace(/[.][*xX].*$/, '');
    if (!isComparableVersion(prefix)) return null;
    return version === prefix || version.startsWith(`${prefix}.`);
  }
  if (!isComparableVersion(target)) return null;

  const cmp = compareVersions(version, target);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '>':
      return cmp > 0;
    case '<=':
      return cmp <= 0;
    case '<':
      return cmp < 0;
    case '=':
      return cmp === 0;
    case '~': {
      // ~1.20.1 -> >=1.20.1 <1.21.0
      if (cmp < 0) return false;
      const t = versionParts(target).nums;
      const upper = [t[0] ?? 0, (t[1] ?? 0) + 1, 0];
      return compareVersions(version, upper.join('.')) < 0;
    }
    case '^': {
      // ^1.20.1 -> >=1.20.1 <2.0.0 (dla 0.x zachowujemy się jak ~)
      if (cmp < 0) return false;
      const t = versionParts(target).nums;
      const upper = (t[0] ?? 0) === 0 ? [0, (t[1] ?? 0) + 1, 0] : [(t[0] ?? 0) + 1, 0, 0];
      return compareVersions(version, upper.join('.')) < 0;
    }
    default:
      return null;
  }
}

/* ================================================================== */
/* 3. Parsery metadanych                                               */
/* ================================================================== */

export interface ParsedModMetadata {
  modId?: string;
  /** Dodatkowe identyfikatory dostarczane przez ten sam JAR. */
  providedModIds: string[];
  name?: string;
  version?: string;
  description?: string;
  authors?: string[];
  loader: ModMetadataLoader;
  dependencies: ModDependency[];
  mcVersionRanges: string[];
  warnings: string[];
}

function emptyParsed(loader: ModMetadataLoader): ParsedModMetadata {
  return { loader, providedModIds: [], dependencies: [], mcVersionRanges: [], warnings: [] };
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') {
      const name = asString((item as Record<string, unknown>)['name']);
      if (name) out.push(name);
    }
  }
  return out;
}

/**
 * `fabric.mod.json` (Fabric Loader v1) oraz `quilt.mod.json`.
 * Dokumentacja: https://fabricmc.net/wiki/documentation:fabric_mod_json
 */
export function parseFabricModJson(text: string, loader: ModMetadataLoader = 'fabric'): ParsedModMetadata {
  const out = emptyParsed(loader);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    out.warnings.push(`Nieprawidłowy JSON metadanych: ${(e as Error).message}`);
    return out;
  }
  if (!json || typeof json !== 'object') {
    out.warnings.push('Metadane nie są obiektem JSON');
    return out;
  }

  // Quilt trzyma dane w zagnieżdżonym obiekcie quilt_loader.
  const quilt = json['quilt_loader'];
  const root: Record<string, unknown> =
    quilt && typeof quilt === 'object' ? (quilt as Record<string, unknown>) : json;

  const meta = root['metadata'];
  const metaObj: Record<string, unknown> =
    meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};

  out.modId = asString(root['id']);
  out.providedModIds = asStringArray(root['provides']).map((id) => id.toLowerCase());
  out.name = asString(root['name']) ?? asString(metaObj['name']) ?? out.modId;
  out.version = asString(root['version']);
  out.description = asString(root['description']) ?? asString(metaObj['description']);
  out.authors = asStringArray(root['authors'] ?? metaObj['contributors']);

  const pushDeps = (value: unknown, kind: ModDependency['kind']): void => {
    if (!value || typeof value !== 'object') return;
    // Format Fabric: { "modid": "wersja" | ["a","b"] }
    if (!Array.isArray(value)) {
      for (const [modId, rangeRaw] of Object.entries(value as Record<string, unknown>)) {
        const ranges = asStringArray(rangeRaw);
        const range = ranges.length > 0 ? ranges.join(' || ') : undefined;
        out.dependencies.push({ modId: modId.toLowerCase(), versionRange: range, kind });
      }
      return;
    }
    // Format Quilt: [{ id, versions, optional }]
    for (const item of value) {
      if (typeof item === 'string') {
        out.dependencies.push({ modId: item.toLowerCase(), kind });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const modId = asString(obj['id']);
      if (!modId) continue;
      const versions = obj['versions'];
      const range =
        typeof versions === 'string'
          ? versions
          : Array.isArray(versions)
            ? asStringArray(versions).join(' || ')
            : undefined;
      out.dependencies.push({
        modId: modId.toLowerCase(),
        versionRange: range,
        kind: obj['optional'] === true ? 'optional' : kind,
      });
    }
  };

  pushDeps(root['depends'], 'required');
  pushDeps(root['recommends'], 'optional');
  pushDeps(root['suggests'], 'optional');
  pushDeps(root['breaks'], 'incompatible');
  pushDeps(root['conflicts'], 'discouraged');

  for (const dep of out.dependencies) {
    if (dep.modId === 'minecraft' && dep.versionRange) out.mcVersionRanges.push(dep.versionRange);
  }

  if (!out.modId) out.warnings.push('Metadane nie zawierają identyfikatora moda');
  return out;
}

/**
 * `META-INF/mods.toml` (Forge) i `META-INF/neoforge.mods.toml` (NeoForge).
 * Dokumentacja: https://docs.minecraftforge.net/en/latest/gettingstarted/modfiles/
 */
export function parseModsToml(text: string, loader: ModMetadataLoader): ParsedModMetadata {
  const out = emptyParsed(loader);
  let toml: TomlTable;
  try {
    toml = parseTomlSubset(text);
  } catch (e) {
    out.warnings.push(`Nie udało się odczytać pliku TOML: ${(e as Error).message}`);
    return out;
  }

  const modsRaw = toml['mods'];
  const mods = Array.isArray(modsRaw) ? (modsRaw as TomlTable[]) : [];
  const first = mods[0];
  if (!first) {
    out.warnings.push('Plik TOML nie zawiera sekcji [[mods]]');
    return out;
  }

  out.modId = asString(first['modId']);
  out.providedModIds = mods
    .slice(1)
    .map((entry) => asString(entry['modId'])?.toLowerCase())
    .filter((id): id is string => Boolean(id));
  out.name = asString(first['displayName']) ?? out.modId;
  out.version = asString(first['version']);
  out.description = asString(first['description']);
  const authors = asString(first['authors']);
  if (authors) out.authors = authors.split(/\s*,\s*/).filter(Boolean);

  // `${file.jarVersion}` jest podstawiane przez loader z manifestu JAR-a.
  if (out.version && /^\$\{.*\}$/.test(out.version)) {
    out.warnings.push('Wersja moda jest podstawiana z manifestu JAR-a i nie jest znana bez uruchomienia loadera');
    out.version = undefined;
  }

  const depsRoot = toml['dependencies'];
  if (depsRoot && typeof depsRoot === 'object' && !Array.isArray(depsRoot)) {
    for (const list of Object.values(depsRoot as TomlTable)) {
      if (!Array.isArray(list)) continue;
      for (const entryRaw of list as TomlValue[]) {
        if (!entryRaw || typeof entryRaw !== 'object' || Array.isArray(entryRaw)) continue;
        const entry = entryRaw as TomlTable;
        const modId = asString(entry['modId']);
        if (!modId) continue;
        const range = asString(entry['versionRange']);
        // Forge <= 1.20.1 używa `mandatory`, NeoForge 1.21+ używa `type`.
        const typeField = asString(entry['type'])?.toLowerCase();
        let kind: ModDependency['kind'];
        if (typeField === 'incompatible') kind = 'incompatible';
        else if (typeField === 'discouraged') kind = 'discouraged';
        else if (typeField === 'optional') kind = 'optional';
        else if (typeField === 'required') kind = 'required';
        else kind = entry['mandatory'] === false ? 'optional' : 'required';

        out.dependencies.push({ modId: modId.toLowerCase(), versionRange: range, kind });
        if (modId.toLowerCase() === 'minecraft' && range) out.mcVersionRanges.push(range);
      }
    }
  }

  if (!out.modId) out.warnings.push('Sekcja [[mods]] nie zawiera modId');
  return out;
}

/**
 * Starsze metadane Forge (`mcmod.info`, Minecraft 1.7-1.12).
 * Format bywa niekompletny, więc czytamy tylko to, co da się rozpoznać bezpiecznie.
 */
export function parseMcmodInfo(text: string): ParsedModMetadata {
  const out = emptyParsed('forge');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    out.warnings.push(`Nieprawidłowy JSON w mcmod.info: ${(e as Error).message}`);
    return out;
  }
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>)['modList'])
      ? ((json as Record<string, unknown>)['modList'] as unknown[])
      : [];
  const first = list[0];
  if (!first || typeof first !== 'object') {
    out.warnings.push('mcmod.info nie zawiera opisu moda');
    return out;
  }
  const obj = first as Record<string, unknown>;
  out.modId = asString(obj['modid']);
  out.name = asString(obj['name']) ?? out.modId;
  out.version = asString(obj['version']);
  out.description = asString(obj['description']);
  out.authors = asStringArray(obj['authorList'] ?? obj['authors']);

  const mcVersion = asString(obj['mcversion']);
  if (mcVersion && mcVersion !== 'extension') out.mcVersionRanges.push(mcVersion);

  for (const modId of asStringArray(obj['requiredMods'])) {
    // Wpisy mają postać "modid@[1.0,)" albo samego identyfikatora.
    const [rawId = '', rawRange] = modId.split('@');
    const id = rawId.trim().toLowerCase();
    if (id) out.dependencies.push({ modId: id, versionRange: rawRange?.trim(), kind: 'required' });
  }
  for (const modId of asStringArray(obj['dependencies'])) {
    const id = (modId.split('@')[0] ?? '').trim().toLowerCase();
    if (id && !out.dependencies.some((d) => d.modId === id)) {
      out.dependencies.push({ modId: id, kind: 'optional' });
    }
  }

  if (!out.modId) out.warnings.push('mcmod.info nie zawiera modid');
  return out;
}

/* ================================================================== */
/* 4. Bezpieczny odczyt pliku JAR                                      */
/* ================================================================== */

export type JarReadResult =
  | { ok: true; source: ModMetadataSource; parsed: ParsedModMetadata }
  | { ok: false; reason: string; suspicious: boolean };

function isSymlinkAttr(attr: number | undefined): boolean {
  const mode = (attr ?? 0) >>> 16;
  return (mode & 0xf000) === 0xa000;
}

/**
 * Otwiera JAR jako zwykłe archiwum ZIP i odczytuje wyłącznie znane z nazwy pliki
 * metadanych. Nic nie jest zapisywane na dysk i nic nie jest wykonywane.
 */
export function readJarMetadata(filePath: string, fileSize: number): JarReadResult {
  if (fileSize > ANALYZER_LIMITS.maxJarBytes) {
    return {
      ok: false,
      suspicious: true,
      reason: `Plik ma ${Math.round(fileSize / 1024 / 1024)} MiB - to za dużo jak na pojedynczego moda.`,
    };
  }
  if (fileSize === 0) {
    return { ok: false, suspicious: false, reason: 'Plik jest pusty.' };
  }

  let zip: AdmZip;
  let entries: AdmZip.IZipEntry[];
  try {
    zip = new AdmZip(filePath);
    entries = zip.getEntries();
  } catch (e) {
    return { ok: false, suspicious: false, reason: `Nie udało się otworzyć archiwum: ${(e as Error).message}` };
  }

  if (entries.length === 0) {
    return { ok: false, suspicious: false, reason: 'Archiwum nie zawiera żadnych wpisów.' };
  }
  if (entries.length > ANALYZER_LIMITS.maxEntriesScanned) {
    return {
      ok: false,
      suspicious: true,
      reason: `Archiwum ma ${entries.length} wpisów - przekroczono limit analizy (${ANALYZER_LIMITS.maxEntriesScanned}).`,
    };
  }

  // Skan bezpieczeństwa CAŁEJ listy wpisów przed odczytaniem czegokolwiek.
  let declaredBytes = 0;
  for (const entry of entries) {
    if (isSymlinkAttr(entry.header.attr)) {
      return { ok: false, suspicious: true, reason: `Archiwum zawiera dowiązanie symboliczne: ${entry.entryName}` };
    }
    try {
      sanitizeEntryName(entry.entryName);
    } catch (e) {
      const message = e instanceof UnsafeArchiveError ? e.message : (e as Error).message;
      return { ok: false, suspicious: true, reason: message };
    }
    const size = Number(entry.header.size ?? 0);
    const compressed = Number(entry.header.compressedSize ?? 0);
    declaredBytes += size;
    if (compressed > 0 && size / compressed > ANALYZER_LIMITS.maxCompressionRatio) {
      return {
        ok: false,
        suspicious: true,
        reason: `Podejrzany współczynnik kompresji (${Math.round(size / compressed)}x) dla "${entry.entryName}" - możliwa bomba ZIP.`,
      };
    }
  }
  if (declaredBytes > ANALYZER_LIMITS.maxDeclaredBytes) {
    return {
      ok: false,
      suspicious: true,
      reason: `Archiwum deklaruje ${Math.round(declaredBytes / 1024 / 1024)} MiB po rozpakowaniu - możliwa bomba ZIP.`,
    };
  }

  // Odczyt wyłącznie znanych plików metadanych, po jednym, prosto do pamięci.
  for (const candidate of METADATA_ENTRIES) {
    const entry = zip.getEntry(candidate.entry);
    if (!entry || entry.isDirectory) continue;
    if (Number(entry.header.size ?? 0) > ANALYZER_LIMITS.maxMetadataBytes) {
      return {
        ok: false,
        suspicious: true,
        reason: `Plik metadanych "${candidate.entry}" przekracza limit ${ANALYZER_LIMITS.maxMetadataBytes} B.`,
      };
    }
    let text: string;
    try {
      text = entry.getData().toString('utf8');
    } catch (e) {
      return { ok: false, suspicious: false, reason: `Nie udało się odczytać "${candidate.entry}": ${(e as Error).message}` };
    }

    let parsed: ParsedModMetadata;
    if (candidate.source === 'fabric.mod.json') parsed = parseFabricModJson(text, 'fabric');
    else if (candidate.source === 'quilt.mod.json') parsed = parseFabricModJson(text, 'quilt');
    else if (candidate.source === 'mcmod.info') parsed = parseMcmodInfo(text);
    else parsed = parseModsToml(text, candidate.loader);

    return { ok: true, source: candidate.source, parsed };
  }

  return { ok: false, suspicious: false, reason: 'Plik nie zawiera rozpoznawalnych metadanych moda.' };
}

/* ================================================================== */
/* 5. Silnik wykrywania problemów (czysta funkcja)                     */
/* ================================================================== */

function issue(
  severity: ModIssueSeverity,
  code: ModIssue['code'],
  fileName: string,
  title: string,
  description: string,
  suggestedAction: string,
  relatedFiles: string[] = [],
): ModIssue {
  return { severity, code, title, description, fileName, relatedFiles, suggestedAction };
}

/** Loader instancji sprowadzony do postaci porównywalnej z metadanymi moda. */
function loaderMatches(instanceLoader: LoaderId, modLoader: ModMetadataLoader): 'ok' | 'warn' | 'bad' {
  if (instanceLoader === 'vanilla') return 'bad';
  if (modLoader === 'unknown') return 'ok';
  if (instanceLoader === 'fabric') return modLoader === 'fabric' ? 'ok' : modLoader === 'quilt' ? 'warn' : 'bad';
  if (instanceLoader === 'forge') return modLoader === 'forge' ? 'ok' : 'bad';
  if (instanceLoader === 'neoforge') {
    if (modLoader === 'neoforge') return 'ok';
    // NeoForge 1.20.1 czytał jeszcze mods.toml Forge, nowsze wersje już nie.
    if (modLoader === 'forge') return 'warn';
    return 'bad';
  }
  return 'ok';
}

const LOADER_LABEL: Record<ModMetadataLoader, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  unknown: 'nieznany loader',
};

/**
 * Analizuje zebrane metadane i zwraca listę problemów.
 * Funkcja jest czysta - nie dotyka dysku ani sieci, więc łatwo ją testować.
 */
export function analyzeMods(
  mods: LocalModMetadata[],
  unreadable: UnreadableModFile[],
  context: ModAnalysisContext,
): ModIssue[] {
  const issues: ModIssue[] = [];

  /* --- pliki, których nie dało się odczytać --- */
  for (const bad of unreadable) {
    if (bad.suspicious) {
      issues.push(
        issue(
          'error',
          'SUSPICIOUS_ARCHIVE',
          bad.fileName,
          'Podejrzane archiwum',
          `${bad.reason} NightMC przerwał analizę tego pliku i niczego z niego nie rozpakował.`,
          'Usuń ten plik z katalogu mods i pobierz moda ponownie z zaufanego źródła (Modrinth albo CurseForge).',
        ),
      );
    } else if (/rozpoznawalnych metadanych/.test(bad.reason)) {
      issues.push(
        issue(
          'warning',
          'NO_METADATA',
          bad.fileName,
          'JAR bez metadanych moda',
          `${bad.reason} To może być biblioteka, plik pomocniczy albo mod dla innej wersji loadera.`,
          'Sprawdź, czy plik faktycznie jest modem. Jeżeli nie wiesz, skąd pochodzi - usuń go.',
        ),
      );
    } else {
      issues.push(
        issue(
          'error',
          'CORRUPTED_JAR',
          bad.fileName,
          'Uszkodzony plik moda',
          `${bad.reason} Uszkodzony JAR najczęściej oznacza przerwane pobieranie.`,
          'Usuń plik i pobierz moda ponownie.',
        ),
      );
    }
  }

  /* --- indeksy pomocnicze --- */
  const enabledMods = mods.filter((m) => m.enabled);
  const byModId = new Map<string, LocalModMetadata[]>();
  for (const mod of mods) {
    const ids = new Set([mod.modId, ...mod.providedModIds].filter((id): id is string => Boolean(id)));
    for (const modId of ids) {
      const list = byModId.get(modId) ?? [];
      list.push(mod);
      byModId.set(modId, list);
    }
  }
  const enabledById = new Map<string, LocalModMetadata>();
  for (const mod of enabledMods) {
    const ids = new Set([mod.modId, ...mod.providedModIds].filter((id): id is string => Boolean(id)));
    for (const modId of ids) {
      if (!enabledById.has(modId)) enabledById.set(modId, mod);
    }
  }

  /* --- duplikaty --- */
  for (const [modId, list] of byModId) {
    if (list.length < 2) continue;
    const active = list.filter((m) => m.enabled);
    // Wyłączone kopie nie kolidują - to typowy sposób przechowywania starej wersji.
    if (active.length < 2) continue;

    const versions = [...new Set(active.map((m) => m.version ?? '?'))];
    const files = active.map((m) => m.fileName);
    if (versions.length > 1) {
      issues.push(
        issue(
          'error',
          'MULTIPLE_VERSIONS',
          files[0]!,
          `Kilka wersji moda "${modId}"`,
          `W katalogu mods są ${active.length} aktywne pliki tego samego moda w wersjach: ${versions.join(', ')}. Loader załaduje tylko jedną z nich albo w ogóle odmówi startu.`,
          'Zostaw wyłącznie najnowszą wersję, a pozostałe usuń albo wyłącz (sufiks .disabled).',
          files.slice(1),
        ),
      );
    } else {
      issues.push(
        issue(
          'error',
          'DUPLICATE_MOD_ID',
          files[0]!,
          `Powtórzony identyfikator moda "${modId}"`,
          `${active.length} aktywne pliki deklarują ten sam identyfikator i tę samą wersję (${versions[0]}). Loader zgłosi konflikt przy starcie.`,
          'Usuń zduplikowane pliki - wystarczy jedna kopia.',
          files.slice(1),
        ),
      );
    }
  }

  /* --- problemy per mod --- */
  for (const mod of mods) {
    if (!mod.enabled) {
      issues.push(
        issue(
          'info',
          'DISABLED_MOD',
          mod.fileName,
          `Mod wyłączony: ${mod.name ?? mod.modId ?? mod.fileName}`,
          'Plik ma sufiks .disabled, więc nie zostanie załadowany przez loader.',
          'Włącz moda, jeśli ma działać. W przeciwnym razie możesz go usunąć.',
        ),
      );
      continue;
    }

    /* loader */
    const verdict = loaderMatches(context.loader, mod.loader);
    if (verdict === 'bad') {
      issues.push(
        issue(
          'error',
          'WRONG_LOADER',
          mod.fileName,
          'Mod dla innego loadera',
          context.loader === 'vanilla'
            ? `Instancja jest w trybie Vanilla, a plik to mod ${LOADER_LABEL[mod.loader]}. Vanilla nie ładuje modów.`
            : `Plik to mod ${LOADER_LABEL[mod.loader]}, a instancja używa loadera ${context.loader}. Gra najprawdopodobniej nie wstanie.`,
          context.loader === 'vanilla'
            ? 'Utwórz instancję z Fabric, Forge albo NeoForge i przenieś tam mody.'
            : `Pobierz wersję moda przeznaczoną dla ${context.loader} albo usuń ten plik.`,
        ),
      );
    } else if (verdict === 'warn') {
      issues.push(
        issue(
          'warning',
          'WRONG_LOADER',
          mod.fileName,
          'Mod z innego, częściowo zgodnego loadera',
          `Plik deklaruje loader ${LOADER_LABEL[mod.loader]}, a instancja używa ${context.loader}. Część takich modów działa, część nie - zależy od wersji.`,
          'Jeżeli gra się nie uruchomi albo mod nie działa, poszukaj wersji dedykowanej dla tego loadera.',
        ),
      );
    }

    /* wersja Minecrafta */
    if (mod.mcVersionRanges.length > 0) {
      let anyTrue = false;
      let anyUnknown = false;
      for (const range of mod.mcVersionRanges) {
        const res = satisfiesRange(context.mcVersion, range);
        if (res === true) anyTrue = true;
        else if (res === null) anyUnknown = true;
      }
      if (!anyTrue && !anyUnknown) {
        issues.push(
          issue(
            'warning',
            'MC_VERSION_MISMATCH',
            mod.fileName,
            'Prawdopodobnie zła wersja Minecrafta',
            `Mod deklaruje zgodność z: ${mod.mcVersionRanges.join(', ')}, a instancja używa Minecraft ${context.mcVersion}.`,
            `Pobierz wersję moda dla Minecraft ${context.mcVersion}.`,
          ),
        );
      }
    }

    /* zależności i konflikty */
    for (const dep of mod.dependencies) {
      if (IMPLICIT_MOD_IDS.has(dep.modId)) continue;

      const present = enabledById.get(dep.modId);
      const disabledCopy = !present ? byModId.get(dep.modId)?.[0] : undefined;

      if (dep.kind === 'incompatible' || dep.kind === 'discouraged') {
        if (!present) continue;
        const severity: ModIssueSeverity = dep.kind === 'incompatible' ? 'error' : 'warning';
        issues.push(
          issue(
            severity,
            'DECLARED_CONFLICT',
            mod.fileName,
            `Zadeklarowany konflikt z "${dep.modId}"`,
            dep.kind === 'incompatible'
              ? `Mod ${mod.name ?? mod.fileName} deklaruje niezgodność z "${dep.modId}" (plik ${present.fileName}).`
              : `Mod ${mod.name ?? mod.fileName} odradza używanie razem z "${dep.modId}" (plik ${present.fileName}).`,
            'Usuń albo wyłącz jednego z tych modów.',
            [present.fileName],
          ),
        );
        continue;
      }

      if (dep.kind === 'embedded') continue;

      if (!present) {
        if (dep.kind === 'optional') {
          issues.push(
            issue(
              'info',
              'OPTIONAL_DEPENDENCY_MISSING',
              mod.fileName,
              `Brak opcjonalnego moda "${dep.modId}"`,
              `${mod.name ?? mod.fileName} może korzystać z "${dep.modId}", ale go nie wymaga.`,
              'Nic nie musisz robić. Instalacja tego moda odblokuje dodatkowe funkcje.',
            ),
          );
          continue;
        }
        issues.push(
          issue(
            'error',
            'MISSING_DEPENDENCY',
            mod.fileName,
            `Brakuje wymaganego moda "${dep.modId}"`,
            disabledCopy
              ? `${mod.name ?? mod.fileName} wymaga "${dep.modId}", a jedyna kopia w katalogu (${disabledCopy.fileName}) jest wyłączona.`
              : `${mod.name ?? mod.fileName} wymaga moda "${dep.modId}"${dep.versionRange ? ` w wersji ${dep.versionRange}` : ''}, którego nie ma w katalogu mods.`,
            disabledCopy
              ? `Włącz plik ${disabledCopy.fileName}.`
              : `Zainstaluj "${dep.modId}" (zakładka Mody) albo usuń moda, który go wymaga.`,
            disabledCopy ? [disabledCopy.fileName] : [],
          ),
        );
        continue;
      }

      // Zależność jest, ale sprawdzamy wersję - tylko gdy da się to ustalić.
      if (dep.versionRange && present.version) {
        const res = satisfiesRange(present.version, dep.versionRange);
        if (res === false) {
          issues.push(
            issue(
              dep.kind === 'optional' ? 'info' : 'warning',
              'DEPENDENCY_VERSION_MISMATCH',
              mod.fileName,
              `Niezgodna wersja zależności "${dep.modId}"`,
              `${mod.name ?? mod.fileName} wymaga "${dep.modId}" w wersji ${dep.versionRange}, a zainstalowana jest ${present.version} (${present.fileName}).`,
              `Zaktualizuj "${dep.modId}" do wersji spełniającej ${dep.versionRange}.`,
              [present.fileName],
            ),
          );
        }
      }
    }
  }

  const rank: Record<ModIssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.fileName.localeCompare(b.fileName, 'pl'));
  return issues;
}

/* ================================================================== */
/* 6. Skan katalogu                                                    */
/* ================================================================== */

/**
 * Analizuje katalog `mods`. Nie modyfikuje żadnego pliku.
 * Błąd pojedynczego JAR-a nie przerywa analizy pozostałych.
 */
export async function analyzeModsDirectory(
  dir: string,
  context: ModAnalysisContext,
  opts: { instanceId?: string } = {},
): Promise<ModAnalysisReport> {
  const mods: LocalModMetadata[] = [];
  const unreadable: UnreadableModFile[] = [];

  let names: string[] = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    names = entries
      .filter((e) => e.isFile() && /\.jar(\.disabled)?$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'pl'));
  } catch (e) {
    // Brak katalogu mods to normalna sytuacja dla świeżej instancji.
    log.info(`Analiza modów: katalog "${dir}" jest niedostępny (${(e as Error).message})`);
  }

  if (names.length > ANALYZER_LIMITS.maxFiles) {
    log.warn(`Analiza modów: ${names.length} plików przekracza limit ${ANALYZER_LIMITS.maxFiles} - analizuję pierwsze ${ANALYZER_LIMITS.maxFiles}`);
    names = names.slice(0, ANALYZER_LIMITS.maxFiles);
  }

  for (const fileName of names) {
    const filePath = path.join(dir, fileName);
    const enabled = !fileName.toLowerCase().endsWith('.disabled');
    let size = 0;
    try {
      size = (await fsp.stat(filePath)).size;
    } catch (e) {
      unreadable.push({ fileName, filePath, size: 0, suspicious: false, reason: `Nie udało się odczytać pliku: ${(e as Error).message}` });
      continue;
    }

    let result: JarReadResult;
    try {
      result = readJarMetadata(filePath, size);
    } catch (e) {
      // Ostatnia linia obrony - żaden wyjątek nie może przerwać całej analizy.
      result = { ok: false, suspicious: false, reason: `Nieoczekiwany błąd odczytu: ${(e as Error).message}` };
    }

    if (!result.ok) {
      unreadable.push({ fileName, filePath, size, suspicious: result.suspicious, reason: result.reason });
      continue;
    }

    let sha1 = '';
    try {
      sha1 = await hashFile(filePath, 'sha1');
    } catch {
      // Suma kontrolna jest informacyjna - jej brak nie unieważnia analizy.
    }

    const p = result.parsed;
    mods.push({
      fileName,
      filePath,
      size,
      sha1,
      enabled,
      modId: p.modId?.toLowerCase(),
      providedModIds: p.providedModIds,
      name: p.name,
      version: p.version,
      description: p.description,
      authors: p.authors,
      loader: p.loader,
      metadataSource: result.source,
      dependencies: p.dependencies,
      mcVersionRanges: p.mcVersionRanges,
      readWarnings: p.warnings,
    });
  }

  const issues = analyzeMods(mods, unreadable, context);

  return {
    instanceId: opts.instanceId,
    loader: context.loader,
    mcVersion: context.mcVersion,
    scannedAt: Date.now(),
    mods,
    unreadable,
    issues,
    summary: {
      total: mods.length + unreadable.length,
      enabled: mods.filter((m) => m.enabled).length,
      disabled: mods.filter((m) => !m.enabled).length,
      withMetadata: mods.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    },
  };
}
