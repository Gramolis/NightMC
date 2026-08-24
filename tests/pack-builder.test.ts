import { describe, expect, it } from 'vitest';
import { curseForgeLoaderType } from '../src/main/pack-builder.js';

describe('kreator mieszanych paczek', () => {
  it('mapuje loadery NightMC na identyfikatory CurseForge', () => {
    expect(curseForgeLoaderType('forge')).toBe(1);
    expect(curseForgeLoaderType('fabric')).toBe(4);
    expect(curseForgeLoaderType('neoforge')).toBe(6);
    expect(curseForgeLoaderType('vanilla')).toBe(0);
  });
});
