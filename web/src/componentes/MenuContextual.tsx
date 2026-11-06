import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** El menú del clic derecho. "-" es una raya separadora. */
export type ItemMenu = "-" | { texto: string; icono?: LucideIcon; accion: () => void };

let abrirGlobal: ((x: number, y: number, items: ItemMenu[]) => void) | null = null;

/** Abre el menú donde está el puntero (para `onContextMenu`). */
export function abrirMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: ItemMenu[]) {
  if (!abrirGlobal) return;
  e.preventDefault();
  abrirGlobal(e.clientX, e.clientY, items);
}

/** Va una sola vez en la app (en el marco). */
export function MenuContextualRaiz() {
  const [m, setM] = useState<{ x: number; y: number; items: ItemMenu[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    abrirGlobal = (x, y, items) => { setPos(null); setM({ x, y, items }); };
    return () => { abrirGlobal = null; };
  }, []);
  useEffect(() => {
    if (!m) return;
    const cerrar = () => setM(null);
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) cerrar(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    document.addEventListener("mousedown", fuera, true);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", cerrar);
    window.addEventListener("blur", cerrar);
    document.addEventListener("scroll", cerrar, true);
    return () => {
      document.removeEventListener("mousedown", fuera, true); document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", cerrar); window.removeEventListener("blur", cerrar); document.removeEventListener("scroll", cerrar, true);
    };
  }, [m]);
  // Que no se salga de la pantalla: si no cabe a la derecha o abajo, se abre hacia el otro lado.
  useLayoutEffect(() => {
    if (!m || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: m.x + r.width > innerWidth - 8 ? Math.max(8, m.x - r.width) : m.x, y: m.y + r.height > innerHeight - 8 ? Math.max(8, innerHeight - r.height - 8) : m.y });
  }, [m]);
  if (!m) return null;
  return createPortal(
    <div ref={ref} className="menu menu-ctx" role="menu" style={{ left: (pos ?? m).x, top: (pos ?? m).y, visibility: pos ? "visible" : "hidden" }} onContextMenu={(e) => e.preventDefault()}>
      {m.items.map((it, i) => it === "-"
        ? <hr key={`s${i}`} />
        : (
          <button key={it.texto} type="button" role="menuitem" className="menu-item" onClick={() => { setM(null); it.accion(); }}>
            {it.icono && <it.icono size={15} />}{it.texto}
          </button>
        ))}
    </div>,
    document.body,
  );
}
