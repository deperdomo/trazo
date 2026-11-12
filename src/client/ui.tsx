// Piezas pequeñas de interfaz compartidas entre pantallas.
import { LoaderCircle } from 'lucide-react';
import { COLORS } from '../shared/game';

export function Loading({ text }: { text: string }) {
  return (
    <div className="text-muted flex min-h-40 items-center justify-center gap-2 p-6" role="status">
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}

/** Punto con el color del rotulador de un jugador. Siempre acompaña al nombre: el color nunca es el único dato. */
export function Dot({ color, className = 'size-3.5' }: { color: number; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${className}`} style={{ background: COLORS[color] }} aria-hidden="true" />;
}

export function Toast({ text }: { text: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" role="status" aria-live="polite">
      {text && <p className="bg-ink text-paper rounded-lg px-4 py-3 text-sm font-semibold shadow-lg">{text}</p>}
    </div>
  );
}
