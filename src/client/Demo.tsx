// /demo: las pantallas reales con jugadores simulados, para revisar el diseño desde un solo dispositivo.
// La sala vive en memoria y usa las mismas reglas que el servidor (shared/game.ts). No se conecta ni guarda nada.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as G from '../shared/game';
import { BoardModel } from './Board';
import Game from './Game';
import Lobby from './Lobby';
import { Toast } from './ui';
import type { JoinRequest, RoomConn } from './useRoom';

const MIN_PLAYERS = 3;
const NAMES = ['Ana', 'Beto', 'Cristina', 'Dani', 'Eva', 'Fran'];
const SCENES = ['Sala de espera', 'Elegir palabra', 'Dibujando', 'Votación', 'Adivinar', 'Resultado', 'Fin de partida'] as const;
type Scene = (typeof SCENES)[number];

// Un dibujo de ejemplo (una jirafa), un trazo por turno. Los turnos 2 y 7 son del falso artista: no pintan nada.
type Shape = (t: number) => [number, number];
const line = (x1: number, y1: number, x2: number, y2: number): Shape => (t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
const oval = (cx: number, cy: number, rx: number, ry: number): Shape => (t) => [cx + rx * Math.cos(6.4 * t), cy + ry * Math.sin(6.4 * t)];
const SHAPES: Shape[] = [
  oval(450, 620, 170, 90), // cuerpo
  line(560, 560, 680, 270), // cuello
  (t) => [150 + 220 * t, 320 + 35 * Math.sin(14 * t)], // garabato
  oval(725, 235, 62, 36), // cabeza
  line(340, 690, 330, 890), // patas
  line(560, 690, 570, 890),
  line(400, 705, 395, 890),
  oval(170, 150, 55, 55), // un círculo sin sentido
  line(510, 705, 515, 890),
  (t) => [285 - 70 * t, 600 + 110 * t * t], // cola
];
const points = (turn: number) => {
  const pts: number[] = [];
  for (let i = 0; i <= 40; i++) pts.push(...SHAPES[turn % SHAPES.length](i / 40).map(Math.round), 0);
  return pts;
};

/** Sala nueva llevada hasta la escena pedida con las reglas de verdad. */
function build(scene: Scene): G.Room {
  const room = G.newRoom('DEMO01', 'p0', '', NAMES[0]);
  NAMES.slice(1).forEach((name, i) => G.addPlayer(room, `p${i + 1}`, '', name));
  for (const p of room.players) p.connected = true;
  if (scene === 'Sala de espera') return room;
  G.startGame(room, 'p0', MIN_PLAYERS);
  if (scene === 'Elegir palabra') return room;
  G.setup(room, 'p0', 'Animales', 'Jirafa', 'p1', () => 0.5); // el falso artista es Dani (p3)
  const strokes = scene === 'Dibujando' ? 4 : room.order.length * G.LAPS;
  for (let turn = 0; turn < strokes; turn++) G.addStroke(room, G.currentDrawer(room)!, points(turn), turn % G.COLORS.length);
  if (scene === 'Dibujando' || scene === 'Votación') return room;
  G.openVote(room, 'p0');
  for (const [from, to] of [['p1', 'p3'], ['p2', 'p3'], ['p3', 'p1'], ['p4', 'p3'], ['p5', 'p2']]) G.vote(room, from, to);
  if (scene === 'Adivinar') return room;
  if (scene === 'Fin de partida') room.players[1].score = G.WIN_SCORE - 1;
  G.submitGuess(room, 'p3', 'Cebra');
  G.judge(room, 'p0', false);
  return room;
}

/** Lo que haría el resto de la mesa: un paso cada vez, para poder jugar la ronda solo. */
function botStep(room: G.Room, me: string, board: BoardModel): boolean {
  const { qmId, fakeId, order } = room;
  switch (room.phase) {
    case 'setup':
      if (qmId === me) return false;
      G.setup(room, qmId, 'Animales', 'Jirafa', room.players.find((p) => p.id !== qmId)!.id, Math.random);
      return true;
    case 'drawing': {
      const drawer = G.currentDrawer(room)!;
      if (drawer === me) return false;
      G.addStroke(room, drawer, points(room.turn), room.turn % G.COLORS.length);
      board.commit(room.strokes.at(-1)!);
      return true;
    }
    case 'voting': {
      if (!room.voteOpen) return qmId !== me && !G.openVote(room, qmId);
      const voter = order.find((id) => id !== me && !room.votes[id]);
      if (!voter) return false;
      G.vote(room, voter, voter === fakeId ? order.find((id) => id !== fakeId)! : fakeId);
      return true;
    }
    case 'guess':
      if (room.guess === null) return fakeId !== me && !G.submitGuess(room, fakeId, 'Cebra');
      return qmId !== me && !G.judge(room, qmId, false);
    default:
      return false;
  }
}

export default function Demo() {
  const [board] = useState(() => new BoardModel());
  const roomRef = useRef<G.Room>(null!);
  roomRef.current ??= build('Sala de espera');
  const room = roomRef.current;
  const [version, refresh] = useReducer((n: number) => n + 1, 0);
  const [me, setMe] = useState('p0');
  const [requests, setRequests] = useState<JoinRequest[]>([{ id: 'r1', name: 'Marta' }]);
  const [toast, setToast] = useState('');

  const go = (scene: Scene) => {
    roomRef.current = build(scene);
    board.reset([...roomRef.current.strokes]);
    setRequests(scene === 'Sala de espera' ? [{ id: 'r1', name: 'Marta' }] : []);
    setToast('');
    refresh();
  };

  // Los demás jugadores actúan solos, con una pausa para que se vea el cambio.
  useEffect(() => {
    const id = setTimeout(() => botStep(room, me, board) && refresh(), 900);
    return () => clearTimeout(id);
  }, [room, version, me, board]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const conn = useMemo<RoomConn>(() => {
    // Lo mismo que hace el servidor al recibir un mensaje (worker/room.ts), sobre la sala en memoria.
    const send = (msg: object) => {
      const m = msg as Record<string, unknown>;
      const before = room.phase;
      let error: string | undefined;
      switch (m.t) {
        case 'stroke':
          error = G.addStroke(room, me, m.p, m.c);
          if (error) board.reset([...room.strokes]);
          else board.commit(room.strokes.at(-1)!);
          break;
        case 'start':
          error = G.startGame(room, me, MIN_PLAYERS);
          break;
        case 'setup':
          error = G.setup(room, me, m.category, m.word, m.first, Math.random);
          break;
        case 'skip':
          error = G.skipTurn(room, me);
          break;
        case 'openVote':
          error = G.openVote(room, me);
          break;
        case 'vote':
          error = G.vote(room, me, m.id);
          break;
        case 'closeVote':
          error = G.closeVote(room, me);
          break;
        case 'guess':
          error = G.submitGuess(room, me, m.text);
          break;
        case 'judge':
          error = G.judge(room, me, m.ok);
          break;
        case 'next':
          error = G.nextRound(room, me);
          break;
        case 'abort':
          error = G.abort(room, me);
          break;
        case 'kick':
          if (me === room.hostId && m.id !== me) error = G.removePlayer(room, m.id as string);
          break;
        default:
          return; // pts y cancel: no hay nadie más mirando
      }
      if (error) setToast(error);
      if (before !== room.phase && !room.strokes.length) board.reset([]);
      refresh();
    };
    const answer = (id: string, ok: boolean) => {
      const req = requests.find((r) => r.id === id);
      setRequests((list) => list.filter((r) => r.id !== id));
      if (ok && req && !G.canJoin(room, req.name)) G.addPlayer(room, 'p9', '', req.name).connected = true;
      refresh();
    };
    return { view: null, pending: false, online: true, requests, toast, board, send, answer };
  }, [room, me, board, requests, toast]);

  const you = room.players.some((p) => p.id === me) ? me : room.hostId;
  const view = G.viewFor(room, you, MIN_PLAYERS);
  const role = (id: string) =>
    [id === room.hostId && 'anfitrión', id === room.qmId && room.phase !== 'lobby' && 'QM', id === room.fakeId && 'falso artista']
      .filter(Boolean)
      .join(', ');

  return (
    <>
      {view.phase === 'lobby' ? (
        <Lobby room={conn} view={view} onLeave={() => location.assign('/')} />
      ) : (
        <Game room={conn} view={view} />
      )}
      <Toast text={toast} />
      <details className="bg-paper border-line fixed bottom-2 left-2 z-50 max-w-64 rounded-lg border text-sm shadow-lg">
        <summary className="cursor-pointer px-3 py-2 font-bold select-none">Demo</summary>
        <div className="flex flex-col gap-2 p-3 pt-0">
          <label className="label" htmlFor="demo-me">
            Ver como
          </label>
          <select id="demo-me" className="input" value={you} onChange={(e) => setMe(e.target.value)}>
            {room.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {role(p.id) && ` (${role(p.id)})`}
              </option>
            ))}
          </select>
          <p className="label">Ir a</p>
          {SCENES.map((scene) => (
            <button key={scene} className="btn btn-ghost min-h-11 justify-start" onClick={() => go(scene)}>
              {scene}
            </button>
          ))}
          <a className="text-muted underline" href="/">
            Salir de la demo
          </a>
        </div>
      </details>
    </>
  );
}
