import { describe, it, expect } from 'vitest';
import { adoptiumUrl, memoryAdvice, parseJavaVersionOutput, pickJavaFor, validateMemory } from '../src/main/java.js';
import type { JavaInstall } from '../src/shared/types.js';

const mk = (major: number, version: string, extra: Partial<JavaInstall> = {}): JavaInstall => ({
  path: `/java-${major}/bin/java`,
  version,
  majorVersion: major,
  arch: 'x64',
  managed: false,
  ...extra,
});

describe('parsowanie wyjścia java -version', () => {
  it('rozpoznaje Javę 8 (format 1.8.0_x)', () => {
    const out = `openjdk version "1.8.0_402"
OpenJDK Runtime Environment (Temurin)(build 1.8.0_402-b06)
OpenJDK 64-Bit Server VM (Temurin)(build 25.402-b06, mixed mode)`;
    const parsed = parseJavaVersionOutput(out);
    expect(parsed?.majorVersion).toBe(8);
    expect(parsed?.version).toBe('1.8.0_402');
    expect(parsed?.arch).toBe('x64');
    expect(parsed?.vendor).toBe('Eclipse Temurin');
  });

  it('rozpoznaje Javę 21', () => {
    const out = `openjdk version "21.0.2" 2024-01-16 LTS
OpenJDK Runtime Environment Temurin-21.0.2+13 (build 21.0.2+13-LTS)
OpenJDK 64-Bit Server VM Temurin-21.0.2+13 (build 21.0.2+13-LTS, mixed mode, sharing)`;
    const parsed = parseJavaVersionOutput(out);
    expect(parsed?.majorVersion).toBe(21);
  });

  it('rozpoznaje 32-bitową Javę', () => {
    const out = `java version "1.8.0_202"
Java(TM) SE Runtime Environment (build 1.8.0_202-b08)
Java HotSpot(TM) Client VM (build 25.202-b08, mixed mode)`;
    expect(parseJavaVersionOutput(out)?.arch).toBe('x86');
  });

  it('zwraca null dla wyjścia bez numeru wersji', () => {
    expect(parseJavaVersionOutput('to nie jest java')).toBeNull();
    expect(parseJavaVersionOutput('')).toBeNull();
  });
});

describe('dobór Javy do wersji gry', () => {
  it('preferuje dokładne dopasowanie', () => {
    const picked = pickJavaFor(17, [mk(8, '1.8.0'), mk(17, '17.0.10'), mk(21, '21.0.2')]);
    expect(picked?.majorVersion).toBe(17);
  });

  it('gdy brak dokładnego, wybiera najbliższą nowszą', () => {
    const picked = pickJavaFor(17, [mk(8, '1.8.0'), mk(21, '21.0.2'), mk(23, '23')]);
    expect(picked?.majorVersion).toBe(21);
  });

  it('dla wymagań Javy 8 nie wybiera Javy 21, jeśli jest 11', () => {
    const picked = pickJavaFor(8, [mk(11, '11.0.22'), mk(21, '21.0.2')]);
    expect(picked?.majorVersion).toBe(11);
  });

  it('preferuje środowisko zarządzane przez NightMC', () => {
    const picked = pickJavaFor(21, [mk(21, '21.0.1'), mk(21, '21.0.2', { managed: true, path: '/nightmc/java' })]);
    expect(picked?.path).toBe('/nightmc/java');
  });

  it('pomija Javę 32-bitową, gdy jest 64-bitowa', () => {
    const picked = pickJavaFor(17, [mk(17, '17.0.1', { arch: 'x86' }), mk(17, '17.0.2', { arch: 'x64', path: '/64' })]);
    expect(picked?.path).toBe('/64');
  });

  it('zwraca null, gdy nie ma nic zgodnego', () => {
    expect(pickJavaFor(21, [mk(8, '1.8.0')])).toBeNull();
    expect(pickJavaFor(21, [])).toBeNull();
  });
});

describe('adres pobierania Temurin', () => {
  it('buduje adres zgodny z oficjalnym API Adoptium', () => {
    const url = adoptiumUrl(21);
    expect(url.startsWith('https://api.adoptium.net/v3/binary/latest/21/ga/')).toBe(true);
    expect(url.endsWith('/jre/hotspot/normal/eclipse')).toBe(true);
  });
});

describe('doradzanie pamięci', () => {
  const GB = 1024 * 1024 * 1024;

  it('zostawia rezerwę dla systemu', () => {
    const advice = memoryAdvice(16 * GB, 8 * GB);
    expect(advice.totalMB).toBe(16384);
    expect(advice.hardLimitMB).toBeLessThan(advice.totalMB);
    expect(advice.hardLimitMB).toBe(16384 - 4096);
  });

  it('ostrzega przy małej ilości RAM', () => {
    expect(memoryAdvice(3 * GB, GB).warning).toBeTruthy();
  });

  it('proponuje więcej pamięci dla dużych paczek', () => {
    expect(memoryAdvice(16 * GB, 8 * GB, 'large').recommendedMaxMB).toBeGreaterThan(
      memoryAdvice(16 * GB, 8 * GB, 'vanilla').recommendedMaxMB,
    );
  });

  it('nie pozwala przydzielić więcej niż jest RAM-u', () => {
    const res = validateMemory(1024, 32768, 8 * GB);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('8192');
  });

  it('ostrzega, ale przepuszcza wartości bliskie limitu', () => {
    const res = validateMemory(1024, 7000, 8 * GB);
    expect(res.ok).toBe(true);
    expect(res.error).toContain('Ostrzeżenie');
  });

  it('odrzuca max mniejszy od min', () => {
    expect(validateMemory(4096, 2048, 16 * GB).ok).toBe(false);
    expect(validateMemory(64, 2048, 16 * GB).ok).toBe(false);
  });
});
