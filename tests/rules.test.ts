import { describe, it, expect } from 'vitest';
import { nativeClassifier, ruleAllows } from '../src/main/minecraft.js';
import { LINUX, OSX_ARM, WINDOWS } from './fixtures.js';

describe('reguły zależne od systemu', () => {
  it('brak reguł oznacza "dozwolone"', () => {
    expect(ruleAllows(undefined, WINDOWS)).toBe(true);
    expect(ruleAllows([], WINDOWS)).toBe(true);
  });

  it('dopasowuje nazwę systemu', () => {
    const rules = [{ action: 'allow' as const, os: { name: 'windows' } }];
    expect(ruleAllows(rules, WINDOWS)).toBe(true);
    expect(ruleAllows(rules, LINUX)).toBe(false);
  });

  it('obsługuje regułę allow + disallow w kolejności', () => {
    const rules = [
      { action: 'allow' as const },
      { action: 'disallow' as const, os: { name: 'osx' } },
    ];
    expect(ruleAllows(rules, WINDOWS)).toBe(true);
    expect(ruleAllows(rules, OSX_ARM)).toBe(false);
  });

  it('dopasowuje architekturę', () => {
    const rules = [{ action: 'allow' as const, os: { arch: 'x86' } }];
    expect(ruleAllows(rules, WINDOWS)).toBe(false);
    expect(ruleAllows(rules, { ...WINDOWS, arch: 'x86' })).toBe(true);
  });

  it('dopasowuje wersję systemu wyrażeniem regularnym', () => {
    const rules = [{ action: 'allow' as const, os: { name: 'windows', version: '^10\\.' } }];
    expect(ruleAllows(rules, WINDOWS)).toBe(true);
    expect(ruleAllows(rules, { ...WINDOWS, version: '6.1.7601' })).toBe(false);
  });

  it('nie wywraca się na błędnym wyrażeniu regularnym', () => {
    const rules = [{ action: 'allow' as const, os: { version: '[' } }];
    expect(ruleAllows(rules, WINDOWS)).toBe(false);
  });

  it('dopasowuje cechy (features)', () => {
    const rules = [{ action: 'allow' as const, features: { has_custom_resolution: true } }];
    expect(ruleAllows(rules, WINDOWS)).toBe(false);
    expect(ruleAllows(rules, { ...WINDOWS, features: { has_custom_resolution: true } })).toBe(true);
  });

  it('wybiera właściwy klasyfikator natives i podstawia architekturę', () => {
    const lib = { name: 'x:y:1', natives: { windows: 'natives-windows-${arch}', linux: 'natives-linux' } };
    expect(nativeClassifier(lib, WINDOWS)).toBe('natives-windows-64');
    expect(nativeClassifier(lib, { ...WINDOWS, arch: 'x86' })).toBe('natives-windows-32');
    expect(nativeClassifier(lib, LINUX)).toBe('natives-linux');
    expect(nativeClassifier(lib, OSX_ARM)).toBeUndefined();
    expect(nativeClassifier({ name: 'x:y:1' }, WINDOWS)).toBeUndefined();
  });
});
