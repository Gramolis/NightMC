/** Wspólna logika rekomendacji RAM-u używana przez ekran Java i testy. */

export function safeMemoryLimitMB(totalMB: number): number {
  const normalized = Math.max(0, Math.floor(totalMB));
  const reserve = Math.max(2048, Math.floor(normalized * 0.25));
  return Math.max(1024, Math.floor((normalized - reserve) / 512) * 512);
}

/**
 * Rekomendacja zależy od rodzaju instancji i liczby modów, ale nigdy nie
 * przekracza limitu zostawiającego pamięć systemowi i launcherowi.
 */
export function recommendedInstanceMemoryMB(totalMB: number, modCount: number, modded: boolean): number {
  let desired = 2048;
  if (modded) {
    if (modCount <= 40) desired = 4096;
    else if (modCount <= 100) desired = 6144;
    else if (modCount <= 180) desired = 8192;
    else desired = 10240;
  }
  return Math.max(1024, Math.min(desired, safeMemoryLimitMB(totalMB)));
}

export type MemoryLevel = 'low' | 'optimal' | 'elevated' | 'high' | 'critical';

export function memoryLevel(selectedMB: number, optimalMB: number, safeMaxMB: number): MemoryLevel {
  if (selectedMB > safeMaxMB) return 'critical';
  // Każda wartość poniżej rekomendacji musi być opisana jako za mała,
  // nigdy jako „powyżej rekomendacji”.
  if (selectedMB < optimalMB) return 'low';
  if (selectedMB <= optimalMB + 512) return 'optimal';
  if (selectedMB >= safeMaxMB * 0.85) return 'high';
  return 'elevated';
}
