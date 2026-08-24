/** O programie: wersja, aktualizacje, usługi sieciowe, licencje, zgodność prawna. */

import { useEffect, useState } from 'react';
import { call, formatBytes, formatDate } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, DownloadPanel, Stat } from '../components/UI.js';
import { Logo } from '../components/Logo.js';
import { IconDownload, IconRefresh } from '../components/Icons.js';
import { LEGAL_DISCLAIMER, ENDPOINTS } from '../../shared/constants.js';
import type { UpdateInfo } from '../../shared/types.js';

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  url: string;
}

export function AboutPage() {
  const { system, update, progress, pushToast } = useStore();
  const [licenses, setLicenses] = useState<{ libraries: LicenseEntry[]; sources: LicenseEntry[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(update);
  const [tab, setTab] = useState<'update' | 'network' | 'licenses' | 'legal'>('update');

  useEffect(() => {
    void call<{ libraries: LicenseEntry[]; sources: LicenseEntry[] }>('app:licenses').then(setLicenses).catch(() => undefined);
  }, []);

  const open = (url: string) => void call('app:openExternal', { url }).catch(() => undefined);

  return (
    <div className="fade-in">
      <div className="page-head row">
        <Logo size={54} />
        <div>
          <h1 className="page-title">NightMC {system?.appVersion}</h1>
          <p className="page-sub" style={{ marginTop: 4 }}>{LEGAL_DISCLAIMER}</p>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'update' ? ' active' : ''}`} onClick={() => setTab('update')}>Aktualizacje</button>
        <button className={`tab${tab === 'network' ? ' active' : ''}`} onClick={() => setTab('network')}>Usługi sieciowe</button>
        <button className={`tab${tab === 'licenses' ? ' active' : ''}`} onClick={() => setTab('licenses')}>Licencje</button>
        <button className={`tab${tab === 'legal' ? ' active' : ''}`} onClick={() => setTab('legal')}>Zgodność prawna</button>
      </div>

      {tab === 'update' && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <Card title="Aktualizacje">
            <div className="row wrap" style={{ gap: 20, marginBottom: 16 }}>
              <Stat label="Zainstalowana" value={system?.appVersion ?? '—'} />
              <Stat label="Najnowsza" value={info?.latestVersion ?? '—'} />
              {info?.size ? <Stat label="Rozmiar" value={formatBytes(info.size)} /> : null}
              {info?.publishedAt ? <Stat label="Wydano" value={formatDate(info.publishedAt)} /> : null}
            </div>

            <div className="row wrap" style={{ gap: 8 }}>
              <Button
                disabled={checking}
                onClick={() => {
                  setChecking(true);
                  void call<UpdateInfo>('updates:check')
                    .then((res) => {
                      setInfo(res);
                      pushToast(res.available ? 'info' : 'success', res.available ? `Dostępna wersja ${res.latestVersion}` : 'Masz najnowszą wersję.');
                    })
                    .catch((e) => pushToast('error', (e as Error).message))
                    .finally(() => setChecking(false));
                }}
              >
                <IconRefresh size={15} /> Sprawdź teraz
              </Button>
              {info?.available && (
                <Button
                  variant="primary"
                  onClick={() =>
                    void call<{ downloaded: boolean; file?: string }>('updates:download')
                      .then((r) => pushToast('success', r.downloaded ? `Pobrano i zweryfikowano: ${r.file}` : 'Masz najnowszą wersję.'))
                      .catch((e) => pushToast('error', (e as Error).message))
                  }
                >
                  <IconDownload size={15} /> Pobierz aktualizację
                </Button>
              )}
              {info?.htmlUrl && <Button variant="ghost" onClick={() => open(info.htmlUrl!)}>Zobacz wydanie</Button>}
            </div>

            {progress && <div style={{ marginTop: 16 }}><DownloadPanel progress={progress} /></div>}

            <div style={{ marginTop: 16 }}>
              <Banner kind="info">
                Plik jest pobierany po HTTPS do katalogu tymczasowego i weryfikowany sumą SHA-256
                (oraz podpisem Ed25519, jeśli wydanie go zawiera). Portable EXE nie podmienia sam siebie
                w trakcie działania — po weryfikacji NightMC otworzy katalog z nowym plikiem.
              </Banner>
            </div>
          </Card>

          {info?.changelog && (
            <Card title={`Changelog ${info.latestVersion}`}>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-dim)', margin: 0, userSelect: 'text' }}>
                {info.changelog}
              </pre>
            </Card>
          )}
        </div>
      )}

      {tab === 'network' && (
        <Card title="Z czym łączy się NightMC" subtitle="NightMC nie ma własnego backendu ani telemetrii. Nie wysyła nigdzie Twoich haseł, tokenów, logów, listy serwerów, listy modów ani nazw katalogów.">
          <div className="list">
            {(system?.networkServices ?? []).map((s) => (
              <div key={s.name} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-title">{s.name}</div>
                  <div className="list-sub" style={{ marginTop: 4 }}>{s.purpose}</div>
                  <div className="list-sub" style={{ marginTop: 4, fontFamily: 'monospace', opacity: 0.7 }}>
                    {s.hosts.join(' · ')}
                  </div>
                </div>
                <Chip tone={s.optional ? 'dim' : 'ok'}>{s.optional ? 'opcjonalne' : 'wymagane'}</Chip>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'licenses' && (
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <Card title="Biblioteki">
            <div className="list">
              {(licenses?.libraries ?? []).map((l) => (
                <div key={l.name} className="list-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="list-title">{l.name}</div>
                    <div className="list-sub">{l.version}</div>
                  </div>
                  <Chip tone="dim">{l.license}</Chip>
                  <Button small variant="ghost" onClick={() => open(l.url)}>źródło</Button>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Źródła danych">
            <div className="list">
              {(licenses?.sources ?? []).map((l) => (
                <div key={l.name} className="list-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="list-title">{l.name}</div>
                    <div className="list-sub">{l.license}</div>
                  </div>
                  <Button small variant="ghost" onClick={() => open(l.url)}>otwórz</Button>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'legal' && (
        <Card title="Zgodność prawna">
          <Banner>{LEGAL_DISCLAIMER}</Banner>
          <div style={{ marginTop: 16, lineHeight: 1.8, color: 'var(--text-dim)', fontSize: 13 }}>
            <p>
              NightMC jest wyłącznie launcherem. Nie zawiera i nigdy nie dystrybuuje plików gry Minecraft ani
              płatnych modów — wszystko pobierane jest bezpośrednio z oficjalnych źródeł Mojang i twórców modów
              w momencie, w którym sam wybierzesz wersję.
            </p>
            <p>
              Pobieranie i używanie plików gry podlega Minecraft EULA oraz Minecraft Usage Guidelines.
              Logo NightMC (półksiężyc z literą „N”) jest oryginalne i nie wykorzystuje żadnych elementów
              marki Minecraft ani Mojang Studios.
            </p>
            <p>
              NightMC nie omija logowania Microsoft, nie tworzy fałszywych kont ani sesji premium
              i nie pozwala profilowi offline wejść na serwer z <code>online-mode=true</code> — takie połączenie
              zostanie odrzucone przez sam serwer, a launcher tego nie obchodzi.
            </p>
          </div>
          <div className="row wrap" style={{ gap: 8, marginTop: 16 }}>
            <Button small onClick={() => open(ENDPOINTS.eula)}>Minecraft EULA</Button>
            <Button small onClick={() => open(ENDPOINTS.usageGuidelines)}>Usage Guidelines</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
