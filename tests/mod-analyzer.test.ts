import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  ANALYZER_LIMITS,
  analyzeMods,
  analyzeModsDirectory,
  compareVersions,
  parseFabricModJson,
  parseMcmodInfo,
  parseModsToml,
  parseTomlSubset,
  readJarMetadata,
  satisfiesRange,
} from '../src/main/mod-analyzer.js';
import type { LocalModMetadata, ModAnalysisContext, ModIssueCode } from '../src/shared/types.js';

let tmp = '';
let modsDir = '';

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'nightmc-mods-'));
  modsDir = path.join(tmp, 'mods');
  await fsp.mkdir(modsDir, { recursive: true });
});
afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Pomocnicze budowanie JAR-ów                                         */
/* ------------------------------------------------------------------ */

async function writeJar(
  fileName: string,
  entries: { name: string; data: string | Buffer; attr?: number }[],
): Promise<string> {
  const zip = new AdmZip();
  for (const e of entries) {
    const entry = zip.addFile(e.name, Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8'));
    // addFile traktuje liczbę jak same uprawnienia i zawsze wymusza zwykły plik.
    // W testach bezpieczeństwa potrzebujemy zapisać surowe atrybuty centralnego nagłówka ZIP.
    if (e.attr !== undefined) entry.header.attr = e.attr >>> 0;
  }
  const file = path.join(modsDir, fileName);
  await fsp.writeFile(file, zip.toBuffer());
  return file;
}

function fabricJson(opts: {
  id: string;
  version: string;
  name?: string;
  depends?: Record<string, string>;
  breaks?: Record<string, string>;
  suggests?: Record<string, string>;
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    id: opts.id,
    version: opts.version,
    name: opts.name ?? opts.id,
    description: 'Testowy mod',
    authors: ['NightMC'],
    depends: opts.depends ?? { minecraft: '>=1.20.1', fabricloader: '>=0.15.0' },
    breaks: opts.breaks,
    suggests: opts.suggests,
  });
}

function modsToml(opts: { id: string; version: string; deps?: string; name?: string }): string {
  return [
    'modLoader="javafml"',
    'loaderVersion="[47,)"',
    'license="MIT"',
    '',
    '[[mods]]',
    `modId="${opts.id}"`,
    `version="${opts.version}"`,
    `displayName="${opts.name ?? opts.id}"`,
    'authors="NightMC"',
    "description='''",
    'Testowy mod Forge.',
    "'''",
    opts.deps ?? '',
  ].join('\n');
}

const CTX: ModAnalysisContext = { loader: 'fabric', mcVersion: '1.20.1' };

function codes(issues: { code: ModIssueCode }[]): ModIssueCode[] {
  return issues.map((i) => i.code);
}

/* ================================================================== */
/* Parser TOML                                                         */
/* ================================================================== */

describe('parseTomlSubset', () => {
  it('czyta tablice tabel, napisy wielolinijkowe i wartości logiczne', () => {
    const toml = parseTomlSubset(
      [
        '# komentarz',
        'modLoader = "javafml"',
        '[[mods]]',
        'modId="alpha"',
        'version="1.2.3"',
        "description='''",
        'Linia 1',
        'Linia 2',
        "'''",
        '[[dependencies.alpha]]',
        'modId="minecraft"',
        'mandatory=true',
        'versionRange="[1.20.1,1.21)"',
        '[[dependencies.alpha]]',
        'modId="jei"',
        'mandatory=false',
      ].join('\n'),
    );
    expect(toml['modLoader']).toBe('javafml');
    const mods = toml['mods'] as any[];
    expect(mods).toHaveLength(1);
    expect(mods[0].modId).toBe('alpha');
    expect(String(mods[0].description)).toContain('Linia 2');
    const deps = (toml['dependencies'] as any).alpha as any[];
    expect(deps).toHaveLength(2);
    expect(deps[0].mandatory).toBe(true);
    expect(deps[1].mandatory).toBe(false);
  });

  it('ignoruje znak # wewnątrz napisu', () => {
    const toml = parseTomlSubset('displayName="Mod # jeden" # prawdziwy komentarz');
    expect(toml['displayName']).toBe('Mod # jeden');
  });
});

/* ================================================================== */
/* Zakresy wersji                                                      */
/* ================================================================== */

describe('compareVersions / satisfiesRange', () => {
  it('porównuje wersje numerycznie, a pre-release traktuje jako wcześniejsze', () => {
    expect(compareVersions('1.20.1', '1.20.2')).toBe(-1);
    expect(compareVersions('1.21', '1.20.9')).toBe(1);
    expect(compareVersions('1.20.1', '1.20.1')).toBe(0);
    expect(compareVersions('1.20.1-rc1', '1.20.1')).toBe(-1);
  });

  it('obsługuje przedziały Maven używane przez Forge i NeoForge', () => {
    expect(satisfiesRange('1.20.1', '[1.20.1,1.21)')).toBe(true);
    expect(satisfiesRange('1.21', '[1.20.1,1.21)')).toBe(false);
    expect(satisfiesRange('1.21', '[1.20.1,1.21]')).toBe(true);
    expect(satisfiesRange('1.19.4', '[1.20,)')).toBe(false);
    expect(satisfiesRange('1.20.1', '[1.20.1]')).toBe(true);
    expect(satisfiesRange('1.16.5', '[1.18,1.19),[1.20,1.21)')).toBe(false);
    expect(satisfiesRange('1.20.4', '[1.18,1.19),[1.20,1.21)')).toBe(true);
  });

  it('obsługuje zapis semver używany przez Fabric', () => {
    expect(satisfiesRange('1.20.1', '>=1.20')).toBe(true);
    expect(satisfiesRange('1.19.2', '>=1.20')).toBe(false);
    expect(satisfiesRange('1.20.1', '>=1.20 <1.21')).toBe(true);
    expect(satisfiesRange('1.20.1', '~1.20.0')).toBe(true);
    expect(satisfiesRange('1.21.0', '~1.20.0')).toBe(false);
    expect(satisfiesRange('1.20.1', '1.19.x || 1.20.x')).toBe(true);
    expect(satisfiesRange('1.20.1', '*')).toBe(true);
    expect(satisfiesRange('1.20.1', undefined)).toBe(true);
  });

  it('zwraca null gdy zakresu nie da się zinterpretować', () => {
    expect(satisfiesRange('1.20.1', 'jakis-dziwny-zapis')).toBeNull();
    expect(satisfiesRange('nieznana', '[1.20,)')).toBeNull();
  });
});

/* ================================================================== */
/* Parsery metadanych                                                  */
/* ================================================================== */

describe('parsery metadanych', () => {
  it('czyta fabric.mod.json wraz z zależnościami i konfliktami', () => {
    const p = parseFabricModJson(
      fabricJson({
        id: 'alpha',
        version: '1.0.0',
        name: 'Alpha',
        depends: { minecraft: '1.20.1', fabric: '>=0.90.0' },
        breaks: { beta: '*' },
      }),
    );
    expect(p.modId).toBe('alpha');
    expect(p.version).toBe('1.0.0');
    expect(p.loader).toBe('fabric');
    expect(p.mcVersionRanges).toEqual(['1.20.1']);
    expect(p.dependencies.find((d) => d.modId === 'fabric')?.kind).toBe('required');
    expect(p.dependencies.find((d) => d.modId === 'beta')?.kind).toBe('incompatible');
  });

  it('czyta mods.toml Forge z mandatory=false jako zależność opcjonalną', () => {
    const p = parseModsToml(
      modsToml({
        id: 'gamma',
        version: '2.0.0',
        deps: [
          '[[dependencies.gamma]]',
          'modId="minecraft"',
          'mandatory=true',
          'versionRange="[1.20.1,1.21)"',
          '[[dependencies.gamma]]',
          'modId="jei"',
          'mandatory=false',
          'versionRange="[15,)"',
        ].join('\n'),
      }),
      'forge',
    );
    expect(p.modId).toBe('gamma');
    expect(p.version).toBe('2.0.0');
    expect(p.mcVersionRanges).toEqual(['[1.20.1,1.21)']);
    expect(p.dependencies.find((d) => d.modId === 'jei')?.kind).toBe('optional');
  });

  it('czyta neoforge.mods.toml z polem type', () => {
    const p = parseModsToml(
      [
        '[[mods]]',
        'modId="delta"',
        'version="3.1.0"',
        'displayName="Delta"',
        '[[dependencies.delta]]',
        'modId="minecraft"',
        'type="required"',
        'versionRange="[1.21,1.22)"',
        '[[dependencies.delta]]',
        'modId="omega"',
        'type="incompatible"',
      ].join('\n'),
      'neoforge',
    );
    expect(p.modId).toBe('delta');
    expect(p.loader).toBe('neoforge');
    expect(p.dependencies.find((d) => d.modId === 'omega')?.kind).toBe('incompatible');
  });

  it('rozpoznaje dodatkowe identyfikatory z wielomodu Forge', () => {
    const p = parseModsToml(
      [
        '[[mods]]',
        'modId="rdzen"',
        'version="1.0.0"',
        '[[mods]]',
        'modId="dodatek"',
        'version="1.0.0"',
      ].join('\n'),
      'forge',
    );
    expect(p.modId).toBe('rdzen');
    expect(p.providedModIds).toEqual(['dodatek']);
  });

  it('nie zgaduje wersji podstawianej z manifestu JAR-a', () => {
    const p = parseModsToml('[[mods]]\nmodId="eps"\nversion="${file.jarVersion}"', 'forge');
    expect(p.version).toBeUndefined();
    expect(p.warnings.join(' ')).toContain('manifestu');
  });

  it('czyta starsze mcmod.info', () => {
    const p = parseMcmodInfo(
      JSON.stringify([
        { modid: 'stary', name: 'Stary Mod', version: '1.0', mcversion: '1.12.2', requiredMods: ['forge@[14,)'] },
      ]),
    );
    expect(p.modId).toBe('stary');
    expect(p.mcVersionRanges).toEqual(['1.12.2']);
    expect(p.dependencies[0]?.modId).toBe('forge');
  });

  it('nie wywraca się na uszkodzonym JSON-ie', () => {
    const p = parseFabricModJson('{ to nie jest json');
    expect(p.modId).toBeUndefined();
    expect(p.warnings.length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/* Odczyt JAR-ów                                                       */
/* ================================================================== */

describe('readJarMetadata', () => {
  it('rozpoznaje poprawny mod Fabric', async () => {
    const file = await writeJar('alpha.jar', [
      { name: 'fabric.mod.json', data: fabricJson({ id: 'alpha', version: '1.0.0' }) },
      { name: 'alpha/Main.class', data: 'binarny-udawany-kod' },
    ]);
    const size = (await fsp.stat(file)).size;
    const res = readJarMetadata(file, size);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.source).toBe('fabric.mod.json');
      expect(res.parsed.modId).toBe('alpha');
    }
  });

  it('rozpoznaje poprawny mod Forge', async () => {
    const file = await writeJar('gamma.jar', [
      { name: 'META-INF/mods.toml', data: modsToml({ id: 'gamma', version: '2.0.0' }) },
    ]);
    const res = readJarMetadata(file, (await fsp.stat(file)).size);
    expect(res.ok && res.source).toBe('META-INF/mods.toml');
  });

  it('rozpoznaje poprawny mod NeoForge i daje mu pierwszeństwo przed mods.toml', async () => {
    const file = await writeJar('delta.jar', [
      { name: 'META-INF/mods.toml', data: modsToml({ id: 'delta', version: '3.1.0' }) },
      { name: 'META-INF/neoforge.mods.toml', data: '[[mods]]\nmodId="delta"\nversion="3.1.0"' },
    ]);
    const res = readJarMetadata(file, (await fsp.stat(file)).size);
    expect(res.ok && res.source).toBe('META-INF/neoforge.mods.toml');
  });

  it('zgłasza uszkodzony JAR bez oznaczania go jako podejrzany', async () => {
    const file = path.join(modsDir, 'zepsuty.jar');
    await fsp.writeFile(file, Buffer.from('PK to nie jest prawidlowe archiwum'));
    const res = readJarMetadata(file, (await fsp.stat(file)).size);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.suspicious).toBe(false);
  });

  it('zgłasza JAR bez rozpoznawalnych metadanych', async () => {
    const file = await writeJar('biblioteka.jar', [{ name: 'com/example/Util.class', data: 'x' }]);
    const res = readJarMetadata(file, (await fsp.stat(file)).size);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.suspicious).toBe(false);
      expect(res.reason).toContain('rozpoznawalnych metadanych');
    }
  });

  it('odrzuca archiwum z dowiązaniem symbolicznym', async () => {
    // 0xA1FF0000 = S_IFLNK w górnych 16 bitach atrybutów zewnętrznych.
    const file = await writeJar('symlink.jar', [
      { name: 'fabric.mod.json', data: fabricJson({ id: 'zly', version: '1.0.0' }) },
      { name: 'link', data: '/etc/passwd', attr: 0xa1ff0000 },
    ]);
    const res = readJarMetadata(file, (await fsp.stat(file)).size);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.suspicious).toBe(true);
  });

  it('odrzuca archiwum o podejrzanym współczynniku kompresji (bomba ZIP)', async () => {
    // Realny, bardzo dobrze kompresujący się wpis - nie podrabiamy nagłówków.
    const huge = Buffer.alloc(4 * 1024 * 1024, 0);
    const ratio = huge.length / zlib.deflateRawSync(huge).length;
    expect(ratio).toBeGreaterThan(ANALYZER_LIMITS.maxCompressionRatio);

    const file = await writeJar('bomba.jar', [
      { name: 'fabric.mod.json', data: fabricJson({ id: 'bomba', version: '1.0.0' }) },
      { name: 'payload.bin', data: huge },
    ]);
    const res = readJarMetadata(file, (await fsp.stat(file)).size);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.suspicious).toBe(true);
      expect(res.reason).toContain('kompresji');
    }
  });

  it('odrzuca pusty plik', async () => {
    const file = path.join(modsDir, 'pusty.jar');
    await fsp.writeFile(file, Buffer.alloc(0));
    const res = readJarMetadata(file, 0);
    expect(res.ok).toBe(false);
  });
});

/* ================================================================== */
/* Silnik problemów                                                    */
/* ================================================================== */

function mod(over: Partial<LocalModMetadata> & { fileName: string }): LocalModMetadata {
  return {
    filePath: path.join('/tmp/mods', over.fileName),
    size: 1024,
    sha1: '0'.repeat(40),
    enabled: true,
    loader: 'fabric',
    metadataSource: 'fabric.mod.json',
    providedModIds: [],
    dependencies: [],
    mcVersionRanges: [],
    readWarnings: [],
    ...over,
  };
}

describe('analyzeMods', () => {
  it('nie zgłasza problemów dla poprawnego zestawu', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'alpha.jar', modId: 'alpha', version: '1.0.0', mcVersionRanges: ['>=1.20'] }),
        mod({ fileName: 'fabric-api.jar', modId: 'fabric', version: '0.92.0' }),
      ],
      [],
      CTX,
    );
    expect(issues).toEqual([]);
  });

  it('wykrywa dwa pliki tego samego moda w różnych wersjach', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'alpha-1.0.0.jar', modId: 'alpha', version: '1.0.0' }),
        mod({ fileName: 'alpha-1.1.0.jar', modId: 'alpha', version: '1.1.0' }),
      ],
      [],
      CTX,
    );
    expect(codes(issues)).toContain('MULTIPLE_VERSIONS');
    const found = issues.find((i) => i.code === 'MULTIPLE_VERSIONS')!;
    expect(found.severity).toBe('error');
    expect(found.relatedFiles).toContain('alpha-1.1.0.jar');
  });

  it('wykrywa powtórzony identyfikator w tej samej wersji', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'alpha.jar', modId: 'alpha', version: '1.0.0' }),
        mod({ fileName: 'alpha-kopia.jar', modId: 'alpha', version: '1.0.0' }),
      ],
      [],
      CTX,
    );
    expect(codes(issues)).toContain('DUPLICATE_MOD_ID');
  });

  it('nie zgłasza duplikatu, gdy jedna kopia jest wyłączona', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'alpha-1.1.0.jar', modId: 'alpha', version: '1.1.0' }),
        mod({ fileName: 'alpha-1.0.0.jar.disabled', modId: 'alpha', version: '1.0.0', enabled: false }),
      ],
      [],
      CTX,
    );
    expect(codes(issues)).not.toContain('MULTIPLE_VERSIONS');
    expect(codes(issues)).toContain('DISABLED_MOD');
  });

  it('wykrywa brakującą wymaganą zależność', () => {
    const issues = analyzeMods(
      [
        mod({
          fileName: 'alpha.jar',
          modId: 'alpha',
          version: '1.0.0',
          dependencies: [{ modId: 'fabric', kind: 'required' }],
        }),
      ],
      [],
      CTX,
    );
    const found = issues.find((i) => i.code === 'MISSING_DEPENDENCY')!;
    expect(found.severity).toBe('error');
    expect(found.description).toContain('fabric');
  });

  it('uznaje dodatkowy identyfikator dostarczany przez ten sam JAR za obecną zależność', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'wielomod.jar', modId: 'rdzen', providedModIds: ['dodatek'] }),
        mod({ fileName: 'klient.jar', modId: 'klient', dependencies: [{ modId: 'dodatek', kind: 'required' }] }),
      ],
      [],
      CTX,
    );
    expect(codes(issues)).not.toContain('MISSING_DEPENDENCY');
  });

  it('podpowiada włączenie moda, gdy zależność istnieje ale jest wyłączona', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'alpha.jar', modId: 'alpha', dependencies: [{ modId: 'fabric', kind: 'required' }] }),
        mod({ fileName: 'fabric-api.jar.disabled', modId: 'fabric', version: '0.92.0', enabled: false }),
      ],
      [],
      CTX,
    );
    const found = issues.find((i) => i.code === 'MISSING_DEPENDENCY')!;
    expect(found.suggestedAction).toContain('fabric-api.jar.disabled');
  });

  it('nie zgłasza braku zależności dostarczanych przez środowisko', () => {
    const issues = analyzeMods(
      [
        mod({
          fileName: 'alpha.jar',
          modId: 'alpha',
          dependencies: [
            { modId: 'minecraft', kind: 'required' },
            { modId: 'fabricloader', kind: 'required' },
            { modId: 'java', kind: 'required' },
          ],
        }),
      ],
      [],
      CTX,
    );
    expect(codes(issues)).not.toContain('MISSING_DEPENDENCY');
  });

  it('wykrywa niezgodną wersję zależności, gdy format na to pozwala', () => {
    const issues = analyzeMods(
      [
        mod({
          fileName: 'alpha.jar',
          modId: 'alpha',
          dependencies: [{ modId: 'fabric', kind: 'required', versionRange: '>=0.95.0' }],
        }),
        mod({ fileName: 'fabric-api.jar', modId: 'fabric', version: '0.90.0' }),
      ],
      [],
      CTX,
    );
    expect(codes(issues)).toContain('DEPENDENCY_VERSION_MISMATCH');
  });

  it('nie zgłasza niezgodnej wersji, gdy zakresu nie da się ocenić', () => {
    const issues = analyzeMods(
      [
        mod({
          fileName: 'alpha.jar',
          modId: 'alpha',
          dependencies: [{ modId: 'fabric', kind: 'required', versionRange: 'dziwny-zapis' }],
        }),
        mod({ fileName: 'fabric-api.jar', modId: 'fabric', version: '0.90.0' }),
      ],
      [],
      CTX,
    );
    expect(codes(issues)).not.toContain('DEPENDENCY_VERSION_MISMATCH');
  });

  it('wykrywa zadeklarowany konflikt', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'alpha.jar', modId: 'alpha', dependencies: [{ modId: 'beta', kind: 'incompatible' }] }),
        mod({ fileName: 'beta.jar', modId: 'beta', version: '1.0.0' }),
      ],
      [],
      CTX,
    );
    const found = issues.find((i) => i.code === 'DECLARED_CONFLICT')!;
    expect(found.severity).toBe('error');
    expect(found.relatedFiles).toEqual(['beta.jar']);
  });

  it('wykrywa mod dla niewłaściwego loadera', () => {
    const issues = analyzeMods(
      [mod({ fileName: 'forgowy.jar', modId: 'gamma', loader: 'forge', metadataSource: 'META-INF/mods.toml' })],
      [],
      CTX,
    );
    const found = issues.find((i) => i.code === 'WRONG_LOADER')!;
    expect(found.severity).toBe('error');
  });

  it('traktuje mod Forge w instancji NeoForge jako ostrzeżenie, nie błąd', () => {
    const issues = analyzeMods(
      [mod({ fileName: 'gamma.jar', modId: 'gamma', loader: 'forge', metadataSource: 'META-INF/mods.toml' })],
      [],
      { loader: 'neoforge', mcVersion: '1.20.1' },
    );
    expect(issues.find((i) => i.code === 'WRONG_LOADER')?.severity).toBe('warning');
  });

  it('zgłasza każdy mod w instancji Vanilla', () => {
    const issues = analyzeMods([mod({ fileName: 'alpha.jar', modId: 'alpha' })], [], {
      loader: 'vanilla',
      mcVersion: '1.20.1',
    });
    expect(codes(issues)).toContain('WRONG_LOADER');
  });

  it('wykrywa niezgodną wersję Minecrafta', () => {
    const issues = analyzeMods([mod({ fileName: 'alpha.jar', modId: 'alpha', mcVersionRanges: ['[1.21,1.22)'] })], [], CTX);
    const found = issues.find((i) => i.code === 'MC_VERSION_MISMATCH')!;
    expect(found.severity).toBe('warning');
    expect(found.description).toContain('1.20.1');
  });

  it('mapuje pliki nieczytelne na właściwe kody problemów', () => {
    const issues = analyzeMods(
      [],
      [
        {
          fileName: 'zly.jar',
          filePath: '/tmp/zly.jar',
          size: 10,
          suspicious: true,
          reason: 'Podejrzany współczynnik kompresji (500x)',
        },
        {
          fileName: 'zepsuty.jar',
          filePath: '/tmp/zepsuty.jar',
          size: 10,
          suspicious: false,
          reason: 'Nie udało się otworzyć archiwum: Invalid CEN header',
        },
        {
          fileName: 'lib.jar',
          filePath: '/tmp/lib.jar',
          size: 10,
          suspicious: false,
          reason: 'Plik nie zawiera rozpoznawalnych metadanych moda.',
        },
      ],
      CTX,
    );
    expect(codes(issues)).toContain('SUSPICIOUS_ARCHIVE');
    expect(codes(issues)).toContain('CORRUPTED_JAR');
    expect(codes(issues)).toContain('NO_METADATA');
  });

  it('sortuje problemy od błędów do informacji', () => {
    const issues = analyzeMods(
      [
        mod({ fileName: 'wylaczony.jar.disabled', modId: 'omega', enabled: false }),
        mod({ fileName: 'zly.jar', modId: 'gamma', loader: 'forge' }),
      ],
      [],
      CTX,
    );
    expect(issues[0]?.severity).toBe('error');
    expect(issues[issues.length - 1]?.severity).toBe('info');
  });
});

/* ================================================================== */
/* Pełny przebieg po katalogu                                          */
/* ================================================================== */

describe('analyzeModsDirectory', () => {
  it('analizuje cały katalog i nie przerywa się na uszkodzonym pliku', async () => {
    await writeJar('alpha.jar', [
      {
        name: 'fabric.mod.json',
        data: fabricJson({ id: 'alpha', version: '1.0.0', depends: { minecraft: '1.20.1', beta: '>=2.0.0' } }),
      },
    ]);
    await writeJar('beta.jar', [{ name: 'fabric.mod.json', data: fabricJson({ id: 'beta', version: '1.0.0' }) }]);
    await writeJar('lib.jar', [{ name: 'com/example/Util.class', data: 'x' }]);
    await fsp.writeFile(path.join(modsDir, 'zepsuty.jar'), Buffer.from('nie-archiwum'));
    await writeJar('gamma.jar', [{ name: 'META-INF/mods.toml', data: modsToml({ id: 'gamma', version: '1.0.0' }) }]);

    const report = await analyzeModsDirectory(modsDir, CTX, { instanceId: 'test' });

    expect(report.instanceId).toBe('test');
    expect(report.mods.map((m) => m.modId).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(report.unreadable.map((u) => u.fileName).sort()).toEqual(['lib.jar', 'zepsuty.jar']);
    expect(report.summary.total).toBe(5);
    expect(report.summary.errors).toBeGreaterThan(0);

    // beta jest zainstalowana, ale w wersji 1.0.0 - alpha wymaga >=2.0.0
    expect(codes(report.issues)).toContain('DEPENDENCY_VERSION_MISMATCH');
    // gamma to mod Forge w instancji Fabric
    expect(codes(report.issues)).toContain('WRONG_LOADER');
    expect(codes(report.issues)).toContain('CORRUPTED_JAR');
    expect(codes(report.issues)).toContain('NO_METADATA');
  });

  it('liczy sumę SHA-1 i rozmiar każdego moda', async () => {
    await writeJar('alpha.jar', [{ name: 'fabric.mod.json', data: fabricJson({ id: 'alpha', version: '1.0.0' }) }]);
    const report = await analyzeModsDirectory(modsDir, CTX);
    expect(report.mods[0]?.sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(report.mods[0]?.size).toBeGreaterThan(0);
  });

  it('rozpoznaje pliki .disabled jako wyłączone', async () => {
    await writeJar('alpha.jar.disabled', [
      { name: 'fabric.mod.json', data: fabricJson({ id: 'alpha', version: '1.0.0' }) },
    ]);
    const report = await analyzeModsDirectory(modsDir, CTX);
    expect(report.mods[0]?.enabled).toBe(false);
    expect(report.summary.disabled).toBe(1);
  });

  it('zwraca pusty raport dla nieistniejącego katalogu zamiast rzucać wyjątkiem', async () => {
    const report = await analyzeModsDirectory(path.join(tmp, 'nie-ma-takiego'), CTX);
    expect(report.mods).toEqual([]);
    expect(report.issues).toEqual([]);
    expect(report.summary.total).toBe(0);
  });

  it('nie modyfikuje ani nie usuwa plików', async () => {
    await writeJar('alpha.jar', [{ name: 'fabric.mod.json', data: fabricJson({ id: 'alpha', version: '1.0.0' }) }]);
    const before = await fsp.readdir(modsDir);
    const statBefore = await fsp.stat(path.join(modsDir, 'alpha.jar'));
    await analyzeModsDirectory(modsDir, CTX);
    const after = await fsp.readdir(modsDir);
    const statAfter = await fsp.stat(path.join(modsDir, 'alpha.jar'));
    expect(after).toEqual(before);
    expect(statAfter.size).toBe(statBefore.size);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });
});
