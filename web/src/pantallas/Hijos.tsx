import { useLiveQuery } from "dexie-react-hooks";
import { Baby, Download, FileX, List, UserRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Buscador, FiltroChip } from "../componentes/filtros";
import { PanelAfiliado } from "../componentes/PanelAfiliado";
import { EditarHijo } from "../componentes/EditarHijo";
import { RegistroCivil } from "../componentes/RegistroCivil";
import { TablaDatos } from "../componentes/TablaDatos";
import { Avatar, Badge, BadgeEntidad, Cabecera, Kpi, Vacio } from "../componentes/ui";
import { db } from "../datos/db";
import { vigente } from "../datos/hooks";
import { useModoDemo } from "../datos/preferencias";
import type { Afiliado, Hijo } from "../datos/tipos";
import { edadHijo, fechaLarga, generoHijo, hoyISO, textoEdadHijo } from "../logica/fechas";
import { contiene, esVacio } from "../logica/texto";
import * as XLSX from "xlsx";

interface FilaHijo { h: Hijo; a: Afiliado; edad: number | null; aprox: boolean }

/** El sindicato solo tiene en cuenta a los menores de 12 años para las actividades infantiles. */
const EDAD_LIMITE = 12;
const GRUPOS_EDAD: { v: string; t: string; fn: (e: number | null) => boolean }[] = [
  { v: "menores", t: `Menores de ${EDAD_LIMITE} años`, fn: (e) => e !== null && e < EDAD_LIMITE },
  { v: "mayores", t: `${EDAD_LIMITE} años o más`, fn: (e) => e !== null && e >= EDAD_LIMITE },
  { v: "sin", t: "Sin fecha de nacimiento", fn: (e) => e === null },
  { v: "todos", t: "Todos", fn: () => true },
];

const tieneRegistro = (h: Hijo) => !!h.registroCivilArchivo || (!!h.registroCivil && !esVacio(h.registroCivil));

/** Hijos de los afiliados, organizados: en el Excel están repartidos en muchas columnas. */
export default function Hijos() {
  const datos = useLiveQuery(async () => {
    const [hijos, afiliados] = await Promise.all([db.hijos.toArray(), db.afiliados.toArray()]);
    const porId = new Map(afiliados.map((a) => [a.id!, a]));
    return hijos.map((h) => { const e = edadHijo(h); return { h, a: porId.get(h.afiliadoId)!, edad: e.anos, aprox: e.aprox }; }).filter((x) => x.a);
  }, []);
  const nav = useNavigate();
  const [vista, setVista] = useState<"hijos" | "afiliados">("hijos");
  const [q, setQ] = useState("");
  const [grupoEdad, setGrupoEdad] = useState("menores");
  const [registro, setRegistro] = useState("");
  const [servicio, setServicio] = useState("");
  const [estado, setEstado] = useState("vigentes");
  const [panel, setPanel] = useState<number | null>(null);
  const [editando, setEditando] = useState<Hijo | null>(null);
  const demo = useModoDemo();

  const delGrupo = (x: FilaHijo, v: string) => (GRUPOS_EDAD.find((g) => g.v === v) ?? GRUPOS_EDAD[0]).fn(x.edad);
  const filas = useMemo(() => (datos ?? []).filter((x) => {
    if (estado === "vigentes" && !vigente(x.a)) return false;
    if (!delGrupo(x, grupoEdad)) return false;
    if (registro === "si" && !tieneRegistro(x.h)) return false;
    if (registro === "no" && tieneRegistro(x.h)) return false;
    if (servicio && (x.h.afiliado === null ? "sin" : x.h.afiliado ? "si" : "no") !== servicio) return false;
    if (q && !(contiene(x.h.nombre, q) || contiene(x.a.nombre, q) || (x.a.cedula ?? "").includes(q))) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [datos, q, grupoEdad, registro, servicio, estado]);

  const porAfiliado = useMemo(() => {
    const m = new Map<number, { a: Afiliado; hijos: FilaHijo[] }>();
    for (const x of filas) {
      const g = m.get(x.a.id!) ?? { a: x.a, hijos: [] };
      g.hijos.push(x);
      m.set(x.a.id!, g);
    }
    return [...m.values()];
  }, [filas]);

  if (datos === undefined) return null;
  const vig = datos.filter((x) => vigente(x.a));

  function exportar() {
    const wb = XLSX.utils.book_new();
    const hoja = XLSX.utils.json_to_sheet(filas.map((x, i) => ({
      "N°": i + 1, "Hijo(a)": x.h.nombre, "Fecha de nacimiento": x.h.fechaNacimiento ?? x.h.fechaNacimientoOriginal,
      "Edad": x.edad ?? "", "Edad aproximada": x.aprox ? "Sí (según el formulario)" : "", "Género": generoHijo(x.h.sexo), "Registro civil": x.h.registroCivilArchivo ? "Adjunto en la app" : x.h.registroCivil,
      "Afiliado(a)": x.a.nombre, "Cédula": x.a.cedula ?? "", "Entidad": x.a.pagador, "Celular": x.a.celular,
    })));
    XLSX.utils.book_append_sheet(wb, hoja, "Hijos");
    const nombreGrupo = grupoEdad === "todos" ? "" : ` - ${GRUPOS_EDAD.find((g) => g.v === grupoEdad)!.t.toLowerCase()}`;
    XLSX.writeFile(wb, `Hijos de afiliados${nombreGrupo} ${hoyISO()}.xlsx`);
  }

  const barra = (
    <>
      <Buscador valor={q} onCambio={setQ} placeholder="Buscar hijo, afiliado o cédula" />
      <FiltroChip etiqueta="Registro civil" valor={registro} opciones={[{ v: "si", t: "Con registro civil" }, { v: "no", t: "Sin registro civil" }]} onCambio={setRegistro} />
      {demo && <FiltroChip etiqueta="Afiliado al servicio" valor={servicio} opciones={[{ v: "si", t: "Sí" }, { v: "no", t: "No" }, { v: "sin", t: "Sin confirmar" }]} onCambio={setServicio} />}
      <FiltroChip etiqueta="Padres" valor={estado === "vigentes" ? "" : estado} opciones={[{ v: "todos", t: "Incluir retirados" }]} onCambio={(v) => setEstado(v || "vigentes")} />
    </>
  );

  return (
    <>
      <Cabecera titulo="Hijos de afiliados" sub="Todos los hijos registrados, en un solo lugar. En el Excel están repartidos en varias columnas por afiliado.">
        <div className="seg">
          <button className={vista === "hijos" ? "on" : ""} onClick={() => setVista("hijos")}><List size={14} />Lista de hijos</button>
          <button className={vista === "afiliados" ? "on" : ""} onClick={() => setVista("afiliados")}><Users size={14} />Agrupado por afiliado</button>
        </div>
        <button className="btn" onClick={exportar} disabled={!filas.length}><Download size={15} />Descargar Excel</button>
      </Cabecera>
      <div className="contenido">
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          {GRUPOS_EDAD.map((g) => {
            const n = datos.filter((x) => (estado !== "vigentes" || vigente(x.a)) && g.fn(x.edad)).length;
            return <button key={g.v} className={grupoEdad === g.v ? "on" : ""} onClick={() => setGrupoEdad(g.v)}>{g.t} <span className="cuenta">{n}</span></button>;
          })}
        </div>
        <div className="kpis">
          <Kpi icono={Users} tono="azul" valor={new Set(vig.map((x) => x.a.id)).size} etiqueta="Afiliados activos con hijos" />
          <Kpi icono={Baby} tono="rosa" valor={vig.length} etiqueta="Hijos registrados" />
          <Kpi icono={UserRound} tono="verde" valor={vig.filter((x) => x.edad !== null && x.edad < EDAD_LIMITE).length} etiqueta={`Menores de ${EDAD_LIMITE} años (actividades infantiles)`} />
          <Kpi icono={FileX} tono="ambar" valor={vig.filter((x) => !tieneRegistro(x.h)).length} etiqueta="Sin registro civil" />
        </div>

        {vista === "hijos" ? (
          <TablaDatos
            idGuardado="hijos-v2"
            filas={filas}
            clave={(x) => x.h.id!}
            ordenInicial={{ id: "padre", dir: 1 }}
            onFila={(x) => setEditando(x.h)}
            barra={barra}
            vacio={<Vacio icono={Baby} titulo="No hay hijos con estos filtros" />}
            columnas={[
              {
                id: "hijo", titulo: "Hijo(a)", fija: true, valor: (x) => x.h.nombre,
                celda: (x) => <div className="principal-celda"><Avatar nombre={x.h.nombre} /><div><b>{x.h.nombre}</b><small>{x.edad !== null ? textoEdadHijo({ anos: x.edad, aprox: x.aprox }) : "Edad sin dato"}</small></div></div>,
              },
              { id: "nac", titulo: "Fecha de nacimiento", valor: (x) => x.h.fechaNacimiento ?? "", celda: (x) => (x.h.fechaNacimiento ? fechaLarga(x.h.fechaNacimiento) : <span className="vacio-celda">{x.h.fechaNacimientoOriginal || "—"}</span>) },
              { id: "edad", titulo: "Edad", alinear: "der", valor: (x) => x.edad, celda: (x) => (x.edad !== null ? <span title={x.aprox ? "Edad aproximada, según la edad que reportaron en el formulario de inscripción (falta la fecha de nacimiento)" : undefined}>{textoEdadHijo({ anos: x.edad, aprox: x.aprox })}</span> : "") },
              { id: "genero", titulo: "Género", valor: (x) => x.h.sexo ?? "", celda: (x) => generoHijo(x.h.sexo) || <span className="vacio-celda">—</span> },
              {
                id: "rc", titulo: "Registro civil", valor: (x) => (tieneRegistro(x.h) ? 1 : 0),
                celda: (x) => <RegistroCivil hijo={x.h} />,
              },
              {
                id: "servicio", titulo: "Afiliado al servicio", oculta: true, valor: (x) => (x.h.afiliado === null ? 2 : x.h.afiliado ? 0 : 1),
                celda: (x) => (
                  <select className="select" style={{ height: 30, width: 160 }} onClick={(e) => e.stopPropagation()} value={x.h.afiliado === null ? "" : x.h.afiliado ? "si" : "no"}
                    onChange={(e) => db.hijos.update(x.h.id!, { afiliado: e.target.value === "" ? null : e.target.value === "si" })}>
                    <option value="">Sin confirmar</option><option value="si">Sí</option><option value="no">No</option>
                  </select>
                ),
              },
              {
                id: "padre", titulo: "Padre o madre (afiliado)", valor: (x) => x.a.nombre,
                celda: (x) => <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPanel(x.a.id!); }}><b>{x.a.nombre}</b></a>,
              },
              { id: "entidad", titulo: "Entidad", valor: (x) => x.a.pagador, celda: (x) => <BadgeEntidad p={x.a.pagador} corta /> },
              { id: "cel", titulo: "Celular", celda: (x) => x.a.celular },
            ]}
          />
        ) : (
          <TablaDatos
            idGuardado="hijos-agrupado"
            filas={porAfiliado}
            clave={(g) => g.a.id!}
            onFila={(g) => setPanel(g.a.id!)}
            ordenInicial={{ id: "afiliado", dir: 1 }}
            barra={barra}
            vacio={<Vacio icono={Users} titulo="No hay afiliados con hijos con estos filtros" />}
            columnas={[
              { id: "afiliado", titulo: "Afiliado", fija: true, valor: (g) => g.a.nombre, celda: (g) => <div className="principal-celda"><Avatar nombre={g.a.nombre} /><div><b>{g.a.nombre}</b><small>C.C. {g.a.cedula}</small></div></div> },
              { id: "n", titulo: "Hijos", alinear: "der", valor: (g) => g.hijos.length, celda: (g) => <Badge tono="rosa">{g.hijos.length}</Badge> },
              {
                id: "lista", titulo: "Nombres y edades",
                celda: (g) => <div className="fila-wrap" style={{ gap: 4, padding: "6px 0", whiteSpace: "normal" }}>{g.hijos.map((x) => <Badge key={x.h.id}>{x.h.nombre.split(" ").slice(0, 2).join(" ")}{x.edad !== null ? ` · ${x.edad} años` : ""}</Badge>)}</div>,
              },
              { id: "rc", titulo: "Sin registro civil", alinear: "der", valor: (g) => g.hijos.filter((x) => !tieneRegistro(x.h)).length, celda: (g) => g.hijos.filter((x) => !tieneRegistro(x.h)).length || "" },
              { id: "entidad", titulo: "Entidad", valor: (g) => g.a.pagador, celda: (g) => <BadgeEntidad p={g.a.pagador} corta /> },
              { id: "cel", titulo: "Celular", celda: (g) => g.a.celular },
            ]}
          />
        )}
        <p className="peq muted">Para corregir los datos de un hijo, haga clic en su fila. Para agregar uno: abra la ficha del afiliado y vaya a la pestaña "Hijos". <a href="#" onClick={(e) => { e.preventDefault(); nav("/"); }}>Ir a la base de datos</a></p>
      </div>
      <PanelAfiliado afiliadoId={panel} onCerrar={() => setPanel(null)} />
      {editando && <EditarHijo hijo={editando} cerrar={() => setEditando(null)} />}
    </>
  );
}
