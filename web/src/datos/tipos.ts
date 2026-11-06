export type Estado = "activo" | "pendiente_novedad" | "retirado" | "desvinculado";
export type Tipo = "docente" | "administrativo";

/** Entidad que paga el sueldo y hace el descuento. Texto libre: hay alcaldías y personerías. */
export type Pagador = string;

export const PAG_IBAGUE = "Secretaría de Educación de Ibagué";
export const PAG_TOLIMA = "Secretaría de Educación del Tolima";
export const PAG_ALCALDIA_IBAGUE = "Alcaldía de Ibagué";
export const PAG_SIN_DEFINIR = "Sin definir";

/** Leyenda de colores que usa la hoja ALCALDIAS para seguir la novedad. */
export const SEGUIMIENTOS = [
  "",
  "Sin descuento: realizar seguimiento",
  "Descuento realizado",
  "Novedad enviada: a la espera de respuesta",
  "Novedad próxima a enviar",
] as const;

export const ESTADOS: Record<Estado, string> = {
  activo: "Activo",
  pendiente_novedad: "Pendiente de novedad",
  retirado: "Retirado",
  desvinculado: "Desvinculado",
};

export interface Afiliado {
  id?: number;
  cedula: string | null;
  nombre: string;
  hojas: string[];
  pagador: Pagador;
  tipo: Tipo;
  tipoInferido: boolean;
  estado: Estado;
  municipio: string;
  sexo: string;
  celular: string;
  otroCelular: string;
  telefonoFijo: string;
  correo: string;
  institucion: string;
  cargo: string;
  area: string;
  directiva: string;
  cargoDirectivo: string;
  fechaNacimiento: string | null;
  fechaNacimientoOriginal: string;
  fechaAfiliacion: string | null;
  fechaAfiliacionOriginal: string;
  fechaPosesion: string | null;
  cedulaExpedidaEn: string;
  quienAfilia: string;
  cajaCompensacion: string;
  comuna: string;
  vinculacion: string;
  sindicatoRetirado: string;
  observaciones: string;
  /** Periodo AAAA-MM de "NOVEDAD: AFILIAR EN ..." si la observación lo trae. */
  novedadPeriodo: string | null;
  seguimientoNovedad: string;
  /** Columnas del Excel sin campo propio, con su nombre original. */
  extra: Record<string, string>;
  /** Fila original por hoja para exportar idéntico. */
  origen: { hoja: string; fila: number }[];
  /** Foto o PDF de la cédula, guardado en el servidor. */
  cedulaArchivo?: ArchivoAdjunto;
  /** Campos cambiados en la app; solo esos se escriben de vuelta al Excel original. */
  editados?: string[];
  actualizadoEn: string;
}

export interface Hijo {
  id?: number;
  afiliadoId: number;
  nombre: string;
  fechaNacimiento: string | null;
  fechaNacimientoOriginal: string;
  /** Número del registro civil o enlace (texto libre). */
  registroCivil: string;
  /** El documento del registro civil adjunto (foto o PDF guardado en el servidor). */
  registroCivilArchivo?: ArchivoAdjunto;
  /** F o M (del formulario de inscripción de hijos). */
  sexo?: "F" | "M" | "";
  /** Edad que reportaron en el formulario cuando no hay fecha de nacimiento, y cuándo la reportaron (AAAA-MM-DD). */
  edadReportada?: number;
  edadReportadaEn?: string;
  /** null = no se sabe; se confirma en la reunión. */
  afiliado: boolean | null;
}

/** Archivo guardado en el servidor; en la base solo queda su clave y sus datos. */
export interface ArchivoAdjunto {
  clave: string;
  nombre: string;
  tipo: string;
  tamano: number;
  subidoEn: string;
}

export type Fuente = "SEM_IBAGUE" | "SED_TOLIMA" | "ALCALDIA_IBAGUE" | "SEM_IBAGUE_CENTRAL";

/**
 * "parte": solo trae a unas pocas personas de esa entidad (planta central de Ibagué, que el portal entrega aparte).
 * Por eso cargarla no significa que falten los demás de la entidad: quien no aparece ahí no queda "sin descuento".
 */
export const FUENTES: Record<Fuente, { pagador: Pagador; formato: string; nombre?: string; parte?: boolean }> = {
  SEM_IBAGUE: { pagador: PAG_IBAGUE, formato: ".xls" },
  SED_TOLIMA: { pagador: PAG_TOLIMA, formato: ".xlsx" },
  ALCALDIA_IBAGUE: { pagador: PAG_ALCALDIA_IBAGUE, formato: ".pdf" },
  SEM_IBAGUE_CENTRAL: { pagador: PAG_IBAGUE, formato: ".xlsx", nombre: "Secretaría de Educación de Ibagué: planta central", parte: true },
};
export const nombreFuente = (f: Fuente) => FUENTES[f].nombre ?? FUENTES[f].pagador;

export type Concepto = "ordinaria" | "extraordinaria";

export interface LineaReporte {
  cedula: string;
  nombre: string;
  valor: number;
  concepto: Concepto;
  fuente: Fuente;
  detalle?: string;
}

export type Resultado =
  | "descontado"
  | "sin_descuento"
  | "pendiente_novedad"
  | "novedad_demorada"
  | "retirado_con_descuento"
  | "no_en_base"
  | "extraordinaria";

export const RESULTADOS: Record<Resultado, { titulo: string; tono: string; ayuda: string }> = {
  descontado: { titulo: "Descontados", tono: "ok", ayuda: "Aparecen en el reporte y en la base." },
  sin_descuento: { titulo: "No les descontaron", tono: "malo", ayuda: "Están activos en la base pero no aparecen en el reporte." },
  pendiente_novedad: { titulo: "Afiliación en trámite", tono: "aviso", ayuda: "No aparecen, pero su afiliación se pidió hace poco." },
  novedad_demorada: { titulo: "Afiliación demorada", tono: "info", ayuda: "Su afiliación se pidió hace más de 2 meses y el descuento todavía no aparece." },
  retirado_con_descuento: { titulo: "Retirados con descuento", tono: "malo", ayuda: "Están retirados o desvinculados y aun así les descontaron." },
  no_en_base: { titulo: "Descontados sin estar en la base", tono: "aviso", ayuda: "Les descontaron pero no existen en la base de afiliados." },
  extraordinaria: { titulo: "Ahorro viaje San Andrés", tono: "info", ayuda: "Ahorro para el viaje a San Andrés (150, 300 o 450 mil). Va aparte: no cuenta como descuento mensual." },
};

export type EstadoContacto = "pendiente" | "contactada" | "resuelto";

/** Semáforo del seguimiento: rojo = nadie le ha escrito, amarillo = se le escribió y se espera, verde = arreglado. */
export const ESTADOS_CONTACTO: Record<EstadoContacto, { titulo: string; tono: "rojo" | "ambar" | "verde"; ayuda: string }> = {
  pendiente: { titulo: "Por contactar", tono: "rojo", ayuda: "Nadie le ha escrito todavía" },
  contactada: { titulo: "Contactada", tono: "ambar", ayuda: "Ya se le escribió o llamó; falta que se arregle" },
  resuelto: { titulo: "Resuelto", tono: "verde", ayuda: "Ya quedó arreglado" },
};

/** Seguimiento de una persona a la que no le descontaron en un mes. */
export interface Contacto {
  periodo: string;
  cedula: string;
  estado: EstadoContacto;
  nota: string;
  actualizadoEn: string;
}

/** Reporte leído y guardado, para volver a cruzar el mes cuando llega otro archivo. */
export interface ReporteGuardado {
  periodo: string;
  fuente: Fuente;
  archivo: string;
  lineas: LineaReporte[];
  cargadoEn: string;
  /** Instituciones de Ibagué bajadas del portal: la planta central llega en otro archivo. */
  sinPlantaCentral?: boolean;
}

export interface Cruce {
  id?: number;
  periodo: string; // AAAA-MM
  fuentes: { fuente: Fuente; archivo: string; lineas: number; total: number; sinPlantaCentral?: boolean }[];
  totales: Partial<Record<Resultado, number>>;
  /** Activos de las fuentes cargadas que no tienen cédula y no se pudieron cruzar. */
  sinCedula: number;
  creadoEn: string;
  creadoPor: string;
  /** Cuántas filas de detalle tiene esta versión del mes (las de número mayor sobran). */
  filas?: number;
}

export interface CruceDetalle {
  id?: number;
  cruceId: number;
  periodo: string;
  cedula: string;
  afiliadoId: number | null;
  nombre: string;
  resultado: Resultado;
  fuente: Fuente | null;
  valor: number;
}

export interface Evento {
  id?: number;
  nombre: string;
  fecha: string;
  lugar: string;
  descripcion: string;
  invitados: number[];
  asistentes: number[];
  creadoEn: string;
}

/** Celda del Excel editada en la app. `fila` y `col` son posiciones (desde 0) en la hoja original. */
export interface CeldaEditada {
  hoja: string;
  fila: number;
  col: number;
  valor: unknown;
  editadoEn: string;
}

export interface Meta {
  clave: string;
  valor: unknown;
}

export interface HojaOriginal {
  nombre: string;
  filaEncabezado: number;
  titulo: string | null;
  encabezados: string[];
}
