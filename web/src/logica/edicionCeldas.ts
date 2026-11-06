import { db } from "../datos/db";
import type { Afiliado } from "../datos/tipos";
import { leerFecha, leerNovedad } from "./fechas";
import { claveColumna, MAPA_COLUMNAS } from "./importarMaestro";
import { limpiarCedula, texto } from "./texto";

export interface EdicionCelda {
  hoja: string;
  /** Fila en el Excel original (desde 0). null si la fila es de un afiliado creado en la app. */
  fila: number | null;
  col: number;
  encabezado: unknown;
  afiliadoId: number | null;
  /** Valor que tenía la celda antes, para respetar su tipo y poder deshacer. */
  anterior: unknown;
}

/**
 * Convierte lo que se escribió al tipo que tenía la celda: número si era número,
 * fecha si era fecha o la columna es de fechas, sí/no si era casilla.
 */
export function interpretar(escrito: unknown, anterior: unknown, encabezado: unknown): unknown {
  if (typeof escrito !== "string") return escrito;
  const t = escrito.trim();
  if (t === "") return null;
  if (typeof anterior === "boolean") return /^(s[ií]|x|true|1|verdadero)$/i.test(t);
  const campo = MAPA_COLUMNAS[claveColumna(encabezado)];
  if (anterior instanceof Date || campo === "fechaNacimiento" || campo === "fechaAfiliacion") {
    const iso = leerFecha(t);
    // Medianoche local, igual que las fechas que trae el Excel (así se muestran y exportan con el mismo día).
    return iso ? new Date(`${iso}T00:00:00`) : t;
  }
  if (typeof anterior === "number" && /^-?\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  if (campo === "cedula" && /^\d+$/.test(t)) return Number(t);
  return t;
}

/** Guarda la celda y, si la columna es un dato conocido del afiliado, actualiza también su ficha. */
export async function editarCelda(e: EdicionCelda, escrito: unknown): Promise<unknown> {
  const valor = interpretar(escrito, e.anterior, e.encabezado);
  await db.transaction("rw", db.celdas, db.afiliados, async () => {
    if (e.fila !== null) await db.celdas.put({ hoja: e.hoja, fila: e.fila, col: e.col, valor, editadoEn: new Date().toISOString() });
    if (e.afiliadoId === null) return;
    const a = await db.afiliados.get(e.afiliadoId);
    if (!a) return;
    const campo = MAPA_COLUMNAS[claveColumna(e.encabezado)];
    const cambios: Partial<Afiliado> = { actualizadoEn: new Date().toISOString() };
    if (campo === "cedula") cambios.cedula = limpiarCedula(valor);
    else if (campo === "fechaNacimiento") Object.assign(cambios, { fechaNacimiento: leerFecha(valor), fechaNacimientoOriginal: texto(valor) });
    else if (campo === "fechaAfiliacion") Object.assign(cambios, { fechaAfiliacion: leerFecha(valor), fechaAfiliacionOriginal: texto(valor) });
    else if (campo) {
      (cambios as Record<string, unknown>)[campo] = texto(valor);
      if (campo === "observaciones") cambios.novedadPeriodo = leerNovedad(texto(valor));
    } else if (e.fila === null) {
      // Afiliado creado en la app: las columnas sin campo propio se guardan en "extra".
      cambios.extra = { ...a.extra, [encabezadoTexto(e.encabezado)]: texto(valor) };
    }
    // Las filas del Excel ya guardan la celda; "editados" hace que el cambio también aparezca
    // en la otra hoja si la misma cédula está en dos.
    if (campo) cambios.editados = [...new Set([...(a.editados ?? []), campo])];
    await db.afiliados.update(e.afiliadoId, cambios);
  });
  return valor;
}

const encabezadoTexto = (h: unknown) => (h instanceof Date ? `Columna ${texto(h)}` : texto(h));
