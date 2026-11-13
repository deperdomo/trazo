// La pizarra. El dibujo NO pasa por el estado de React: los puntos llegan a un modelo mutable
// y el canvas se repinta en requestAnimationFrame solo cuando algo cambia.
import { useEffect, useRef } from 'react';
import { getStroke } from 'perfect-freehand';
import { BOARD, MAX_STROKE_POINTS, type Stroke } from '../shared/game';

// Ajustes del rotulador, en unidades de pizarra (lado = 1000). Afinar probando en móvil real.
// size: grosor (1,6 % del lado). thinning: cuánto adelgaza con la velocidad/presión (0 = grosor fijo).
// streamline: cuánto suaviza el pulso (más = trazo más limpio, pero sigue al dedo con algo de retraso).
const PEN = { size: 16, thinning: 0.25, smoothing: 0.5, streamline: 0.4 };
const MIN_DIST = 1.5; // separación mínima entre puntos guardados
const SEND_EVERY = 40; // ms entre lotes del trazo en vivo
const PAPER = '#fffdf8';

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
  addLive(id: string, pts: number[]) {
    if (this.live?.id !== id) this.live = { id, pts: [] };
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
  colors: Record<string, string>; // id de jugador -> color de su rotulador
  me: string;
  canDraw: boolean;
  send: (msg: object) => void;
}

export default function Board(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const { model } = props;

  useEffect(() => {
    const canvas = canvasRef.current!;
    // desynchronized: pista para pintar con menos latencia donde el navegador lo soporte.
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;
    const paths = new WeakMap<Stroke, Path2D>();
    let frame = 0;
    let active: { pointer: number; rect: DOMRect; pts: number[]; sent: number; lastSend: number; pen: boolean } | null = null;

    const draw = () => {
      frame = 0;
      const { colors } = latest.current;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scale = canvas.width / BOARD;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (const stroke of model.strokes) {
        let path = paths.get(stroke);
        if (!path) paths.set(stroke, (path = pathOf(stroke.pts, true)));
        ctx.fillStyle = colors[stroke.id] ?? '#1f2328';
        ctx.fill(path);
      }
      if (model.live) {
        ctx.fillStyle = colors[model.live.id] ?? '#1f2328';
        ctx.fill(pathOf(model.live.pts, false));
      }
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
      const x = Math.round(clamp(((e.clientX - rect.left) / rect.width) * BOARD, BOARD) * 10) / 10;
      const y = Math.round(clamp(((e.clientY - rect.top) / rect.height) * BOARD, BOARD) * 10) / 10;
      const n = pts.length;
      if (n && Math.hypot(x - pts[n - 3], y - pts[n - 2]) < MIN_DIST) return;
      pts.push(x, y, active.pen ? Math.round(clamp(Math.max(0.05, e.pressure), 1) * 100) / 100 : 0);
    };

    const down = (e: PointerEvent) => {
      // Un solo trazo: puntero primario, botón principal, y solo si es tu turno y no hay otro trazo pendiente.
      if (!latest.current.canDraw || model.live || active || !e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const pts: number[] = [];
      active = { pointer: e.pointerId, rect: canvas.getBoundingClientRect(), pts, sent: 0, lastSend: performance.now(), pen: e.pointerType === 'pen' };
      addPoint(e);
      model.live = { id: latest.current.me, pts };
      invalidate();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== active?.pointer) return;
      // Todas las muestras entre dos frames (hasta 240 Hz), no solo la última.
      const events = e.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e]) addPoint(ev);
      invalidate();
      const now = performance.now();
      if (now - active.lastSend >= SEND_EVERY && active.pts.length > active.sent) {
        latest.current.send({ t: 'pts', p: active.pts.slice(active.sent) });
        active.sent = active.pts.length;
        active.lastSend = now;
      }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active?.pointer) return;
      // El trazo se queda pintado como "en curso" hasta que el servidor lo confirma.
      latest.current.send({ t: 'stroke', p: active.pts });
      active = null;
      invalidate();
    };
    const cancel = (e: PointerEvent) => {
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

  // Cambian los colores (o el turno): repintar.
  useEffect(() => model.onChange(), [model, props.colors]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Pizarra compartida con el dibujo de la ronda"
      className="board border-line rounded-lg border-2 bg-white"
      style={props.canDraw ? { borderColor: props.colors[props.me], cursor: 'crosshair' } : undefined}
    />
  );
}
