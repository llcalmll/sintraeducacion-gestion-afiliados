import { useLiveQuery } from "dexie-react-hooks";
import { db, vigilar } from "./db";
import type { Afiliado, CruceDetalle, Hijo } from "./tipos";

export function useAfiliados(): Afiliado[] | undefined {
  return useLiveQuery(() => db.afiliados.toArray(), []);
}

export function useHijosPorAfiliado(): Map<number, Hijo[]> | undefined {
  return useLiveQuery(async () => {
    const m = new Map<number, Hijo[]>();
    for (const h of await db.hijos.toArray()) m.set(h.afiliadoId, [...(m.get(h.afiliadoId) ?? []), h]);
    return m;
  }, []);
}

/** Resultado de cada afiliado en el cruce más reciente. */
export function useUltimoCruce() {
  return useLiveQuery(async () => {
    const c = await db.cruces.orderBy("periodo").last();
    const porAfiliado = new Map<number, CruceDetalle>();
    if (c) {
      for (const d of await db.cruceDetalle.where("cruceId").equals(c.id!).toArray()) {
        if (d.afiliadoId && d.resultado !== "extraordinaria") porAfiliado.set(d.afiliadoId, d);
      }
    }
    return { cruce: c ?? null, porAfiliado };
  }, []);
}

/** Personas sin descuento en el mes más reciente que nadie ha contactado (semáforo en rojo). */
export function usePorContactar(): number | undefined {
  return useLiveQuery(async () => {
    await vigilar(db.cruces, db.cruceDetalle, db.contactos);
    const c = await db.cruces.orderBy("periodo").last();
    if (!c) return 0;
    const sin = await db.cruceDetalle.where("cruceId").equals(c.id!).filter((d) => d.resultado === "sin_descuento").toArray();
    const atendidos = new Set((await db.contactos.where("periodo").equals(c.periodo).toArray()).filter((x) => x.estado !== "pendiente").map((x) => x.cedula));
    return sin.filter((d) => !atendidos.has(d.cedula)).length;
  }, []);
}

export const vigente = (a: Afiliado) => a.estado === "activo" || a.estado === "pendiente_novedad";
