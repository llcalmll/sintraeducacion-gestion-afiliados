/** Mayúsculas, sin tildes y con espacios colapsados. Solo para comparar, nunca para guardar. */
export function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  return String(v).trim();
}

/** Solo dígitos. 12345678.0 -> "12345678". */
export function limpiarCedula(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  let s = typeof v === "number" ? String(Math.trunc(v)) : String(v).trim();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  s = s.replace(/\D/g, "");
  return s.length >= 5 ? s : null;
}

const MARCADORES_VACIO = new Set([
  "",
  "SIN INFORMACION",
  "NO TIENE DATO",
  "SIN DATOS",
  "SIN DATO",
  "NO INFORMACION",
  "N.A.",
  "N/A",
  "NA",
]);

/** El Excel usa varias formas de decir "no hay dato". */
export function esVacio(v: unknown): boolean {
  const n = normalizar(v);
  return MARCADORES_VACIO.has(n) || /^[-#.\s]+$/.test(n);
}

export function tituloCaso(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Y)\b/g, (m) => m.toLowerCase());
}

export function pesos(n: number): string {
  return "$ " + Math.round(n).toLocaleString("es-CO");
}

export function contiene(haystack: string, needle: string): boolean {
  return normalizar(haystack).includes(normalizar(needle));
}
