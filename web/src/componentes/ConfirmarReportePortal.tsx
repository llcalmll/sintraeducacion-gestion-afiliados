import { AlertTriangle, Building2, School } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Fuente } from "../datos/tipos";
import { nombrePeriodo, periodoActual, periodoAnterior } from "../logica/fechas";
import type { ReporteLeido } from "../logica/reportes";
import { pesos } from "../logica/texto";

export interface DatosPortal { periodo: string; fuente: Fuente }

/**
 * El portal de la Secretaría de Ibagué entrega el reporte sin título ni mes, y separa las instituciones educativas de la
 * planta central. Eso no se adivina: la app sugiere y la persona confirma el mes y qué archivo es.
 */
export function ConfirmarReportePortal({ reporte, mesAnterior, responder }: { reporte: ReporteLeido; mesAnterior?: string; responder: (datos: DatosPortal | null) => void }) {
  const mensual = reporte.lineas.filter((l) => l.concepto !== "extraordinaria");
  const ahorro = reporte.lineas.length - mensual.length;
  const [periodo, setPeriodo] = useState(mesAnterior ?? reporte.periodoSugerido ?? "");
  // Planta central son muy pocas personas (2 en noviembre de 2026); es solo la sugerencia inicial.
  const [fuente, setFuente] = useState<Fuente>(reporte.lineas.length <= 20 ? "SEM_IBAGUE_CENTRAL" : "SEM_IBAGUE");
  const meses = useMemo(() => {
    const lista = Array.from({ length: 13 }, (_, i) => periodoAnterior(periodoActual(), i));
    return [...new Set([...(periodo ? [periodo] : []), ...lista])].sort().reverse();
    // Solo al abrir: la lista no cambia con la selección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && responder(null);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [responder]);

  return createPortal(
    <>
      <div className="velo" onClick={() => responder(null)} />
      <form className="modal" role="dialog" aria-label="Confirmar reporte de la Secretaría de Ibagué" onSubmit={(e) => { e.preventDefault(); if (periodo) responder({ periodo, fuente }); }}>
        <div className="modal-cuerpo pila">
          <h2>Reporte de la Secretaría de Ibagué</h2>
          <p className="muted" style={{ margin: 0, overflowWrap: "anywhere" }}>
            {reporte.archivo}: {mensual.length} {mensual.length === 1 ? "descuento mensual" : "descuentos mensuales"} por {pesos(mensual.reduce((s, l) => s + l.valor, 0))}{ahorro > 0 && `, y ${ahorro} del ahorro del viaje a San Andrés`}.
            El archivo no dice de qué mes es ni qué parte es: confírmelo.
          </p>
          {reporte.advertencias.map((a) => <div key={a} className="aviso error" role="alert"><AlertTriangle size={15} style={{ flexShrink: 0 }} /><span>{a}</span></div>)}
          <div>
            <label className="etq" htmlFor="mes-reporte">¿De qué mes es la nómina?</label>
            <select id="mes-reporte" className="select" autoFocus value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              {meses.map((m) => <option key={m} value={m}>{nombrePeriodo(m)}</option>)}
            </select>
            {reporte.fechaImpresion && !mesAnterior && <div className="ayuda">Se imprimió el {reporte.fechaImpresion}: por eso se sugiere el mes anterior. Cámbielo si no es.</div>}
          </div>
          <div>
            <span className="etq">¿Qué archivo es?</span>
            <div className="seg" style={{ display: "flex" }} role="group" aria-label="Qué archivo es">
              <button type="button" style={{ flex: 1 }} className={fuente === "SEM_IBAGUE" ? "on" : ""} aria-pressed={fuente === "SEM_IBAGUE"} onClick={() => setFuente("SEM_IBAGUE")}><School size={14} />Instituciones educativas</button>
              <button type="button" style={{ flex: 1 }} className={fuente === "SEM_IBAGUE_CENTRAL" ? "on" : ""} aria-pressed={fuente === "SEM_IBAGUE_CENTRAL"} onClick={() => setFuente("SEM_IBAGUE_CENTRAL")}><Building2 size={14} />Planta central</button>
            </div>
          </div>
        </div>
        <div className="modal-pie">
          <button type="button" className="btn" onClick={() => responder(null)}>Cancelar</button>
          <button className="btn btn-primario" disabled={!periodo}>Cargar reporte</button>
        </div>
      </form>
    </>,
    document.body,
  );
}
