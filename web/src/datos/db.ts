import Dexie, { type EntityTable, type Table } from "dexie";
import type { Afiliado, CeldaEditada, Contacto, Cruce, CruceDetalle, Evento, Hijo, Meta, ReporteGuardado } from "./tipos";

// Demo: todo vive en IndexedDB del navegador. En producción esta capa
// se sincroniza con la API (Worker + D1) según el brief.
export const db = new Dexie("sintraeducacion") as Dexie & {
  afiliados: EntityTable<Afiliado, "id">;
  hijos: EntityTable<Hijo, "id">;
  cruces: EntityTable<Cruce, "id">;
  cruceDetalle: EntityTable<CruceDetalle, "id">;
  eventos: EntityTable<Evento, "id">;
  meta: EntityTable<Meta, "clave">;
  contactos: Table<Contacto, [string, string]>;
  reportes: Table<ReporteGuardado, [string, string]>;
  celdas: Table<CeldaEditada, [string, number, number]>;
};

db.version(1).stores({
  afiliados: "++id, cedula, nombre, estado, pagador, tipo, municipio",
  hijos: "++id, afiliadoId",
  cruces: "++id, periodo",
  cruceDetalle: "++id, cruceId, periodo, cedula, afiliadoId, resultado",
  eventos: "++id, fecha",
  meta: "clave",
});

db.version(2).stores({
  contactos: "[periodo+cedula], periodo, estado",
  reportes: "[periodo+fuente], periodo",
});

db.version(3).stores({
  celdas: "[hoja+fila+col], hoja",
});

/**
 * Para consultas en vivo (useLiveQuery) que llaman funciones con varias esperas encadenadas:
 * Dexie solo registra con seguridad las lecturas del comienzo, así que se leen aquí las tablas
 * de las que depende la consulta. Sin esto la pantalla no se actualiza al cambiar esos datos
 * (por ejemplo, cuando llegan cambios de otro equipo).
 */
export function vigilar(...tablas: Table[]) {
  return Promise.all(tablas.map((t) => t.count()));
}

export async function leerMeta<T>(clave: string): Promise<T | undefined> {
  return (await db.meta.get(clave))?.valor as T | undefined;
}

export async function guardarMeta(clave: string, valor: unknown) {
  await db.meta.put({ clave, valor });
}

/** Borra todos los datos. Con la app publicada se borran también en el servidor (todos los equipos). */
export async function borrarTodo() {
  const { vaciarTabla } = await import("./sincronizacion");
  for (const t of [db.afiliados, db.hijos, db.cruces, db.cruceDetalle, db.eventos, db.meta, db.contactos, db.reportes, db.celdas]) await vaciarTabla(t);
}
