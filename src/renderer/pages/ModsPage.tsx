/** Mody: wyszukiwanie w Modrinth + zarządzanie modami instancji. */

import { useEffect, useState } from 'react';
import { call, formatBytes, formatNumber } from '../api.js';
import { useSelectedInstance, useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, Empty, Modal } from '../components/UI.js';
import { IconDownload, IconPuzzle, IconRefresh, IconSearch, IconTrash } from '../components/Icons.js';
import type { ModFile, ModrinthProject, ModrinthSearchResult, ModrinthVersion } from '../../shared/types.js';

export function ModsPage() {
  const instance = useSelectedInstance();
  const { instances, selectInstance, pushToast, setPage } = useStore();
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [mods, setMods] = useState<ModFile[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModrinthProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<ModrinthProject | null>(null);
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [updates, setUpdates] = useState<{ fileName: string; currentName: string; newVersionId: string; newVersionNumber: string }[]>([]);

  const loadMods = async () => {
    if (!instance) return;
    setMods(await call<ModFile[]>('mods:list', { instanceId: instance.id }));
  };

  useEffect(() => {
    void loadMods().catch(() => undefined);
    setUpdates([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id]);

  const search = async () => {
    if (!instance) return;
    setSearching(true);
    try {
      const res = await call<ModrinthSearchResult>('mods:search', {
        query,
        mcVersion: instance.mcVersion,
        loader: instance.loader === 'vanilla' ? undefined : instance.loader,
        limit: 30,
      });
      setResults(res.hits);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (tab === 'browse' && instance) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, instance?.id]);

  const openVersions = async (project: ModrinthProject) => {
    if (!instance) return;
    setPicking(project);
    setVersions([]);
    try {
      setVersions(
        await call<ModrinthVersion[]>('mods:versions', {
          projectId: project.project_id,
          mcVersion: instance.mcVersion,
          loader: instance.loader === 'vanilla' ? undefined : instance.loader,
        }),
      );
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  const install = async (versionId: string) => {
    if (!instance) return;
    setBusy(true);
    try {
      const res = await call<{ installed: { name: string }[]; skipped: { name: string; reason: string }[] }>(
        'mods:install',
        { instanceId: instance.id, versionId, withDependencies: true },
      );
      pushToast('success', `Zainstalowano ${res.installed.length} plików.`);
      for (const s of res.skipped) pushToast('error', `Pominięto ${s.name}: ${s.reason}`);
      setPicking(null);
      await loadMods();
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!instance) {
    return <Empty icon={<IconPuzzle size={40} />} title="Wybierz instancję" hint="Mody są instalowane do konkretnej instancji." action={<Button onClick={() => setPage('instances')}>Otwórz bibliotekę</Button>} />;
  }

  return (
    <div className="fade-in">
      <div className="page-head row">
        <div>
          <h1 className="page-title">Mody</h1>
          <p className="page-sub">
            Katalog Modrinth. Dostęp do modów nie zależy od typu profilu — działa tak samo dla konta Premium
            i profilu Offline / Non-Premium.
          </p>
        </div>
        <div className="spacer" />
        <select className="select" style={{ width: 220 }} value={instance.id} onChange={(e) => selectInstance(e.target.value)}>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>

      {instance.loader === 'vanilla' && (
        <div style={{ marginBottom: 16 }}>
          <Banner>
            Ta instancja to czysta Vanilla i nie obsługuje modów. Utwórz instancję z Fabric, Forge albo NeoForge.
          </Banner>
        </div>
      )}

      <div className="tabs">
        <button className={`tab${tab === 'installed' ? ' active' : ''}`} onClick={() => setTab('installed')}>
          Zainstalowane ({mods.length})
        </button>
        <button className={`tab${tab === 'browse' ? ' active' : ''}`} onClick={() => setTab('browse')}>
          Przeglądaj Modrinth
        </button>
      </div>

      {tab === 'installed' ? (
        <Card
          title={`Mody instancji „${instance.name}”`}
          subtitle={`Minecraft ${instance.mcVersion} · ${instance.loader}`}
          actions={
            <>
              <Button
                small
                onClick={() =>
                  void call<typeof updates>('mods:checkUpdates', { instanceId: instance.id })
                    .then((u) => {
                      setUpdates(u);
                      pushToast(u.length ? 'info' : 'success', u.length ? `Dostępnych aktualizacji: ${u.length}` : 'Wszystkie mody są aktualne.');
                    })
                    .catch((e) => pushToast('error', (e as Error).message))
                }
              >
                <IconRefresh size={14} /> Sprawdź aktualizacje
              </Button>
              <Button small variant="ghost" onClick={() => void call('app:openPath', { target: 'instances', instanceId: instance.id })}>
                Katalog
              </Button>
            </>
          }
        >
          {mods.length === 0 ? (
            <Empty title="Brak modów" hint="Przejdź do zakładki „Przeglądaj Modrinth”, żeby dodać pierwszy mod." />
          ) : (
            <div className="list">
              {mods.map((mod) => {
                const upd = updates.find((u) => u.fileName === mod.fileName);
                return (
                  <div key={mod.fileName} className={`list-item${mod.enabled ? '' : ' disabled'}`}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="list-title">{mod.displayName}</div>
                      <div className="list-sub">{mod.fileName} · {formatBytes(mod.size)}</div>
                    </div>
                    {upd && <Chip tone="cyan">aktualizacja {upd.newVersionNumber}</Chip>}
                    {!mod.enabled && <Chip tone="dim">wyłączony</Chip>}
                    {upd && (
                      <Button small variant="primary" disabled={busy} onClick={() => void install(upd.newVersionId)}>
                        Aktualizuj
                      </Button>
                    )}
                    <Button
                      small
                      onClick={() =>
                        void call<ModFile[]>('mods:toggle', { instanceId: instance.id, fileName: mod.fileName })
                          .then(setMods)
                          .catch((e) => pushToast('error', (e as Error).message))
                      }
                    >
                      {mod.enabled ? 'Wyłącz' : 'Włącz'}
                    </Button>
                    <Button
                      small
                      variant="danger"
                      onClick={() =>
                        void call<ModFile[]>('mods:delete', { instanceId: instance.id, fileName: mod.fileName })
                          .then(setMods)
                          .catch((e) => pushToast('error', (e as Error).message))
                      }
                    >
                      <IconTrash size={14} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div className="row" style={{ marginBottom: 14 }}>
            <IconSearch size={16} />
            <input
              className="input"
              placeholder="Szukaj modów (np. sodium, jei, create)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
            />
            <Button onClick={() => void search()} disabled={searching}>Szukaj</Button>
          </div>

          {searching ? (
            <div className="grid" style={{ gap: 8 }}>
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 62 }} />)}
            </div>
          ) : (
            <div className="list" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
              {results.map((p) => (
                <div key={p.project_id} className="list-item">
                  {p.icon_url ? <img className="mod-icon" src={p.icon_url} alt="" /> : <div className="mod-icon" />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="list-title">{p.title}</div>
                    <div className="list-sub" style={{ marginTop: 3 }}>{p.description}</div>
                    <div className="list-sub" style={{ marginTop: 4, opacity: 0.8 }}>
                      {p.author} · {formatNumber(p.downloads)} pobrań
                    </div>
                  </div>
                  <Button small onClick={() => void openVersions(p)}><IconDownload size={14} /> Wersje</Button>
                </div>
              ))}
              {results.length === 0 && <Empty title="Brak wyników" hint="Spróbuj innej frazy albo zmień wersję instancji." />}
            </div>
          )}
        </Card>
      )}

      {picking && (
        <Modal title={`Wersje: ${picking.title}`} onClose={() => setPicking(null)} wide>
          {versions.length === 0 ? (
            <div className="skeleton" style={{ height: 120 }} />
          ) : (
            <div className="list" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
              {versions.map((v) => (
                <div key={v.id} className="list-item">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="list-title">{v.name}</div>
                    <div className="list-sub">
                      {v.version_number} · {v.loaders.join(', ')} · MC {v.game_versions.slice(-4).join(', ')}
                    </div>
                  </div>
                  <Chip tone={v.version_type === 'release' ? 'ok' : 'warn'}>{v.version_type}</Chip>
                  <Button small variant="primary" disabled={busy} onClick={() => void install(v.id)}>Instaluj</Button>
                </div>
              ))}
            </div>
          )}
          <p className="card-sub" style={{ marginTop: 14, marginBottom: 0 }}>
            NightMC automatycznie doinstaluje wymagane zależności i odrzuci wersje niezgodne z loaderem
            lub wersją gry tej instancji.
          </p>
        </Modal>
      )}
    </div>
  );
}
