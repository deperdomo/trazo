// Una sala = un Durable Object. Guarda el estado en memoria, aplica las reglas (src/shared/game.ts)
// y envía a cada jugador solo lo que le corresponde ver.
import { Server, type Connection, type ConnectionContext, type WSMessage } from 'partyserver';
import * as G from '../src/shared/game';

type ConnState = { pid?: string; pending?: { token: string; name: string } } | null;
type Conn = Connection<NonNullable<ConnState>>;

const TOKEN = /^[\w-]{16,64}$/;
// Sala sin nadie conectado: mismos márgenes que mister-white (el anfitrión puede salir a compartir el enlace).
const LOBBY_TTL = 2 * 60_000;
const GAME_TTL = 30 * 60_000;
const MAX_MESSAGE = 60_000; // un trazo de 2000 puntos ocupa ~35 KB

const newId = () => crypto.randomUUID().slice(0, 8);
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

export const dbHeaders = (key = '') => ({
  Authorization: `Bearer ${key}`,
  apikey: key, // lo ignora PostgREST; lo exige Supabase si algún día se usa el stack completo
  'Content-Type': 'application/json',
});

function send(conn: WebSocket, msg: G.ServerMsg) {
  try {
    conn.send(JSON.stringify(msg));
  } catch {
    // conexión ya cerrada
  }
}

// ponytail: sin hibernación, el estado vive en memoria mientras haya alguien conectado.
// Si el uso crece y el tiempo de DO pesa en la factura: hibernate + leer de ctx.storage al despertar.
export class Room extends Server<Env> {
  private room: G.Room | null = null;
  private dbQueue: Promise<unknown> = Promise.resolve();
  private synced = '';
  private turnKey = '';
  private timer?: ReturnType<typeof setTimeout>;

  async onStart() {
    const saved = await this.ctx.storage.get<string>('room');
    if (!saved) return;
    this.room = JSON.parse(saved) as G.Room;
    for (const p of this.room.players) p.connected = false; // tras un reinicio todos reconectan
  }

  private get minPlayers() {
    return Math.max(3, Number(this.env.MIN_PLAYERS) || 5);
  }

  private conns(): Conn[] {
    return [...this.getConnections<NonNullable<ConnState>>()];
  }

  /** RPC desde el Worker (POST /api/rooms). Devuelve false si el código ya está en uso. */
  async create(token: string, name: string): Promise<boolean> {
    if (this.room) return false;
    this.room = G.newRoom(this.name, newId(), token, name);
    this.changed();
    await this.ctx.storage.setAlarm(Date.now() + LOBBY_TTL); // por si el anfitrión no llega a entrar
    return true;
  }

  onConnect(conn: Conn, { request }: ConnectionContext) {
    const q = new URL(request.url).searchParams;
    const token = q.get('token') ?? '';
    const name = (q.get('name') ?? '').trim();
    const room = this.room;
    if (!room) return this.expel(conn, 'La sala no existe o ya se ha cerrado');
    if (!TOKEN.test(token)) return this.expel(conn, 'Solicitud no válida');

    const known = room.players.find((p) => p.token === token);
    if (known) return this.attach(conn, known.id); // reconexión: recupera su asiento en cualquier fase

    const error = G.canJoin(room, name);
    if (error) return this.expel(conn, error);
    if (q.get('mode') === 'request') {
      // Viene de la lista de salas abiertas: espera a que el anfitrión lo acepte.
      conn.setState({ pending: { token, name } });
      send(conn, { t: 'pending' });
      this.toHost({ t: 'request', id: conn.id, name });
      return;
    }
    this.attach(conn, G.addPlayer(room, newId(), token, name).id);
  }

  private attach(conn: Conn, pid: string) {
    const room = this.room!;
    conn.setState({ pid });
    this.ctx.waitUntil(this.ctx.storage.deleteAlarm());
    this.presence();
    send(conn, { t: 'strokes', list: room.strokes });
    if (pid === room.hostId) {
      for (const c of this.conns()) if (c.state?.pending) send(conn, { t: 'request', id: c.id, name: c.state.pending.name });
    }
    this.changed();
  }

  /** Saca a una conexión de la sala con un motivo; el cliente no reconecta. */
  private expel(conn: Conn, msg: string) {
    send(conn, { t: 'closed', msg });
    conn.setState(null);
    conn.close(4000, 'closed');
  }

  private toHost(msg: G.ServerMsg) {
    for (const c of this.conns()) if (c.state?.pid === this.room?.hostId) send(c, msg);
  }

  private toAll(msg: G.ServerMsg) {
    for (const c of this.conns()) if (c.state?.pid) send(c, msg);
  }

  private presence(closing?: string) {
    const online = new Set(this.conns().filter((c) => c.id !== closing).map((c) => c.state?.pid));
    for (const p of this.room!.players) p.connected = online.has(p.id);
  }

  /** Tras cualquier cambio: snapshot local, vista personalizada a cada jugador y registro en la base de datos. */
  private changed() {
    const room = this.room!;
    this.clock();
    this.ctx.waitUntil(this.ctx.storage.put('room', JSON.stringify(room)));
    for (const c of this.conns()) {
      if (c.state?.pid) send(c, { t: 'state', s: G.viewFor(room, c.state.pid, this.minPlayers) });
    }
    this.syncDb();
  }

  /** Cuenta atrás de cada trazo. Se rearma al cambiar de turno, al agotarse y al salir de una pausa. */
  // ponytail: setTimeout en memoria. Si el Durable Object se reinicia, el turno en curso vuelve a empezar con 30 s.
  private clock() {
    const room = this.room!;
    const key = room.phase === 'drawing' ? `${room.round}:${room.turn}` : '';
    if (key === this.turnKey && (this.timer || !key)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = key ? setTimeout(() => this.timeUp(), G.TURN_MS) : undefined;
    this.turnKey = key;
    room.turnEnds = key ? Date.now() + G.TURN_MS : 0;
  }

  private timeUp() {
    this.timer = undefined;
    const room = this.room;
    if (!room || room.phase !== 'drawing') return;
    // Quien dibuja está desconectado: se pausa sin restar (el anfitrión puede saltarle). Al volver, clock() le da otros 30 s.
    if (!room.players.find((p) => p.id === G.currentDrawer(room))?.connected) return;
    G.timeOut(room);
    this.changed(); // mismo turno sin temporizador: clock() le da otros 30 s
  }

  onMessage(conn: Conn, raw: WSMessage) {
    const room = this.room;
    const pid = conn.state?.pid;
    if (!room || !pid || typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;

    // Trazo en curso: se reenvía tal cual a los demás, sin tocar el estado.
    if (m.t === 'pts' || m.t === 'cancel') {
      if (G.currentDrawer(room) !== pid) return;
      if (m.t === 'pts' && !(G.validPoints(m.p) && G.validColor(m.c))) return;
      const out = JSON.stringify(m.t === 'pts' ? { t: 'pts', id: pid, c: m.c, p: m.p } : { t: 'cancel' });
      for (const c of this.conns()) if (c.state?.pid && c.id !== conn.id) c.send(out);
      return;
    }

    const before = room.phase;
    let error: string | undefined;
    switch (m.t) {
      case 'stroke':
        error = G.addStroke(room, pid, m.p, m.c);
        // Rechazado: se reenvía el dibujo real para que el cliente descarte el suyo.
        if (error) return send(conn, { t: 'strokes', list: room.strokes });
        this.toAll({ t: 'stroke', s: room.strokes.at(-1)! });
        break;
      case 'start':
        error = G.startGame(room, pid, this.minPlayers);
        break;
      case 'setup':
        error = G.setup(room, pid, m.category, m.word, random);
        break;
      case 'skip':
        error = G.skipTurn(room, pid);
        break;
      case 'openVote':
        error = G.openVote(room, pid);
        break;
      case 'vote':
        error = G.vote(room, pid, m.id);
        break;
      case 'closeVote':
        error = G.closeVote(room, pid);
        break;
      case 'guess':
        error = G.submitGuess(room, pid, m.text);
        break;
      case 'judge':
        error = G.judge(room, pid, m.ok);
        break;
      case 'next':
        error = G.nextRound(room, pid);
        break;
      case 'abort':
        error = G.abort(room, pid);
        break;
      case 'kick':
        return this.remove(pid, m.id);
      case 'leave':
        return this.remove(pid, pid);
      case 'answer':
        return this.answer(pid, m.id, m.ok === true);
      default:
        return;
    }
    if (error) return send(conn, { t: 'toast', msg: error });

    if (before === 'lobby' && room.phase !== 'lobby') {
      for (const c of this.conns()) if (c.state?.pending) this.expel(c, 'La partida ya ha empezado');
    }
    if (before !== room.phase && !room.strokes.length) this.toAll({ t: 'strokes', list: [] }); // pizarra en blanco
    if (before !== 'result' && room.phase === 'result') this.saveRound();
    this.changed();
  }

  /** Salir o expulsar, solo en la sala de espera. Si se va el anfitrión, la sala se cierra. */
  private remove(by: string, target: unknown) {
    const room = this.room!;
    if (room.phase !== 'lobby' || (by !== target && by !== room.hostId)) return;
    if (target === room.hostId) return this.closeRoom('El anfitrión ha cerrado la sala');
    if (typeof target !== 'string' || G.removePlayer(room, target)) return;
    for (const c of this.conns()) {
      if (c.state?.pid === target) this.expel(c, by === target ? '' : 'El anfitrión te ha sacado de la sala');
    }
    this.changed();
  }

  /** El anfitrión responde a una solicitud de entrada. */
  private answer(by: string, connId: unknown, ok: boolean) {
    const room = this.room!;
    if (by !== room.hostId || typeof connId !== 'string') return;
    const conn = this.getConnection<NonNullable<ConnState>>(connId);
    const pending = conn?.state?.pending;
    if (!conn || !pending) return;
    const host = room.players.find((p) => p.id === room.hostId);
    const error = ok ? G.canJoin(room, pending.name) : `${host?.name ?? 'El anfitrión'} ha rechazado tu solicitud`;
    if (error) return this.expel(conn, error);
    this.attach(conn, G.addPlayer(room, newId(), pending.token, pending.name).id);
  }

  onClose(conn: Conn) {
    const room = this.room;
    if (!room || !conn.state) return;
    if (conn.state.pending) return this.toHost({ t: 'requestGone', id: conn.id });
    this.presence(conn.id);
    this.changed();
    if (!room.players.some((p) => p.connected)) {
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + (room.phase === 'lobby' ? LOBBY_TTL : GAME_TTL)));
    }
  }

  onError(conn: Conn) {
    this.onClose(conn);
  }

  async onAlarm() {
    if (this.room && !this.conns().some((c) => c.state?.pid)) await this.closeRoom('');
  }

  private async closeRoom(msg: string) {
    const code = this.room!.code;
    this.room = null; // antes de expulsar: onClose ya no hace nada
    this.synced = '';
    for (const c of this.conns()) this.expel(c, msg);
    this.db('DELETE', `trazo_rooms?code=eq.${code}`);
    await this.ctx.storage.delete('room');
    await this.ctx.storage.deleteAlarm();
  }

  // --- Base de datos (PostgREST en Oracle). Opcional: sin DB_URL se juega igual. ---

  /** Escrituras en segundo plano y en orden. Un fallo se registra y no afecta a la partida. */
  private db(method: string, path: string, body?: unknown, prefer = 'return=minimal') {
    const url: string = this.env.DB_URL;
    if (!url) return;
    this.dbQueue = this.dbQueue
      .then(() =>
        fetch(`${url}/${path}`, {
          method,
          headers: { ...dbHeaders(this.env.DB_KEY), Prefer: prefer },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(5000),
        }),
      )
      .then(async (res) => {
        if (!res.ok) console.warn(`db ${method} ${path}: ${res.status} ${await res.text()}`);
      })
      .catch((e) => console.warn(`db ${method} ${path}: ${e}`));
    this.ctx.waitUntil(this.dbQueue);
  }

  /** Mantiene la fila de la sala (lista de salas abiertas). Solo escribe si algo ha cambiado. */
  private syncDb() {
    const room = this.room!;
    const row = {
      code: room.code,
      status: room.phase === 'lobby' ? 'waiting' : 'playing',
      host_name: room.players.find((p) => p.id === room.hostId)?.name ?? '',
      player_count: room.players.length,
    };
    const key = JSON.stringify(row);
    if (key === this.synced) return;
    this.synced = key;
    this.db('POST', 'trazo_rooms', { ...row, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
  }

  /** Historial: una fila por ronda terminada, con el dibujo. */
  private saveRound() {
    const room = this.room!;
    const name = (id: string) => room.players.find((p) => p.id === id)?.name ?? '?';
    this.db('POST', 'trazo_rounds', {
      room_code: room.code,
      round_number: room.round,
      category: room.category,
      word: room.word,
      qm_name: name(room.qmId),
      fake_name: name(room.fakeId),
      caught: room.caught,
      guess: room.guess,
      guessed: room.guessed,
      players: room.players.map((p) => ({ name: p.name, score: p.score })),
      votes: Object.entries(room.votes).map(([from, to]) => ({ from: name(from), to: name(to) })),
      strokes: room.strokes.map((s) => ({ player: name(s.id), color: G.COLORS[s.c] ?? G.COLORS[0], pts: s.pts })),
    });
  }
}
