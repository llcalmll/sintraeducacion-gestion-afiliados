import { db } from "../datos/db";
import { vigente } from "../datos/hooks";
import { ponerMensajeWhatsApp } from "../datos/preferencias";
import { FUENTES, PAG_ALCALDIA_IBAGUE, PAG_IBAGUE, PAG_TOLIMA, type Afiliado, type Contacto, type CruceDetalle, type EstadoContacto, type Hijo } from "../datos/tipos";
import { calcularRachas } from "../logica/cruce";
import { FUENTES_ORDEN, registrarReportes } from "../logica/descuentosMes";
import { exportarAsistenciaExcel, exportarBaseOriginal, exportarContactos } from "../logica/exportar";
import { fechaLarga, hoyISO, MESES, nombrePeriodo, periodoActual, periodoAnterior } from "../logica/fechas";
import { planillaAsistenciaPDF } from "../logica/pdf";
import { leerReporte } from "../logica/reportes";
import { contiene, normalizar } from "../logica/texto";
import { listaCumples, type Cumple } from "../pantallas/Cumpleanos";

/* ───────────────────────── Bloques que la app muestra en el chat ─────────────────────────
   Los bloques llevan nombres, cédulas y celulares, pero se quedan en la pantalla:
   a la IA solo le llega el campo `paraIA`, que no trae datos personales. */

export type Bloque =
  | { t: "afiliados"; titulo: string; ids: number[]; total: number; contacto?: { periodo: string }; enlace?: { texto: string; ruta: string } }
  | { t: "detalle"; titulo: string; cruceId: number; resultado: CruceDetalle["resultado"] }
  | { t: "cumples"; titulo: string; items: Cumple[] }
  | { t: "cruce"; cruceId: number }
  | { t: "evento"; eventoId: number }
  | { t: "botones"; items: { texto: string; ruta: string }[] }
  | { t: "aviso"; tono: "ok" | "error" | "info"; texto: string };

export interface ResultadoHerramienta {
  /** Lo que lee la IA: cifras y estados, nunca nombres, cédulas ni celulares. */
  paraIA: Record<string, unknown>;
  bloques?: Bloque[];
}

export interface Contexto {
  navegar: (ruta: string, estado?: unknown) => void;
  /** Archivos que la secretaria soltó en el chat y todavía no se han revisado. */
  tomarAdjuntos: () => File[];
  usuario: string;
  confirmar: (c: { titulo: string; texto?: string; boton?: string }) => Promise<boolean>;
}

/* ───────────────────────── Definiciones para OpenAI (function calling) ───────────────────────── */

const ENTIDAD = { type: "string", enum: ["ibague", "tolima", "alcaldias"], description: "ibague = Secretaría de Educación de Ibagué; tolima = Secretaría de Educación del Tolima; alcaldias = alcaldías y personerías" };

export const DEFINICIONES = [
  {
    name: "resumen_del_dia",
    description: "Pendientes de hoy: personas por contactar del último mes, casos para revisar, cumpleaños de hoy y de la semana, si falta subir el reporte del mes y eventos próximos. Úsala para saludar o cuando pregunten qué hay pendiente.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "subir_reportes_adjuntos",
    description: "Compara con la base los archivos de descuentos de nómina que el usuario adjuntó en el chat (.xls de Ibagué, .xlsx del Tolima, .pdf de la Alcaldía) y guarda el resultado del mes. Muestra en pantalla el resultado. Úsala siempre que haya archivos adjuntos.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "lista_para_contactar",
    description: "Personas activas a las que no les descontaron la cuota en el último mes cruzado, con su estado de seguimiento. Las muestra en pantalla con botón de WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        estado: { type: "string", enum: ["todas", "pendiente", "contactada", "resuelto"], description: "pendiente = por contactar" },
        entidad: ENTIDAD,
        minimo_meses: { type: "integer", minimum: 1, description: "Solo quienes lleven al menos estos meses seguidos sin descuento" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "casos_para_revisar",
    description: "Casos especiales del último mes: retirados a los que les siguen descontando, descontados que no están en la base y afiliaciones en trámite. Los muestra en pantalla.",
    parameters: {
      type: "object",
      properties: { tipo: { type: "string", enum: ["todos", "retirados_con_descuento", "no_estan_en_la_base", "en_tramite"] } },
      additionalProperties: false,
    },
  },
  {
    name: "buscar_afiliados",
    description: "Busca o cuenta afiliados en la base con filtros. Muestra los resultados en pantalla y devuelve conteos.",
    parameters: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Parte del nombre, cédula, institución, cargo o municipio" },
        entidad: ENTIDAD,
        tipo: { type: "string", enum: ["docente", "administrativo"] },
        municipio: { type: "string" },
        estado: { type: "string", enum: ["activos", "retirados", "todos"] },
        con_hijos: { type: "boolean" },
        descuento_ultimo_mes: { type: "string", enum: ["descontado", "sin_descuento", "en_tramite"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "cumpleanos",
    description: "Cumpleaños de afiliados activos y de sus hijos. Los muestra en pantalla con botón para saludar por WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        cuando: { type: "string", enum: ["hoy", "semana", "mes"] },
        mes: { type: "integer", minimum: 1, maximum: 12, description: "Solo si cuando = mes; por defecto el mes actual" },
        incluir_hijos: { type: "boolean" },
      },
      required: ["cuando"],
      additionalProperties: false,
    },
  },
  {
    name: "abrir_pantalla",
    description: "Abre una pantalla de la app para que el usuario la vea.",
    parameters: {
      type: "object",
      properties: {
        pantalla: { type: "string", enum: ["base_de_datos", "lista_con_filtros", "descuentos_del_mes", "cumpleanos", "hijos", "eventos", "meses_anteriores", "resumen_general", "agregar_afiliado", "configuracion"] },
        hoja: { type: "string", description: "Solo para base_de_datos: nombre de la hoja del Excel, ej. SEMIBAGUE, DEPARTAMENTO, ALCALDIAS, RETIROS" },
      },
      required: ["pantalla"],
      additionalProperties: false,
    },
  },
  {
    name: "abrir_formulario_afiliacion",
    description: "Abre el formulario de nueva afiliación con los datos que el usuario dictó, para que los revise y guarde. Nunca guarda solo.",
    parameters: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["docente", "administrativo"] },
        nombre: { type: "string" }, cedula: { type: "string" }, celular: { type: "string" }, correo: { type: "string" },
        municipio: { type: "string" }, institucion: { type: "string" }, cargo: { type: "string" }, entidad: ENTIDAD,
      },
      additionalProperties: false,
    },
  },
  {
    name: "marcar_seguimiento",
    description: "Cambia el seguimiento de una persona de la lista de 'no les descontaron' del último mes.",
    parameters: {
      type: "object",
      properties: {
        nombre_o_cedula: { type: "string" },
        estado: { type: "string", enum: ["pendiente", "contactada", "resuelto"] },
        nota: { type: "string" },
      },
      required: ["nombre_o_cedula", "estado"],
      additionalProperties: false,
    },
  },
  {
    name: "crear_evento",
    description: "Crea un evento e invita afiliados activos según filtros. La app pide confirmación al usuario antes de crearlo.",
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        fecha: { type: "string", description: "AAAA-MM-DD" },
        lugar: { type: "string" },
        invitar_entidad: ENTIDAD,
        invitar_tipo: { type: "string", enum: ["docente", "administrativo"] },
        invitar_municipio: { type: "string" },
        invitar_todos: { type: "boolean", description: "true para invitar a todos los activos" },
      },
      required: ["nombre", "fecha"],
      additionalProperties: false,
    },
  },
  {
    name: "descargar",
    description: "Descarga un archivo: la lista de no descontados del último mes, la base en Excel igual a la original, o la planilla de asistencia (PDF o Excel) de un evento.",
    parameters: {
      type: "object",
      properties: {
        que: { type: "string", enum: ["lista_para_contactar", "base_excel", "planilla_pdf", "planilla_excel"] },
        evento_id: { type: "integer", description: "Para planillas; si falta se usa el evento más reciente" },
      },
      required: ["que"],
      additionalProperties: false,
    },
  },
  {
    name: "cambiar_mensaje_whatsapp",
    description: "Cambia el mensaje de WhatsApp que se usa para escribir a quienes no les descontaron. Debe incluir {nombre} y puede incluir {mes}. La app pide confirmación.",
    parameters: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"], additionalProperties: false },
  },
].map((f) => ({ type: "function" as const, function: f }));

export const ETIQUETAS: Record<string, string> = {
  resumen_del_dia: "Revisando los pendientes del día",
  subir_reportes_adjuntos: "Comparando los archivos con la base",
  lista_para_contactar: "Buscando a quién hay que escribirle",
  casos_para_revisar: "Revisando casos especiales",
  buscar_afiliados: "Buscando en la base",
  cumpleanos: "Revisando cumpleaños",
  abrir_pantalla: "Abriendo la pantalla",
  abrir_formulario_afiliacion: "Abriendo el formulario",
  marcar_seguimiento: "Actualizando el seguimiento",
  crear_evento: "Preparando el evento",
  descargar: "Preparando la descarga",
  cambiar_mensaje_whatsapp: "Cambiando el mensaje",
};

/* ───────────────────────── Utilidades ───────────────────────── */

const pagadorDe = (e?: string) => (e === "ibague" ? PAG_IBAGUE : e === "tolima" ? PAG_TOLIMA : e === "alcaldias" ? "alcaldias" : undefined);
const cumplePagador = (a: Afiliado, e?: string) => {
  const p = pagadorDe(e);
  if (!p) return true;
  return p === "alcaldias" ? /^(Alcald|Personer)/i.test(a.pagador) : a.pagador === p;
};
const contar = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const corta = (p: string) => p.replace("Secretaría de Educación de ", "Sec. ").replace("Secretaría de Educación del ", "Sec. ");

async function ultimoCruce() {
  const c = await db.cruces.orderBy("periodo").last();
  if (!c) return null;
  const detalle = await db.cruceDetalle.where("cruceId").equals(c.id!).toArray();
  const contactos = new Map((await db.contactos.where("periodo").equals(c.periodo).toArray()).map((x) => [x.cedula, x]));
  return { c, detalle, contactos };
}

const estadoDe = (contactos: Map<string, Contacto>, ced: string): EstadoContacto => contactos.get(ced)?.estado ?? "pendiente";

async function base() {
  const [afiliados, hijos] = await Promise.all([db.afiliados.toArray(), db.hijos.toArray()]);
  const hijosPor = new Map<number, Hijo[]>();
  for (const h of hijos) hijosPor.set(h.afiliadoId, [...(hijosPor.get(h.afiliadoId) ?? []), h]);
  return { afiliados, hijosPor };
}

/* ───────────────────────── Ejecución ───────────────────────── */

export async function ejecutar(nombre: string, args: Record<string, unknown>, ctx: Contexto): Promise<ResultadoHerramienta> {
  switch (nombre) {
    case "resumen_del_dia": return resumenDelDia();
    case "subir_reportes_adjuntos": return subirAdjuntos(ctx);
    case "lista_para_contactar": return listaContactar(args);
    case "casos_para_revisar": return casosRevisar(args);
    case "buscar_afiliados": return buscar(args);
    case "cumpleanos": return cumples(args);
    case "abrir_pantalla": return abrirPantalla(args, ctx);
    case "abrir_formulario_afiliacion": return abrirFormulario(args, ctx);
    case "marcar_seguimiento": return marcar(args);
    case "crear_evento": return crearEvento(args, ctx);
    case "descargar": return descargar(args);
    case "cambiar_mensaje_whatsapp": return cambiarMensaje(args, ctx);
    default: return { paraIA: { error: `Herramienta desconocida: ${nombre}` } };
  }
}

export async function resumenDelDia(): Promise<ResultadoHerramienta> {
  const { afiliados, hijosPor } = await base();
  const u = await ultimoCruce();
  const cumpl = listaCumples(afiliados, hijosPor);
  const hoy = cumpl.filter((c) => c.dias === 0);
  const mesEsperado = periodoAnterior(periodoActual());
  const tieneMesEsperado = !!(await db.cruces.where("periodo").equals(mesEsperado).first());
  const eventos = (await db.eventos.toArray()).filter((e) => e.fecha >= hoyISO());
  const bloques: Bloque[] = [];
  const paraIA: Record<string, unknown> = {
    hoy: fechaLarga(hoyISO()),
    afiliados_activos: afiliados.filter(vigente).length,
    cumpleanos_hoy: { afiliados: hoy.filter((c) => !c.esHijo).length, hijos: hoy.filter((c) => c.esHijo).length },
    cumpleanos_proximos_7_dias: cumpl.filter((c) => c.dias > 0 && c.dias <= 7).length,
    reporte_pendiente_por_subir: tieneMesEsperado ? null : nombrePeriodo(mesEsperado),
    eventos_proximos: eventos.length,
  };
  if (u) {
    const sin = u.detalle.filter((d) => d.resultado === "sin_descuento");
    const rachas = await calcularRachas();
    paraIA.ultimo_mes_revisado = nombrePeriodo(u.c.periodo);
    paraIA.no_les_descontaron = sin.length;
    paraIA.por_contactar = sin.filter((d) => estadoDe(u.contactos, d.cedula) === "pendiente").length;
    paraIA.contactadas = sin.filter((d) => estadoDe(u.contactos, d.cedula) === "contactada").length;
    paraIA.resueltas = sin.filter((d) => estadoDe(u.contactos, d.cedula) === "resuelto").length;
    paraIA.dos_meses_o_mas_sin_descuento = [...rachas.values()].filter((r) => r.meses >= 2).length;
    paraIA.retirados_con_descuento = u.c.totales.retirado_con_descuento ?? 0;
    paraIA.descontados_sin_estar_en_la_base = u.c.totales.no_en_base ?? 0;
    paraIA.entidades_sin_reporte_este_mes = FUENTES_ORDEN.filter((f) => !u.c.fuentes.some((x) => x.fuente === f)).map((f) => FUENTES[f].pagador);
  } else {
    paraIA.ultimo_mes_revisado = null;
  }
  if (hoy.length) bloques.push({ t: "cumples", titulo: "Cumplen años hoy", items: hoy });
  const botones: { texto: string; ruta: string }[] = [];
  if (u && (paraIA.por_contactar as number) > 0) botones.push({ texto: `Escribir a ${paraIA.por_contactar} por contactar`, ruta: "/descuentos" });
  if (!tieneMesEsperado) botones.push({ texto: `Subir el reporte de ${nombrePeriodo(mesEsperado)}`, ruta: "/descuentos" });
  if (botones.length) bloques.push({ t: "botones", items: botones });
  return { paraIA, bloques };
}

async function subirAdjuntos(ctx: Contexto): Promise<ResultadoHerramienta> {
  const archivos = ctx.tomarAdjuntos();
  if (!archivos.length) return { paraIA: { error: "No hay archivos adjuntos. Pídale al usuario que arrastre los archivos de descuentos al chat o use el clip." } };
  const leidos = [];
  const errores: string[] = [];
  for (const f of archivos) {
    try {
      const r = await leerReporte(f);
      if (r.periodo) leidos.push(r);
      else errores.push(`"${f.name}" no dice de qué mes es: súbalo desde Descuentos del mes, donde se puede confirmar.`);
    } catch (e) { errores.push(e instanceof Error ? e.message : String(e)); }
  }
  if (!leidos.length) return { paraIA: { error: "Ningún archivo es un reporte de descuentos reconocido.", detalles: errores }, bloques: errores.map((texto) => ({ t: "aviso", tono: "error", texto })) };
  const anterior = await db.cruces.orderBy("periodo").last();
  const meses = await registrarReportes(leidos, ctx.usuario);
  const periodo = meses[meses.length - 1];
  const c = (await db.cruces.where("periodo").equals(periodo).first())!;
  const detalle = await db.cruceDetalle.where("cruceId").equals(c.id!).toArray();
  const afiliados = new Map((await db.afiliados.toArray()).map((a) => [a.id!, a]));
  const sin = detalle.filter((d) => d.resultado === "sin_descuento");
  const rachas = await calcularRachas();
  const previo = anterior && anterior.periodo < periodo ? anterior : null;
  const paraIA = {
    mes: nombrePeriodo(periodo),
    archivos_leidos: leidos.map((l) => ({ entidad: FUENTES[l.fuente].pagador, registros: l.lineas.length })),
    archivos_no_reconocidos: errores.length,
    entidades_que_faltan: FUENTES_ORDEN.filter((f) => !c.fuentes.some((x) => x.fuente === f)).map((f) => FUENTES[f].pagador),
    descontados: c.totales.descontado ?? 0,
    no_les_descontaron: sin.length,
    no_les_descontaron_por_entidad: contar(sin, (d) => corta(afiliados.get(d.afiliadoId!)?.pagador ?? "")),
    dos_meses_o_mas_sin_descuento: sin.filter((d) => (rachas.get(d.afiliadoId!)?.meses ?? 0) >= 2).length,
    retirados_con_descuento: c.totales.retirado_con_descuento ?? 0,
    descontados_sin_estar_en_la_base: c.totales.no_en_base ?? 0,
    en_tramite: c.totales.pendiente_novedad ?? 0,
    cuota_extraordinaria: c.totales.extraordinaria ?? 0,
    mes_anterior: previo ? { mes: nombrePeriodo(previo.periodo), no_les_descontaron: previo.totales.sin_descuento ?? 0 } : null,
  };
  const bloques: Bloque[] = [{ t: "cruce", cruceId: c.id! }];
  for (const texto of errores) bloques.push({ t: "aviso", tono: "error", texto });
  return { paraIA, bloques };
}

async function listaContactar(args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  const u = await ultimoCruce();
  if (!u) return { paraIA: { error: "Todavía no se ha subido ningún reporte de descuentos." }, bloques: [{ t: "botones", items: [{ texto: "Subir el reporte del mes", ruta: "/descuentos" }] }] };
  const afiliados = new Map((await db.afiliados.toArray()).map((a) => [a.id!, a]));
  const rachas = await calcularRachas();
  const estado = (args.estado as string) || "todas";
  const min = Number(args.minimo_meses ?? 0);
  const filas = u.detalle.filter((d) => {
    if (d.resultado !== "sin_descuento") return false;
    const a = afiliados.get(d.afiliadoId!);
    if (a && !cumplePagador(a, args.entidad as string)) return false;
    if (estado !== "todas" && estadoDe(u.contactos, d.cedula) !== estado) return false;
    if (min && (rachas.get(d.afiliadoId!)?.meses ?? 0) < min) return false;
    return true;
  });
  const sinCel = filas.filter((d) => (afiliados.get(d.afiliadoId!)?.celular ?? "").replace(/\D/g, "").length !== 10).length;
  return {
    paraIA: {
      mes: nombrePeriodo(u.c.periodo),
      total: filas.length,
      por_estado: contar(filas, (d) => estadoDe(u.contactos, d.cedula)),
      por_entidad: contar(filas, (d) => corta(afiliados.get(d.afiliadoId!)?.pagador ?? "")),
      sin_celular_valido: sinCel,
    },
    bloques: [{
      t: "afiliados", titulo: `No les descontaron en ${nombrePeriodo(u.c.periodo)}`, ids: filas.map((d) => d.afiliadoId!).filter(Boolean), total: filas.length,
      contacto: { periodo: u.c.periodo }, enlace: { texto: "Abrir la lista completa", ruta: "/descuentos" },
    }],
  };
}

async function casosRevisar(args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  const u = await ultimoCruce();
  if (!u) return { paraIA: { error: "Todavía no se ha subido ningún reporte de descuentos." } };
  const tipo = (args.tipo as string) || "todos";
  const mapa = { retirados_con_descuento: "retirado_con_descuento", no_estan_en_la_base: "no_en_base", en_tramite: "pendiente_novedad" } as const;
  const titulos = { retirado_con_descuento: "Retirados a los que les siguen descontando", no_en_base: "Descontados que no están en la base", pendiente_novedad: "Afiliación en trámite" };
  const bloques: Bloque[] = [];
  const paraIA: Record<string, unknown> = { mes: nombrePeriodo(u.c.periodo) };
  for (const [k, r] of Object.entries(mapa)) {
    if (tipo !== "todos" && tipo !== k) continue;
    const n = u.detalle.filter((d) => d.resultado === r).length;
    paraIA[k] = n;
    if (n) bloques.push({ t: "detalle", titulo: titulos[r], cruceId: u.c.id!, resultado: r });
  }
  return { paraIA, bloques };
}

async function buscar(args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  const { afiliados, hijosPor } = await base();
  const u = await ultimoCruce();
  const resultadoDe = new Map((u?.detalle ?? []).filter((d) => d.afiliadoId).map((d) => [d.afiliadoId!, d.resultado]));
  const estado = (args.estado as string) || "activos";
  const texto = (args.texto as string | undefined)?.trim();
  const desc = args.descuento_ultimo_mes as string | undefined;
  const lista = afiliados.filter((a) => {
    if (estado === "activos" && !vigente(a)) return false;
    if (estado === "retirados" && vigente(a)) return false;
    if (!cumplePagador(a, args.entidad as string)) return false;
    if (args.tipo && a.tipo !== args.tipo) return false;
    if (args.municipio && normalizar(a.municipio) !== normalizar(args.municipio)) return false;
    if (args.con_hijos && !(hijosPor.get(a.id!)?.length)) return false;
    if (desc) {
      const r = resultadoDe.get(a.id!);
      if (desc === "en_tramite" ? r !== "pendiente_novedad" : r !== desc) return false;
    }
    if (texto) {
      const palabras = normalizar(texto).split(" ").filter(Boolean);
      const campo = normalizar(`${a.nombre} ${a.cedula ?? ""} ${a.institucion} ${a.cargo} ${a.municipio}`);
      if (!palabras.every((p) => campo.includes(p)) && !contiene(a.cedula ?? "", texto)) return false;
    }
    return true;
  }).sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
  const params = new URLSearchParams();
  if (texto) params.set("q", texto);
  const pag = pagadorDe(args.entidad as string);
  if (pag && pag !== "alcaldias") params.set("pagador", pag);
  if (args.tipo) params.set("tipo", String(args.tipo));
  if (args.municipio) params.set("municipio", normalizar(args.municipio));
  if (estado === "retirados") params.set("vista", "retirados");
  if (estado === "todos") params.set("vista", "todos");
  return {
    paraIA: {
      total: lista.length,
      por_entidad: contar(lista, (a) => corta(a.pagador)),
      por_tipo: contar(lista, (a) => a.tipo),
      con_hijos: lista.filter((a) => hijosPor.get(a.id!)?.length).length,
      hijos_en_total: lista.reduce((s, a) => s + (hijosPor.get(a.id!)?.length ?? 0), 0),
    },
    bloques: [{ t: "afiliados", titulo: "Resultado de la búsqueda", ids: lista.map((a) => a.id!), total: lista.length, enlace: { texto: "Ver en la base", ruta: `/?${params}` } }],
  };
}

async function cumples(args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  const { afiliados, hijosPor } = await base();
  const todos = listaCumples(afiliados, hijosPor).filter((c) => args.incluir_hijos !== false || !c.esHijo);
  const cuando = (args.cuando as string) || "semana";
  const mes = Number(args.mes ?? new Date().getMonth() + 1);
  const items =
    cuando === "hoy" ? todos.filter((c) => c.dias === 0)
    : cuando === "semana" ? todos.filter((c) => c.dias <= 7)
    : todos.filter((c) => Number(c.fecha.slice(5, 7)) === mes).sort((a, b) => a.fecha.slice(8).localeCompare(b.fecha.slice(8)));
  const titulo = cuando === "hoy" ? "Cumplen años hoy" : cuando === "semana" ? "Cumpleaños de los próximos 7 días" : `Cumpleaños de ${MESES[mes - 1]}`;
  const sinFecha = afiliados.filter((a) => vigente(a) && !a.fechaNacimiento).length;
  return {
    paraIA: { total: items.length, afiliados: items.filter((c) => !c.esHijo).length, hijos: items.filter((c) => c.esHijo).length, hoy: items.filter((c) => c.dias === 0).length, activos_sin_fecha_de_nacimiento: sinFecha },
    bloques: [{ t: "cumples", titulo, items }, { t: "botones", items: [{ texto: "Abrir cumpleaños", ruta: "/cumpleanos" }] }],
  };
}

const RUTAS: Record<string, string> = {
  base_de_datos: "/", lista_con_filtros: "/", descuentos_del_mes: "/descuentos", cumpleanos: "/cumpleanos", eventos: "/eventos",
  meses_anteriores: "/descuentos?vista=mes", hijos: "/hijos", resumen_general: "/resumen", agregar_afiliado: "/nuevo", configuracion: "/configuracion",
};

async function abrirPantalla(args: Record<string, unknown>, ctx: Contexto): Promise<ResultadoHerramienta> {
  const ruta = RUTAS[args.pantalla as string];
  if (!ruta) return { paraIA: { error: "Pantalla desconocida" } };
  ctx.navegar(args.hoja && ruta === "/" ? `/?hoja=${encodeURIComponent(String(args.hoja).toUpperCase())}` : ruta);
  return { paraIA: { abierta: args.pantalla } };
}

async function abrirFormulario(args: Record<string, unknown>, ctx: Contexto): Promise<ResultadoHerramienta> {
  const pag = pagadorDe(args.entidad as string);
  ctx.navegar("/nuevo", {
    prefill: {
      tipo: args.tipo, nombre: args.nombre, cedula: args.cedula, celular: args.celular, correo: args.correo,
      municipio: args.municipio, institucion: args.institucion, cargo: args.cargo,
      pagador: pag === "alcaldias" ? PAG_ALCALDIA_IBAGUE : pag,
    },
  });
  return { paraIA: { abierto: true, nota: "El formulario quedó abierto con los datos; el usuario debe revisarlo y oprimir Guardar." } };
}

async function marcar(args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  const u = await ultimoCruce();
  if (!u) return { paraIA: { error: "No hay un mes revisado todavía." } };
  const afiliados = new Map((await db.afiliados.toArray()).map((a) => [a.id!, a]));
  const q = String(args.nombre_o_cedula ?? "").trim();
  const palabras = normalizar(q).split(" ").filter(Boolean);
  const candidatos = u.detalle.filter((d) => d.resultado === "sin_descuento").filter((d) => {
    if (/^\d{5,}$/.test(q)) return d.cedula === q;
    const n = normalizar(afiliados.get(d.afiliadoId!)?.nombre ?? d.nombre);
    return palabras.every((p) => n.includes(p));
  });
  if (candidatos.length === 0) return { paraIA: { error: "No hay nadie con ese nombre o cédula en la lista de no descontados del último mes." } };
  if (candidatos.length > 1) {
    return {
      paraIA: { coincidencias: candidatos.length, nota: "Hay varias personas; pídale al usuario la cédula o un apellido más." },
      bloques: [{ t: "afiliados", titulo: "Coincidencias", ids: candidatos.map((d) => d.afiliadoId!), total: candidatos.length, contacto: { periodo: u.c.periodo } }],
    };
  }
  const d = candidatos[0];
  const prev = u.contactos.get(d.cedula);
  await db.contactos.put({
    periodo: u.c.periodo, cedula: d.cedula, estado: args.estado as EstadoContacto,
    nota: (args.nota as string) ?? prev?.nota ?? "", actualizadoEn: new Date().toISOString(),
  });
  return {
    paraIA: { actualizado: true, estado: args.estado },
    bloques: [{ t: "afiliados", titulo: "Seguimiento actualizado", ids: [d.afiliadoId!], total: 1, contacto: { periodo: u.c.periodo } }],
  };
}

async function crearEvento(args: Record<string, unknown>, ctx: Contexto): Promise<ResultadoHerramienta> {
  const fecha = String(args.fecha ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { paraIA: { error: "La fecha debe tener el formato AAAA-MM-DD." } };
  const { afiliados } = await base();
  const filtra = args.invitar_todos || args.invitar_entidad || args.invitar_tipo || args.invitar_municipio;
  const invitados = filtra
    ? afiliados.filter((a) => vigente(a) && cumplePagador(a, args.invitar_entidad as string) && (!args.invitar_tipo || a.tipo === args.invitar_tipo)
        && (!args.invitar_municipio || normalizar(a.municipio) === normalizar(args.invitar_municipio)))
    : [];
  const ok = await ctx.confirmar({
    titulo: `Crear el evento "${args.nombre}"`,
    texto: `${fechaLarga(fecha)}${args.lugar ? ` · ${args.lugar}` : ""}. Se invitará a ${invitados.length} afiliados activos.`,
    boton: "Crear evento",
  });
  if (!ok) return { paraIA: { creado: false, motivo: "El usuario canceló." } };
  const id = (await db.eventos.add({
    nombre: String(args.nombre), fecha, lugar: String(args.lugar ?? ""), descripcion: "Creado con el asistente.",
    invitados: invitados.map((a) => a.id!), asistentes: [], creadoEn: new Date().toISOString(),
  })) as number;
  return { paraIA: { creado: true, evento_id: id, invitados: invitados.length }, bloques: [{ t: "evento", eventoId: id }] };
}

async function descargar(args: Record<string, unknown>): Promise<ResultadoHerramienta> {
  const que = args.que as string;
  if (que === "base_excel") { await exportarBaseOriginal(); return { paraIA: { descargado: "base en Excel" } }; }
  if (que === "lista_para_contactar") {
    const u = await ultimoCruce();
    if (!u) return { paraIA: { error: "No hay un mes revisado todavía." } };
    const afiliados = new Map((await db.afiliados.toArray()).map((a) => [a.id!, a]));
    const filas = u.detalle.filter((d) => d.resultado === "sin_descuento").map((d) => ({
      d, a: d.afiliadoId ? afiliados.get(d.afiliadoId) : undefined,
      estado: { pendiente: "Por contactar", contactada: "Contactada", resuelto: "Resuelto" }[estadoDe(u.contactos, d.cedula)], nota: u.contactos.get(d.cedula)?.nota ?? "",
    }));
    exportarContactos(u.c.periodo, filas);
    return { paraIA: { descargado: "lista de no descontados", filas: filas.length } };
  }
  const ev = args.evento_id ? await db.eventos.get(Number(args.evento_id)) : (await db.eventos.orderBy("fecha").reverse().toArray())[0];
  if (!ev) return { paraIA: { error: "No hay eventos creados." } };
  const porId = new Map((await db.afiliados.toArray()).map((a) => [a.id!, a]));
  const inv = ev.invitados.map((i) => porId.get(i)).filter((a): a is Afiliado => !!a).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  if (que === "planilla_pdf") planillaAsistenciaPDF(ev, inv); else exportarAsistenciaExcel(ev, inv);
  return { paraIA: { descargado: que, evento: ev.nombre, invitados: inv.length } };
}

async function cambiarMensaje(args: Record<string, unknown>, ctx: Contexto): Promise<ResultadoHerramienta> {
  const texto = String(args.texto ?? "").trim();
  if (!texto.includes("{nombre}")) return { paraIA: { error: "El mensaje debe incluir {nombre}." } };
  const ok = await ctx.confirmar({ titulo: "Cambiar el mensaje de WhatsApp", texto: texto.replaceAll("{nombre}", "Carmen").replaceAll("{mes}", "septiembre 2026"), boton: "Usar este mensaje" });
  if (!ok) return { paraIA: { cambiado: false, motivo: "El usuario canceló." } };
  ponerMensajeWhatsApp(texto);
  return { paraIA: { cambiado: true } };
}
