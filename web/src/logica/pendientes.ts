import { PAG_SIN_DEFINIR, type Afiliado, type Hijo } from "../datos/tipos";
import { esVacio } from "./texto";

export type Categoria = "Datos faltantes" | "Definiciones" | "Archivos por recibir" | "Operación";

export type Prioridad = "Alta" | "Media" | "Baja";

export interface Pendiente {
  id: string;
  prioridad?: Prioridad;
  /** Por qué importa, en lenguaje simple. */
  porque?: string;
  /** Ejemplo concreto tomado de la base, sin datos personales. */
  ejemplo?: string;
  categoria: Categoria;
  titulo: string;
  /** Qué hay que pedirle al cliente en la reunión. */
  solicitar: string;
  /** Qué hace la demo mientras tanto. */
  mientras: string;
  afectados?: number;
  /** Ruta de la app donde se ve el problema. */
  ver?: string;
}

const RETIRO = (a: Afiliado) => a.estado === "retirado" || a.estado === "desvinculado";

export function conflictoDeHojas(a: Afiliado): boolean {
  const activas = a.hojas.some((h) => !/RETIRO|DESVINCULADO/i.test(h));
  const retiradas = a.hojas.some((h) => /RETIRO|DESVINCULADO/i.test(h));
  return activas && retiradas;
}

/**
 * Filas del Excel donde los datos quedaron corridos una columna respecto al encabezado:
 * en "fecha de nacimiento" aparece un correo, un cargo, F/M o un teléfono.
 */
export function columnasCorridas(a: Afiliado): boolean {
  const o = a.fechaNacimientoOriginal.trim();
  if (a.fechaNacimiento || !o || esVacio(o)) return false;
  return /@/.test(o) || !/\d/.test(o) || /^\d{7,}$/.test(o);
}

/** Lista de lo que le falta a un afiliado, con la indicación de qué pedir. */
export function faltantesAfiliado(a: Afiliado, hijos: Hijo[] = []): { campo: string; solicitar: string }[] {
  const f: { campo: string; solicitar: string }[] = [];
  if (!a.cedula) f.push({ campo: "Cédula", solicitar: "Pedir el número de cédula. Sin ella no se puede cruzar con los reportes de descuento." });
  if (columnasCorridas(a))
    f.push({
      campo: "Columnas corridas",
      solicitar: `En el Excel (${a.hojas.join(", ")}) los datos de esta fila están corridos de columna: en "fecha de nacimiento" dice "${a.fechaNacimientoOriginal}". Revisar la fila completa.`,
    });
  else if (!a.fechaNacimiento)
    f.push({
      campo: "Fecha de nacimiento",
      solicitar: a.fechaNacimientoOriginal && !esVacio(a.fechaNacimientoOriginal)
        ? `La base dice "${a.fechaNacimientoOriginal}" y no es una fecha válida. Pedir la fecha correcta.`
        : "Pedir la fecha de nacimiento (para cumpleaños).",
    });
  if (conflictoDeHojas(a))
    f.push({ campo: "Estado", solicitar: `Aparece en ${a.hojas.join(" y ")}. Confirmar si sigue afiliado o está retirado.` });
  if (a.pagador === PAG_SIN_DEFINIR && !RETIRO(a))
    f.push({ campo: "Entidad que descuenta", solicitar: "Confirmar qué entidad le hace el descuento." });
  if (a.tipoInferido)
    f.push({ campo: "Tipo", solicitar: `La base no dice si es docente o administrativo; se dedujo "${a.tipo}" por el cargo. Confirmar.` });
  if (esVacio(a.celular)) f.push({ campo: "Celular", solicitar: "Pedir número de celular." });
  if (esVacio(a.correo)) f.push({ campo: "Correo", solicitar: "Pedir correo electrónico." });
  if (!a.cedulaExpedidaEn || !a.fechaPosesion)
    f.push({ campo: "Datos del formulario", solicitar: "El formulario pide cédula expedida en, teléfono fijo y fecha de posesión; la base no los tiene." });
  const sinConfirmar = hijos.filter((h) => h.afiliado === null).length;
  if (sinConfirmar)
    f.push({ campo: "Hijos", solicitar: `${sinConfirmar} hijo(s) registrados sin saber si están afiliados al servicio. Confirmar.` });
  return f;
}

interface Contexto {
  afiliados: Afiliado[];
  hijos: Hijo[];
  hojasOmitidas: string[];
  pagadores: string[];
}

export function calcularPendientes({ afiliados, hijos, hojasOmitidas, pagadores }: Contexto): Pendiente[] {
  const activos = afiliados.filter((a) => !RETIRO(a));
  const cuenta = (fn: (a: Afiliado) => boolean, lista = activos) => lista.filter(fn).length;
  const otrasEntidades = pagadores.filter((p) => /^(Alcaldía|Alcaldia|Personer)/i.test(p) && !/Ibagu/i.test(p));
  const lista: Pendiente[] = [
    {
      id: "sin-cedula", categoria: "Datos faltantes", titulo: "Afiliados sin cédula",
      solicitar: "Lista de afiliados sin número de cédula (se descarga abajo) para que la completen.",
      mientras: "Se muestran en la base pero no entran al cruce mensual.",
      afectados: cuenta((a) => !a.cedula, afiliados), ver: "/?falta=cedula",
    },
    {
      id: "corridas", categoria: "Datos faltantes", titulo: "Filas con columnas corridas en el Excel",
      solicitar: "Revisar estas filas: los datos quedaron una columna antes o después de su encabezado (en \"fecha de nacimiento\" aparece el correo, el cargo o el sexo).",
      mientras: "Se importan tal cual; los campos de esas personas pueden mostrar el dato de la columna vecina.",
      afectados: cuenta(columnasCorridas, afiliados), ver: "/?falta=corridas&estado=todos",
    },
    {
      id: "fechas", categoria: "Datos faltantes", titulo: "Fechas de nacimiento vacías o ilegibles",
      solicitar: "Fecha de nacimiento correcta de cada uno (hay textos como \"####\" o \"13 de septiembre de agosto\").",
      mientras: "No aparecen en cumpleaños. El texto original se conserva tal cual.",
      afectados: cuenta((a) => !a.fechaNacimiento), ver: "/?falta=fecha",
    },
    {
      id: "conflictos", categoria: "Datos faltantes", titulo: "Cédulas en hojas de activos y de retirados a la vez",
      solicitar: "Confirmar si cada persona sigue afiliada o se retiró.",
      mientras: "Se toman como activos (gana la hoja de activos).",
      afectados: cuenta(conflictoDeHojas, afiliados), ver: "/?falta=conflicto",
    },
    {
      id: "tipo", categoria: "Datos faltantes", titulo: "Docente o administrativo",
      solicitar: "La base no tiene una columna para esto. Confirmar o agregar la columna (hay dos formularios distintos).",
      mientras: "Se deduce del cargo: DOCENTE, COORDINADOR, RECTOR u ORIENTADOR = docente; el resto, administrativo.",
      afectados: cuenta((a) => a.tipoInferido), ver: "/?falta=tipo",
    },
    {
      id: "hijos", categoria: "Datos faltantes", titulo: "Hijos afiliados al servicio",
      solicitar: "¿Cómo se sabe si un hijo está afiliado al servicio? La base solo trae nombre, fecha y registro civil.",
      mientras: "Cada hijo queda como \"sin confirmar\" y se puede marcar a mano en la ficha.",
      afectados: hijos.filter((h) => h.afiliado === null).length, ver: "/?falta=hijos",
    },
    {
      id: "formulario", categoria: "Datos faltantes", titulo: "Datos del formulario que la base no tiene",
      solicitar: "Cédula expedida en, teléfono fijo y fecha de posesión de los afiliados actuales.",
      mientras: "Los campos existen en la ficha y en el formulario nuevo, vacíos para los importados.",
      afectados: activos.length,
    },
    {
      id: "columnas", categoria: "Definiciones", titulo: "Columnas sin significado claro",
      solicitar: "Qué significan: \"2025-01-01\" (sí/no), AFILIACIÓN FÍSICA, WT, ANEXO CÉDULA e INST. EDUC. (en SEMIBAGUE trae teléfonos).",
      mientras: "Se guardan tal cual en \"Otros datos del Excel\" y se exportan igual.",
    },
    {
      id: "seguimiento-depto", categoria: "Definiciones", titulo: "Hoja SEGUIMIENTO DE DESCUENTOS DEPTO",
      solicitar: "Para qué es esa hoja y si esas personas son parte de DEPARTAMENTO.",
      mientras: "Se importan como afiliados activos de la Secretaría del Tolima.",
    },
    {
      id: "colores", categoria: "Definiciones", titulo: "Colores de seguimiento de la novedad",
      solicitar: "La hoja ALCALDIAS marca con colores: sin descuento, descuento realizado, novedad enviada y novedad próxima a enviar. Los colores no se pueden importar; confirmar el estado de cada persona.",
      mientras: "Cada ficha tiene el campo \"Seguimiento de la novedad\" con esas mismas opciones, vacío.",
    },
    {
      id: "tramite", categoria: "Definiciones", titulo: "Tiempo de espera de una novedad",
      solicitar: "¿Cuántos meses se espera desde \"NOVEDAD: AFILIAR EN…\" antes de considerar que falló el descuento?",
      mientras: "Se usan 2 meses. Después de eso, cuenta como \"sin descuento\".",
      afectados: cuenta((a) => a.novedadPeriodo !== null),
    },
    {
      id: "extraordinaria", categoria: "Definiciones", titulo: "Cuota extraordinaria",
      solicitar: "¿Hay que controlar quién debe la cuota extraordinaria y cuánto? ¿Quiénes deben pagarla?",
      mientras: "Se lista aparte en cada cruce, sin control de deuda.",
    },
    {
      id: "valor", categoria: "Definiciones", titulo: "Valor correcto de la cuota",
      solicitar: "El formulario docente dice 0,5 %. ¿Se quiere revisar que el valor descontado sea el correcto? ¿Cuál es la cuota de administrativos?",
      mientras: "Solo se revisa si aparece o no en el reporte.",
    },
    {
      id: "retirados-descuento", categoria: "Operación", titulo: "Retirados a los que les siguen descontando",
      solicitar: "¿Qué procedimiento siguen (devolución, novedad de retiro)? ¿Quién lo hace?",
      mientras: "La demo los muestra como alerta roja en cada cruce.",
      ver: "/cruce",
    },
    {
      id: "otros-reportes", categoria: "Archivos por recibir", titulo: "Reportes de otras entidades",
      solicitar: `Un reporte mensual de muestra de: ${otrasEntidades.join(", ") || "otras alcaldías y personerías"}.`,
      mientras: "Esos afiliados se ven en la base pero no se cruzan.",
      afectados: activos.filter((a) => otrasEntidades.includes(a.pagador)).length,
    },
    {
      id: "hojas-omitidas", categoria: "Archivos por recibir", titulo: "Hojas que no son de afiliados",
      solicitar: `Confirmar que estas hojas se pueden reemplazar por la app: ${hojasOmitidas.join(", ") || "ninguna"}.`,
      mientras: "No se importan. El crecimiento mensual se calcula solo en Resumen general.",
    },
    {
      id: "usuarios", categoria: "Operación", titulo: "Usuarios de la app",
      solicitar: "Nombre de cada persona que usará la app y si puede editar o solo consultar.",
      mientras: "Un único usuario de demostración.",
    },
    {
      id: "alertas", categoria: "Operación", titulo: "Cómo recibir alertas",
      solicitar: "¿Las alertas de cumpleaños y de morosos les sirven por correo, Telegram o solo dentro de la app?",
      mientras: "Solo dentro de la app.",
    },
    {
      id: "evento", categoria: "Datos faltantes", titulo: "Fecha y lugar de la integración de fin de año",
      solicitar: "Fecha y lugar del evento cuya asistencia está en la columna \"ASISTENCIA INTEGRACIÓN FIN DE AÑO\".",
      mientras: "El evento existe en la app con su lista de asistentes, pero con fecha y lugar provisionales.",
    },
    {
      id: "seguimiento", categoria: "Operación", titulo: "Seguimiento compartido de la lista de contactos",
      solicitar: "¿Varias personas trabajan a la vez la lista de \"no les descontaron\"? ¿Cada una debe ver lo que marcó la otra?",
      mientras: "El estado (por contactar, contactada, resuelto) y la nota se guardan en cada PC.",
    },
  ];
  return lista.map((x) => ({ ...x, ...DETALLE[x.id] }));
}

/** Prioridad, por qué importa y un ejemplo sin datos personales, para explicar cada pendiente. */
export const DETALLE: Record<string, { prioridad: Prioridad; porque: string; ejemplo?: string }> = {
  "corridas": {
    prioridad: "Alta",
    porque: "Si los datos están en la columna equivocada, la app muestra el correo donde va la fecha, el colegio donde va el celular, y los cumpleaños y contactos fallan.",
    ejemplo: "En la hoja RETIROS, una fila tiene en FECHA DE NACIMIENTO un correo y en CELULAR el nombre del colegio: todo quedó una columna a la izquierda.",
  },
  "conflictos": {
    prioridad: "Alta",
    porque: "No se sabe si la persona sigue afiliada. Si está retirada y la nómina la descuenta, hay que devolver la plata.",
    ejemplo: "Una misma cédula aparece en SEMIBAGUE (activos) y en DESVINCULADOS DTO.",
  },
  "sin-cedula": {
    prioridad: "Alta",
    porque: "La cédula es lo que une la base con el reporte de nómina. Sin ella, la persona nunca aparece como descontada ni como pendiente.",
    ejemplo: "En RETIROS hay filas con nombre pero con la celda de CEDULA vacía.",
  },
  "otros-reportes": {
    prioridad: "Alta",
    porque: "Sin el reporte mensual de esas entidades no se puede saber si a esos afiliados les descuentan.",
    ejemplo: "La hoja ALCALDIAS tiene afiliados de Venadillo, Santa Isabel y la Personería de Falán, pero solo llegó el reporte de la Alcaldía de Ibagué.",
  },
  "retirados-descuento": {
    prioridad: "Alta",
    porque: "Es plata que se le sigue cobrando a quien ya no es afiliado: genera reclamos.",
    ejemplo: "En septiembre, 8 personas que están en RETIROS o DESVINCULADOS aparecen con descuento en nómina.",
  },
  "tipo": {
    prioridad: "Media",
    porque: "Hay dos formularios distintos (docente y administrativo) y cuotas distintas, pero la base no dice quién es qué.",
    ejemplo: "La columna CARGO dice DOCENTE, CELADOR o AUX ADMINISTRATIVO; con eso la app adivina, pero no es seguro.",
  },
  "fechas": {
    prioridad: "Media",
    porque: "Sin fecha de nacimiento válida la persona no sale en cumpleaños.",
    ejemplo: "Hay celdas con \"##################\", \"sin informacion\" o \"13 de septiembre de agosto\".",
  },
  "tramite": {
    prioridad: "Media",
    porque: "Define cuándo una afiliación nueva deja de estar \"en trámite\" y pasa a la lista de contactar.",
    ejemplo: "Hay personas con \"NOVEDAD: AFILIAR EN FEBRERO 2026\" que en septiembre todavía no tienen descuento.",
  },
  "extraordinaria": {
    prioridad: "Media",
    porque: "Los reportes traen una cuota extraordinaria (150.000, 300.000, 450.000) aparte de la mensual.",
    ejemplo: "En septiembre hubo 40 descuentos de cuota extraordinaria entre Ibagué y Tolima.",
  },
  "hijos": {
    prioridad: "Media",
    porque: "Piden saber qué hijos están afiliados al servicio, pero la base no lo indica.",
    ejemplo: "Las columnas HIJO 1 / NOMBRE, F. NAC y REGISTRO CIVIL no dicen si el hijo está afiliado.",
  },
  "columnas": {
    prioridad: "Media",
    porque: "Hay columnas que se conservan, pero no sabemos qué significan ni si deben aparecer en la app.",
    ejemplo: "La columna titulada \"1/01/2025\" tiene casillas marcadas; WT y AFILIACIÓN FÍSICA también.",
  },
  "colores": {
    prioridad: "Media",
    porque: "En el Excel el estado de la novedad se marca con colores, y los colores no se pueden leer automáticamente.",
    ejemplo: "La hoja ALCALDIAS tiene una leyenda: sin descuento, descuento realizado, novedad enviada y novedad próxima a enviar.",
  },
  "seguimiento": { prioridad: "Media", porque: "Define si el seguimiento de contactos se guarda en el servidor o basta con cada PC." },
  "usuarios": { prioridad: "Media", porque: "Para crear el acceso de cada persona y decidir quién puede editar." },
  "valor": { prioridad: "Baja", porque: "Permitiría detectar descuentos por un valor equivocado, no solo los que faltan." },
  "formulario": { prioridad: "Baja", porque: "El formulario de afiliación pide datos que la base no tiene; se pueden ir completando." },
  "seguimiento-depto": { prioridad: "Baja", porque: "Son 7 personas en una hoja aparte; hay que saber si son activas o un control temporal." },
  "hojas-omitidas": { prioridad: "Baja", porque: "La \"Hoja 10\" lleva el crecimiento a mano; la app ya lo calcula sola." },
  "evento": { prioridad: "Baja", porque: "Para que el historial de eventos quede completo." },
  "alertas": { prioridad: "Baja", porque: "Para decidir si vale la pena enviar avisos fuera de la app." },
};
