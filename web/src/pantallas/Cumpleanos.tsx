import { Cake, CalendarDays, ChevronLeft, ChevronRight, Download, MessageCircle, PartyPopper } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TablaDatos } from "../componentes/TablaDatos";
import { Avatar, Badge, Cabecera, Kpi, Panel, Pendiente, Vacio } from "../componentes/ui";
import { useAfiliados, useHijosPorAfiliado } from "../datos/hooks";
import { diaMes, diasParaCumple, edad, hoyISO, MESES } from "../logica/fechas";
import * as XLSX from "xlsx";
import { esVacio } from "../logica/texto";

export interface Cumple {
  clave: string;
  nombre: string;
  fecha: string;
  dias: number;
  cumple: number;
  afiliadoId: number;
  esHijo: boolean;
  padre?: string;
  celular: string;
  institucion: string;
}

export function listaCumples(afiliados: ReturnType<typeof useAfiliados>, hijos: ReturnType<typeof useHijosPorAfiliado>): Cumple[] {
  const out: Cumple[] = [];
  const nuevo = (clave: string, nombre: string, fecha: string, a: NonNullable<typeof afiliados>[number], esHijo: boolean): Cumple => {
    const dias = diasParaCumple(fecha)!;
    return { clave, nombre, fecha, dias, cumple: (edad(fecha) ?? 0) + (dias === 0 ? 0 : 1), afiliadoId: a.id!, esHijo, padre: esHijo ? a.nombre : undefined, celular: a.celular, institucion: a.institucion };
  };
  for (const a of afiliados ?? []) {
    if (a.estado === "retirado" || a.estado === "desvinculado") continue;
    if (a.fechaNacimiento) out.push(nuevo(`a${a.id}`, a.nombre, a.fechaNacimiento, a, false));
    for (const h of hijos?.get(a.id!) ?? []) if (h.fechaNacimiento) out.push(nuevo(`h${h.id}`, h.nombre, h.fechaNacimiento, a, true));
  }
  return out.sort((x, y) => x.dias - y.dias);
}

export function mensajeWhatsApp(c: Cumple): string | null {
  const tel = c.celular.replace(/\D/g, "");
  if (esVacio(c.celular) || tel.length !== 10) return null;
  const texto = c.esHijo
    ? `Hola, desde SINTRAEDUCACIÓN le enviamos un saludo y nuestros mejores deseos en el cumpleaños de ${c.nombre}.`
    : `Hola, SINTRAEDUCACIÓN le desea un muy feliz cumpleaños. Un abrazo de parte de toda la organización.`;
  return `https://wa.me/57${tel}?text=${encodeURIComponent(texto)}`;
}

const VISTAS = [
  { v: "hoy", t: "Hoy" },
  { v: "semana", t: "Próximos 7 días" },
  { v: "mes", t: "Por mes" },
];

export default function Cumpleanos() {
  const afiliados = useAfiliados();
  const hijos = useHijosPorAfiliado();
  const nav = useNavigate();
  const [vista, setVista] = useState("semana");
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [conHijos, setConHijos] = useState(true);
  const [paso, setPaso] = useState<number | null>(null);
  const todos = useMemo(() => listaCumples(afiliados, hijos), [afiliados, hijos]);
  if (afiliados === undefined) return null;

  const visibles = todos.filter((c) => conHijos || !c.esHijo);
  const filas =
    vista === "hoy" ? visibles.filter((c) => c.dias === 0)
    : vista === "semana" ? visibles.filter((c) => c.dias <= 7)
    : visibles.filter((c) => Number(c.fecha.slice(5, 7)) === mes);
  const hoy = visibles.filter((c) => c.dias === 0 && mensajeWhatsApp(c));
  const rango = vista === "hoy" ? "hoy" : vista === "semana" ? "próximos 7 días" : MESES[mes - 1];

  /** Excel con lo que se está viendo: nombre, día del cumpleaños y teléfono (de los hijos, el del afiliado). */
  function descargar() {
    const hoja = XLSX.utils.json_to_sheet(filas.map((c) => ({
      "Nombre": c.nombre,
      "Día de cumpleaños": diaMes(c.fecha),
      "Teléfono": esVacio(c.celular) ? "" : c.celular,
      "Cumple (años)": c.cumple,
      "Hijo(a) de": c.padre ?? "",
    })));
    hoja["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 40 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Cumpleaños");
    XLSX.writeFile(libro, `Cumpleaños ${rango} ${hoyISO()}.xlsx`);
  }
  const sinFecha = afiliados.filter((a) => !a.fechaNacimiento && a.estado !== "retirado" && a.estado !== "desvinculado").length;

  return (
    <>
      <Cabecera titulo="Cumpleaños" sub="Afiliados activos y sus hijos. El saludo se envía por WhatsApp con un clic.">
        {hoy.length > 0 && <button className="btn btn-primario" onClick={() => setPaso(0)}><MessageCircle size={15} />Saludar a los de hoy ({hoy.length})</button>}
        <div className="seg">
          {VISTAS.map((v) => <button key={v.v} className={vista === v.v ? "on" : ""} onClick={() => setVista(v.v)}>{v.t}</button>)}
        </div>
        <button className="btn" disabled={!filas.length} onClick={descargar} title={`Descargar en Excel los cumpleaños de ${rango}`}><Download size={15} />Descargar Excel</button>
      </Cabecera>
      <div className="contenido">
        <div className="kpis">
          <Kpi icono={PartyPopper} tono="verde" valor={visibles.filter((c) => c.dias === 0).length} etiqueta="Cumplen hoy" onClick={() => setVista("hoy")} on={vista === "hoy"} />
          <Kpi icono={Cake} tono="azul" valor={visibles.filter((c) => c.dias <= 7).length} etiqueta="En los próximos 7 días" onClick={() => setVista("semana")} on={vista === "semana"} />
          <Kpi icono={CalendarDays} tono="morado" valor={visibles.filter((c) => Number(c.fecha.slice(5, 7)) === new Date().getMonth() + 1).length} etiqueta={`En ${MESES[new Date().getMonth()]}`} onClick={() => { setVista("mes"); setMes(new Date().getMonth() + 1); }} on={vista === "mes" && mes === new Date().getMonth() + 1} />
        </div>
        {sinFecha > 0 && <Pendiente>la fecha de nacimiento de {sinFecha} afiliados activos; sin ella no aparecen aquí. <Link to="/?falta=fecha">Ver cuáles</Link></Pendiente>}
        <TablaDatos
          key={vista}
          idGuardado="cumple"
          filas={filas}
          clave={(c) => c.clave}
          onFila={(c) => nav(`/afiliados/${c.afiliadoId}`)}
          ordenInicial={vista === "mes" ? { id: "dia", dir: 1 } : { id: "faltan", dir: 1 }}
          vacio={<Vacio icono={Cake} titulo="Nadie cumple años en este periodo" />}
          barra={
            <>
              {vista === "mes" && (
                <div className="seg">
                  {MESES.map((m, i) => <button key={m} className={mes === i + 1 ? "on" : ""} onClick={() => setMes(i + 1)} style={{ padding: "0 9px" }}>{m[0].toUpperCase() + m.slice(1, 3)}</button>)}
                </div>
              )}
              <label className="fila peq muted" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={conHijos} onChange={(e) => setConHijos(e.target.checked)} /> Incluir hijos
              </label>
            </>
          }
          columnas={[
            { id: "dia", titulo: "Fecha", valor: (c) => c.fecha.slice(5), celda: (c) => <b>{diaMes(c.fecha)}</b> },
            { id: "faltan", titulo: "Faltan", valor: (c) => c.dias, celda: (c) => (c.dias === 0 ? <Badge tono="verde">Hoy</Badge> : `${c.dias} días`) },
            { id: "nombre", titulo: "Nombre", valor: (c) => c.nombre, celda: (c) => <div className="principal-celda"><Avatar nombre={c.nombre} /><div><b>{c.nombre}</b><small>{c.esHijo ? `Hijo(a) de ${c.padre}` : c.institucion}</small></div></div> },
            { id: "rel", titulo: "Relación", valor: (c) => (c.esHijo ? 1 : 0), celda: (c) => (c.esHijo ? <Badge tono="rosa">Hijo(a)</Badge> : <Badge tono="azul">Afiliado</Badge>) },
            { id: "edad", titulo: "Cumple", alinear: "der", valor: (c) => c.cumple, celda: (c) => `${c.cumple} años` },
            {
              id: "wa", titulo: "",
              celda: (c) => { const wa = mensajeWhatsApp(c); return wa ? <a className="btn btn-sm" href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><MessageCircle size={14} />Saludar</a> : <span className="vacio-celda peq">Sin celular</span>; },
            },
          ]}
        />
      </div>
      <Panel
        abierto={paso !== null && !!hoy[paso]}
        onCerrar={() => setPaso(null)}
        cabecera={<><h2>Saludar a los de hoy</h2><div className="muted peq">{paso !== null ? paso + 1 : 0} de {hoy.length}</div></>}
        pie={paso !== null && hoy[paso] && (
          <>
            <a className="btn btn-primario" href={mensajeWhatsApp(hoy[paso])!} target="_blank" rel="noreferrer"
              onClick={() => setTimeout(() => setPaso((x) => (x !== null && x + 1 < hoy.length ? x + 1 : x)), 400)}>
              <MessageCircle size={15} />Abrir WhatsApp
            </a>
            <button className="btn" disabled={paso === 0} onClick={() => setPaso(paso - 1)}><ChevronLeft size={15} />Anterior</button>
            <button className="btn" disabled={paso + 1 >= hoy.length} onClick={() => setPaso(paso + 1)}>Siguiente<ChevronRight size={15} /></button>
          </>
        )}
      >
        {paso !== null && hoy[paso] && (
          <div className="pila" style={{ alignItems: "center", textAlign: "center", paddingTop: 20 }}>
            <Avatar nombre={hoy[paso].nombre} grande />
            <div>
              <h2>{hoy[paso].nombre}</h2>
              <div className="muted">{hoy[paso].esHijo ? `Hijo(a) de ${hoy[paso].padre}` : hoy[paso].institucion} · cumple {hoy[paso].cumple} años</div>
            </div>
            <div className="burbuja ia burbuja-wa" style={{ maxWidth: "100%", textAlign: "left" }}>
              {decodeURIComponent(mensajeWhatsApp(hoy[paso])!.split("text=")[1])}
            </div>
            <p className="peq muted">Al tocar "Abrir WhatsApp" se abre el chat con el mensaje listo y aquí pasa a la siguiente persona.</p>
          </div>
        )}
      </Panel>
    </>
  );
}
