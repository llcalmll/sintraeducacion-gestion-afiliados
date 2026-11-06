import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { db } from "../datos/db";
import { vigente } from "../datos/hooks";
import { PAG_IBAGUE, PAG_TOLIMA, type Afiliado, type Hijo, type Resultado } from "../datos/tipos";
import { diasParaCumple, diaMes, MESES, nombrePeriodo } from "../logica/fechas";
import { normalizar } from "../logica/texto";

/*
 * Modo básico del asistente: entiende preguntas sencillas con reglas, sin IA.
 * Se usa cuando no hay clave de OpenAI o cuando la conexión falla.
 */

function Lista({ afiliados, detalle, enlace }: { afiliados: Afiliado[]; detalle?: (a: Afiliado) => ReactNode; enlace?: string }) {
  return (
    <>
      <ul>
        {afiliados.slice(0, 15).map((a) => (
          <li key={a.id}><Link to={`/afiliados/${a.id}`}>{a.nombre}</Link>{detalle && <span className="tenue"> · {detalle(a)}</span>}</li>
        ))}
      </ul>
      {afiliados.length > 15 && (enlace ? <Link to={enlace}>Ver los {afiliados.length}</Link> : <span className="tenue">Y {afiliados.length - 15} más.</span>)}
    </>
  );
}

export async function responderSinIA(pregunta: string, todos: Afiliado[], hijos: Map<number, Hijo[]>): Promise<ReactNode> {
  const q = normalizar(pregunta);
  const vigentes = todos.filter(vigente);

  const num = q.match(/\d{6,11}/)?.[0];
  if (num) {
    const a = todos.find((x) => x.cedula === num);
    return a ? <>La cédula {num} es de <Link to={`/afiliados/${a.id}`}>{a.nombre}</Link> ({a.pagador}).</> : <>No encontré la cédula {num} en la base.</>;
  }

  if (q.includes("CUMPLE")) {
    const mesN = MESES.findIndex((m) => q.includes(normalizar(m)));
    let lista: Afiliado[];
    let cuando: string;
    if (q.includes("HOY")) { lista = vigentes.filter((a) => diasParaCumple(a.fechaNacimiento) === 0); cuando = "hoy"; }
    else if (mesN >= 0 || q.includes("MES")) {
      const m = mesN >= 0 ? mesN + 1 : new Date().getMonth() + 1;
      lista = vigentes.filter((a) => a.fechaNacimiento && Number(a.fechaNacimiento.slice(5, 7)) === m);
      cuando = `en ${MESES[m - 1]}`;
    } else { lista = vigentes.filter((a) => (diasParaCumple(a.fechaNacimiento) ?? 99) <= 7); cuando = "en los próximos 7 días"; }
    lista.sort((a, b) => (diasParaCumple(a.fechaNacimiento) ?? 0) - (diasParaCumple(b.fechaNacimiento) ?? 0));
    return <>{lista.length} afiliados cumplen años {cuando}:<Lista afiliados={lista} detalle={(a) => diaMes(a.fechaNacimiento)} enlace="/cumpleanos" /></>;
  }

  const resultado: Resultado | null =
    q.includes("RETIRAD") && q.includes("DESCU") ? "retirado_con_descuento"
    : /NO LE DESCONTARON|SIN DESCUENTO|NO DESCONTARON|NO PAGARON|MOROSO/.test(q) ? "sin_descuento"
    : null;
  if (resultado) {
    const c = await db.cruces.orderBy("periodo").last();
    if (!c) return <>Todavía no hay cruces guardados. <Link to="/descuentos">Haga el primero</Link>.</>;
    const det = await db.cruceDetalle.where("cruceId").equals(c.id!).filter((d) => d.resultado === resultado).toArray();
    const lista = det.map((d) => todos.find((a) => a.id === d.afiliadoId)).filter((a): a is Afiliado => !!a);
    const titulo = resultado === "sin_descuento" ? "no tuvieron descuento" : "están retirados y aun así les descontaron";
    return <>En {nombrePeriodo(c.periodo)}, {lista.length} afiliados {titulo}:<Lista afiliados={lista} detalle={(a) => a.pagador} enlace={`/cruces/${c.id}?r=${resultado}`} /></>;
  }

  let lista = vigentes;
  const partes: string[] = [];
  const params = new URLSearchParams();
  if (q.includes("DOCENTE")) { lista = lista.filter((a) => a.tipo === "docente"); partes.push("docentes"); params.set("tipo", "docente"); }
  if (q.includes("ADMINISTRATIV")) { lista = lista.filter((a) => a.tipo === "administrativo"); partes.push("administrativos"); params.set("tipo", "administrativo"); }
  if (q.includes("TOLIMA") || q.includes("DEPARTAMENT")) { lista = lista.filter((a) => a.pagador === PAG_TOLIMA); partes.push("de la Secretaría del Tolima"); params.set("pagador", PAG_TOLIMA); }
  else if (q.includes("SECRETARIA") && q.includes("IBAGUE")) { lista = lista.filter((a) => a.pagador === PAG_IBAGUE); partes.push("de la Secretaría de Ibagué"); params.set("pagador", PAG_IBAGUE); }
  else if (q.includes("ALCALDIA")) { lista = lista.filter((a) => /^Alcald/i.test(a.pagador)); partes.push("de alcaldías"); }
  const municipios = [...new Set(vigentes.map((a) => normalizar(a.municipio)).filter((m) => m.length > 3))];
  const muni = municipios.find((m) => q.includes(m) && !(m === "IBAGUE" && q.includes("SECRETARIA")));
  if (muni) { lista = lista.filter((a) => normalizar(a.municipio) === muni); partes.push(`en ${muni}`); params.set("municipio", muni); }
  if (q.includes("HIJO")) {
    lista = lista.filter((a) => (hijos.get(a.id!) ?? []).length > 0);
    const n = lista.reduce((s, a) => s + (hijos.get(a.id!)?.length ?? 0), 0);
    return <>{lista.length} afiliados {partes.join(" ")} tienen hijos registrados ({n} hijos en total):<Lista afiliados={lista} detalle={(a) => `${hijos.get(a.id!)!.length} hijo(s)`} /></>;
  }
  if (partes.length) {
    const enlace = `/?${params}`;
    return q.includes("CUANT")
      ? <>Hay <b>{lista.length}</b> afiliados activos {partes.join(" ")}. <Link to={enlace}>Ver la lista</Link></>
      : <>{lista.length} afiliados activos {partes.join(" ")}:<Lista afiliados={lista} detalle={(a) => a.institucion || a.cargo} enlace={enlace} /></>;
  }
  if (q.includes("CUANT")) return <>Hay <b>{vigentes.length}</b> afiliados activos y {todos.length - vigentes.length} retirados o desvinculados.</>;

  const palabras = q.replace(/[¿?¡!.,]/g, "").split(" ").filter((w) => w.length > 2 && !["QUIEN", "BUSCA", "BUSCAR", "DATOS", "DONDE", "ESTA"].includes(w));
  const porNombre = todos.filter((a) => palabras.length > 0 && palabras.every((w) => normalizar(a.nombre).includes(w)));
  if (porNombre.length) return <>Encontré {porNombre.length} persona(s):<Lista afiliados={porNombre} detalle={(a) => a.pagador} /></>;
  return <>No entendí la pregunta. Pruebe con cumpleaños, descuentos, hijos, docentes, administrativos, un municipio, un nombre o una cédula.</>;
}
