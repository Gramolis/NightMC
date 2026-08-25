import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { call } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Chip, Modal } from './UI.js';
import type { Account } from '../../shared/types.js';

const SKIN_SIZE = 64;
const HISTORY_LIMIT = 40;
const PALETTE = ['#f3c6a5', '#a66a4a', '#553327', '#16131f', '#f4f2ff', '#7658ff', '#35d7ff', '#39e6a3', '#ff4f87', '#ffcc57'];

type Tool = 'pencil' | 'eraser' | 'fill' | 'picker';

function fillRect(data: Uint8ClampedArray, x: number, y: number, width: number, height: number, color: string): void {
  const [r, g, b] = hexToRgb(color);
  for (let py = y; py < y + height; py++) {
    for (let px = x; px < x + width; px++) {
      const offset = (py * SKIN_SIZE + px) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
}

function defaultSkin(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4);
  // Bazowe powierzchnie klasycznego modelu. Warstwa ubrania pozostaje przezroczysta.
  fillRect(data, 0, 0, 32, 16, '#d59b78');
  fillRect(data, 16, 16, 24, 16, '#201a38');
  fillRect(data, 40, 16, 16, 16, '#d59b78');
  fillRect(data, 0, 16, 16, 16, '#171425');
  fillRect(data, 16, 48, 16, 16, '#171425');
  fillRect(data, 32, 48, 16, 16, '#d59b78');
  // Prosty znak NightMC na przodzie koszulki.
  fillRect(data, 22, 21, 4, 7, '#7658ff');
  fillRect(data, 26, 23, 2, 4, '#35d7ff');
  return data;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

function pixelsToDataUrl(pixels: Uint8ClampedArray): string {
  const canvas = document.createElement('canvas');
  canvas.width = SKIN_SIZE;
  canvas.height = SKIN_SIZE;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), SKIN_SIZE, SKIN_SIZE), 0, 0);
  return canvas.toDataURL('image/png');
}

async function loadPixels(source: string): Promise<Uint8ClampedArray> {
  const image = new Image();
  image.src = source;
  await image.decode();
  if (image.naturalWidth !== 64 || (image.naturalHeight !== 64 && image.naturalHeight !== 32)) {
    throw new Error(`Skórka ma rozmiar ${image.naturalWidth}×${image.naturalHeight}. Wymagane 64×64 albo 64×32.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = SKIN_SIZE;
  canvas.height = SKIN_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, SKIN_SIZE, SKIN_SIZE);
  ctx.drawImage(image, 0, 0);
  return new Uint8ClampedArray(ctx.getImageData(0, 0, SKIN_SIZE, SKIN_SIZE).data);
}

export function SkinEditor({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const { pushToast } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pixelsRef = useRef<Uint8ClampedArray>(defaultSkin());
  const drawingRef = useRef(false);
  const [pixels, setPixels] = useState<Uint8ClampedArray>(() => defaultSkin());
  const [undo, setUndo] = useState<Uint8ClampedArray[]>([]);
  const [redo, setRedo] = useState<Uint8ClampedArray[]>([]);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#7658ff');
  const [zoom, setZoom] = useState(7);
  const [grid, setGrid] = useState(true);
  const [mirror, setMirror] = useState(false);
  const [saving, setSaving] = useState(false);

  const replacePixels = (next: Uint8ClampedArray) => {
    pixelsRef.current = next;
    setPixels(next);
  };

  useEffect(() => {
    if (!account.avatar) return;
    void loadPixels(account.avatar)
      .then(replacePixels)
      .catch(() => pushToast('info', 'Nie udało się otworzyć poprzedniej skórki. Wczytano szablon NightMC.'));
  // Profil jest stały przez cały czas życia modala.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = SKIN_SIZE * zoom;
    canvas.height = SKIN_SIZE * zoom;
    const ctx = canvas.getContext('2d')!;
    const source = document.createElement('canvas');
    source.width = SKIN_SIZE;
    source.height = SKIN_SIZE;
    source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), SKIN_SIZE, SKIN_SIZE), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (grid && zoom >= 7) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(178, 190, 255, .18)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= SKIN_SIZE; i++) {
        const at = i * zoom + 0.5;
        ctx.moveTo(at, 0);
        ctx.lineTo(at, canvas.height);
        ctx.moveTo(0, at);
        ctx.lineTo(canvas.width, at);
      }
      ctx.stroke();
    }
  }, [pixels, zoom, grid]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const source = document.createElement('canvas');
    source.width = SKIN_SIZE;
    source.height = SKIN_SIZE;
    source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), SKIN_SIZE, SKIN_SIZE), 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    const draw = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, scale = 8) =>
      ctx.drawImage(source, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale);
    draw(8, 8, 8, 8, 32, 0);
    draw(40, 8, 8, 8, 32, 0);
    draw(20, 20, 8, 12, 32, 64);
    draw(20, 36, 8, 12, 32, 64);
    draw(44, 20, 4, 12, 0, 64);
    draw(44, 36, 4, 12, 0, 64);
    draw(36, 52, 4, 12, 96, 64);
    draw(52, 52, 4, 12, 96, 64);
    draw(4, 20, 4, 12, 32, 160);
    draw(4, 36, 4, 12, 32, 160);
    draw(20, 52, 4, 12, 64, 160);
    draw(4, 52, 4, 12, 64, 160);
  }, [pixels]);

  const remember = () => {
    setUndo((items) => [...items.slice(-(HISTORY_LIMIT - 1)), new Uint8ClampedArray(pixelsRef.current)]);
    setRedo([]);
  };

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(63, Math.floor(((event.clientX - rect.left) / rect.width) * SKIN_SIZE))),
      y: Math.max(0, Math.min(63, Math.floor(((event.clientY - rect.top) / rect.height) * SKIN_SIZE))),
    };
  };

  const setPixel = (data: Uint8ClampedArray, x: number, y: number, rgba: [number, number, number, number]) => {
    const offset = (y * SKIN_SIZE + x) * 4;
    data.set(rgba, offset);
  };

  const useToolAt = (x: number, y: number) => {
    const current = pixelsRef.current;
    const offset = (y * SKIN_SIZE + x) * 4;
    if (tool === 'picker') {
      if (current[offset + 3] > 0) setColor(rgbToHex(current[offset]!, current[offset + 1]!, current[offset + 2]!));
      setTool('pencil');
      return;
    }

    const next = new Uint8ClampedArray(current);
    const rgba: [number, number, number, number] = tool === 'eraser' ? [0, 0, 0, 0] : [...hexToRgb(color), 255];
    if (tool === 'fill') {
      const target = Array.from(current.slice(offset, offset + 4));
      if (target.every((v, i) => v === rgba[i])) return;
      const stack: [number, number][] = [[x, y]];
      const visited = new Uint8Array(SKIN_SIZE * SKIN_SIZE);
      while (stack.length) {
        const [px, py] = stack.pop()!;
        const index = py * SKIN_SIZE + px;
        if (visited[index]) continue;
        visited[index] = 1;
        const at = index * 4;
        if (!target.every((v, i) => current[at + i] === v)) continue;
        setPixel(next, px, py, rgba);
        if (px > 0) stack.push([px - 1, py]);
        if (px < 63) stack.push([px + 1, py]);
        if (py > 0) stack.push([px, py - 1]);
        if (py < 63) stack.push([px, py + 1]);
      }
    } else {
      setPixel(next, x, y, rgba);
      if (mirror) setPixel(next, 63 - x, y, rgba);
    }
    replacePixels(next);
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    if (tool !== 'picker') remember();
    drawingRef.current = tool === 'pencil' || tool === 'eraser';
    useToolAt(point.x, point.y);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    useToolAt(point.x, point.y);
  };

  const undoOnce = () => {
    const previous = undo.at(-1);
    if (!previous) return;
    setRedo((items) => [...items, new Uint8ClampedArray(pixelsRef.current)]);
    setUndo((items) => items.slice(0, -1));
    replacePixels(new Uint8ClampedArray(previous));
  };

  const redoOnce = () => {
    const next = redo.at(-1);
    if (!next) return;
    setUndo((items) => [...items, new Uint8ClampedArray(pixelsRef.current)]);
    setRedo((items) => items.slice(0, -1));
    replacePixels(new Uint8ClampedArray(next));
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      pushToast('error', 'Skórka jest za duża (maksymalnie 2 MB).');
      return;
    }
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Nie udało się odczytać pliku'));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const loaded = await loadPixels(url);
      remember();
      replacePixels(loaded);
    } catch (e) {
      pushToast('error', (e as Error).message);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await call('accounts:updateOffline', {
        id: account.id,
        username: account.username,
        skinData: pixelsToDataUrl(pixelsRef.current),
        removeSkin: false,
      });
      pushToast('success', 'Skórka została zapisana w profilu.');
      onSaved();
    } catch (e) {
      pushToast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const exportPng = () => {
    const link = document.createElement('a');
    link.download = `${account.username}-NightMC-skin.png`;
    link.href = pixelsToDataUrl(pixelsRef.current);
    link.click();
  };

  return (
    <Modal title={`NightMC Skin Studio — ${account.username}`} onClose={onClose} wide>
      <div className="skin-studio">
        <aside className="skin-studio-tools">
          <div className="skin-studio-label">Narzędzia</div>
          <button className={`skin-tool${tool === 'pencil' ? ' active' : ''}`} onClick={() => setTool('pencil')}>✦ Ołówek pikselowy</button>
          <button className={`skin-tool${tool === 'eraser' ? ' active' : ''}`} onClick={() => setTool('eraser')}>◇ Gumka</button>
          <button className={`skin-tool${tool === 'fill' ? ' active' : ''}`} onClick={() => setTool('fill')}>⬙ Wypełnienie</button>
          <button className={`skin-tool${tool === 'picker' ? ' active' : ''}`} onClick={() => setTool('picker')}>⌾ Pipeta</button>
          <div className="skin-studio-label">Historia</div>
          <div className="row">
            <Button small variant="ghost" disabled={!undo.length} onClick={undoOnce}>↶ Cofnij</Button>
            <Button small variant="ghost" disabled={!redo.length} onClick={redoOnce}>↷ Ponów</Button>
          </div>
          <label className="skin-toggle"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Lustro poziome</label>
          <label className="skin-toggle"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Siatka pikseli</label>
        </aside>

        <main className="skin-canvas-panel">
          <div className="skin-studio-heading">
            <div>
              <div className="list-title">Mapa skórki 64×64</div>
              <div className="list-sub">Kliknij albo przeciągnij, żeby malować pojedynczymi pikselami.</div>
            </div>
            <Chip tone="cyan">ZOOM {zoom}×</Chip>
          </div>
          <div className="skin-canvas-scroll">
            <canvas
              ref={canvasRef}
              className="skin-pixel-canvas"
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={() => { drawingRef.current = false; }}
              onPointerCancel={() => { drawingRef.current = false; }}
            />
          </div>
          <div className="row skin-zoom-row">
            <span className="list-sub">Powiększenie</span>
            <input type="range" min={6} max={13} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </div>
        </main>

        <aside className="skin-preview-panel">
          <div className="skin-studio-label">Podgląd postaci</div>
          <div className="skin-player-preview"><canvas ref={previewRef} width={128} height={256} /></div>
          <div className="skin-studio-label">Kolor</div>
          <div className="skin-color-row">
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setTool('pencil'); }} />
            <code>{color.toUpperCase()}</code>
          </div>
          <div className="skin-palette">
            {PALETTE.map((value) => (
              <button key={value} className={color === value ? 'active' : ''} style={{ background: value }} title={value} onClick={() => { setColor(value); setTool('pencil'); }} />
            ))}
          </div>
          <Banner kind="info">Przezroczyste piksele tworzysz gumką. Zewnętrzne warstwy skina także znajdują się na tej mapie.</Banner>
        </aside>
      </div>

      <div className="skin-studio-actions">
        <input ref={fileRef} hidden type="file" accept="image/png" onChange={(e) => void importFile(e.target.files?.[0])} />
        <Button onClick={() => fileRef.current?.click()}>Importuj PNG</Button>
        <Button variant="ghost" onClick={exportPng}>Eksportuj PNG</Button>
        <Button variant="ghost" onClick={() => { remember(); replacePixels(defaultSkin()); }}>Nowy szablon</Button>
        <div className="spacer" />
        <Button variant="ghost" onClick={onClose} disabled={saving}>Anuluj</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Zapisuję…' : 'Zapisz skórkę'}</Button>
      </div>
    </Modal>
  );
}
