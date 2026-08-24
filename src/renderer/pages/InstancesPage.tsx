/** Biblioteka instancji: karty, edycja, duplikowanie, naprawa, eksport, usuwanie. */

import { useState } from 'react';
import { call, formatDate, formatPlayTime } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, ConfirmModal, Empty, Field, Modal, Stat } from '../components/UI.js';
import { IconEdit, IconFolder, IconGrid, IconMoon, IconPlus, IconRefresh, IconTrash } from '../components/Icons.js';
import type { Instance } from '../../shared/types.js';

export function InstancesPage() {
  const { instances, selectedInstanceId, selectInstance, setPage, pushToast, refreshInstances, system } = useStore();
  const [editing, setEditing] = useState<Instance | null>(null);
  const [deleting, setDeleting] = useState<Instance | null>(null);
  const [duplicating, setDuplicating] = useState<Instance | null>(null);
  const [dupName, setDupName] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, okMessage: string) => {
    setBusy(true);
    try {
      await fn();
      pushToast('success', okMessage);
      await refreshInstances();
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (instances.length === 0) {
    return (
      <Empty
        icon={<IconGrid size={44} />}
        title="Biblioteka jest pusta"
        hint="Utwórz instancję, żeby wybrać wersję Minecrafta i modloader."
        action={<Button variant="primary" onClick={() => setPage('wizard')}>Utwórz instancję</Button>}
      />
    );
  }

  return (
    <div className="fade-in">
      <div className="page-head row">
        <div>
          <h1 className="page-title">Biblioteka instancji</h1>
          <p className="page-sub">
            Każda instancja ma własne mody, konfiguracje, światy i logi. Biblioteki i assety są współdzielone,
            więc dwie instancje tej samej wersji nie pobierają tych samych plików dwa razy.
          </p>
        </div>
        <div className="spacer" />
        <Button onClick={() => void act(() => call('instances:import'), 'Zaimportowano instancję.')}>Importuj</Button>
        <Button variant="primary" onClick={() => setPage('wizard')}><IconPlus size={16} /> Nowa</Button>
      </div>

      <div className="grid cols-3">
        {instances.map((inst) => (
          <div
            key={inst.id}
            className={`inst-card${inst.id === selectedInstanceId ? ' selected' : ''}`}
            onClick={() => selectInstance(inst.id)}
          >
            <div className="row">
              <div className="inst-icon"><IconMoon size={22} /></div>
              <div style={{ minWidth: 0 }}>
                <div className="inst-name">{inst.name}</div>
                <div className="inst-meta">{inst.mcVersion}</div>
              </div>
            </div>

            <div className="row wrap" style={{ gap: 6 }}>
              <Chip tone={inst.loader === 'vanilla' ? 'dim' : 'violet'}>
                {inst.loader === 'vanilla' ? 'Vanilla' : inst.loader}
              </Chip>
              {inst.modCount ? <Chip tone="cyan">{inst.modCount} modów</Chip> : null}
              {inst.installed ? <Chip tone="ok">gotowa</Chip> : <Chip tone="warn">do pobrania</Chip>}
            </div>

            <div className="inst-meta">
              {formatPlayTime(inst.playTimeSeconds)} · ostatnio {formatDate(inst.lastPlayedAt)}
            </div>

            {inst.lastError && (
              <div className="inst-meta" style={{ color: 'var(--err)' }}>{inst.lastError.slice(0, 90)}</div>
            )}

            <div className="row wrap" style={{ gap: 6, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
              <Button small onClick={() => { selectInstance(inst.id); setPage('home'); }}>Graj</Button>
              <Button small variant="ghost" onClick={() => setEditing(inst)}><IconEdit size={14} /></Button>
              <Button
                small
                variant="ghost"
                title="Otwórz katalog"
                onClick={() => void call('app:openPath', { target: 'instances', instanceId: inst.id })}
              >
                <IconFolder size={14} />
              </Button>
              <Button
                small
                variant="ghost"
                title="Napraw pliki"
                disabled={busy}
                onClick={() => void act(() => call('instances:repair', { id: inst.id }), 'Instancja naprawiona.')}
              >
                <IconRefresh size={14} />
              </Button>
              <Button small variant="danger" onClick={() => setDeleting(inst)}><IconTrash size={14} /></Button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <EditInstanceModal
          instance={editing}
          totalMemoryMB={system?.totalMemoryMB ?? 8192}
          onClose={() => setEditing(null)}
          onDuplicate={() => {
            setDupName(`${editing.name} (kopia)`);
            setDuplicating(editing);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Usunąć instancję?"
          danger
          confirmLabel="Usuń bezpowrotnie"
          message={`Instancja "${deleting.name}" wraz ze światami, modami i konfiguracjami zostanie usunięta z dysku. Tej operacji nie da się cofnąć.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void act(() => call('instances:delete', { id }), 'Instancja usunięta.');
          }}
        />
      )}

      {duplicating && (
        <Modal
          title="Duplikuj instancję"
          onClose={() => setDuplicating(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setDuplicating(null)}>Anuluj</Button>
              <Button
                variant="primary"
                disabled={!dupName.trim()}
                onClick={() => {
                  const id = duplicating.id;
                  const name = dupName.trim();
                  setDuplicating(null);
                  void act(() => call('instances:duplicate', { id, name }), 'Utworzono kopię instancji.');
                }}
              >
                Duplikuj
              </Button>
            </>
          }
        >
          <Field label="Nazwa kopii">
            <input className="input" value={dupName} onChange={(e) => setDupName(e.target.value)} maxLength={64} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

function EditInstanceModal({
  instance,
  totalMemoryMB,
  onClose,
  onDuplicate,
}: {
  instance: Instance;
  totalMemoryMB: number;
  onClose: () => void;
  onDuplicate: () => void;
}) {
  const { pushToast, refreshInstances } = useStore();
  const [name, setName] = useState(instance.name);
  const [memMin, setMemMin] = useState(instance.memoryMin);
  const [memMax, setMemMax] = useState(instance.memoryMax);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs);
  const [width, setWidth] = useState(instance.width ?? 854);
  const [height, setHeight] = useState(instance.height ?? 480);
  const [fullscreen, setFullscreen] = useState(instance.fullscreen);
  const [notes, setNotes] = useState(instance.notes ?? '');

  const hardLimit = Math.max(1024, totalMemoryMB - Math.max(2048, Math.floor(totalMemoryMB * 0.25)));

  const save = async () => {
    try {
      await call('instances:update', {
        id: instance.id,
        patch: { name, memoryMin: memMin, memoryMax: memMax, jvmArgs, width, height, fullscreen, notes },
      });
      pushToast('success', 'Zapisano ustawienia instancji.');
      await refreshInstances();
      onClose();
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  return (
    <Modal
      title={`Edycja: ${instance.name}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onDuplicate}>Duplikuj</Button>
          <Button variant="ghost" onClick={() => void call('instances:export', { id: instance.id })}>Eksportuj</Button>
          <Button variant="ghost" onClick={() => void call('instances:backup', { id: instance.id })}>Kopia zapasowa</Button>
          <Button variant="primary" onClick={() => void save()}>Zapisz</Button>
        </>
      }
      wide
    >
      <div className="grid cols-2">
        <div>
          <Field label="Nazwa">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
          </Field>
          <Field label={`Pamięć minimalna: ${memMin} MB`}>
            <input
              className="slider" type="range" min={256} max={Math.min(8192, hardLimit)} step={256}
              value={memMin} onChange={(e) => setMemMin(Number(e.target.value))}
            />
          </Field>
          <Field
            label={`Pamięć maksymalna: ${memMax} MB`}
            hint={memMax > hardLimit ? `Uwaga: zalecane maksimum to ${hardLimit} MB — reszta jest potrzebna systemowi.` : undefined}
          >
            <input
              className="slider" type="range" min={512} max={totalMemoryMB} step={256}
              value={memMax} onChange={(e) => setMemMax(Number(e.target.value))}
            />
          </Field>
          <Field label="Dodatkowe argumenty JVM">
            <textarea className="input" rows={3} value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} />
          </Field>
        </div>

        <div>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Szerokość">
              <input className="input" type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </Field>
            <Field label="Wysokość">
              <input className="input" type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </Field>
          </div>
          <Field label="Tryb pełnoekranowy">
            <label className="switch">
              <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} />
              <span className="track" />
              <span>{fullscreen ? 'włączony' : 'wyłączony'}</span>
            </label>
          </Field>
          <Field label="Notatki">
            <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </Field>
          <div className="row wrap" style={{ gap: 16 }}>
            <Stat label="Wersja" value={instance.mcVersion} />
            <Stat label="Loader" value={instance.loader} />
            <Stat label="Mody" value={instance.modCount ?? 0} />
          </div>
        </div>
      </div>

      {memMax > hardLimit && (
        <div style={{ marginTop: 10 }}>
          <Banner>Przydzielasz niemal cały RAM. Zostaw przynajmniej 2 GB dla systemu, inaczej gra może się zaciąć.</Banner>
        </div>
      )}
    </Modal>
  );
}
