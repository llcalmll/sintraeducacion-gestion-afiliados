import { AlertTriangle, CircleCheck, Clock, Download, Hourglass, KanbanSquare, Receipt, Table2, UserX, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { FUENTES, nombreFuente, RESULTADOS, type Afiliado, type Cruce, type CruceDetalle, type Resultado } from "../datos/tipos";
import { nombrePeriodo } from "../logica/fechas";
import { exportarCruce } from "../logica/exportar";
import { pesos } from "../logica/texto";
import { Buscador } from "./filtros";
import { TablaDatos } from "./TablaDatos";
import { Avatar, Badge, BadgeEntidad, Kpi, Pendiente, TONO_RESULTADO } from "./ui";

const ORDEN: Resultado[] = ["sin_descuento", "retirado_con_descuento", "pendiente_novedad", "novedad_demorada", "no_en_base", "descontado", "extraordinaria"];
const ICONO = { sin_descuento: UserX, retirado_con_descuento: AlertTriangle, pendiente_novedad: Clock, novedad_demorada: Hourglass, no_en_base: Users, descontado: CircleCheck, extraordinaria: Receipt };
const KPI_TONO: Record<Resultado, string> = { sin_descuento: "rojo", retirado_con_descuento: "rojo", pendiente_novedad: "ambar", novedad_demorada: "gris", no_en_base: "morado", descontado: "verde", extraordinaria: "azul" };
const BORDE: Record<string, string> = { rojo: "#e5484d", rosa: "#d6409f", ambar: "#e0a100", morado: "#8e4ec6", verde: "#30a46c", azul: "#3e63dd", gris: "#8b95a5" };
const MARCA: Partial<Record<Resultado, "rojo" | "ambar" | "verde">> = { sin_descuento: "rojo", retirado_con_descuento: "rojo", pendiente_novedad: "ambar", descontado: "verde" };

export function VistaResultado({ cruce, detalle, afiliados }: { cruce: Cruce; detalle: CruceDetalle[]; afiliados: Map<number, Afiliado> }) {
  const [params] = useSearchParams();
  const inicial = (params.get("r") as Resultado) || (cruce.totales.sin_descuento ? "sin_descuento" : "descontado");
  const [filtro, setFiltro] = useState<Resultado>(inicial);
  const [vista, setVista] = useState<"tabla" | "tablero">("tabla");
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const af = (d: CruceDetalle) => (d.afiliadoId ? afiliados.get(d.afiliadoId) : undefined);
  const coincide = (d: CruceDetalle) => !q || d.nombre.toLowerCase().includes(q.toLowerCase()) || d.cedula.includes(q);
  const filas = detalle.filter((d) => d.resultado === filtro && coincide(d));
  const abrir = (d: CruceDetalle) => { const a = af(d); if (a) nav(`/afiliados/${a.id}`); };

  return (
    <div className="pila">
      <div className="fila-wrap">
        <h2>Resultado de {nombrePeriodo(cruce.periodo)}</h2>
        <span className="peq muted">{cruce.fuentes.map((f) => `${nombreFuente(f.fuente)}: ${f.lineas} registros (${pesos(f.total)})`).join(" · ")}</span>
      </div>
      <div className="kpis">
        {ORDEN.map((r) => (
          <Kpi key={r} icono={ICONO[r]} tono={KPI_TONO[r]} valor={cruce.totales[r] ?? 0} etiqueta={RESULTADOS[r].titulo} on={vista === "tabla" && filtro === r} onClick={() => { setFiltro(r); setVista("tabla"); }} />
        ))}
      </div>
      {cruce.sinCedula > 0 && <Pendiente>{cruce.sinCedula} afiliados activos de estas entidades no tienen cédula y no se pudieron cruzar. <Link to="/?falta=cedula">Ver cuáles</Link></Pendiente>}
      {(cruce.totales.retirado_con_descuento ?? 0) > 0 && <Pendiente>qué procedimiento siguen cuando a un retirado le siguen descontando.</Pendiente>}

      {vista === "tabla" ? (
        <TablaDatos
          idGuardado="cruce"
          filas={filas}
          clave={(d) => d.id ?? `${d.cedula}-${d.resultado}-${d.valor}`}
          onFila={abrir}
          ordenInicial={{ id: "nombre", dir: 1 }}
          marca={(d) => MARCA[d.resultado]}
          barra={
            <>
              <Badge tono={TONO_RESULTADO[filtro]}>{RESULTADOS[filtro].titulo}: {filas.length}</Badge>
              <span className="peq muted">{RESULTADOS[filtro].ayuda}</span>
            </>
          }
          barraDerecha={<Controles vista={vista} setVista={setVista} q={q} setQ={setQ} exportar={() => exportarCruce(cruce, detalle, afiliados)} />}
          columnas={[
            {
              id: "nombre", titulo: "Afiliado", fija: true, valor: (d) => af(d)?.nombre ?? d.nombre,
              celda: (d) => <div className="principal-celda"><Avatar nombre={af(d)?.nombre ?? d.nombre} /><div><b>{af(d)?.nombre ?? d.nombre}</b><small>C.C. {d.cedula}</small></div></div>,
            },
            { id: "entidad", titulo: "Entidad", valor: (d) => af(d)?.pagador ?? "", celda: (d) => <BadgeEntidad p={af(d)?.pagador ?? (d.fuente ? FUENTES[d.fuente].pagador : "")} corta /> },
            { id: "inst", titulo: "Institución", valor: (d) => af(d)?.institucion ?? "", celda: (d) => af(d)?.institucion },
            { id: "cel", titulo: "Celular", celda: (d) => af(d)?.celular },
            { id: "valor", titulo: "Valor", alinear: "der", valor: (d) => d.valor, celda: (d) => (d.valor ? pesos(d.valor) : "") },
            { id: "obs", titulo: "Observaciones", valor: (d) => af(d)?.observaciones ?? "", celda: (d) => <span title={af(d)?.observaciones}>{af(d)?.observaciones}</span> },
          ]}
        />
      ) : (
        <div className="tabla-card">
          <div className="tabla-barra">
            <span className="peq muted">Cada columna es un resultado. Haga clic en una tarjeta para abrir la ficha.</span>
            <div className="derecha">
              <Controles vista={vista} setVista={setVista} q={q} setQ={setQ} exportar={() => exportarCruce(cruce, detalle, afiliados)} />
            </div>
          </div>
          <div className="tablero" style={{ padding: 12 }}>
            {ORDEN.filter((r) => r !== "descontado").map((r) => {
              const col = detalle.filter((d) => d.resultado === r && coincide(d));
              return (
                <div key={r} className="columna">
                  <div className="columna-cab" style={{ borderTopColor: BORDE[TONO_RESULTADO[r]] }}>
                    <h3>{RESULTADOS[r].titulo}</h3>
                    <small>{col.length} personas</small>
                  </div>
                  <div className="columna-lista">
                    {col.slice(0, 60).map((d) => {
                      const a = af(d);
                      return (
                        <div key={d.id ?? d.cedula + d.valor} className="tarjeta-k" onClick={() => abrir(d)}>
                          <b>{a?.nombre ?? d.nombre}</b>
                          <small>C.C. {d.cedula}{a?.institucion ? ` · ${a.institucion}` : ""}</small>
                          <div className="fila-wrap">
                            <BadgeEntidad p={a?.pagador ?? (d.fuente ? FUENTES[d.fuente].pagador : "Sin entidad")} corta />
                            {d.valor > 0 && <Badge>{pesos(d.valor)}</Badge>}
                          </div>
                        </div>
                      );
                    })}
                    {col.length > 60 && <span className="peq muted" style={{ padding: 4 }}>Y {col.length - 60} más. Use la vista de tabla para verlos todos.</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Controles({ vista, setVista, q, setQ, exportar }: { vista: string; setVista: (v: "tabla" | "tablero") => void; q: string; setQ: (v: string) => void; exportar: () => void }) {
  return (
    <>
      <Buscador valor={q} onCambio={setQ} placeholder="Buscar nombre o cédula" ancho={220} />
      <div className="seg">
        <button className={vista === "tabla" ? "on" : ""} onClick={() => setVista("tabla")}><Table2 size={14} />Tabla</button>
        <button className={vista === "tablero" ? "on" : ""} onClick={() => setVista("tablero")}><KanbanSquare size={14} />Tablero</button>
      </div>
      <button className="btn btn-sm" onClick={exportar}><Download size={14} />Excel</button>
    </>
  );
}
