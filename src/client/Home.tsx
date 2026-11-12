// Portada: crear sala, unirse con código o pedir entrar en una sala abierta.
// El título y el "cómo se juega" son HTML estático en index.html.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, Users } from 'lucide-react';
import { isValidName, MAX_PLAYERS, NAME_MAX } from '../shared/game';
import { store, token, type Session } from './session';

interface OpenRoom {
  code: string;
  hostName: string;
  playerCount: number;
}

interface Props {
  notice: string;
  initialCode: string;
  onEnter: (session: Session) => void;
}

export default function Home({ notice, initialCode, onEnter }: Props) {
  const [name, setName] = useState(() => store.get('name'));
  const [code, setCode] = useState(initialCode);
  const [nameError, setNameError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<OpenRoom[] | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // Salas abiertas: refresco cada 5 s mientras la pestaña está visible.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/rooms');
        if (res.ok && alive) setRooms(((await res.json()) as { rooms: OpenRoom[] }).rooms);
      } catch {
        // se reintenta en el siguiente ciclo
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  /** Nombre validado y recordado, o null (con el error a la vista y el foco en el campo). */
  const validName = (): string | null => {
    if (isValidName(name)) {
      store.set('name', name.trim());
      return name.trim();
    }
    setNameError(`Escribe un nombre de 2 a ${NAME_MAX} caracteres`);
    nameInput.current?.focus();
    return null;
  };

  const create = async () => {
    const player = validName();
    if (!player || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token(), name: player }),
      });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !data.code) throw new Error(data.error);
      onEnter({ code: data.code, name: player, mode: 'join' });
    } catch (e) {
      setError((e instanceof Error && e.message) || 'No se pudo crear la sala. Inténtalo de nuevo.');
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const player = validName();
    if (!player) return;
    if (!/^[A-Z0-9]{6}$/.test(code)) return setCodeError('El código tiene 6 letras o números');
    onEnter({ code, name: player, mode: 'join' });
  };

  const request = (room: OpenRoom) => {
    const player = validName();
    if (player) onEnter({ code: room.code, name: player, mode: 'request' });
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
      {(notice || error) && (
        <p className="border-accent bg-paper rounded-lg border-2 p-3 font-semibold" role="alert">
          {notice || error}
        </p>
      )}
      {initialCode && !notice && (
        <p className="card" role="status">
          Te han invitado a la sala <strong className="font-mono tracking-wider">{initialCode}</strong>. Escribe tu nombre y entra.
        </p>
      )}

      <div className="card">
        <label className="label" htmlFor="name">
          Tu nombre
        </label>
        <input
          id="name"
          ref={nameInput}
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameError('');
          }}
          maxLength={NAME_MAX}
          autoComplete="nickname"
          autoFocus={!!initialCode}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'name-error' : undefined}
        />
        {nameError && (
          <p id="name-error" className="text-accent mt-1 text-sm font-semibold" role="alert">
            {nameError}
          </p>
        )}
        <button className="btn btn-accent mt-4 w-full" onClick={create} disabled={busy}>
          {busy ? 'Creando sala…' : 'Crear sala'}
        </button>
      </div>

      <form className="card" onSubmit={join} noValidate>
        <label className="label" htmlFor="code">
          ¿Tienes un código de sala?
        </label>
        <div className="flex gap-2">
          <input
            id="code"
            className="input font-mono text-xl tracking-[0.3em] uppercase"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
              setCodeError('');
            }}
            placeholder="ABC123"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={!!codeError}
            aria-describedby={codeError ? 'code-error' : undefined}
          />
          <button className="btn btn-primary shrink-0">Unirse</button>
        </div>
        {codeError && (
          <p id="code-error" className="text-accent mt-1 text-sm font-semibold" role="alert">
            {codeError}
          </p>
        )}
      </form>

      <section className="card" aria-labelledby="open-rooms">
        <h2 id="open-rooms" className="label">
          Salas abiertas
        </h2>
        {!rooms?.length ? (
          <p className="text-muted py-2 text-sm">{rooms ? 'No hay salas abiertas ahora mismo.' : 'Buscando salas…'}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rooms.map((room) => (
              <li key={room.code}>
                <button
                  className="btn btn-ghost w-full justify-between text-left"
                  onClick={() => request(room)}
                  disabled={room.playerCount >= MAX_PLAYERS}
                >
                  <span className="min-w-0 truncate">Sala de {room.hostName}</span>
                  <span className="text-muted flex shrink-0 items-center gap-1 text-sm font-normal">
                    <Users className="size-4" aria-hidden="true" />
                    {room.playerCount}/{MAX_PLAYERS}
                    <span className="sr-only"> jugadores. Pedir entrar</span>
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
