/** Animowane gwiazdy w tle - lekki canvas, bez zewnętrznych bibliotek. */

import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
  speed: number;
  phase: number;
  hue: number;
}

export function StarField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let stars: Star[] = [];
    let width = 0;
    let height = 0;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(220, Math.round((width * height) / 9000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.35 + 0.25,
        a: Math.random() * 0.55 + 0.15,
        speed: Math.random() * 0.014 + 0.003,
        phase: Math.random() * Math.PI * 2,
        hue: Math.random() < 0.18 ? 190 : Math.random() < 0.5 ? 258 : 232,
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const s of stars) {
        const twinkle = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${s.hue}, 90%, 84%, ${s.a * twinkle})`;
        ctx.fill();
        if (s.r > 1.05) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 3.2, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${s.hue}, 92%, 76%, ${s.a * twinkle * 0.09})`;
          ctx.fill();
        }
        if (!reduceMotion) {
          s.y += 0.012;
          if (s.y > height + 2) s.y = -2;
        }
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="night-sky" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
