import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { idUnico } from "./sincronizacion";

/*
 * Noticas: notas rápidas y tareas del día de la oficina (se ven en la barra de arriba, en cualquier pantalla, y las
 * comparten todas las cuentas).
 *
 * Se guardan en la tabla `meta`, con la clave "notica:<id>", y no en una tabla propia: `meta` ya se sincroniza y no pide
 * cambiar la estructura de la base del navegador. Una tabla nueva dejaría sin sincronizar a los equipos que tienen la app
 * abierta con la versión anterior, porque esta app no les avisa que hay una versión nueva.
 */

export const COLORES_NOTA = ["amarillo", "rosa", "verde", "azul", "lila"] as const;
export type ColorNota = (typeof COLORES_NOTA)[number];

export interface Nota {
  id: string;
  texto: string;
  color: ColorNota;
  fijada: boolean;
  destacada: boolean;
  hecha: boolean;
  hechaEn: string | null;
  creado: string;
}

const PREFIJO = "notica:";
const DIAS_HECHAS = 7;
export const MAX_TEXTO = 1000;

export function useNotas(): Nota[] {
  return useLiveQuery(async () => (await db.meta.where("clave").startsWith(PREFIJO).toArray()).map((m) => m.valor as Nota), []) ?? [];
}

export async function crearNota(d: Pick<Nota, "texto" | "color" | "fijada" | "destacada">) {
  const id = String(idUnico());
  const nota: Nota = { ...d, id, hecha: false, hechaEn: null, creado: new Date().toISOString() };
  await db.meta.put({ clave: PREFIJO + id, valor: nota });
}

export async function cambiarNota(id: string, c: Partial<Pick<Nota, "texto" | "color" | "fijada" | "destacada" | "hecha">>) {
  await db.transaction("rw", db.meta, async () => {
    const actual = (await db.meta.get(PREFIJO + id))?.valor as Nota | undefined;
    if (!actual) throw new Error("La notica ya no existe.");
    const nueva: Nota = { ...actual, ...c };
    if ("hecha" in c) nueva.hechaEn = c.hecha ? new Date().toISOString() : null;
    await db.meta.put({ clave: PREFIJO + id, valor: nueva });
  });
}

export const borrarNota = (id: string) => db.meta.delete(PREFIJO + id);

/** Las hechas hace más de 7 días se borran solas (lo hace el primer equipo que las vea, para todos). */
export async function limpiarHechas(notas: Nota[]) {
  const limite = new Date(Date.now() - DIAS_HECHAS * 86_400_000).toISOString();
  const viejas = notas.filter((n) => n.hecha && n.hechaEn && n.hechaEn < limite);
  if (viejas.length) await db.meta.bulkDelete(viejas.map((n) => PREFIJO + n.id));
}
