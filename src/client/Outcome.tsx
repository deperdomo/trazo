// Paneles del desenlace: recuento, última oportunidad del falso artista y resultado de la ronda.
import { useState, type FormEvent } from 'react';
import { Trophy } from 'lucide-react';
import { TEXT_MAX, WIN_SCORE, type View } from '../shared/game';
import type { PhaseProps } from './Game';
import { Who } from './Phases';

function Tally({ view }: { view: View }) {
  const votes = Object.values(view.votes ?? {});
  const counts = view.order
    .map((id) => ({ id, n: votes.filter((target) => target === id).length }))
    .filter((c) => c.n)
    .sort((a, b) => b.n - a.n);
  return (
    <div>
      <h2 className="label">Votos</h2>
      {counts.length ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {counts.map((c) => (
            <li key={c.id}>
              <Who view={view} id={c.id} /> <span className="tabular-nums">× {c.n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">Nadie ha votado.</p>
      )}
    </div>
  );
}

/** Lo han pillado: un intento de decir la palabra. Si no coincide tal cual, decide el QM. */
export function Guess({ view, send }: PhaseProps) {
  const [text, setText] = useState('');
  const fakeId = view.fakeId!;
  const isBoss = view.you === view.qmId || view.you === view.hostId;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({ t: 'guess', text });
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-xl font-black">
        ¡Pillado! <Who view={view} id={fakeId} /> era el falso artista.
      </p>
      <Tally view={view} />
      {view.guess === null ? (
        view.you === fakeId ? (
          <form className="flex flex-col gap-2" onSubmit={submit}>
            <label className="label" htmlFor="guess">
              Última oportunidad: ¿cuál era la palabra? Solo tienes un intento.
            </label>
            <input id="guess" className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={TEXT_MAX} required autoComplete="off" autoFocus />
            <button className="btn btn-accent">Responder</button>
          </form>
        ) : (
          <p className="text-muted" role="status">
            Aún puede ganar la ronda: tiene un intento para adivinar la palabra…
          </p>
        )
      ) : (
        <>
          <p className="text-lg">
            Ha dicho <strong>«{view.guess}»</strong> y la palabra era <strong>«{view.word}»</strong>.
          </p>
          {isBoss ? (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary" onClick={() => send({ t: 'judge', ok: true })}>
                Vale, ha acertado
              </button>
              <button className="btn btn-ghost" onClick={() => send({ t: 'judge', ok: false })}>
                No vale
              </button>
            </div>
          ) : (
            <p className="text-muted" role="status">
              <Who view={view} id={view.qmId} /> decide si lo da por bueno.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function Result({ view, send }: PhaseProps) {
  const fakeId = view.fakeId!;
  const isBoss = view.you === view.qmId || view.you === view.hostId;
  const ranking = [...view.players].sort((a, b) => b.score - a.score);
  const gameOver = view.winners.length > 0;
  const headline = !view.caught
    ? 'El falso artista se ha escapado'
    : view.guessed
      ? 'Lo pillasteis… pero adivinó la palabra'
      : '¡Pillado! Ganan los artistas';
  return (
    <div className="flex flex-col gap-3">
      <p className="font-display text-xl font-black">{headline}</p>
      <p>
        El falso artista era <Who view={view} id={fakeId} /> y la palabra, <strong>«{view.word}»</strong>.
        {view.guess && !view.guessed && <> Dijo «{view.guess}».</>}
      </p>
      <Tally view={view} />
      <div>
        <h2 className="label">Puntos (gana quien llegue a {WIN_SCORE})</h2>
        <ol className="flex flex-col gap-1">
          {ranking.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <Who view={view} id={p.id} />
              <span className="tabular-nums">
                {view.deltas[p.id] ? <span className="text-ok mr-2 font-bold">+{view.deltas[p.id]}</span> : null}
                <strong>{p.score}</strong>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {gameOver && (
        <p className="font-display flex items-center gap-2 text-xl font-black">
          <Trophy className="text-accent size-6 shrink-0" aria-hidden="true" />
          {view.winners.length > 1 ? 'Ganan ' : 'Gana '}
          {view.winners.map((id) => view.players.find((p) => p.id === id)?.name).join(' y ')}
        </p>
      )}
      {isBoss ? (
        <button className="btn btn-accent" onClick={() => send({ t: 'next' })}>
          {gameOver ? 'Nueva partida' : 'Siguiente ronda'}
        </button>
      ) : (
        <p className="text-muted" role="status">
          Esperando a que <Who view={view} id={view.qmId} /> {gameOver ? 'empiece otra partida' : 'pase a la siguiente ronda'}…
        </p>
      )}
    </div>
  );
}
