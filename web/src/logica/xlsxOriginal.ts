import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";
import { db, guardarMeta, leerMeta } from "../datos/db";
import { claveColumna, MAPA_COLUMNAS } from "./importarMaestro";

/*
 * El Excel original del sindicato (viene de Google Sheets) tiene colores, bordes, anchos, filtros,
 * encabezado fijo, formato condicional, comentarios y enlaces. Para no perder nada:
 * - Se guarda el archivo original junto con la base (en partes, para que quepa en el servidor).
 * - Al descargar, se parte de ese archivo y solo se reescriben las celdas que cambiaron,
 *   conservando el estilo de cada una. Todo lo demás queda byte por byte igual.
 * - De paso se leen los colores de relleno para mostrarlos en la vista "Como en Excel".
 */

const META = "archivoOriginal";
const TAM_PARTE = 600_000; // caracteres base64 por parte (el servidor admite filas de hasta ~1,9 MB)

interface InfoArchivo { nombre: string; partes: number; bytes: number; fecha: string }

function aBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const deBase64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

export async function guardarArchivoOriginal(bytes: Uint8Array, nombre: string) {
  const b64 = aBase64(bytes);
  const partes = Math.ceil(b64.length / TAM_PARTE);
  const previo = await leerMeta<InfoArchivo>(META);
  for (let i = 0; i < partes; i++) await guardarMeta(`${META}:${i}`, b64.slice(i * TAM_PARTE, (i + 1) * TAM_PARTE));
  for (let i = partes; i < (previo?.partes ?? 0); i++) await db.meta.delete(`${META}:${i}`);
  await guardarMeta(META, { nombre, partes, bytes: bytes.length, fecha: new Date().toISOString() } satisfies InfoArchivo);
  await guardarMeta("coloresHojas", extraerColores(bytes));
}

export const infoArchivoOriginal = () => leerMeta<InfoArchivo>(META);

export async function leerArchivoOriginal(): Promise<Uint8Array | null> {
  const info = await leerMeta<InfoArchivo>(META);
  if (!info) return null;
  let b64 = "";
  for (let i = 0; i < info.partes; i++) {
    const p = await leerMeta<string>(`${META}:${i}`);
    if (typeof p !== "string") return null; // todavía llegando desde el servidor
    b64 += p;
  }
  return deBase64(b64);
}

/* ───────────────────────── lectura del paquete ───────────────────────── */

type Zip = Record<string, Uint8Array>;
const leer = (z: Zip, ruta: string) => (z[ruta] ? strFromU8(z[ruta]) : "");
const attr = (tag: string, nombre: string) => tag.match(new RegExp(`\\s${nombre}="([^"]*)"`))?.[1];

/** Nombre de hoja -> ruta del XML dentro del paquete. */
function rutasHojas(z: Zip): Map<string, string> {
  const rels = new Map<string, string>();
  for (const m of leer(z, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id"), t = attr(m[0], "Target");
    if (id && t) rels.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const hojas = new Map<string, string>();
  for (const m of leer(z, "xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = desescapar(attr(m[0], "name") ?? "");
    const ruta = rels.get(attr(m[0], "r:id") ?? "");
    if (ruta) hojas.set(nombre, ruta);
  }
  return hojas;
}

const desescapar = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Fila y columna (desde 0) donde empieza cada hoja, igual que al importar con SheetJS. */
function origenes(bytes: Uint8Array): Record<string, { r: number; c: number }> {
  const wb = XLSX.read(bytes, { sheetRows: 1 });
  return Object.fromEntries(wb.SheetNames.map((n) => {
    const ref = wb.Sheets[n]["!ref"];
    return [n, ref ? XLSX.utils.decode_range(ref).s : { r: 0, c: 0 }];
  }));
}

/* ───────────────────────── colores para la vista de la app ───────────────────────── */

/** Por hoja: "fila,col" (como en la app, desde 0) -> color de relleno "#RRGGBB". */
export type ColoresHojas = Record<string, Record<string, string>>;

export function extraerColores(bytes: Uint8Array): ColoresHojas {
  const z = unzipSync(bytes);
  const estilos = leer(z, "xl/styles.xml");
  // Colores del tema: el índice 0 es lt1, 1 dk1, 2 lt2, 3 dk2, 4..9 accent1..6.
  const esquema = leer(z, "xl/theme/theme1.xml").match(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/)?.[0] ?? "";
  const porNombre: Record<string, string> = {};
  for (const m of esquema.matchAll(/<a:(\w+)>\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"/g)) porNombre[m[1]] = m[2];
  const tema = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map((k) => porNombre[k]);

  const rellenos = [...(estilos.match(/<fills\b[\s\S]*?<\/fills>/)?.[0] ?? "").matchAll(/<fill>[\s\S]*?<\/fill>|<fill\/>/g)].map((m) => {
    const f = m[0];
    if (!/patternType="solid"/.test(f)) return null;
    const fg = f.match(/<fgColor\b[^>]*>/)?.[0] ?? "";
    const rgb = attr(fg, "rgb");
    const hex = rgb ? rgb.slice(-6) : attr(fg, "theme") !== undefined ? tema[Number(attr(fg, "theme"))] : undefined;
    return hex && hex.toUpperCase() !== "FFFFFF" ? `#${hex.toUpperCase()}` : null;
  });
  const xfs = [...(estilos.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? "").matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => rellenos[Number(attr(m[0], "fillId") ?? 0)] ?? null);

  const ori = origenes(bytes);
  const out: ColoresHojas = {};
  for (const [hoja, ruta] of rutasHojas(z)) {
    const o = ori[hoja] ?? { r: 0, c: 0 };
    const mapa: Record<string, string> = {};
    for (const m of leer(z, ruta).matchAll(/<c\s([^>]*?)\/?>/g)) {
      const s = attr(` ${m[1]}`, "s"), r = attr(` ${m[1]}`, "r");
      if (!s || !r) continue;
      const color = xfs[Number(s)];
      if (!color) continue;
      const { r: fila, c: col } = XLSX.utils.decode_cell(r);
      mapa[`${fila - o.r},${col - o.c}`] = color;
    }
    out[hoja] = mapa;
  }
  return out;
}

/* ───────────────────────── descarga conservando el formato ───────────────────────── */

const igual = (a: unknown, b: unknown) => {
  const vacio = (v: unknown) => v === null || v === undefined || v === "";
  if (vacio(a) && vacio(b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
};

/**
 * Días desde 1899-12-30 (fecha de Excel), con el día de calendario local. Se suma medio día porque las fechas
 * llegan a medianoche local y a veces unos minutos antes (husos horarios antiguos), igual que en leerFecha.
 */
const serial = (d0: Date) => {
  const d = new Date(d0.getTime() + 12 * 3600 * 1000);
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000;
};

const FORMATO_FECHA = 'd" de "mmmm" de "yyyy';
const LISTAS: Partial<Record<string, string[]>> = {
  sexo: ["F", "M"],
  vinculacion: ["CARRERA", "PROVISIONAL", "SIN DATO"],
  cajaCompensacion: ["COMFENALCO", "COMFATOLIMA", "CAFASUR", "SIN DATO"],
};
const FECHAS = new Set(["fechaNacimiento", "fechaAfiliacion"]);

class Estilos {
  xml: string;
  private xfs: string[];
  private extra: string[] = [];
  private fechaDe = new Map<string, string>();
  private formatosFecha = new Set<number>([14, 15, 16, 17, 22, 45, 46, 47]);
  private idFormato: number;

  constructor(xml: string) {
    this.xml = xml;
    this.xfs = [...(xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? "").matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
    let id = -1, max = 163;
    for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
      const n = Number(attr(m[0], "numFmtId")), code = desescapar(attr(m[0], "formatCode") ?? "");
      max = Math.max(max, n);
      if (/[dmy]/i.test(code.replace(/"[^"]*"/g, "")) && !/^[#0.,%]+$/.test(code)) this.formatosFecha.add(n);
      if (code === FORMATO_FECHA) id = n;
    }
    if (id < 0) {
      id = max + 1;
      const nuevo = `<numFmt numFmtId="${id}" formatCode="${escapar(FORMATO_FECHA)}"/>`;
      this.xml = /<numFmts\b/.test(this.xml)
        ? this.xml.replace(/<numFmts count="(\d+)">/, (_m, c) => `<numFmts count="${Number(c) + 1}">${nuevo}`)
        : this.xml.replace(/<fonts\b/, `<numFmts count="1">${nuevo}</numFmts><fonts`);
      this.formatosFecha.add(id);
    }
    this.idFormato = id;
  }

  /** Estilo para una fecha: el mismo de la celda si ya es de fecha; si no, una copia con formato de fecha. */
  paraFecha(s: string | undefined): string {
    const i = Number(s ?? 0);
    const xf = this.xfs[i] ?? "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>";
    if (this.formatosFecha.has(Number(attr(xf, "numFmtId") ?? 0))) return String(i);
    const k = String(i);
    if (!this.fechaDe.has(k)) {
      let copia = xf.replace(/numFmtId="\d+"/, `numFmtId="${this.idFormato}"`);
      if (!/numFmtId=/.test(copia)) copia = copia.replace("<xf", `<xf numFmtId="${this.idFormato}"`);
      copia = /applyNumberFormat=/.test(copia) ? copia.replace(/applyNumberFormat="\d"/, 'applyNumberFormat="1"') : copia.replace("<xf", '<xf applyNumberFormat="1"');
      this.extra.push(copia);
      this.fechaDe.set(k, String(this.xfs.length + this.extra.length - 1));
    }
    return this.fechaDe.get(k)!;
  }

  final(): string {
    if (!this.extra.length) return this.xml;
    const total = this.xfs.length + this.extra.length;
    return this.xml.replace(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/, (_m, dentro) => `<cellXfs count="${total}">${dentro}${this.extra.join("")}</cellXfs>`);
  }
}

function celdaXML(ref: string, s: string | undefined, v: unknown, estilos: Estilos): string {
  const sa = (x: string | undefined) => (x !== undefined ? ` s="${x}"` : "");
  if (v === null || v === undefined || v === "") return `<c r="${ref}"${sa(s)}/>`;
  if (typeof v === "boolean") return `<c r="${ref}"${sa(s)} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${sa(s)}><v>${v}</v></c>`;
  if (v instanceof Date && !isNaN(v.getTime())) return `<c r="${ref}"${sa(estilos.paraFecha(s))}><v>${serial(v)}</v></c>`;
  return `<c r="${ref}"${sa(s)} t="inlineStr"><is><t xml:space="preserve">${escapar(String(v))}</t></is></c>`;
}

/** Reescribe solo las celdas indicadas ("fila excel 1-based" -> "col 0-based" -> valor). */
function parchearHoja(xml: string, cambios: Map<number, Map<number, unknown>>, estilos: Estilos): string {
  if (!cambios.size) return xml;
  const ini = xml.indexOf("<sheetData");
  const finTag = xml.indexOf("</sheetData>");
  const vacia = finTag < 0;
  const abre = xml.indexOf(">", ini) + 1;
  const cuerpo = vacia ? "" : xml.slice(abre, finTag);
  const filas: { r: number; xml: string }[] = [...cuerpo.matchAll(/<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)].map((m) => ({ r: Number(attr(m[0], "r")), xml: m[0] }));
  const existentes = new Set(filas.map((f) => f.r));
  for (const r of cambios.keys()) if (!existentes.has(r)) filas.push({ r, xml: `<row r="${r}"/>` });
  filas.sort((a, b) => a.r - b.r);

  const nuevo = filas.map(({ r, xml: fx }) => {
    const cf = cambios.get(r);
    if (!cf) return fx;
    const cabecera = (fx.match(/^<row\b[^>]*?(?=\/?>)/)?.[0] ?? `<row r="${r}"`).replace(/\sspans="[^"]*"/, "");
    const celdas = new Map<number, string>();
    for (const m of fx.matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const ref = attr(m[0], "r");
      if (ref) celdas.set(XLSX.utils.decode_cell(ref).c, m[0]);
    }
    for (const [c, v] of cf) {
      const ref = XLSX.utils.encode_cell({ r: r - 1, c });
      const previa = celdas.get(c);
      celdas.set(c, celdaXML(ref, previa ? attr(previa, "s") : undefined, v, estilos));
    }
    return `${cabecera}>${[...celdas.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join("")}</row>`;
  }).join("");

  return vacia ? xml.replace(/<sheetData\s*\/>/, `<sheetData>${nuevo}</sheetData>`) : xml.slice(0, abre) + nuevo + xml.slice(finTag);
}

/** Listas desplegables y validación de fecha en las columnas con valores conocidos. */
function validaciones(filas: unknown[][], o: { r: number; c: number }): string {
  const bloques: { desde: number; cols: Map<number, string> }[] = [];
  filas.forEach((r, i) => {
    if (!(r ?? []).some((c) => claveColumna(c) === "CEDULA")) return;
    const cols = new Map<number, string>();
    const usados = new Set<string>();
    (r ?? []).forEach((h, c) => {
      const campo = MAPA_COLUMNAS[claveColumna(h)];
      if (campo && !usados.has(campo) && (LISTAS[campo] || FECHAS.has(campo))) { usados.add(campo); cols.set(c, campo); }
    });
    bloques.push({ desde: i + 1, cols });
  });
  const rangos = new Map<string, string[]>();
  bloques.forEach((b, k) => {
    const hasta = (bloques[k + 1]?.desde ?? filas.length + 1) - 2;
    if (hasta < b.desde) return;
    for (const [c, campo] of b.cols) {
      const a = XLSX.utils.encode_cell({ r: o.r + b.desde, c: o.c + c }), z = XLSX.utils.encode_cell({ r: o.r + hasta, c: o.c + c });
      rangos.set(campo, [...(rangos.get(campo) ?? []), `${a}:${z}`]);
    }
  });
  const dv: string[] = [];
  for (const [campo, refs] of rangos) {
    const sq = refs.join(" ");
    if (FECHAS.has(campo)) {
      dv.push(`<dataValidation type="date" operator="greaterThan" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" errorTitle="Fecha" error="Escriba una fecha, por ejemplo 7/03/1973." promptTitle="Fecha" prompt="Escriba o elija una fecha." sqref="${sq}"><formula1>1</formula1></dataValidation>`);
    } else {
      dv.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" errorTitle="Valor fuera de la lista" error="Puede dejarlo, pero lo normal es elegir de la lista." sqref="${sq}"><formula1>"${LISTAS[campo]!.join(",")}"</formula1></dataValidation>`);
    }
  }
  return dv.length ? `<dataValidations count="${dv.length}">${dv.join("")}</dataValidations>` : "";
}

const DESPUES_DE_VALIDACIONES = ["<hyperlinks", "<printOptions", "<pageMargins", "<pageSetup", "<headerFooter", "<rowBreaks", "<colBreaks", "<customProperties", "<cellWatches", "<ignoredErrors", "<smartTags", "<drawing", "<legacyDrawing", "<legacyDrawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"];

function insertarValidaciones(xml: string, dv: string): string {
  if (!dv || /<dataValidations\b/.test(xml)) return xml;
  for (const t of DESPUES_DE_VALIDACIONES) {
    const i = xml.indexOf(t);
    if (i >= 0) return xml.slice(0, i) + dv + xml.slice(i);
  }
  return xml;
}

/** Hoja nueva al final del libro (afiliados creados en la app). */
function agregarHoja(z: Zip, nombre: string, filas: unknown[][], estilos: Estilos) {
  const rutas = rutasHojas(z);
  let n = rutas.size + 1;
  while (z[`xl/worksheets/sheet${n}.xml`]) n++;
  const ruta = `xl/worksheets/sheet${n}.xml`;
  const cuerpo = filas.map((f, i) => `<row r="${i + 1}">${f.map((v, c) => celdaXML(XLSX.utils.encode_cell({ r: i, c }), undefined, v, estilos)).join("")}</row>`).join("");
  z[ruta] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${cuerpo}</sheetData></worksheet>`);
  const rels = leer(z, "xl/_rels/workbook.xml.rels");
  let id = 1;
  while (rels.includes(`Id="rIdApp${id}"`)) id++;
  z["xl/_rels/workbook.xml.rels"] = strToU8(rels.replace("</Relationships>", `<Relationship Id="rIdApp${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`));
  const wbx = leer(z, "xl/workbook.xml");
  const maxId = Math.max(0, ...[...wbx.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1])));
  z["xl/workbook.xml"] = strToU8(wbx.replace("</sheets>", `<sheet state="visible" name="${escapar(nombre)}" sheetId="${maxId + 1}" r:id="rIdApp${id}"/></sheets>`));
  const ct = leer(z, "[Content_Types].xml");
  z["[Content_Types].xml"] = strToU8(ct.replace("</Types>", `<Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" PartName="/${ruta}"/></Types>`));
}

/**
 * Arma el Excel con el formato original y los datos actuales. Devuelve null si no hay archivo original guardado.
 * originales: filas tal como se importaron; actuales: con las ediciones de la app.
 */
export async function excelConFormato(
  originales: Record<string, unknown[][]>,
  actuales: Record<string, unknown[][]>,
  nuevos: { nombre: string; filas: unknown[][] } | null,
): Promise<{ bytes: Uint8Array; celdas: number } | null> {
  const bytes = await leerArchivoOriginal();
  if (!bytes) return null;
  const z = unzipSync(bytes);
  const ori = origenes(bytes);
  const estilos = new Estilos(leer(z, "xl/styles.xml"));
  let total = 0;
  for (const [hoja, ruta] of rutasHojas(z)) {
    const a = originales[hoja], b = actuales[hoja];
    if (!a || !b) continue;
    const o = ori[hoja] ?? { r: 0, c: 0 };
    const cambios = new Map<number, Map<number, unknown>>();
    const filas = Math.max(a.length, b.length);
    for (let i = 0; i < filas; i++) {
      const fa = a[i] ?? [], fb = b[i] ?? [];
      const cols = Math.max(fa.length, fb.length);
      for (let c = 0; c < cols; c++) {
        if (igual(fa[c], fb[c])) continue;
        const r = o.r + i + 1;
        const m = cambios.get(r) ?? new Map<number, unknown>();
        m.set(o.c + c, fb[c] ?? null);
        cambios.set(r, m);
        total++;
      }
    }
    let xml = parchearHoja(leer(z, ruta), cambios, estilos);
    xml = insertarValidaciones(xml, validaciones(b, o));
    z[ruta] = strToU8(xml);
  }
  if (nuevos) agregarHoja(z, nuevos.nombre, nuevos.filas, estilos);
  z["xl/styles.xml"] = strToU8(estilos.final());
  return { bytes: zipSync(z, { level: 6 }), celdas: total };
}
