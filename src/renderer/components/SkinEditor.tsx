import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { call } from '../api.js';
import { useStore } from '../store/useStore.js';
import { Banner, Button, Chip, Modal } from './UI.js';
import type { Account } from '../../shared/types.js';

const SKIN_SIZE = 64;
const HISTORY_LIMIT = 40;
const PALETTE = ['#f3c6a5', '#a66a4a', '#553327', '#16131f', '#f4f2ff', '#7658ff', '#35d7ff', '#39e6a3', '#ff4f87', '#ffcc57'];

type Tool = 'pencil' | 'eraser' | 'fill' | 'picker';
type EditorView = 'character' | 'texture';

type FigurePart = {
  dx: number;
  dy: number;
  width: number;
  height: number;
  sx: number;
  sy: number;
  overlayX: number;
  overlayY: number;
};

const FIGURE_WIDTH = 16;
const FIGURE_HEIGHT = 32;
const FIGURE_PARTS: FigurePart[] = [
  // Widok od przodu: prawa strona postaci znajduje się po lewej stronie ekranu.
  { dx: 4, dy: 0, width: 8, height: 8, sx: 8, sy: 8, overlayX: 40, overlayY: 8 },
  { dx: 0, dy: 8, width: 4, height: 12, sx: 44, sy: 20, overlayX: 44, overlayY: 36 },
  { dx: 4, dy: 8, width: 8, height: 12, sx: 20, sy: 20, overlayX: 20, overlayY: 36 },
  { dx: 12, dy: 8, width: 4, height: 12, sx: 36, sy: 52, overlayX: 52, overlayY: 52 },
  { dx: 4, dy: 20, width: 4, height: 12, sx: 4, sy: 20, overlayX: 4, overlayY: 36 },
  { dx: 8, dy: 20, width: 4, height: 12, sx: 20, sy: 52, overlayX: 4, overlayY: 52 },
];

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
  // Klasyczny szablon Steve'a w poprawnym układzie UV 64x64.
  const skin = '#b97855';
  const skinLight = '#c98c68';
  const skinShadow = '#9f6047';
  const hair = '#35241c';
  const hairDark = '#241711';
  const shirt = '#08a7a5';
  const shirtShadow = '#078b91';
  const trousers = '#3e3d91';
  const trousersShadow = '#302f72';
  const shoes = '#4a3931';

  // Głowa: góra/dół oraz cztery boki.
  fillRect(data, 8, 0, 8, 8, hair);
  fillRect(data, 16, 0, 8, 8, skinShadow);
  fillRect(data, 0, 8, 32, 8, skin);
  fillRect(data, 24, 8, 8, 8, hairDark);
  fillRect(data, 8, 8, 8, 3, hair);
  fillRect(data, 8, 11, 1, 4, hair);
  fillRect(data, 15, 11, 1, 4, hair);
  fillRect(data, 9, 12, 2, 1, '#f2eee8');
  fillRect(data, 13, 12, 2, 1, '#f2eee8');
  fillRect(data, 10, 12, 1, 1, '#395a9d');
  fillRect(data, 13, 12, 1, 1, '#395a9d');
  fillRect(data, 11, 14, 2, 1, skinLight);
  fillRect(data, 11, 15, 3, 1, hairDark);

  // Tułów.
  fillRect(data, 20, 16, 8, 4, shirt);
  fillRect(data, 28, 16, 8, 4, shirtShadow);
  fillRect(data, 16, 20, 24, 12, shirtShadow);
  fillRect(data, 20, 20, 8, 12, shirt);
  fillRect(data, 21, 20, 6, 2, skinLight);
  fillRect(data, 20, 30, 8, 2, shirtShadow);

  // Prawa i lewa ręka klasycznego modelu 4 px.
  fillRect(data, 44, 16, 4, 4, shirt);
  fillRect(data, 48, 16, 4, 4, skinShadow);
  fillRect(data, 40, 20, 16, 12, skin);
  fillRect(data, 44, 20, 4, 4, shirt);
  fillRect(data, 40, 20, 4, 12, skinShadow);
  fillRect(data, 36, 48, 4, 4, shirt);
  fillRect(data, 40, 48, 4, 4, skinShadow);
  fillRect(data, 32, 52, 16, 12, skin);
  fillRect(data, 36, 52, 4, 4, shirt);
  fillRect(data, 44, 52, 4, 12, skinShadow);

  // Nogi i buty.
  fillRect(data, 4, 16, 4, 4, trousers);
  fillRect(data, 8, 16, 4, 4, trousersShadow);
  fillRect(data, 0, 20, 16, 12, trousersShadow);
  fillRect(data, 4, 20, 4, 12, trousers);
  fillRect(data, 4, 30, 4, 2, shoes);
  fillRect(data, 20, 48, 4, 4, trousers);
  fillRect(data, 24, 48, 4, 4, trousersShadow);
  fillRect(data, 16, 52, 16, 12, trousersShadow);
  fillRect(data, 20, 52, 4, 12, trousers);
  fillRect(data, 20, 62, 4, 2, shoes);
  return data;
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  scale: number,
  showGrid: boolean,
): void {
  ctx.imageSmoothingEnabled = false;
  for (const part of FIGURE_PARTS) {
    ctx.drawImage(
      source,
      part.sx,
      part.sy,
      part.width,
      part.height,
      part.dx * scale,
      part.dy * scale,
      part.width * scale,
      part.height * scale,
    );
  }
  // Zewnętrzna warstwa (czapka, kurtka, rękawy i nogawki) leży na bazie.
  for (const part of FIGURE_PARTS) {
    ctx.drawImage(
      source,
      part.overlayX,
      part.overlayY,
      part.width,
      part.height,
      part.dx * scale,
      part.dy * scale,
      part.width * scale,
      part.height * scale,
    );
  }
  if (!showGrid || scale < 7) return;
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(178, 190, 255, .22)';
  ctx.lineWidth = 1;
  for (const part of FIGURE_PARTS) {
    for (let x = 0; x <= part.width; x++) {
      const at = (part.dx + x) * scale + 0.5;
      ctx.moveTo(at, part.dy * scale);
      ctx.lineTo(at, (part.dy + part.height) * scale);
    }
    for (let y = 0; y <= part.height; y++) {
      const at = (part.dy + y) * scale + 0.5;
      ctx.moveTo(part.dx * scale, at);
      ctx.lineTo((part.dx + part.width) * scale, at);
    }
  }
  ctx.stroke();
}

function figurePixelAt(x: number, y: number): { x: number; y: number } | null {
  const part = FIGURE_PARTS.find((item) => (
    x >= item.dx && x < item.dx + item.width && y >= item.dy && y < item.dy + item.height
  ));
  if (!part) return null;
  return { x: part.sx + x - part.dx, y: part.sy + y - part.dy };
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
  const [view, setView] = useState<EditorView>('character');
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
    const width = view === 'character' ? FIGURE_WIDTH : SKIN_SIZE;
    const height = view === 'character' ? FIGURE_HEIGHT : SKIN_SIZE;
    canvas.width = width * zoom;
    canvas.height = height * zoom;
    const ctx = canvas.getContext('2d')!;
    const source = document.createElement('canvas');
    source.width = SKIN_SIZE;
    source.height = SKIN_SIZE;
    source.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), SKIN_SIZE, SKIN_SIZE), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (view === 'character') {
      drawFigure(ctx, source, zoom, grid);
    } else {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }
    if (view === 'texture' && grid && zoom >= 7) {
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
  }, [pixels, zoom, grid, view]);

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
    drawFigure(ctx, source, 8, false);
  }, [pixels]);

  const remember = () => {
    setUndo((items) => [...items.slice(-(HISTORY_LIMIT - 1)), new Uint8ClampedArray(pixelsRef.current)]);
    setRedo([]);
  };

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (view === 'character') {
      const figureX = Math.max(0, Math.min(FIGURE_WIDTH - 1, Math.floor(((event.clientX - rect.left) / rect.width) * FIGURE_WIDTH)));
      const figureY = Math.max(0, Math.min(FIGURE_HEIGHT - 1, Math.floor(((event.clientY - rect.top) / rect.height) * FIGURE_HEIGHT)));
      const point = figurePixelAt(figureX, figureY);
      const mirrored = figurePixelAt(FIGURE_WIDTH - 1 - figureX, figureY);
      return point ? { ...point, mirrored } : null;
    }
    const x = Math.max(0, Math.min(63, Math.floor(((event.clientX - rect.left) / rect.width) * SKIN_SIZE)));
    const y = Math.max(0, Math.min(63, Math.floor(((event.clientY - rect.top) / rect.height) * SKIN_SIZE)));
    return {
      x,
      y,
      mirrored: { x: 63 - x, y },
    };
  };

  const setPixel = (data: Uint8ClampedArray, x: number, y: number, rgba: [number, number, number, number]) => {
    const offset = (y * SKIN_SIZE + x) * 4;
    data.set(rgba, offset);
  };

  const applyToolAt = (x: number, y: number, mirrored?: { x: number; y: number } | null) => {
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
      if (mirror && mirrored) setPixel(next, mirrored.x, mirrored.y, rgba);
    }
    replacePixels(next);
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    if (!point) return;
    if (tool !== 'picker') remember();
    drawingRef.current = tool === 'pencil' || tool === 'eraser';
    applyToolAt(point.x, point.y, point.mirrored);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    if (point) applyToolAt(point.x, point.y, point.mirrored);
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
              <div className="list-title">{view === 'character' ? 'Malowanie na postaci' : 'Struktura skórki 64×64'}</div>
              <div className="list-sub">
                {view === 'character'
                  ? 'Malujesz bezpośrednio na przodzie ludka. Strukturę wybierz do boków, tyłu i warstw ubrania.'
                  : 'Pełna mapa UV: przód, boki, tył i zewnętrzne warstwy skórki.'}
              </div>
            </div>
            <div className="skin-view-switch" role="group" aria-label="Widok edytora">
              <button className={view === 'character' ? 'active' : ''} onClick={() => setView('character')}>Postać</button>
              <button className={view === 'texture' ? 'active' : ''} onClick={() => setView('texture')}>Struktura</button>
            </div>
          </div>
          <div className={`skin-canvas-scroll${view === 'character' ? ' skin-canvas-scroll--character' : ''}`}>
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
            <Chip tone="cyan">{zoom}×</Chip>
          </div>
        </main>

        <aside className="skin-preview-panel">
          <div className="skin-studio-label">Podgląd końcowy</div>
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
          <Banner kind="info">Widok Postać edytuje bazową warstwę od przodu. Boki, tył oraz warstwy ubrania zmienisz w widoku Struktura.</Banner>
        </aside>
      </div>

      <div className="skin-studio-actions">
        <input ref={fileRef} hidden type="file" accept="image/png" onChange={(e) => void importFile(e.target.files?.[0])} />
        <Button onClick={() => fileRef.current?.click()}>Importuj PNG</Button>
        <Button variant="ghost" onClick={exportPng}>Eksportuj PNG</Button>
        <Button variant="ghost" onClick={() => { remember(); replacePixels(defaultSkin()); }}>Szablon Steve</Button>
        <div className="spacer" />
        <Button variant="ghost" onClick={onClose} disabled={saving}>Anuluj</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Zapisuję…' : 'Zapisz skórkę'}</Button>
      </div>
    </Modal>
  );
}
