// Identidad del navegador y URL de la sala.

export interface Session {
  code: string;
  name: string;
  /** join: entrada directa por código o enlace. request: desde la lista de salas, pide permiso al anfitrión. */
  mode: 'join' | 'request';
}

const params = () => new URLSearchParams(location.search);

// ?dev=2 da otra identidad en el mismo navegador: sirve para probar con varias pestañas.
const dev = params().get('dev') ?? '';
const key = (k: string) => `trazo-${k}${dev}`;

export const store = {
  get(k: string): string {
    try {
      return localStorage.getItem(key(k)) ?? '';
    } catch {
      return ''; // almacenamiento bloqueado (modo privado estricto)
    }
  },
  set(k: string, value: string) {
    try {
      localStorage.setItem(key(k), value);
    } catch {
      // sin almacenamiento se pierde el asiento al recargar, pero se puede jugar
    }
  },
};

let memoryToken = '';
/** Secreto que identifica a este navegador ante la sala (recupera el asiento al reconectar). */
export function token(): string {
  let t = store.get('token') || memoryToken;
  if (!t) {
    // getRandomValues y no randomUUID: también funciona por http en la red local.
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    memoryToken = t;
    store.set('token', t);
  }
  return t;
}

export const codeFromUrl = () => {
  const code = (params().get('sala') ?? '').toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
};

export const roomPath = (code = '') => {
  const q = new URLSearchParams();
  if (code) q.set('sala', code);
  if (dev) q.set('dev', dev);
  const s = q.toString();
  return s ? `/?${s}` : '/';
};
