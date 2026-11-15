// La pizarra. El dibujo NO pasa por el estado de React: los puntos llegan a un modelo mutable
// y el canvas se repinta en requestAnimationFrame solo cuando algo cambia.
import { useEffect, useRef, useState } from 'react';
import { Check, Undo2, ZoomOut } from 'lucide-react';
import { getStroke } from 'perfect-freehand';
import { BOARD, COLORS, MAX_STROKE_POINTS, type Stroke } from '../shared/game';

// Ajustes del rotulador, en unidades de pizarra (lado = 1000). Afinar probando en móvil real.
// size: grosor (1,6 % del lado). thinning: cuánto adelgaza con la velocidad/presión (0 = grosor fijo).
// streamline: cuánto suaviza el pulso (más = trazo más limpio, pero sigue al dedo con algo de retraso).
const PEN = { size: 16, thinning: 0.25, smoothing: 0.5, streamline: 0.4 };
const MIN_DIST = 1.5; // separación mínima entre puntos guardados
const SEND_EVERY = 40; // ms entre lotes del trazo en vivo
const PAPER = '#fffdf8';
const GRID = '#e6e0d2'; // cuadrícula tenue: al ampliar, el tamaño de los cuadros da la referencia del zoom
const GRID_STEP = 50; // lado de cada cuadro en unidades de pizarra (20 x 20 cuadros)
const MAX_ZOOM = 4; // pellizco con dos dedos: hasta 4 aumentos
const DIMMED = 0.12; // opacidad de los trazos de los demás al resaltar a un jugador

/** Dibujo compartido: trazos terminados y, como mucho, uno en curso (propio o de otro jugador). */
export class BoardModel {
  strokes: Stroke[] = [];
  live: Stroke | null = null;
  onChange = () => {};

  reset(list: Stroke[]) {
    this.strokes = list;
    this.live = null;
    this.onChange();
  }
  commit(stroke: Stroke) {
    this.strokes.push(stroke);
    this.live = null;
    this.onChange();
  }
  addLive(id: string, c: number, pts: number[]) {
    if (this.live?.id !== id) this.live = { id, c, pts: [] };
    this.live.pts.push(...pts);
    this.onChange();
  }
  clearLive() {
    this.live = null;
    this.onChange();
  }
}

/** Contorno suavizado del trazo (perfect-freehand) como Path2D, en unidades de pizarra. */
function pathOf(pts: number[], complete: boolean): Path2D {
  const input: number[][] = [];
  for (let i = 0; i < pts.length; i += 3) input.push([pts[i], pts[i + 1], pts[i + 2] || 0.5]);
  // Presión 0 = dedo o ratón: se simula con la velocidad. Con lápiz se usa la real.
  const outline = getStroke(input, { ...PEN, simulatePressure: pts[2] === 0, last: complete });
  const path = new Path2D();
  if (!outline.length) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

interface Props {
  model: BoardModel;
  color: number; // rotulador elegido para mi trazo (índice en COLORS)
  focus: string | null; // jugador resaltado: los trazos de los demás se atenúan
  me: string;
  canDraw: boolean;
  send: (msg: object) => void;
}

export default function Board(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const { model } = props;
  // Trazo terminado pero sin enviar: se confirma con ✓ o se deshace con la flecha.
  const draftRef = useRef<number[] | null>(null);
  const [draft, setDraft] = useState(false);
  // Zoom (pellizco con dos dedos): k aumentos y esquina superior izquierda visible, en unidades de pizarra.
  // Solo cambia cómo se ve en este móvil; los trazos se guardan siempre en coordenadas de pizarra.
  const zoomRef = useRef({ k: 1, ox: 0, oy: 0 });
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    // desynchronized: pista para pintar con menos latencia donde el navegador lo soporte.
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;
    const paths = new WeakMap<Stroke, Path2D>();
    let frame = 0;
    let active: { pointer: number; rect: DOMRect; pts: number[]; sent: number; lastSend: number; pen: boolean } | null = null;
    // Dedos sobre la pizarra y, con dos, el pellizco: distancia y zoom al empezar, y punto de pizarra bajo el centro.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { rect: DOMRect; dist: number; k: number; bx: number; by: number } | null = null;

    const draw = () => {
      frame = 0;
      const { focus } = latest.current;
      const paint = (s: Stroke, path: Path2D) => {
        ctx.globalAlpha = focus && s.id !== focus ? DIMMED : 1;
        ctx.fillStyle = COLORS[s.c] ?? COLORS[0]; // salas guardadas antes del color por trazo
        ctx.fill(path);
      };
      ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const { k, ox, oy } = zoomRef.current;
      const scale = (canvas.width / BOARD) * k;
      ctx.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
      ctx.beginPath();
      for (let v = GRID_STEP; v < BOARD; v += GRID_STEP) {
        ctx.moveTo(v, 0);
        ctx.lineTo(v, BOARD);
        ctx.moveTo(0, v);
        ctx.lineTo(BOARD, v);
      }
      ctx.strokeStyle = GRID;
      ctx.lineWidth = devicePixelRatio / scale; // 1 px de pantalla con cualquier zoom
      ctx.stroke();
      for (const stroke of model.strokes) {
        let path = paths.get(stroke);
        if (!path) paths.set(stroke, (path = pathOf(stroke.pts, true)));
        paint(stroke, path);
      }
      if (model.live) paint(model.live, pathOf(model.live.pts, false));
    };
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    model.onChange = invalidate;

    const resize = new ResizeObserver(() => {
      const size = Math.round(canvas.clientWidth * devicePixelRatio);
      if (!size || canvas.width === size) return;
      canvas.width = canvas.height = size;
      draw();
    });
    resize.observe(canvas);

    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    const addPoint = (e: PointerEvent) => {
      if (!active || active.pts.length >= MAX_STROKE_POINTS * 3) return;
      const { rect, pts } = active;
      const { k, ox, oy } = zoomRef.current;
      const x = Math.round(clamp(ox + ((e.clientX - rect.left) / rect.width) * (BOARD / k), BOARD) * 10) / 10;
      const y = Math.round(clamp(oy + ((e.clientY - rect.top) / rect.height) * (BOARD / k), BOARD) * 10) / 10;
      const n = pts.length;
      if (n && Math.hypot(x - pts[n - 3], y - pts[n - 2]) < MIN_DIST) return;
      pts.push(x, y, active.pen ? Math.round(clamp(Math.max(0.05, e.pressure), 1) * 100) / 100 : 0);
    };

    const pinchNow = () => {
      const [a, b] = [...touches.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    /** Zoom según cuánto se han separado los dedos; el punto que había bajo su centro sigue bajo su centro. */
    const updatePinch = () => {
      if (!pinch) return;
      const { dist, mx, my } = pinchNow();
      let k = clamp((pinch.k * dist) / pinch.dist, MAX_ZOOM);
      if (k < 1.05) k = 1; // casi sin zoom: se queda la pizarra entera
      const side = BOARD / k;
      zoomRef.current = {
        k,
        ox: clamp(pinch.bx - ((mx - pinch.rect.left) / pinch.rect.width) * side, BOARD - side),
        oy: clamp(pinch.by - ((my - pinch.rect.top) / pinch.rect.height) * side, BOARD - side),
      };
      setZoomed(k > 1);
      invalidate();
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        canvas.setPointerCapture(e.pointerId);
        // Segundo dedo: pellizco. Si el primero ya había empezado un trazo, se descarta (no si es de lápiz: es la palma).
        if (touches.size === 2 && !active?.pen) {
          e.preventDefault();
          if (active) {
            active = null;
            model.clearLive();
            latest.current.send({ t: 'cancel' });
          }
          const rect = canvas.getBoundingClientRect();
          const { dist, mx, my } = pinchNow();
          const { k, ox, oy } = zoomRef.current;
          pinch = {
            rect,
            dist,
            k,
            bx: ox + ((mx - rect.left) / rect.width) * (BOARD / k),
            by: oy + ((my - rect.top) / rect.height) * (BOARD / k),
          };
          return;
        }
      }
      if (pinch) return;
      // Un solo trazo: puntero primario, botón principal, y solo si es tu turno y no hay otro trazo pendiente.
      if (!latest.current.canDraw || model.live || active || !e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const pts: number[] = [];
      active = { pointer: e.pointerId, rect: canvas.getBoundingClientRect(), pts, sent: 0, lastSend: performance.now(), pen: e.pointerType === 'pen' };
      addPoint(e);
      model.live = { id: latest.current.me, c: latest.current.color, pts };
      invalidate();
    };
    const move = (e: PointerEvent) => {
      const touch = touches.get(e.pointerId);
      if (touch) {
        touch.x = e.clientX;
        touch.y = e.clientY;
        if (pinch) return updatePinch();
      }
      if (e.pointerId !== active?.pointer) return;
      // Todas las muestras entre dos frames (hasta 240 Hz), no solo la última.
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) addPoint(ev);
      invalidate();
      const now = performance.now();
      if (now - active.lastSend >= SEND_EVERY && active.pts.length > active.sent) {
        latest.current.send({ t: 'pts', c: latest.current.color, p: active.pts.slice(active.sent) });
        active.sent = active.pts.length;
        active.lastSend = now;
      }
    };
    /** Un dedo deja la pizarra. Con menos de dos se acaba el pellizco; el que quede no dibuja hasta volver a tocar. */
    const lift = (e: PointerEvent) => {
      if (touches.delete(e.pointerId) && touches.size < 2) pinch = null;
    };
    const up = (e: PointerEvent) => {
      lift(e);
      if (e.pointerId !== active?.pointer) return;
      // Los demás ven el trazo completo, pero no cuenta hasta que se confirma con ✓.
      if (active.pts.length > active.sent) latest.current.send({ t: 'pts', c: latest.current.color, p: active.pts.slice(active.sent) });
      draftRef.current = active.pts;
      active = null;
      setDraft(true);
      invalidate();
    };
    const cancel = (e: PointerEvent) => {
      lift(e);
      if (e.pointerId !== active?.pointer) return;
      // El sistema interrumpió el gesto (palma, gesto del navegador): no cuenta, se puede repetir.
      active = null;
      model.clearLive();
      latest.current.send({ t: 'cancel' });
    };
    const block = (e: Event) => e.preventDefault();

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('contextmenu', block);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      model.onChange = () => {};
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('contextmenu', block);
    };
  }, [model]);

  // Cambia el rotulador (también recolorea mi trazo sin enviar) o el jugador resaltado: repintar.
  useEffect(() => {
    if (model.live?.id === props.me) model.live.c = props.color;
    model.onChange();
  }, [model, props.me, props.color, props.focus]);

  // Si el turno se acaba sin confirmar (p. ej. se cancela la ronda), el borrador desaparece.
  useEffect(() => {
    if (props.canDraw) return;
    draftRef.current = null;
    setDraft(false);
  }, [props.canDraw]);

  const confirm = () => {
    if (!draftRef.current) return;
    // Se queda pintado como "en curso" hasta que el servidor lo confirma.
    props.send({ t: 'stroke', p: draftRef.current, c: props.color });
    draftRef.current = null;
    setDraft(false);
  };
  const undo = () => {
    draftRef.current = null;
    setDraft(false);
    model.clearLive();
    props.send({ t: 'cancel' });
  };

  const resetZoom = () => {
    zoomRef.current = { k: 1, ox: 0, oy: 0 };
    setZoomed(false);
    model.onChange();
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Pizarra compartida con el dibujo de la ronda"
        className="board border-line rounded-lg border-2 bg-white"
        style={props.canDraw ? { borderColor: COLORS[props.color], cursor: 'crosshair' } : undefined}
      />
      {zoomed && (
        <button className="btn btn-ghost bg-paper absolute top-3 left-3 size-11 rounded-full p-0 shadow-lg" onClick={resetZoom} aria-label="Quitar el zoom">
          <ZoomOut className="size-6" aria-hidden="true" />
        </button>
      )}
      {draft && (
        <div className="absolute right-3 bottom-3 flex gap-3">
          <button className="btn btn-ghost bg-paper size-14 rounded-full p-0 shadow-lg" onClick={undo} aria-label="Deshacer el trazo">
            <Undo2 className="size-7" aria-hidden="true" />
          </button>
          <button className="btn btn-primary size-14 rounded-full p-0 shadow-lg" onClick={confirm} aria-label="Enviar el trazo">
            <Check className="size-8" aria-hidden="true" strokeWidth={3} />
          </button>
        </div>
      )}
    </div>
  );
}
