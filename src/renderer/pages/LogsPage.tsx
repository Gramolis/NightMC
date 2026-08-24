/** Logi launchera i gry - z automatyczną redakcją danych poufnych. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Button, Card, Chip } from '../components/UI.js';
import { IconCopy, IconDownload, IconTrash } from '../components/Icons.js';

export function LogsPage() {
  const { logs, instances, selectInstance, refreshLogs, pushToast } = useStore();
  const [scope, setScope] = useState<string>('launcher');
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refreshLogs(scope === 'launcher' ? undefined : scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? logs.filter((l) => l.text.toLowerCase().includes(q)) : logs;
  }, [logs, filter]);

  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [visible, autoScroll]);

  const scopeArg = scope === 'launcher' ? undefined : scope;

  return (
    <div className="fade-in">
      <div className="page-head row">
        <div>
          <h1 className="page-title">Logi</h1>
          <p className="page-sub">
            Tokeny, kody autoryzacyjne i klucze API są usuwane z logów automatycznie, zanim trafią do bufora —
            kopiowanie i zapis do pliku są więc bezpieczne.
          </p>
        </div>
        <div className="spacer" />
        <Chip tone="dim">{visible.length} linii</Chip>
      </div>

      <Card tight>
        <div className="row wrap" style={{ gap: 10 }}>
          <select className="select" style={{ width: 230 }} value={scope} onChange={(e) => {
            setScope(e.target.value);
            if (e.target.value !== 'launcher') selectInstance(e.target.value);
          }}>
            <option value="launcher">Launcher</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Filtruj linie…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="switch">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            <span className="track" /><span>Auto-przewijanie</span>
          </label>
          <div className="spacer" />
          <Button small onClick={() =>
            void call<string>('logs:copy', { instanceId: scopeArg })
              .then((text) => navigator.clipboard.writeText(text))
              .then(() => pushToast('success', 'Log skopiowany do schowka.'))
              .catch((e) => pushToast('error', (e as Error).message))
          }>
            <IconCopy size={14} /> Kopiuj
          </Button>
          <Button small onClick={() => void call('logs:saveToFile', { instanceId: scopeArg }).catch((e) => pushToast('error', (e as Error).message))}>
            <IconDownload size={14} /> Zapisz
          </Button>
          <Button small variant="danger" onClick={() => void call('logs:clear', { instanceId: scopeArg }).then(() => refreshLogs(scopeArg))}>
            <IconTrash size={14} />
          </Button>
        </div>
      </Card>

      <div style={{ height: 14 }} />

      <div className="log-view" ref={boxRef}>
        {visible.length === 0 ? (
          <span style={{ color: 'var(--text-faint)' }}>Brak wpisów.</span>
        ) : (
          visible.map((l, i) => (
            <div key={`${l.ts}-${i}`} className={`log-line ${l.level}`}>
              <span className="log-time">{new Date(l.ts).toLocaleTimeString('pl-PL')}</span>
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
