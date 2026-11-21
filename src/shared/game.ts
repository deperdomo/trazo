// Reglas de Trazo. Lógica pura: sin DOM ni APIs del Worker.
// El servidor (worker/room.ts) es la autoridad; el cliente solo usa tipos y constantes.
// Las acciones mutan la sala y devuelven un mensaje de error, o undefined si todo fue bien.

export const MAX_PLAYERS = 10;
export const WIN_SCORE = 5;
export const LAPS = 2; // vueltas de trazos por ronda
export const NAME_MAX = 20;
export const TEXT_MAX = 40; // categoría y palabra
export const BOARD = 1000; // lado de la pizarra en unidades lógicas
export const MAX_STROKE_POINTS = 2000;
export const TURN_MS = 30_000; // tiempo para cada trazo; si se agota, -1 punto y vuelve a empezar (el turno lo pasa el anfitrión)

// Rotuladores: el color se elige en cada trazo. Legibles sobre papel claro.
export const COLORS = [
  '#1f2328', // negro
  '#e03131', // rojo
  '#1971c2', // azul
  '#2f9e44', // verde
  '#f08c00', // naranja
  '#7048e8', // violeta
  '#e64980', // rosa
  '#8d5524', // marrón
  '#0ca5b0', // turquesa
  '#74b816', // lima
] as const;
export const COLOR_NAMES = ['Negro', 'Rojo', 'Azul', 'Verde', 'Naranja', 'Violeta', 'Rosa', 'Marrón', 'Turquesa', 'Lima'];

export type Phase = 'lobby' | 'setup' | 'drawing' | 'voting' | 'guess' | 'result';

export interface Player {
  id: string; // público
  token: string; // secreto: identifica al navegador del jugador
  name: string;
  score: number;
  connected: boolean;
}

/** Un trazo: jugador que lo hizo, color (índice en COLORS) y puntos [x, y, presión, x, y, presión, ...]. Presión 0 = sin sensor (se simula). */
export interface Stroke {
  id: string;
  c: number;
  pts: number[];
}

export interface Room {
  code: string;
  hostId: string;
  players: Player[]; // orden de asiento
  phase: Phase;
  round: number;
  qmId: string;
  category: string;
  word: string;
  fakeId: string;
  order: string[]; // artistas en orden de dibujo
  turn: number;
  strokes: Stroke[];
  turnEnds: number; // fin del turno de dibujo (reloj del servidor, lo pone worker/room.ts); 0 = sin cuenta atrás
  voteOpen: boolean;
  votes: Record<string, string>; // quién vota -> a quién
  caught: boolean | null;
  guess: string | null;
  guessed: boolean | null;
  deltas: Record<string, number>; // puntos ganados en esta ronda
  winners: string[];
}

/** Lo que ve un jugador concreto: la sala sin los secretos que no le corresponden. */
export interface View {
  code: string;
  you: string;
  hostId: string;
  minPlayers: number;
  players: Omit<Player, 'token'>[];
  phase: Phase;
  round: number;
  qmId: string;
  category: string;
  card: string | null; // tu carta: la palabra, o "X" si eres el falso artista
  word: string | null; // la palabra, cuando ya es pública
  fakeId: string | null; // el QM lo sabe siempre; el resto, cuando lo pillan o acaba la ronda
  order: string[];
  turn: number;
  turnLeft: number; // ms que le quedan al turno (relativo: los relojes de los móviles no coinciden); 0 = sin cuenta atrás
  voteOpen: boolean;
  voted: string[];
  votes: Record<string, string> | null; // ocultos hasta el recuento
  caught: boolean | null;
  guess: string | null;
  guessed: boolean | null;
  deltas: Record<string, number>;
  winners: string[];
}

const roundReset = {
  category: '',
  word: '',
  fakeId: '',
  order: [] as string[],
  turn: 0,
  strokes: [] as Stroke[],
  turnEnds: 0,
  voteOpen: false,
  votes: {} as Record<string, string>,
  caught: null,
  guess: null,
  guessed: null,
  deltas: {} as Record<string, number>,
  winners: [] as string[],
};

const resetRound = (room: Room) => Object.assign(room, structuredClone(roundReset));

export const isValidName = (name: unknown): name is string =>
  typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= NAME_MAX;

const cleanText = (v: unknown) =>
  typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= TEXT_MAX ? v.trim() : null;

/** Para comparar el intento del falso artista: sin mayúsculas, tildes ni espacios de más. */
export const normalize = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ');

export function validPoints(pts: unknown): pts is number[] {
  if (!Array.isArray(pts) || pts.length < 3 || pts.length % 3 !== 0 || pts.length > MAX_STROKE_POINTS * 3) return false;
  for (let i = 0; i < pts.length; i++) {
    const v = pts[i];
    if (typeof v !== 'number' || !(v >= 0) || v > (i % 3 === 2 ? 1 : BOARD)) return false;
  }
  return true;
}

export function newRoom(code: string, hostId: string, hostToken: string, hostName: string): Room {
  const room = { code, hostId, players: [], phase: 'lobby', round: 0, qmId: hostId, ...structuredClone(roundReset) } as Room;
  addPlayer(room, hostId, hostToken, hostName);
  return room;
}

export function canJoin(room: Room, name: unknown): string | undefined {
  if (room.phase !== 'lobby') return 'La partida ya ha empezado';
  if (room.players.length >= MAX_PLAYERS) return 'La sala está llena';
  if (!isValidName(name)) return `El nombre debe tener entre 2 y ${NAME_MAX} caracteres`;
  const lower = name.trim().toLowerCase();
  if (room.players.some((p) => p.name.toLowerCase() === lower)) return 'Ese nombre ya está en la sala';
}

/** Llamar antes a canJoin. */
export function addPlayer(room: Room, id: string, token: string, name: string): Player {
  const player: Player = { id, token, name: name.trim(), score: 0, connected: false };
  room.players.push(player);
  return player;
}

export function removePlayer(room: Room, id: string): string | undefined {
  if (room.phase !== 'lobby') return 'No se puede salir con la ronda en marcha';
  room.players = room.players.filter((p) => p.id !== id);
}

export const validColor = (c: unknown): c is number => typeof c === 'number' && c in COLORS;

const artistsOf = (room: Room) => room.players.filter((p) => p.id !== room.qmId).map((p) => p.id);
const isBoss = (room: Room, id: string) => id === room.qmId || id === room.hostId;

export function startGame(room: Room, by: string, minPlayers: number): string | undefined {
  if (by !== room.hostId) return 'Solo el anfitrión puede empezar';
  if (room.phase !== 'lobby') return 'La partida ya ha empezado';
  if (room.players.length < minPlayers) return `Hacen falta al menos ${minPlayers} jugadores`;
  // Tras cancelar una ronda sigue el mismo QM, si no se ha ido.
  if (!room.players.some((p) => p.id === room.qmId)) room.qmId = room.hostId;
  resetRound(room);
  room.round++;
  room.phase = 'setup';
}

/** El QM elige categoría y palabra. `rand` sortea al falso artista y quién hace el primer trazo. */
export function setup(
  room: Room,
  by: string,
  category: unknown,
  word: unknown,
  rand: () => number,
): string | undefined {
  if (room.phase !== 'setup') return 'Ahora no toca elegir palabra';
  if (by !== room.qmId) return 'Solo el QM elige la palabra';
  const c = cleanText(category);
  const w = cleanText(word);
  if (!c || !w) return `Categoría y palabra: entre 1 y ${TEXT_MAX} caracteres`;
  const artists = artistsOf(room);
  room.category = c;
  room.word = w;
  room.fakeId = artists[Math.floor(rand() * artists.length)];
  const first = Math.floor(rand() * artists.length);
  room.order = [...artists.slice(first), ...artists.slice(0, first)];
  room.phase = 'drawing';
}

export const currentDrawer = (room: Room): string | null =>
  room.phase === 'drawing' ? room.order[room.turn % room.order.length] : null;

function advanceTurn(room: Room) {
  room.turn++;
  if (room.turn >= room.order.length * LAPS) room.phase = 'voting';
}

export function addStroke(room: Room, by: string, pts: unknown, color: unknown): string | undefined {
  if (currentDrawer(room) !== by) return 'No es tu turno';
  if (!validPoints(pts) || !validColor(color)) return 'Trazo no válido';
  room.strokes.push({ id: by, c: color, pts });
  advanceTurn(room);
}

/** Para no atascarse: el anfitrión salta el turno de quien se ha desconectado. */
export function skipTurn(room: Room, by: string): string | undefined {
  if (by !== room.hostId) return 'Solo el anfitrión puede saltar un turno';
  const drawer = room.players.find((p) => p.id === currentDrawer(room));
  if (!drawer) return 'Nadie está dibujando';
  if (drawer.connected) return `${drawer.name} sigue conectado`;
  advanceTurn(room);
}

/** Se agotó el tiempo del trazo: -1 punto (el marcador puede quedar en negativo). Sigue dibujando el mismo. */
export function timeOut(room: Room): string | undefined {
  const drawer = room.players.find((p) => p.id === currentDrawer(room));
  if (!drawer) return 'Nadie está dibujando';
  drawer.score--;
}

export function openVote(room: Room, by: string): string | undefined {
  if (room.phase !== 'voting' || room.voteOpen) return 'Ahora no se puede abrir la votación';
  if (!isBoss(room, by)) return 'La cuenta atrás la da el QM';
  room.voteOpen = true;
}

export function vote(room: Room, by: string, target: unknown): string | undefined {
  if (room.phase !== 'voting' || !room.voteOpen) return 'La votación no está abierta';
  if (!room.order.includes(by)) return 'El QM no vota';
  if (room.votes[by]) return 'Ya has votado';
  if (typeof target !== 'string' || target === by || !room.order.includes(target)) return 'Voto no válido';
  room.votes[by] = target;
  if (Object.keys(room.votes).length === room.order.length) tally(room);
}

/** Cierra la votación aunque falte alguien por votar (p. ej. un desconectado). */
export function closeVote(room: Room, by: string): string | undefined {
  if (room.phase !== 'voting' || !room.voteOpen) return 'La votación no está abierta';
  if (!isBoss(room, by)) return 'Solo el QM puede cerrar la votación';
  tally(room);
}

/** Pillado solo si tiene más votos que cualquier otro: empatar en el máximo no cuenta. */
export function isCaught(votes: Record<string, string>, fakeId: string): boolean {
  const counts: Record<string, number> = {};
  for (const target of Object.values(votes)) counts[target] = (counts[target] ?? 0) + 1;
  const fake = counts[fakeId] ?? 0;
  return fake > 0 && Object.entries(counts).every(([id, n]) => id === fakeId || n < fake);
}

function tally(room: Room) {
  room.caught = isCaught(room.votes, room.fakeId);
  if (room.caught) room.phase = 'guess';
  else score(room, true);
}

/** Última oportunidad del falso artista: un solo intento. */
export function submitGuess(room: Room, by: string, text: unknown): string | undefined {
  if (room.phase !== 'guess' || room.guess !== null) return 'Ahora no se puede adivinar';
  if (by !== room.fakeId) return 'Solo adivina el falso artista';
  const guess = cleanText(text);
  if (!guess) return `Escribe una palabra (máximo ${TEXT_MAX} caracteres)`;
  room.guess = guess;
  // Si no coincide exactamente decide el QM (erratas, sinónimos): ver judge().
  if (normalize(guess) === normalize(room.word)) {
    room.guessed = true;
    score(room, true);
  }
}

export function judge(room: Room, by: string, ok: unknown): string | undefined {
  if (room.phase !== 'guess' || room.guess === null) return 'No hay intento que valorar';
  if (!isBoss(room, by)) return 'Lo decide el QM';
  room.guessed = ok === true;
  score(room, room.guessed);
}

function score(room: Room, fakeWins: boolean) {
  room.deltas = fakeWins
    ? { [room.fakeId]: 2, [room.qmId]: 2 }
    : Object.fromEntries(room.order.filter((id) => id !== room.fakeId).map((id) => [id, 1]));
  for (const p of room.players) p.score += room.deltas[p.id] ?? 0;
  room.winners = room.players.filter((p) => p.score >= WIN_SCORE).map((p) => p.id);
  room.phase = 'result';
}

/** Siguiente ronda con el QM a la izquierda del actual; si hay ganador, vuelta a la sala de espera. */
export function nextRound(room: Room, by: string): string | undefined {
  if (room.phase !== 'result') return 'La ronda no ha terminado';
  if (!isBoss(room, by)) return 'Solo el QM o el anfitrión pueden continuar';
  if (room.winners.length) {
    for (const p of room.players) p.score = 0;
    resetRound(room);
    room.round = 0;
    room.qmId = room.hostId;
    room.phase = 'lobby';
    return;
  }
  const seat = room.players.findIndex((p) => p.id === room.qmId);
  room.qmId = room.players[(seat + 1) % room.players.length].id;
  resetRound(room);
  room.round++;
  room.phase = 'setup';
}

/** El anfitrión cancela la ronda y vuelve a la sala de espera (se conservan los puntos). */
export function abort(room: Room, by: string): string | undefined {
  if (by !== room.hostId) return 'Solo el anfitrión puede cancelar la ronda';
  if (room.phase === 'lobby') return 'No hay ronda en marcha';
  resetRound(room);
  room.round--;
  room.phase = 'lobby';
}

export function viewFor(room: Room, you: string, minPlayers: number): View {
  const playing = room.phase === 'drawing' || room.phase === 'voting' || room.phase === 'guess';
  const revealed = room.phase === 'result' || (room.phase === 'guess' && room.guess !== null);
  const tallied = room.phase === 'guess' || room.phase === 'result';
  return {
    code: room.code,
    you,
    hostId: room.hostId,
    minPlayers,
    players: room.players.map(({ token: _token, ...p }) => p),
    phase: room.phase,
    round: room.round,
    qmId: room.qmId,
    category: room.category,
    card: playing ? (you === room.fakeId ? 'X' : room.word) : null,
    word: revealed ? room.word : null,
    fakeId: tallied || (playing && you === room.qmId) ? room.fakeId : null,
    order: room.order,
    turn: room.turn,
    turnLeft: room.turnEnds ? Math.max(0, room.turnEnds - Date.now()) : 0,
    voteOpen: room.voteOpen,
    voted: Object.keys(room.votes),
    votes: tallied ? room.votes : null,
    caught: room.caught,
    guess: room.guess,
    guessed: room.guessed,
    deltas: room.deltas,
    winners: room.winners,
  };
}

/** Mensajes del servidor al cliente. */
export type ServerMsg =
  | { t: 'state'; s: View }
  | { t: 'strokes'; list: Stroke[] } // dibujo completo (al entrar, al limpiar o al rechazar un trazo)
  | { t: 'stroke'; s: Stroke } // trazo terminado
  | { t: 'pts'; id: string; c: number; p: number[] } // puntos del trazo que alguien está haciendo ahora
  | { t: 'cancel' } // el trazo en curso se ha descartado
  | { t: 'pending' } // solicitud de entrada enviada al anfitrión
  | { t: 'request'; id: string; name: string } // (anfitrión) alguien pide entrar
  | { t: 'requestGone'; id: string }
  | { t: 'toast'; msg: string }
  | { t: 'closed'; msg: string }; // fuera de la sala: no reconectar
