import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import Home from './client/Home';
import { codeFromUrl, roomPath, store, type Session } from './client/session';
import { Loading } from './client/ui';

// La sala (pizarra, WebSocket, pantallas de juego) se descarga solo al entrar: la portada carga lo mínimo.
const RoomScreen = lazy(() => import('./client/RoomScreen'));

/** Si algo revienta al pintar, un mensaje y un botón en vez de una pantalla en blanco. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto max-w-md p-6 text-center" role="alert">
        <h1 className="text-xl font-bold">Algo ha fallado</h1>
        <p className="text-muted mt-2">Recarga la página: si estabas en una partida, volverás a tu sitio.</p>
        <button className="btn btn-primary mt-4" onClick={() => location.reload()}>
          Recargar
        </button>
      </main>
    );
  }
}

export default function App() {
  // Enlace con ?sala=CÓDIGO y nombre ya conocido: entra directo (o recupera su asiento tras recargar).
  const [session, setSession] = useState<Session | null>(() => {
    const code = codeFromUrl();
    const name = store.get('name');
    return code && name ? { code, name, mode: 'join' } : null;
  });
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState(codeFromUrl);

  useEffect(() => {
    document.body.classList.toggle('in-room', !!session);
    document.title = session ? `Sala ${session.code} · Trazo` : 'Trazo: juego de dibujo online con impostor para 5 a 10 amigos';
  }, [session]);

  useEffect(() => {
    // Botón "atrás" del navegador: salir de la sala.
    const onPop = () => !codeFromUrl() && setSession(null);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  const enter = (next: Session) => {
    history.pushState(null, '', roomPath(next.code));
    setNotice('');
    setSession(next);
  };
  const exit = (msg: string, wasInside: boolean) => {
    history.replaceState(null, '', roomPath());
    setNotice(msg);
    // Si no llegó a entrar (nombre repetido, sala llena...), el código se queda escrito para reintentar.
    setCode(wasInside ? '' : (session?.code ?? ''));
    setSession(null);
  };

  return (
    <ErrorBoundary>
      {session ? (
        <Suspense fallback={<Loading text="Entrando en la sala…" />}>
          <RoomScreen key={session.code + session.mode} session={session} onExit={exit} />
        </Suspense>
      ) : (
        <Home notice={notice} initialCode={code} onEnter={enter} />
      )}
    </ErrorBoundary>
  );
}
