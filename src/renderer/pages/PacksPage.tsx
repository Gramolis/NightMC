/** Import paczek: .mrpack (Modrinth) i lokalny ZIP CurseForge. */

import { useState } from 'react';
import { call, formatBytes, formatNumber } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, DownloadPanel, Field, Modal, ProgressBar } from '../components/UI.js';
import { IconDownload, IconPackage, IconSearch } from '../components/Icons.js';
import type { Instance, PackBuilderItem, PackCatalogProject, PackCatalogVersion, PackPreview } from '../../shared/types.js';

export function PacksPage() {
  const { pushToast, refreshInstances, selectInstance, setPage, instances, settings, progress } = useStore();
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [packError, setPackError] = useState('');

  const moddedInstances = instances.filter((i) => i.loader !== 'vanilla');
  const [builderInstanceId, setBuilderInstanceId] = useState(moddedInstances[0]?.id ?? '');
  const activeBuilderInstanceId = builderInstanceId || moddedInstances[0]?.id || '';
  const builderInstance = instances.find((i) => i.id === activeBuilderInstanceId);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalog, setCatalog] = useState<PackCatalogProject[]>([]);
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [useModrinth, setUseModrinth] = useState(true);
  const [useCurseForge, setUseCurseForge] = useState(true);
  const [draft, setDraft] = useState<PackBuilderItem[]>([]);
  const [packQuery, setPackQuery] = useState('');
  const [packCatalog, setPackCatalog] = useState<PackCatalogProject[]>([]);
  const [packWarnings, setPackWarnings] = useState<string[]>([]);
  const [searchingPacks, setSearchingPacks] = useState(false);
  const [pickingPack, setPickingPack] = useState<PackCatalogProject | null>(null);
  const [packVersions, setPackVersions] = useState<PackCatalogVersion[]>([]);
  const [installingPack, setInstallingPack] = useState(false);
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);
  const [downloadedPack, setDownloadedPack] = useState<Instance | null>(null);

  const searchPacks = async () => {
    if (!useModrinth && !useCurseForge) return;
    setSearchingPacks(true);
    try {
      const result = await call<{ projects: PackCatalogProject[]; warnings: string[] }>('packBuilder:searchPacks', {
        query: packQuery,
        sources: [useModrinth ? 'modrinth' : null, useCurseForge ? 'curseforge' : null]
          .filter((source): source is 'modrinth' | 'curseforge' => source !== null),
      });
      setPackCatalog(result.projects);
      setPackWarnings(result.warnings);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setSearchingPacks(false);
    }
  };

  const openPackVersions = async (project: PackCatalogProject) => {
    if (!project.distributable) {
      pushToast('error', 'Autor tej paczki zablokował pobieranie przez aplikacje zewnętrzne.');
      return;
    }
    setPickingPack(project);
    setPackVersions([]);
    try {
      const versions = await call<PackCatalogVersion[]>('packBuilder:packVersions', {
        source: project.source,
        projectId: project.projectId,
      });
      setPackVersions(versions.filter((version) => version.downloadable));
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  const downloadPack = async (version: PackCatalogVersion) => {
    if (!pickingPack) return;
    useStore.setState({ progress: null });
    setDownloadingVersionId(version.versionId);
    setInstallingPack(true);
    try {
      const instance = await call<Instance>('packBuilder:installPack', {
        source: pickingPack.source,
        projectId: pickingPack.projectId,
        versionId: version.versionId,
        instanceName: pickingPack.title.slice(0, 64),
      });
      await refreshInstances();
      selectInstance(instance.id);
      setDownloadedPack(instance);
      setPickingPack(null);
      pushToast('success', `Paczka „${instance.name}” jest gotowa. Możesz teraz zarządzać jej modami.`);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setInstallingPack(false);
      setDownloadingVersionId(null);
      useStore.setState({ progress: null });
    }
  };

  const searchCatalog = async () => {
    if (!builderInstance || (!useModrinth && !useCurseForge)) return;
    setSearching(true);
    try {
      const result = await call<{ projects: PackCatalogProject[]; warnings: string[] }>('packBuilder:search', {
        query: catalogQuery,
        mcVersion: builderInstance.mcVersion,
        loader: builderInstance.loader as 'fabric' | 'forge' | 'neoforge',
        sources: [useModrinth ? 'modrinth' : null, useCurseForge ? 'curseforge' : null]
          .filter((source): source is 'modrinth' | 'curseforge' => source !== null),
      });
      setCatalog(result.projects);
      setCatalogWarnings(result.warnings);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const addProject = async (project: PackCatalogProject) => {
    if (!builderInstance) return;
    if (!project.distributable) {
      pushToast('error', 'Autor tego moda zablokował instalację przez aplikacje zewnętrzne.');
      return;
    }
    try {
      const versions = await call<PackCatalogVersion[]>('packBuilder:versions', {
        source: project.source,
        projectId: project.projectId,
        mcVersion: builderInstance.mcVersion,
        loader: builderInstance.loader as 'fabric' | 'forge' | 'neoforge',
      });
      const version = versions.find((v) => v.releaseType === 'release' && v.downloadable)
        ?? versions.find((v) => v.downloadable);
      if (!version) throw new Error('Brak zgodnej wersji możliwej do pobrania.');
      setDraft((current) => {
        const normalized = project.title.trim().toLocaleLowerCase('pl');
        const withoutDuplicate = current.filter((i) => !(
          (i.source === project.source && i.projectId === project.projectId)
          || i.title.trim().toLocaleLowerCase('pl') === normalized
        ));
        return [...withoutDuplicate, {
          source: project.source,
          projectId: project.projectId,
          versionId: version.versionId,
          title: project.title,
          versionNumber: version.versionNumber,
        }];
      });
      pushToast('success', `Dodano „${project.title}” do paczki.`);
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  const installDraft = async () => {
    if (!builderInstance || draft.length === 0) return;
    setInstalling(true);
    try {
      const result = await call<{ installed: string[]; skipped: string[] }>('packBuilder:install', {
        instanceId: builderInstance.id,
        items: draft,
      });
      await refreshInstances();
      pushToast('success', `Zainstalowano ${result.installed.length} modów w „${builderInstance.name}”.`);
      if (result.skipped.length) pushToast('info', `Pominięto ${result.skipped.length} pozycji. Szczegóły są w logach.`);
      setDraft([]);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const pick = async () => {
    try {
      setPackError('');
      const res = await call<{ token: string; preview: PackPreview } | null>('packs:pickAndPreview');
      if (!res) return;
      setToken(res.token);
      setPreview(res.preview);
      setName(res.preview.name);
      setManual({});
    } catch (e) {
      const message = (e as Error).message;
      setPackError(message);
      pushToast('error', message);
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

  const cancelImport = () => {
    setToken('');
    setPreview(null);
    setName('');
    setManual({});
    setPackError('');
  };

  const missingManualFiles = preview?.kind === 'curseforge'
    ? preview.requiredFiles.filter((file) => !manual[file.name]).length
    : 0;
  const curseForgeReady = preview?.kind !== 'curseforge'
    || Boolean(settings?.curseforgeKeySet)
    || missingManualFiles === 0;

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1 className="page-title">Paczki modów</h1>
        <p className="page-sub">
          Obsługiwane są paczki Modrinth (.mrpack) oraz lokalnie pobrane archiwa CurseForge (.zip).
          NightMC odczyta z manifestu właściwą wersję Minecrafta i Forge, Fabric albo NeoForge oraz utworzy gotową instancję.
          Każde archiwum jest sprawdzane pod kątem Zip Slip, dowiązań symbolicznych i bomb ZIP,
          a przewidywany rozmiar liczony jest przed rozpakowaniem.
        </p>
      </div>

      <Card
        title="Znajdź paczkę modów (DEV)"
        subtitle="Przeszukaj Modrinth i CurseForge. NightMC pobierze wybraną paczkę jako osobną instancję."
      >
        <Field label="Nazwa paczki modów">
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              value={packQuery}
              onChange={(e) => setPackQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void searchPacks(); }}
              placeholder="np. All the Mods, Better MC, OneBlock"
            />
            <Button variant="primary" onClick={() => void searchPacks()} disabled={searchingPacks || (!useModrinth && !useCurseForge)}>
              <IconSearch size={16} /> {searchingPacks ? 'Szukam…' : 'Szukaj paczek'}
            </Button>
          </div>
        </Field>

        <div className="row wrap" style={{ gap: 14, marginBottom: 16 }}>
          <label className="row" style={{ gap: 7 }}><input type="checkbox" checked={useModrinth} onChange={(e) => setUseModrinth(e.target.checked)} /> Modrinth</label>
          <label className="row" style={{ gap: 7 }}><input type="checkbox" checked={useCurseForge} onChange={(e) => setUseCurseForge(e.target.checked)} /> CurseForge</label>
          {!settings?.curseforgeKeySet && <Chip tone="warn">CurseForge wymaga własnego klucza w Ustawieniach</Chip>}
        </div>

        {packWarnings.map((warning) => <div key={warning} style={{ marginBottom: 10 }}><Banner>{warning}</Banner></div>)}

        {downloadedPack && (
          <div className="pack-ready-panel">
            <div>
              <div className="list-title">{downloadedPack.name} jest gotowa</div>
              <div className="list-sub">Minecraft {downloadedPack.mcVersion} · {downloadedPack.loader} · {downloadedPack.modCount} modów</div>
            </div>
            <Button variant="primary" onClick={() => { selectInstance(downloadedPack.id); setPage('mods'); }}>
              Otwórz mody paczki
            </Button>
          </div>
        )}

        {packCatalog.length > 0 && (
          <div className="pack-catalog-grid">
            {packCatalog.map((project) => (
              <div className="pack-catalog-card" key={`${project.source}:${project.projectId}`}>
                {project.iconUrl ? <img src={project.iconUrl} alt="" className="pack-catalog-icon" /> : <div className="pack-catalog-icon placeholder" />}
                <div className="pack-catalog-body">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="list-title">{project.title}</span>
                    <Chip tone={project.source === 'modrinth' ? 'cyan' : 'warn'}>{project.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</Chip>
                  </div>
                  <div className="list-sub pack-catalog-description">{project.description}</div>
                  <div className="list-sub">{project.author ? `Autor: ${project.author} · ` : ''}{formatNumber(project.downloads)} pobrań</div>
                </div>
                <Button small variant="primary" disabled={!project.distributable} onClick={() => void openPackVersions(project)}>
                  <IconDownload size={14} /> Pobierz
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ height: 18 }} />

      <Card
        title="Własna mieszana paczka (DEV)"
        subtitle="Wybierz istniejącą instancję i dodawaj do niej pojedyncze mody z Modrinth oraz CurseForge."
      >
        {moddedInstances.length === 0 ? (
          <Banner kind="info">Najpierw utwórz instancję Fabric, Forge albo NeoForge.</Banner>
        ) : (
          <>
            <div className="grid cols-2" style={{ alignItems: 'end' }}>
              <Field label="Instancja / własna paczka">
                <select className="select" value={activeBuilderInstanceId} onChange={(e) => { setBuilderInstanceId(e.target.value); setDraft([]); setCatalog([]); }}>
                  {moddedInstances.map((i) => <option key={i.id} value={i.id}>{i.name} — Minecraft {i.mcVersion} / {i.loader}</option>)}
                </select>
              </Field>
              <Field label="Dodaj mod do wybranej paczki">
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    value={catalogQuery}
                    onChange={(e) => setCatalogQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void searchCatalog(); }}
                    placeholder="np. Sodium, JEI, JourneyMap"
                  />
                  <Button variant="primary" onClick={() => void searchCatalog()} disabled={searching}>
                    <IconSearch size={16} /> {searching ? 'Szukam…' : 'Szukaj'}
                  </Button>
                </div>
              </Field>
            </div>

            <div className="row wrap" style={{ gap: 14, margin: '4px 0 16px' }}>
              <label className="row" style={{ gap: 7 }}><input type="checkbox" checked={useModrinth} onChange={(e) => setUseModrinth(e.target.checked)} /> Modrinth</label>
              <label className="row" style={{ gap: 7 }}><input type="checkbox" checked={useCurseForge} onChange={(e) => setUseCurseForge(e.target.checked)} /> CurseForge</label>
              {!settings?.curseforgeKeySet && <Chip tone="warn">CurseForge wymaga własnego klucza w Ustawieniach</Chip>}
              {draft.length > 0 && <Chip tone="cyan">Moja paczka: {draft.length}</Chip>}
            </div>

            {catalogWarnings.map((warning) => <div key={warning} style={{ marginBottom: 10 }}><Banner>{warning}</Banner></div>)}

            {draft.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div className="list" style={{ maxHeight: 190, overflowY: 'auto' }}>
                  {draft.map((item) => (
                    <div className="list-item" key={`${item.source}:${item.projectId}`}>
                      <Chip tone={item.source === 'modrinth' ? 'cyan' : 'warn'}>{item.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</Chip>
                      <div style={{ flex: 1 }}><div className="list-title">{item.title}</div><div className="list-sub">{item.versionNumber}</div></div>
                      <Button small variant="ghost" onClick={() => setDraft((d) => d.filter((x) => x !== item))}>Usuń</Button>
                    </div>
                  ))}
                </div>
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                  <Button variant="primary" onClick={() => void installDraft()} disabled={installing}>
                    <IconDownload size={16} /> {installing ? 'Instaluję…' : `Zainstaluj paczkę (${draft.length})`}
                  </Button>
                </div>
              </div>
            )}

            {catalog.length > 0 && (
              <div className="list" style={{ maxHeight: 430, overflowY: 'auto' }}>
                {catalog.map((project) => {
                  const added = draft.some((i) => i.source === project.source && i.projectId === project.projectId);
                  return (
                    <div className="list-item" key={`${project.source}:${project.projectId}`}>
                      {project.iconUrl && <img src={project.iconUrl} alt="" width={42} height={42} style={{ borderRadius: 8, objectFit: 'cover' }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row wrap" style={{ gap: 6 }}>
                          <span className="list-title">{project.title}</span>
                          <Chip tone={project.source === 'modrinth' ? 'cyan' : 'warn'}>{project.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}</Chip>
                          {!project.distributable && <Chip tone="err">pobieranie zablokowane</Chip>}
                        </div>
                        <div className="list-sub">{project.description}</div>
                        <div className="list-sub">{project.author ? `Autor: ${project.author} · ` : ''}{project.downloads.toLocaleString('pl-PL')} pobrań</div>
                      </div>
                      <Button small variant={added ? 'ghost' : 'primary'} disabled={added || !project.distributable} onClick={() => void addProject(project)}>
                        {added ? 'Dodano' : 'Dodaj'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>

      <div style={{ height: 18 }} />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Wybierz plik paczki" subtitle="NightMC rozpozna format po zawartości archiwum, nie po rozszerzeniu.">
          <Button variant="primary" onClick={() => void pick()}><IconPackage size={16} /> Wskaż plik .mrpack lub .zip</Button>

          {packError && (
            <div style={{ marginTop: 14 }}>
              <Banner>{packError}</Banner>
            </div>
          )}

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

            {preview.kind === 'curseforge' && !settings?.curseforgeKeySet && missingManualFiles > 0 && (
              <div style={{ marginBottom: 14 }}>
                <Banner>
                  Do automatycznego utworzenia kompletnej instancji brakuje {missingManualFiles} modów. Dodaj własny klucz
                  CurseForge w Ustawieniach albo wskaż każdy plik JAR ręcznie. NightMC nie utworzy pustej, niedziałającej instancji.
                </Banner>
              </div>
            )}

            <div className="row wrap" style={{ gap: 8 }}>
              <Button variant="primary" onClick={() => void doImport()} disabled={busy || !name.trim() || !curseForgeReady}>
                <IconDownload size={16} /> {busy ? 'Importuję…' : 'Importuj jako instancję'}
              </Button>
              <Button variant="danger" onClick={cancelImport} disabled={busy}>
                Anuluj
              </Button>
            </div>
          </Card>
        )}
      </div>

      {pickingPack && (
        <Modal title={`Wersje paczki: ${pickingPack.title}`} onClose={() => !installingPack && setPickingPack(null)} wide>
          {installingPack && (
            <div className="pack-download-progress">
              <div className="pack-download-heading">
                <div>
                  <div className="list-title">Pobieranie wybranej wersji</div>
                  <div className="list-sub">
                    {packVersions.find((version) => version.versionId === downloadingVersionId)?.name ?? pickingPack.title}
                  </div>
                </div>
                {!progress && <span className="progress-percent">Przygotowanie…</span>}
              </div>
              {progress ? <DownloadPanel progress={progress} /> : <ProgressBar progress={0} indeterminate />}
            </div>
          )}
          {packVersions.length === 0 ? (
            <Banner kind="info">Brak wersji paczki możliwych do pobrania.</Banner>
          ) : (
            <div className="list" style={{ maxHeight: '54vh', overflowY: 'auto' }}>
              {packVersions.map((version) => (
                <div className="list-item" key={version.versionId}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="list-title">{version.name}</div>
                    <div className="list-sub">
                      {version.versionNumber} · MC {version.gameVersions.slice(0, 5).join(', ') || 'z manifestu'}
                      {version.loaders.length ? ` · ${version.loaders.join(', ')}` : ''}
                      {version.size ? ` · ${formatBytes(version.size)}` : ''}
                    </div>
                  </div>
                  <Chip tone={version.releaseType === 'release' ? 'ok' : 'warn'}>{version.releaseType}</Chip>
                  <Button small variant="primary" disabled={installingPack} onClick={() => void downloadPack(version)}>
                    <IconDownload size={14} /> {downloadingVersionId === version.versionId ? 'Pobieram…' : 'Pobierz paczkę'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
