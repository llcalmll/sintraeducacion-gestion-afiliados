import { BarChart3, LineChart, PieChart } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Afiliado } from "../datos/tipos";
import { edad } from "../logica/fechas";
import { EDADES, entidadCorta, grupo, municipioDe, nombresMunicipio, SIN, sexoDe, vinculacionDe } from "../logica/grupos";
import { esVacio } from "../logica/texto";

/*
 * Composición de los afiliados activos en porcentajes, por campo. Cada tarjeta se puede ver en barras (un solo color:
 * la barra mide, la etiqueta dice qué es), en líneas o en circular (con leyenda). Al hacer clic en un grupo se abre la
 * lista con ese mismo filtro.
 */

interface Fila { t: string; n: number; filtro?: string }
interface Bloque { titulo: string; filas: Fila[]; nota?: string }

const MAX_FILAS = 7;
const pct = (n: number, total: number) => {
  const p = total ? (n / total) * 100 : 0;
  return p > 0 && p < 1 ? "<1 %" : `${Math.round(p)} %`;
};

/**
 * Cuenta por valor; los más frecuentes primero, el resto en "Otros" y "Sin dato" al final. La clave es la misma que
 * usa el filtro de la lista (param); "mostrar" solo cambia el texto.
 */
function porValor(lista: Afiliado[], fn: (a: Afiliado) => string, param: string, o: { mostrar?: (v: string) => string; sinFiltrable?: boolean } = {}): Fila[] {
  const max = MAX_FILAS;
  const m = new Map<string, number>();
  for (const a of lista) { const k = fn(a); m.set(k, (m.get(k) ?? 0) + 1); }
  const sin = m.get(SIN) ?? 0;
  m.delete(SIN);
  const orden = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const filas: Fila[] = orden.slice(0, max).map(([v, n]) => ({ t: o.mostrar?.(v) ?? v, n, filtro: `${param}=${encodeURIComponent(v)}` }));
  const resto = orden.slice(max);
  if (resto.length) filas.push({ t: `Otros (${resto.length})`, n: resto.reduce((s, [, n]) => s + n, 0) });
  if (sin) filas.push({ t: "Sin dato", n: sin, filtro: o.sinFiltrable === false ? undefined : `${param}=${SIN}` });
  return filas;
}

export function Estadisticas({ activos }: { activos: Afiliado[] }) {
  const total = activos.length;
  const bloques = useMemo<Bloque[]>(() => {
    const cuenta = (fn: (a: Afiliado) => boolean) => activos.filter(fn).length;
    return [
      {
        titulo: "Rangos de edad",
        filas: Object.entries(EDADES).map(([v, r]) => ({ t: v === SIN ? "Sin dato" : `${r.t} años`, n: cuenta((a) => r.fn(edad(a.fechaNacimiento))), filtro: `edad=${encodeURIComponent(v)}` })),
      },
      {
        titulo: "Género",
        filas: [
          { t: "Femenino", n: cuenta((a) => sexoDe(a) === "F"), filtro: "sexo=F" },
          { t: "Masculino", n: cuenta((a) => sexoDe(a) === "M"), filtro: "sexo=M" },
          { t: "Sin dato", n: cuenta((a) => sexoDe(a) === SIN), filtro: `sexo=${SIN}` },
        ],
      },
      {
        titulo: "Tipo de afiliado",
        filas: [
          { t: "Docente", n: cuenta((a) => a.tipo === "docente"), filtro: "tipo=docente" },
          { t: "Administrativo", n: cuenta((a) => a.tipo === "administrativo"), filtro: "tipo=administrativo" },
        ],
      },
      {
        titulo: "Tipo de vinculación",
        filas: [
          { t: "Carrera", n: cuenta((a) => vinculacionDe(a) === "CARRERA"), filtro: "vinculacion=CARRERA" },
          { t: "Provisional", n: cuenta((a) => vinculacionDe(a) === "PROVISIONAL"), filtro: "vinculacion=PROVISIONAL" },
          { t: "Sin dato", n: cuenta((a) => vinculacionDe(a) === SIN), filtro: `vinculacion=${SIN}` },
        ],
      },
      { titulo: "Entidad que descuenta", filas: porValor(activos, (a) => a.pagador, "pagador", { mostrar: entidadCorta }) },
      // Igual que el filtro de la lista: "IBAGUÉ" e "IBAGUE" cuentan como el mismo municipio.
      { titulo: "Municipio", filas: porValor(activos, municipioDe, "municipio", { mostrar: (v) => nombresMunicipio(activos).get(v) ?? v }) },
      { titulo: "Caja de compensación", filas: porValor(activos, (a) => grupo(a.cajaCompensacion), "caja") },
      { titulo: "Área (docentes)", filas: porValor(activos.filter((a) => a.tipo === "docente"), (a) => grupo(a.area), "area"), nota: "sobre los docentes activos" },
      { titulo: "Cargo", filas: porValor(activos, (a) => grupo(a.cargo), "cargo") },
      {
        titulo: "Datos de contacto completos",
        nota: "cuántos tienen el dato",
        filas: [
          { t: "Celular", n: cuenta((a) => !esVacio(a.celular)), filtro: "celular=con" },
          { t: "Correo", n: cuenta((a) => !esVacio(a.correo)), filtro: "correo=con" },
          { t: "Fecha de nacimiento", n: cuenta((a) => !!a.fechaNacimiento) },
          { t: "Institución", n: cuenta((a) => grupo(a.institucion) !== SIN) },
        ],
      },
    ];
  }, [activos]);

  if (!total) return null;
  return (
    <div className="pila">
      <div className="fila-wrap" style={{ gap: 8, alignItems: "center" }}>
        <BarChart3 size={17} className="tenue" />
        <h3 style={{ margin: 0 }}>Composición de los afiliados activos</h3>
        <span className="peq muted">Porcentajes sobre {total.toLocaleString("es-CO")} afiliados activos. Clic en un grupo para ver la lista; arriba de cada tarjeta se elige el tipo de gráfico.</span>
      </div>
      <div className="estadisticas">
        {bloques.map((b) => <Distribucion key={b.titulo} bloque={b} total={b.titulo.startsWith("Área") ? activos.filter((a) => a.tipo === "docente").length : total} />)}
      </div>
    </div>
  );
}

type TipoGrafico = "barras" | "lineas" | "circular";
const TIPOS: { v: TipoGrafico; t: string; icono: typeof BarChart3 }[] = [
  { v: "barras", t: "Barras", icono: BarChart3 },
  { v: "lineas", t: "Líneas", icono: LineChart },
  { v: "circular", t: "Circular", icono: PieChart },
];

/** El tipo de gráfico que eligió cada persona para cada tarjeta (se recuerda en este equipo). */
function useTipo(titulo: string): [TipoGrafico, (t: TipoGrafico) => void] {
  const k = `estadistica:${titulo}`;
  const [tipo, setTipo] = useState<TipoGrafico>(() => {
    try { const v = localStorage.getItem(k); return v === "lineas" || v === "circular" ? v : "barras"; } catch { return "barras"; }
  });
  return [tipo, (v) => { setTipo(v); try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: dura la sesión */ } }];
}

function Distribucion({ bloque, total }: { bloque: Bloque; total: number }) {
  const nav = useNavigate();
  const [tipo, setTipo] = useTipo(bloque.titulo);
  const abrir = (f: Fila) => f.filtro && nav(`/?${f.filtro}`);
  const ayuda = (f: Fila) => `${f.t}: ${f.n.toLocaleString("es-CO")} de ${total.toLocaleString("es-CO")} (${pct(f.n, total)})${f.filtro ? ". Clic para ver la lista." : ""}`;
  return (
    <div className="card">
      <div className="card-cab">
        <h3>{bloque.titulo}</h3>
        <span className="accion fila" style={{ gap: 8 }}>
          {bloque.nota && <span className="peq muted">{bloque.nota}</span>}
          <span className="seg seg-mini" role="group" aria-label="Tipo de gráfico">
            {TIPOS.map((x) => (
              <button key={x.v} type="button" className={tipo === x.v ? "on" : ""} title={x.t} aria-label={x.t} aria-pressed={tipo === x.v} onClick={() => setTipo(x.v)}>
                <x.icono size={14} />
              </button>
            ))}
          </span>
        </span>
      </div>
      {tipo === "barras" && <Barras filas={bloque.filas} total={total} titulo={bloque.titulo} abrir={abrir} ayuda={ayuda} />}
      {tipo === "lineas" && <Lineas filas={bloque.filas} total={total} titulo={bloque.titulo} abrir={abrir} ayuda={ayuda} />}
      {tipo === "circular" && <Circular filas={bloque.filas} total={total} titulo={bloque.titulo} abrir={abrir} ayuda={ayuda} />}
    </div>
  );
}

interface PropsGrafico { filas: Fila[]; total: number; titulo: string; abrir: (f: Fila) => void; ayuda: (f: Fila) => string }

function Barras({ filas, total, titulo, abrir, ayuda }: PropsGrafico) {
  return (
    <div className="card-cuerpo distribucion" role="table" aria-label={titulo}>
      {filas.map((f) => {
        const ancho = total ? (f.n / total) * 100 : 0;
        const contenido = (
          <>
            <span className="dist-etq" title={f.t}>{f.t}</span>
            <span className="dist-barra" aria-hidden="true"><span style={{ width: `${Math.max(ancho, f.n ? 1.5 : 0)}%` }} /></span>
            <span className="dist-valor"><b>{pct(f.n, total)}</b><small>{f.n.toLocaleString("es-CO")}</small></span>
          </>
        );
        return f.filtro
          ? <button key={f.t} type="button" role="row" className="dist-fila clic" title={ayuda(f)} onClick={() => abrir(f)}>{contenido}</button>
          : <div key={f.t} role="row" className="dist-fila" title={ayuda(f)}>{contenido}</div>;
      })}
    </div>
  );
}

/** Puntos unidos por una línea, uno por grupo, en el mismo orden de la tarjeta. Pasando el mouse se ve el valor. */
function Lineas({ filas, total, titulo, abrir, ayuda }: PropsGrafico) {
  const [sobre, setSobre] = useState<number | null>(null);
  const W = 360, H = 210, IZQ = 52, DER = 14, ARR = 22, ABA = 58;
  const valores = filas.map((f) => (total ? (f.n / total) * 100 : 0));
  const tope = Math.max(10, Math.ceil(Math.max(...valores) / 10) * 10);
  const x = (i: number) => IZQ + (filas.length === 1 ? (W - IZQ - DER) / 2 : (i * (W - IZQ - DER)) / (filas.length - 1));
  const y = (v: number) => ARR + (1 - v / tope) * (H - ARR - ABA);
  // En el eje caben pocas letras: sin el " años" de los rangos y recortado si es largo (el nombre completo sale al pasar el mouse).
  const corto = (s: string) => { const x = s.replace(/ años$/, ""); return x.length > 13 ? `${x.slice(0, 12)}…` : x; };
  const mayor = valores.indexOf(Math.max(...valores));
  return (
    <div className="card-cuerpo">
      <svg className="grafico" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${titulo}: ${filas.map((f) => `${f.t} ${pct(f.n, total)}`).join(", ")}`} onMouseLeave={() => setSobre(null)}>
        {[0, 0.5, 1].map((r) => {
          const v = Math.round(tope * r);
          return <g key={r}><line x1={IZQ} x2={W - DER} y1={y(v)} y2={y(v)} stroke="var(--linea)" /><text x={IZQ - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--texto-3)">{v} %</text></g>;
        })}
        <polyline points={valores.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke="var(--primario)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {filas.map((f, i) => {
          const visible = sobre === i || (sobre === null && i === mayor);
          return (
            <g key={f.t} onMouseEnter={() => setSobre(i)} onClick={() => abrir(f)} style={{ cursor: f.filtro ? "pointer" : "default" }}>
              <title>{ayuda(f)}</title>
              <rect x={x(i) - 14} y={ARR - 10} width={28} height={H - ARR - ABA + 20} fill="transparent" />
              <circle cx={x(i)} cy={y(valores[i])} r={sobre === i ? 6 : 4.5} fill="var(--primario)" stroke="var(--superficie)" strokeWidth={2} />
              {visible && <text x={x(i)} y={y(valores[i]) - 10} textAnchor="middle" fontSize="11" fontWeight="650" fill="var(--texto)">{pct(f.n, total)}</text>}
              <text x={x(i)} y={H - ABA + 14} textAnchor="end" fontSize="10" fill="var(--texto-2)" transform={`rotate(-35 ${x(i)} ${H - ABA + 14})`}>{corto(f.t)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Quesito (anillo) con su leyenda: nombre, porcentaje y cantidad siempre visibles, no solo el color. */
function Circular({ filas, total, titulo, abrir, ayuda }: PropsGrafico) {
  const [sobre, setSobre] = useState<number | null>(null);
  const R = 70, r = 42, C = 80;
  // Colores fijos por orden; "Sin dato" siempre en gris para no parecer una categoría más.
  const color = (f: Fila, i: number) => (f.t === "Sin dato" ? "var(--serie-sin)" : `var(--serie-${Math.min(i, 7) + 1})`);
  const suma = filas.reduce((s, f) => s + f.n, 0) || 1;
  let acumulado = 0;
  const arcos = filas.map((f, i) => {
    const desde = (acumulado / suma) * Math.PI * 2;
    acumulado += f.n;
    const hasta = (acumulado / suma) * Math.PI * 2;
    return { f, i, desde, hasta };
  });
  const punto = (a: number, rad: number) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  const camino = (d: number, h: number) => {
    if (h - d >= Math.PI * 2 - 1e-6) return `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`;
    const [x1, y1] = punto(d, R), [x2, y2] = punto(h, R), [x3, y3] = punto(h, r), [x4, y4] = punto(d, r);
    const grande = h - d > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${R} ${R} 0 ${grande} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${grande} 0 ${x4} ${y4} Z`;
  };
  return (
    <div className="card-cuerpo circular">
      <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label={`${titulo}: ${filas.map((f) => `${f.t} ${pct(f.n, total)}`).join(", ")}`} onMouseLeave={() => setSobre(null)}>
        {arcos.filter((a) => a.f.n > 0).map((a) => (
          <path key={a.f.t} d={camino(a.desde, a.hasta)} fill={color(a.f, a.i)} stroke="var(--superficie)" strokeWidth={2}
            opacity={sobre === null || sobre === a.i ? 1 : 0.35} onMouseEnter={() => setSobre(a.i)} onClick={() => abrir(a.f)} style={{ cursor: a.f.filtro ? "pointer" : "default" }}>
            <title>{ayuda(a.f)}</title>
          </path>
        ))}
        <text x={C} y={C - 2} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--texto)">{sobre !== null ? pct(filas[sobre].n, total) : total.toLocaleString("es-CO")}</text>
        <text x={C} y={C + 13} textAnchor="middle" fontSize="9" fill="var(--texto-3)">{sobre !== null ? (filas[sobre].t.length > 14 ? `${filas[sobre].t.slice(0, 13)}…` : filas[sobre].t) : "en total"}</text>
      </svg>
      <div className="leyenda" role="table" aria-label={`Leyenda de ${titulo}`}>
        {filas.map((f, i) => (
          <button key={f.t} type="button" role="row" className={`leyenda-fila ${f.filtro ? "clic" : ""} ${sobre === i ? "on" : ""}`} title={ayuda(f)}
            onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)} onClick={() => abrir(f)}>
            <span className="muestra" style={{ background: color(f, i) }} aria-hidden="true" />
            <span className="dist-etq">{f.t}</span>
            <span className="dist-valor"><b>{pct(f.n, total)}</b><small>{f.n.toLocaleString("es-CO")}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}
