import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, CircleCheck, CircleX, Clock, Download, Hourglass, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { db, vigilar } from "../datos/db";
import { vigente } from "../datos/hooks";
import { FUENTES, type Afiliado, type Resultado } from "../datos/tipos";
import { calcularRachas } from "../logica/cruce";
import { hoyISO, MESES } from "../logica/fechas";
import { contiene } from "../logica/texto";
import { Buscador, FiltroChip } from "./filtros";
import { PanelAfiliado } from "./PanelAfiliado";
import { TablaDatos, type Columna } from "./TablaDatos";
import { Avatar, Badge, BadgeEntidad, Vacio } from "./ui";

interface FilaMes { a: Afiliado; meses: Map<string, Resultado>; racha: number; sinDescuento: number }

const MARCA: Partial<Record<Resultado, { icono: typeof CircleCheck; color: string; texto: string }>> = {
  descontado: { icono: CircleCheck, color: "var(--verde)", texto: "Descontado" },
  sin_descuento: { icono: CircleX, color: "var(--rojo)", texto: "Sin descuento" },
  pendiente_novedad: { icono: Clock, color: "var(--ambar)", texto: "En trámite" },
  novedad_demorada: { icono: Hourglass, color: "var(--gris)", texto: "Afiliación demorada" },
  retirado_con_descuento: { icono: AlertTriangle, color: "var(--rosa)", texto: "Retirado con descuento" },
};

const corto = (p: string) => {
  const [a, m] = p.split("-").map(Number);
  return `${MESES[m - 1].slice(0, 3)} ${String(a).slice(2)}`;
};

/** Registro mes a mes: a quién se le descontó y a quién no, en cada mes subido. */
export function MesAMes({ onVerMes }: { onVerMes: (periodo: string) => void }) {
  const datos = useLiveQuery(async () => {
    await vigilar(db.cruces, db.cruceDetalle, db.afiliados);
    const cruces = (await db.cruces.orderBy("periodo").toArray()).slice(-12);
    const detalle = await db.cruceDetalle.where("cruceId").anyOf(cruces.map((c) => c.id!)).toArray();
    const afiliados = await db.afiliados.toArray();
    return { cruces, detalle, afiliados, rachas: await calcularRachas() };
  }, []);
  const [q, setQ] = useState("");
  const [entidad, setEntidad] = useState("");
  const [mostrar, setMostrar] = useState("");
  const [panel, setPanel] = useState<number | null>(null);

  const filas = useMemo<FilaMes[]>(() => {
    if (!datos) return [];
    const pagadores = new Set(datos.cruces.flatMap((c) => c.fuentes.filter((f) => !FUENTES[f.fuente].parte).map((f) => FUENTES[f.fuente].pagador)));
    const porAf = new Map<number, Map<string, Resultado>>();
    for (const d of datos.detalle) {
      if (!d.afiliadoId || d.resultado === "extraordinaria" || d.resultado === "no_en_base") continue;
      const m = porAf.get(d.afiliadoId) ?? new Map();
      m.set(d.periodo, d.resultado);
      porAf.set(d.afiliadoId, m);
    }
    return datos.afiliados
      .filter((a) => porAf.has(a.id!) || (vigente(a) && pagadores.has(a.pagador)))
      .map((a) => {
        const meses = porAf.get(a.id!) ?? new Map<string, Resultado>();
        return { a, meses, racha: datos.rachas.get(a.id!)?.meses ?? 0, sinDescuento: [...meses.values()].filter((r) => r === "sin_descuento").length };
      });
  }, [datos]);

  if (!datos) return null;
  const { cruces } = datos;
  if (!cruces.length) return <Vacio titulo="Todavía no se ha subido ningún mes" />;
  const ultimo = cruces[cruces.length - 1].periodo;

  const visibles = filas.filter((f) => {
    if (entidad && f.a.pagador !== entidad) return false;
    if (mostrar === "con-faltas" && f.sinDescuento === 0) return false;
    if (mostrar === "al-dia" && f.meses.get(ultimo) !== "descontado") return false;
    if (mostrar === "seguidos" && f.racha < 2) return false;
    if (q && !(contiene(f.a.nombre, q) || (f.a.cedula ?? "").includes(q))) return false;
    return true;
  });

  const columnas: Columna<FilaMes>[] = [
    { id: "nombre", titulo: "Afiliado", fija: true, valor: (f) => f.a.nombre, celda: (f) => <div className="principal-celda"><Avatar nombre={f.a.nombre} /><div><b>{f.a.nombre}</b><small>C.C. {f.a.cedula}</small></div></div> },
    { id: "entidad", titulo: "Entidad", valor: (f) => f.a.pagador, celda: (f) => <BadgeEntidad p={f.a.pagador} corta /> },
    ...cruces.map((c): Columna<FilaMes> => ({
      id: c.periodo, titulo: corto(c.periodo), valor: (f) => ["descontado", "pendiente_novedad", "novedad_demorada", "retirado_con_descuento", "sin_descuento"].indexOf(f.meses.get(c.periodo) ?? ""),
      celda: (f) => {
        const m = MARCA[f.meses.get(c.periodo) as Resultado];
        if (!m) return <span title="Sin reporte de su entidad ese mes" className="vacio-celda"><Minus size={16} /></span>;
        return <span title={m.texto} style={{ color: m.color, display: "inline-flex" }}><m.icono size={18} /></span>;
      },
    })),
    { id: "racha", titulo: "Meses seguidos sin descuento", alinear: "der", valor: (f) => f.racha, celda: (f) => (f.racha ? <Badge tono={f.racha >= 2 ? "rojo" : "ambar"}>{f.racha}</Badge> : "") },
    { id: "total", titulo: "Total sin descuento", alinear: "der", valor: (f) => f.sinDescuento, celda: (f) => f.sinDescuento || "" },
  ];

  function exportar() {
    const wb = XLSX.utils.book_new();
    const hoja = XLSX.utils.json_to_sheet(visibles.map((f) => ({
      "Cédula": f.a.cedula ?? "", "Afiliado": f.a.nombre, "Entidad": f.a.pagador,
      ...Object.fromEntries(cruces.map((c) => [corto(c.periodo), MARCA[f.meses.get(c.periodo) as Resultado]?.texto ?? "Sin reporte"])),
      "Meses seguidos sin descuento": f.racha, "Total sin descuento": f.sinDescuento,
    })));
    XLSX.utils.book_append_sheet(wb, hoja, "Mes a mes");
    XLSX.writeFile(wb, `Descuentos mes a mes ${hoyISO()}.xlsx`);
  }

  return (
    <div className="pila">
      <div className="kpis">
        {cruces.map((c) => (
          <button key={c.periodo} className="kpi tono-azul" onClick={() => onVerMes(c.periodo)} title="Ver el detalle de ese mes">
            <span>
              <div className="valor mayus" style={{ fontSize: 17 }}>{MESES[Number(c.periodo.slice(5)) - 1]} {c.periodo.slice(0, 4)}</div>
              <div className="fila-wrap" style={{ marginTop: 6, gap: 6 }}>
                <Badge tono="verde">{c.totales.descontado ?? 0} descontados</Badge>
                <Badge tono="rojo">{c.totales.sin_descuento ?? 0} sin descuento</Badge>
              </div>
            </span>
          </button>
        ))}
      </div>
      {cruces.length < 2 && (
        <div className="aviso info">Por ahora hay un solo mes subido. Cada mes que suban aparecerá aquí como una columna nueva, y se verá quién lleva varios meses sin descuento.</div>
      )}
      <TablaDatos
        idGuardado="mes-a-mes"
        filas={visibles}
        clave={(f) => f.a.id!}
        onFila={(f) => setPanel(f.a.id!)}
        ordenInicial={{ id: "racha", dir: -1 }}
        columnas={columnas}
        barra={
          <>
            <Buscador valor={q} onCambio={setQ} placeholder="Buscar nombre o cédula" ancho={220} />
            <FiltroChip etiqueta="Mostrar" valor={mostrar} onCambio={setMostrar} opciones={[
              { v: "con-faltas", t: "Con algún mes sin descuento" },
              { v: "seguidos", t: "Dos meses seguidos o más" },
              { v: "al-dia", t: "Al día el último mes" },
            ]} />
            <FiltroChip etiqueta="Entidad" valor={entidad} onCambio={setEntidad} opciones={[...new Set(filas.map((f) => f.a.pagador))].map((p) => ({ v: p, t: p }))} />
            <span className="fila peq muted" style={{ gap: 10 }}>
              <span className="fila" style={{ gap: 4 }}><CircleCheck size={14} color="var(--verde)" />Descontado</span>
              <span className="fila" style={{ gap: 4 }}><CircleX size={14} color="var(--rojo)" />Sin descuento</span>
              <span className="fila" style={{ gap: 4 }}><Clock size={14} color="var(--ambar)" />En trámite</span>
              <span className="fila" style={{ gap: 4 }}><Minus size={14} />Sin reporte</span>
            </span>
          </>
        }
        barraDerecha={<button className="btn btn-sm" onClick={exportar}><Download size={14} />Descargar</button>}
      />
      <PanelAfiliado afiliadoId={panel} onCerrar={() => setPanel(null)} />
    </div>
  );
}
