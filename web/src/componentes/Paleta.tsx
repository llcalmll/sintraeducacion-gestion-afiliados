import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { Afiliado } from "../datos/tipos";
import { contiene } from "../logica/texto";
import { Avatar, BadgeEstado } from "./ui";

/** Buscador global (Ctrl+K): afiliados por nombre o cédula y accesos a pantallas. */
export function Paleta({ onCerrar, afiliados, rutas }: { onCerrar: () => void; afiliados: Afiliado[]; rutas: { a: string; t: string }[] }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const items = useMemo(() => {
    const t = q.trim();
    const pant = rutas.filter((r) => !t || contiene(r.t, t)).map((r) => ({ tipo: "ruta" as const, a: r.a, t: r.t }));
    if (!t) return pant;
    const af = afiliados
      .filter((a) => contiene(a.nombre, t) || (a.cedula ?? "").includes(t))
      .slice(0, 8)
      .map((a) => ({ tipo: "af" as const, a: `/afiliados/${a.id}`, t: a.nombre, af: a }));
    return [...af, ...pant];
  }, [q, afiliados, rutas]);

  const ir = (n: number) => {
    const it = items[n];
    if (!it) return;
    nav(it.a);
    onCerrar();
  };

  return createPortal(
    <>
      <div className="velo" onClick={onCerrar} />
      <div className="modal ancha" role="dialog" aria-label="Buscar">
        <div style={{ position: "relative" }}>
          <Search size={18} style={{ position: "absolute", left: 16, top: 17, color: "var(--texto-3)" }} />
          <input
            className="paleta-input"
            autoFocus
            placeholder="Buscar afiliado por nombre o cédula, o ir a una pantalla"
            value={q}
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCerrar();
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
              if (e.key === "Enter") ir(i);
            }}
          />
        </div>
        <div className="paleta-lista">
          {items.length === 0 && <div className="muted" style={{ padding: 14 }}>Sin resultados.</div>}
          {items.map((it, n) => (
            <div key={it.a} className={`paleta-item ${n === i ? "on" : ""}`} onMouseEnter={() => setI(n)} onClick={() => ir(n)}>
              {it.tipo === "af" ? (
                <>
                  <Avatar nombre={it.t} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{it.t}</div>
                    <div className="peq tenue">C.C. {it.af.cedula ?? "sin cédula"} · {it.af.pagador.toLocaleUpperCase("es-CO")}</div>
                  </div>
                  <BadgeEstado estado={it.af.estado} />
                </>
              ) : (
                <>
                  <ArrowRight size={16} className="tenue" />
                  <span style={{ flex: 1 }}>Ir a {it.t}</span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}
