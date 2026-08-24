/** Przeglądarka oficjalnych wersji Minecrafta z manifestu Mojang. */

import { useEffect, useState } from 'react';
import { call, formatDate } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Button, Card, Chip, Field } from '../components/UI.js';
import { IconRefresh, IconSearch } from '../components/Icons.js';
import type { ManifestVersion, VersionJson } from '../../shared/types.js';

export function VersionsPage() {
  const { settings, refreshSettings, pushToast, setPage } = useStore();
  const [versions, setVersions] = useState<ManifestVersion[]>([]);
  const [latest, setLatest] = useState({ release: '', snapshot: '' });
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<VersionJson | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      const res = await call<{ versions: ManifestVersion[]; latest: { release: string; snapshot: string }; all: number }>(
        'mc:versions',
        { refresh },
      );
      setVersions(res.versions);
      setLatest(res.latest);
      setTotal(res.all);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.showSnapshots, settings?.showOldVersions]);

  const toggle = async (patch: Record<string, boolean>) => {
    await call('settings:set', { patch });
    await refreshSettings();
  };

  const filtered = versions.filter((v) => v.id.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="fade-in">
      <div className="page-head row">
        <div>
          <h1 className="page-title">Wersje Minecrafta</h1>
          <p className="page-sub">
            Dane pochodzą wyłącznie z oficjalnego manifestu Mojang
            (piston-meta.mojang.com). NightMC nie scrapuje stron internetowych.
          </p>
        </div>
        <div className="spacer" />
        <Button onClick={() => void load(true)}><IconRefresh size={16} /> Odśwież</Button>
      </div>

      <Card tight>
        <div className="row wrap" style={{ gap: 18 }}>
          <div className="row">
            <IconSearch size={16} />
            <input className="input" style={{ width: 240 }} placeholder="Szukaj wersji" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <label className="switch">
            <input type="checkbox" checked={settings?.showSnapshots ?? false} onChange={(e) => void toggle({ showSnapshots: e.target.checked })} />
            <span className="track" /><span>Snapshoty</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={settings?.showOldVersions ?? false} onChange={(e) => void toggle({ showOldVersions: e.target.checked })} />
            <span className="track" /><span>old_beta / old_alpha</span>
          </label>
          <div className="spacer" />
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {filtered.length} z {total} · najnowsze wydanie {latest.release}
          </span>
        </div>
      </Card>

      <div style={{ height: 16 }} />

      <Card>
        {loading ? (
          <div className="grid" style={{ gap: 8 }}>
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}
          </div>
        ) : (
          <div className="list" style={{ maxHeight: 'calc(100vh - 330px)', overflowY: 'auto' }}>
            {filtered.map((v) => (
              <div key={v.id} className="list-item">
                <div style={{ minWidth: 110 }}>
                  <div className="list-title">{v.id}</div>
                  <div className="list-sub">{formatDate(v.releaseTime)}</div>
                </div>
                <Chip tone={v.type === 'release' ? 'ok' : v.type === 'snapshot' ? 'warn' : 'dim'}>{v.type}</Chip>
                {v.id === latest.release && <Chip tone="cyan">najnowsza</Chip>}
                <div className="spacer" />
                <Button
                  small
                  variant="ghost"
                  onClick={() =>
                    void call<VersionJson>('mc:versionDetail', { versionId: v.id })
                      .then(setDetail)
                      .catch((e) => pushToast('error', (e as Error).message))
                  }
                >
                  Szczegóły
                </Button>
                <Button small onClick={() => setPage('wizard')}>Utwórz instancję</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {detail && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="modal">
            <h2>Metadane wersji {detail.id}</h2>
            <div className="grid cols-2" style={{ marginTop: 16 }}>
              <Field label="Klasa główna"><code>{detail.mainClass}</code></Field>
              <Field label="Wymagana Java"><code>{detail.javaVersion?.majorVersion ?? 'nie zadeklarowano (heurystyka)'}</code></Field>
              <Field label="Indeks assetów"><code>{detail.assetIndex?.id ?? detail.assets ?? '—'}</code></Field>
              <Field label="Bibliotek"><code>{detail.libraries?.length ?? 0}</code></Field>
              <Field label="Format argumentów"><code>{detail.arguments ? 'nowy (1.13+)' : 'klasyczny (minecraftArguments)'}</code></Field>
              <Field label="Rozmiar klienta">
                <code>{detail.downloads?.['client']?.size ? `${Math.round(detail.downloads['client'].size / 1024 / 1024)} MiB` : '—'}</code>
              </Field>
            </div>
            <div className="modal-actions">
              <Button onClick={() => setDetail(null)}>Zamknij</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
