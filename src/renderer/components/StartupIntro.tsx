/**
 * Intro startowe NightMC.
 *
 * Komponent renderuje DOKŁADNIE ten sam znacznik i te same klasy, co warstwa
 * `#boot-intro` wpisana na stałe w `src/renderer/index.html`. Arkusz stylów tej
 * animacji żyje w tamtym pliku (inline `<style>`), bo musi obowiązywać zanim
 * przeglądarka pobierze bundle - dzięki temu nie ma białego błysku ani pustego
 * ekranu. Ten `<style>` zostaje w dokumencie, więc komponent korzysta z tych
 * samych reguł i nie potrzebuje ich kopii w `styles.css`.
 *
 * Ciągłość obrazu przy przejęciu animacji przez Reacta:
 *   1. jeszcze podczas renderu odczytujemy, ile czasu animacji już upłynęło
 *      (zegar `nm-intro-clock` z warstwy HTML, `Animation.currentTime`),
 *   2. tę wartość podajemy jako UJEMNE `--nm-off`, więc wszystkie animacje
 *      komponentu startują dokładnie w tym miejscu, w którym była warstwa HTML,
 *   3. warstwę HTML usuwamy w `useLayoutEffect`, czyli przed pierwszym
 *      malowaniem Reacta - podmiana jest niewidoczna.
 *
 * Sekwencja jest sterowana czasem (CSS `animation-delay`), a nie zdarzeniami
 * `animationend`, więc pojedyncze zgubione zdarzenie nie jest w stanie
 * zablokować aplikacji. Dodatkowo każdy etap ma zapasowy timer bezpieczeństwa.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/** Długość pełnej sekwencji przy `--nm-s: 1`. Musi odpowiadać osi czasu z index.html. */
export const NM_INTRO_TOTAL_MS = 3400;
/** Mnożnik tempa przy `prefers-reduced-motion: reduce` (ta sama wartość co w CSS). */
export const NM_INTRO_REDUCED_SPEED = 0.42;
/** Czas wygaszania nakładki - musi odpowiadać `transition` na `.nm-intro`. */
export const NM_INTRO_EXIT_MS = 520;
/** Margines bezpieczeństwa, gdyby timer został zagłodzony przez ciężki bootstrap. */
const SAFETY_MS = 4000;

const BOOT_LAYER_ID = 'boot-intro';
const CLOCK_ANIMATION = 'nm-intro-clock';

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Ile milisekund animacji odtworzyła już warstwa HTML.
 * Czytamy `currentTime` zegara odniesienia - jest dokładniejsze niż
 * `performance.now()`, bo liczy się od faktycznego startu animacji elementu.
 */
function readBootElapsed(): number {
  try {
    const el = document.getElementById(BOOT_LAYER_ID);
    if (el && typeof el.getAnimations === 'function') {
      for (const anim of el.getAnimations()) {
        const name = (anim as unknown as { animationName?: string }).animationName;
        if (name !== CLOCK_ANIMATION) continue;
        const t = anim.currentTime;
        if (typeof t === 'number' && Number.isFinite(t) && t >= 0) return t;
      }
    }
    const now = performance.now();
    return Number.isFinite(now) && now >= 0 ? now : 0;
  } catch {
    return 0;
  }
}

interface StartupIntroProps {
  /** Czy bootstrap aplikacji się zakończył (`useStore().ready`). */
  ready: boolean;
  /** Wywoływane raz, po wygaszeniu nakładki. */
  onFinish: () => void;
}

export function StartupIntro({ ready, onFinish }: StartupIntroProps) {
  // Odczyt musi nastąpić w fazie renderu - warstwa HTML jeszcze istnieje.
  const [offsetMs] = useState(readBootElapsed);
  const [speed] = useState(() => (prefersReducedMotion() ? NM_INTRO_REDUCED_SPEED : 1));

  const totalMs = Math.round(NM_INTRO_TOTAL_MS * speed);
  const [sequenceDone, setSequenceDone] = useState(() => offsetMs >= totalMs);
  const [exiting, setExiting] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finished = useRef(false);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, Math.max(0, ms)));
  }, []);

  /** Wywołanie `onFinish` jest jednorazowe, nawet jeśli zadziała timer zapasowy. */
  const finishOnce = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish();
  }, [onFinish]);

  // Podmiana warstwy HTML na komponent - przed pierwszym malowaniem.
  useLayoutEffect(() => {
    document.getElementById(BOOT_LAYER_ID)?.remove();
  }, []);

  // Etap 1: odczekaj do końca sekwencji animacji.
  useEffect(() => {
    if (sequenceDone) return;
    const remaining = totalMs - offsetMs;
    schedule(() => setSequenceDone(true), remaining);
    // Zapas na wypadek, gdyby powyższy timer nie zdążył (zapchany główny wątek).
    schedule(() => setSequenceDone(true), remaining + SAFETY_MS);
    // Bez lokalnego sprzątania: wszystkie timery czyści jeden efekt odmontowania
    // (patrz niżej), a `setSequenceDone(true)` jest idempotentne.
  }, [sequenceDone, totalMs, offsetMs, schedule]);

  // Etap 2: sekwencja skończona I aplikacja gotowa -> wygaś nakładkę.
  useEffect(() => {
    if (!sequenceDone || !ready || exiting) return;
    setExiting(true);
    schedule(finishOnce, NM_INTRO_EXIT_MS);
    // Zapas: gdyby przejście CSS nie doszło do skutku, i tak odsłaniamy menu.
    schedule(finishOnce, NM_INTRO_EXIT_MS + SAFETY_MS);
  }, [sequenceDone, ready, exiting, schedule, finishOnce]);

  // Sprzątanie wszystkich timerów przy odmontowaniu.
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  const style = {
    '--nm-s': String(speed),
    '--nm-off': `${-offsetMs}ms`,
  } as CSSProperties;

  return (
    <div
      className={`nm-intro${exiting ? ' is-exiting' : ''}`}
      style={style}
      role="status"
      aria-live="polite"
      aria-label="Ładowanie NightMC…"
    >
      <span className="nm-intro__nebula nm-intro__nebula--a" aria-hidden="true" />
      <span className="nm-intro__nebula nm-intro__nebula--b" aria-hidden="true" />
      <div className="nm-intro__dust" aria-hidden="true">
        {DUST.map((d, i) => (
          <i
            key={i}
            style={
              {
                '--x': d.x,
                '--y': d.y,
                '--sz': d.sz,
                '--d': d.delay,
                '--dur': d.dur,
                '--c': d.color,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="nm-intro__stage">
        <span className="nm-intro__shock" aria-hidden="true" />
        <span className="nm-intro__title">
          <span className="nm-intro__title-inner">NightMC</span>
        </span>
        <span className="nm-intro__author">Made by Krzychu</span>
      </div>

      <span className="nm-intro__spark" aria-hidden="true" />
      <span className="nm-intro__flash" aria-hidden="true" />
      <p className="nm-intro__status">Ładowanie NightMC…</p>
    </div>
  );
}

/** Świetlne drobiny - te same wartości co w warstwie HTML w index.html. */
const DUST = [
  { x: '12%', y: '74%', sz: '2px', delay: '0ms', dur: '5200ms', color: '#cfc6ff' },
  { x: '26%', y: '88%', sz: '3px', delay: '700ms', dur: '6100ms', color: '#a8b6ff' },
  { x: '38%', y: '66%', sz: '2px', delay: '1500ms', dur: '4800ms', color: '#8ff0ff' },
  { x: '51%', y: '92%', sz: '2px', delay: '400ms', dur: '5600ms', color: '#cfc6ff' },
  { x: '63%', y: '70%', sz: '3px', delay: '2100ms', dur: '6400ms', color: '#b9a7ff' },
  { x: '74%', y: '84%', sz: '2px', delay: '1100ms', dur: '5000ms', color: '#8ff0ff' },
  { x: '86%', y: '62%', sz: '2px', delay: '2600ms', dur: '5800ms', color: '#cfc6ff' },
  { x: '8%', y: '40%', sz: '2px', delay: '3000ms', dur: '6600ms', color: '#a8b6ff' },
  { x: '92%', y: '34%', sz: '2px', delay: '1800ms', dur: '6000ms', color: '#b9a7ff' },
  { x: '19%', y: '20%', sz: '2px', delay: '2400ms', dur: '7000ms', color: '#8ff0ff' },
  { x: '68%', y: '16%', sz: '2px', delay: '900ms', dur: '6800ms', color: '#cfc6ff' },
  { x: '45%', y: '28%', sz: '2px', delay: '3400ms', dur: '5400ms', color: '#a8b6ff' },
] as const;
