// Pantalla de partida: cabecera con la categoría y tu carta, jugadores, pizarra y el panel de la fase actual.
import { useEffect, useMemo, useState } from 'react';
import { Eye, WifiOff } from 'lucide-react';
import { COLORS, type View } from '../shared/game';
import Board from './Board';
import { Guess, Result } from './Outcome';
import { Drawing, Setup, Voting } from './Phases';
import { Dot } from './ui';
import type { RoomConn } from './useRoom';

export interface PhaseProps {
  view: View;
  send: (msg: object) => void;
}

/** Tu carta secreta: solo se ve mientras mantienes pulsado, para que no la lea el de al lado. */
function CardPeek({ view }: { view: View }) {
  const [shown, setShown] = useState(false);
  const fake = view.players.find((p) => p.id === view.fakeId);
  const text =
    view.you === view.qmId
      ? `Palabra: ${view.card}. Falso artista: ${fake?.name ?? '?'}.`
      : view.card === 'X'
        ? 'X · Eres el falso artista. Disimula.'
        : `La palabra es: ${view.card}`;
  const hide = () => setShown(false);
  return (
    <div className="relative shrink-0">
      <button
        className="btn btn-ghost min-h-11 touch-none px-3 text-sm"
        onPointerDown={() => setShown(true)}
        onPointerUp={hide}
        onPointerLeave={hide}
        onPointerCancel={hide}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setShown(true)}
        onKeyUp={hide}
        onBlur={hide}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Eye className="size-5" aria-hidden="true" />
        Mantén para ver tu carta
      </button>
      <p
        role="status"
        className={`bg-ink text-paper absolute top-full right-0 z-20 mt-1 w-64 rounded-lg p-3 text-lg font-bold shadow-lg ${shown ? '' : 'hidden'}`}
      >
        {shown && text}
      </p>
    </div>
  );
}

function PlayerStrip({ view, drawerId }: { view: View; drawerId: string | null }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Jugadores y puntos">
      {view.players.map((p) => (
        <li
          key={p.id}
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-sm ${
            p.id === drawerId ? 'border-ink bg-paper font-bold' : 'border-line'
          }`}
        >
          <Dot color={p.color} />
          <span className="max-w-24 truncate">{p.name}</span>
          {p.id === view.qmId && <span className="bg-ink text-paper rounded px-1 text-xs font-bold">QM</span>}
          {!p.connected && <WifiOff className="size-3.5" aria-label="desconectado" />}
          <span className="text-muted tabular-nums">
            {p.score}
            <span className="sr-only"> puntos{p.id === drawerId ? ', dibujando' : ''}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Game({ room, view }: { room: RoomConn; view: View }) {
  const { send } = room;
  const colorKey = view.players.map((p) => p.id + p.color).join();
  const colors = useMemo(
    () => Object.fromEntries(view.players.map((p) => [p.id, COLORS[p.color]])),
    [colorKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const drawerId = view.phase === 'drawing' ? view.order[view.turn % view.order.length] : null;
  const myTurn = drawerId === view.you;

  useEffect(() => {
    if (myTurn) navigator.vibrate?.(200);
  }, [myTurn]);

  const abort = () => {
    if (confirm('¿Cancelar la ronda y volver a la sala de espera? Los puntos se conservan.')) send({ t: 'abort' });
  };

  const phase = { view, send };
  return (
    <main className="mx-auto flex h-dvh max-w-xl flex-col gap-2 p-2">
      <header className="flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="text-muted text-xs font-semibold tracking-wide uppercase">
            Ronda {view.round}
            {view.category && ' · categoría'}
          </p>
          <h1 className="truncate text-xl font-black">{view.category || 'Preparando la ronda'}</h1>
        </div>
        {view.card && <CardPeek view={view} />}
      </header>

      <PlayerStrip view={view} drawerId={drawerId} />

      {view.phase !== 'setup' && (
        <div className="board-slot flex min-h-0 flex-1 items-start justify-center">
          <Board model={room.board} colors={colors} me={view.you} canDraw={myTurn} send={send} />
        </div>
      )}

      <section className="card max-h-[50dvh] shrink-0 overflow-y-auto" aria-live="polite">
        {view.phase === 'setup' && <Setup {...phase} />}
        {view.phase === 'drawing' && <Drawing {...phase} />}
        {view.phase === 'voting' && <Voting {...phase} />}
        {view.phase === 'guess' && <Guess {...phase} />}
        {view.phase === 'result' && <Result {...phase} />}
      </section>

      {view.you === view.hostId && view.phase !== 'result' && (
        <button className="text-muted min-h-11 self-center px-3 text-sm underline" onClick={abort}>
          Cancelar la ronda
        </button>
      )}
    </main>
  );
}
