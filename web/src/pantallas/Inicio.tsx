import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle, Briefcase, Building2, Cake, FileSearch, GraduationCap, Landmark, MessageCircle, School, UserMinus, UserPlus, Users, UserX,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Estadisticas } from "../componentes/Estadisticas";
import { Avatar, Badge, Cabecera, Kpi, Vacio } from "../componentes/ui";
import { db, leerMeta, vigilar } from "../datos/db";
import { useModoDemo } from "../datos/preferencias";
import { useAfiliados, useHijosPorAfiliado, vigente } from "../datos/hooks";
import { PAG_IBAGUE, PAG_TOLIMA, type Afiliado } from "../datos/tipos";
import { calcularRachas } from "../logica/cruce";
import { diaMes, fechaLarga, hoyISO, MESES, nombrePeriodo, periodoActual, periodoAnterior } from "../logica/fechas";
import type { ResumenImportacion } from "../logica/importarMaestro";
import { calcularPendientes } from "../logica/pendientes";
import { listaCumples, mensajeWhatsApp } from "./Cumpleanos";

export default function Inicio() {
  const afiliados = useAfiliados();
  const hijos = useHijosPorAfiliado();
  const cruces = useLiveQuery(() => db.cruces.orderBy("periodo").reverse().limit(6).toArray(), []);
  const ultimo = cruces?.[0];
  const rachas = useLiveQuery(async () => { await vigilar(db.cruces, db.cruceDetalle); return calcularRachas(); }, [ultimo?.id]);
  const imp = useLiveQuery(() => leerMeta<ResumenImportacion>("importacion"), []);
  const nav = useNavigate();
  const demo = useModoDemo();
  const cumples = useMemo(() => listaCumples(afiliados, hijos).filter((c) => c.dias <= 7), [afiliados, hijos]);
  const pendientes = useMemo(
    () => (afiliados && hijos ? calcularPendientes({ afiliados, hijos: [...hijos.values()].flat(), hojasOmitidas: imp?.omitidas ?? [], pagadores: [...new Set(afiliados.map((a) => a.pagador))] }) : []),
    [afiliados, hijos, imp],
  );

  if (afiliados === undefined) return null;
  const vig = afiliados.filter(vigente);
  const cuenta = (fn: (a: Afiliado) => boolean) => vig.filter(fn).length;
  const morosos2 = [...(rachas?.values() ?? [])].filter((r) => r.meses >= 2).length;

  return (
    <>
      <Cabecera titulo="Resumen general" sub={`Resumen al ${fechaLarga(hoyISO())}`}>
        <Link className="btn" to="/nuevo"><UserPlus size={15} />Nueva afiliación</Link>
        <Link className="btn btn-primario" to="/descuentos"><FileSearch size={15} />Descuentos del mes</Link>
      </Cabecera>

      <div className="contenido">
        {afiliados.length === 0 ? (
          <div className="card"><Vacio icono={Users} titulo="Todavía no hay datos"><Link className="btn btn-primario" to="/datos">Cargar la base de datos</Link></Vacio></div>
        ) : (
          <>
            <div className="kpis">
              <Kpi icono={Users} tono="verde" valor={vig.length.toLocaleString("es-CO")} etiqueta="Afiliados activos" a="/afiliados" />
              <Kpi icono={School} tono="azul" valor={cuenta((a) => a.pagador === PAG_IBAGUE)} etiqueta="Sec. Educación Ibagué" a={`/?pagador=${encodeURIComponent(PAG_IBAGUE)}`} />
              <Kpi icono={Building2} tono="morado" valor={cuenta((a) => a.pagador === PAG_TOLIMA)} etiqueta="Sec. Educación Tolima" a={`/?pagador=${encodeURIComponent(PAG_TOLIMA)}`} />
              <Kpi icono={Landmark} tono="cian" valor={cuenta((a) => /^(Alcald|Personer)/i.test(a.pagador))} etiqueta="Alcaldías y personerías" a="/afiliados" />
              <Kpi icono={GraduationCap} tono="gris" valor={cuenta((a) => a.tipo === "docente")} etiqueta="Docentes" a="/?tipo=docente" />
              <Kpi icono={Briefcase} tono="gris" valor={cuenta((a) => a.tipo === "administrativo")} etiqueta="Administrativos" a="/?tipo=administrativo" />
            </div>

            {ultimo && (
              <div className="kpis">
                <Kpi icono={UserX} tono="rojo" valor={ultimo.totales.sin_descuento ?? 0} etiqueta={`Sin descuento en ${nombrePeriodo(ultimo.periodo)}`} a={`/cruces/${ultimo.id}`} />
                <Kpi icono={AlertTriangle} tono="rojo" valor={ultimo.totales.retirado_con_descuento ?? 0} etiqueta="Retirados a los que les descontaron" a={`/cruces/${ultimo.id}?r=retirado_con_descuento`} />
                <Kpi icono={UserMinus} tono={morosos2 ? "rojo" : "verde"} valor={morosos2} etiqueta="Dos meses o más sin descuento" a="/descuentos?vista=mes" />
                <Kpi icono={Users} tono="morado" valor={ultimo.totales.no_en_base ?? 0} etiqueta="Descontados que no están en la base" a={`/cruces/${ultimo.id}?r=no_en_base`} />
              </div>
            )}

            <Estadisticas activos={vig} />

            <div className="tres">
              <div className="pila">
                <Crecimiento fechas={vig.map((a) => a.fechaAfiliacion)} />
                <div className="card">
                  <div className="card-cab"><h3>Cruces recientes</h3><Link className="accion peq" to="/descuentos?vista=mes">Ver mes a mes</Link></div>
                  {(cruces ?? []).length === 0 ? <Vacio titulo="Aún no hay cruces" /> : (
                    <div className="tabla-ajuste">
                      <table className="tbl">
                        <thead><tr><th>Mes</th><th className="num">Descontados</th><th className="num">Sin descuento</th><th className="num">Retirados con descuento</th><th className="num">Descuento mensual</th></tr></thead>
                        <tbody>
                          {cruces!.map((c) => (
                            <tr key={c.id} className="clic" onClick={() => nav(`/cruces/${c.id}`)}>
                              <td><b className="mayus">{nombrePeriodo(c.periodo)}</b></td>
                              <td className="num">{c.totales.descontado ?? 0}</td>
                              <td className="num"><Badge tono="rojo">{c.totales.sin_descuento ?? 0}</Badge></td>
                              <td className="num">{c.totales.retirado_con_descuento ?? 0}</td>
                              <td className="num">$ {c.fuentes.reduce((s, f) => s + f.total, 0).toLocaleString("es-CO")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div className="pila">
                <div className="card">
                  <div className="card-cab"><Cake size={16} className="tenue" /><h3>Cumpleaños de la semana</h3><Link className="accion peq" to="/cumpleanos">Ver todos</Link></div>
                  {cumples.length === 0 && <Vacio titulo="Nadie cumple años esta semana" />}
                  <div>
                    {cumples.slice(0, 7).map((c) => {
                      const wa = mensajeWhatsApp(c);
                      return (
                        <div key={c.clave} className="fila sep-abajo" style={{ padding: "9px 16px" }}>
                          <Avatar nombre={c.nombre} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Link to={`/afiliados/${c.afiliadoId}`} style={{ fontWeight: 600, color: "var(--texto)" }}>{c.nombre}</Link>
                            <div className="peq tenue">{c.esHijo ? `Hijo(a) de ${c.padre}` : c.institucion}</div>
                          </div>
                          {c.dias === 0 ? <Badge tono="verde">Hoy</Badge> : <span className="peq muted">{diaMes(c.fecha)}</span>}
                          {wa && <a className="btn btn-sm btn-fantasma btn-icono" href={wa} target="_blank" rel="noreferrer" title="Saludar por WhatsApp"><MessageCircle size={15} /></a>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {demo && <div className="card">
                  <div className="card-cab"><h3>Pendientes para la reunión</h3><Link className="accion peq" to="/reunion">Ver los {pendientes.length}</Link></div>
                  <div>
                    {pendientes.filter((p) => p.afectados).slice(0, 5).map((p) => (
                      <Link key={p.id} to={p.ver ?? "/reunion"} className="fila sep-abajo" style={{ padding: "10px 16px", color: "var(--texto)" }}>
                        <span style={{ flex: 1 }}>{p.titulo}</span>
                        <Badge tono="ambar">{p.afectados}</Badge>
                      </Link>
                    ))}
                  </div>
                </div>}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Afiliaciones nuevas por mes en los últimos 12 meses. Reemplaza la "Hoja 10" del Excel. */
function Crecimiento({ fechas }: { fechas: (string | null)[] }) {
  const [sobre, setSobre] = useState<number | null>(null);
  const meses = Array.from({ length: 12 }, (_, i) => periodoAnterior(periodoActual(), 11 - i));
  const conteo = meses.map((p) => fechas.filter((f) => f?.startsWith(p)).length);
  const max = Math.max(1, ...conteo);
  const total = conteo.reduce((a, b) => a + b, 0);
  const W = 640, H = 210, B = 24, ancho = W / 12;
  const lineas = [0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  return (
    <div className="card">
      <div className="card-cab">
        <h3>Afiliaciones nuevas por mes</h3>
        <span className="accion peq muted">{total} en 12 meses</span>
      </div>
      <div className="card-cuerpo">
        <svg className="grafico" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Afiliaciones nuevas por mes" onMouseLeave={() => setSobre(null)}>
          {lineas.map((v) => {
            const y = H - B - (v / max) * (H - B - 22);
            return <g key={v}><line x1={0} x2={W} y1={y} y2={y} stroke="var(--linea)" /><text x={W} y={y - 3} textAnchor="end" fontSize="10" fill="var(--texto-3)">{v}</text></g>;
          })}
          <line x1={0} x2={W} y1={H - B} y2={H - B} stroke="var(--borde-2)" />
          {conteo.map((n, i) => {
            const h = n ? Math.max(5, (n / max) * (H - B - 22)) : 0;
            const x = i * ancho;
            const [a, m] = meses[i].split("-");
            return (
              <g key={i} onMouseEnter={() => setSobre(i)}>
                <rect x={x} y={0} width={ancho} height={H} fill="transparent" />
                {n > 0 && (
                  <path
                    d={`M${x + 12},${H - B} v${-(h - 4)} q0,-4 4,-4 h${ancho - 32} q4,0 4,4 v${h - 4} z`}
                    fill="var(--primario)"
                    opacity={sobre === null || sobre === i ? 1 : 0.4}
                  />
                )}
                {sobre === i && <text x={x + ancho / 2} y={H - B - h - 6} textAnchor="middle" fontSize="12" fontWeight="650" fill="var(--texto)">{n}</text>}
                <text x={x + ancho / 2} y={H - 7} textAnchor="middle" fontSize="11" fill="var(--texto-2)">
                  {MESES[Number(m) - 1].slice(0, 3)}{m === "01" ? ` ${a.slice(2)}` : ""}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="peq muted" style={{ minHeight: 18 }}>
          {sobre !== null ? <><b className="mayus">{nombrePeriodo(meses[sobre])}</b>: {conteo[sobre]} afiliaciones nuevas</> : "Pase el cursor sobre una barra para ver el detalle. Basado en la fecha de afiliación."}
        </div>
      </div>
    </div>
  );
}
