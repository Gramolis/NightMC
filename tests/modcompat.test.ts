import { describe, it, expect } from 'vitest';
import { checkModCompatibility, detectConflicts, modrinthLoader } from '../src/main/mods.js';
import type { ModFile } from '../src/shared/types.js';

const fabricInstance = { loader: 'fabric' as const, mcVersion: '1.21.1' };
const forgeInstance = { loader: 'forge' as const, mcVersion: '1.20.1' };
const neoInstance = { loader: 'neoforge' as const, mcVersion: '1.21.1' };

describe('zgodność modów', () => {
  it('przepuszcza zgodny mod', () => {
    const res = checkModCompatibility({ loaders: ['fabric'], game_versions: ['1.21.1'], name: 'Sodium' }, fabricInstance);
    expect(res.ok).toBe(true);
  });

  it('blokuje mod Forge w instancji Fabric', () => {
    const res = checkModCompatibility({ loaders: ['forge'], game_versions: ['1.21.1'], name: 'JEI' }, fabricInstance);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('forge');
  });

  it('blokuje mod Fabric w instancji NeoForge', () => {
    const res = checkModCompatibility({ loaders: ['fabric'], game_versions: ['1.21.1'], name: 'Sodium' }, neoInstance);
    expect(res.ok).toBe(false);
  });

  it('blokuje mod dla innej wersji Minecrafta', () => {
    const res = checkModCompatibility({ loaders: ['fabric'], game_versions: ['1.20.1'], name: 'Stary' }, fabricInstance);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('1.21.1');
  });

  it('przepuszcza mod oznaczony wieloma loaderami', () => {
    expect(checkModCompatibility({ loaders: ['forge', 'neoforge'], game_versions: ['1.21.1'] }, neoInstance).ok).toBe(true);
    expect(checkModCompatibility({ loaders: ['Forge'], game_versions: ['1.20.1'] }, forgeInstance).ok).toBe(true);
  });

  it('nie pozwala instalować modów do instancji Vanilla', () => {
    const res = checkModCompatibility({ loaders: ['fabric'], game_versions: ['1.21.1'] }, { loader: 'vanilla', mcVersion: '1.21.1' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('Vanilla');
  });

  it('mapuje loader na nazwę używaną przez Modrinth', () => {
    expect(modrinthLoader('fabric')).toBe('fabric');
    expect(modrinthLoader('neoforge')).toBe('neoforge');
    expect(modrinthLoader('vanilla')).toBeNull();
  });
});

describe('wykrywanie konfliktów', () => {
  const mod = (fileName: string, projectId?: string): ModFile => ({
    fileName,
    path: `/mods/${fileName}`,
    enabled: true,
    size: 1,
    projectId,
  });

  it('znajduje dwie wersje tego samego projektu', () => {
    const conflicts = detectConflicts([mod('sodium-1.jar', 'AABB'), mod('sodium-2.jar', 'AABB'), mod('jei.jar', 'CCDD')]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.files).toHaveLength(2);
  });

  it('ignoruje mody bez metadanych projektu', () => {
    expect(detectConflicts([mod('a.jar'), mod('b.jar')])).toHaveLength(0);
  });
});
