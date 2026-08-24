/** Konta: Microsoft Premium + profile Offline / Non-Premium. */

import { useState } from 'react';
import { call } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, ConfirmModal, Empty, Field, Modal } from '../components/UI.js';
import { IconCheck, IconRefresh, IconTrash, IconUser } from '../components/Icons.js';
import { OFFLINE_MULTIPLAYER_WARNING, OFFLINE_PROFILE_NOTE } from '../../shared/constants.js';
import type { Account } from '../../shared/types.js';

export function AccountsPage() {
  const { accounts, authConfigured, pushToast, refreshAccounts, system } = useStore();
  const [addingOffline, setAddingOffline] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);

  const login = async () => {
    setBusy(true);
    pushToast('info', 'Otwieram stronę logowania Microsoft w przeglądarce…');
    try {
      await call('accounts:loginMicrosoft');
      await refreshAccounts();
      pushToast('success', 'Zalogowano konto Microsoft.');
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1 className="page-title">Konta</h1>
        <p className="page-sub">
          Logowanie Microsoft odbywa się wyłącznie na oficjalnej stronie Microsoft, w Twojej systemowej przeglądarce.
          NightMC nigdy nie widzi ani nie zapisuje Twojego hasła. Tokeny trafiają do magazynu poświadczeń systemu
          ({system?.secretsBackend === 'keytar' ? 'Menedżer poświadczeń Windows' : 'Electron safeStorage / DPAPI'}),
          nigdy do bazy danych, plików JSON ani logów.
        </p>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Dodaj profil">
          <div className="grid" style={{ gap: 12 }}>
            <Button variant="primary" onClick={() => void login()} disabled={busy || !authConfigured}>
              Zaloguj przez Microsoft
            </Button>
            <Button onClick={() => setAddingOffline(true)}>Dodaj profil Offline / Non-Premium</Button>
          </div>

          {!authConfigured && (
            <div style={{ marginTop: 16 }}>
              <Banner>
                Logowanie Microsoft wymaga własnego Client ID z Microsoft Entra. Uzupełnij
                <code> NIGHTMC_MS_CLIENT_ID</code> w pliku <code>.env</code> i zbuduj launcher ponownie
                (dokładna instrukcja jest w README i w <code>.env.example</code>).
                Profile Offline / Non-Premium działają bez żadnej konfiguracji.
              </Banner>
            </div>
          )}
        </Card>

        <Card title="Czym różnią się profile">
          <div className="list">
            <div className="list-item" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="list-title">Konto Microsoft Premium</div>
                <div className="list-sub" style={{ marginTop: 4, lineHeight: 1.6 }}>
                  Pełny dostęp: serwery z online-mode=true, oficjalna skórka, weryfikacja posiadania
                  Minecraft Java Edition.
                </div>
              </div>
            </div>
            <div className="list-item" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="list-title">Profil Offline / Non-Premium</div>
                <div className="list-sub" style={{ marginTop: 4, lineHeight: 1.6 }}>
                  Pełnoprawny profil: wersje z manifestu Mojang, Fabric/Forge/NeoForge, mody z Modrinth,
                  paczki, resource packi, shadery, singleplayer, LAN i serwery z online-mode=false.
                  {' '}{OFFLINE_PROFILE_NOTE}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ height: 20 }} />

      <Card title={`Twoje profile (${accounts.length})`}>
        {accounts.length === 0 ? (
          <Empty icon={<IconUser size={38} />} title="Brak profili" hint="Dodaj konto Microsoft albo profil Offline, żeby móc uruchomić grę." />
        ) : (
          <div className="list">
            {accounts.map((a) => (
              <div key={a.id} className="list-item">
                <div className="inst-icon" style={{ width: 40, height: 40 }}><IconUser size={18} /></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-title">{a.username}</div>
                  <div className="list-sub" style={{ fontFamily: 'monospace', marginTop: 3 }}>{a.uuid}</div>
                </div>
                {a.type === 'offline' ? (
                  <Chip tone="dim">OFFLINE / NON-PREMIUM</Chip>
                ) : a.ownsGame ? (
                  <Chip tone="ok">MICROSOFT PREMIUM</Chip>
                ) : (
                  <Chip tone="warn">MICROSOFT — brak Java Edition</Chip>
                )}
                {a.active && <Chip tone="cyan"><IconCheck size={12} /> aktywny</Chip>}
                {!a.active && (
                  <Button small onClick={() => void call('accounts:setActive', { id: a.id }).then(refreshAccounts)}>
                    Ustaw aktywny
                  </Button>
                )}
                {a.type === 'microsoft' && (
                  <Button
                    small
                    variant="ghost"
                    title="Odśwież sesję"
                    onClick={() =>
                      void call('accounts:refresh', { id: a.id })
                        .then(() => { pushToast('success', 'Sesja odświeżona.'); return refreshAccounts(); })
                        .catch((e) => pushToast('error', (e as Error).message))
                    }
                  >
                    <IconRefresh size={14} />
                  </Button>
                )}
                <Button small variant="danger" onClick={() => setRemoving(a)}><IconTrash size={14} /></Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {addingOffline && (
        <AddOfflineModal
          onClose={() => setAddingOffline(false)}
          onSaved={() => {
            setAddingOffline(false);
            void refreshAccounts();
          }}
        />
      )}

      {removing && (
        <ConfirmModal
          title="Usunąć profil?"
          danger
          confirmLabel="Usuń profil"
          message={
            removing.type === 'microsoft'
              ? `Profil "${removing.username}" zostanie usunięty, a jego tokeny trwale skasowane z magazynu poświadczeń systemu.`
              : `Profil offline "${removing.username}" zostanie usunięty. Światy i mody instancji pozostaną nietknięte, a ponowne dodanie tego samego nicku da ten sam UUID.`
          }
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            void call('accounts:remove', { id }).then(refreshAccounts).catch((e) => pushToast('error', (e as Error).message));
          }}
        />
      )}
    </div>
  );
}

function AddOfflineModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { pushToast } = useStore();
  const [username, setUsername] = useState('');
  const [skinPath, setSkinPath] = useState('');
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(username);

  return (
    <Modal
      title="Profil Offline / Non-Premium"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() =>
              void call('accounts:addOffline', { username, skinPath: skinPath || undefined })
                .then(onSaved)
                .catch((e) => pushToast('error', (e as Error).message))
            }
          >
            Dodaj profil
          </Button>
        </>
      }
    >
      <Field
        label="Nazwa gracza"
        hint="3–16 znaków: litery, cyfry i podkreślenie. Ten sam nick zawsze otrzyma ten sam, stabilny UUID offline."
      >
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={16} autoFocus />
      </Field>

      <Field label="Lokalna skórka (opcjonalnie)" hint="Plik PNG 64×64. Skórka lokalna jest widoczna tylko dla Ciebie.">
        <div className="row">
          <input className="input" value={skinPath} readOnly placeholder="nie wybrano" />
          <Button
            onClick={() =>
              void call<string | null>('accounts:pickSkin').then((p) => p && setSkinPath(p)).catch(() => undefined)
            }
          >
            Wybierz
          </Button>
        </div>
      </Field>

      <Banner>{OFFLINE_MULTIPLAYER_WARNING}</Banner>
      <p className="card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
        Profil jest wyraźnie oznaczony jako OFFLINE / NON-PREMIUM i nigdy nie jest pokazywany jako zweryfikowane
        konto Microsoft. NightMC nie tworzy fałszywej sesji premium i nie obchodzi weryfikacji na serwerach
        z online-mode=true.
      </p>
    </Modal>
  );
}
