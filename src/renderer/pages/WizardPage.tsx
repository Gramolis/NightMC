/** Kreator instancji: wersja gry -> modloader -> nazwa i pamięć. */

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, Field } from '../components/UI.js';
import { IconCheck, IconSearch } from '../components/Icons.js';
import type { LoaderId, LoaderVersion, ManifestVersion } from '../../shared/types.js';

const LOADERS: { id: LoaderId; label: string; desc: string }[] = [
  { id: 'vanilla', label: 'Vanilla', desc: 'Czysta gra bez modów.' },
  { id: 'fabric', label: 'Fabric', desc: 'Lekki, szybko aktualizowany. Najwięcej nowych modów.' },
  { id: 'forge', label: 'Forge', desc: 'Najstarszy ekosystem, ogromna biblioteka modów.' },
  { id: 'neoforge', label: 'NeoForge', desc: 'Następca Forge, od Minecraft 1.20.1.' },
];

export function WizardPage() {
  const { setPage, pushToast, refreshInstances, selectInstance, settings } = useStore();

  const [versions, setVersions] = useState<ManifestVersion[]>([]);
  const [query, setQuery] = useState('');
  const [mcVersion, setMcVersion] = useState('');
  const [loader, setLoader] = useState<LoaderId>('vanilla');
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [loaderError, setLoaderError] = useState('');
  const [loadingLoaders, setLoadingLoaders] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [installNow, setInstallNow] = useState(true);

  useEffect(() => {
    void call<{ versions: ManifestVersion[]; latest: { release: string } }>('mc:versions', {})
      .then((res) => {
        setVersions(res.versions);
        if (!mcVersion) setMcVersion(res.latest.release || res.versions[0]?.id || '');
      })
      .catch((e) => pushToast('error', (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loader === 'vanilla' || !mcVersion) {
      setLoaderVersions([]);
      setLoaderVersion('');
      setLoaderError('');
      return;
    }
    setLoadingLoaders(true);
    setLoaderError('');
    void call<LoaderVersion[]>('loader:versions', { loader, mcVersion })
      .then((list) => {
        setLoaderVersions(list);
        setLoaderVersion(list.find((l) => l.recommended)?.version ?? list[0]?.version ?? '');
      })
      .catch((e) => {
        setLoaderVersions([]);
        setLoaderVersion('');
        setLoaderError((e as Error).message);
      })
      .finally(() => setLoadingLoaders(false));
  }, [loader, mcVersion]);

  useEffect(() => {
    if (!name && mcVersion) {
      setName(loader === 'vanilla' ? `Minecraft ${mcVersion}` : `${mcVersion} ${loader}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcVersion, loader]);

  const filtered = versions.filter((v) => v.id.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 400);

  const create = async () => {
    setBusy(true);
    try {
      const inst = await call<{ id: string }>('instances:create', {
        name: name.trim() || `Minecraft ${mcVersion}`,
        mcVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion,
      });
      selectInstance(inst.id);
      await refreshInstances();
      pushToast('success', 'Instancja utworzona.');
      if (installNow) {
        pushToast('info', 'Pobieram pliki gry…');
        await call('instances:install', { id: inst.id });
      }
      setPage('home');
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canCreate = Boolean(mcVersion) && (loader === 'vanilla' || Boolean(loaderVersion));

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1 className="page-title">Nowa instancja</h1>
        <p className="page-sub">
          Wersje pochodzą z oficjalnego manifestu Mojang. Pliki gry są pobierane dopiero po wybraniu wersji —
          NightMC nie zawiera żadnych plików Minecrafta.
        </p>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="1. Wersja Minecrafta" subtitle={`Widocznych wersji: ${versions.length}. Snapshoty i wersje archiwalne włączysz w Ustawieniach.`}>
          <div className="row" style={{ marginBottom: 12 }}>
            <IconSearch size={16} />
            <input
              className="input"
              placeholder="Szukaj wersji, np. 1.21"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto' }} className="list">
            {filtered.map((v) => (
              <button
                key={v.id}
                className={`list-item${v.id === mcVersion ? ' ' : ''}`}
                style={{
                  cursor: 'pointer',
                  borderColor: v.id === mcVersion ? 'var(--violet)' : undefined,
                  background: v.id === mcVersion ? 'rgba(139,108,255,.12)' : undefined,
                }}
                onClick={() => setMcVersion(v.id)}
              >
                <span className="list-title">{v.id}</span>
                <div className="spacer" />
                <Chip tone={v.type === 'release' ? 'ok' : v.type === 'snapshot' ? 'warn' : 'dim'}>{v.type}</Chip>
                {v.id === mcVersion && <IconCheck size={16} />}
              </button>
            ))}
          </div>
        </Card>

        <div className="grid" style={{ gap: 16 }}>
          <Card title="2. Modloader">
            <div className="grid" style={{ gap: 8 }}>
              {LOADERS.map((l) => (
                <button
                  key={l.id}
                  className="list-item"
                  style={{
                    cursor: 'pointer',
                    borderColor: loader === l.id ? 'var(--violet)' : undefined,
                    background: loader === l.id ? 'rgba(139,108,255,.12)' : undefined,
                  }}
                  onClick={() => setLoader(l.id)}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div className="list-title">{l.label}</div>
                    <div className="list-sub">{l.desc}</div>
                  </div>
                </button>
              ))}
            </div>

            {loader !== 'vanilla' && (
              <div style={{ marginTop: 14 }}>
                {loadingLoaders ? (
                  <div className="skeleton" style={{ height: 38 }} />
                ) : loaderError ? (
                  <Banner kind="err">{loaderError}</Banner>
                ) : (
                  <Field label={`Wersja ${loader}`} hint="Zalecana wersja jest wybrana automatycznie.">
                    <select className="select" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)}>
                      {loaderVersions.map((lv) => (
                        <option key={lv.version} value={lv.version}>
                          {lv.version}
                          {lv.recommended ? ' — zalecana' : ''}
                          {!lv.stable ? ' (beta)' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            )}
          </Card>

          <Card title="3. Nazwa i start">
            <Field label="Nazwa instancji">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
            </Field>
            <Field label="Pamięć" hint={`Domyślnie ${settings?.defaultMemoryMin ?? 1024}–${settings?.defaultMemoryMax ?? 4096} MB. Zmienisz to później w edycji instancji.`}>
              <div className="row wrap" style={{ gap: 6 }}>
                <Chip tone="dim">{settings?.defaultMemoryMin ?? 1024} MB min</Chip>
                <Chip tone="dim">{settings?.defaultMemoryMax ?? 4096} MB max</Chip>
              </div>
            </Field>
            <div className="row wrap" style={{ alignItems: 'center', marginTop: 16 }}>
              <label className="switch">
                <input type="checkbox" checked={installNow} onChange={(e) => setInstallNow(e.target.checked)} />
                <span className="track" />
                <span>Pobierz pliki od razu po utworzeniu</span>
              </label>
              <div className="spacer" />
              <Button variant="primary" onClick={() => void create()} disabled={!canCreate || busy}>
                {busy ? 'Tworzę…' : 'Utwórz instancję'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
