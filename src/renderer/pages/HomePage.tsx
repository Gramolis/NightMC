/** Strona główna: aktywny profil, wybrana instancja, przycisk GRAJ, postęp, aktualności. */

import { useState } from 'react';
import { call, formatDate, formatPlayTime } from '../api.js';
import { useActiveAccount, useSelectedInstance, useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, DownloadPanel, Empty, Modal, Stat } from '../components/UI.js';
import { Logo } from '../components/Logo.js';
import { IconDownload, IconMoon, IconPlay, IconRefresh, IconStop, IconUser } from '../components/Icons.js';
import { LEGAL_DISCLAIMER, OFFLINE_MULTIPLAYER_WARNING, OFFLINE_PROFILE_NOTE } from '../../shared/constants.js';

export function HomePage() {
  const instance = useSelectedInstance();
  const account = useActiveAccount();
  const { instances, gameState, progress, news, update, setPage, pushToast, selectInstance } = useStore();
  const [busy, setBusy] = useState(false);
  const [showOfflineWarning, setShowOfflineWarning] = useState(false);
  const settings = useStore((s) => s.settings);

  const running = gameState.status === 'running' && gameState.instanceId === instance?.id;
  const preparing = gameState.status === 'preparing';
  const lastExit = gameState.status === 'exited' && gameState.instanceId === instance?.id ? gameState : null;

  const doLaunch = async () => {
    if (!instance || !account) return;
    setBusy(true);
    try {
      await call('game:launch', { instanceId: instance.id });
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onPlay = () => {
    if (running) {
      void call('game:stop', { instanceId: instance!.id }).catch(() => undefined);
      return;
    }
    if (account?.type === 'offline' && !settings?.acceptedOfflineWarning) {
      setShowOfflineWarning(true);
      return;
    }
    void doLaunch();
  };

  if (instances.length === 0) {
    return (
      <Empty
        icon={<Logo size={72} />}
        title="Witaj w NightMC"
        hint="Nie masz jeszcze żadnej instancji. Utwórz pierwszą albo zaimportuj gotową paczkę modów."
        action={
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="primary" onClick={() => setPage('wizard')}>Utwórz instancję</Button>
            <Button onClick={() => setPage('packs')}>Importuj paczkę</Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="fade-in">
      <div className="page-head row">
        <div>
          <h1 className="page-title">Strona główna</h1>
          <p className="page-sub">{LEGAL_DISCLAIMER}</p>
        </div>
      </div>

      {update?.available && (
        <div style={{ marginBottom: 16 }}>
          <Banner kind="info">
            Dostępna jest nowa wersja NightMC <strong>{update.latestVersion}</strong> (masz {update.currentVersion}).{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setPage('about'); }}>Przejdź do aktualizacji</a>
          </Banner>
        </div>
      )}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <div className="row" style={{ marginBottom: 16 }}>
              <div className="inst-icon"><IconMoon size={22} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="inst-name" style={{ fontSize: 17 }}>{instance?.name ?? 'Brak instancji'}</div>
                <div className="inst-meta">
                  Minecraft {instance?.mcVersion} · {instance?.loader === 'vanilla' ? 'Vanilla' : instance?.loader}
                  {instance?.loaderVersion ? ` ${instance.loaderVersion}` : ''}
                </div>
              </div>
              <div className="spacer" />
              {instances.length > 1 && (
                <select
                  className="select"
                  style={{ width: 190 }}
                  value={instance?.id ?? ''}
                  onChange={(e) => selectInstance(e.target.value)}
                >
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="row wrap" style={{ gap: 20, marginBottom: 18 }}>
              <Stat label="Mody" value={instance?.modCount ?? 0} />
              <Stat label="Czas gry" value={formatPlayTime(instance?.playTimeSeconds ?? 0)} />
              <Stat label="Ostatnio grano" value={formatDate(instance?.lastPlayedAt)} />
              <Stat label="Pamięć" value={`${instance?.memoryMax ?? 0} MB`} />
              <Stat
                label="Status"
                value={instance?.installed ? <Chip tone="ok">gotowa</Chip> : <Chip tone="warn">do pobrania</Chip>}
              />
            </div>

            <button
              className={`play-btn${running ? ' stop' : ''}`}
              onClick={onPlay}
              disabled={!instance || !account || busy || preparing}
            >
              {running ? <IconStop /> : <IconPlay />}
              {running ? 'ZATRZYMAJ' : preparing ? 'PRZYGOTOWANIE…' : 'GRAJ'}
            </button>

            {!account && (
              <div style={{ marginTop: 14 }}>
                <Banner>
                  Nie wybrano profilu.{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); setPage('accounts'); }}>Dodaj konto Microsoft albo profil Offline</a>.
                </Banner>
              </div>
            )}

            {progress && (
              <div style={{ marginTop: 18 }}>
                <DownloadPanel progress={progress} />
                <div className="row" style={{ marginTop: 10 }}>
                  <div className="spacer" />
                  <Button small variant="ghost" onClick={() => void call('game:cancelDownload').catch(() => undefined)}>
                    Anuluj
                  </Button>
                </div>
              </div>
            )}

            {lastExit?.diagnosis && (
              <div style={{ marginTop: 16 }}>
                <Banner kind="err">
                  <strong>{lastExit.diagnosis.title}</strong>
                  <div style={{ marginTop: 4 }}>{lastExit.diagnosis.hint}</div>
                  {lastExit.diagnosis.detail && (
                    <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11, opacity: 0.8 }}>
                      {lastExit.diagnosis.detail}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Button small onClick={() => setPage('logs')}>Otwórz logi</Button>
                  </div>
                </Banner>
              </div>
            )}
          </Card>

          <Card title="Aktywny profil">
            {account ? (
              <div className="row">
                <div className="inst-icon" style={{ width: 42, height: 42 }}><IconUser size={20} /></div>
                <div>
                  <div className="list-title">{account.username}</div>
                  <div className="list-sub" style={{ marginTop: 3 }}>
                    {account.type === 'offline' ? (
                      <Chip tone="dim">OFFLINE / NON-PREMIUM</Chip>
                    ) : account.ownsGame ? (
                      <Chip tone="ok">MICROSOFT PREMIUM</Chip>
                    ) : (
                      <Chip tone="warn">MICROSOFT — brak Java Edition</Chip>
                    )}
                  </div>
                </div>
                <div className="spacer" />
                <Button small onClick={() => setPage('accounts')}>Zmień</Button>
              </div>
            ) : (
              <Button variant="primary" onClick={() => setPage('accounts')}>Dodaj profil</Button>
            )}
            {account?.type === 'offline' && (
              <p className="card-sub" style={{ marginTop: 14, marginBottom: 0 }}>{OFFLINE_PROFILE_NOTE}</p>
            )}
          </Card>
        </div>

        <Card
          title="Aktualności NightMC"
          actions={
            <Button small variant="ghost" onClick={() => void useStore.getState().bootstrap()}>
              <IconRefresh size={15} />
            </Button>
          }
        >
          {news.length === 0 ? (
            <p className="card-sub" style={{ marginBottom: 0 }}>
              Brak aktualności. Skonfiguruj adres pliku news.json (zmienna NIGHTMC_NEWS_URL) albo po prostu graj —
              brak aktualności niczego nie blokuje.
            </p>
          ) : (
            <div className="list">
              {news.slice(0, 6).map((item) => (
                <div key={item.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="list-title">{item.title}</div>
                    <div className="list-sub" style={{ marginTop: 4, lineHeight: 1.55 }}>{item.description}</div>
                    <div className="list-sub" style={{ marginTop: 6, opacity: 0.75 }}>{formatDate(item.publishedAt)}</div>
                    {item.url && (
                      <a
                        href="#"
                        style={{ fontSize: 12 }}
                        onClick={(e) => {
                          e.preventDefault();
                          void call('app:openExternal', { url: item.url }).catch(() => undefined);
                        }}
                      >
                        Czytaj więcej
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {showOfflineWarning && (
        <Modal
          title="Gra w trybie offline"
          onClose={() => setShowOfflineWarning(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setShowOfflineWarning(false)}>Anuluj</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setShowOfflineWarning(false);
                  void call('settings:set', { patch: { acceptedOfflineWarning: true } })
                    .then(() => useStore.getState().refreshSettings());
                  void doLaunch();
                }}
              >
                Rozumiem, graj
              </Button>
            </>
          }
        >
          <Banner>{OFFLINE_MULTIPLAYER_WARNING}</Banner>
          <p style={{ color: 'var(--text-dim)', lineHeight: 1.7, marginTop: 14 }}>
            {OFFLINE_PROFILE_NOTE} Singleplayer i gra przez LAN działają bez ograniczeń.
          </p>
        </Modal>
      )}

      <div style={{ marginTop: 22, display: 'flex', gap: 10 }}>
        <Button onClick={() => setPage('wizard')}>Nowa instancja</Button>
        <Button onClick={() => setPage('packs')}><IconDownload size={16} /> Importuj paczkę</Button>
      </div>
    </div>
  );
}
