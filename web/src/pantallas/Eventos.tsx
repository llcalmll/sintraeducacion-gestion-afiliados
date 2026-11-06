import { useLiveQuery } from "dexie-react-hooks";
import { CalendarCheck, CalendarPlus, Download, FileText, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Buscador, FiltroChip } from "../componentes/filtros";
import { TablaDatos } from "../componentes/TablaDatos";
import { Avatar, Badge, BadgeEntidad, Cabecera, Kpi, Panel, useUI, Vacio } from "../componentes/ui";
import { db } from "../datos/db";
import { useAfiliados, vigente } from "../datos/hooks";
import type { Afiliado, Evento } from "../datos/tipos";
import { fechaLarga, hoyISO } from "../logica/fechas";
import { exportarAsistenciaExcel } from "../logica/exportar";
import { planillaAsistenciaPDF } from "../logica/pdf";
import { contiene } from "../logica/texto";

export default function Eventos() {
  const id = useParams().id;
  const afiliados = useAfiliados();
  if (afiliados === undefined) return null;
  return id ? <DetalleEvento id={Number(id)} afiliados={afiliados} /> : <ListaEventos />;
}

function ListaEventos() {
  const eventos = useLiveQuery(() => db.eventos.orderBy("fecha").reverse().toArray(), []) ?? [];
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [nuevo, setNuevo] = useState({ nombre: "", fecha: hoyISO(), lugar: "", descripcion: "" });
  const abierto = params.get("nuevo") === "1";
  const cerrar = () => setParams({}, { replace: true });

  return (
    <>
      <Cabecera migas={[{ t: "Comunidad" }, { t: "Eventos" }]} titulo="Eventos y asistencia" sub="Cree un evento, elija a quién invitar y descargue la planilla para firmar.">
        <button className="btn btn-primario" onClick={() => setParams({ nuevo: "1" })}><CalendarPlus size={15} />Nuevo evento</button>
      </Cabecera>
      <div className="contenido">
        <TablaDatos
          filas={eventos}
          clave={(e) => e.id!}
          onFila={(e) => nav(`/eventos/${e.id}`)}
          ordenInicial={{ id: "fecha", dir: -1 }}
          vacio={<Vacio icono={CalendarCheck} titulo="Todavía no hay eventos"><button className="btn btn-sm" onClick={() => setParams({ nuevo: "1" })}>Crear el primero</button></Vacio>}
          columnas={[
            { id: "nombre", titulo: "Evento", valor: (e) => e.nombre, celda: (e) => <div className="principal-celda"><span className="avatar" style={{ background: "var(--azul-s)", color: "var(--azul)" }}><CalendarCheck size={15} /></span><div><b>{e.nombre}</b><small>{e.lugar}</small></div></div> },
            { id: "fecha", titulo: "Fecha", valor: (e) => e.fecha, celda: (e) => fechaLarga(e.fecha) },
            { id: "inv", titulo: "Invitados", alinear: "der", valor: (e) => e.invitados.length, celda: (e) => e.invitados.length },
            { id: "asis", titulo: "Asistieron", alinear: "der", valor: (e) => e.asistentes.length, celda: (e) => e.asistentes.length },
            { id: "pct", titulo: "Asistencia", valor: (e) => (e.invitados.length ? e.asistentes.length / e.invitados.length : 0), celda: (e) => {
              const p = e.invitados.length ? Math.round((e.asistentes.length / e.invitados.length) * 100) : 0;
              return <div className="fila" style={{ width: 160 }}><div style={{ flex: 1, height: 6, background: "var(--gris-s)", borderRadius: 3 }}><div style={{ width: `${p}%`, height: 6, background: "var(--primario)", borderRadius: 3 }} /></div><span className="peq">{p}%</span></div>;
            } },
          ]}
        />
      </div>
      <Panel
        abierto={abierto}
        onCerrar={cerrar}
        cabecera={<h2>Nuevo evento</h2>}
        pie={<>
          <button className="btn btn-primario" disabled={!nuevo.nombre.trim()} onClick={async () => {
            const id = await db.eventos.add({ ...nuevo, invitados: [], asistentes: [], creadoEn: new Date().toISOString() });
            nav(`/eventos/${id}`);
          }}>Crear y elegir invitados</button>
          <button className="btn" onClick={cerrar}>Cancelar</button>
        </>}
      >
        <div className="rejilla" style={{ gridTemplateColumns: "1fr" }}>
          <div><label className="etq">Nombre</label><input className="input" autoFocus value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Ej. Asamblea general" /></div>
          <div><label className="etq">Fecha</label><input className="input" type="date" value={nuevo.fecha} onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })} /></div>
          <div><label className="etq">Lugar</label><input className="input" value={nuevo.lugar} onChange={(e) => setNuevo({ ...nuevo, lugar: e.target.value })} /></div>
          <div><label className="etq">Descripción</label><textarea className="input" rows={3} value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} /></div>
        </div>
      </Panel>
    </>
  );
}

function DetalleEvento({ id, afiliados }: { id: number; afiliados: Afiliado[] }) {
  const ev = useLiveQuery(() => db.eventos.get(id), [id]);
  const [agregar, setAgregar] = useState(false);
  const [filtro, setFiltro] = useState({ pagador: "", tipo: "", q: "" });
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { confirmar, avisar } = useUI();
  const porId = useMemo(() => new Map(afiliados.map((a) => [a.id!, a])), [afiliados]);
  const vigentes = useMemo(() => afiliados.filter(vigente), [afiliados]);

  if (ev === undefined) return null;
  if (!ev) return <div className="contenido"><Vacio titulo="No se encontró el evento"><Link to="/eventos">Volver</Link></Vacio></div>;

  const invitados = ev.invitados.map((i) => porId.get(i)).filter((a): a is Afiliado => !!a).filter((a) => !q || contiene(a.nombre, q) || (a.cedula ?? "").includes(q));
  const candidatos = vigentes.filter((a) =>
    !ev.invitados.includes(a.id!) && (!filtro.pagador || a.pagador === filtro.pagador) && (!filtro.tipo || a.tipo === filtro.tipo) &&
    (!filtro.q || contiene(a.nombre, filtro.q) || (a.cedula ?? "").includes(filtro.q) || contiene(a.institucion, filtro.q)));
  const guardar = (c: Partial<Evento>) => db.eventos.update(id, c);
  const todosInv = ev.invitados.map((i) => porId.get(i)).filter((a): a is Afiliado => !!a).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const pct = ev.invitados.length ? Math.round((ev.asistentes.length / ev.invitados.length) * 100) : 0;

  return (
    <>
      <Cabecera migas={[{ t: "Eventos", a: "/eventos" }, { t: ev.nombre }]} titulo={ev.nombre} sub={`${fechaLarga(ev.fecha)}${ev.lugar ? " · " + ev.lugar : ""}`}>
        <button className="btn" disabled={!todosInv.length} onClick={() => planillaAsistenciaPDF(ev, todosInv)}><FileText size={15} />Planilla PDF</button>
        <button className="btn" disabled={!todosInv.length} onClick={() => exportarAsistenciaExcel(ev, todosInv)}><Download size={15} />Excel</button>
        <button className="btn btn-peligro btn-icono" title="Borrar evento" onClick={async () => {
          if (await confirmar({ titulo: `Borrar "${ev.nombre}"`, boton: "Borrar", peligro: true })) { await db.eventos.delete(id); avisar("Evento borrado"); nav("/eventos"); }
        }}><Trash2 size={15} /></button>
        <button className="btn btn-primario" onClick={() => setAgregar(true)}><UserPlus size={15} />Agregar invitados</button>
      </Cabecera>
      <div className="contenido">
        {ev.descripcion && <div className="aviso info">{ev.descripcion}</div>}
        <div className="kpis">
          <Kpi icono={UserPlus} tono="azul" valor={ev.invitados.length} etiqueta="Invitados" />
          <Kpi icono={CalendarCheck} tono="verde" valor={ev.asistentes.length} etiqueta="Asistieron" />
          <Kpi icono={UserMinus} tono="gris" valor={`${pct}%`} etiqueta="Asistencia" />
        </div>
        <TablaDatos
          idGuardado="evento"
          filas={invitados}
          clave={(a) => a.id!}
          ordenInicial={{ id: "nombre", dir: 1 }}
          seleccionable
          vacio={<Vacio titulo="Sin invitados todavía"><button className="btn btn-sm" onClick={() => setAgregar(true)}>Agregar invitados</button></Vacio>}
          barra={<Buscador valor={q} onCambio={setQ} placeholder="Buscar invitado" />}
          accionesSeleccion={(sel, limpiar) => (
            <>
              <button className="btn btn-sm" onClick={() => { guardar({ asistentes: [...new Set([...ev.asistentes, ...sel.map((a) => a.id!)])] }); limpiar(); }}>Marcar asistencia</button>
              <button className="btn btn-sm" onClick={() => { guardar({ asistentes: ev.asistentes.filter((x) => !sel.some((a) => a.id === x)) }); limpiar(); }}>Quitar asistencia</button>
              <button className="btn btn-sm btn-peligro" onClick={() => { const ids = new Set(sel.map((a) => a.id)); guardar({ invitados: ev.invitados.filter((x) => !ids.has(x)), asistentes: ev.asistentes.filter((x) => !ids.has(x)) }); limpiar(); avisar(`${sel.length} invitados quitados`); }}>Quitar del evento</button>
            </>
          )}
          columnas={[
            { id: "nombre", titulo: "Invitado", fija: true, valor: (a) => a.nombre, celda: (a) => <div className="principal-celda"><Avatar nombre={a.nombre} /><div><b>{a.nombre}</b><small>C.C. {a.cedula}</small></div></div> },
            { id: "entidad", titulo: "Entidad", valor: (a) => a.pagador, celda: (a) => <BadgeEntidad p={a.pagador} corta /> },
            { id: "inst", titulo: "Institución", valor: (a) => a.institucion, celda: (a) => a.institucion },
            { id: "cel", titulo: "Celular", celda: (a) => a.celular },
            {
              id: "asis", titulo: "Asistencia", valor: (a) => (ev.asistentes.includes(a.id!) ? 1 : 0),
              celda: (a) => {
                const si = ev.asistentes.includes(a.id!);
                return (
                  <button className={`btn btn-sm ${si ? "" : "btn-fantasma"}`} onClick={(e) => { e.stopPropagation(); guardar({ asistentes: si ? ev.asistentes.filter((x) => x !== a.id) : [...ev.asistentes, a.id!] }); }}>
                    {si ? <Badge tono="verde" punto>Asistió</Badge> : "Marcar asistencia"}
                  </button>
                );
              },
            },
          ]}
        />
      </div>

      <Panel
        abierto={agregar}
        onCerrar={() => setAgregar(false)}
        cabecera={<><h2>Agregar invitados</h2><div className="muted peq">{candidatos.length} afiliados activos disponibles</div></>}
        pie={<button className="btn btn-primario" disabled={!candidatos.length} onClick={() => { guardar({ invitados: [...ev.invitados, ...candidatos.map((a) => a.id!)] }); avisar(`${candidatos.length} invitados agregados`); setAgregar(false); }}>Invitar a los {candidatos.length} de esta lista</button>}
      >
        <div className="fila-wrap">
          <Buscador valor={filtro.q} onCambio={(v) => setFiltro({ ...filtro, q: v })} placeholder="Nombre, cédula o institución" ancho={220} />
          <FiltroChip etiqueta="Entidad" valor={filtro.pagador} opciones={[...new Set(vigentes.map((a) => a.pagador))].map((p) => ({ v: p, t: p.toLocaleUpperCase("es-CO") }))} onCambio={(v) => setFiltro({ ...filtro, pagador: v })} />
          <FiltroChip etiqueta="Tipo" valor={filtro.tipo} opciones={[{ v: "docente", t: "Docente" }, { v: "administrativo", t: "Administrativo" }]} onCambio={(v) => setFiltro({ ...filtro, tipo: v })} />
        </div>
        <div>
          {candidatos.slice(0, 150).map((a) => (
            <div key={a.id} className="fila sep-abajo" style={{ padding: "8px 0" }}>
              <Avatar nombre={a.nombre} />
              <div style={{ flex: 1, minWidth: 0 }}><b>{a.nombre}</b><div className="peq tenue">{a.institucion || a.pagador}</div></div>
              <button className="btn btn-sm" onClick={() => guardar({ invitados: [...ev.invitados, a.id!] })}>Invitar</button>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
