// Pantalla de partida: cabecera con la ronda y tu carta, jugadores, pizarra y el panel de la fase actual.
import { useEffect, useState } from 'react';
import { Eye, WifiOff } from 'lucide-react';
import { COLOR_NAMES, COLORS, type View } from '../shared/game';
import Board from './Board';
import { Guess, Result } from './Outcome';
import { Drawing, Setup, Voting } from './Phases';
import { pts } from './ui';
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

/** Pulsar un nombre resalta sus trazos en la pizarra (los demás se atenúan); pulsarlo otra vez lo quita. */
function PlayerStrip(props: { view: View; drawerId: string | null; focus: string | null; onFocus: (id: string | null) => void }) {
  const { view, drawerId, focus, onFocus } = props;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Jugadores y puntos. Pulsa un nombre para resaltar sus trazos">
      {view.players.map((p) => (
        <li key={p.id}>
          <button
            aria-pressed={p.id === focus}
            onClick={() => onFocus(p.id === focus ? null : p.id)}
            className={`flex min-h-8 items-center gap-1.5 rounded-lg border px-2 py-0.5 text-sm ${
              p.id === drawerId ? 'border-ink bg-ink text-paper font-bold' : 'border-line bg-paper'
            } ${p.id === focus ? 'ring-accent ring-2 ring-offset-1' : ''}`}
          >
            <span className="max-w-24 truncate">{p.name}</span>
            {p.id === view.qmId && <span className="bg-desk text-ink rounded px-1 text-xs font-bold">QM</span>}
            {!p.connected && <WifiOff className="size-3.5" aria-label="desconectado" />}
            <span className="text-muted tabular-nums">
              {pts(p.score)}
              <span className="sr-only"> puntos{p.id === drawerId ? ', dibujando' : ''}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Rotulador del trazo: se elige en cada turno y se puede cambiar hasta enviarlo. */
function Palette({ value, onChange }: { value: number; onChange: (c: number) => void }) {
  return (
    <div className="mb-2 grid grid-cols-10 gap-1.5" role="radiogroup" aria-label="Color del trazo">
      {COLORS.map((hex, i) => (
        <button
          key={hex}
          role="radio"
          aria-checked={value === i}
          aria-label={COLOR_NAMES[i]}
          onClick={() => onChange(i)}
          className={`aspect-square rounded-full ${value === i ? 'ring-ink ring-offset-paper ring-2 ring-offset-2' : ''}`}
          style={{ background: hex }}
        />
      ))}
    </div>
  );
}

export default function Game({ room, view }: { room: RoomConn; view: View }) {
  const { send } = room;
  const [color, setColor] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const drawerId = view.phase === 'drawing' ? view.order[view.turn % view.order.length] : null;
  const myTurn = drawerId === view.you;

  useEffect(() => {
    if (myTurn) navigator.vibrate?.(200);
  }, [myTurn]);

  const abort = () => {
    if (confirm('¿Cancelar la ronda y volver a la sala de espera? Los puntos se conservan.')) send({ t: 'abort' });
  };

  const phase = { view, send };
  // Sin pizarra (el QM eligiendo palabra) el panel es una tarjeta más y la página hace scroll normal.
  const hasBoard = view.phase !== 'setup';
  return (
    <main
      className={`mx-auto flex max-w-xl flex-col gap-2 px-2 pt-2 ${hasBoard ? 'h-dvh' : 'min-h-dvh pb-[max(0.5rem,env(safe-area-inset-bottom))]'}`}
    >
      <header className="flex items-start justify-between gap-2 px-1">
        <h1 className="min-w-0 truncate text-xl font-black">{view.phase === 'setup' ? 'Preparando la ronda' : `Ronda ${view.round}`}</h1>
        {view.card && <CardPeek view={view} />}
      </header>

      <PlayerStrip view={view} drawerId={drawerId} focus={hasBoard ? focus : null} onFocus={setFocus} />

      {hasBoard && (
        <div className="board-slot flex min-h-0 flex-1 items-start justify-center">
          <Board model={room.board} color={color} focus={focus} onUnfocus={() => setFocus(null)} me={view.you} canDraw={myTurn} send={send} />
        </div>
      )}

      {/* Con pizarra: hoja inferior pegada al borde, al alcance del pulgar. */}
      <section
        className={
          hasBoard
            ? 'card -mx-2 mt-auto max-h-[50dvh] shrink-0 overflow-y-auto rounded-b-none border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))]'
            : 'card'
        }
        aria-live="polite"
      >
        {myTurn && <Palette value={color} onChange={setColor} />}
        {view.phase === 'setup' && <Setup {...phase} />}
        {view.phase === 'drawing' && <Drawing {...phase} />}
        {view.phase === 'voting' && <Voting {...phase} />}
        {view.phase === 'guess' && <Guess {...phase} />}
        {view.phase === 'result' && <Result {...phase} />}
        {view.you === view.hostId && view.phase !== 'result' && (
          <button className="text-muted mt-2 min-h-11 w-full text-sm underline" onClick={abort}>
            Cancelar la ronda
          </button>
        )}
      </section>
    </main>
  );
}
