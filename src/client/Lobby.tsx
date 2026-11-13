// Sala de espera: código para compartir, jugadores, rotulador y solicitudes de entrada.
import { useState } from 'react';
import { Check, Crown, Share2, WifiOff, X } from 'lucide-react';
import { COLOR_NAMES, COLORS, MAX_PLAYERS, type View } from '../shared/game';
import { Dot } from './ui';
import type { RoomConn } from './useRoom';

interface Props {
  room: RoomConn;
  view: View;
  onLeave: () => void;
}

export default function Lobby({ room, view, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const me = view.players.find((p) => p.id === view.you)!;
  const host = view.players.find((p) => p.id === view.hostId);
  const isHost = view.you === view.hostId;
  const takenColors = new Set(view.players.filter((p) => p.id !== view.you).map((p) => p.color));
  const missing = view.minPlayers - view.players.length;
  const hasScores = view.players.some((p) => p.score > 0);

  const share = async () => {
    const url = `${location.origin}/?sala=${view.code}`;
    try {
      if (navigator.share) return await navigator.share({ title: 'Trazo', text: 'Únete a mi sala de Trazo', url });
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // compartir cancelado, o sin permiso de portapapeles: el código sigue a la vista
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 p-4">
      <header className="card text-center">
        <h1 className="text-muted text-sm font-semibold">Sala de espera · código</h1>
        <p className="mt-1 text-5xl font-extrabold tracking-[0.15em] tabular-nums">{view.code}</p>
        <button className="btn btn-ghost mt-3 w-full" onClick={share}>
          {copied ? <Check className="size-5" aria-hidden="true" /> : <Share2 className="size-5" aria-hidden="true" />}
          {copied ? 'Enlace copiado' : 'Invitar con un enlace'}
        </button>
      </header>

      {isHost &&
        room.requests.map((req) => (
          <div key={req.id} className="card border-accent flex items-center gap-2 border-2" role="alert">
            <p className="min-w-0 flex-1">
              <strong className="break-words">{req.name}</strong> quiere entrar
            </p>
            <button className="btn btn-primary" onClick={() => room.answer(req.id, true)}>
              Aceptar
            </button>
            <button className="btn btn-ghost" onClick={() => room.answer(req.id, false)} aria-label={`Rechazar a ${req.name}`}>
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        ))}

      <section className="card" aria-labelledby="players-title">
        <h2 id="players-title" className="label">
          Jugadores ({view.players.length}/{MAX_PLAYERS})
        </h2>
        <ul className="divide-soft divide-y">
          {view.players.map((p) => (
            <li key={p.id} className="flex min-h-12 items-center gap-3">
              <Dot color={p.color} className="size-5" />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {p.name}
                {p.id === view.you && <span className="text-muted font-normal"> (tú)</span>}
              </span>
              {hasScores && <span className="text-muted text-sm tabular-nums">{p.score} pts</span>}
              {!p.connected && <WifiOff className="text-muted size-4" aria-label="Desconectado" />}
              {p.id === view.hostId && <Crown className="text-accent size-5" aria-label="Anfitrión" />}
              {isHost && p.id !== view.you && (
                <button
                  className="text-muted hover:bg-chip hover:text-ink grid size-11 place-items-center rounded-lg"
                  onClick={() => room.send({ t: 'kick', id: p.id })}
                  aria-label={`Sacar a ${p.name} de la sala`}
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="color-title">
        <h2 id="color-title" className="label">
          Tu rotulador: {COLOR_NAMES[me.color]}
        </h2>
        <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-labelledby="color-title">
          {COLORS.map((hex, i) => (
            <button
              key={hex}
              role="radio"
              aria-checked={me.color === i}
              aria-label={COLOR_NAMES[i] + (takenColors.has(i) ? ' (cogido)' : '')}
              disabled={takenColors.has(i)}
              onClick={() => room.send({ t: 'color', c: i })}
              className={`grid aspect-square min-h-11 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-40 ${
                me.color === i ? 'ring-ink ring-offset-paper ring-4 ring-offset-2' : ''
              }`}
              style={{ background: hex }}
            >
              {me.color === i && (
                <span className="bg-paper text-ink grid size-7 place-items-center rounded-full">
                  <Check className="size-5" aria-hidden="true" />
                </span>
              )}
              {/* Cogido: con la X no se confunde con un tono pastel libre */}
              {takenColors.has(i) && <X className="text-ink size-6" strokeWidth={3} aria-hidden="true" />}
            </button>
          ))}
        </div>
      </section>

      <footer className="mt-auto flex flex-col gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {isHost ? (
          <>
            <button className="btn btn-accent w-full" onClick={() => room.send({ t: 'start' })} disabled={missing > 0}>
              Empezar partida
            </button>
            {missing > 0 && (
              <p className="text-muted text-center text-sm" role="status">
                {missing === 1 ? 'Falta 1 jugador' : `Faltan ${missing} jugadores`} para empezar (mínimo {view.minPlayers}).
              </p>
            )}
          </>
        ) : (
          <p className="text-muted text-center" role="status">
            Esperando a que {host?.name ?? 'el anfitrión'} empiece la partida…
          </p>
        )}
        <button className="btn btn-ghost w-full" onClick={onLeave}>
          {isHost ? 'Cerrar la sala' : 'Salir de la sala'}
        </button>
      </footer>
    </main>
  );
}
