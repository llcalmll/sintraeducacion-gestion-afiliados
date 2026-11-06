import { useLiveQuery } from "dexie-react-hooks";
import {
  Baby, Briefcase, CalendarCheck, ChevronDown, ChevronUp, FileSpreadsheet, FileText, Mail, MessageCircle, NotebookPen,
  Pencil, Phone, Plus, Receipt, ShieldCheck, Trash2, UserMinus, UserPlus, UserRound, UserX, type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EditarHijo } from "../componentes/EditarHijo";
import { CedulaAdjunta, RegistroCivil } from "../componentes/RegistroCivil";
import { TablaDatos } from "../componentes/TablaDatos";
import { Avatar, Badge, BadgeEntidad, BadgeEstado, BadgeResultado, Pendiente, useUI, Vacio } from "../componentes/ui";
import { db } from "../datos/db";
import { vigente } from "../datos/hooks";
import { useEsAdmin } from "../datos/sesion";
import { eliminarAfiliados } from "../logica/eliminar";
import { useModoDemo } from "../datos/preferencias";
import { ESTADOS, PAG_ALCALDIA_IBAGUE, PAG_IBAGUE, PAG_SIN_DEFINIR, PAG_TOLIMA, SEGUIMIENTOS, type Afiliado, type CruceDetalle, type Hijo } from "../datos/tipos";
import { diasParaCumple, edad, edadHijo, fechaLarga, generoHijo, hoyISO, textoEdadHijo, leerNovedad, nombrePeriodo, periodoActual, periodoAnterior } from "../logica/fechas";
import { borrarRegistroCivil } from "../logica/archivos";
import { formularioAfiliacionPDF } from "../logica/pdf";
import { faltantesAfiliado } from "../logica/pendientes";
import { esVacio, pesos } from "../logica/texto";

type Pestana = "datos" | "hijos" | "descuentos" | "eventos" | "excel";

export default function FichaAfiliado() {
  const id = Number(useParams().id);
  const a = useLiveQuery(() => db.afiliados.get(id), [id]);
  const hijos = useLiveQuery(() => db.hijos.where("afiliadoId").equals(id).toArray(), [id]) ?? [];
  const descuentos = useLiveQuery(() => db.cruceDetalle.where("afiliadoId").equals(id).toArray(), [id]) ?? [];
  const eventos = useLiveQuery(() => db.eventos.filter((e) => e.invitados.includes(id)).toArray(), [id]) ?? [];
  const [pestana, setPestana] = useState<Pestana>("datos");
  const demo = useModoDemo();

  if (a === undefined) return null;
  if (!a) return <div className="contenido"><Vacio titulo="No se encontró el afiliado"><Link to="/">Volver a afiliados</Link></Vacio></div>;
  const faltan = faltantesAfiliado(a, hijos);
  const ultimo = [...descuentos].filter((d) => d.resultado !== "extraordinaria").sort((x, y) => y.periodo.localeCompare(x.periodo))[0];

  return (
    <>
      <div className="contenido ficha">
        <div className="migas peq"><Link to={vigente(a) ? "/" : "/?vista=retirados"}>{vigente(a) ? "Afiliados" : "Retirados"}</Link> / {a.nombre}</div>
        <Encabezado a={a} ultimo={ultimo} />

        <div className="tabs ficha-tabs">
          {([
            ["datos", "Datos", UserRound, null],
            ["hijos", "Hijos", Baby, hijos.length],
            ["descuentos", "Descuentos", Receipt, descuentos.length],
            ["eventos", "Eventos", CalendarCheck, eventos.length],
            ["excel", "Otros datos del Excel", FileSpreadsheet, Object.keys(a.extra).length],
          ] as const).map(([k, t, I, n]) => (
            <button key={k} className={pestana === k ? "on" : ""} onClick={() => setPestana(k)}>
              <I size={15} />{t}{n !== null && <span className="cuenta">{n}</span>}
            </button>
          ))}
        </div>

        {pestana === "datos" && (
          <div className="ficha-grid">
            {GRUPOS.map((g) => <Tarjeta key={g.id} grupo={g} a={a} pedir={demo ? faltan.map((f) => f.campo) : []} />)}
            {demo && faltan.length > 0 && (
              <div className="card ancho">
                <div className="card-cab"><h3>Pendientes para la reunión</h3><span className="accion"><Badge tono="ambar">{faltan.length}</Badge></span></div>
                <div className="card-cuerpo pila" style={{ gap: 8 }}>
                  {faltan.map((f) => <div key={f.campo} className="pendiente"><div><b>{f.campo}. </b>{f.solicitar}</div></div>)}
                </div>
              </div>
            )}
          </div>
        )}
        {pestana !== "datos" && (
          <div className="card">
            <div className="card-cuerpo">
              {pestana === "hijos" && <Hijos afiliadoId={id} hijos={hijos} />}
              {pestana === "descuentos" && (
                descuentos.length === 0 ? <Vacio icono={Receipt} titulo="Sin cruces todavía"><Link to="/descuentos">Revisar descuentos del mes</Link></Vacio> : (
                  <TablaDatos
                    filas={descuentos}
                    clave={(d) => d.id!}
                    sinPaginar
                    ordenInicial={{ id: "periodo", dir: -1 }}
                    columnas={[
                      { id: "periodo", titulo: "Periodo", valor: (d) => d.periodo, celda: (d) => nombrePeriodo(d.periodo) },
                      { id: "r", titulo: "Resultado", celda: (d) => <BadgeResultado r={d.resultado} /> },
                      { id: "v", titulo: "Valor", alinear: "der", valor: (d) => d.valor, celda: (d) => (d.valor ? pesos(d.valor) : "") },
                      { id: "c", titulo: "", celda: (d) => <Link to={`/cruces/${d.cruceId}`}>Ver cruce</Link> },
                    ]}
                  />
                )
              )}
              {pestana === "eventos" && (
                eventos.length === 0 ? <Vacio icono={CalendarCheck} titulo="No ha sido invitado a eventos" /> : (
                  <TablaDatos
                    filas={eventos}
                    clave={(e) => e.id!}
                    sinPaginar
                    columnas={[
                      { id: "n", titulo: "Evento", celda: (e) => <Link to={`/eventos/${e.id}`}>{e.nombre}</Link> },
                      { id: "f", titulo: "Fecha", valor: (e) => e.fecha, celda: (e) => fechaLarga(e.fecha) },
                      { id: "a", titulo: "Asistencia", celda: (e) => (e.asistentes.includes(id) ? <Badge tono="verde">Asistió</Badge> : <Badge>Sin registro</Badge>) },
                    ]}
                  />
                )
              )}
              {pestana === "excel" && (
                <div className="pila">
                  <p className="muted peq">Columnas del Excel original que no tienen un campo propio en la app. Se conservan tal cual y salen igual al exportar.</p>
                  <dl className="dl">{Object.entries(a.extra).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
                  {demo && <Pendiente>qué significan las columnas "2025-01-01", AFILIACIÓN FÍSICA, WT, ANEXO CÉDULA e INST. EDUC.</Pendiente>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ───────────────────────── encabezado: quién es y cómo está, de un vistazo ───────────────────────── */

const telefono = (t: string) => {
  const d = t.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : t;
};
const cedulaConPuntos = (c: string) => c.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

function Encabezado({ a, ultimo }: { a: Afiliado; ultimo?: CruceDetalle }) {
  const tel = a.celular.replace(/\D/g, "");
  const anos = edad(a.fechaNacimiento);
  const cumple = diasParaCumple(a.fechaNacimiento);
  const datos = [
    a.tipo === "docente" ? "Docente" : "Administrativo",
    a.cedula ? `C.C. ${cedulaConPuntos(a.cedula)}` : "Sin cédula",
    anos !== null ? `${anos} años` : null,
    a.municipio && !esVacio(a.municipio) ? a.municipio : null,
  ].filter(Boolean);
  return (
    <div className="card ficha-cab">
      <Avatar nombre={a.nombre} grande />
      <div className="ficha-nombre">
        <h1>{a.nombre}</h1>
        <div className="ficha-sub">{datos.join(" · ")}</div>
        <div className="ficha-chips">
          <BadgeEstado estado={a.estado} />
          <BadgeEntidad p={a.pagador} />
          {ultimo ? (
            ultimo.resultado === "descontado" ? <Badge tono="verde">Descontado en {nombrePeriodo(ultimo.periodo)}</Badge>
              : ultimo.resultado === "sin_descuento" ? <Badge tono="rojo" punto>Sin descuento en {nombrePeriodo(ultimo.periodo)}</Badge>
              : <span className="fila" style={{ gap: 4 }}><BadgeResultado r={ultimo.resultado} /><span className="tenue peq">{nombrePeriodo(ultimo.periodo)}</span></span>
          ) : <Badge>Sin cruces de descuento</Badge>}
          {cumple === 0 && <Badge tono="azul">Cumple años hoy</Badge>}
          {cumple !== null && cumple > 0 && cumple <= 30 && <Badge tono="azul">Cumple en {cumple} {cumple === 1 ? "día" : "días"}</Badge>}
        </div>
      </div>
      <div className="ficha-acciones">
        <div className="fila">
          {tel.length === 10 && <a className="btn btn-wa" href={`https://wa.me/57${tel}`} target="_blank" rel="noreferrer"><MessageCircle size={15} />WhatsApp</a>}
          {tel.length >= 7 && <a className="btn" href={`tel:${tel}`}><Phone size={15} />Llamar</a>}
          {a.correo.includes("@") && <a className="btn" href={`mailto:${a.correo}`}><Mail size={15} />Correo</a>}
        </div>
        <div className="fila">
          <CedulaAdjunta afiliado={a} />
          <button className="btn btn-sm btn-fantasma" onClick={() => formularioAfiliacionPDF(a.tipo, a)}><FileText size={14} />Formato de afiliación</button>
          <RetiroReafiliacion a={a} />
          <EliminarAfiliado a={a} />
        </div>
      </div>
    </div>
  );
}

/** Nota fechada que se agrega al final de las observaciones. */
const conNota = (obs: string, nota: string) => (esVacio(obs) ? nota : `${obs.trim()}\n${nota}`);
const hoyCorto = () => hoyISO().split("-").reverse().join("/");

/**
 * Eliminar por completo (errores de digitación, pruebas, duplicados). Es distinto de retirar: no pasa a Retirados,
 * desaparece de la base. Solo administradores.
 */
function EliminarAfiliado({ a }: { a: Afiliado }) {
  const { confirmar, avisar } = useUI();
  const nav = useNavigate();
  const admin = useEsAdmin();
  if (!admin) return null;
  return (
    <button className="btn btn-sm btn-fantasma btn-peligro" title="Para registros erróneos, de prueba o duplicados. Para quien se retira del sindicato use Retirar." onClick={async () => {
      const nHijos = await db.hijos.where("afiliadoId").equals(a.id!).count();
      if (!(await confirmar({
        titulo: `Eliminar a ${a.nombre}`,
        texto: `Se borra por completo de la base${nHijos ? `, junto con sus ${nHijos === 1 ? "hijo" : `${nHijos} hijos`} y registros civiles` : ""}, y no queda en Retirados. Úselo solo para registros con errores, de prueba o duplicados; si la persona se retira del sindicato, use "Retirar". No se puede deshacer.`,
        boton: "Eliminar definitivamente", peligro: true,
      }))) return;
      await eliminarAfiliados([a]);
      avisar(`${a.nombre} se eliminó de la base`);
      nav("/", { replace: true });
    }}><UserX size={14} />Eliminar</button>
  );
}

/** Retirar a un afiliado activo (pasa a Retirados) o reafiliar a uno retirado. */
function RetiroReafiliacion({ a }: { a: Afiliado }) {
  const { confirmar, avisar } = useUI();
  const cambiar = (cambios: Partial<Afiliado>) =>
    db.afiliados.update(a.id!, { ...cambios, editados: [...new Set([...(a.editados ?? []), ...Object.keys(cambios)])], actualizadoEn: new Date().toISOString() });

  if (vigente(a)) {
    return (
      <button className="btn btn-sm btn-fantasma" onClick={async () => {
        if (!(await confirmar({ titulo: `Retirar a ${a.nombre}`, texto: "Pasa al apartado de Retirados y deja de contar en los descuentos del mes. Si vuelve, se puede reafiliar desde su ficha.", boton: "Retirar", peligro: true }))) return;
        await cambiar({ estado: "retirado", observaciones: conNota(a.observaciones, `Retirado el ${hoyCorto()}.`) });
        avisar("Afiliado movido a Retirados");
      }}><UserMinus size={14} />Retirar</button>
    );
  }
  return (
    <button className="btn btn-sm btn-primario" onClick={async () => {
      if (!(await confirmar({ titulo: `Reafiliar a ${a.nombre}`, texto: "Vuelve a quedar afiliado, como pendiente de novedad hasta que aparezca su primer descuento. La fecha de afiliación pasa a ser hoy.", boton: "Reafiliar" }))) return;
      await cambiar({
        estado: "pendiente_novedad", fechaAfiliacion: hoyISO(),
        // Como en una afiliación nueva: la novedad se envía este mes y el descuento se espera desde el siguiente.
        novedadPeriodo: periodoAnterior(periodoActual(), -1),
        observaciones: conNota(a.observaciones, `Reafiliado el ${hoyCorto()}.`),
      });
      avisar("Afiliado de nuevo, pendiente de novedad");
    }}><UserPlus size={14} />Reafiliar</button>
  );
}

/* ───────────────────────── tarjetas por tema ───────────────────────── */

type Opcion = { v: string; t: string };
interface Campo {
  k: keyof Afiliado;
  t: string;
  tipo?: "fecha" | "opciones" | "largo";
  opciones?: (a: Afiliado) => Opcion[];
  /** Cómo se muestra (si no, el texto tal cual). */
  ver?: (a: Afiliado) => ReactNode;
  /** Va detrás de "Más información". */
  mas?: boolean;
  /** No se edita aquí. */
  fijo?: boolean;
  /** Nombre del pendiente de la reunión (modo demo). */
  pedir?: string;
  ancho?: boolean;
}
interface Grupo { id: string; titulo: string; ayuda: string; icono: LucideIcon; tono: string; campos: Campo[]; ancho?: boolean }

const fecha = (k: "fechaNacimiento" | "fechaAfiliacion" | "fechaPosesion", conEdad = false) => (a: Afiliado) => {
  const f = a[k];
  if (!f) return k === "fechaPosesion" ? "" : a[`${k}Original` as "fechaNacimientoOriginal"] || "";
  const anos = edad(f);
  return conEdad && anos !== null ? <>{fechaLarga(f)} <span className="tenue">({anos} años)</span></> : fechaLarga(f);
};

/** Opciones fijas más el valor actual (si es distinto), para no perder lo que ya estaba escrito. */
const lista = (fijas: string[], actual: string): Opcion[] =>
  [...new Set([...(actual && !fijas.includes(actual) ? [actual] : []), ...fijas, ""])].map((v) => ({ v, t: v || "Sin dato" }));

const GRUPOS: Grupo[] = [
  {
    id: "contacto", titulo: "Contacto", ayuda: "Cómo comunicarse", icono: Phone, tono: "azul",
    campos: [
      { k: "celular", t: "Celular", pedir: "Celular", ver: (a) => telefono(a.celular) },
      { k: "correo", t: "Correo", pedir: "Correo" },
      { k: "otroCelular", t: "Otro celular", mas: true, ver: (a) => telefono(a.otroCelular) },
      { k: "telefonoFijo", t: "Teléfono fijo", mas: true },
      { k: "municipio", t: "Municipio", mas: true },
      { k: "comuna", t: "Comuna", mas: true },
    ],
  },
  {
    id: "sindicato", titulo: "Afiliación al sindicato", ayuda: "Estado y descuento de la cuota", icono: ShieldCheck, tono: "verde",
    campos: [
      { k: "estado", t: "Estado", tipo: "opciones", pedir: "Estado", ver: (a) => <BadgeEstado estado={a.estado} />, opciones: () => Object.entries(ESTADOS).map(([v, t]) => ({ v, t })) },
      {
        k: "pagador", t: "Entidad que descuenta", tipo: "opciones", pedir: "Entidad que descuenta", ver: (a) => <BadgeEntidad p={a.pagador} />,
        opciones: (a) => [...new Set([PAG_IBAGUE, PAG_TOLIMA, PAG_ALCALDIA_IBAGUE, a.pagador, PAG_SIN_DEFINIR])].map((v) => ({ v, t: v.toLocaleUpperCase("es-CO") })),
      },
      { k: "fechaAfiliacion", t: "Afiliado desde", tipo: "fecha", ver: fecha("fechaAfiliacion") },
      {
        k: "tipo", t: "Tipo", tipo: "opciones", pedir: "Tipo", mas: true,
        opciones: () => [{ v: "docente", t: "Docente" }, { v: "administrativo", t: "Administrativo" }],
        ver: (a) => <span className="fila" style={{ gap: 6 }}>{a.tipo === "docente" ? "Docente" : "Administrativo"}{a.tipoInferido && <Badge tono="ambar">deducido del cargo</Badge>}</span>,
      },
      { k: "quienAfilia", t: "Quién lo afilió", mas: true },
      { k: "directiva", t: "Es de la directiva", mas: true },
      { k: "cargoDirectivo", t: "Cargo directivo", mas: true },
      { k: "sindicatoRetirado", t: "Sindicato del que se retiró", mas: true },
      { k: "seguimientoNovedad", t: "Seguimiento de la novedad", tipo: "opciones", mas: true, opciones: () => SEGUIMIENTOS.map((v) => ({ v, t: v || "Sin seguimiento" })) },
      { k: "hojas", t: "Hojas del Excel", mas: true, fijo: true, ver: (a) => a.hojas.join(", ") || "Creado en la app" },
    ],
  },
  {
    id: "trabajo", titulo: "Trabajo", ayuda: "Dónde y en qué trabaja", icono: Briefcase, tono: "morado",
    campos: [
      { k: "institucion", t: "Institución", ancho: true },
      { k: "cargo", t: "Cargo" },
      { k: "area", t: "Área" },
      { k: "vinculacion", t: "Provisional o carrera", mas: true, tipo: "opciones", opciones: (a) => lista(["CARRERA", "PROVISIONAL", "SIN DATO"], a.vinculacion) },
      { k: "fechaPosesion", t: "Fecha de posesión", tipo: "fecha", mas: true, ver: fecha("fechaPosesion") },
      { k: "cajaCompensacion", t: "Caja de compensación", mas: true, tipo: "opciones", opciones: (a) => lista(["COMFENALCO", "COMFATOLIMA", "CAFASUR", "SIN DATO"], a.cajaCompensacion) },
    ],
  },
  {
    id: "personal", titulo: "Datos personales", ayuda: "Identificación", icono: UserRound, tono: "cian",
    campos: [
      { k: "cedula", t: "Cédula", pedir: "Cédula", ver: (a) => (a.cedula ? cedulaConPuntos(a.cedula) : "") },
      { k: "fechaNacimiento", t: "Fecha de nacimiento", tipo: "fecha", pedir: "Fecha de nacimiento", ver: fecha("fechaNacimiento", true) },
      { k: "sexo", t: "Sexo", tipo: "opciones", ver: (a) => ({ F: "Femenino", M: "Masculino" })[a.sexo.trim().toUpperCase()] ?? a.sexo, opciones: () => [{ v: "", t: "Sin dato" }, { v: "F", t: "Femenino" }, { v: "M", t: "Masculino" }] },
      { k: "cedulaExpedidaEn", t: "Cédula expedida en", mas: true },
      { k: "nombre", t: "Nombre completo (como en el Excel)", mas: true, ancho: true },
    ],
  },
  {
    id: "observaciones", titulo: "Observaciones", ayuda: "Notas del sindicato sobre esta persona", icono: NotebookPen, tono: "gris", ancho: true,
    campos: [{ k: "observaciones", t: "Observaciones", tipo: "largo", ancho: true }],
  },
];

const vacio = (v: unknown) => v === null || v === undefined || v === "" || (typeof v === "string" && esVacio(v));
const valorDe = (a: Afiliado, c: Campo) => (c.ver ? c.ver(a) : (a[c.k] as string));

function Tarjeta({ grupo, a, pedir }: { grupo: Grupo; a: Afiliado; pedir: string[] }) {
  const [mas, setMas] = useState(false);
  const [borrador, setBorrador] = useState<Partial<Afiliado> | null>(null);
  const [guardando, setGuardando] = useState(false);
  const { avisar } = useUI();
  const editando = borrador !== null;
  const principales = grupo.campos.filter((c) => !c.mas);
  const ocultos = grupo.campos.filter((c) => c.mas);
  const sinDato = grupo.campos.filter((c) => !c.fijo && vacio(valorDe(a, c))).length;
  const ocultosConDato = ocultos.filter((c) => !vacio(valorDe(a, c))).length;
  // Si hay un pendiente de la reunión en un dato oculto, se muestra sin tener que buscarlo.
  const pendienteOculto = ocultos.some((c) => c.pedir && pedir.includes(c.pedir));
  const visibles = editando || mas || pendienteOculto ? grupo.campos : principales;

  useEffect(() => {
    if (!editando) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setBorrador(null);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [editando]);

  async function guardar() {
    if (!borrador) return;
    setGuardando(true);
    const n = await guardarCambios(a, borrador);
    setGuardando(false);
    setBorrador(null);
    avisar(n ? `${grupo.titulo}: cambios guardados` : "No hubo cambios");
  }

  return (
    <div className={`card fcard tono-${grupo.tono} ${grupo.ancho ? "ancho" : ""} ${editando ? "editando" : ""}`}>
      <div className="fcard-cab">
        <span className="fcard-icono"><grupo.icono size={17} /></span>
        <div style={{ minWidth: 0 }}>
          <h3>{grupo.titulo}</h3>
          <div className="peq tenue">{editando ? "Editando: los cambios se guardan para todos" : sinDato ? `${grupo.ayuda} · ${sinDato} ${sinDato === 1 ? "dato vacío" : "datos vacíos"}` : grupo.ayuda}</div>
        </div>
        {!editando && (
          <button className="btn btn-sm btn-fantasma accion" onClick={() => setBorrador({})} title={`Editar ${grupo.titulo.toLowerCase()}`}>
            <Pencil size={14} />Editar
          </button>
        )}
      </div>

      <form
        className="fcard-campos"
        onSubmit={(e) => { e.preventDefault(); guardar(); }}
      >
        {visibles.map((c) => {
          const v = valorDe(a, c);
          const marcarPedir = c.pedir && pedir.includes(c.pedir);
          return (
            <div key={c.k} className={`fcard-campo ${c.ancho ? "ancho" : ""} ${c.mas ? "secundario" : ""}`}>
              <div className="fcard-etq">{c.t}{marcarPedir && <span className="pendiente-chip">pedir</span>}</div>
              {editando && !c.fijo ? (
                <Entrada campo={c} a={a} valor={borrador![c.k]} onCambio={(val) => setBorrador((b) => ({ ...b, [c.k]: val }))} />
              ) : (
                <div className="fcard-valor">{vacio(v) ? <span className="sin-dato">Sin dato</span> : v}</div>
              )}
            </div>
          );
        })}
        {editando && (
          <div className="fcard-pie ancho">
            <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
            <button type="button" className="btn" onClick={() => setBorrador(null)}>Cancelar</button>
          </div>
        )}
      </form>

      {!editando && ocultos.length > 0 && !pendienteOculto && (
        <button className="fcard-mas" onClick={() => setMas((m) => !m)} aria-expanded={mas}>
          {mas ? <><ChevronUp size={15} />Menos información</> : <><ChevronDown size={15} />Más información <span className="tenue">({ocultosConDato} de {ocultos.length} con datos)</span></>}
        </button>
      )}
    </div>
  );
}

/** Campo en modo edición. El valor del borrador manda; si no se ha tocado, se muestra el actual. */
function Entrada({ campo: c, a, valor, onCambio }: { campo: Campo; a: Afiliado; valor: unknown; onCambio: (v: unknown) => void }) {
  const actual = valor === undefined ? a[c.k] : valor;
  const texto = actual === null || actual === undefined ? "" : String(actual);
  if (c.tipo === "opciones") {
    return (
      <select className="select" value={texto} onChange={(e) => onCambio(e.target.value)}>
        {c.opciones!(a).map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
    );
  }
  if (c.tipo === "largo") return <textarea className="input" rows={4} value={texto} onChange={(e) => onCambio(e.target.value)} />;
  if (c.tipo === "fecha") return <input className="input" type="date" value={texto} onChange={(e) => onCambio(e.target.value || null)} />;
  return <input className="input" value={texto} onChange={(e) => onCambio(e.target.value)} inputMode={c.k === "cedula" || /celular|telefono/i.test(c.k) ? "numeric" : undefined} />;
}

/**
 * Guarda los campos que cambiaron. Igual que al editar en la vista de Excel: se marcan como "editados",
 * así salen en el Excel descargado y en las hojas, y se envían a los demás equipos.
 */
async function guardarCambios(a: Afiliado, borrador: Partial<Afiliado>): Promise<number> {
  const cambios: Partial<Afiliado> = {};
  for (const [k, v0] of Object.entries(borrador) as [keyof Afiliado, unknown][]) {
    let v = v0;
    if (k === "cedula") v = String(v ?? "").replace(/\D/g, "") || null;
    else if (typeof v === "string" && k !== "observaciones") v = v.trim();
    if (v !== a[k]) (cambios as Record<string, unknown>)[k] = v;
  }
  const claves = Object.keys(cambios);
  if (!claves.length) return 0;
  if ("fechaNacimiento" in cambios) cambios.fechaNacimientoOriginal = cambios.fechaNacimiento ?? "";
  if ("fechaAfiliacion" in cambios) cambios.fechaAfiliacionOriginal = cambios.fechaAfiliacion ?? "";
  if ("tipo" in cambios) cambios.tipoInferido = false;
  if ("observaciones" in cambios) cambios.novedadPeriodo = leerNovedad(cambios.observaciones ?? "");
  await db.afiliados.update(a.id!, {
    ...cambios,
    editados: [...new Set([...(a.editados ?? []), ...claves])],
    actualizadoEn: new Date().toISOString(),
  });
  return claves.length;
}

/* ───────────────────────── hijos ───────────────────────── */

function Hijos({ afiliadoId, hijos }: { afiliadoId: number; hijos: Hijo[] }) {
  const demo = useModoDemo();
  const [nombre, setNombre] = useState("");
  const [fechaN, setFecha] = useState("");
  const [editando, setEditando] = useState<Hijo | null>(null);
  const { confirmar, avisar } = useUI();
  return (
    <div className="pila">
      {hijos.length === 0 ? <Vacio icono={Baby} titulo="No tiene hijos registrados" /> : (
        <TablaDatos
          filas={hijos}
          clave={(h) => h.id!}
          onFila={setEditando}
          sinPaginar
          columnas={[
            { id: "n", titulo: "Nombre", valor: (h) => h.nombre, celda: (h) => <b>{h.nombre}</b> },
            { id: "f", titulo: "Nacimiento", valor: (h) => h.fechaNacimiento, celda: (h) => (h.fechaNacimiento ? fechaLarga(h.fechaNacimiento) : <span className="vacio-celda">{h.fechaNacimientoOriginal || "—"}</span>) },
            { id: "e", titulo: "Edad", alinear: "der", valor: (h) => edadHijo(h).anos, celda: (h) => <span title={edadHijo(h).aprox ? "Edad aproximada, según la edad que reportaron en el formulario de inscripción (falta la fecha de nacimiento)" : undefined}>{textoEdadHijo(edadHijo(h))}</span> },
            { id: "g", titulo: "Género", valor: (h) => h.sexo ?? "", celda: (h) => generoHijo(h.sexo) || <span className="vacio-celda">—</span> },
            {
              id: "a", titulo: "Afiliado al servicio", oculta: !demo,
              celda: (h) => (
                <select className="select" style={{ height: 30, width: 170 }} onClick={(e) => e.stopPropagation()} value={h.afiliado === null ? "" : h.afiliado ? "si" : "no"}
                  onChange={(e) => db.hijos.update(h.id!, { afiliado: e.target.value === "" ? null : e.target.value === "si" })}>
                  <option value="">Sin confirmar</option><option value="si">Sí, afiliado</option><option value="no">No afiliado</option>
                </select>
              ),
            },
            { id: "r", titulo: "Registro civil", celda: (h) => <RegistroCivil hijo={h} /> },
            {
              id: "x", titulo: "",
              celda: (h) => (
                <span className="fila" style={{ gap: 2 }}>
                <button className="btn btn-sm btn-fantasma btn-icono" title="Editar" onClick={(e) => { e.stopPropagation(); setEditando(h); }}><Pencil size={14} /></button>
                <button className="btn btn-sm btn-fantasma btn-icono" title="Quitar" onClick={async (e) => {
                  e.stopPropagation();
                  if (await confirmar({ titulo: `Quitar a ${h.nombre}`, texto: `Se elimina de la lista de hijos de este afiliado${h.registroCivilArchivo ? ", junto con su registro civil adjunto" : ""}.`, boton: "Quitar", peligro: true })) {
                    await db.hijos.delete(h.id!);
                    if (h.registroCivilArchivo) borrarRegistroCivil(h.registroCivilArchivo.clave).catch(() => {});
                    avisar("Hijo eliminado");
                  }
                }}><Trash2 size={15} /></button>
                </span>
              ),
            },
          ]}
        />
      )}
      {editando && <EditarHijo hijo={editando} cerrar={() => setEditando(null)} />}
      {demo && hijos.some((h) => h.afiliado === null) && <Pendiente>cómo saber si cada hijo está afiliado al servicio. La base solo trae nombre, fecha y registro civil.</Pendiente>}
      <form className="fila-wrap" style={{ alignItems: "flex-end" }} onSubmit={async (e) => {
        e.preventDefault();
        if (!nombre.trim()) return;
        await db.hijos.add({ afiliadoId, nombre: nombre.trim(), fechaNacimiento: fechaN || null, fechaNacimientoOriginal: fechaN, registroCivil: "", afiliado: null });
        setNombre(""); setFecha(""); avisar("Hijo agregado");
      }}>
        <div style={{ flex: 2, minWidth: 200 }}><label className="etq">Nombre del hijo</label><input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div style={{ flex: 1, minWidth: 160 }}><label className="etq">Fecha de nacimiento</label><input className="input" type="date" value={fechaN} onChange={(e) => setFecha(e.target.value)} /></div>
        <button className="btn"><Plus size={15} />Agregar hijo</button>
      </form>
    </div>
  );
}
