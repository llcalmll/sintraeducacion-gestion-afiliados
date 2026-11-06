import { Check, ChevronDown, Search, X } from "lucide-react";
import { useState } from "react";
import { contiene } from "../logica/texto";
import { Menu } from "./ui";

export interface Opcion { v: string; t: string; n?: number }

/** Con más opciones que esto, el menú trae su propio buscador (por ejemplo, instituciones). */
const CON_BUSCADOR = 12;

function QuitarFiltro({ etiqueta, onQuitar }: { etiqueta: string; onQuitar: () => void }) {
  return (
    <span className="quitar" onClick={(e) => { e.stopPropagation(); onQuitar(); }} role="button" aria-label={`Quitar filtro ${etiqueta}`}>
      <X size={13} />
    </span>
  );
}

/** Botón de filtro por dimensión, estilo chip. Azul cuando está activo, con X para quitarlo. */
export function FiltroChip({ etiqueta, valor, opciones, onCambio }: { etiqueta: string; valor: string; opciones: Opcion[]; onCambio: (v: string) => void }) {
  const actual = opciones.find((o) => o.v === valor);
  const [q, setQ] = useState("");
  const largas = opciones.length > CON_BUSCADOR;
  const visibles = largas && q ? opciones.filter((o) => contiene(o.t, q)) : opciones;
  return (
    <Menu
      ancho={largas ? 320 : 240}
      boton={(abrir) => (
        <button className={`filtro-chip ${valor ? "on" : ""}`} onClick={() => { setQ(""); abrir(); }}>
          {valor ? `${etiqueta}: ${actual?.t ?? valor}` : etiqueta}
          {valor ? <QuitarFiltro etiqueta={etiqueta} onQuitar={() => onCambio("")} /> : <ChevronDown size={14} />}
        </button>
      )}
    >
      {(cerrar) => (
        <>
          <div className="titulo">{etiqueta}</div>
          {largas && (
            <div className="menu-buscar">
              <Search size={14} />
              <input className="input" autoFocus value={q} placeholder={`Buscar ${etiqueta.toLowerCase()}…`} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          <div className={largas ? "menu-lista" : undefined}>
            {visibles.map((o) => (
              <button key={o.v} className={`menu-item ${o.v === valor ? "on" : ""}`} onClick={() => { onCambio(o.v === valor ? "" : o.v); cerrar(); }}>
                <span style={{ width: 14 }}>{o.v === valor && <Check size={14} />}</span>
                {o.t}
                {o.n !== undefined && <span className="der">{o.n}</span>}
              </button>
            ))}
            {!visibles.length && <div className="menu-vacio">Sin resultados</div>}
          </div>
        </>
      )}
    </Menu>
  );
}

/** 2026-03-05 -> 05/03/2026 */
const fechaCorta = (f: string) => f.split("-").reverse().join("/");

/** Filtro por rango de fechas (desde / hasta, AAAA-MM-DD). Cualquiera de los dos puede quedar vacío. */
export function FiltroFechas({ etiqueta, desde, hasta, onCambio }: { etiqueta: string; desde: string; hasta: string; onCambio: (desde: string, hasta: string) => void }) {
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  const activo = !!(desde || hasta);
  const texto = desde && hasta ? `${fechaCorta(desde)} a ${fechaCorta(hasta)}` : desde ? `desde ${fechaCorta(desde)}` : hasta ? `hasta ${fechaCorta(hasta)}` : "";
  return (
    <Menu
      ancho={260}
      boton={(abrir) => (
        <button className={`filtro-chip ${activo ? "on" : ""}`} onClick={() => { setD(desde); setH(hasta); abrir(); }}>
          {activo ? `${etiqueta}: ${texto}` : etiqueta}
          {activo ? <QuitarFiltro etiqueta={etiqueta} onQuitar={() => onCambio("", "")} /> : <ChevronDown size={14} />}
        </button>
      )}
    >
      {(cerrar) => (
        <form className="menu-fechas" onSubmit={(e) => { e.preventDefault(); onCambio(d, h); cerrar(); }}>
          <div className="titulo">{etiqueta}</div>
          <label className="etq">Desde</label>
          <input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} />
          <label className="etq">Hasta</label>
          <input className="input" type="date" value={h} onChange={(e) => setH(e.target.value)} />
          <div className="fila" style={{ justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            {activo && <button type="button" className="btn btn-sm btn-fantasma" onClick={() => { onCambio("", ""); cerrar(); }}>Quitar</button>}
            <button type="submit" className="btn btn-sm btn-primario" disabled={!d && !h}>Aplicar</button>
          </div>
        </form>
      )}
    </Menu>
  );
}

export function Buscador({ valor, onCambio, placeholder, ancho = 260 }: { valor: string; onCambio: (v: string) => void; placeholder: string; ancho?: number }) {
  return (
    <div className="buscar" style={{ width: ancho }}>
      <Search size={15} />
      <input className="input" style={{ height: 30 }} value={valor} placeholder={placeholder} onChange={(e) => onCambio(e.target.value)} />
    </div>
  );
}
