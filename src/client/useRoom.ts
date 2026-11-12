// Conexión con la sala: un WebSocket que reconecta solo (partysocket) y el estado que envía el servidor.
import { useCallback, useEffect, useRef, useState } from 'react';
import PartySocket from 'partysocket';
import type { ServerMsg, View } from '../shared/game';
import { BoardModel } from './Board';
import { token, type Session } from './session';

export interface JoinRequest {
  id: string;
  name: string;
}

export interface RoomConn {
  view: View | null;
  pending: boolean; // esperando a que el anfitrión acepte la solicitud
  online: boolean;
  requests: JoinRequest[];
  toast: string;
  board: BoardModel;
  send: (msg: object) => void;
  answer: (id: string, ok: boolean) => void;
}

export function useRoom(session: Session, onExit: (msg: string, wasInside: boolean) => void): RoomConn {
  const [view, setView] = useState<View | null>(null);
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(false);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [toast, setToast] = useState('');
  const [board] = useState(() => new BoardModel());
  const socketRef = useRef<PartySocket | null>(null);
  const exit = useRef(onExit);
  exit.current = onExit;

  useEffect(() => {
    let inside = false;
    const socket = new PartySocket({
      host: location.host,
      party: 'room',
      room: session.code,
      query: { token: token(), name: session.name, mode: session.mode },
    });
    socketRef.current = socket;
    socket.addEventListener('open', () => {
      setOnline(true);
      setRequests([]); // el servidor reenvía las solicitudes pendientes al reconectar
    });
    socket.addEventListener('close', () => setOnline(false));
    socket.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string) as ServerMsg;
      switch (m.t) {
        case 'state':
          inside = true;
          setPending(false);
          setView(m.s);
          break;
        case 'strokes':
          board.reset(m.list);
          break;
        case 'stroke':
          board.commit(m.s);
          break;
        case 'pts':
          board.addLive(m.id, m.p);
          break;
        case 'cancel':
          board.clearLive();
          break;
        case 'pending':
          setPending(true);
          break;
        case 'request':
          setRequests((list) => [...list.filter((r) => r.id !== m.id), { id: m.id, name: m.name }]);
          navigator.vibrate?.(200);
          break;
        case 'requestGone':
          setRequests((list) => list.filter((r) => r.id !== m.id));
          break;
        case 'toast':
          setToast(m.msg);
          break;
        case 'closed':
          socket.close(); // no reconectar
          exit.current(m.msg, inside);
          break;
      }
    });
    return () => socket.close();
  }, [session.code, session.name, session.mode, board]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const send = useCallback((msg: object) => socketRef.current?.send(JSON.stringify(msg)), []);
  const answer = useCallback(
    (id: string, ok: boolean) => {
      setRequests((list) => list.filter((r) => r.id !== id));
      send({ t: 'answer', id, ok });
    },
    [send],
  );

  return { view, pending, online, requests, toast, board, send, answer };
}
