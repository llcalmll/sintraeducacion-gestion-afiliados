import type { Opcion } from "../componentes/filtros";
import type { Afiliado } from "../datos/tipos";
import { esVacio, normalizar } from "./texto";

/*
 * Cómo se agrupan los afiliados por campo. Lo usan los filtros de la lista y las estadísticas del Resumen general,
 * para que un porcentaje y el filtro que abre siempre cuenten a las mismas personas.
 */

/** Valor de texto normalizado para agrupar; vacío, "SIN DATO" o "NO APLICA" cuentan como sin dato. */
export const SIN = "sin";
export const grupo = (v: string) => {
  const x = (v ?? "").trim().toUpperCase();
  return !x || x === "SIN DATO" || x === "NO APLICA" ? SIN : x;
};
export const SEXOS: Opcion[] = [{ v: "F", t: "Femenino" }, { v: "M", t: "Masculino" }, { v: SIN, t: "Sin dato" }];
export const sexoDe = (a: Afiliado) => { const s = grupo(a.sexo); return s === "F" || s === "M" ? s : SIN; };
export const VINCULACIONES: Opcion[] = [{ v: "PROVISIONAL", t: "Provisional" }, { v: "CARRERA", t: "Carrera" }, { v: SIN, t: "Sin dato" }];
export const vinculacionDe = (a: Afiliado) => { const v = grupo(a.vinculacion); return v === "PROVISIONAL" || v === "CARRERA" ? v : SIN; };
export const CON_SIN: Opcion[] = [{ v: "con", t: "Con dato" }, { v: SIN, t: "Sin dato" }];
export const conDato = (v: string) => (esVacio(v) ? SIN : "con");
export const EDADES: Record<string, { t: string; fn: (e: number | null) => boolean }> = {
  "-30": { t: "Menos de 30", fn: (e) => e !== null && e < 30 },
  "30-39": { t: "30 a 39", fn: (e) => e !== null && e >= 30 && e <= 39 },
  "40-49": { t: "40 a 49", fn: (e) => e !== null && e >= 40 && e <= 49 },
  "50-59": { t: "50 a 59", fn: (e) => e !== null && e >= 50 && e <= 59 },
  "60+": { t: "60 o más", fn: (e) => e !== null && e >= 60 },
  [SIN]: { t: "Sin fecha de nacimiento", fn: (e) => e === null },
};
/** Fecha dentro del rango; sin fecha nunca entra cuando hay rango. */
export const enRango = (f: string | null, desde: string, hasta: string) => (!desde && !hasta) || (!!f && (!desde || f >= desde) && (!hasta || f <= hasta));

/** Municipio para agrupar: sin tildes ni espacios de más ("IBAGUÉ" e "IBAGUE" son el mismo). El dato guardado no cambia. */
export const municipioDe = (a: Afiliado) => normalizar(a.municipio) || SIN;

/** Cómo se muestra cada municipio agrupado: la forma más escrita (normalmente con tilde). */
export function nombresMunicipio(lista: Afiliado[]): Map<string, string> {
  const formas = new Map<string, Map<string, number>>();
  for (const a of lista) {
    const k = municipioDe(a);
    const f = a.municipio.trim().toUpperCase();
    const m = formas.get(k) ?? new Map<string, number>();
    m.set(f, (m.get(f) ?? 0) + 1);
    formas.set(k, m);
  }
  return new Map([...formas].map(([k, m]) => [k, [...m].sort((x, y) => y[1] - x[1])[0][0]]));
}

/** Nombre corto de la entidad que descuenta, en mayúsculas (como en las insignias). */
export const entidadCorta = (p: string) => p.replace("Secretaría de Educación de ", "SEM ").replace("Secretaría de Educación del ", "SED ").toLocaleUpperCase("es-CO");
