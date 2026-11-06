import { CheckCircle2, ClipboardList, Inbox, Upload, X, type LucideIcon, AlertCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useModoDemo } from "../datos/preferencias";
import { ESTADOS, RESULTADOS, type Estado, type Resultado } from "../datos/tipos";

/* ---------------- Etiquetas */

export type Tono = "verde" | "ambar" | "rojo" | "azul" | "morado" | "rosa" | "cian" | "gris";

export function Badge({ tono = "gris", punto, children, title }: { tono?: Tono; punto?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tono}`} title={title}>
      {punto && <span className="punto" />}
      {children}
    </span>
  );
}

const TONO_ESTADO: Record<Estado, Tono> = { activo: "verde", pendiente_novedad: "ambar", retirado: "rojo", desvinculado: "gris" };
export function BadgeEstado({ estado }: { estado: Estado }) {
  return <Badge tono={TONO_ESTADO[estado]} punto>{ESTADOS[estado]}</Badge>;
}

export const TONO_RESULTADO: Record<Resultado, Tono> = {
  descontado: "verde", sin_descuento: "rojo", pendiente_novedad: "ambar", novedad_demorada: "gris",
  retirado_con_descuento: "rosa", no_en_base: "morado", extraordinaria: "azul",
};
export function BadgeResultado({ r }: { r: Resultado }) {
  return <Badge tono={TONO_RESULTADO[r]}>{RESULTADOS[r].titulo}</Badge>;
}

/** Color estable por entidad, para que la misma entidad siempre se vea igual. */
export function tonoEntidad(p: string): Tono {
  if (/Educación de Ibagué/.test(p)) return "azul";
  if (/Tolima/.test(p)) return "morado";
  if (/Alcald/.test(p)) return "cian";
  if (/Personer/.test(p)) return "rosa";
  return "gris";
}
export function BadgeEntidad({ p, corta }: { p: string; corta?: boolean }) {
  // Las entidades se muestran siempre en mayúsculas (pedido del sindicato); el dato guardado no cambia.
  const t = (corta ? p.replace("Secretaría de Educación de ", "SEM ").replace("Secretaría de Educación del ", "SED ") : p).toLocaleUpperCase("es-CO");
  return <Badge tono={tonoEntidad(p)} title={p.toLocaleUpperCase("es-CO")}>{t}</Badge>;
}

const AVATARES: [string, string][] = [
  ["var(--azul-s)", "var(--azul)"], ["var(--morado-s)", "var(--morado)"], ["var(--verde-s)", "var(--verde)"], ["var(--ambar-s)", "var(--ambar)"],
  ["var(--rosa-s)", "var(--rosa)"], ["var(--cian-s)", "var(--cian)"], ["var(--rojo-s)", "var(--rojo)"],
];
/** Iniciales de un nombre escrito en orden normal ("Andrés Pira" -> "AP"), como el de quien inicia sesión. */
export function inicialesPersona(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter((x) => /^\p{L}/u.test(x));
  return p.length ? p.slice(0, 2).map((x) => x[0].toUpperCase()).join("") : "?";
}

export function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  // La base trae APELLIDOS NOMBRES: se toma el primer nombre y el primer apellido.
  return ((p[2] ?? p[1] ?? "")[0] ?? "").toUpperCase() + (p[0][0] ?? "").toUpperCase();
}
/** persona: el nombre va en orden normal (usuarios de la app), no "APELLIDOS NOMBRES" como en la base. */
export function Avatar({ nombre, grande, persona }: { nombre: string; grande?: boolean; persona?: boolean }) {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATARES[h % AVATARES.length];
  return <span className={`avatar ${grande ? "lg" : ""}`} style={{ background: bg, color: fg }}>{persona ? inicialesPersona(nombre) : iniciales(nombre)}</span>;
}

/* ---------------- Bloques */

export function Cabecera({ migas, titulo, sub, children }: { migas?: { t: string; a?: string }[]; titulo: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="cabecera">
      <div>
        {migas && (
          <div className="migas">
            {migas.map((m, i) => (
              <span key={i} className="fila" style={{ gap: 6 }}>
                {m.a ? <Link to={m.a}>{m.t}</Link> : m.t}
                {i < migas.length - 1 && <span>/</span>}
              </span>
            ))}
          </div>
        )}
        <h1>{titulo}</h1>
        {sub && <div className="muted peq" style={{ marginTop: 2 }}>{sub}</div>}
      </div>
      <div className="espacio" />
      <div className="fila-wrap">{children}</div>
    </header>
  );
}

export function Kpi(props: { icono: LucideIcon; valor: ReactNode; etiqueta: ReactNode; tono?: string; a?: string; onClick?: () => void; on?: boolean }) {
  const I = props.icono;
  const cls = `kpi tono-${props.tono ?? "gris"} ${props.on ? "on" : ""}`;
  const cuerpo = (
    <>
      <span className="ico"><I size={18} /></span>
      <span>
        <div className="valor">{props.valor}</div>
        <div className="etiqueta">{props.etiqueta}</div>
      </span>
    </>
  );
  if (props.a) return <Link className={cls} to={props.a}>{cuerpo}</Link>;
  if (props.onClick) return <button className={cls} onClick={props.onClick}>{cuerpo}</button>;
  return <div className={cls}>{cuerpo}</div>;
}

/** Indicación de un dato que se debe pedir en la reunión con el cliente. Solo en modo demo. */
export function Pendiente({ children }: { children: ReactNode }) {
  if (!useModoDemo()) return null;
  return (
    <div className="pendiente">
      <ClipboardList size={16} />
      <div><b>Pedir en la reunión: </b>{children}</div>
    </div>
  );
}
export function PendienteChip({ children, title }: { children: ReactNode; title?: string }) {
  if (!useModoDemo()) return null;
  return <span className="pendiente-chip" title={title}><ClipboardList size={12} />{children}</span>;
}

export function Vacio({ icono: I = Inbox, titulo, children }: { icono?: LucideIcon; titulo: string; children?: ReactNode }) {
  return (
    <div className="vacio">
      <span className="ico"><I size={22} /></span>
      <b style={{ color: "var(--texto)" }}>{titulo}</b>
      {children}
    </div>
  );
}

export function ZonaArchivo(props: { onArchivos: (f: File[]) => void; acepta: string; multiple?: boolean; titulo: string; ayuda?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);
  return (
    <div
      className={"zona" + (encima ? " encima" : "")}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); setEncima(false); props.onArchivos([...e.dataTransfer.files]); }}
    >
      <input ref={ref} type="file" accept={props.acepta} multiple={props.multiple} onChange={(e) => { props.onArchivos([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <Upload size={20} />
      <b>{props.titulo}</b>
      {props.ayuda && <span className="peq tenue">{props.ayuda}</span>}
    </div>
  );
}

/* ---------------- Menú desplegable */

export function Menu({ boton, children, derecha, ancho }: { boton: (abrir: () => void, abierto: boolean) => ReactNode; children: (cerrar: () => void) => ReactNode; derecha?: boolean; ancho?: number }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAbierto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);
  return (
    <div className="menu-ancla" ref={ref}>
      {boton(() => setAbierto((v) => !v), abierto)}
      {abierto && <div className={`menu ${derecha ? "derecha" : ""}`} style={ancho ? { minWidth: ancho } : undefined}>{children(() => setAbierto(false))}</div>}
    </div>
  );
}

/* ---------------- Panel lateral */

export function Panel({ abierto, onCerrar, cabecera, children, pie }: { abierto: boolean; onCerrar: () => void; cabecera: ReactNode; children: ReactNode; pie?: ReactNode }) {
  useEffect(() => {
    if (!abierto) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return createPortal(
    <>
      <div className="velo" onClick={onCerrar} />
      <aside className="panel" role="dialog">
        <div className="panel-cab">
          <div style={{ flex: 1, minWidth: 0 }}>{cabecera}</div>
          <button className="btn btn-fantasma btn-icono btn-sm" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="panel-cuerpo">{children}</div>
        {pie && <div className="panel-pie">{pie}</div>}
      </aside>
    </>,
    document.body,
  );
}

/* ---------------- Confirmaciones y notificaciones */

interface Confirmacion { titulo: string; texto?: ReactNode; boton?: string; peligro?: boolean }
interface UI {
  confirmar: (c: Confirmacion) => Promise<boolean>;
  /** "error" muestra el aviso en rojo y por más tiempo. */
  avisar: (texto: string, tipo?: "error") => void;
}
const Ctx = createContext<UI>({ confirmar: async () => true, avisar: () => {} });
export const useUI = () => useContext(Ctx);

export function ProveedorUI({ children }: { children: ReactNode }) {
  const [conf, setConf] = useState<(Confirmacion & { ok: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<{ id: number; texto: string; error: boolean }[]>([]);
  const confirmar = useCallback((c: Confirmacion) => new Promise<boolean>((ok) => setConf({ ...c, ok })), []);
  const avisar = useCallback((texto: string, tipo?: "error") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, texto, error: tipo === "error" }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === "error" ? 6000 : 3200);
  }, []);
  const cerrar = (v: boolean) => { conf?.ok(v); setConf(null); };
  return (
    <Ctx.Provider value={{ confirmar, avisar }}>
      {children}
      {conf && createPortal(
        <>
          <div className="velo" onClick={() => cerrar(false)} />
          <div className="modal" role="alertdialog">
            <div className="modal-cuerpo">
              <h2 style={{ marginBottom: 6 }}>{conf.titulo}</h2>
              {conf.texto && <div className="muted">{conf.texto}</div>}
            </div>
            <div className="modal-pie">
              <button className="btn" onClick={() => cerrar(false)}>Cancelar</button>
              <button className={`btn ${conf.peligro ? "btn-peligro" : "btn-primario"}`} autoFocus onClick={() => cerrar(true)}>{conf.boton ?? "Confirmar"}</button>
            </div>
          </div>
        </>,
        document.body,
      )}
      {createPortal(
        <div className="toasts">
          {toasts.map((t) => <div key={t.id} className={`toast ${t.error ? "error" : ""}`} role={t.error ? "alert" : "status"}>{t.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{t.texto}</div>)}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}
