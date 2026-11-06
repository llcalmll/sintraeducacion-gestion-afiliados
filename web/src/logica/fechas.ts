import { normalizar } from "./texto";

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const MES_NUM: Record<string, number> = {};
MESES.forEach((m, i) => (MES_NUM[normalizar(m)] = i + 1));
MES_NUM["SETIEMBRE"] = 9;
MES_NUM["MARZ"] = 3;

const iso = (a: number, m: number, d: number) =>
  `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function valida(a: number, m: number, d: number): boolean {
  if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCMonth() === m - 1;
}

/**
 * Interpreta las fechas tal como vienen en la base: Date, "12 de agosto de 1979",
 * "11 JULIO DE1972", "2023-12-27", "8/09/2026". Devuelve AAAA-MM-DD o null si no se puede.
 */
export function leerFecha(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // SheetJS entrega fechas a medianoche local; se suma medio día para evitar saltos de zona.
    const f = new Date(v.getTime() + 12 * 3600 * 1000);
    return iso(f.getFullYear(), f.getMonth() + 1, f.getDate());
  }
  const s = normalizar(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m && valida(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m && valida(+m[3], +m[2], +m[1])) return iso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})\s*DE\s*([A-Z]+)\s*(?:DE|DEL)?\s*(\d{4})$/);
  if (m && MES_NUM[m[2]] && valida(+m[3], MES_NUM[m[2]], +m[1])) return iso(+m[3], MES_NUM[m[2]], +m[1]);
  m = s.match(/^(\d{1,2})\s+([A-Z]+)\s*(?:DE)?\s*(\d{4})$/);
  if (m && MES_NUM[m[2]] && valida(+m[3], MES_NUM[m[2]], +m[1])) return iso(+m[3], MES_NUM[m[2]], +m[1]);
  return null;
}

/** "NOVEDAD: AFILIAR EN MARZO 2026" -> "2026-03" */
export function leerNovedad(obs: string): string | null {
  const m = normalizar(obs).match(/AFILIAR EN ([A-Z]+)\s*(?:DE\s*)?(\d{4})/);
  if (!m || !MES_NUM[m[1]]) return null;
  return `${m[2]}-${String(MES_NUM[m[1]]).padStart(2, "0")}`;
}

export function hoyISO(): string {
  const h = new Date();
  return iso(h.getFullYear(), h.getMonth() + 1, h.getDate());
}

export function edad(fecha: string | null, ref = hoyISO()): number | null {
  if (!fecha) return null;
  const [a, m, d] = fecha.split("-").map(Number);
  const [ra, rm, rd] = ref.split("-").map(Number);
  let e = ra - a;
  if (rm < m || (rm === m && rd < d)) e--;
  return e;
}

/** Días que faltan para el próximo cumpleaños (0 = hoy). */
export function diasParaCumple(fecha: string | null, ref = hoyISO()): number | null {
  if (!fecha) return null;
  const [, m, d] = fecha.split("-").map(Number);
  const [ra, rm, rd] = ref.split("-").map(Number);
  const hoy = Date.UTC(ra, rm - 1, rd);
  let prox = Date.UTC(ra, m - 1, d);
  if (prox < hoy) prox = Date.UTC(ra + 1, m - 1, d);
  return Math.round((prox - hoy) / 86400000);
}

export function fechaLarga(f: string | null): string {
  if (!f) return "";
  const [a, m, d] = f.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

export function diaMes(f: string | null): string {
  if (!f) return "";
  const [, m, d] = f.split("-").map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

export function nombrePeriodo(p: string): string {
  const [a, m] = p.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
}

export function periodoAnterior(p: string, n = 1): string {
  const [a, m] = p.split("-").map(Number);
  const t = a * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function periodoActual(): string {
  return hoyISO().slice(0, 7);
}

/**
 * Edad de un hijo: exacta con la fecha de nacimiento; si solo hay la edad que reportaron en el formulario, esa edad más
 * los años cumplidos desde la respuesta (aproximada: no se inventa una fecha de nacimiento).
 */
export function edadHijo(h: { fechaNacimiento: string | null; edadReportada?: number; edadReportadaEn?: string }, ref = hoyISO()): { anos: number | null; aprox: boolean } {
  if (h.fechaNacimiento) return { anos: edad(h.fechaNacimiento, ref), aprox: false };
  if (h.edadReportada === undefined || h.edadReportada === null) return { anos: null, aprox: false };
  const desde = h.edadReportadaEn ? edad(h.edadReportadaEn, ref) ?? 0 : 0;
  return { anos: h.edadReportada + Math.max(0, desde), aprox: true };
}

export const textoEdadHijo = (e: { anos: number | null; aprox: boolean }) =>
  e.anos === null ? "" : `${e.aprox ? "≈ " : ""}${e.anos} ${e.anos === 1 ? "año" : "años"}`;

export const generoHijo = (s?: string) => (s === "F" ? "Niña" : s === "M" ? "Niño" : "");
