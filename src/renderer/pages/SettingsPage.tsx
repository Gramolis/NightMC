/** Ustawienia launchera. */

import { useState } from 'react';
import { call } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Field, Stat, Switch } from '../components/UI.js';
import { IconFolder } from '../components/Icons.js';

export function SettingsPage() {
  const { settings, system, refreshSettings, pushToast } = useStore();
  const [cfKey, setCfKey] = useState('');

  if (!settings || !system) return <div className="skeleton" style={{ height: 300 }} />;

  const patch = async (p: Record<string, unknown>) => {
    try {
      await call('settings:set', { patch: p });
      await refreshSettings();
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1 className="page-title">Ustawienia</h1>
        <p className="page-sub">
          Wszystkie dane NightMC są zapisywane w <code>{system.dataDir}</code>. Obok pliku EXE nie powstaje nic —
          launcher można swobodnie przenosić.
        </p>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Katalogi">
          <Field label="Katalog instancji" hint="Możesz przenieść instancje na inny dysk. Nowe instancje trafią do wskazanego katalogu.">
            <div className="row">
              <input className="input" value={settings.instancesDir} readOnly />
              <Button onClick={() => void call('settings:pickInstancesDir').then(refreshSettings)}>Zmień</Button>
            </div>
          </Field>
          <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
            <Button small variant="ghost" onClick={() => void call('app:openPath', { target: 'data' })}><IconFolder size={14} /> Dane</Button>
            <Button small variant="ghost" onClick={() => void call('app:openPath', { target: 'instances' })}><IconFolder size={14} /> Instancje</Button>
            <Button small variant="ghost" onClick={() => void call('app:openPath', { target: 'runtimes' })}><IconFolder size={14} /> Java</Button>
            <Button small variant="ghost" onClick={() => void call('app:openPath', { target: 'cache' })}><IconFolder size={14} /> Cache</Button>
            <Button small variant="ghost" onClick={() => void call('app:openPath', { target: 'logs' })}><IconFolder size={14} /> Logi</Button>
          </div>
        </Card>

        <Card title="Pobieranie">
          <Field label={`Równoległych pobrań: ${settings.concurrency}`} hint="Wyżej = szybciej na dobrym łączu, ale więcej obciążenia dysku.">
            <input
              className="slider" type="range" min={1} max={24} value={settings.concurrency}
              onChange={(e) => void patch({ concurrency: Number(e.target.value) })}
            />
          </Field>
          <Field label="Widoczne wersje">
            <div className="grid" style={{ gap: 10 }}>
              <Switch checked={settings.showSnapshots} onChange={(v) => void patch({ showSnapshots: v })} label="Pokazuj snapshoty" />
              <Switch checked={settings.showOldVersions} onChange={(v) => void patch({ showOldVersions: v })} label="Pokazuj old_beta i old_alpha" />
            </div>
          </Field>
        </Card>

        <Card title="Zachowanie przy uruchomieniu gry">
          <Field label="Po starcie gry NightMC ma:">
            <select className="select" value={settings.closeOnLaunch} onChange={(e) => void patch({ closeOnLaunch: e.target.value })}>
              <option value="minimize">zminimalizować się (i wrócić po zamknięciu gry)</option>
              <option value="tray">schować się do zasobnika systemowego</option>
              <option value="nothing">pozostać otwarty</option>
              <option value="close">zamknąć się całkowicie</option>
            </select>
          </Field>
          <Field label="Domyślne argumenty JVM dla nowych instancji">
            <textarea className="input" rows={3} value={settings.defaultJvmArgs} onChange={(e) => void patch({ defaultJvmArgs: e.target.value })} />
          </Field>
        </Card>

        <Card title="Aktualizacje">
          <Switch checked={settings.checkUpdates} onChange={(v) => void patch({ checkUpdates: v })} label="Sprawdzaj aktualizacje NightMC przy starcie" />
          <p className="card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            Aktualizacje pobierane są z GitHub Releases, weryfikowane sumą SHA-256 (oraz podpisem Ed25519,
            jeśli wydanie go zawiera). NightMC nigdy nie wykonuje skryptów pobranych z sieci.
          </p>
        </Card>

        <Card title="CurseForge (opcjonalne)" subtitle="NightMC nie zawiera żadnego klucza API. Możesz wpisać własny — trafi do magazynu poświadczeń systemu, nigdy do pliku ani do EXE.">
          <Field label="Twój klucz API CurseForge">
            <div className="row">
              <input
                className="input"
                type="password"
                placeholder={settings.curseforgeKeySet ? '•••••••• (zapisany)' : 'wklej klucz'}
                value={cfKey}
                onChange={(e) => setCfKey(e.target.value)}
              />
              <Button
                disabled={!cfKey.trim()}
                onClick={() =>
                  void call('curseforge:setKey', { key: cfKey })
                    .then(() => { setCfKey(''); pushToast('success', 'Klucz zapisany w magazynie poświadczeń.'); return refreshSettings(); })
                    .catch((e) => pushToast('error', (e as Error).message))
                }
              >
                Zapisz
              </Button>
              {settings.curseforgeKeySet && (
                <Button
                  variant="danger"
                  onClick={() => void call('curseforge:clearKey').then(refreshSettings).then(() => pushToast('success', 'Klucz usunięty.'))}
                >
                  Usuń
                </Button>
              )}
            </div>
          </Field>
          <Banner kind="info">
            Bez klucza import paczek CurseForge nadal działa: NightMC rozpakowuje nadpisania i pozwala
            wskazać brakujące mody ręcznie.
          </Banner>
        </Card>

        <Card title="System">
          <div className="grid cols-2" style={{ gap: 14 }}>
            <Stat label="Platforma" value={`${system.platform} ${system.arch}`} />
            <Stat label="Rdzenie CPU" value={system.cpuCount} />
            <Stat label="RAM" value={`${(system.totalMemoryMB / 1024).toFixed(1)} GB`} />
            <Stat label="Electron" value={system.electronVersion} />
            <Stat label="Magazyn tokenów" value={system.secretsBackend} />
            <Stat label="Wersja NightMC" value={system.appVersion} />
          </div>
        </Card>
      </div>
    </div>
  );
}
