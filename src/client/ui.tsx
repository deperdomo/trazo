// Piezas pequeñas de interfaz compartidas entre pantallas.
import { LoaderCircle } from 'lucide-react';

export function Loading({ text }: { text: string }) {
  return (
    <div className="text-muted flex min-h-40 items-center justify-center gap-2 p-6" role="status">
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      {text}
    </div>
  );
}

export function Toast({ text }: { text: string }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4" role="status" aria-live="polite">
      {text && <p className="bg-ink text-paper rounded-lg px-4 py-3 text-sm font-semibold shadow-lg">{text}</p>}
    </div>
  );
}
