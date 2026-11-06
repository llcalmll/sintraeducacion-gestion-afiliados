import * as XLSX from "xlsx";
import type { Concepto, Fuente, LineaReporte } from "../datos/tipos";
import { MESES, periodoAnterior } from "./fechas";
import { limpiarCedula, normalizar, pesos, texto } from "./texto";

const NIT_SINDICATO = "000000000";

export interface ReporteLeido {
  fuente: Fuente;
  archivo: string;
  periodo: string | null;
  lineas: LineaReporte[];
  advertencias: string[];
  /** Reporte del portal de la Secretaría de Ibagué, sin título ni mes: hay que confirmar el mes y qué parte es. */
  sinEncabezado?: boolean;
  periodoSugerido?: string;
  fechaImpresion?: string;
  sinPlantaCentral?: boolean;
}

/** El archivo tiene contraseña: falta escribirla, o la que se escribió no es. */
export class ArchivoConClave extends Error {
  motivo: "falta" | "incorrecta";
  constructor(archivo: string, motivo: "falta" | "incorrecta") {
    super(motivo === "falta" ? `"${archivo}" tiene contraseña: súbalo desde Descuentos del mes y la app se la pide.` : `La contraseña de "${archivo}" no es correcta.`);
    this.motivo = motivo;
  }
}

/** Abre el Excel; si tiene contraseña, lo descifra con la que se le pasa (nunca se guarda ni sale del navegador). */
async function leerLibro(archivo: File, clave?: string): Promise<XLSX.WorkBook> {
  const datos = await archivo.arrayBuffer();
  try {
    return XLSX.read(datos, { cellDates: true });
  } catch (e) {
    if (!/password|encrypt/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
  if (!clave) throw new ArchivoConClave(archivo.name, "falta");
  const { descifrarExcel } = await import("./descifrado/descifrar");
  const abierto = await descifrarExcel(datos, clave);
  if (abierto === "incorrecta") throw new ArchivoConClave(archivo.name, "incorrecta");
  if (abierto === "no-soportado") throw new Error(`No se pudo abrir "${archivo.name}": usa un tipo de contraseña que la app no reconoce. Ábralo en Excel, guárdelo sin contraseña y súbalo de nuevo.`);
  return XLSX.read(abierto, { cellDates: true });
}

export async function leerReporte(archivo: File, clave?: string): Promise<ReporteLeido> {
  const ext = archivo.name.toLowerCase().split(".").pop();
  if (ext === "pdf") return leerPdfAlcaldia(archivo, clave);
  if (ext === "xls" || ext === "xlsx") {
    const wb = await leerLibro(archivo, clave);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const todo = normalizar(rows.slice(0, 12).flat().map(texto).join(" "));
    if (rows.some((r) => (r ?? []).some((c) => normalizar(c) === "ID EMPLEADO"))) return leerTolima(archivo.name, rows);
    if (todo.includes("TERCEROS DE NOMINA") && todo.includes("IBAGUE")) return leerIbague(archivo.name, rows);
    if (esPortalIbague(rows)) return leerPortalIbague(archivo.name, rows);
  }
  throw new Error(
    `No reconozco el formato de "${archivo.name}". Se aceptan: el .xls de la Secretaría de Ibagué, el .xlsx de la Secretaría del Tolima y el PDF de la Alcaldía de Ibagué.`,
  );
}

const periodoDeNomina = (s: string) => {
  const m = s.match(/(20\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
};

/** Reporte de impresión de la Secretaría de Educación de Ibagué (.xls). */
function leerIbague(archivo: string, rows: unknown[][]): ReporteLeido {
  const lineas: LineaReporte[] = [];
  let periodo: string | null = null;
  let grupo = "";
  for (const r0 of rows) {
    const r = r0 ?? [];
    const textoFila = r.map(texto).join(" ");
    if (/CodNomina/i.test(textoFila)) periodo = periodoDeNomina(textoFila);
    const codigo = r.find((c) => typeof c === "string" && /^SINEDU\d*$/i.test(c.trim()));
    if (codigo) grupo = String(codigo).trim().toUpperCase();
    const ci = r.findIndex((c, i) => i <= 7 && typeof c === "number" && limpiarCedula(c) && limpiarCedula(c) !== NIT_SINDICATO);
    if (ci < 0) continue;
    const cedula = limpiarCedula(r[ci])!;
    const nombre = texto(r.slice(ci + 1).find((c) => typeof c === "string" && /[A-Za-zÑñ]/.test(c)));
    const numeros = r.filter((c): c is number => typeof c === "number");
    const valor = numeros[numeros.length - 1];
    if (!nombre || numeros.length < 2) continue;
    const concepto: Concepto = /\d$/.test(grupo) ? "extraordinaria" : "ordinaria";
    lineas.push({ cedula, nombre, valor, concepto, fuente: "SEM_IBAGUE", detalle: grupo });
  }
  return { fuente: "SEM_IBAGUE", archivo, periodo, lineas, advertencias: avisoDeTotal(rows, lineas) };
}

/** El portal entrega el mismo reporte de Ibagué sin encabezado: se reconoce por la fila del NIT del sindicato y sus grupos SINEDU. */
function esPortalIbague(rows: unknown[][]): boolean {
  const celdas = rows.flatMap((r) => r ?? []);
  return celdas.some((c) => typeof c === "string" && c.replace(/\D/g, "").startsWith(NIT_SINDICATO))
    && celdas.some((c) => typeof c === "string" && /^SINEDU\d*$/i.test(c.trim()));
}

function leerPortalIbague(archivo: string, rows: unknown[][]): ReporteLeido {
  const r = leerIbague(archivo, rows);
  // La fecha de impresión (03/11/2026) sugiere el mes de la nómina: el anterior. La persona lo confirma.
  const fecha = rows.flatMap((f) => f ?? []).find((c): c is string => typeof c === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(c.trim()))?.trim();
  const [, mes, anio] = fecha?.split("/") ?? [];
  return { ...r, periodo: null, sinEncabezado: true, sinPlantaCentral: true, fechaImpresion: fecha, periodoSugerido: fecha ? periodoAnterior(`${anio}-${mes}`) : undefined };
}

/** El reporte trae el total por entidad en la fila del NIT: si las personas no suman eso, al archivo le falta un pedazo. */
function avisoDeTotal(rows: unknown[][], lineas: LineaReporte[]): string[] {
  const declarado = rows.reduce((s, f) => {
    if (!(f ?? []).some((c) => typeof c === "string" && c.replace(/\D/g, "").startsWith(NIT_SINDICATO))) return s;
    const numeros = (f ?? []).filter((c): c is number => typeof c === "number");
    return s + (numeros[numeros.length - 1] ?? 0);
  }, 0);
  const suma = lineas.reduce((s, l) => s + l.valor, 0);
  if (!declarado || declarado === suma) return [];
  return [`El archivo parece incompleto: su total dice ${pesos(declarado)}, pero las personas que trae suman ${pesos(suma)}. Revise que sea el archivo original.`];
}

/** Plataforma de operadores de la Secretaría de Educación del Tolima (.xlsx). */
function leerTolima(archivo: string, rows: unknown[][]): ReporteLeido {
  const hi = rows.findIndex((r) => (r ?? []).some((c) => normalizar(c) === "ID EMPLEADO"));
  const h = rows[hi].map(normalizar);
  const col = (n: string) => h.indexOf(n);
  const [cId, cNom, cCon, cCod, cVal, cNomina, cCentro] = [
    col("ID EMPLEADO"), col("EMPLEADO"), col("CONCEPTO"), col("COD. CONCEPTO"), col("VALOR"), col("COD. NOMINA"), col("CENTRO DE COSTO"),
  ];
  const lineas: LineaReporte[] = [];
  const periodos = new Set<string>();
  for (const r of rows.slice(hi + 1)) {
    if (!r) continue;
    const cedula = limpiarCedula(r[cId]);
    if (!cedula) continue;
    const p = periodoDeNomina(texto(r[cNomina]));
    if (p) periodos.add(p);
    const extra = /EXTRAORDINARIA/.test(normalizar(r[cCon]));
    lineas.push({
      cedula,
      nombre: texto(r[cNom]),
      valor: Number(r[cVal]) || 0,
      concepto: extra ? "extraordinaria" : "ordinaria",
      fuente: "SED_TOLIMA",
      detalle: `${texto(r[cCod])} · ${texto(r[cNomina])} · ${texto(r[cCentro])}`,
    });
  }
  const advertencias = periodos.size > 1 ? [`El archivo trae más de un periodo: ${[...periodos].join(", ")}`] : [];
  return { fuente: "SED_TOLIMA", archivo, periodo: [...periodos][0] ?? null, lineas, advertencias };
}

/** Reporte "Pago terceros" de la Alcaldía de Ibagué (.pdf con texto). */
async function leerPdfAlcaldia(archivo: File, clave?: string): Promise<ReporteLeido> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await archivo.arrayBuffer()), password: clave }).promise;
  } catch (e) {
    if ((e as { name?: string })?.name === "PasswordException") throw new ArchivoConClave(archivo.name, clave ? "incorrecta" : "falta");
    throw e;
  }
  let todo = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const contenido = await (await pdf.getPage(p)).getTextContent();
    todo += " " + contenido.items.map((it) => ("str" in it ? it.str : "")).join(" ");
  }
  todo = todo.replace(/\s+/g, " ");
  if (!/ALCALD/i.test(normalizar(todo))) throw new Error(`"${archivo.name}" no parece el reporte de la Alcaldía de Ibagué.`);

  const lineas: LineaReporte[] = [];
  const re = /(\d{6,11})\s+([^$\d]+?)\s*\$\s*([\d.,]+)/g;
  for (const m of todo.matchAll(re)) {
    if (m[1] === NIT_SINDICATO) continue;
    lineas.push({
      cedula: m[1],
      nombre: m[2].replace(/SINDICATO DE EMPLEADOS DE|EDUCACION DEL TOLIMA|SINTRAEDUCACION/gi, "").trim(),
      valor: Number(m[3].replace(/[.,]/g, "")),
      concepto: "ordinaria",
      fuente: "ALCALDIA_IBAGUE",
    });
  }
  const mp = normalizar(todo).match(new RegExp(`(${MESES.map(normalizar).join("|")}) (20\\d{2})`));
  const periodo = mp ? `${mp[2]}-${String(MESES.map(normalizar).indexOf(mp[1]) + 1).padStart(2, "0")}` : null;
  const advertencias = lineas.length === 0 ? ["No se encontró ninguna cédula en el PDF."] : [];
  return { fuente: "ALCALDIA_IBAGUE", archivo: archivo.name, periodo, lineas, advertencias };
}
