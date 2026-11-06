import { useLiveQuery } from "dexie-react-hooks";
import { Bot, CircleAlert, Download, FileSpreadsheet, FileText, MessageCircle, Paperclip, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { db, vigilar } from "../datos/db";
import { abrirAsistente, enlaceWhatsApp, leerModeloIA, primerNombre, useAsistenteAbierto, useMensajeWhatsApp } from "../datos/preferencias";
import { useSesion } from "../datos/sesion";
import { ESTADOS_CONTACTO, nombreFuente, RESULTADOS, type Afiliado, type Contacto, type EstadoContacto, type Hijo } from "../datos/tipos";
import { consultarEstado, ErrorAsistente, instrucciones, turnoAgente, type EstadoIA, type MensajeIA } from "../ia/agente";
import { ejecutar, ETIQUETAS, resumenDelDia, type Bloque, type Contexto, type ResultadoHerramienta } from "../ia/herramientas";
import { responderSinIA } from "../ia/sinIA";
import { diaMes, fechaLarga, nombrePeriodo } from "../logica/fechas";
import { exportarAsistenciaExcel } from "../logica/exportar";
import { planillaAsistenciaPDF } from "../logica/pdf";
import { pesos } from "../logica/texto";
import { mensajeWhatsApp, type Cumple } from "../pantallas/Cumpleanos";
import { Avatar, Badge, BadgeEntidad, useUI } from "./ui";

type Item =
  | { id: number; rol: "usuario"; texto: string; adjuntos?: string[] }
  | { id: number; rol: "asistente"; texto?: string; nodo?: ReactNode }
  | { id: number; rol: "bloque"; bloque: Bloque }
  | { id: number; rol: "aviso"; texto: string };
type SinId<T> = T extends unknown ? Omit<T, "id"> : never;

const SUGERENCIAS = [
  "¿Qué tengo pendiente hoy?",
  "¿A quién no le descontaron?",
  "Cumpleaños de esta semana",
  "Casos para revisar del mes",
  "Crear una asamblea para el viernes con los de Ibagué",
];

let siguienteId = 1;

/* ───────────────────────── Estado de la conexión con OpenAI ───────────────────────── */

let estadoCache: EstadoIA | null = null;
const oyentesEstado = new Set<(e: EstadoIA) => void>();

export async function refrescarEstadoIA(): Promise<EstadoIA> {
  estadoCache = await consultarEstado();
  oyentesEstado.forEach((f) => f(estadoCache!));
  return estadoCache;
}

export function useEstadoIA(): EstadoIA | null {
  const [e, setE] = useState<EstadoIA | null>(estadoCache);
  useEffect(() => {
    oyentesEstado.add(setE);
    if (!estadoCache) refrescarEstadoIA();
    return () => { oyentesEstado.delete(setE); };
  }, []);
  return e;
}

/* ───────────────────────── Panel ───────────────────────── */

export function AsistenteIA() {
  const abierto = useAsistenteAbierto();
  const estado = useEstadoIA();
  const usuario = useSesion() ?? "";
  const { confirmar } = useUI();
  const nav = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [historial, setHistorial] = useState<MensajeIA[]>([]);
  const [texto, setTexto] = useState("");
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const adjuntosRef = useRef<File[]>([]);
  const fin = useRef<HTMLDivElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const pendientes = useLiveQuery(async () => {
    await vigilar(db.afiliados, db.hijos, db.cruces, db.cruceDetalle, db.contactos);
    const r = await resumenDelDia();
    return ((r.paraIA.por_contactar as number) ?? 0) + ((r.paraIA.cumpleanos_hoy as { afiliados: number; hijos: number }).afiliados ?? 0);
  }, []);
  const conIA = !!estado?.configurada && !estado.error;

  useEffect(() => { adjuntosRef.current = adjuntos; }, [adjuntos]);
  // Al abrir el panel se revisa de nuevo la clave: si la acaban de poner, ya queda con IA.
  useEffect(() => { if (abierto) refrescarEstadoIA(); }, [abierto]);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [items, ocupado]);
  useEffect(() => {
    document.querySelector(".app")?.classList.toggle("con-asistente", abierto);
  }, [abierto]);

  const agregar = useCallback((nuevos: SinId<Item>[]) => {
    setItems((xs) => [...xs, ...nuevos.map((n) => ({ ...n, id: siguienteId++ }) as Item)]);
  }, []);

  const ctx: Contexto = {
    navegar: (ruta, estadoNav) => nav(ruta, estadoNav ? { state: estadoNav } : undefined),
    tomarAdjuntos: () => {
      const fs = adjuntosRef.current;
      adjuntosRef.current = [];
      setAdjuntos([]);
      return fs;
    },
    usuario,
    confirmar,
  };

  // Saludo con los pendientes del día, calculado en el equipo (no gasta IA). Si cambian los
  // meses cargados y la secretaria todavía no ha escrito nada, el saludo se rehace.
  const saludando = useRef(false);
  const cruces = useLiveQuery(() => db.cruces.count(), []);
  const crucesSaludo = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (abierto && cruces !== crucesSaludo.current && items.length && items.every((i) => i.rol !== "usuario")) setItems([]);
  }, [cruces]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!abierto || items.length || saludando.current) return;
    saludando.current = true;
    crucesSaludo.current = cruces;
    resumenDelDia()
      .then((r) => agregar([{ rol: "asistente", texto: textoResumen(r) }, ...(r.bloques ?? []).map((bloque) => ({ rol: "bloque" as const, bloque }))]))
      .finally(() => { saludando.current = false; });
  }, [abierto, items.length, agregar]);

  async function enviar(t: string) {
    const archivos = adjuntosRef.current;
    const pregunta = t.trim() || (archivos.length ? "Revise estos archivos del mes." : "");
    if (!pregunta || ocupado) return;
    setTexto("");
    agregar([{ rol: "usuario", texto: pregunta, adjuntos: archivos.map((f) => f.name) }]);
    setOcupado("Pensando");
    try {
      if (conIA) await conModelo(pregunta, archivos);
      else await sinModelo(pregunta, archivos);
    } finally {
      setOcupado(null);
    }
  }

  async function conModelo(pregunta: string, archivos: File[]) {
    const base: MensajeIA[] = historial.length ? historial : [{ role: "system", content: instrucciones() }];
    const contenido = archivos.length ? `${pregunta}\n\n[Adjuntó ${archivos.length} archivo(s): ${archivos.map((f) => f.name).join(", ")}]` : pregunta;
    try {
      const nuevo = await turnoAgente([...base, { role: "user", content: contenido }], ctx, leerModeloIA(), (e) => {
        if (e.tipo === "texto") agregar([{ rol: "asistente", texto: e.texto }]);
        if (e.tipo === "bloque") agregar([{ rol: "bloque", bloque: e.bloque }]);
        if (e.tipo === "herramienta") setOcupado(ETIQUETAS[e.nombre] ?? "Trabajando");
      });
      setHistorial(recortar(nuevo));
    } catch (e) {
      const msg = e instanceof ErrorAsistente ? e.message : "No pude usar la IA.";
      agregar([{ rol: "aviso", texto: `${msg} Le respondo en modo básico.` }]);
      await sinModelo(pregunta, archivos.length ? archivos : ctx.tomarAdjuntos());
    }
  }

  async function sinModelo(pregunta: string, archivos: File[]) {
    if (archivos.length) {
      adjuntosRef.current = archivos;
      setOcupado(ETIQUETAS.subir_reportes_adjuntos);
      const r = await ejecutar("subir_reportes_adjuntos", {}, ctx);
      agregar([{ rol: "asistente", texto: textoCruce(r) }, ...(r.bloques ?? []).map((bloque) => ({ rol: "bloque" as const, bloque }))]);
      return;
    }
    const afiliados = await db.afiliados.toArray();
    const hijos = new Map<number, Hijo[]>();
    for (const h of await db.hijos.toArray()) hijos.set(h.afiliadoId, [...(hijos.get(h.afiliadoId) ?? []), h]);
    const n = /pendiente|hoy tengo|qué hay/i.test(pregunta) ? null : await responderSinIA(pregunta, afiliados, hijos);
    if (n === null) {
      const r = await resumenDelDia();
      agregar([{ rol: "asistente", texto: textoResumen(r) }, ...(r.bloques ?? []).map((bloque) => ({ rol: "bloque" as const, bloque }))]);
    } else agregar([{ rol: "asistente", nodo: n }]);
  }

  const soltar = (fs: File[]) => {
    const validos = fs.filter((f) => /\.(xlsx?|pdf)$/i.test(f.name));
    if (validos.length) setAdjuntos((a) => [...a.filter((x) => !validos.some((v) => v.name === x.name)), ...validos]);
  };

  if (!abierto) {
    return (
      <button className="fab-asistente" onClick={() => abrirAsistente(true)} title="Abrir el asistente">
        <Sparkles size={18} />Asistente
        {!!pendientes && <span className="contador">{pendientes}</span>}
      </button>
    );
  }

  return (
    <aside
      className={`asistente ${encima ? "encima" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setEncima(false); }}
      onDrop={(e) => { e.preventDefault(); setEncima(false); soltar([...e.dataTransfer.files]); }}
      aria-label="Asistente"
    >
      <div className="asistente-cab">
        <span className="avatar" style={{ background: "var(--primario-suave)", color: "var(--primario)" }}><Sparkles size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>Asistente</b>
          <div className="peq tenue">{conIA ? `Con IA · ${estado?.modelo ?? ""}` : "Modo básico (sin IA)"}</div>
        </div>
        <button className="btn btn-sm btn-fantasma btn-icono" title="Nueva conversación" onClick={() => { setItems([]); setHistorial([]); setAdjuntos([]); }}><RotateCcw size={15} /></button>
        <button className="btn btn-sm btn-fantasma btn-icono" title="Cerrar" onClick={() => abrirAsistente(false)}><X size={16} /></button>
      </div>

      <div className="asistente-chat">
        {items.map((it) =>
          it.rol === "usuario" ? (
            <div key={it.id} className="burbuja yo">
              {it.texto}
              {it.adjuntos?.length ? <div className="peq" style={{ opacity: 0.85, marginTop: 4 }}>{it.adjuntos.map((a) => <div key={a} className="fila" style={{ gap: 4 }}><Paperclip size={12} />{a}</div>)}</div> : null}
            </div>
          ) : it.rol === "asistente" ? (
            <div key={it.id} className="burbuja ia" style={{ whiteSpace: it.texto ? "pre-wrap" : undefined }}>{it.texto ? formatear(it.texto) : it.nodo}</div>
          ) : it.rol === "aviso" ? (
            <div key={it.id} className="aviso error"><CircleAlert size={15} />{it.texto}</div>
          ) : (
            <VistaBloque key={it.id} b={it.bloque} />
          ),
        )}
        {ocupado && <div className="burbuja ia pensando"><span className="puntos"><i /><i /><i /></span>{ocupado}…</div>}
        {!ocupado && items.length <= 3 && (
          <div className="fila-wrap" style={{ marginTop: 4 }}>
            {SUGERENCIAS.map((s) => <button key={s} className="btn btn-sm" onClick={() => enviar(s)}>{s}</button>)}
          </div>
        )}
        <div ref={fin} />
      </div>

      {encima && <div className="asistente-soltar"><FileSpreadsheet size={28} />Suelte aquí el Excel o PDF de descuentos</div>}

      <form className="asistente-pie" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
        {adjuntos.length > 0 && (
          <div className="fila-wrap" style={{ marginBottom: 8 }}>
            {adjuntos.map((f) => (
              <span key={f.name} className="badge azul">
                {/\.pdf$/i.test(f.name) ? <FileText size={12} /> : <FileSpreadsheet size={12} />}{f.name}
                <X size={12} style={{ cursor: "pointer" }} onClick={() => setAdjuntos(adjuntos.filter((x) => x !== f))} />
              </span>
            ))}
          </div>
        )}
        <div className="fila">
          <input ref={archivoRef} type="file" accept=".xls,.xlsx,.pdf" multiple hidden onChange={(e) => { soltar([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <button type="button" className="btn btn-icono" title="Adjuntar el Excel del mes" onClick={() => archivoRef.current?.click()}><Paperclip size={16} /></button>
          <input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={adjuntos.length ? "Escriba algo o envíe así" : "Escriba su pregunta o suelte el Excel aquí"} disabled={!!ocupado} />
          <button className="btn btn-primario btn-icono" disabled={!!ocupado || (!texto.trim() && !adjuntos.length)} title="Enviar"><Send size={16} /></button>
        </div>
      </form>
    </aside>
  );
}

/**
 * Mantiene la conversación corta sin romperla: conserva las instrucciones y corta siempre
 * desde una pregunta del usuario, para que ninguna respuesta de herramienta quede sin su llamada.
 */
function recortar(m: MensajeIA[]): MensajeIA[] {
  if (m.length <= 60) return m;
  for (let i = m.length - 40; i < m.length; i++) if (m[i].role === "user") return [m[0], ...m.slice(i)];
  return [m[0], ...m.slice(-1)];
}

/** **negrita** en el texto de la IA. */
function formatear(t: string): ReactNode {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p));
}

function textoResumen(r: ResultadoHerramienta): string {
  const p = r.paraIA as Record<string, unknown>;
  const hora = new Date().getHours();
  const lineas = [`${hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches"}. Esto es lo que tiene pendiente:`];
  if (p.reporte_pendiente_por_subir) lineas.push(`• Falta subir el reporte de descuentos de ${p.reporte_pendiente_por_subir}.`);
  if (p.ultimo_mes_revisado) {
    lineas.push(`• ${p.por_contactar} personas por contactar de ${p.ultimo_mes_revisado} (de ${p.no_les_descontaron} sin descuento).`);
    if (p.dos_meses_o_mas_sin_descuento) lineas.push(`• ${p.dos_meses_o_mas_sin_descuento} llevan dos meses o más sin descuento.`);
    if (p.retirados_con_descuento) lineas.push(`• ${p.retirados_con_descuento} retirados a los que les siguen descontando.`);
  }
  const c = p.cumpleanos_hoy as { afiliados: number; hijos: number };
  if (c.afiliados || c.hijos) lineas.push(`• Hoy cumplen años ${c.afiliados} afiliados${c.hijos ? ` y ${c.hijos} hijos` : ""}.`);
  if (lineas.length === 1) lineas.push("• Nada urgente. Puede soltar aquí el Excel del mes cuando llegue.");
  lineas.push("", "Puede preguntarme lo que necesite o soltar aquí el archivo del mes.");
  return lineas.join("\n");
}

function textoCruce(r: ResultadoHerramienta): string {
  const p = r.paraIA as Record<string, unknown>;
  if (p.error) return String(p.error);
  const l = [`Listo, comparé los archivos de ${p.mes} con la base:`, `• ${p.no_les_descontaron} personas no tuvieron descuento.`];
  if (p.dos_meses_o_mas_sin_descuento) l.push(`• ${p.dos_meses_o_mas_sin_descuento} de ellas llevan dos meses o más: empiece por esas.`);
  if (p.retirados_con_descuento) l.push(`• ${p.retirados_con_descuento} retirados siguen con descuento: hay que pedir la novedad de retiro en pagaduría.`);
  if (p.descontados_sin_estar_en_la_base) l.push(`• ${p.descontados_sin_estar_en_la_base} descontados no están en la base: puede ser una afiliación sin registrar.`);
  if ((p.entidades_que_faltan as string[]).length) l.push(`• Falta el reporte de: ${(p.entidades_que_faltan as string[]).join(", ")}.`);
  return l.join("\n");
}

/* ───────────────────────── Bloques ───────────────────────── */

function VistaBloque({ b }: { b: Bloque }) {
  const nav = useNavigate();
  switch (b.t) {
    case "afiliados": return <BloqueAfiliados b={b} />;
    case "cumples": return <BloqueCumples titulo={b.titulo} items={b.items} />;
    case "cruce": return <BloqueCruce id={b.cruceId} />;
    case "detalle": return <BloqueDetalle b={b} />;
    case "evento": return <BloqueEvento id={b.eventoId} />;
    case "aviso": return <div className={`aviso ${b.tono}`}>{b.texto}</div>;
    case "botones": return <div className="fila-wrap">{b.items.map((x) => <button key={x.texto} className="btn btn-sm" onClick={() => nav(x.ruta)}>{x.texto}</button>)}</div>;
  }
}

function BloqueAfiliados({ b }: { b: Extract<Bloque, { t: "afiliados" }> }) {
  const nav = useNavigate();
  const mensaje = useMensajeWhatsApp();
  const filas = useLiveQuery(async () => (await db.afiliados.bulkGet(b.ids.slice(0, 6))).filter((a): a is Afiliado => !!a), [b.ids.join(",")]) ?? [];
  const contactos = useLiveQuery(
    async () => new Map<string, Contacto>(b.contacto ? (await db.contactos.where("periodo").equals(b.contacto.periodo).toArray()).map((c) => [c.cedula, c]) : []),
    [b.contacto?.periodo],
  );
  return (
    <div className="bloque-ia">
      <div className="fila" style={{ marginBottom: 6 }}><b>{b.titulo}</b><span className="espacio" /><Badge>{b.total}</Badge></div>
      {b.total === 0 && <div className="peq muted">Nadie en este grupo.</div>}
      {filas.map((a) => {
        const est: EstadoContacto | null = b.contacto && a.cedula ? contactos?.get(a.cedula)?.estado ?? "pendiente" : null;
        const wa = b.contacto ? enlaceWhatsApp(a.celular, mensaje.replaceAll("{nombre}", primerNombre(a.nombre)).replaceAll("{mes}", nombrePeriodo(b.contacto.periodo))) : null;
        return (
          <div key={a.id} className="fila fila-ia" onClick={() => nav(`/afiliados/${a.id}`)}>
            <Avatar nombre={a.nombre} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="corta"><b>{a.nombre}</b></div>
              <div className="fila" style={{ gap: 6 }}><BadgeEntidad p={a.pagador} corta />{est && <Badge tono={ESTADOS_CONTACTO[est].tono}>{ESTADOS_CONTACTO[est].titulo}</Badge>}</div>
            </div>
            {wa && (
              <a className="btn btn-sm btn-icono btn-wa" href={wa} target="_blank" rel="noreferrer" title="Escribir por WhatsApp"
                onClick={(e) => {
                  e.stopPropagation();
                  if (est === "pendiente" && a.cedula) db.contactos.put({ periodo: b.contacto!.periodo, cedula: a.cedula, estado: "contactada", nota: contactos?.get(a.cedula)?.nota ?? "", actualizadoEn: new Date().toISOString() });
                }}>
                <MessageCircle size={14} />
              </a>
            )}
          </div>
        );
      })}
      {b.enlace && b.total > 0 && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => nav(b.enlace!.ruta)}>{b.enlace.texto}{b.total > 6 ? ` (${b.total})` : ""}</button>}
    </div>
  );
}

function BloqueCumples({ titulo, items }: { titulo: string; items: Cumple[] }) {
  const nav = useNavigate();
  return (
    <div className="bloque-ia">
      <div className="fila" style={{ marginBottom: 6 }}><b>{titulo}</b><span className="espacio" /><Badge>{items.length}</Badge></div>
      {items.length === 0 && <div className="peq muted">Nadie en esas fechas.</div>}
      {items.slice(0, 6).map((c) => {
        const wa = mensajeWhatsApp(c);
        return (
          <div key={c.clave} className="fila fila-ia" onClick={() => nav(`/afiliados/${c.afiliadoId}`)}>
            <Avatar nombre={c.nombre} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="corta"><b>{c.nombre}</b></div>
              <div className="peq tenue">{c.dias === 0 ? "Hoy" : diaMes(c.fecha)} · {c.esHijo ? `hijo(a) de ${primerNombre(c.padre ?? "")}` : `${c.cumple} años`}</div>
            </div>
            {wa && <a className="btn btn-sm btn-icono btn-wa" href={wa} target="_blank" rel="noreferrer" title="Saludar por WhatsApp" onClick={(e) => e.stopPropagation()}><MessageCircle size={14} /></a>}
          </div>
        );
      })}
      {items.length > 6 && <div className="peq muted" style={{ marginTop: 6 }}>Y {items.length - 6} más en la pantalla de Cumpleaños.</div>}
    </div>
  );
}

function BloqueCruce({ id }: { id: number }) {
  const c = useLiveQuery(() => db.cruces.get(id), [id]);
  const nav = useNavigate();
  if (!c) return null;
  const t = c.totales;
  return (
    <div className="bloque-ia">
      <b>Resultado de {nombrePeriodo(c.periodo)}</b>
      <div className="fila-wrap" style={{ margin: "8px 0" }}>
        <Badge tono="verde">{t.descontado ?? 0} descontados</Badge>
        <Badge tono="rojo">{t.sin_descuento ?? 0} sin descuento</Badge>
        {!!t.retirado_con_descuento && <Badge tono="rosa">{t.retirado_con_descuento} retirados con descuento</Badge>}
        {!!t.no_en_base && <Badge tono="morado">{t.no_en_base} no están en la base</Badge>}
        {!!t.pendiente_novedad && <Badge tono="ambar">{t.pendiente_novedad} en trámite</Badge>}
      </div>
      <div className="peq muted" style={{ marginBottom: 8 }}>{c.fuentes.map((f) => nombreFuente(f.fuente)).join(" · ")}</div>
      <div className="fila-wrap">
        <button className="btn btn-sm btn-primario" onClick={() => nav("/descuentos")}>Abrir lista para contactar</button>
        <button className="btn btn-sm" onClick={() => nav(`/cruces/${c.id}`)}>Ver detalle del mes</button>
      </div>
    </div>
  );
}

function BloqueDetalle({ b }: { b: Extract<Bloque, { t: "detalle" }> }) {
  const filas = useLiveQuery(() => db.cruceDetalle.where("cruceId").equals(b.cruceId).filter((d) => d.resultado === b.resultado).toArray(), [b.cruceId, b.resultado]) ?? [];
  const afiliados = useLiveQuery(async () => new Map((await db.afiliados.bulkGet(filas.map((f) => f.afiliadoId ?? -1))).filter((a): a is Afiliado => !!a).map((a) => [a.id!, a])), [filas.length]);
  const nav = useNavigate();
  return (
    <div className="bloque-ia">
      <div className="fila" style={{ marginBottom: 6 }}><b>{b.titulo}</b><span className="espacio" /><Badge>{filas.length}</Badge></div>
      <div className="peq muted" style={{ marginBottom: 6 }}>{RESULTADOS[b.resultado].ayuda}</div>
      {filas.slice(0, 6).map((d) => {
        const a = d.afiliadoId ? afiliados?.get(d.afiliadoId) : undefined;
        return (
          <div key={d.id} className="fila fila-ia" onClick={() => a && nav(`/afiliados/${a.id}`)}>
            <Avatar nombre={a?.nombre ?? d.nombre} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="corta"><b>{a?.nombre ?? d.nombre}</b></div>
              <div className="peq tenue">C.C. {d.cedula}{d.valor ? ` · ${pesos(d.valor)}` : ""}</div>
            </div>
          </div>
        );
      })}
      {filas.length > 6 && <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => nav(`/cruces/${b.cruceId}?r=${b.resultado}`)}>Ver los {filas.length}</button>}
    </div>
  );
}

function BloqueEvento({ id }: { id: number }) {
  const ev = useLiveQuery(() => db.eventos.get(id), [id]);
  const nav = useNavigate();
  if (!ev) return null;
  const invitados = async () => {
    const porId = new Map((await db.afiliados.toArray()).map((a) => [a.id!, a]));
    return ev.invitados.map((i) => porId.get(i)).filter((a): a is Afiliado => !!a).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  };
  return (
    <div className="bloque-ia">
      <div className="fila"><Bot size={16} className="tenue" /><b>{ev.nombre}</b></div>
      <div className="peq muted" style={{ margin: "4px 0 8px" }}>{fechaLarga(ev.fecha)}{ev.lugar ? ` · ${ev.lugar}` : ""} · {ev.invitados.length} invitados</div>
      <div className="fila-wrap">
        <button className="btn btn-sm btn-primario" onClick={() => nav(`/eventos/${ev.id}`)}>Abrir evento</button>
        <button className="btn btn-sm" onClick={async () => planillaAsistenciaPDF(ev, await invitados())}><Download size={13} />Planilla PDF</button>
        <button className="btn btn-sm" onClick={async () => exportarAsistenciaExcel(ev, await invitados())}><Download size={13} />Excel</button>
      </div>
    </div>
  );
}
