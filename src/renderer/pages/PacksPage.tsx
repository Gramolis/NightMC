/** Import paczek: .mrpack (Modrinth) i lokalny ZIP CurseForge. */

import { useState } from 'react';
import { call, formatBytes } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, Field } from '../components/UI.js';
import { IconDownload, IconPackage } from '../components/Icons.js';
import type { PackPreview } from '../../shared/types.js';

export function PacksPage() {
  const { pushToast, refreshInstances, selectInstance, setPage, instances, settings } = useStore();
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Record<string, string>>({});

  const pick = async () => {
    try {
      const res = await call<{ token: string; preview: PackPreview } | null>('packs:pickAndPreview');
      if (!res) return;
      setToken(res.token);
      setPreview(res.preview);
      setName(res.preview.name);
      setManual({});
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const inst = await call<{ id: string }>('packs:import', { previewToken: token, instanceName: name.trim() });
      await refreshInstances();
      selectInstance(inst.id);
      pushToast('success', 'Paczka zaimportowana. Pliki gry pobiorą się przy pierwszym uruchomieniu.');
      setPreview(null);
      setToken('');
      setPage('home');
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1 className="page-title">Import paczek</h1>
        <p className="page-sub">
          Obsługiwane są paczki Modrinth (.mrpack) oraz lokalnie pobrane archiwa CurseForge (.zip).
          Każde archiwum jest sprawdzane pod kątem Zip Slip, dowiązań symbolicznych i bomb ZIP,
          a przewidywany rozmiar liczony jest przed rozpakowaniem.
        </p>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Wybierz plik paczki" subtitle="NightMC rozpozna format po zawartości archiwum, nie po rozszerzeniu.">
          <Button variant="primary" onClick={() => void pick()}><IconPackage size={16} /> Wskaż plik .mrpack lub .zip</Button>

          <div style={{ marginTop: 18 }}>
            <Banner kind="info">
              CurseForge nie pozwala pobierać modów bez klucza API, a NightMC nie zawiera żadnego cudzego klucza.
              Nadpisania (configi, skrypty, resource packi) rozpakują się normalnie, a brakujące mody możesz
              wskazać ręcznie albo wpisać własny klucz w Ustawieniach.
            </Banner>
          </div>

          {instances.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <Field label="Eksport instancji do .mrpack">
                <div className="row wrap" style={{ gap: 8 }}>
                  {instances.slice(0, 6).map((i) => (
                    <Button key={i.id} small variant="ghost" onClick={() => void call('packs:exportMrpack', { instanceId: i.id })}>
                      {i.name}
                    </Button>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </Card>

        {preview && (
          <Card title={`Podgląd: ${preview.name}`} subtitle={`Format: ${preview.kind === 'mrpack' ? 'Modrinth .mrpack' : 'CurseForge ZIP'}`}>
            <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
              <Chip tone="ok">Minecraft {preview.mcVersion}</Chip>
              <Chip>{preview.loader}{preview.loaderVersion ? ` ${preview.loaderVersion}` : ''}</Chip>
              <Chip tone="cyan">{preview.requiredFiles.length} plików</Chip>
              <Chip tone="dim">{preview.overrideCount} nadpisań</Chip>
              <Chip tone="dim">~{formatBytes(preview.estimatedBytes)}</Chip>
            </div>

            {preview.warnings.map((w, i) => (
              <div key={i} style={{ marginBottom: 8 }}><Banner>{w}</Banner></div>
            ))}

            <Field label="Nazwa nowej instancji">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
            </Field>

            {preview.kind === 'curseforge' && preview.requiredFiles.length > 0 && (
              <Field
                label={`Brakujące mody (${preview.requiredFiles.length})`}
                hint={settings?.curseforgeKeySet
                  ? 'Masz zapisany własny klucz API — NightMC spróbuje pobrać te pliki automatycznie.'
                  : 'Wskaż pliki ręcznie albo dodaj własny klucz API CurseForge w Ustawieniach.'}
              >
                <div className="list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {preview.requiredFiles.slice(0, 60).map((f) => (
                    <div key={f.name} className="list-item" style={{ padding: '7px 11px' }}>
                      <span className="list-sub" style={{ flex: 1 }}>{f.name}</span>
                      {manual[f.name] ? (
                        <Chip tone="ok">wskazany</Chip>
                      ) : (
                        <Button
                          small
                          variant="ghost"
                          onClick={() =>
                            void call<string | null>('packs:pickManualFile', { previewToken: token, fileName: f.name })
                              .then((p) => p && setManual((m) => ({ ...m, [f.name]: p })))
                              .catch((e) => pushToast('error', (e as Error).message))
                          }
                        >
                          Wskaż plik
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </Field>
            )}

            <Button variant="primary" onClick={() => void doImport()} disabled={busy || !name.trim()}>
              <IconDownload size={16} /> {busy ? 'Importuję…' : 'Importuj jako instancję'}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
