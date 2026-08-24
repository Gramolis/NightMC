/** Java i RAM: wykrywanie, pobieranie Temurin, profile pamięci. */

import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { useSelectedInstance, useStore } from '../store/useStore.js';
import { Banner, Button, Card, Chip, DownloadPanel, Stat } from '../components/UI.js';
import { IconCpu, IconDownload, IconRefresh, IconTrash } from '../components/Icons.js';
import { memoryLevel, recommendedInstanceMemoryMB } from '../../shared/memory.js';
import type { JavaInstall } from '../../shared/types.js';

interface MemoryAdvice {
  totalMB: number;
  freeMB: number;
  recommendedMaxMB: number;
  hardLimitMB: number;
  warning?: string;
}

export function JavaPage() {
  const { pushToast, progress, refreshInstances, settings, refreshSettings } = useStore();
  const instance = useSelectedInstance();
  const [installs, setInstalls] = useState<JavaInstall[]>([]);
  const [memory, setMemory] = useState<MemoryAdvice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState(4096);

  const detect = async () => {
    setLoading(true);
    try {
      const res = await call<{ installs: JavaInstall[]; memory: MemoryAdvice }>('java:detect');
      setInstalls(res.installs);
      setMemory(res.memory);
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sliderMin = 1024;
  const safeMemoryMax = Math.max(sliderMin, Math.floor((memory?.hardLimitMB ?? 8192) / 512) * 512);
  // Pokazujemy również niedozwoloną strefę nad bezpiecznym maksimum, aby gracz
  // widział granicę możliwości komputera. Nie pozwalamy jednak jej zapisać.
  const physicalMemoryMax = Math.max(sliderMin, Math.floor(((memory?.totalMB ?? 8192) - 512) / 512) * 512);
  const sliderMax = Math.max(safeMemoryMax, physicalMemoryMax);
  const optimalMemory = recommendedInstanceMemoryMB(
    memory?.totalMB ?? 8192,
    instance?.modCount ?? 0,
    Boolean(instance && instance.loader !== 'vanilla'),
  );
  const optimalPosition = sliderMax === sliderMin
    ? 0
    : ((optimalMemory - sliderMin) / (sliderMax - sliderMin)) * 100;
  const dangerPosition = sliderMax === sliderMin
    ? 100
    : ((safeMemoryMax - sliderMin) / (sliderMax - sliderMin)) * 100;
  const level = memoryLevel(selectedMemory, optimalMemory, safeMemoryMax);
  const levelInfo = {
    low: { label: 'Może być za mało', tone: 'warn' as const, detail: 'Gra lub większa paczka może ładować się wolniej albo zabraknie jej pamięci.' },
    optimal: { label: 'Optymalne', tone: 'ok' as const, detail: 'Najlepszy balans dla tej instancji i tego komputera.' },
    elevated: { label: 'Powyżej rekomendacji', tone: 'cyan' as const, detail: 'Bezpiecznie, ale dodatkowy RAM prawdopodobnie nie przyspieszy gry.' },
    high: { label: 'Bardzo wysokie', tone: 'warn' as const, detail: 'To nadal mieści się w bezpiecznym limicie, ale zostaje mało zapasu dla innych programów.' },
    critical: { label: 'Za dużo RAM-u', tone: 'err' as const, detail: `Komputer tego nie udźwignie bez ryzyka zacięć. Ustaw maksymalnie ${formatMemory(safeMemoryMax)}, aby zostawić pamięć dla Windows i launchera.` },
  }[level];

  useEffect(() => {
    const stored = instance?.memoryMax ?? settings?.defaultMemoryMax ?? optimalMemory;
    setSelectedMemory(Math.max(sliderMin, Math.min(stored, sliderMax)));
  }, [instance?.id, instance?.memoryMax, settings?.defaultMemoryMax, optimalMemory, sliderMax]);

  const download = async (major: number) => {
    setBusy(true);
    try {
      await call('java:download', { major });
      await detect();
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyMemory = async (max: number) => {
    const min = Math.min(1024, max);
    setBusy(true);
    try {
      if (instance) {
        await call('instances:update', { id: instance.id, patch: { memoryMin: min, memoryMax: max } });
        await refreshInstances();
        pushToast('success', `Ustawiono ${formatMemory(max)} dla instancji „${instance.name}”.`);
      } else {
        await call('settings:set', { patch: { defaultMemoryMin: min, defaultMemoryMax: max } });
        await refreshSettings();
        pushToast('success', `Domyślna pamięć: ${formatMemory(max)}.`);
      }
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-head row">
        <div>
          <h1 className="page-title">Java i RAM</h1>
          <p className="page-sub">
            NightMC dobiera Javę do konkretnej wersji gry na podstawie pola <code>javaVersion</code> z metadanych
            Mojang — nie używa jednej Javy do wszystkiego. Środowiska pobierane są z oficjalnego API Eclipse Adoptium.
          </p>
        </div>
        <div className="spacer" />
        <Button onClick={() => void detect()}><IconRefresh size={16} /> Wykryj ponownie</Button>
      </div>

      {progress && (
        <div style={{ marginBottom: 18 }}>
          <Card tight><DownloadPanel progress={progress} /></Card>
        </div>
      )}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title={`Wykryte środowiska Java (${installs.length})`}>
          {loading ? (
            <div className="grid" style={{ gap: 8 }}>
              {Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton" style={{ height: 52 }} />)}
            </div>
          ) : installs.length === 0 ? (
            <Banner>
              Nie znaleziono żadnej instalacji Javy. Pobierz Temurin jednym kliknięciem z panelu obok —
              NightMC zapisze ją w %APPDATA%\NightMC\runtimes i nie będzie wymagać uprawnień administratora.
            </Banner>
          ) : (
            <div className="list">
              {installs.map((j) => (
                <div key={j.path} className="list-item">
                  <div className="inst-icon" style={{ width: 38, height: 38 }}><IconCpu size={17} /></div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="list-title">Java {j.majorVersion} — {j.version}</div>
                    <div className="list-sub" style={{ fontFamily: 'monospace' }}>{j.path}</div>
                  </div>
                  <Chip tone={j.arch === 'x86' ? 'warn' : 'dim'}>{j.arch}</Chip>
                  {j.vendor && <Chip tone="dim">{j.vendor}</Chip>}
                  {j.managed && <Chip tone="ok">NightMC</Chip>}
                  {instance && (
                    <Button
                      small
                      onClick={() =>
                        void call('instances:update', { id: instance.id, patch: { javaPath: j.path } })
                          .then(() => { pushToast('success', `Przypisano Javę do „${instance.name}”.`); return refreshInstances(); })
                          .catch((e) => pushToast('error', (e as Error).message))
                      }
                    >
                      Użyj w instancji
                    </Button>
                  )}
                  {j.managed && (
                    <Button
                      small
                      variant="danger"
                      onClick={() => void call('java:remove', { path: j.path }).then(detect).catch((e) => pushToast('error', (e as Error).message))}
                    >
                      <IconTrash size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Button
              variant="ghost"
              onClick={() =>
                void call<JavaInstall | null>('java:pick')
                  .then((j) => j && pushToast('success', `Wskazano Java ${j.majorVersion} (${j.version}).`))
                  .catch((e) => pushToast('error', (e as Error).message))
              }
            >
              Wskaż java.exe ręcznie
            </Button>
          </div>
        </Card>

        <div className="grid" style={{ gap: 16 }}>
          <Card title="Pobierz Eclipse Temurin" subtitle="Oficjalne API Adoptium. Nie wymaga uprawnień administratora.">
            <div className="row wrap" style={{ gap: 8 }}>
              {[8, 17, 21].map((major) => (
                <Button key={major} variant="primary" disabled={busy} onClick={() => void download(major)}>
                  <IconDownload size={15} /> Java {major}
                </Button>
              ))}
            </div>
            <p className="card-sub" style={{ marginTop: 14, marginBottom: 0 }}>
              Java 8 dla wersji do 1.16, Java 17 dla 1.18–1.20.4, Java 21 dla 1.20.5 i nowszych.
            </p>
          </Card>

          <Card title="Pamięć RAM" subtitle={instance ? `Zmiany dotyczą instancji „${instance.name}”.` : 'Zmiany dotyczą wartości domyślnych dla nowych instancji.'}>
            {memory && (
              <div className="row wrap" style={{ gap: 20, marginBottom: 16 }}>
                <Stat label="RAM łącznie" value={`${(memory.totalMB / 1024).toFixed(1)} GB`} />
                <Stat label="Wolne" value={`${(memory.freeMB / 1024).toFixed(1)} GB`} />
                <Stat label="Bezpieczne maksimum" value={`${memory.hardLimitMB} MB`} />
              </div>
            )}

            <div className="memory-console">
              <div className="memory-console-head">
                <div>
                  <div className="memory-kicker">Przydział dla Minecrafta</div>
                  <div className="memory-value">{formatMemory(selectedMemory)}</div>
                </div>
                <Chip tone={levelInfo.tone}>{levelInfo.label}</Chip>
              </div>

              <div className="memory-slider-wrap">
                <div className="memory-optimal-marker" style={{ left: `${optimalPosition}%` }}>
                  <span>Optymalne · {formatMemory(optimalMemory)}</span>
                </div>
                <input
                  className="memory-slider"
                  style={{
                    background: `linear-gradient(90deg, #45e3a0 0%, #75e18c ${Math.max(18, dangerPosition - 30)}%, #ffc65c ${Math.max(20, dangerPosition - 0.2)}%, #ff5f77 ${dangerPosition}%, #9d1538 100%)`,
                  }}
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  step={512}
                  value={selectedMemory}
                  aria-label="Maksymalna pamięć RAM dla Minecrafta"
                  onChange={(event) => setSelectedMemory(Number(event.target.value))}
                />
                <div className="memory-scale">
                  <span>{formatMemory(sliderMin)}</span>
                  <span>Bezpieczne maksimum: {formatMemory(safeMemoryMax)}</span>
                  <span>Granica fizyczna: {formatMemory(sliderMax)}</span>
                </div>
              </div>

              <div className={`memory-advice ${level}`}>
                <span className="memory-advice-dot" />
                <span>{levelInfo.detail}</span>
              </div>

              <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <Button small variant="ghost" onClick={() => setSelectedMemory(optimalMemory)}>
                  Ustaw optymalne
                </Button>
                <Button
                  small
                  variant="primary"
                  disabled={busy || selectedMemory > safeMemoryMax || selectedMemory === (instance?.memoryMax ?? settings?.defaultMemoryMax)}
                  onClick={() => void applyMemory(selectedMemory)}
                >
                  {selectedMemory > safeMemoryMax ? 'Zmniejsz przydział' : `Zastosuj ${formatMemory(selectedMemory)}`}
                </Button>
              </div>
            </div>

            {memory?.warning && <Banner>{memory.warning}</Banner>}

            <div style={{ marginTop: 12 }}>
              <Banner kind="info">
                Nie przydzielaj całego RAM-u. System, sterowniki i sam launcher też potrzebują pamięci,
                a Java z za dużym <code>-Xmx</code> potrafi zacinać się na garbage collectorze.
              </Banner>
            </div>

            <div className="row wrap" style={{ gap: 16, marginTop: 14 }}>
              <Stat label="Domyślne min" value={`${settings?.defaultMemoryMin ?? 1024} MB`} />
              <Stat label="Domyślne max" value={`${settings?.defaultMemoryMax ?? 4096} MB`} />
              {instance && <Stat label="Ta instancja" value={`${instance.memoryMin}–${instance.memoryMax} MB`} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function formatMemory(valueMB: number): string {
  const gb = valueMB / 1024;
  return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
}
