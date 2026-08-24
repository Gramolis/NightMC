/** O programie: wersja, aktualizacje, usługi sieciowe, licencje, zgodność prawna. */

import { useEffect, useState } from 'react';
import { call, formatBytes, formatDate } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, DownloadPanel, Stat } from '../components/UI.js';
import { Logo } from '../components/Logo.js';
import { IconDownload, IconRefresh } from '../components/Icons.js';
import { LEGAL_DISCLAIMER, ENDPOINTS } from '../../shared/constants.js';
import type { ChangelogDocument, UpdateInfo } from '../../shared/types.js';

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  url: string;
}

function plainMarkdown(line: string): string {
  return line
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1');
}

function ChangelogContent({ content }: { content: string }) {
  return (
    <div className="github-changelog">
      {content.split('\n').map((raw, index) => {
        const line = raw.trim();
        if (!line || /^\[[^\]]+]:\s+https:\/\//.test(line)) return null;
        if (line.startsWith('# ')) return <div key={index} className="changelog-main-title">{plainMarkdown(line.slice(2))}</div>;
        if (line.startsWith('## ')) return <div key={index} className="changelog-version">{plainMarkdown(line.slice(3))}</div>;
        if (line.startsWith('### ')) return <h3 key={index} className="changelog-group">{plainMarkdown(line.slice(4))}</h3>;
        if (line.startsWith('- ')) return <div key={index} className="changelog-entry"><span>•</span><p>{plainMarkdown(line.slice(2))}</p></div>;
        return <p key={index} className="changelog-paragraph">{plainMarkdown(line)}</p>;
      })}
    </div>
  );
}

export function AboutPage() {
  const { system, update, progress, pushToast } = useStore();
  const [licenses, setLicenses] = useState<{ libraries: LicenseEntry[]; sources: LicenseEntry[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(update);
  const [tab, setTab] = useState<'update' | 'changelog' | 'network' | 'licenses' | 'legal'>('update');
  const [changelog, setChangelog] = useState<ChangelogDocument | null>(null);
  const [loadingChangelog, setLoadingChangelog] = useState(false);

  useEffect(() => {
    void call<{ libraries: LicenseEntry[]; sources: LicenseEntry[] }>('app:licenses').then(setLicenses).catch(() => undefined);
  }, []);

  const loadChangelog = (refresh = false) => {
    setLoadingChangelog(true);
    void call<ChangelogDocument>('changelog:get', { refresh })
      .then(setChangelog)
      .catch((e) => pushToast('error', (e as Error).message))
      .finally(() => setLoadingChangelog(false));
  };

  useEffect(() => {
    if (tab === 'changelog' && !changelog && !loadingChangelog) loadChangelog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const open = (url: string) => void call('app:openExternal', { url }).catch(() => undefined);

  const installAvailableUpdate = () => {
    setInstallingUpdate(true);
    void call<{ downloaded: boolean; installing?: boolean; file?: string }>('updates:download')
      .then((result) => {
        if (result.installing) {
          pushToast('success', 'Aktualizacja zweryfikowana. NightMC zamknie się, podmieni pliki i uruchomi ponownie.');
        } else if (result.downloaded) {
          pushToast('success', `Pobrano i zweryfikowano: ${result.file}`);
          setInstallingUpdate(false);
        } else {
          pushToast('success', 'Masz najnowszą wersję.');
          setInstallingUpdate(false);
        }
      })
      .catch((e) => {
        pushToast('error', (e as Error).message);
        setInstallingUpdate(false);
      });
  };

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
        <button className={`tab${tab === 'changelog' ? ' active' : ''}`} onClick={() => setTab('changelog')}>Changelog</button>
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
                  disabled={installingUpdate}
                  onClick={installAvailableUpdate}
                >
                  <IconDownload size={15} /> {installingUpdate ? 'Aktualizuję…' : 'Pobierz i zainstaluj'}
                </Button>
              )}
              {info?.htmlUrl && <Button variant="ghost" onClick={() => open(info.htmlUrl!)}>Zobacz wydanie</Button>}
            </div>

            {progress && <div style={{ marginTop: 16 }}><DownloadPanel progress={progress} /></div>}

            <div style={{ marginTop: 16 }}>
              <Banner kind="info">
                Instalator jest pobierany po HTTPS i weryfikowany sumą SHA-256 oraz opcjonalnym podpisem Ed25519.
                Po weryfikacji NightMC automatycznie zamknie się, podmieni pliki i uruchomi nową wersję. Twoje
                instancje, konta, ustawienia, mody i światy pozostają w katalogu danych i nie są usuwane.
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

      {tab === 'changelog' && (
        <Card
          title="Changelog NightMC"
          subtitle="Aktualizowany automatycznie z pliku CHANGELOG.md w repozytorium NightMC."
          actions={
            <div className="row wrap" style={{ gap: 8 }}>
              {changelog?.fromCache && <Chip tone="warn">kopia offline</Chip>}
              <Button small disabled={loadingChangelog} onClick={() => loadChangelog(true)}>
                <IconRefresh size={14} /> {loadingChangelog ? 'Odświeżam…' : 'Odśwież z GitHuba'}
              </Button>
              {changelog?.sourceUrl && <Button small variant="ghost" onClick={() => open(changelog.sourceUrl)}>Otwórz na GitHubie</Button>}
            </div>
          }
        >
          {loadingChangelog && !changelog ? (
            <div className="grid" style={{ gap: 9 }}>
              {Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton" style={{ height: index === 0 ? 54 : 34 }} />)}
            </div>
          ) : changelog ? (
            <>
              <div className="changelog-sync-row">
                Źródło: GitHub · pobrano {formatDate(changelog.fetchedAt)}
              </div>
              <ChangelogContent content={changelog.content} />
            </>
          ) : (
            <Banner kind="info">Changelog nie został jeszcze pobrany.</Banner>
          )}
        </Card>
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
