/** Ustawienia launchera - przechowywane w tabeli `settings`. */

import os from 'node:os';
import { DEFAULT_JVM_ARGS, LIMITS } from '../shared/constants.js';
import { db } from './db.js';
import { instancesDir, setInstancesDir } from './paths.js';
import { memoryAdvice } from './java.js';
import type { Settings } from '../shared/types.js';

function defaults(): Settings {
  const advice = memoryAdvice(os.totalmem(), os.freemem());
  return {
    instancesDir: instancesDir(),
    concurrency: LIMITS.defaultConcurrency,
    closeOnLaunch: 'minimize',
    showSnapshots: false,
    showOldVersions: false,
    defaultMemoryMin: 1024,
    defaultMemoryMax: advice.recommendedMaxMB,
    defaultJvmArgs: DEFAULT_JVM_ARGS,
    checkUpdates: true,
    acceptedOfflineWarning: false,
    theme: 'night',
    language: 'pl',
    curseforgeKeySet: false,
  };
}

export function getSettings(): Settings {
  const base = defaults();
  const rows = db().prepare(`SELECT key, value FROM settings`).all();
  const stored: Record<string, unknown> = {};
  for (const r of rows as any[]) {
    try {
      stored[String(r.key)] = JSON.parse(String(r.value));
    } catch {
      stored[String(r.key)] = r.value;
    }
  }
  const merged = { ...base, ...stored } as Settings;
  if (merged.instancesDir && merged.instancesDir !== base.instancesDir) setInstancesDir(merged.instancesDir);
  return merged;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const stmt = db().prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    stmt.run(key, JSON.stringify(value));
  }
  if (patch.instancesDir) setInstancesDir(patch.instancesDir);
  return getSettings();
}
