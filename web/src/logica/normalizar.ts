import { db, guardarMeta, leerMeta } from "../datos/db";
import type { Afiliado, CeldaEditada } from "../datos/tipos";
import { hojasConEdiciones } from "./hojas";
import { claveColumna, MAPA_COLUMNAS } from "./importarMaestro";
import { leerFecha } from "./fechas";
import { normalizar, texto } from "./texto";

/*
 * "Ordenar la escritura" de la base: solo cambios de forma, nunca de significado.
 * Se trabaja celda por celda, igual que una edición en la vista de Excel, para que el cambio
 * se vea en la app, salga en el Excel descargado y llegue a los demás equipos.
 * Lo que está en la columna equivocada o es ambiguo NO se toca (queda para la reunión).
 */

export type Regla = "espacios" | "mayusculas" | "sin_dato" | "digitacion" | "variantes" | "telefonos" | "correos" | "fechas" | "fechas_dudosas" | "no_es_fecha" | "numeros";

export const REGLAS: Record<Regla, { titulo: string; explicacion: string }> = {
  espacios: { titulo: "Espacios de más", explicacion: "Quita espacios al principio, al final y dobles." },
  mayusculas: { titulo: "Mayúsculas", explicacion: "Pasa a mayúscula los textos que estaban en minúscula, como el resto del Excel." },
  sin_dato: { titulo: "Una sola forma de decir que no hay dato", explicacion: "Guiones, \"sin información\", \"no tiene dato\" y similares quedan como SIN DATO; \"N.A.\" queda como NO APLICA." },
  digitacion: { titulo: "Errores de digitación evidentes", explicacion: "Palabras mal escritas que solo pueden ser una cosa (CARERRA, CAFISUR, MAQRIUITA)." },
  variantes: { titulo: "La misma palabra escrita distinto", explicacion: "Si solo cambian tildes, puntos o espacios, se usa la forma más común en la base (IBAGUE y IBAGUÉ quedan IBAGUÉ)." },
  telefonos: { titulo: "Celulares con espacios o guiones", explicacion: "Quedan solo los 10 dígitos, como los demás." },
  correos: { titulo: "Correos", explicacion: "Sin espacios al borde y en minúscula. Solo los que ya son correos válidos." },
  fechas: { titulo: "Fechas escritas como texto", explicacion: "\"7 de marzo de 1973\" escrito a mano pasa a ser una fecha real con ese mismo formato: se ve igual, pero se puede ordenar, filtrar y elegir en el calendario." },
  numeros: { titulo: "Cédulas y celulares guardados como texto", explicacion: "Quedan como número, igual que los demás de su columna." },
  fechas_dudosas: { titulo: "Fechas que no se pueden saber con certeza", explicacion: "#### ilegibles, solo el mes (\"SEPTIEMBRE\"), solo el año o números sueltos en una columna de fecha quedan como SIN DATO." },
  no_es_fecha: { titulo: "Otros datos dentro de una columna de fecha", explicacion: "Si el dato sirve en otra columna de la misma fila (correo, celular, sexo, cargo, provisional/carrera) y esa celda está vacía, se pasa allá; si no, se anota en Observaciones. Nunca se escribe encima de una celda con datos. Las casillas y los SI/NO sueltos, que no se sabe de qué columna son, quedan como SIN DATO." },
};

/** Reglas que borran información: vienen desmarcadas y se aplican solo si alguien las marca. */
export const REGLAS_OPCIONALES = new Set<Regla>([]);

/** Campo del afiliado, o "fecha:ENCABEZADO" para otras columnas de fecha del Excel (desvinculación, etc.). */
type Campo = keyof Afiliado | `fecha:${string}`;
const TEXTOS: Campo[] = ["nombre", "municipio", "cargo", "area", "directiva", "cargoDirectivo", "sindicatoRetirado", "vinculacion", "cajaCompensacion", "comuna", "quienAfilia", "institucion"];
const CON_VARIANTES = new Set<Campo>(TEXTOS.filter((c) => c !== "nombre"));
const CON_SIN_DATO = new Set<Campo>([...TEXTOS.filter((c) => c !== "nombre"), "otroCelular"]);
const TELEFONOS = new Set<Campo>(["celular", "otroCelular"]);
const FECHAS = new Set<Campo>(["fechaNacimiento", "fechaAfiliacion"]);
const esFecha = (c: Campo) => FECHAS.has(c) || c.startsWith("fecha:");

const DIGITACION: Partial<Record<Campo, Record<string, string>>> = {
  vinculacion: { CARERRA: "CARRERA", CARRRERA: "CARRERA" },
  cajaCompensacion: { CAFISUR: "CAFASUR", "COMFATOLIM A": "COMFATOLIMA" },
  directiva: { "SUBD. MAQRIUITA": "SUBD. MARIQUITA" },
  cargoDirectivo: { "SUBD. MAQRIUITA": "SUBD. MARIQUITA" },
};
const SIN_DATO = new Set(["SIN INFORMACION", "NO TIENE DATO", "SIN DATOS", "SIN DATO", "NO INFORMACION"]);
const NO_APLICA = new Set(["N.A.", "N.A", "N/A", "NA"]);

export interface Cambio {
  hoja: string;
  fila: number;
  col: number;
  campo: Campo;
  afiliadoId: number;
  antes: unknown;
  despues: unknown;
  reglas: Regla[];
}

const llaveVariante = (s: string) => normalizar(s).replace(/[.\s]/g, "");

const MESES = new Set(["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"]);
const SIN_DATO_TXT = "SIN DATO";

/**
 * Columnas de fecha: cada celda queda como fecha real o como SIN DATO.
 * - Fecha clara (7 de marzo de 1973, 07/03/1973 en el orden de Colombia día/mes, 1973-03-07) -> fecha real.
 * - Fecha imposible de saber (####, solo el mes, solo el año, números sueltos, "sin información") -> SIN DATO.
 * - Otro dato que quedó en la columna (correo, celular, casilla, ANTIGUA…) -> SIN DATO, pero en una regla aparte
 *   que viene desmarcada, porque borra información.
 */
function limpiarFecha(crudo: unknown): { valor: unknown; reglas: Regla[] } | null {
  if (crudo === null || crudo === undefined || crudo === "") return null;
  if (crudo instanceof Date) return null;
  const sinDato = (r: Regla) => ({ valor: SIN_DATO_TXT, reglas: [r] });
  if (typeof crudo === "boolean") return sinDato("no_es_fecha");
  if (typeof crudo === "number") return sinDato(crudo >= 1e6 ? "no_es_fecha" : "fechas_dudosas");
  if (typeof crudo !== "string") return null;
  const n = normalizar(crudo);
  if (n === SIN_DATO_TXT) return crudo === SIN_DATO_TXT ? null : { valor: SIN_DATO_TXT, reglas: ["espacios"] };
  const clara = /^\d{1,2} ?DE ?[A-Z]+ ?(DE |DEL )?\d{4}$/.test(n) || /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(n) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(n);
  const iso = clara ? leerFecha(crudo) : null;
  if (iso) return { valor: new Date(`${iso}T00:00:00`), reglas: ["fechas"] };
  if (SIN_DATO.has(n) || /^[-#.\s]+$/.test(n)) return sinDato(/^#+$/.test(n) ? "fechas_dudosas" : "sin_dato");
  const palabras = n.replace(/\b(DE|DEL)\b/g, " ").split(/\s+/).filter(Boolean);
  // Solo el mes, solo el año, mes y año, o una fecha con números que no cuadran: no se puede saber el día.
  if ((palabras.length && palabras.every((p) => MESES.has(p) || /^\d{1,4}$/.test(p))) || /^[\d\s/.-]+$/.test(n)) return sinDato("fechas_dudosas");
  return sinDato("no_es_fecha");
}

/** Pasos que solo dependen del valor (las variantes se resuelven después, mirando toda la base). */
function limpiar(campo: Campo, crudo: unknown): { valor: unknown; reglas: Regla[] } | null {
  const reglas: Regla[] = [];
  if (esFecha(campo)) return limpiarFecha(crudo);
  // Solo textos: números, fechas y casillas (True/False) no se tocan.
  if (typeof crudo !== "string") return null;
  let v = crudo;

  if (TELEFONOS.has(campo) && /^\s*3\d{2}[\s-]+\d{3}[\s-]?\d{4}\s*$/.test(v)) {
    return { valor: Number(v.replace(/\D/g, "")), reglas: ["telefonos"] };
  }
  if (TELEFONOS.has(campo) && /^\s*3\d{9}\s*$/.test(v)) return { valor: Number(v.trim()), reglas: ["numeros"] };
  if (campo === "cedula" && /^\s*\d{5,11}\s*$/.test(v)) return { valor: Number(v.trim()), reglas: ["numeros"] };
  if (campo === "correo") {
    const t = v.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return null;
    const n = t.toLowerCase();
    return n !== v ? { valor: n, reglas: ["correos"] } : null;
  }
  if (!TEXTOS.includes(campo) && !CON_SIN_DATO.has(campo)) return null;

  const sinEspacios = v.replace(/\s+/g, " ").trim();
  if (sinEspacios !== v) { v = sinEspacios; reglas.push("espacios"); }
  if (!v) return reglas.length ? { valor: v, reglas } : null;

  if (CON_SIN_DATO.has(campo)) {
    const n = normalizar(v);
    if ((SIN_DATO.has(n) || (/^[-#.\s]+$/.test(n) && n.length >= 2)) && v !== "SIN DATO") return { valor: "SIN DATO", reglas: [...reglas, "sin_dato"] };
    if (NO_APLICA.has(n) || n === "NO APLICA") {
      return v !== "NO APLICA" ? { valor: "NO APLICA", reglas: [...reglas, n === "NO APLICA" ? "espacios" : "sin_dato"] } : reglas.length ? { valor: v, reglas } : null;
    }
  }
  if (TEXTOS.includes(campo) && /[a-záéíóúñ]/.test(v) && !v.includes("@")) {
    v = v.toUpperCase();
    reglas.push("mayusculas");
  }
  const typo = DIGITACION[campo]?.[v];
  if (typo) { v = typo; reglas.push("digitacion"); }
  return reglas.length ? { valor: v, reglas: [...new Set(reglas)] } : null;
}

/** Revisa toda la base y devuelve los cambios propuestos (no guarda nada). */
export async function proponerNormalizacion(): Promise<Cambio[]> {
  const { hojas, afiliados } = await hojasConEdiciones();
  const porFila = new Map<string, number>();
  for (const a of afiliados) for (const o of a.origen) porFila.set(`${o.hoja}#${o.fila}`, a.id!);

  const celdas: { hoja: string; fila: number; col: number; campo: Campo; afiliadoId: number; crudo: unknown }[] = [];
  for (const [hoja, filas] of Object.entries(hojas)) {
    let columnas: Map<number, Campo> | null = null;
    filas.forEach((fila, i) => {
      const r = fila ?? [];
      if (r.some((c) => claveColumna(c) === "CEDULA")) {
        // Igual que al importar: la primera columna de cada campo es la que manda.
        columnas = new Map();
        const usados = new Set<Campo>();
        r.forEach((h, col) => {
          const clave = claveColumna(h);
          const campo = (MAPA_COLUMNAS[clave] as Campo | undefined) ?? (clave.includes("FECHA") ? (`fecha:${clave}` as Campo) : undefined);
          if (campo && !usados.has(campo)) { usados.add(campo); columnas!.set(col, campo); }
        });
        return;
      }
      const afiliadoId = porFila.get(`${hoja}#${i}`);
      if (!columnas || afiliadoId === undefined) return;
      for (const [col, campo] of columnas as Map<number, Campo>) celdas.push({ hoja, fila: i, col, campo, afiliadoId, crudo: r[col] });
    });
  }

  // Primero lo que depende de cada valor.
  const pasos = celdas.map((c) => {
    const l = limpiar(c.campo, c.crudo);
    return { ...c, valor: l ? l.valor : c.crudo, reglas: l ? l.reglas : [] as Regla[] };
  });

  // Luego las variantes: la forma más común de cada campo gana.
  const conteos = new Map<string, Map<string, number>>();
  for (const p of pasos) {
    if (!CON_VARIANTES.has(p.campo) || typeof p.valor !== "string" || !p.valor) continue;
    const k = `${p.campo}|${llaveVariante(p.valor)}`;
    const m = conteos.get(k) ?? new Map<string, number>();
    m.set(p.valor, (m.get(p.valor) ?? 0) + 1);
    conteos.set(k, m);
  }
  const canonica = new Map<string, string>();
  for (const [k, m] of conteos) {
    // Más frecuente; en empate, la que tiene tildes y luego la más larga.
    const [mejor] = [...m.entries()].sort((x, y) => y[1] - x[1] || (y[0].normalize("NFD").length - y[0].length) - (x[0].normalize("NFD").length - x[0].length) || y[0].length - x[0].length);
    canonica.set(k, mejor[0]);
  }
  for (const p of pasos) {
    if (!CON_VARIANTES.has(p.campo) || typeof p.valor !== "string" || !p.valor) continue;
    const c = canonica.get(`${p.campo}|${llaveVariante(p.valor)}`);
    if (c && c !== p.valor) { p.valor = c; p.reglas = [...p.reglas, "variantes"]; }
  }

  reubicarDatos(pasos);

  return pasos
    .filter((p) => p.reglas.length && p.valor !== p.crudo)
    .map((p) => ({ hoja: p.hoja, fila: p.fila, col: p.col, campo: p.campo, afiliadoId: p.afiliadoId, antes: p.crudo, despues: p.valor, reglas: p.reglas }));
}

/** Regla principal de un cambio, para agruparlo en la vista previa. */
export const reglaPrincipal = (c: Cambio): Regla =>
  (["no_es_fecha", "fechas_dudosas", "fechas", "digitacion", "sin_dato", "variantes", "telefonos", "numeros", "correos", "mayusculas", "espacios"] as Regla[]).find((r) => c.reglas.includes(r))!;

interface Registro {
  fecha: string;
  cambios: { hoja: string; fila: number; col: number; campo: Campo; afiliadoId: number; antes: unknown; celdaPrevia: CeldaEditada | null; campoPrevio: unknown; originalPrevio?: unknown }[];
}
const META = "normalizacion";

/** Guarda los cambios elegidos y deja registro para poder deshacerlos. */
export async function aplicarNormalizacion(cambios: Cambio[]): Promise<number> {
  // Se acumula con el registro anterior: "Deshacer" devuelve todo, aunque se haya ordenado varias veces.
  const previo = await leerMeta<Registro>(META);
  const registro: Registro = { fecha: new Date().toISOString(), cambios: [...(previo?.cambios ?? [])] };
  await db.transaction("rw", [db.celdas, db.afiliados, db.meta], async () => {
    const porAfiliado = new Map<number, Partial<Afiliado> & { editados?: string[] }>();
    for (const c of cambios) {
      const previa = (await db.celdas.get([c.hoja, c.fila, c.col] as never)) ?? null;
      const a = await db.afiliados.get(c.afiliadoId);
      const original = c.campo === "fechaNacimiento" || c.campo === "fechaAfiliacion" ? (`${c.campo}Original` as const) : null;
      registro.cambios.push({
        hoja: c.hoja, fila: c.fila, col: c.col, campo: c.campo, afiliadoId: c.afiliadoId, antes: c.antes, celdaPrevia: previa,
        campoPrevio: c.campo.startsWith("fecha:") ? undefined : a?.[c.campo as keyof Afiliado],
        originalPrevio: original && a ? a[original] : undefined,
      });
      await db.celdas.put({ hoja: c.hoja, fila: c.fila, col: c.col, valor: c.despues, editadoEn: registro.fecha });
      // El dato de la app se cambia solo si venía de esta celda.
      if (a && !esFecha(c.campo) && texto(c.antes) === texto(a[c.campo as keyof Afiliado])) {
        const p = porAfiliado.get(c.afiliadoId) ?? {};
        (p as Record<string, unknown>)[c.campo] = texto(c.despues);
        porAfiliado.set(c.afiliadoId, p);
      }
      // Fecha sin dato: el texto que mostraba la ficha también queda como SIN DATO.
      if (a && original && c.despues === SIN_DATO_TXT && texto(c.antes) === texto(a[original])) {
        const p = porAfiliado.get(c.afiliadoId) ?? {};
        (p as Record<string, unknown>)[original] = SIN_DATO_TXT;
        porAfiliado.set(c.afiliadoId, p);
      }
    }
    for (const [id, p] of porAfiliado) await db.afiliados.update(id, { ...p, actualizadoEn: registro.fecha });
    await guardarMeta(META, registro);
  });
  return cambios.length;
}

export const leerUltimaNormalizacion = () => leerMeta<Registro>(META);

/** Devuelve las celdas y los datos a como estaban antes de la última normalización. */
export async function deshacerNormalizacion(): Promise<number> {
  const r = await leerUltimaNormalizacion();
  if (!r) return 0;
  await db.transaction("rw", [db.celdas, db.afiliados, db.meta], async () => {
    // En orden inverso: si una celda se ordenó dos veces, queda como estaba antes de la primera.
    for (const c of [...r.cambios].reverse()) {
      if (c.celdaPrevia) await db.celdas.put(c.celdaPrevia);
      else await db.celdas.delete([c.hoja, c.fila, c.col] as never);
      const a = await db.afiliados.get(c.afiliadoId);
      if (!a) continue;
      const cambios: Record<string, unknown> = {};
      if (c.campoPrevio !== undefined && !esFecha(c.campo)) cambios[c.campo] = c.campoPrevio;
      if (c.originalPrevio !== undefined) cambios[`${c.campo}Original`] = c.originalPrevio;
      if (Object.keys(cambios).length) await db.afiliados.update(c.afiliadoId, { ...cambios, actualizadoEn: new Date().toISOString() } as Partial<Afiliado>);
    }
    await db.meta.delete(META);
  });
  return r.cambios.length;
}

/* ───────────────────────── datos de otra columna que quedaron en una fecha ───────────────────────── */

type Paso = { hoja: string; fila: number; col: number; campo: Campo; afiliadoId: number; crudo: unknown; valor: unknown; reglas: Regla[] };

const vacioCelda = (v: unknown) => v === null || v === undefined || (typeof v === "string" && (SIN_DATO.has(normalizar(v)) || /^[-#.\s]*$/.test(v) || NO_APLICA.has(normalizar(v))));
const CARGOS = /DOCENTE|AUX|CELADOR|ADMINISTRATIV|COORDINADOR|RECTOR|SERVICIOS GENERALES|TECNICO|PROFESIONAL|CONDUCTOR|ORIENTADOR/;

/**
 * Para cada celda de fecha con un dato de otra columna: si ese dato tiene una columna propia en la misma fila
 * y esa celda está vacía, se pasa allá; si la columna ya tiene algo distinto, el dato se anota en Observaciones.
 * Lo que no se sabe de dónde es (casillas, SI/NO sueltos) queda como SIN DATO. Nunca se escribe sobre datos.
 */
function reubicarDatos(pasos: Paso[]) {
  const porFila = new Map<string, Map<Campo, Paso>>();
  for (const p of pasos) {
    const k = `${p.hoja}#${p.fila}`;
    const m = porFila.get(k) ?? new Map<Campo, Paso>();
    if (!m.has(p.campo)) m.set(p.campo, p);
    porFila.set(k, m);
  }
  for (const p of pasos) {
    if (!p.reglas.includes("no_es_fecha")) continue;
    const fila = porFila.get(`${p.hoja}#${p.fila}`)!;
    const v = p.crudo;
    const s = typeof v === "number" ? String(Math.trunc(v)) : String(v ?? "").trim();
    const n = normalizar(s);
    let destino: Campo | null = null;
    let valor: unknown = s;
    let iguales = (actual: unknown) => normalizar(actual) === n;
    if (typeof v === "boolean" || n === "SI" || n === "NO") continue; // no se sabe de qué columna es: queda SIN DATO
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) { destino = "correo"; valor = s.toLowerCase(); iguales = (a) => normalizar(a).toLowerCase() === s.toLowerCase().toUpperCase().toLowerCase(); }
    else if (/^3\d{9}$/.test(s.replace(/\D/g, "").slice(0, 10)) && /^[\d\s.-]+$/.test(s)) {
      const d = s.replace(/\D/g, "").slice(0, 10);
      destino = "celular"; valor = Number(d); iguales = (a) => String(a ?? "").replace(/\D/g, "").slice(0, 10) === d;
    } else if (["F", "M", "FEMENINO", "MASCULINO"].includes(n)) { destino = "sexo"; valor = n[0]; iguales = (a) => normalizar(a).slice(0, 1) === n[0] && normalizar(a).length <= 9; }
    else if (n === "CARRERA" || n === "PROVISIONAL") { destino = "vinculacion"; valor = n; }
    else if (CARGOS.test(n)) { destino = "cargo"; valor = s.toUpperCase(); }

    const destinoPaso = destino ? fila.get(destino) : undefined;
    if (destinoPaso) {
      if (iguales(destinoPaso.valor)) continue; // ya está guardado en su columna: la fecha queda SIN DATO
      if (vacioCelda(destinoPaso.valor)) {
        destinoPaso.valor = valor;
        destinoPaso.reglas = [...new Set([...destinoPaso.reglas, "no_es_fecha" as Regla])];
        continue;
      }
    }
    // Sin columna propia, o la columna ya tiene otro dato: se anota en Observaciones para no perderlo.
    if (destino === "sexo") continue; // una F o M suelta no aporta en Observaciones
    const obs = fila.get("observaciones");
    if (!obs) continue;
    const encabezado = p.campo.startsWith("fecha:") ? p.campo.slice(6) : p.campo === "fechaNacimiento" ? "FECHA DE NACIMIENTO" : "FECHA DE AFILIACION";
    const nota = `Dato que estaba en ${encabezado}: ${s}`;
    // Si en Observaciones había una fecha o un número (dato corrido), se conserva legible: 31/01/2023.
    const actual = typeof obs.valor === "string" ? obs.valor.trim()
      : obs.valor instanceof Date ? (() => { const f = new Date(obs.valor.getTime() + 12 * 3600 * 1000); return `${f.getDate()}/${String(f.getMonth() + 1).padStart(2, "0")}/${f.getFullYear()}`; })()
      : obs.valor === null || obs.valor === undefined ? "" : typeof obs.valor === "boolean" ? (obs.valor ? "Sí" : "") : String(obs.valor);
    if (actual.includes(nota)) continue;
    obs.valor = actual && !vacioCelda(actual) ? `${actual} | ${nota}` : nota;
    obs.reglas = [...new Set([...obs.reglas, "no_es_fecha" as Regla])];
  }
}
