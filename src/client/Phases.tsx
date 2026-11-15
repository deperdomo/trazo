// Paneles de las fases de juego: elegir palabra, dibujar y votar.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LAPS, TEXT_MAX, type View } from '../shared/game';
import type { PhaseProps } from './Game';

export function Who({ view, id }: { view: View; id: string }) {
  const p = view.players.find((x) => x.id === id);
  return (
    <span className="font-bold">{p?.name ?? '?'}</span>
  );
}

/** El QM elige categoría, palabra y quién empieza. El resto espera. */
export function Setup({ view, send }: PhaseProps) {
  const artists = view.players.filter((p) => p.id !== view.qmId);
  const [category, setCategory] = useState('');
  const [word, setWord] = useState('');
  const [first, setFirst] = useState(artists[0]?.id ?? '');

  if (view.you !== view.qmId) {
    return (
      <p>
        Esta ronda <Who view={view} id={view.qmId} /> es el QM: elige la categoría y la palabra, y no dibuja. En cuanto
        termine, recibirás tu carta.
      </p>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({ t: 'setup', category, word, first });
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <p className="font-bold">Eres el QM de esta ronda. Tú no dibujas: eliges qué se dibuja.</p>
      <div>
        <label className="label" htmlFor="category">
          Categoría (la verán todos)
        </label>
        <input id="category" className="input" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={TEXT_MAX} placeholder="Animales" required autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="word">
          Palabra secreta (todos menos el falso artista)
        </label>
        <input id="word" className="input" value={word} onChange={(e) => setWord(e.target.value)} maxLength={TEXT_MAX} placeholder="Jirafa" required autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="first">
          ¿Quién hace el primer trazo?
        </label>
        <select id="first" className="input" value={first} onChange={(e) => setFirst(e.target.value)}>
          {artists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-accent">Repartir cartas y empezar</button>
    </form>
  );
}

export function Drawing({ view, send }: PhaseProps) {
  const drawerId = view.order[view.turn % view.order.length];
  const drawer = view.players.find((p) => p.id === drawerId);
  const lap = Math.floor(view.turn / view.order.length) + 1;
  return (
    <div className="flex flex-col gap-2">
      {drawerId === view.you ? (
        <p className="text-xl font-black">¡Te toca! Haz un solo trazo, sin levantar el dedo, y envíalo con ✓.</p>
      ) : (
        <p className="text-lg">
          Dibuja <Who view={view} id={drawerId} />
          {view.you === view.qmId && <span className="text-muted"> · tú observas</span>}
        </p>
      )}
      <p className="text-muted text-sm">
        Vuelta {lap} de {LAPS} · trazo {view.turn + 1} de {view.order.length * LAPS}
      </p>
      {view.you === view.hostId && drawer && !drawer.connected && (
        <button className="btn btn-ghost" onClick={() => send({ t: 'skip' })}>
          {drawer.name} se ha desconectado: saltar su turno
        </button>
      )}
    </div>
  );
}

/** 3, 2, 1 al abrirse la votación. Si ya estaba abierta al entrar (reconexión), sin cuenta atrás. */
function useCountdown(open: boolean) {
  const wasOpen = useRef(open);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (open && !wasOpen.current) setCount(3);
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!count) return;
    const id = setTimeout(() => setCount((c) => c - 1), 800);
    return () => clearTimeout(id);
  }, [count]);
  return count;
}

export function Voting({ view, send }: PhaseProps) {
  const count = useCountdown(view.voteOpen);
  const isBoss = view.you === view.qmId || view.you === view.hostId;
  const isArtist = view.order.includes(view.you);
  const hasVoted = view.voted.includes(view.you);
  const left = view.order.length - view.voted.length;

  if (!view.voteOpen) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-lg font-bold">Dibujo terminado. ¿Quién no sabía qué se dibujaba?</p>
        {isBoss ? (
          <button className="btn btn-accent" onClick={() => send({ t: 'openVote' })}>
            3, 2, 1… ¡ya! Abrir la votación
          </button>
        ) : (
          <p className="text-muted">
            Pensadlo bien: <Who view={view} id={view.qmId} /> dará la cuenta atrás y votaréis todos a la vez.
          </p>
        )}
      </div>
    );
  }
  if (count) {
    return <p className="py-4 text-center text-7xl font-black tabular-nums">{count}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {isArtist && !hasVoted ? (
        <>
          <p className="text-lg font-bold">¡Ya! Señala al falso artista:</p>
          <div className="grid grid-cols-2 gap-2">
            {view.order
              .filter((id) => id !== view.you)
              .map((id) => (
                <button key={id} className="btn btn-ghost justify-start" onClick={() => send({ t: 'vote', id })}>
                  <Who view={view} id={id} />
                </button>
              ))}
          </div>
        </>
      ) : (
        <p className="text-lg" role="status">
          {hasVoted ? 'Voto enviado. ' : ''}
          {left === 1 ? 'Falta 1 voto.' : `Faltan ${left} votos.`}
        </p>
      )}
      {isBoss && (!isArtist || hasVoted) && (
        <button className="btn btn-ghost" onClick={() => send({ t: 'closeVote' })}>
          Cerrar la votación sin esperar al resto
        </button>
      )}
    </div>
  );
}
