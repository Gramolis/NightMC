/** Lista serwerów offline + „Uruchom i dołącz”. */

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { useActiveAccount, useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, ConfirmModal, Empty, Field, Modal } from '../components/UI.js';
import { IconPlay, IconServer, IconTrash } from '../components/Icons.js';
import { OFFLINE_MULTIPLAYER_WARNING, OFFLINE_PROFILE_NOTE } from '../../shared/constants.js';
import type { ServerEntry } from '../../shared/types.js';

export function ServersPage() {
  const { instances, pushToast, selectInstance, setPage } = useStore();
  const account = useActiveAccount();
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ServerEntry | null>(null);
  const [status, setStatus] = useState<Record<string, { online: boolean; latencyMs?: number }>>({});

  const load = async () => setServers(await call<ServerEntry[]>('servers:list'));

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const ping = async (s: ServerEntry) => {
    const res = await call<{ online: boolean; latencyMs?: number }>('servers:ping', { address: s.address, port: s.port });
    setStatus((prev) => ({ ...prev, [s.id]: res }));
  };

  const joinServer = async (s: ServerEntry) => {
    const instanceId = s.instanceId ?? instances[0]?.id;
    if (!instanceId) {
      pushToast('error', 'Najpierw utwórz instancję.');
      return;
    }
    selectInstance(instanceId);
    try {
      await call('game:launch', { instanceId, serverId: s.id });
      setPage('home');
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-head row">
        <div>
          <h1 className="page-title">Serwery</h1>
          <p className="page-sub">
            NightMC nie potrafi odczytać ustawienia <code>online-mode</code> serwera — protokół tego nie udostępnia
            i nie udajemy, że jest inaczej. To Ty oznaczasz zaufany serwer jako działający z online-mode=false.
          </p>
        </div>
        <div className="spacer" />
        <Button variant="primary" onClick={() => setAdding(true)}>Dodaj serwer</Button>
      </div>

      {account?.type === 'offline' && (
        <div className="grid" style={{ gap: 10, marginBottom: 18 }}>
          <Banner>{OFFLINE_PROFILE_NOTE}</Banner>
          <Banner kind="info">{OFFLINE_MULTIPLAYER_WARNING}</Banner>
        </div>
      )}

      {servers.length === 0 ? (
        <Empty icon={<IconServer size={40} />} title="Brak serwerów" hint="Dodaj adres serwera, żeby uruchamiać grę i dołączać jednym kliknięciem." />
      ) : (
        <div className="grid cols-2">
          {servers.map((s) => (
            <Card key={s.id} tight>
              <div className="row">
                <div className="inst-icon" style={{ width: 40, height: 40 }}><IconServer size={18} /></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-title">{s.name}</div>
                  <div className="list-sub">{s.address}:{s.port}</div>
                </div>
                <Button small variant="danger" onClick={() => setRemoving(s)}><IconTrash size={14} /></Button>
              </div>

              {s.description && <p className="card-sub" style={{ margin: '10px 0 0' }}>{s.description}</p>}

              <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
                {s.userMarkedOffline ? <Chip tone="warn">oznaczony jako online-mode=false</Chip> : <Chip tone="dim">tryb nieokreślony</Chip>}
                {s.mcVersion && <Chip tone="dim">MC {s.mcVersion}</Chip>}
                {status[s.id] && (
                  <Chip tone={status[s.id]!.online ? 'ok' : 'err'}>
                    {status[s.id]!.online ? `osiągalny (${status[s.id]!.latencyMs} ms)` : 'nieosiągalny'}
                  </Chip>
                )}
              </div>

              {account?.type === 'offline' && !s.userMarkedOffline && (
                <div style={{ marginTop: 12 }}>
                  <Banner>
                    Profil offline dołączy tylko wtedy, gdy serwer faktycznie działa z online-mode=false.
                    Jeśli tak jest, oznacz to w edycji serwera.
                  </Banner>
                </div>
              )}

              <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
                <Button small variant="primary" onClick={() => void joinServer(s)}><IconPlay size={14} /> Uruchom i dołącz</Button>
                <Button small onClick={() => void ping(s).catch(() => undefined)}>Sprawdź dostępność</Button>
                <Button
                  small
                  variant="ghost"
                  onClick={() =>
                    void call('servers:update', { id: s.id, patch: { userMarkedOffline: !s.userMarkedOffline } })
                      .then(load)
                      .catch((e) => pushToast('error', (e as Error).message))
                  }
                >
                  {s.userMarkedOffline ? 'Usuń oznaczenie' : 'Oznacz jako offline'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding && (
        <AddServerModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {removing && (
        <ConfirmModal
          title="Usunąć serwer z listy?"
          danger
          message={`Wpis "${removing.name}" zostanie usunięty z listy NightMC. Nie wpływa to na sam serwer.`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void call('servers:remove', { id }).then(load);
          }}
        />
      )}
    </div>
  );
}

function AddServerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { instances, pushToast } = useStore();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [port, setPort] = useState(25565);
  const [description, setDescription] = useState('');
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? '');
  const [markedOffline, setMarkedOffline] = useState(false);

  const save = async () => {
    try {
      await call('servers:add', {
        name: name.trim(),
        address: address.trim(),
        port,
        description: description.trim() || undefined,
        instanceId: instanceId || undefined,
        userMarkedOffline: markedOffline,
      });
      onSaved();
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  return (
    <Modal
      title="Nowy serwer"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button variant="primary" disabled={!name.trim() || !address.trim()} onClick={() => void save()}>Dodaj</Button>
        </>
      }
    >
      <Field label="Nazwa"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} /></Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Adres"><input className="input" placeholder="np. mc.przyklad.pl" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Port"><input className="input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></Field>
      </div>
      <Field label="Opis (opcjonalnie)"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></Field>
      {instances.length > 0 && (
        <Field label="Instancja używana do połączenia">
          <select className="select" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
            <option value="">— dowolna —</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.mcVersion})</option>)}
          </select>
        </Field>
      )}
      <Field label="Tryb serwera" hint="Zaznacz tylko dla serwerów, o których wiesz, że działają z online-mode=false. NightMC tego nie sprawdza i nie obchodzi weryfikacji.">
        <label className="switch">
          <input type="checkbox" checked={markedOffline} onChange={(e) => setMarkedOffline(e.target.checked)} />
          <span className="track" />
          <span>Ten serwer działa z online-mode=false</span>
        </label>
      </Field>
    </Modal>
  );
}
