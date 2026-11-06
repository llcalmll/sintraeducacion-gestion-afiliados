import { db, guardarMeta, leerMeta } from "../datos/db";
import type { Afiliado } from "../datos/tipos";
import { borrarRegistroCivil } from "./archivos";

/** Filas del Excel original de afiliados eliminados: al exportar con el formato original salen vacías. */
export const FILAS_ELIMINADAS = "filasEliminadas";
export type FilaEliminada = { hoja: string; fila: number };

/**
 * Elimina afiliados por completo (errores de digitación, pruebas, duplicados). No es un retiro: no pasa a Retirados.
 * Se van también su cédula adjunta, sus hijos (con su registro civil) y sus invitaciones a eventos. Los cruces de descuentos ya guardados
 * no se tocan: son el registro de lo que llegó en cada reporte.
 */
export async function eliminarAfiliados(lista: Afiliado[]): Promise<{ hijos: number }> {
  const ids = lista.map((a) => a.id!);
  const quitar = new Set(ids);
  const hijos = await db.hijos.where("afiliadoId").anyOf(ids).toArray();
  await db.transaction("rw", [db.afiliados, db.hijos, db.eventos, db.meta], async () => {
    await db.hijos.bulkDelete(hijos.map((h) => h.id!));
    await db.afiliados.bulkDelete(ids);
    await db.eventos
      .filter((e) => e.invitados.some((x) => quitar.has(x)) || e.asistentes.some((x) => quitar.has(x)))
      .modify((e) => {
        e.invitados = e.invitados.filter((x) => !quitar.has(x));
        e.asistentes = e.asistentes.filter((x) => !quitar.has(x));
      });
    const filas = lista.flatMap((a) => a.origen);
    if (filas.length) await guardarMeta(FILAS_ELIMINADAS, [...((await leerMeta<FilaEliminada[]>(FILAS_ELIMINADAS)) ?? []), ...filas]);
  });
  // Los archivos se borran después; si falla (sin red), quedan sin dueño pero nadie los puede abrir desde la app.
  for (const h of hijos) if (h.registroCivilArchivo) borrarRegistroCivil(h.registroCivilArchivo.clave).catch(() => {});
  for (const a of lista) if (a.cedulaArchivo) borrarRegistroCivil(a.cedulaArchivo.clave).catch(() => {});
  return { hijos: hijos.length };
}
