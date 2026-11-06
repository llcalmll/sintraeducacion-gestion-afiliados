import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Rows3, Rows4, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { medirTexto } from "../logica/medir";
import { Menu, Vacio } from "./ui";

export interface Columna<T> {
  id: string;
  titulo: string;
  celda: (f: T) => ReactNode;
  /** Valor para ordenar. Sin él, la columna no se puede ordenar. */
  valor?: (f: T) => string | number | null | undefined;
  alinear?: "der";
  oculta?: boolean;
  fija?: boolean;
  ancho?: number;
}

interface Props<T> {
  filas: T[];
  columnas: Columna<T>[];
  clave: (f: T) => string | number;
  onFila?: (f: T) => void;
  seleccionable?: boolean;
  accionesSeleccion?: (sel: T[], limpiar: () => void) => ReactNode;
  barra?: ReactNode;
  barraDerecha?: ReactNode;
  idGuardado?: string;
  ordenInicial?: { id: string; dir: 1 | -1 };
  marca?: (f: T) => "rojo" | "ambar" | "verde" | undefined;
  vacio?: ReactNode;
  porPagina?: number;
  sinPaginar?: boolean;
}

function leer<T>(k: string, defecto: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : defecto;
  } catch {
    return defecto;
  }
}
function guardar(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: la preferencia dura la sesión */
  }
}

const comparar = new Intl.Collator("es", { numeric: true, sensitivity: "base" }).compare;

export function TablaDatos<T>(p: Props<T>) {
  const k = p.idGuardado ? `tabla:${p.idGuardado}` : null;
  const [ocultas, setOcultas] = useState<string[]>(() =>
    k ? leer(`${k}:ocultas`, p.columnas.filter((c) => c.oculta).map((c) => c.id)) : p.columnas.filter((c) => c.oculta).map((c) => c.id),
  );
  const [compacta, setCompacta] = useState<boolean>(() => (k ? leer(`${k}:compacta`, false) : false));
  const [tam, setTam] = useState<number>(() => (k ? leer(`${k}:tam`, p.porPagina ?? 50) : p.porPagina ?? 50));
  const [orden, setOrden] = useState(p.ordenInicial ?? null);
  const [pagina, setPagina] = useState(0);
  const [sel, setSel] = useState<Set<string | number>>(new Set());

  useEffect(() => { if (k) guardar(`${k}:ocultas`, ocultas); }, [k, ocultas]);
  useEffect(() => { if (k) guardar(`${k}:compacta`, compacta); }, [k, compacta]);
  useEffect(() => { if (k) guardar(`${k}:tam`, tam); }, [k, tam]);
  useEffect(() => setPagina(0), [p.filas.length, orden, tam]);

  const visibles = p.columnas.filter((c) => !ocultas.includes(c.id));
  const ordenadas = useMemo(() => {
    if (!orden) return p.filas;
    const col = p.columnas.find((c) => c.id === orden.id);
    if (!col?.valor) return p.filas;
    return [...p.filas].sort((a, b) => {
      const va = col.valor!(a), vb = col.valor!(b);
      if (va == null || va === "") return 1;
      if (vb == null || vb === "") return -1;
      return (typeof va === "number" && typeof vb === "number" ? va - vb : comparar(String(va), String(vb))) * orden.dir;
    });
  }, [p.filas, p.columnas, orden]);

  // Anchos estables: estimados con TODAS las filas (no solo la página) y sin encogerse al paginar, filtrar u ordenar.
  const estimados = useMemo(() => {
    const out: Record<string, number> = {};
    const muestra = p.filas.length > 3000 ? p.filas.slice(0, 3000) : p.filas;
    for (const c of p.columnas) {
      let max = medirTexto(c.titulo, 11.5, 600, true) + 24 + (c.valor ? 18 : 0);
      if (c.valor) for (const f of muestra) {
        const v = c.valor(f);
        if (v === null || v === undefined || v === "") continue;
        const w = medirTexto(String(v), 13) + 24;
        if (w > max) max = w;
        if (max >= 320) break;
      }
      out[c.id] = Math.min(320, max);
    }
    return out;
  }, [p.filas, p.columnas]);
  const medidos = useRef<Record<string, number>>({});
  const filaEncabezado = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    for (const th of Array.from(filaEncabezado.current?.children ?? []) as HTMLElement[]) {
      const id = th.dataset.col;
      if (!id) continue;
      const w = th.getBoundingClientRect().width;
      if (w > (medidos.current[id] ?? 0) + 0.5) medidos.current[id] = w;
    }
  });

  const paginas = p.sinPaginar ? 1 : Math.max(1, Math.ceil(ordenadas.length / tam));
  const enPagina = p.sinPaginar ? ordenadas : ordenadas.slice(pagina * tam, (pagina + 1) * tam);
  const seleccionadas = ordenadas.filter((f) => sel.has(p.clave(f)));
  const todaPagina = enPagina.length > 0 && enPagina.every((f) => sel.has(p.clave(f)));
  const limpiar = () => setSel(new Set());

  const alternarOrden = (c: Columna<T>) => {
    if (!c.valor) return;
    setOrden((o) => (o?.id !== c.id ? { id: c.id, dir: 1 } : o.dir === 1 ? { id: c.id, dir: -1 } : null));
  };

  return (
    <div className="tabla-card">
      {p.seleccionable && seleccionadas.length > 0 ? (
        <div className="tabla-barra seleccion">
          <b>{seleccionadas.length} seleccionados</b>
          {seleccionadas.length < ordenadas.length && (
            <button className="btn btn-sm btn-fantasma" onClick={() => setSel(new Set(ordenadas.map(p.clave)))}>Seleccionar los {ordenadas.length}</button>
          )}
          <div className="espacio" />
          {p.accionesSeleccion?.(seleccionadas, limpiar)}
          <button className="btn btn-sm btn-fantasma btn-icono" onClick={limpiar} title="Quitar selección"><X size={15} /></button>
        </div>
      ) : (
        (
          <div className="tabla-barra">
            {p.barra}
            <div className="derecha">
            {p.barraDerecha}
            <button className="btn btn-sm btn-icono" title={compacta ? "Filas normales" : "Filas compactas"} onClick={() => setCompacta(!compacta)}>
              {compacta ? <Rows3 size={15} /> : <Rows4 size={15} />}
            </button>
            <Menu
              derecha
              boton={(abrir) => <button className="btn btn-sm" onClick={abrir}><Columns3 size={15} />Columnas</button>}
            >
              {() => (
                <>
                  <div className="titulo">Columnas visibles</div>
                  {p.columnas.filter((c) => !c.fija).map((c) => (
                    <label key={c.id} className="menu-item">
                      <input
                        type="checkbox"
                        checked={!ocultas.includes(c.id)}
                        onChange={() => setOcultas((o) => (o.includes(c.id) ? o.filter((x) => x !== c.id) : [...o, c.id]))}
                      />
                      {c.titulo}
                    </label>
                  ))}
                  <hr />
                  <button className="menu-item" onClick={() => setOcultas(p.columnas.filter((c) => c.oculta).map((c) => c.id))}>Restablecer</button>
                </>
              )}
            </Menu>
            </div>
          </div>
        )
      )}

      <div className="tabla-scroll">
        <table className={`tbl ${compacta ? "compacta" : ""}`}>
          <thead>
            <tr ref={filaEncabezado}>
              {p.seleccionable && (
                <th className="chk">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar página"
                    checked={todaPagina}
                    onChange={() => {
                      const n = new Set(sel);
                      enPagina.forEach((f) => (todaPagina ? n.delete(p.clave(f)) : n.add(p.clave(f))));
                      setSel(n);
                    }}
                  />
                </th>
              )}
              {visibles.map((c) => {
                const activo = orden?.id === c.id;
                const minimo = Math.max(estimados[c.id] ?? 0, medidos.current[c.id] ?? 0);
                return (
                  <th
                    key={c.id}
                    data-col={c.id}
                    className={`${c.valor ? "ordenable" : ""} ${activo ? "activo" : ""} ${c.alinear === "der" ? "num" : ""}`}
                    style={{ ...(c.ancho ? { width: c.ancho } : {}), ...(minimo ? { minWidth: Math.round(minimo) } : {}) }}
                    onClick={() => alternarOrden(c)}
                  >
                    {c.titulo}
                    {c.valor && (
                      <span className="orden">
                        {activo ? (orden!.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {enPagina.map((f) => {
              const id = p.clave(f);
              const m = p.marca?.(f);
              return (
                <tr key={id} className={`${p.onFila ? "clic" : ""} ${sel.has(id) ? "sel" : ""} ${m ? "marca-" + m : ""}`} onClick={() => p.onFila?.(f)}>
                  {p.seleccionable && (
                    <td className="chk" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="Seleccionar fila"
                        checked={sel.has(id)}
                        onChange={() => {
                          const n = new Set(sel);
                          if (n.has(id)) n.delete(id); else n.add(id);
                          setSel(n);
                        }}
                      />
                    </td>
                  )}
                  {visibles.map((c) => (
                    <td key={c.id} className={c.alinear === "der" ? "num" : ""}>{c.celda(f)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {enPagina.length === 0 && (p.vacio ?? <Vacio titulo="Sin resultados">Pruebe con otra búsqueda o quite filtros.</Vacio>)}
      </div>

      {!p.sinPaginar && (
        <div className="tabla-pie">
          <span>
            {ordenadas.length === 0 ? "0" : `${pagina * tam + 1}–${Math.min((pagina + 1) * tam, ordenadas.length)}`} de {ordenadas.length.toLocaleString("es-CO")}
          </span>
          <div className="espacio" />
          <span>Filas por página</span>
          <select className="select" style={{ width: 76, height: 28 }} value={tam} onChange={(e) => setTam(Number(e.target.value))}>
            {[25, 50, 100, 250].map((n) => <option key={n}>{n}</option>)}
          </select>
          <span>Página {pagina + 1} de {paginas}</span>
          <button className="btn btn-sm btn-icono" disabled={pagina === 0} onClick={() => setPagina(pagina - 1)} aria-label="Anterior"><ChevronLeft size={15} /></button>
          <button className="btn btn-sm btn-icono" disabled={pagina >= paginas - 1} onClick={() => setPagina(pagina + 1)} aria-label="Siguiente"><ChevronRight size={15} /></button>
        </div>
      )}
    </div>
  );
}
