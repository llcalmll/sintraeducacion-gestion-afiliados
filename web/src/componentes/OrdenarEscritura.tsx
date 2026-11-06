import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, ChevronDown, ChevronUp, RotateCcw, SpellCheck } from "lucide-react";
import { useMemo, useState } from "react";
import {
  aplicarNormalizacion, deshacerNormalizacion, leerUltimaNormalizacion, proponerNormalizacion, reglaPrincipal, REGLAS, REGLAS_OPCIONALES, type Cambio, type Regla,
} from "../logica/normalizar";
import { Badge, useUI } from "./ui";

const ETIQUETA_CAMPO: Record<string, string> = {
  nombre: "Nombre", municipio: "Municipio", cargo: "Cargo", area: "Área", directiva: "Directiva", cargoDirectivo: "Cargo directivo",
  sindicatoRetirado: "Sindicato retirado", vinculacion: "Provisional/carrera", cajaCompensacion: "Caja de compensación", comuna: "Comuna",
  quienAfilia: "Quién lo afilia", institucion: "Institución", celular: "Celular", otroCelular: "Otro celular", correo: "Correo",
  cedula: "Cédula", fechaNacimiento: "Fecha de nacimiento", fechaAfiliacion: "Fecha de afiliación", sexo: "Sexo", observaciones: "Observaciones",
};
const mostrar = (v: unknown) => {
  if (v instanceof Date) return `${v.getDate()}/${v.getMonth() + 1}/${v.getFullYear()} (fecha)`;
  if (typeof v === "boolean") return v ? "casilla marcada" : "casilla sin marcar";
  if (typeof v === "number") return `${v} (número)`;
  const s = String(v ?? "");
  // Los espacios no se ven: se marcan para que el cambio sea evidente.
  return s.replace(/^ +| +$/g, (m) => "·".repeat(m.length)).replace(/ {2,}/g, (m) => "·".repeat(m.length));
};

/** Herramienta de administración: ordena la escritura de la base con vista previa y opción de deshacer. */
export function OrdenarEscritura() {
  const { confirmar, avisar } = useUI();
  const [propuesta, setPropuesta] = useState<Cambio[] | null>(null);
  const [elegidas, setElegidas] = useState<Set<Regla>>(new Set((Object.keys(REGLAS) as Regla[]).filter((r) => !REGLAS_OPCIONALES.has(r))));
  const [abierta, setAbierta] = useState<Regla | null>(null);
  const [ocupado, setOcupado] = useState("");
  const ultima = useLiveQuery(() => leerUltimaNormalizacion(), []);

  const grupos = useMemo(() => {
    const g = new Map<Regla, Cambio[]>();
    for (const c of propuesta ?? []) {
      const r = reglaPrincipal(c);
      g.set(r, [...(g.get(r) ?? []), c]);
    }
    return (Object.keys(REGLAS) as Regla[]).filter((r) => g.has(r)).map((r) => {
      const cambios = g.get(r)!;
      // Ejemplos: cada "antes -> después" distinto con cuántas veces aparece.
      const pares = new Map<string, { campo: string; antes: unknown; despues: unknown; n: number }>();
      for (const c of cambios) {
        const k = `${c.campo}|${String(c.antes)}|${String(c.despues)}`;
        const p = pares.get(k) ?? { campo: c.campo, antes: c.antes, despues: c.despues, n: 0 };
        p.n++;
        pares.set(k, p);
      }
      return { regla: r, cambios, ejemplos: [...pares.values()].sort((a, b) => b.n - a.n) };
    });
  }, [propuesta]);
  const aAplicar = (propuesta ?? []).filter((c) => elegidas.has(reglaPrincipal(c)));

  async function revisar() {
    setOcupado("Revisando la base…");
    try { setPropuesta(await proponerNormalizacion()); } finally { setOcupado(""); }
  }

  async function aplicar() {
    if (!(await confirmar({
      titulo: `Ordenar ${aAplicar.length} celdas`,
      texto: "Solo cambia cómo está escrito, no qué significa. Los cambios llegan a todas las personas que usan la app y salen en el Excel descargado. Se puede deshacer después.",
      boton: "Ordenar",
    }))) return;
    setOcupado("Guardando…");
    try {
      const n = await aplicarNormalizacion(aAplicar);
      setPropuesta(null);
      avisar(`${n} celdas ordenadas`);
    } finally { setOcupado(""); }
  }

  async function deshacer() {
    if (!ultima || !(await confirmar({ titulo: "Deshacer el último ordenamiento", texto: `Las ${ultima.cambios.length} celdas vuelven a como estaban el ${new Date(ultima.fecha).toLocaleString("es-CO")}.`, boton: "Deshacer", peligro: true }))) return;
    setOcupado("Deshaciendo…");
    try { avisar(`${await deshacerNormalizacion()} celdas devueltas`); } finally { setOcupado(""); }
  }

  return (
    <div className="card">
      <div className="card-cab">
        <SpellCheck size={16} className="tenue" /><h3>Ordenar la escritura de la base</h3>
        {ultima && <span className="accion fila"><span className="peq muted">Último: {new Date(ultima.fecha).toLocaleDateString("es-CO")} · {ultima.cambios.length} celdas</span><button className="btn btn-sm" onClick={deshacer} disabled={!!ocupado}><RotateCcw size={13} />Deshacer</button></span>}
      </div>
      <div className="card-cuerpo pila">
        <p className="muted" style={{ margin: 0 }}>
          Unifica cómo están escritos los datos sin cambiar lo que significan: espacios de más, tildes, mayúsculas, fechas y las distintas formas de decir "sin dato".
          Nada se adivina: un dato que quedó en otra columna se pasa a la suya o a Observaciones, y lo que no se puede saber queda como SIN DATO. Todo se puede deshacer.
        </p>
        {!propuesta ? (
          <div><button className="btn btn-primario" onClick={revisar} disabled={!!ocupado}>{ocupado || "Revisar la base"}</button></div>
        ) : propuesta.length === 0 ? (
          <div className="aviso ok">La base ya está ordenada: no hay nada que cambiar.</div>
        ) : (
          <>
            <div className="orden-reglas">
              {grupos.map(({ regla, cambios, ejemplos }) => (
                <div key={regla} className={`orden-regla ${elegidas.has(regla) ? "" : "apagada"}`}>
                  <label className="orden-regla-cab">
                    <input type="checkbox" checked={elegidas.has(regla)} onChange={(e) => setElegidas((s) => { const n = new Set(s); if (e.target.checked) n.add(regla); else n.delete(regla); return n; })} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{REGLAS[regla].titulo}</b> <Badge tono={REGLAS_OPCIONALES.has(regla) ? "ambar" : "azul"}>{cambios.length} {cambios.length === 1 ? "celda" : "celdas"}</Badge>
                      {REGLAS_OPCIONALES.has(regla) && <> <Badge tono="ambar">borra información</Badge></>}
                      <div className="peq muted">{REGLAS[regla].explicacion}</div>
                    </span>
                  </label>
                  <div className="orden-ejemplos">
                    {ejemplos.slice(0, abierta === regla ? 200 : 4).map((e, i) => (
                      <div key={i} className="orden-ejemplo">
                        <span className="tenue peq orden-campo">{ETIQUETA_CAMPO[e.campo] ?? (e.campo.startsWith("fecha:") ? e.campo.slice(6).charAt(0) + e.campo.slice(7).toLowerCase() : e.campo)}</span>
                        <code className="antes">{mostrar(e.antes)}</code><ArrowRight size={13} className="tenue" /><code className="despues">{mostrar(e.despues)}</code>
                        {e.n > 1 && <span className="tenue peq">× {e.n}</span>}
                      </div>
                    ))}
                    {ejemplos.length > 4 && (
                      <button className="btn btn-sm btn-fantasma" onClick={() => setAbierta(abierta === regla ? null : regla)}>
                        {abierta === regla ? <><ChevronUp size={13} />Ver menos</> : <><ChevronDown size={13} />Ver los {ejemplos.length} casos</>}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="peq muted" style={{ margin: 0 }}>Los puntos (·) marcan espacios que sobran.</p>
            <div className="fila">
              <button className="btn btn-primario" onClick={aplicar} disabled={!aAplicar.length || !!ocupado}>{ocupado || `Ordenar ${aAplicar.length} celdas`}</button>
              <button className="btn" onClick={() => setPropuesta(null)} disabled={!!ocupado}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
