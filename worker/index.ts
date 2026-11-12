// Worker: sirve la SPA (static assets), la API de salas y enruta los WebSocket a cada sala.
import { getServerByName, routePartykitRequest } from 'partyserver';
import { isValidName } from '../src/shared/game';
import { dbHeaders, Room } from './room';

export { Room };

const CODE = /^[A-Z0-9]{6}$/;
const TOKEN = /^[\w-]{16,64}$/;
// Sin 0/O ni 1/I: el código se dicta en voz alta.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('');

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// ponytail: sin límite de peticiones propio. Si alguien abusa de crear salas,
// añadir una regla de Rate Limiting de Cloudflare sobre POST /api/rooms.
async function createRoom(request: Request, env: Env) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; name?: unknown } | null;
  if (!body || typeof body.token !== 'string' || !TOKEN.test(body.token) || !isValidName(body.name)) {
    return json({ error: 'Solicitud no válida' }, 400);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const room = await getServerByName(env.Room, code);
    if (await room.create(body.token, body.name.trim())) return json({ code });
  }
  return json({ error: 'No se pudo crear la sala' }, 500);
}

/** Salas en espera, para la lista de "salas abiertas". Sin base de datos, lista vacía. */
async function listRooms(env: Env) {
  const url: string = env.DB_URL;
  if (!url) return json({ rooms: [] });
  try {
    // Red de seguridad: si una fila se quedó huérfana, deja de listarse a las 6 h sin cambios.
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const res = await fetch(
      `${url}/trazo_rooms?status=eq.waiting&updated_at=gte.${since}&select=code,host_name,player_count&order=created_at.desc&limit=50`,
      { headers: dbHeaders(env.DB_KEY), signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const rows = (await res.json()) as { code: string; host_name: string; player_count: number }[];
    return json({ rooms: rows.map((r) => ({ code: r.code, hostName: r.host_name, playerCount: r.player_count })) });
  } catch (e) {
    console.warn(`db list rooms: ${e}`);
    return json({ rooms: [] });
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/rooms') {
      if (request.method === 'POST') return createRoom(request, env);
      if (request.method === 'GET') return listRooms(env);
      return json({ error: 'Método no permitido' }, 405);
    }
    // /parties/room/<código>: solo códigos con formato válido llegan a crear un Durable Object.
    const check = (_req: Request, lobby: { name: string }) =>
      CODE.test(lobby.name) ? undefined : new Response('Not found', { status: 404 });
    const response = await routePartykitRequest(request, env, { onBeforeConnect: check, onBeforeRequest: check });
    return response ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
