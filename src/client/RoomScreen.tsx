// Todo lo que pasa dentro de una sala. Se carga aparte de la portada (ver App.tsx).
import { useEffect } from 'react';
import Game from './Game';
import Lobby from './Lobby';
import type { Session } from './session';
import { Loading, Toast } from './ui';
import { useRoom } from './useRoom';

const REQUEST_TIMEOUT = 60_000; // lo que se espera al anfitrión antes de desistir

interface Props {
  session: Session;
  onExit: (msg: string, wasInside: boolean) => void;
}

export default function RoomScreen({ session, onExit }: Props) {
  const room = useRoom(session, onExit);
  const { view, pending } = room;

  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => onExit('El anfitrión no ha respondido. Inténtalo de nuevo.', false), REQUEST_TIMEOUT);
    return () => clearTimeout(id);
  }, [pending, onExit]);

  // La pantalla no se apaga mientras esperas tu turno (donde el navegador lo permita).
  useEffect(() => {
    if (!view || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | undefined;
    const acquire = () => {
      if (!document.hidden) navigator.wakeLock.request('screen').then((l) => (lock = l), () => {});
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      lock?.release();
    };
  }, [!!view]);

  if (pending) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-center">
        <Loading text="Esperando a que el anfitrión te acepte…" />
        <button className="btn btn-ghost" onClick={() => onExit('', false)}>
          Cancelar
        </button>
      </main>
    );
  }
  if (!view) return <Loading text="Conectando con la sala…" />;

  const leave = () => {
    room.send({ t: 'leave' });
    onExit('', true);
  };

  return (
    <>
      {!room.online && (
        <p className="bg-ink text-paper fixed inset-x-0 top-0 z-50 p-2 text-center text-sm font-semibold" role="status">
          Sin conexión. Reconectando…
        </p>
      )}
      {view.phase === 'lobby' ? <Lobby room={room} view={view} onLeave={leave} /> : <Game room={room} view={view} />}
      <Toast text={room.toast} />
    </>
  );
}
