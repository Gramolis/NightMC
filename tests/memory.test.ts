import { describe, expect, it } from 'vitest';
import { memoryLevel, recommendedInstanceMemoryMB, safeMemoryLimitMB } from '../src/shared/memory.js';

describe('automatyczny dobór RAM-u', () => {
  it('zostawia co najmniej 25% pamięci dla systemu', () => {
    expect(safeMemoryLimitMB(32 * 1024)).toBe(24 * 1024);
    expect(safeMemoryLimitMB(8 * 1024)).toBe(6 * 1024);
  });

  it('zwiększa rekomendację wraz z rozmiarem paczki', () => {
    expect(recommendedInstanceMemoryMB(32 * 1024, 0, false)).toBe(2048);
    expect(recommendedInstanceMemoryMB(32 * 1024, 20, true)).toBe(4096);
    expect(recommendedInstanceMemoryMB(32 * 1024, 80, true)).toBe(6144);
    expect(recommendedInstanceMemoryMB(32 * 1024, 120, true)).toBe(8192);
  });

  it('nie przekracza bezpiecznego maksimum słabszego komputera', () => {
    expect(recommendedInstanceMemoryMB(8 * 1024, 200, true)).toBe(6144);
  });

  it('klasyfikuje pozycję suwaka', () => {
    expect(memoryLevel(2048, 6144, 12288)).toBe('low');
    expect(memoryLevel(5632, 6144, 12288)).toBe('low');
    expect(memoryLevel(6144, 6144, 12288)).toBe('optimal');
    expect(memoryLevel(8192, 6144, 12288)).toBe('elevated');
    expect(memoryLevel(11264, 6144, 12288)).toBe('high');
    expect(memoryLevel(12800, 6144, 12288)).toBe('critical');
  });
});
