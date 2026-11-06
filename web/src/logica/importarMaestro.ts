import * as XLSX from "xlsx";
import { db, guardarMeta } from "../datos/db";
import { vaciarTabla } from "../datos/sincronizacion";
import {
  PAG_ALCALDIA_IBAGUE, PAG_IBAGUE, PAG_SIN_DEFINIR, PAG_TOLIMA,
  type Afiliado, type Estado, type Hijo, type Pagador,
} from "../datos/tipos";
import { leerFecha, leerNovedad } from "./fechas";
import { esVacio, limpiarCedula, normalizar, texto, tituloCaso } from "./texto";
import { FILAS_ELIMINADAS } from "./eliminar";

/** Campos de Afiliado que salen directo de una columna del Excel. */
type CampoTexto =
  | "nombre" | "observaciones" | "municipio" | "sexo" | "celular" | "otroCelular" | "correo"
  | "institucion" | "cargo" | "area" | "directiva" | "cargoDirectivo" | "sindicatoRetirado"
  | "vinculacion" | "quienAfilia" | "cajaCompensacion" | "comuna";
type Campo = CampoTexto | "cedula" | "fechaAfiliacion" | "fechaNacimiento";

export const MAPA_COLUMNAS: Record<string, Campo> = {
  "CEDULA": "cedula",
  "NOMBRE Y APELLIDOS": "nombre",
  "OBSERVACIONES": "observaciones",
  "FECHA DE AFILIACION": "fechaAfiliacion",
  "FECHA AFILIACION": "fechaAfiliacion",
  "MUNICIPIO": "municipio",
  "FEMENINO/MASCULINO": "sexo",
  "F/M": "sexo",
  "CELULAR": "celular",
  "OTRO CELULAR": "otroCelular",
  "CORREO ELECTRONICO": "correo",
  "INSTITCION QUE LABORA": "institucion",
  "CARGO": "cargo",
  "AREA": "area",
  "DIRECTIVA": "directiva",
  "CARGO DIRECTIVO": "cargoDirectivo",
  "FECHA NAC": "fechaNacimiento",
  "FECHA NACIMIENTO": "fechaNacimiento",
  "SINDICATO RETIRADO": "sindicatoRetirado",
  "SINDICADO RETIRADO": "sindicatoRetirado",
  "PROVISIONAL/CARRERA": "vinculacion",
  "QUIEN LO AFILIA": "quienAfilia",
  "CAJA COMPENSACION": "cajaCompensacion",
  "CAJA DE COMPENSACION": "cajaCompensacion",
  "COMUNA": "comuna",
};

const CALCULADAS = new Set(["N°", "NO", "D", "M", "A", "EDAD"]);

export function claveColumna(h: unknown): string {
  return normalizar(h).replace(/[*?]/g, "").replace(/\s*\/\s*/g, "/").trim();
}

export function etiquetaColumna(h: unknown, i: number): string {
  if (h instanceof Date) return `Columna ${texto(h)}`;
  const t = texto(h);
  return t || `Columna ${XLSX.utils.encode_col(i)}`;
}

interface ConfigHoja { pagador: Pagador; estado: Estado; prioridad: number; conocida: boolean }

const HOJAS: Record<string, ConfigHoja> = {
  "SEMIBAGUE": { pagador: PAG_IBAGUE, estado: "activo", prioridad: 0, conocida: true },
  "DEPARTAMENTO": { pagador: PAG_TOLIMA, estado: "activo", prioridad: 0, conocida: true },
  "ALCALDIAS": { pagador: PAG_ALCALDIA_IBAGUE, estado: "activo", prioridad: 0, conocida: true },
  "SEGUIMIENTO DE DESCUENTOS DEPTO": { pagador: PAG_TOLIMA, estado: "activo", prioridad: 1, conocida: false },
  "RETIROS": { pagador: PAG_SIN_DEFINIR, estado: "retirado", prioridad: 2, conocida: true },
  "DESVINCULADOS IBAGUE": { pagador: PAG_IBAGUE, estado: "desvinculado", prioridad: 2, conocida: true },
  "DESVINCULADOS DTO": { pagador: PAG_TOLIMA, estado: "desvinculado", prioridad: 2, conocida: true },
};

function configHoja(nombre: string): ConfigHoja {
  return HOJAS[normalizar(nombre)] ?? { pagador: PAG_SIN_DEFINIR, estado: "activo", prioridad: 1, conocida: false };
}

/** "AFILIADOS ALCALDÍA DE VENADILLO" -> "Alcaldía de Venadillo" */
function pagadorDeSeccion(titulo: string): Pagador {
  const n = normalizar(titulo);
  if (n.includes("ALCALDIA DE IBAGUE")) return PAG_ALCALDIA_IBAGUE;
  return tituloCaso(titulo.replace(/^\s*afiliados\s+/i, ""));
}

export function nuevoAfiliado(parcial: Partial<Afiliado> = {}): Afiliado {
  return {
    cedula: null, nombre: "", hojas: [], pagador: PAG_SIN_DEFINIR, tipo: "docente", tipoInferido: false,
    estado: "activo", municipio: "", sexo: "", celular: "", otroCelular: "", telefonoFijo: "", correo: "",
    institucion: "", cargo: "", area: "", directiva: "", cargoDirectivo: "",
    fechaNacimiento: null, fechaNacimientoOriginal: "", fechaAfiliacion: null, fechaAfiliacionOriginal: "",
    fechaPosesion: null, cedulaExpedidaEn: "", quienAfilia: "", cajaCompensacion: "", comuna: "",
    vinculacion: "", sindicatoRetirado: "", observaciones: "", novedadPeriodo: null, seguimientoNovedad: "",
    extra: {}, origen: [], actualizadoEn: new Date().toISOString(),
    ...parcial,
  };
}

const CARGOS_DOCENTES = /DOCENTE|COORDINADOR|RECTOR|ORIENTADOR|PTA/;

export function inferirTipo(cargo: string): "docente" | "administrativo" {
  return CARGOS_DOCENTES.test(normalizar(cargo)) || esVacio(cargo) ? "docente" : "administrativo";
}

export interface ResumenImportacion {
  archivo: string;
  hojas: { nombre: string; filas: number; conCedula: number; sinCedula: number; seccion?: string[]; conocida: boolean }[];
  omitidas: string[];
  afiliados: number;
  hijos: number;
  repetidas: number;
  fechasNoLeidas: number;
}

interface Fila {
  hoja: string;
  fila: number;
  filaEncabezado: number;
  encabezados: unknown[];
  valores: unknown[];
  pagador: Pagador;
  estado: Estado;
  prioridad: number;
}

function esEncabezado(r: unknown[]): boolean {
  return r.some((c) => claveColumna(c) === "CEDULA");
}

function esTituloSeccion(r: unknown[]): string | null {
  const llenas = r.filter((c) => c !== null && c !== "" && c !== undefined);
  if (llenas.length === 1 && typeof llenas[0] === "string" && /AFILIADOS/.test(normalizar(llenas[0]))) {
    return llenas[0];
  }
  return null;
}

export async function importarMaestro(archivo: File): Promise<ResumenImportacion> {
  const contenido = new Uint8Array(await archivo.arrayBuffer());
  const wb = XLSX.read(contenido, { cellDates: true });
  const resumen: ResumenImportacion = {
    archivo: archivo.name, hojas: [], omitidas: [], afiliados: 0, hijos: 0, repetidas: 0, fechasNoLeidas: 0,
  };
  const filas: Fila[] = [];
  const originales: Record<string, unknown[][]> = {};

  for (const nombre of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], { header: 1, raw: true, defval: null });
    originales[nombre] = rows;
    if (!rows.slice(0, 6).some((r) => esEncabezado(r ?? []))) {
      resumen.omitidas.push(nombre);
      continue;
    }
    const cfg = configHoja(nombre);
    let encabezados: unknown[] = [];
    let filaEncabezado = -1;
    let pagador = cfg.pagador;
    const secciones: string[] = [];
    const info = { nombre, filas: 0, conCedula: 0, sinCedula: 0, seccion: secciones, conocida: cfg.conocida };

    rows.forEach((r, i) => {
      r = r ?? [];
      const sec = esTituloSeccion(r);
      if (sec) {
        if (normalizar(nombre) === "ALCALDIAS") {
          pagador = pagadorDeSeccion(sec);
          secciones.push(pagador);
        }
        return;
      }
      if (esEncabezado(r)) {
        encabezados = r;
        filaEncabezado = i;
        return;
      }
      if (filaEncabezado < 0) return;
      const ci = encabezados.findIndex((h) => claveColumna(h) === "CEDULA");
      const ni = encabezados.findIndex((h) => claveColumna(h) === "NOMBRE Y APELLIDOS");
      const ced = limpiarCedula(r[ci]);
      const nom = texto(r[ni]);
      // Filas de leyenda o vacías: sin cédula numérica y sin nombre real.
      if (!ced && (!nom || /^\d+(\.0)?$/.test(nom))) return;
      if (!ced && typeof r[ci] === "string" && !/\d/.test(r[ci] as string)) return;
      info.filas++;
      if (ced) info.conCedula++; else info.sinCedula++;
      filas.push({ hoja: nombre, fila: i, filaEncabezado, encabezados, valores: r, pagador, estado: cfg.estado, prioridad: cfg.prioridad });
    });
    resumen.hojas.push(info);
  }

  // Hojas activas primero: si una cédula está en activos y en retiros, gana el dato activo.
  filas.sort((a, b) => a.prioridad - b.prioridad);

  const porCedula = new Map<string, { af: Afiliado; hijos: Omit<Hijo, "afiliadoId">[] }>();
  const sinCedula: { af: Afiliado; hijos: Omit<Hijo, "afiliadoId">[] }[] = [];

  for (const f of filas) {
    const { af, hijos } = filaAAfiliado(f);
    if (af.fechaNacimientoOriginal && !esVacio(af.fechaNacimientoOriginal) && !af.fechaNacimiento) resumen.fechasNoLeidas++;
    if (!af.cedula) {
      sinCedula.push({ af, hijos });
      continue;
    }
    const prev = porCedula.get(af.cedula);
    if (!prev) {
      porCedula.set(af.cedula, { af, hijos });
      continue;
    }
    resumen.repetidas++;
    prev.af.hojas.push(...af.hojas);
    prev.af.origen.push(...af.origen);
    for (const k of Object.keys(af) as (keyof Afiliado)[]) {
      const actual = prev.af[k];
      if ((actual === "" || actual === null) && af[k] !== "" && af[k] !== null) {
        (prev.af as unknown as Record<string, unknown>)[k] = af[k];
      }
    }
    for (const [k, v] of Object.entries(af.extra)) if (!(k in prev.af.extra)) prev.af.extra[k] = v;
    for (const h of hijos) if (!prev.hijos.some((p) => normalizar(p.nombre) === normalizar(h.nombre))) prev.hijos.push(h);
  }

  const todos = [...porCedula.values(), ...sinCedula];
  await db.transaction("rw", [db.afiliados, db.hijos, db.cruces, db.cruceDetalle, db.meta, db.celdas], async () => {
    // vaciarTabla también avisa al servidor, para que la base se reemplace en todos los equipos.
    await vaciarTabla(db.celdas);
    await vaciarTabla(db.afiliados);
    await vaciarTabla(db.hijos);
    const ids = (await db.afiliados.bulkAdd(todos.map((t) => t.af), { allKeys: true })) as number[];
    const hijos: Hijo[] = [];
    todos.forEach((t, i) => t.hijos.forEach((h) => hijos.push({ ...h, afiliadoId: ids[i] })));
    await db.hijos.bulkAdd(hijos);
    // Los cruces viejos apuntan a ids que ya no existen: se reenlazan por cédula.
    const porCed = new Map(todos.map((t, i) => [t.af.cedula, ids[i]]));
    await db.cruceDetalle.toCollection().modify((d) => {
      d.afiliadoId = porCed.get(d.cedula) ?? null;
    });
    resumen.afiliados = ids.length;
    resumen.hijos = hijos.length;
  });

  // Una entrada por hoja: completo, el Excel no cabe en una sola fila de la base del servidor.
  for (const [hoja, filas] of Object.entries(originales)) await guardarMeta(`filasOriginales:${hoja}`, filas);
  await guardarMeta("ordenHojas", wb.SheetNames);
  // El archivo completo, para descargar después el Excel con sus colores y formato.
  const { guardarArchivoOriginal } = await import("./xlsxOriginal");
  await guardarArchivoOriginal(contenido, archivo.name);
  // Un ordenamiento anterior ya no aplica a esta base nueva.
  await db.meta.delete("normalizacion");
  await db.meta.delete(FILAS_ELIMINADAS);
  await guardarMeta("importacion", { ...resumen, fecha: new Date().toISOString() });
  return resumen;
}

function filaAAfiliado(f: Fila): { af: Afiliado; hijos: Omit<Hijo, "afiliadoId">[] } {
  const af = nuevoAfiliado({
    hojas: [f.hoja],
    pagador: f.pagador,
    estado: f.estado,
    tipoInferido: true,
    origen: [{ hoja: f.hoja, fila: f.fila }],
  });
  const hijos: Omit<Hijo, "afiliadoId">[] = [];
  const claves = f.encabezados.map(claveColumna);
  const inicioHijos = claves.findIndex((c) => c.startsWith("HIJO"));
  const finHijos = claves.findIndex((c, i) => i > inicioHijos && (c === "SINDICATO RETIRADO" || c === "SINDICADO RETIRADO"));
  const usadas = new Set<string>();

  claves.forEach((clave, i) => {
    const v = f.valores[i];
    if (inicioHijos >= 0 && i >= inicioHijos && (finHijos < 0 || i < finHijos)) {
      if (clave.startsWith("HIJO") && !esVacio(v) && v !== null) {
        const fn = claves[i + 1]?.startsWith("F") ? f.valores[i + 1] : null;
        const rc = claves[i + 3]?.startsWith("REGISTRO") ? f.valores[i + 3] : null;
        hijos.push({
          nombre: texto(v),
          fechaNacimiento: leerFecha(fn),
          fechaNacimientoOriginal: texto(fn),
          registroCivil: texto(rc),
          afiliado: null,
        });
      }
      return;
    }
    const campo = MAPA_COLUMNAS[clave];
    if (campo && !usadas.has(campo)) {
      usadas.add(campo);
      if (campo === "cedula") af.cedula = limpiarCedula(v);
      else if (campo === "fechaNacimiento") {
        af.fechaNacimientoOriginal = texto(v);
        af.fechaNacimiento = leerFecha(v);
      } else if (campo === "fechaAfiliacion") {
        af.fechaAfiliacionOriginal = texto(v);
        af.fechaAfiliacion = leerFecha(v);
      } else af[campo] = texto(v);
      return;
    }
    if (CALCULADAS.has(clave) || v === null || v === "" || v === false) return;
    let etiqueta = etiquetaColumna(f.encabezados[i], i);
    let n = 2;
    while (etiqueta in af.extra) etiqueta = `${etiquetaColumna(f.encabezados[i], i)} (${n++})`;
    af.extra[etiqueta] = v === true ? "Sí" : texto(v);
  });

  af.tipo = inferirTipo(af.cargo);
  af.novedadPeriodo = leerNovedad(af.observaciones);
  return { af, hijos };
}
