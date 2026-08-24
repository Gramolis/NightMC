/** Przegląd modloaderów i ich wersji dla wybranej wersji gry. */

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, Field } from '../components/UI.js';
import type { LoaderVersion, ManifestVersion } from '../../shared/types.js';

const LOADERS = ['fabric', 'forge', 'neoforge'] as const;

const INFO: Record<string, { name: string; url: string; note: string }> = {
  fabric: {
    name: 'Fabric',
    url: 'https://fabricmc.net/',
    note: 'Profil instalacyjny pobierany z meta.fabricmc.net — instalacja jest natychmiastowa.',
  },
  forge: {
    name: 'MinecraftForge',
    url: 'https://files.minecraftforge.net/',
    note: 'Od 1.13 instalator uruchamia procesory (binary patching). NightMC wykonuje je lokalnie przy pierwszym uruchomieniu instancji.',
  },
  neoforge: {
    name: 'NeoForge',
    url: 'https://neoforged.net/',
    note: 'Dostępny od Minecraft 1.20.1. Instalator działa analogicznie do Forge.',
  },
};

export function LoadersPage() {
  const { pushToast } = useStore();
  const [versions, setVersions] = useState<ManifestVersion[]>([]);
  const [mcVersion, setMcVersion] = useState('');
  const [results, setResults] = useState<Record<string, { list: LoaderVersion[]; error?: string; loading: boolean }>>({});

  useEffect(() => {
    void call<{ versions: ManifestVersion[]; latest: { release: string } }>('mc:versions', {})
      .then((res) => {
        setVersions(res.versions);
        setMcVersion(res.latest.release || res.versions[0]?.id || '');
      })
      .catch((e) => pushToast('error', (e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mcVersion) return;
    for (const loader of LOADERS) {
      setResults((r) => ({ ...r, [loader]: { list: [], loading: true } }));
      void call<LoaderVersion[]>('loader:versions', { loader, mcVersion })
        .then((list) => setResults((r) => ({ ...r, [loader]: { list, loading: false } })))
        .catch((e) => setResults((r) => ({ ...r, [loader]: { list: [], loading: false, error: (e as Error).message } })));
    }
  }, [mcVersion]);

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1 className="page-title">Modloadery</h1>
        <p className="page-sub">
          Zgodność jest sprawdzana na żywo w oficjalnych repozytoriach każdego projektu. NightMC nie zakłada,
          że każda wersja Forge instaluje się tak samo — czyta profil instalacyjny konkretnego wydania.
        </p>
      </div>

      <Card tight>
        <Field label="Wersja Minecrafta">
          <select className="select" style={{ maxWidth: 260 }} value={mcVersion} onChange={(e) => setMcVersion(e.target.value)}>
            {versions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
          </select>
        </Field>
      </Card>

      <div style={{ height: 16 }} />

      <div className="grid cols-3">
        {LOADERS.map((loader) => {
          const state = results[loader];
          const info = INFO[loader]!;
          return (
            <Card key={loader} title={info.name} subtitle={info.note}>
              {state?.loading ? (
                <div className="skeleton" style={{ height: 100 }} />
              ) : state?.error ? (
                <Banner kind="err">{state.error}</Banner>
              ) : (
                <>
                  <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
                    <Chip tone="ok">{state?.list.length ?? 0} wersji</Chip>
                    {state?.list[0] && <Chip tone="cyan">najnowsza {state.list[0].version}</Chip>}
                  </div>
                  <div className="list" style={{ maxHeight: 230, overflowY: 'auto' }}>
                    {(state?.list ?? []).slice(0, 40).map((lv) => (
                      <div key={lv.version} className="list-item" style={{ padding: '7px 11px' }}>
                        <span className="list-title" style={{ fontSize: 12.5 }}>{lv.version}</span>
                        <div className="spacer" />
                        {lv.recommended && <Chip tone="ok">zalecana</Chip>}
                        {!lv.stable && <Chip tone="warn">beta</Chip>}
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div style={{ marginTop: 12 }}>
                <Button small variant="ghost" onClick={() => void call('app:openExternal', { url: info.url })}>
                  Strona projektu
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
