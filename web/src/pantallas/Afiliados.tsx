import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, ChevronDown, Download, RefreshCw, SlidersHorizontal, UserPlus, Users, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Buscador, FiltroChip, FiltroFechas } from "../componentes/filtros";
import { TablaDatos, type Columna } from "../componentes/TablaDatos";
import { PanelAfiliado } from "../componentes/PanelAfiliado";
import { Avatar, BadgeEntidad, BadgeEstado, BadgeResultado, Cabecera, Menu, PendienteChip, useUI, Vacio } from "../componentes/ui";
import { useModoDemo } from "../datos/preferencias";
import { db } from "../datos/db";
import { useEsAdmin } from "../datos/sesion";
import { eliminarAfiliados } from "../logica/eliminar";
import { useAfiliados, useHijosPorAfiliado, useUltimoCruce, vigente } from "../datos/hooks";
import { ESTADOS, RESULTADOS, type Afiliado, type Estado, type Hijo, type Resultado } from "../datos/tipos";
import { edad, fechaLarga } from "../logica/fechas";
import { exportarLista } from "../logica/exportar";
import { CON_SIN, conDato, EDADES, enRango, grupo, municipioDe, nombresMunicipio, SEXOS, sexoDe, SIN, VINCULACIONES, vinculacionDe } from "../logica/grupos";
import { columnasCorridas, conflictoDeHojas, faltantesAfiliado } from "../logica/pendientes";
import { contiene, esVacio } from "../logica/texto";

const FALTAS: Record<string, { t: string; fn: (a: Afiliado, h: Hijo[]) => boolean }> = {
  cedula: { t: "Sin cédula", fn: (a) => !a.cedula },
  fecha: { t: "Sin fecha de nacimiento", fn: (a) => !a.fechaNacimiento },
  corridas: { t: "Columnas corridas en el Excel", fn: columnasCorridas },
  conflicto: { t: "En activos y retirados", fn: conflictoDeHojas },
  tipo: { t: "Tipo deducido del cargo", fn: (a) => a.tipoInferido },
  hijos: { t: "Hijos sin confirmar", fn: (_, h) => h.some((x) => x.afiliado === null) },
  celular: { t: "Sin celular", fn: (a) => esVacio(a.celular) },
  novedad: { t: "Con novedad de afiliación", fn: (a) => a.novedadPeriodo !== null },
};

/** Filtros que van en la segunda fila ("Más filtros"). */
const SECUNDARIOS = ["afDesde", "afHasta", "nacDesde", "nacHasta", "institucion", "cargo", "area", "caja", "celular", "correo", "obs", "tipo", "descuento", "falta"];

const VISTAS = [
  { v: "activos", t: "Activos", fn: vigente },
  { v: "pendientes", t: "Con datos pendientes", fn: (a: Afiliado) => !a.cedula || !a.fechaNacimiento || conflictoDeHojas(a) || columnasCorridas(a) },
  { v: "retirados", t: "Retirados", fn: (a: Afiliado) => !vigente(a) },
  { v: "todos", t: "Todos", fn: () => true },
];

export default function Afiliados() {
  const afiliados = useAfiliados();
  const hijos = useHijosPorAfiliado();
  const ultimo = useUltimoCruce();
  const eventos = useLiveQuery(() => db.eventos.orderBy("fecha").reverse().toArray(), []) ?? [];
  const [params, setParams] = useSearchParams();
  const { avisar, confirmar } = useUI();
  const admin = useEsAdmin();
  const [vistaRapida, setVistaRapida] = useState<number | null>(null);
  const demo = useModoDemo();

  const g = (k: string) => params.get(k) ?? "";
  const f = {
    vista: params.get("vista") ?? (params.get("falta") || params.get("estado") === "todos" ? "todos" : "activos"),
    q: g("q"), pagador: g("pagador"), tipo: g("tipo"), municipio: g("municipio"), descuento: g("descuento"), falta: g("falta"),
    sexo: g("sexo"), vinculacion: g("vinculacion"), edad: g("edad"),
    afDesde: g("afDesde"), afHasta: g("afHasta"), nacDesde: g("nacDesde"), nacHasta: g("nacHasta"),
    institucion: g("institucion"), cargo: g("cargo"), area: g("area"), caja: g("caja"),
    celular: g("celular"), correo: g("correo"), obs: g("obs"),
  };
  const poner = (...pares: [string, string][]) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of pares) { if (v) p.set(k, v); else p.delete(k); }
    p.delete("estado");
    setParams(p, { replace: true });
  };
  const activosSecundarios = SECUNDARIOS.filter((k) => params.get(k)).length;
  const [masFiltros, setMasFiltros] = useState(activosSecundarios > 0);

  const lista = useMemo(() => {
    if (!afiliados) return [];
    const vista = VISTAS.find((v) => v.v === f.vista) ?? VISTAS[0];
    return afiliados.filter((a) => {
      if (!vista.fn(a)) return false;
      if (f.pagador && a.pagador !== f.pagador) return false;
      if (f.tipo && a.tipo !== f.tipo) return false;
      if (f.municipio && municipioDe(a) !== f.municipio) return false;
      if (f.sexo && sexoDe(a) !== f.sexo) return false;
      if (f.vinculacion && vinculacionDe(a) !== f.vinculacion) return false;
      if (f.edad && !EDADES[f.edad]?.fn(edad(a.fechaNacimiento))) return false;
      if (!enRango(a.fechaAfiliacion, f.afDesde, f.afHasta)) return false;
      if (!enRango(a.fechaNacimiento, f.nacDesde, f.nacHasta)) return false;
      if (f.institucion && grupo(a.institucion) !== f.institucion) return false;
      if (f.cargo && grupo(a.cargo) !== f.cargo) return false;
      if (f.area && grupo(a.area) !== f.area) return false;
      if (f.caja && grupo(a.cajaCompensacion) !== f.caja) return false;
      if (f.celular && conDato(a.celular) !== f.celular) return false;
      if (f.correo && conDato(a.correo) !== f.correo) return false;
      if (f.obs && conDato(a.observaciones) !== f.obs) return false;
      if (f.descuento && (ultimo?.porAfiliado.get(a.id!)?.resultado ?? "sin_dato") !== f.descuento) return false;
      if (f.falta && !FALTAS[f.falta]?.fn(a, hijos?.get(a.id!) ?? [])) return false;
      if (f.q) {
        const q = f.q.trim();
        return contiene(a.nombre, q) || (a.cedula ?? "").includes(q) || (a.celular ?? "").includes(q) || contiene(a.institucion, q) || contiene(a.cargo, q) || contiene(a.correo, q) || contiene(a.observaciones, q);
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afiliados, hijos, ultimo, params]);

  const opciones = useMemo(() => {
    const base = (afiliados ?? []).filter((VISTAS.find((v) => v.v === f.vista) ?? VISTAS[0]).fn);
    const contar = (fn: (a: Afiliado) => string) => {
      const m = new Map<string, number>();
      base.forEach((a) => { const k = fn(a); if (k) m.set(k, (m.get(k) ?? 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    // Agrupado por texto; "Sin dato" siempre al final.
    const agrupar = (fn: (a: Afiliado) => string) => {
      const todas = contar((a) => grupo(fn(a)));
      return [...todas.filter(([v]) => v !== SIN), ...todas.filter(([v]) => v === SIN)].map(([v, n]) => ({ v, t: v === SIN ? "Sin dato" : v, n }));
    };
    return {
      pagador: contar((a) => a.pagador).map(([v, n]) => ({ v, t: v.toLocaleUpperCase("es-CO"), n })),
      municipio: (() => { const nombres = nombresMunicipio(base); return contar(municipioDe).map(([v, n]) => ({ v, t: v === SIN ? "Sin dato" : nombres.get(v) ?? v, n })); })(),
      institucion: agrupar((a) => a.institucion),
      cargo: agrupar((a) => a.cargo),
      area: agrupar((a) => a.area),
      caja: agrupar((a) => a.cajaCompensacion),
    };
  }, [afiliados, f.vista]);

  const columnas: Columna<Afiliado>[] = [
    {
      id: "nombre", titulo: "Afiliado", fija: true, valor: (a) => a.nombre,
      celda: (a) => (
        <div className="principal-celda">
          <Avatar nombre={a.nombre} />
          <div><b>{a.nombre || "Sin nombre"}</b><small>C.C. {a.cedula ?? "sin cédula"}</small></div>
        </div>
      ),
    },
    { id: "estado", titulo: "Estado", valor: (a) => ESTADOS[a.estado], celda: (a) => <BadgeEstado estado={a.estado} /> },
    { id: "pagador", titulo: "Entidad", valor: (a) => a.pagador, celda: (a) => <BadgeEntidad p={a.pagador} corta /> },
    { id: "tipo", titulo: "Tipo", valor: (a) => a.tipo, celda: (a) => <span style={{ textTransform: "capitalize" }}>{a.tipo}</span> },
    { id: "institucion", titulo: "Institución", valor: (a) => a.institucion, celda: (a) => a.institucion || <span className="vacio-celda">—</span> },
    { id: "cargo", titulo: "Cargo", valor: (a) => a.cargo, celda: (a) => a.cargo || <span className="vacio-celda">—</span> },
    { id: "municipio", titulo: "Municipio", valor: (a) => a.municipio, celda: (a) => a.municipio },
    { id: "celular", titulo: "Celular", valor: (a) => a.celular, celda: (a) => (esVacio(a.celular) ? <span className="vacio-celda">—</span> : a.celular) },
    { id: "correo", titulo: "Correo", oculta: true, valor: (a) => a.correo, celda: (a) => a.correo },
    { id: "sexo", titulo: "Sexo", valor: (a) => sexoDe(a), celda: (a) => (sexoDe(a) === SIN ? <span className="vacio-celda">—</span> : sexoDe(a)) },
    { id: "area", titulo: "Área", oculta: true, valor: (a) => a.area, celda: (a) => a.area || <span className="vacio-celda">—</span> },
    { id: "caja", titulo: "Caja de compensación", oculta: true, valor: (a) => a.cajaCompensacion, celda: (a) => a.cajaCompensacion || <span className="vacio-celda">—</span> },
    { id: "nacimiento", titulo: "Fecha de nacimiento", oculta: true, valor: (a) => a.fechaNacimiento, celda: (a) => (a.fechaNacimiento ? fechaLarga(a.fechaNacimiento) : <span className="vacio-celda">—</span>) },
    { id: "edad", titulo: "Edad", alinear: "der", valor: (a) => edad(a.fechaNacimiento), celda: (a) => edad(a.fechaNacimiento) ?? <span className="vacio-celda">—</span> },
    { id: "hijos", titulo: "Hijos", alinear: "der", valor: (a) => hijos?.get(a.id!)?.length ?? 0, celda: (a) => hijos?.get(a.id!)?.length || "" },
    {
      id: "descuento", titulo: ultimo?.cruce ? "Descuento " + ultimo.cruce.periodo : "Último descuento",
      valor: (a) => ultimo?.porAfiliado.get(a.id!)?.resultado ?? "",
      celda: (a) => { const d = ultimo?.porAfiliado.get(a.id!); return d ? <BadgeResultado r={d.resultado} /> : <span className="vacio-celda">—</span>; },
    },
    { id: "afiliacion", titulo: "Fecha de afiliación", oculta: true, valor: (a) => a.fechaAfiliacion, celda: (a) => (a.fechaAfiliacion ? fechaLarga(a.fechaAfiliacion) : a.fechaAfiliacionOriginal) },
    { id: "quien", titulo: "Quién lo afilia", oculta: true, valor: (a) => a.quienAfilia, celda: (a) => a.quienAfilia },
    { id: "vinculacion", titulo: "Vinculación", valor: (a) => vinculacionDe(a), celda: (a) => (vinculacionDe(a) === SIN ? <span className="vacio-celda">—</span> : <span style={{ textTransform: "capitalize" }}>{vinculacionDe(a).toLowerCase()}</span>) },
    {
      id: "pendientes", titulo: "Pendientes", valor: (a) => faltantesAfiliado(a, hijos?.get(a.id!)).filter((x) => x.campo !== "Datos del formulario" && x.campo !== "Tipo").length,
      celda: (a) => {
        const n = faltantesAfiliado(a, hijos?.get(a.id!)).filter((x) => x.campo !== "Datos del formulario" && x.campo !== "Tipo");
        return n.length ? <PendienteChip title={n.map((x) => x.campo).join(", ")}>{n.length}</PendienteChip> : "";
      },
    },
    { id: "observaciones", titulo: "Observaciones", ancho: 280, valor: (a) => a.observaciones, celda: (a) => (esVacio(a.observaciones) ? <span className="vacio-celda">—</span> : <span className="recorte" title={a.observaciones}>{a.observaciones}</span>) },
  ];

  if (afiliados === undefined) return null;
  const hayFiltros = [...params.keys()].some((k) => k !== "vista" && params.get(k));

  async function eliminar(sel: Afiliado[], limpiar: () => void) {
    const nombres = sel.slice(0, 3).map((a) => a.nombre).join(", ") + (sel.length > 3 ? ` y ${sel.length - 3} más` : "");
    if (!(await confirmar({
      titulo: `Eliminar ${sel.length === 1 ? "1 afiliado" : `${sel.length} afiliados`}`,
      texto: `Se borran por completo de la base (${nombres}), con sus hijos y registros civiles, y no quedan en Retirados. Úselo solo para registros con errores, de prueba o duplicados. No se puede deshacer.`,
      boton: "Eliminar definitivamente", peligro: true,
    }))) return;
    await eliminarAfiliados(sel);
    limpiar();
    avisar(sel.length === 1 ? "1 afiliado eliminado" : `${sel.length} afiliados eliminados`);
  }

  async function cambiarEstado(sel: Afiliado[], estado: Estado, limpiar: () => void) {
    if (!(await confirmar({ titulo: `Cambiar ${sel.length} afiliados a "${ESTADOS[estado]}"`, boton: "Cambiar estado" }))) return;
    await db.afiliados.bulkUpdate(sel.map((a) => ({ key: a.id!, changes: { estado, editados: [...new Set([...(a.editados ?? []), "estado"])] } })));
    limpiar();
    avisar(`Estado actualizado para ${sel.length} afiliados`);
  }

  return (
    <>
      <Cabecera
        titulo="Base de datos"
        sub={`${afiliados.filter(vigente).length.toLocaleString("es-CO")} afiliados activos · ${afiliados.length.toLocaleString("es-CO")} registros en total`}
      >
        <div className="seg">
          {VISTAS.filter((v) => demo || v.v !== "pendientes").map((v) => (
            <button key={v.v} className={f.vista === v.v ? "on" : ""} onClick={() => poner(["vista", v.v === "activos" ? "" : v.v])}>
              {v.t} <span className="cuenta">{afiliados.filter(v.fn).length}</span>
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => { exportarLista("Afiliados", lista); avisar(`Se descargaron ${lista.length} afiliados en Excel`); }}><Download size={15} />Exportar</button>
        <Link className="btn btn-primario" to="/nuevo"><UserPlus size={15} />Agregar afiliado</Link>
      </Cabecera>

      <div className="contenido">
        <TablaDatos
          idGuardado="afiliados"
          filas={lista}
          columnas={demo ? columnas : columnas.filter((c) => c.id !== "pendientes")}
          clave={(a) => a.id!}
          ordenInicial={{ id: "nombre", dir: 1 }}
          onFila={(a) => setVistaRapida(a.id!)}
          seleccionable
          vacio={<Vacio icono={Users} titulo="No hay afiliados con estos filtros">{hayFiltros && <button className="btn btn-sm" onClick={() => setParams({ vista: f.vista }, { replace: true })}>Quitar filtros</button>}</Vacio>}
          barra={
            <>
              <Buscador valor={f.q} onCambio={(v) => poner(["q", v])} placeholder="Buscar nombre, cédula, celular…" />
              <FiltroChip etiqueta="Entidad" valor={f.pagador} opciones={opciones.pagador} onCambio={(v) => poner(["pagador", v])} />
              <FiltroChip etiqueta="Municipio" valor={f.municipio} opciones={opciones.municipio} onCambio={(v) => poner(["municipio", v])} />
              <FiltroChip etiqueta="Vinculación" valor={f.vinculacion} opciones={VINCULACIONES} onCambio={(v) => poner(["vinculacion", v])} />
              <FiltroChip etiqueta="Sexo" valor={f.sexo} opciones={SEXOS} onCambio={(v) => poner(["sexo", v])} />
              <FiltroChip etiqueta="Edad" valor={f.edad} opciones={Object.entries(EDADES).map(([v, x]) => ({ v, t: x.t }))} onCambio={(v) => poner(["edad", v])} />
              <button className={`filtro-chip ${activosSecundarios ? "on" : ""}`} onClick={() => setMasFiltros(!masFiltros)}>
                <SlidersHorizontal size={14} />Más filtros{activosSecundarios ? ` (${activosSecundarios})` : ""}<ChevronDown size={14} style={masFiltros ? { transform: "rotate(180deg)" } : undefined} />
              </button>
              {masFiltros && (
                <div className="filtros-mas">
                  <FiltroFechas etiqueta="Fecha de afiliación" desde={f.afDesde} hasta={f.afHasta} onCambio={(d, h) => poner(["afDesde", d], ["afHasta", h])} />
                  <FiltroFechas etiqueta="Fecha de nacimiento" desde={f.nacDesde} hasta={f.nacHasta} onCambio={(d, h) => poner(["nacDesde", d], ["nacHasta", h])} />
                  <FiltroChip etiqueta="Institución" valor={f.institucion} opciones={opciones.institucion} onCambio={(v) => poner(["institucion", v])} />
                  <FiltroChip etiqueta="Cargo" valor={f.cargo} opciones={opciones.cargo} onCambio={(v) => poner(["cargo", v])} />
                  <FiltroChip etiqueta="Área" valor={f.area} opciones={opciones.area} onCambio={(v) => poner(["area", v])} />
                  <FiltroChip etiqueta="Caja de compensación" valor={f.caja} opciones={opciones.caja} onCambio={(v) => poner(["caja", v])} />
                  <FiltroChip etiqueta="Celular" valor={f.celular} opciones={CON_SIN} onCambio={(v) => poner(["celular", v])} />
                  <FiltroChip etiqueta="Correo" valor={f.correo} opciones={CON_SIN} onCambio={(v) => poner(["correo", v])} />
                  <FiltroChip etiqueta="Observaciones" valor={f.obs} opciones={CON_SIN} onCambio={(v) => poner(["obs", v])} />
                  <FiltroChip etiqueta="Tipo" valor={f.tipo} opciones={[{ v: "docente", t: "Docente" }, { v: "administrativo", t: "Administrativo" }]} onCambio={(v) => poner(["tipo", v])} />
                  <FiltroChip
                    etiqueta="Descuento"
                    valor={f.descuento}
                    opciones={[...(Object.keys(RESULTADOS) as Resultado[]).filter((r) => r !== "extraordinaria" && r !== "no_en_base").map((r) => ({ v: r, t: RESULTADOS[r].titulo })), { v: "sin_dato", t: "No se cruzó" }]}
                    onCambio={(v) => poner(["descuento", v])}
                  />
                  <FiltroChip etiqueta="Datos" valor={f.falta} opciones={Object.entries(FALTAS).map(([v, x]) => ({ v, t: x.t }))} onCambio={(v) => poner(["falta", v])} />
                </div>
              )}
              {hayFiltros && <button className="btn btn-sm btn-fantasma" onClick={() => setParams(f.vista !== "activos" ? { vista: f.vista } : {}, { replace: true })}>Limpiar</button>}
            </>
          }
          accionesSeleccion={(sel, limpiar) => (
            <>
              <button className="btn btn-sm" onClick={() => exportarLista("Seleccion afiliados", sel)}><Download size={14} />Exportar</button>
              <Menu derecha boton={(abrir) => <button className="btn btn-sm" onClick={abrir}><CalendarPlus size={14} />Invitar a evento<ChevronDown size={13} /></button>}>
                {(cerrar) => (
                  <>
                    {eventos.length === 0 && <div className="titulo">No hay eventos creados</div>}
                    {eventos.map((e) => (
                      <button key={e.id} className="menu-item" onClick={async () => {
                        await db.eventos.update(e.id!, { invitados: [...new Set([...e.invitados, ...sel.map((a) => a.id!)])] });
                        cerrar(); limpiar(); avisar(`${sel.length} invitados a "${e.nombre}"`);
                      }}>{e.nombre}<span className="der">{fechaLarga(e.fecha)}</span></button>
                    ))}
                  </>
                )}
              </Menu>
              <Menu derecha boton={(abrir) => <button className="btn btn-sm" onClick={abrir}><RefreshCw size={14} />Cambiar estado<ChevronDown size={13} /></button>}>
                {(cerrar) => (Object.keys(ESTADOS) as Estado[]).map((e) => (
                  <button key={e} className="menu-item" onClick={() => { cerrar(); cambiarEstado(sel, e, limpiar); }}><BadgeEstado estado={e} /></button>
                ))}
              </Menu>
              {admin && <button className="btn btn-sm btn-peligro" onClick={() => eliminar(sel, limpiar)}><UserX size={14} />Eliminar</button>}
            </>
          )}
        />
      </div>

      <PanelAfiliado afiliadoId={vistaRapida} onCerrar={() => setVistaRapida(null)} />
    </>
  );
}
