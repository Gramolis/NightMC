/** Mody: wyszukiwanie w Modrinth + zarządzanie modami instancji. */

import { useEffect, useState } from 'react';
import { call, formatBytes, formatNumber } from '../api.js';
import { useSelectedInstance, useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, Empty, Modal } from '../components/UI.js';
import { IconDownload, IconPuzzle, IconRefresh, IconSearch, IconTrash, IconWarn } from '../components/Icons.js';
import type { ModAnalysisReport, ModFile, PackCatalogProject, PackCatalogVersion } from '../../shared/types.js';

export function ModsPage() {
  const instance = useSelectedInstance();
  const { instances, selectInstance, pushToast, setPage, settings } = useStore();
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');
  const [mods, setMods] = useState<ModFile[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PackCatalogProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<PackCatalogProject | null>(null);
  const [versions, setVersions] = useState<PackCatalogVersion[]>([]);
  const [useModrinth, setUseModrinth] = useState(true);
  const [useCurseForge, setUseCurseForge] = useState(true);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ModAnalysisReport | null>(null);
  const [updates, setUpdates] = useState<{
    fileName: string;
    currentName: string;
    newVersionId: string;
    newVersionNumber: string;
    source: 'modrinth' | 'curseforge';
    projectId?: string;
  }[]>([]);

  const loadMods = async () => {
    if (!instance) return;
    setMods(await call<ModFile[]>('mods:list', { instanceId: instance.id }));
  };

  useEffect(() => {
    void loadMods().catch(() => undefined);
    setUpdates([]);
    setAnalysis(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id]);

  const search = async () => {
    if (!instance) return;
    setSearching(true);
    try {
      if (instance.loader === 'vanilla') throw new Error('Wybierz instancję Fabric, Forge albo NeoForge.');
      const res = await call<{ projects: PackCatalogProject[]; warnings: string[] }>('packBuilder:search', {
        query,
        mcVersion: instance.mcVersion,
        loader: instance.loader,
        sources: [useModrinth ? 'modrinth' : null, useCurseForge ? 'curseforge' : null]
          .filter((source): source is 'modrinth' | 'curseforge' => source !== null),
      });
      setResults(res.projects);
      for (const warning of res.warnings) pushToast('info', warning);
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

  const openVersions = async (project: PackCatalogProject) => {
    if (!instance) return;
    setPicking(project);
    setVersions([]);
    try {
      setVersions(
        await call<PackCatalogVersion[]>('packBuilder:versions', {
          source: project.source,
          projectId: project.projectId,
          mcVersion: instance.mcVersion,
          loader: instance.loader as 'fabric' | 'forge' | 'neoforge',
        }),
      );
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  const install = async (version: PackCatalogVersion) => {
    if (!instance || !picking) return;
    setBusy(true);
    try {
      const res = await call<{ installed: string[]; skipped: string[] }>('packBuilder:install', {
        instanceId: instance.id,
        items: [{
          source: picking.source,
          projectId: picking.projectId,
          versionId: version.versionId,
          title: picking.title,
          versionNumber: version.versionNumber,
        }],
      });
      pushToast('success', `Zainstalowano ${res.installed.length} plików.`);
      for (const reason of res.skipped) pushToast('error', `Pominięto: ${reason}`);
      setPicking(null);
      await loadMods();
      setAnalysis(null);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const updateInstalled = async (update: typeof updates[number]) => {
    if (!instance) return;
    setBusy(true);
    try {
      const next = await call<ModFile[]>('mods:update', {
        instanceId: instance.id,
        fileName: update.fileName,
        source: update.source,
        projectId: update.projectId,
        newVersionId: update.newVersionId,
      });
      setMods(next);
      setAnalysis(null);
      setUpdates((current) => current.filter((item) => item.fileName !== update.fileName));
      pushToast('success', 'Mod został zaktualizowany, a stara wersja usunięta.');
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const analyzeInstalled = async () => {
    if (!instance) return;
    setAnalyzing(true);
    try {
      const report = await call<ModAnalysisReport>('mods:analyze', { instanceId: instance.id });
      setAnalysis(report);
      pushToast(
        report.summary.errors > 0 ? 'error' : report.summary.warnings > 0 ? 'info' : 'success',
        report.summary.errors > 0
          ? `Diagnostyka znalazła ${report.summary.errors} błędów.`
          : report.summary.warnings > 0
            ? `Diagnostyka znalazła ${report.summary.warnings} ostrzeżeń.`
            : `Sprawdzono ${report.summary.total} plików — nie znaleziono problemów.`,
      );
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setAnalyzing(false);
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
            Zarządzaj modami paczki i dodawaj zgodne pliki z Modrinth oraz CurseForge. Dostęp nie zależy
            od typu profilu gracza.
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
          Dodaj mody
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
              <Button small variant="primary" disabled={analyzing} onClick={() => void analyzeInstalled()}>
                <IconWarn size={14} /> {analyzing ? 'Analizuję…' : 'Sprawdź mody'}
              </Button>
              <Button small variant="ghost" onClick={() => void call('app:openPath', { target: 'instances', instanceId: instance.id })}>
                Katalog
              </Button>
            </>
          }
        >
          {analysis && (
            <div className="mod-analysis-panel">
              <div className="row wrap mod-analysis-head">
                <strong>Diagnostyka modów</strong>
                <Chip tone="dim">przeskanowano {analysis.summary.total}</Chip>
                <Chip tone="err">błędy {analysis.summary.errors}</Chip>
                <Chip tone="warn">ostrzeżenia {analysis.summary.warnings}</Chip>
                <Chip tone="cyan">informacje {analysis.summary.infos}</Chip>
                <div className="spacer" />
                <Button small variant="ghost" disabled={analyzing} onClick={() => void analyzeInstalled()}>
                  <IconRefresh size={13} /> Sprawdź ponownie
                </Button>
              </div>

              {analysis.issues.length === 0 ? (
                <Banner kind="info">Nie znaleziono problemów w zainstalowanych modach.</Banner>
              ) : (
                <div className="mod-analysis-list">
                  {analysis.issues.map((problem, index) => (
                    <div className={`mod-analysis-issue ${problem.severity}`} key={`${problem.code}:${problem.fileName}:${index}`}>
                      <IconWarn size={16} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="list-title">{problem.title}</div>
                        <div className="list-sub">{problem.fileName} · {problem.description}</div>
                        <div className="mod-analysis-action">{problem.suggestedAction}</div>
                      </div>
                      <Chip tone={problem.severity === 'error' ? 'err' : problem.severity === 'warning' ? 'warn' : 'cyan'}>
                        {problem.severity === 'error' ? 'błąd' : problem.severity === 'warning' ? 'ostrzeżenie' : 'informacja'}
                      </Chip>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mods.length === 0 ? (
            <Empty title="Brak modów" hint="Przejdź do zakładki „Dodaj mody”, żeby dodać pierwszy mod." />
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
                    {mod.projectId?.startsWith('curseforge:') && <Chip tone="warn">CurseForge</Chip>}
                    {mod.projectId && !mod.projectId.startsWith('curseforge:') && <Chip tone="cyan">Modrinth</Chip>}
                    {upd && <Chip tone="cyan">aktualizacja {upd.newVersionNumber}</Chip>}
                    {!mod.enabled && <Chip tone="dim">wyłączony</Chip>}
                    {upd && (
                      <Button small variant="primary" disabled={busy} onClick={() => void updateInstalled(upd)}>
                        Aktualizuj
                      </Button>
                    )}
                    <Button
                      small
                      onClick={() =>
                        void call<ModFile[]>('mods:toggle', { instanceId: instance.id, fileName: mod.fileName })
                          .then((next) => { setMods(next); setAnalysis(null); })
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
                          .then((next) => { setMods(next); setAnalysis(null); })
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
            <Button onClick={() => void search()} disabled={searching || (!useModrinth && !useCurseForge)}>Szukaj</Button>
          </div>

          <div className="row wrap" style={{ gap: 14, marginBottom: 14 }}>
            <label className="row" style={{ gap: 7 }}><input type="checkbox" checked={useModrinth} onChange={(e) => setUseModrinth(e.target.checked)} /> Modrinth</label>
            <label className="row" style={{ gap: 7 }}><input type="checkbox" checked={useCurseForge} onChange={(e) => setUseCurseForge(e.target.checked)} /> CurseForge</label>
            {!settings?.curseforgeKeySet && <Chip tone="warn">CurseForge wymaga klucza w Ustawieniach</Chip>}
          </div>

          {searching ? (
            <div className="grid" style={{ gap: 8 }}>
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 62 }} />)}
            </div>
          ) : (
            <div className="list" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
              {results.map((p) => (
                <div key={`${p.source}:${p.projectId}`} className="list-item">
                  {p.iconUrl ? <img className="mod-icon" src={p.iconUrl} alt="" /> : <div className="mod-icon" />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="list-title">{p.title}</div>
                    <div className="list-sub" style={{ marginTop: 3 }}>{p.description}</div>
                    <div className="list-sub" style={{ marginTop: 4, opacity: 0.8 }}>
                      {p.author} · {formatNumber(p.downloads)} pobrań
                    </div>
                  </div>
                  <Chip tone={p.source === 'modrinth' ? 'cyan' : 'warn'}>{p.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</Chip>
                  <Button small disabled={!p.distributable} onClick={() => void openVersions(p)}><IconDownload size={14} /> Wersje</Button>
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
                <div key={v.versionId} className="list-item">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="list-title">{v.name}</div>
                    <div className="list-sub">
                      {v.versionNumber} · {v.loaders.join(', ')} · MC {v.gameVersions.slice(-4).join(', ')}
                    </div>
                  </div>
                  <Chip tone={v.releaseType === 'release' ? 'ok' : 'warn'}>{v.releaseType}</Chip>
                  <Button small variant="primary" disabled={busy || !v.downloadable} onClick={() => void install(v)}>Instaluj</Button>
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
