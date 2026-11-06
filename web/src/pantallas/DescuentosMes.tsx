import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle, CalendarDays, CalendarRange, Check, CheckCircle2, Circle, CircleCheck, Download, FileSpreadsheet, MessageCircle, MessageSquareText, Phone, UserX,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MesAMes } from "../componentes/MesAMes";
import { Buscador, FiltroChip } from "../componentes/filtros";
import { TablaDatos } from "../componentes/TablaDatos";
import { Avatar, Badge, BadgeEntidad, Cabecera, Kpi, Panel, Pendiente, useUI, ZonaArchivo } from "../componentes/ui";
import { db } from "../datos/db";
import { useAfiliados } from "../datos/hooks";
import { enlaceWhatsApp, MENSAJE_POR_DEFECTO, ponerMensajeWhatsApp, primerNombre, useMensajeWhatsApp } from "../datos/preferencias";
import { useSesion } from "../datos/sesion";
import { ESTADOS_CONTACTO, FUENTES, nombreFuente, PAG_SIN_DEFINIR, RESULTADOS, type Afiliado, type CruceDetalle, type EstadoContacto, type Resultado } from "../datos/tipos";
import { FUENTES_ORDEN, registrarReportes } from "../logica/descuentosMes";
import { exportarContactos } from "../logica/exportar";
import { nombrePeriodo } from "../logica/fechas";
import { ArchivoConClave, leerReporte, type ReporteLeido } from "../logica/reportes";
import { ConfirmarReportePortal, type DatosPortal } from "../componentes/ConfirmarReportePortal";
import { PedirClave } from "../componentes/PedirClave";
import { contiene, esVacio, pesos } from "../logica/texto";

const celularLegible = (c: string) => {
  const d = c.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : c;
};

export default function DescuentosMes() {
  const afiliados = useAfiliados();
  const usuario = useSesion() ?? "";
  const { avisar, confirmar } = useUI();
  const mensaje = useMensajeWhatsApp();
  const cruces = useLiveQuery(() => db.cruces.orderBy("periodo").reverse().toArray(), []);
  const [elegido, setElegido] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const mesAMes = params.get("vista") === "mes";
  const periodo = elegido ?? cruces?.[0]?.periodo ?? null;
  const cruce = cruces?.find((c) => c.periodo === periodo);
  const detalle = useLiveQuery(() => (cruce ? db.cruceDetalle.where("cruceId").equals(cruce.id!).toArray() : []), [cruce?.id]) ?? [];
  const contactos = useLiveQuery(async () => new Map((periodo ? await db.contactos.where("periodo").equals(periodo).toArray() : []).map((c) => [c.cedula, c])), [periodo]);
  const porId = useMemo(() => new Map((afiliados ?? []).map((a) => [a.id!, a])), [afiliados]);
  const [cargando, setCargando] = useState(false);
  const [errores, setErrores] = useState<string[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<"" | EstadoContacto>("");
  const [q, setQ] = useState("");
  const [entidad, setEntidad] = useState("");
  const [editarMensaje, setEditarMensaje] = useState(false);
  const [revisar, setRevisar] = useState<Resultado>("retirado_con_descuento");

  const [pidiendoClave, setPidiendoClave] = useState<{ archivo: string; incorrecta: boolean; responder: (clave: string | null) => void } | null>(null);
  const pedirClave = (archivo: string, incorrecta: boolean) => new Promise<string | null>((resolver) => {
    setPidiendoClave({ archivo, incorrecta, responder: (clave) => { setPidiendoClave(null); resolver(clave); } });
  });

  const [confirmandoPortal, setConfirmandoPortal] = useState<{ reporte: ReporteLeido; mesAnterior?: string; responder: (d: DatosPortal | null) => void } | null>(null);
  const confirmarPortal = (reporte: ReporteLeido, mesAnterior?: string) => new Promise<DatosPortal | null>((resolver) => {
    setConfirmandoPortal({ reporte, mesAnterior, responder: (d) => { setConfirmandoPortal(null); resolver(d); } });
  });

  async function subir(archivos: File[]) {
    if (!archivos.length) return;
    setCargando(true);
    setErrores([]);
    const leidos = [];
    const errs: string[] = [];
    // La contraseña que sirvió se prueba primero con los demás archivos de esta subida; después se olvida.
    let claveBuena: string | undefined;
    // Si suben juntos los dos archivos de Ibagué, el segundo sugiere el mes que se confirmó en el primero.
    let mesConfirmado: string | undefined;
    for (const f of archivos) {
      try {
        let clave = claveBuena;
        let r;
        while (!r) {
          try {
            r = await leerReporte(f, clave);
            if (clave) claveBuena = clave;
          } catch (e) {
            if (!(e instanceof ArchivoConClave)) throw e;
            // Si falló la de otro archivo de esta subida, se pregunta sin decir que está mal.
            const escrita = await pedirClave(f.name, e.motivo === "incorrecta" && clave !== claveBuena);
            if (escrita === null) break;
            clave = escrita;
          }
        }
        if (!r) { errs.push(`"${f.name}" no se cargó: falta la contraseña del archivo.`); continue; }
        if (r.sinEncabezado && r.lineas.length) {
          const datos = await confirmarPortal(r, mesConfirmado);
          if (!datos) { errs.push(`"${f.name}" no se cargó: falta confirmar el mes y qué archivo es.`); continue; }
          mesConfirmado = datos.periodo;
          r = { ...r, periodo: datos.periodo, fuente: datos.fuente };
        }
        if (!r.periodo) { errs.push(`"${f.name}" no dice de qué mes es: no se cargó. Revise que sea el reporte completo que envía la entidad.`); continue; }
        if (!r.lineas.length) { errs.push(`"${f.name}" no trae ningún descuento: no se cargó.`); continue; }
        errs.push(...r.advertencias.map((w) => `${f.name}: ${w}`));
        leidos.push(r);
      } catch (e) { errs.push(e instanceof Error ? e.message : String(e)); }
    }
    if (leidos.length) {
      const meses = await registrarReportes(leidos, usuario);
      setElegido(meses[meses.length - 1]);
      avisar(`Listo: ${leidos.map((l) => nombreFuente(l.fuente)).join(", ")}`);
    }
    setErrores(errs);
    setCargando(false);
  }

  const estadoDe = (ced: string): EstadoContacto => contactos?.get(ced)?.estado ?? "pendiente";
  const notaDe = (ced: string) => contactos?.get(ced)?.nota ?? "";
  // Lee el registro guardado dentro de la transacción: si se cambia el estado y enseguida la nota,
  // la segunda escritura no pisa la primera con datos viejos de la pantalla.
  const guardarContacto = (ced: string, cambios: { estado?: EstadoContacto; nota?: string }) =>
    db.transaction("rw", db.contactos, async () => {
      const prev = await db.contactos.get([periodo!, ced]);
      await db.contactos.put({
        periodo: periodo!, cedula: ced, estado: cambios.estado ?? prev?.estado ?? "pendiente",
        nota: cambios.nota ?? prev?.nota ?? "", actualizadoEn: new Date().toISOString(),
      });
    });

  /** Cambia el estado de varias personas de una vez (por ejemplo, cuando pagaduría arregla todo el mes). */
  const cambiarVarios = async (cedulas: string[], estado: EstadoContacto) => {
    await db.transaction("rw", db.contactos, async () => {
      const ahora = new Date().toISOString();
      for (const ced of cedulas) {
        const prev = await db.contactos.get([periodo!, ced]);
        if (prev?.estado === estado) continue;
        await db.contactos.put({ periodo: periodo!, cedula: ced, estado, nota: prev?.nota ?? "", actualizadoEn: ahora });
      }
    });
    avisar(`${cedulas.length === 1 ? "1 persona quedó" : `${cedulas.length} personas quedaron`} en "${ESTADOS_CONTACTO[estado].titulo}"`);
  };
  const confirmarVarios = async (cedulas: string[], estado: EstadoContacto, alcance: string) => {
    if (!cedulas.length) return;
    const ok = await confirmar({
      titulo: `Marcar ${cedulas.length === 1 ? "1 persona" : `${cedulas.length} personas`} como "${ESTADOS_CONTACTO[estado].titulo}"`,
      texto: `${alcance} ${ESTADOS_CONTACTO[estado].ayuda.toLowerCase()}. Las notas de cada persona se conservan y se puede volver a cambiar cuando quiera.`,
      boton: `Marcar como ${ESTADOS_CONTACTO[estado].titulo.toLowerCase()}`,
    });
    if (ok) await cambiarVarios(cedulas, estado);
  };

  const sinDescuento = detalle.filter((d) => d.resultado === "sin_descuento");
  const contadas = { pendiente: 0, contactada: 0, resuelto: 0 };
  sinDescuento.forEach((d) => contadas[estadoDe(d.cedula)]++);
  const lista = sinDescuento.filter((d) => {
    const a = d.afiliadoId ? porId.get(d.afiliadoId) : undefined;
    if (filtroEstado && estadoDe(d.cedula) !== filtroEstado) return false;
    if (entidad && a?.pagador !== entidad) return false;
    if (q && !(contiene(a?.nombre ?? d.nombre, q) || d.cedula.includes(q))) return false;
    return true;
  });
  const entidades = [...new Set(sinDescuento.map((d) => (d.afiliadoId ? porId.get(d.afiliadoId)?.pagador : "") ?? ""))].filter(Boolean);
  const otras = useMemo(
    () => [...new Set((afiliados ?? []).map((a) => a.pagador))].filter((p) => p !== PAG_SIN_DEFINIR && !Object.values(FUENTES).some((f) => f.pagador === p)),
    [afiliados],
  );

  function textoMensaje(a: Afiliado | undefined, d: CruceDetalle) {
    return mensaje.replaceAll("{nombre}", primerNombre(a?.nombre ?? d.nombre)).replaceAll("{mes}", nombrePeriodo(periodo!));
  }

  if (afiliados === undefined || cruces === undefined) return null;

  const zona = (
    <>
      <ZonaArchivo
        acepta=".xls,.xlsx,.pdf"
        multiple
        onArchivos={subir}
        titulo={cargando ? "Revisando los archivos…" : "Suelte aquí el Excel de descuentos del mes"}
        ayuda="Puede soltar los tres archivos juntos (Ibagué, Tolima y Alcaldía) o de a uno. La app reconoce cada uno sola."
      />
      {pidiendoClave && <PedirClave {...pidiendoClave} />}
      {confirmandoPortal && <ConfirmarReportePortal {...confirmandoPortal} />}
    </>
  );

  if (!cruce) {
    return (
      <>
        <Cabecera titulo="Descuentos del mes" sub="Suba el archivo que llega cada mes y aquí aparece a quién no le descontaron." />
        <div className="contenido">
          <div className="card" style={{ maxWidth: 760, margin: "40px auto", width: "100%" }}>
            <div className="card-cuerpo pila" style={{ padding: 28 }}>
              <div style={{ textAlign: "center" }}>
                <span className="avatar lg" style={{ background: "var(--primario-suave)", color: "var(--primario)", margin: "0 auto 10px" }}><FileSpreadsheet size={26} /></span>
                <h2 style={{ fontSize: 18 }}>Empecemos con el archivo del mes</h2>
                <p className="muted">En segundos le mostramos a quién no le hicieron el descuento, con su celular para contactarla.</p>
              </div>
              {zona}
              {errores.map((e) => <div key={e} className="aviso error">{e}</div>)}
            </div>
          </div>
        </div>
      </>
    );
  }

  const fuentesCargadas = new Set(cruce.fuentes.map((f) => f.fuente));
  const revisables: Resultado[] = ["retirado_con_descuento", "no_en_base", "pendiente_novedad", "novedad_demorada"];
  const porNovedad = revisar === "pendiente_novedad" || revisar === "novedad_demorada";
  const filasRevisar = detalle.filter((d) => d.resultado === revisar);

  return (
    <>
      <Cabecera titulo="Descuentos del mes" sub={mesAMes ? "Registro de cada mes: a quién se le descontó y a quién no." : "Suba el archivo que llega cada mes y aquí aparece a quién no le descontaron."}>
        <div className="seg">
          <button className={mesAMes ? "" : "on"} onClick={() => setParams({}, { replace: true })}><CalendarDays size={14} />Este mes</button>
          <button className={mesAMes ? "on" : ""} onClick={() => setParams({ vista: "mes" }, { replace: true })}><CalendarRange size={14} />Mes a mes</button>
        </div>
        {mesAMes ? null : cruces.length > 1 ? (
          <select className="select" style={{ width: 200 }} value={periodo!} onChange={(e) => setElegido(e.target.value)} aria-label="Mes">
            {cruces.map((c) => <option key={c.periodo} value={c.periodo}>{nombrePeriodo(c.periodo)}</option>)}
          </select>
        ) : (
          <Badge tono="azul">{nombrePeriodo(periodo!)}</Badge>
        )}
        {!mesAMes && <button className="btn" onClick={() => setEditarMensaje(true)}><MessageSquareText size={15} />Mensaje de WhatsApp</button>}
      </Cabecera>

      {mesAMes ? (
        <div className="contenido"><MesAMes onVerMes={(p) => { setElegido(p); setParams({}, { replace: true }); }} /></div>
      ) : (
      <div className="contenido">
        <div className="card">
          <div className="card-cuerpo" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1fr)", gap: 16, alignItems: "center" }}>
            {zona}
            <div className="pila" style={{ gap: 8 }}>
              <b className="peq muted">Archivos de <span className="mayus">{nombrePeriodo(periodo!)}</span></b>
              {FUENTES_ORDEN.map((f) => {
                const r = cruce.fuentes.find((x) => x.fuente === f);
                return (
                  <div key={f} className="fila">
                    {fuentesCargadas.has(f) ? <CheckCircle2 size={17} color="var(--verde)" /> : <Circle size={17} color="var(--borde-2)" />}
                    <span style={{ flex: 1 }}>{FUENTES[f].pagador}</span>
                    <span className="peq tenue">{r ? `${r.lineas} registros` : "Falta"}</span>
                  </div>
                );
              })}
              {(() => {
                // Planta central: aparece si ya se cargó, o si Ibagué se bajó del portal y ese archivo llega aparte.
                const central = cruce.fuentes.find((x) => x.fuente === "SEM_IBAGUE_CENTRAL");
                if (!central && !cruce.fuentes.some((x) => x.fuente === "SEM_IBAGUE" && x.sinPlantaCentral)) return null;
                return (
                  <div className="fila">
                    {central ? <CheckCircle2 size={17} color="var(--verde)" /> : <Circle size={17} color="var(--borde-2)" />}
                    <span style={{ flex: 1 }} title="Mientras falte este archivo, las personas de planta central salen como no descontadas.">{nombreFuente("SEM_IBAGUE_CENTRAL")}</span>
                    <span className="peq tenue">{central ? `${central.lineas} registros` : "Falta"}</span>
                  </div>
                );
              })()}
            </div>
          </div>
          {errores.length > 0 && <div className="card-pie">{errores.map((e) => <div key={e} className="aviso error">{e}</div>)}</div>}
        </div>

        <div className="kpis">
          <Kpi icono={UserX} tono="rojo" valor={sinDescuento.length} etiqueta="No les descontaron" />
          <Kpi icono={Check} tono="ambar" valor={`${contadas.contactada + contadas.resuelto} de ${sinDescuento.length}`} etiqueta="Ya contactadas o resueltas" />
          <Kpi icono={CircleCheck} tono="verde" valor={cruce.totales.descontado ?? 0} etiqueta="Descontadas correctamente" />
          <Kpi icono={AlertTriangle} tono="ambar" valor={revisables.reduce((s, r) => s + (cruce.totales[r] ?? 0), 0)} etiqueta="Casos para revisar" />
        </div>

        <div className="pila" style={{ gap: 10 }}>
          <Seguimiento
            contadas={contadas} total={sinDescuento.length} periodo={periodo!} filtro={filtroEstado} onFiltro={setFiltroEstado}
            visibles={lista.length} filtrada={lista.length !== sinDescuento.length}
            onTodas={(e) => confirmarVarios(lista.map((d) => d.cedula), e, lista.length === sinDescuento.length ? "Todas las personas sin descuento de este mes quedan como:" : "Las personas que se ven en la lista (con el filtro puesto) quedan como:")}
          />
          <TablaDatos
            idGuardado="contactar"
            filas={lista}
            clave={(d) => d.cedula}
            ordenInicial={{ id: "nombre", dir: 1 }}
            marca={(d) => ({ pendiente: "rojo", contactada: "ambar", resuelto: "verde" } as const)[estadoDe(d.cedula)]}
            seleccionable
            accionesSeleccion={(sel, limpiar) => (
              <div className="fila" style={{ gap: 6 }}>
                <span className="peq muted">Marcar como:</span>
                {ORDEN_ESTADOS.map((e) => (
                  <button key={e} className={`btn btn-sm boton-estado ${ESTADOS_CONTACTO[e].tono}`}
                    onClick={async () => { await confirmarVarios(sel.map((d) => d.cedula), e, "Las personas seleccionadas quedan como:"); limpiar(); }}>
                    <span className="punto-estado" />{ESTADOS_CONTACTO[e].titulo}
                  </button>
                ))}
              </div>
            )}
            barra={
              <>
                <div className="seg">
                  <button className={filtroEstado === "" ? "on" : ""} onClick={() => setFiltroEstado("")}>Todas <span className="cuenta">{sinDescuento.length}</span></button>
                  {(Object.keys(ESTADOS_CONTACTO) as EstadoContacto[]).map((e) => (
                    <button key={e} className={filtroEstado === e ? "on" : ""} onClick={() => setFiltroEstado(e)}>{ESTADOS_CONTACTO[e].titulo} <span className="cuenta">{contadas[e]}</span></button>
                  ))}
                </div>
                <Buscador valor={q} onCambio={setQ} placeholder="Buscar nombre o cédula" ancho={220} />
                {entidades.length > 1 && <FiltroChip etiqueta="Entidad" valor={entidad} opciones={entidades.map((e) => ({ v: e, t: e }))} onCambio={setEntidad} />}
              </>
            }
            barraDerecha={
              <button className="btn btn-sm" onClick={() => exportarContactos(periodo!, lista.map((d) => ({ d, a: d.afiliadoId ? porId.get(d.afiliadoId) : undefined, estado: ESTADOS_CONTACTO[estadoDe(d.cedula)].titulo, nota: notaDe(d.cedula) })))}>
                <Download size={14} />Descargar lista
              </button>
            }
            columnas={[
              {
                id: "nombre", titulo: "Nombre", fija: true, valor: (d) => (d.afiliadoId ? porId.get(d.afiliadoId)?.nombre : d.nombre) ?? d.nombre,
                celda: (d) => {
                  const a = d.afiliadoId ? porId.get(d.afiliadoId) : undefined;
                  return (
                    <div className="principal-celda">
                      <Avatar nombre={a?.nombre ?? d.nombre} />
                      <div><Link to={`/afiliados/${a?.id}`} style={{ color: "var(--texto)" }}><b>{a?.nombre ?? d.nombre}</b></Link><small>C.C. {d.cedula}</small></div>
                    </div>
                  );
                },
              },
              {
                id: "estado", titulo: "Estado", valor: (d) => ["pendiente", "contactada", "resuelto"].indexOf(estadoDe(d.cedula)),
                celda: (d) => <Luces estado={estadoDe(d.cedula)} onCambio={(e) => guardarContacto(d.cedula, { estado: e })} />,
              },
              { id: "entidad", titulo: "Entidad", valor: (d) => porId.get(d.afiliadoId!)?.pagador ?? "", celda: (d) => <BadgeEntidad p={porId.get(d.afiliadoId!)?.pagador ?? ""} corta /> },
              { id: "inst", titulo: "Institución", valor: (d) => porId.get(d.afiliadoId!)?.institucion ?? "", celda: (d) => porId.get(d.afiliadoId!)?.institucion },
              {
                id: "cel", titulo: "Celular", valor: (d) => porId.get(d.afiliadoId!)?.celular ?? "",
                celda: (d) => { const c = porId.get(d.afiliadoId!)?.celular ?? ""; return esVacio(c) ? <span className="vacio-celda">Sin celular</span> : celularLegible(c); },
              },
              {
                id: "contactar", titulo: "Contactar",
                celda: (d) => {
                  const a = d.afiliadoId ? porId.get(d.afiliadoId) : undefined;
                  const wa = enlaceWhatsApp(a?.celular ?? "", textoMensaje(a, d));
                  const tel = (a?.celular ?? "").replace(/\D/g, "");
                  return (
                    <div className="fila" style={{ gap: 6 }}>
                      {wa ? (
                        <a className="btn btn-sm btn-wa" href={wa} target="_blank" rel="noreferrer"
                          onClick={() => {
                            if (estadoDe(d.cedula) !== "pendiente") return;
                            guardarContacto(d.cedula, { estado: "contactada" });
                            avisar("Marcada como contactada (amarillo)");
                          }}>
                          <MessageCircle size={14} />WhatsApp
                        </a>
                      ) : <span className="vacio-celda peq">Sin WhatsApp</span>}
                      {tel.length >= 7 && <a className="btn btn-sm btn-icono" href={`tel:${tel}`} title="Llamar"><Phone size={14} /></a>}
                    </div>
                  );
                },
              },
              {
                id: "nota", titulo: "Nota",
                celda: (d) => (
                  <input
                    className="input"
                    style={{ height: 30, width: 220 }}
                    placeholder="Ej. dice que ya habló con pagaduría"
                    defaultValue={notaDe(d.cedula)}
                    key={notaDe(d.cedula)}
                    onBlur={(e) => e.target.value !== notaDe(d.cedula) && guardarContacto(d.cedula, { nota: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                ),
              },
              { id: "obs", titulo: "Observaciones", oculta: true, celda: (d) => <span title={porId.get(d.afiliadoId!)?.observaciones}>{porId.get(d.afiliadoId!)?.observaciones}</span> },
            ]}
          />
          {otras.length > 0 && <Pendiente>un reporte de muestra de {otras.join(", ")}. Hoy sus afiliados no se pueden revisar.</Pendiente>}
        </div>

        <div className="card">
          <div className="card-cab"><AlertTriangle size={16} color="var(--ambar)" /><h3>Casos para revisar</h3><Link className="accion peq" to={`/cruces/${cruce.id}`}>Ver el detalle completo del mes</Link></div>
          <div className="tabs" style={{ padding: "0 8px" }}>
            {revisables.map((r) => (
              <button key={r} className={revisar === r ? "on" : ""} onClick={() => setRevisar(r)}>{RESULTADOS[r].titulo}<span className="cuenta">{cruce.totales[r] ?? 0}</span></button>
            ))}
          </div>
          <div className="card-cuerpo pila" style={{ gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>
              {revisar === "retirado_con_descuento" && "Están como retirados o desvinculados, pero la nómina les sigue descontando. Hay que confirmar si se retiraron y pedir la devolución o la novedad de retiro."}
              {revisar === "no_en_base" && "La nómina les descuenta para el sindicato, pero no están en la base. Puede ser una afiliación que falta registrar."}
              {revisar === "pendiente_novedad" && "Su afiliación se pidió hace poco; es normal que el descuento todavía no aparezca."}
              {revisar === "novedad_demorada" && "Pidieron la afiliación hace más de 2 meses y el descuento todavía no aparece. Puede que la hayan aplazado, así que no hace falta insistirles. Si ya no se va a hacer, cámbienle el estado en su ficha; si ya debía estar, revísenlo con la entidad."}
            </p>
            {filasRevisar.length === 0 ? <span className="muted">Nadie en este grupo.</span> : (
              <div className="tabla-ajuste">
                <table className="tbl">
                  <thead><tr><th>Nombre</th><th>Cédula</th><th>Entidad</th>{porNovedad ? <th>Afiliación pedida</th> : <th className="num">Valor descontado</th>}<th>Observaciones</th></tr></thead>
                  <tbody>
                    {filasRevisar.map((d) => {
                      const a = d.afiliadoId ? porId.get(d.afiliadoId) : undefined;
                      return (
                        <tr key={d.cedula}>
                          <td>{a ? <Link to={`/afiliados/${a.id}`}><b>{a.nombre}</b></Link> : <b>{d.nombre}</b>}</td>
                          <td>{d.cedula}</td>
                          <td><BadgeEntidad p={a?.pagador ?? (d.fuente ? FUENTES[d.fuente].pagador : "")} corta /></td>
                          {porNovedad ? <td>{a?.novedadPeriodo ? nombrePeriodo(a.novedadPeriodo) : ""}</td> : <td className="num">{d.valor ? pesos(d.valor) : ""}</td>}
                          <td title={a?.observaciones}>{a?.observaciones}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      <MensajeWhatsApp abierto={editarMensaje} onCerrar={() => setEditarMensaje(false)} actual={mensaje} periodo={periodo!} />
    </>
  );
}

function MensajeWhatsApp({ abierto, onCerrar, actual, periodo }: { abierto: boolean; onCerrar: () => void; actual: string; periodo: string }) {
  const [texto, setTexto] = useState(actual);
  const [antes, setAntes] = useState(false);
  const { avisar } = useUI();
  if (abierto !== antes) { setAntes(abierto); if (abierto) setTexto(actual); }
  const ejemplo = texto.replaceAll("{nombre}", "Carmen").replaceAll("{mes}", nombrePeriodo(periodo));
  return (
    <Panel
      abierto={abierto}
      onCerrar={onCerrar}
      cabecera={<><h2>Mensaje de WhatsApp</h2><div className="muted peq">Es el texto que se abre al tocar "WhatsApp" en la lista.</div></>}
      pie={<>
        <button className="btn btn-primario" onClick={() => { ponerMensajeWhatsApp(texto); avisar("Mensaje guardado"); onCerrar(); }}>Guardar mensaje</button>
        <button className="btn" onClick={() => setTexto(MENSAJE_POR_DEFECTO)}>Volver al mensaje original</button>
      </>}
    >
      <div>
        <label className="etq">Mensaje</label>
        <textarea className="input" rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div className="ayuda">Escriba <b>{"{nombre}"}</b> donde va el nombre de la persona y <b>{"{mes}"}</b> donde va el mes.</div>
      </div>
      <div>
        <label className="etq">Así se verá</label>
        <div className="burbuja ia burbuja-wa" style={{ maxWidth: "100%" }}>{ejemplo}</div>
      </div>
    </Panel>
  );
}

/* ───────────────────────── seguimiento del mes (rojo, amarillo, verde) ───────────────────────── */

const ORDEN_ESTADOS: EstadoContacto[] = ["pendiente", "contactada", "resuelto"];

function Seguimiento({ contadas, total, periodo, filtro, onFiltro, visibles, filtrada, onTodas }: {
  contadas: Record<EstadoContacto, number>; total: number; periodo: string; filtro: "" | EstadoContacto; onFiltro: (e: "" | EstadoContacto) => void;
  visibles: number; filtrada: boolean; onTodas: (e: EstadoContacto) => void;
}) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const pendientes = contadas.pendiente;
  return (
    <div className="card semaforo">
      {total === 0 ? (
        <div className="semaforo-aviso verde"><CircleCheck size={20} /><div><b>A nadie le faltó el descuento en {nombrePeriodo(periodo)}.</b></div></div>
      ) : pendientes > 0 ? (
        <div className="semaforo-aviso rojo">
          <UserX size={20} />
          <div style={{ flex: 1 }}>
            <b>{pendientes === 1 ? "Hay 1 persona por contactar" : `Hay ${pendientes} personas por contactar`}</b>
            <div className="peq">No les apareció el descuento de {nombrePeriodo(periodo)}. Escríbales por WhatsApp o llámelas: al hacerlo pasan a amarillo.</div>
          </div>
          {filtro !== "pendiente" && <button className="btn btn-sm btn-rojo" onClick={() => onFiltro("pendiente")}>Ver solo las que faltan</button>}
        </div>
      ) : contadas.contactada > 0 ? (
        <div className="semaforo-aviso ambar">
          <Check size={20} />
          <div style={{ flex: 1 }}>
            <b>Todas fueron contactadas. Faltan {contadas.contactada} por resolver.</b>
            <div className="peq">Cuando se arregle el descuento de cada una, márquela en verde.</div>
          </div>
        </div>
      ) : (
        <div className="semaforo-aviso verde"><CircleCheck size={20} /><div><b>El mes está al día: los {total} casos están resueltos.</b></div></div>
      )}

      <div className="semaforo-cajas">
        {ORDEN_ESTADOS.map((e) => (
          <button key={e} className={`semaforo-caja ${ESTADOS_CONTACTO[e].tono} ${filtro === e ? "on" : ""}`} onClick={() => onFiltro(filtro === e ? "" : e)} title={filtro === e ? "Ver todas" : `Ver solo: ${ESTADOS_CONTACTO[e].titulo}`}>
            <span className="luz-grande" />
            <span>
              <span className="numero">{contadas[e]}</span>
              <span className="titulo">{ESTADOS_CONTACTO[e].titulo}</span>
              <span className="ayuda">{ESTADOS_CONTACTO[e].ayuda}</span>
            </span>
          </button>
        ))}
      </div>

      {total > 0 && (
        <div className="semaforo-todas">
          <span className="peq muted">{filtrada ? `Cambiar las ${visibles} de la lista (con el filtro puesto):` : `Cambiar las ${visibles} de una vez:`}</span>
          {ORDEN_ESTADOS.map((e) => (
            <button key={e} className={`btn btn-sm boton-estado ${ESTADOS_CONTACTO[e].tono}`} disabled={!visibles} onClick={() => onTodas(e)}>
              <span className="punto-estado" />{({ pendiente: "Todas por contactar", contactada: "Todas contactadas", resuelto: "Todas resueltas" } as const)[e]}
            </button>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="semaforo-barra" title={`${contadas.resuelto} resueltas, ${contadas.contactada} contactadas, ${pendientes} por contactar`}>
          <div className="verde" style={{ width: `${pct(contadas.resuelto)}%` }} />
          <div className="ambar" style={{ width: `${pct(contadas.contactada)}%` }} />
          <div className="rojo" style={{ width: `${pct(pendientes)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Tres luces para cambiar el estado con un clic. */
function Luces({ estado, onCambio }: { estado: EstadoContacto; onCambio: (e: EstadoContacto) => void }) {
  return (
    <div className="luces" role="radiogroup" aria-label="Estado del contacto" onClick={(e) => e.stopPropagation()}>
      {ORDEN_ESTADOS.map((e) => (
        <button
          key={e}
          role="radio"
          aria-checked={estado === e}
          className={`luz ${ESTADOS_CONTACTO[e].tono} ${estado === e ? "on" : ""}`}
          title={`${ESTADOS_CONTACTO[e].titulo}: ${ESTADOS_CONTACTO[e].ayuda}`}
          onClick={() => estado !== e && onCambio(e)}
        />
      ))}
      <span className={`luces-texto ${ESTADOS_CONTACTO[estado].tono}`}>{ESTADOS_CONTACTO[estado].titulo}</span>
    </div>
  );
}
