import type { Table, Transaction } from "dexie";
import { useSyncExternalStore } from "react";
import { db } from "./db";

/*
 * Sincronización con el servidor (Cloudflare D1).
 *
 * Cada equipo trabaja sobre su copia local (IndexedDB), así todo responde rápido.
 * - Cada cambio local se anota en una cola guardada en localStorage (sobrevive si se cierra la página).
 * - La cola se envía en lotes a /api/cambios.
 * - Cada pocos segundos se descargan los cambios de los demás equipos desde el último cursor.
 * - Si un dato tiene un cambio local pendiente, se respeta el local: se enviará y ganará.
 */

export const TABLAS_SYNC = ["afiliados", "hijos", "cruces", "cruceDetalle", "eventos", "meta", "contactos", "reportes", "celdas"] as const;
type NombreTabla = (typeof TABLAS_SYNC)[number];
const CON_ID_AUTOMATICO = new Set<NombreTabla>(["afiliados", "hijos", "cruces", "cruceDetalle", "eventos"]);

const LS_COLA = "sync-cola";
const LS_CURSOR = "sync-cursor";
const MAX_LOTE = 60;
const MAX_BYTES_LOTE = 1_500_000;
const CADA_MS = 15_000;

/* ───────────────────────── estado visible ───────────────────────── */

export type EstadoSync = "listo" | "enviando" | "recibiendo" | "sin-conexion" | "error";
let estado: { estado: EstadoSync; pendientes: number; ultima: string | null; mensaje?: string } = { estado: "listo", pendientes: 0, ultima: null };
const oyentes = new Set<() => void>();
function poner(cambios: Partial<typeof estado>) {
  estado = { ...estado, ...cambios };
  oyentes.forEach((f) => f());
}
export const useEstadoSync = () => useSyncExternalStore((f) => (oyentes.add(f), () => oyentes.delete(f)), () => estado);

/* ───────────────────────── serialización (conserva las fechas) ───────────────────────── */

export function serializar(v: unknown): string {
  return JSON.stringify(v, function (this: Record<string, unknown>, k, valor) {
    const crudo = this[k];
    return crudo instanceof Date ? { $fecha: crudo.toISOString() } : valor;
  });
}

export function deserializar<T>(t: string): T {
  return JSON.parse(t, (_k, v) => (v && typeof v === "object" && typeof v.$fecha === "string" && Object.keys(v).length === 1 ? new Date(v.$fecha) : v));
}

const claveDe = (pk: unknown) => (typeof pk === "number" ? `n:${pk}` : typeof pk === "string" ? `s:${pk}` : `j:${JSON.stringify(pk)}`);
const pkDe = (c: string): unknown => (c.startsWith("n:") ? Number(c.slice(2)) : c.startsWith("s:") ? c.slice(2) : JSON.parse(c.slice(2)));

/** Identificador único entre equipos: milisegundos × 1000 + azar (cabe en un número seguro de JS). */
let ultimoId = 0;
export function idUnico(): number {
  let id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  if (id <= ultimoId) id = ultimoId + 1;
  ultimoId = id;
  return id;
}

/* ───────────────────────── cola de cambios ───────────────────────── */

type Entrada = { t: NombreTabla; c: string; tipo: "put" | "del"; g: number } | { t: NombreTabla; vaciar: true; g: number };
let cola: Entrada[] = leerCola();
let generacion = 1;

function leerCola(): Entrada[] {
  try {
    return JSON.parse(localStorage.getItem(LS_COLA) ?? "[]");
  } catch {
    return [];
  }
}
function guardarCola() {
  try {
    localStorage.setItem(LS_COLA, JSON.stringify(cola));
  } catch {
    /* sin espacio: la cola sigue en memoria */
  }
  poner({ pendientes: cola.length });
}

function marcar(t: NombreTabla, pk: unknown, tipo: "put" | "del") {
  const c = claveDe(pk);
  const g = generacion++;
  const i = cola.findIndex((e) => !("vaciar" in e) && e.t === t && e.c === c);
  if (i >= 0) cola[i] = { t, c, tipo, g };
  else cola.push({ t, c, tipo, g });
  guardarCola();
  programarEnvio();
}

/** Vaciar una tabla en todos los equipos (por ejemplo, al importar una base nueva). */
export async function vaciarTabla(tabla: Table) {
  await tabla.clear();
  if (!activa) return;
  const t = tabla.name as NombreTabla;
  cola = cola.filter((e) => e.t !== t);
  cola.push({ t, vaciar: true, g: generacion++ });
  guardarCola();
  programarEnvio();
}

/* ───────────────────────── marcas automáticas con hooks de Dexie ───────────────────────── */

let activa = false;
let instalada = false;
const esRemota = (tx: Transaction | undefined) => !!(tx as unknown as { __remota?: boolean })?.__remota;

function instalarHooks() {
  if (instalada) return;
  instalada = true;
  for (const nombre of TABLAS_SYNC) {
    const tabla = db.table(nombre);
    tabla.hook("creating", function (pk, obj, tx) {
      if (CON_ID_AUTOMATICO.has(nombre) && (obj as { id?: number }).id === undefined) {
        const id = idUnico();
        (obj as { id?: number }).id = id;
        pk = id;
      }
      if (activa && !esRemota(tx)) this.onsuccess = (clave) => marcar(nombre, clave ?? pk, "put");
      return pk;
    });
    tabla.hook("updating", function (_mods, pk, _obj, tx) {
      if (activa && !esRemota(tx)) this.onsuccess = () => marcar(nombre, pk, "put");
    });
    tabla.hook("deleting", function (pk, _obj, tx) {
      if (activa && !esRemota(tx)) this.onsuccess = () => marcar(nombre, pk, "del");
    });
  }
}

/* ───────────────────────── envío y descarga ───────────────────────── */

let alVencerSesion: () => void = () => {};
let temporizador: ReturnType<typeof setTimeout> | null = null;
let intervalo: ReturnType<typeof setInterval> | null = null;

function programarEnvio(ms = 700) {
  if (!activa) return;
  if (temporizador) clearTimeout(temporizador);
  temporizador = setTimeout(() => { sincronizarAhora(); }, ms);
}

class SesionVencida extends Error {}

async function api(ruta: string, init?: RequestInit) {
  let r: Response;
  try {
    r = await fetch(ruta, { credentials: "same-origin", redirect: "manual", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new TypeError("sin-conexion");
  }
  // Con Cloudflare Access, una sesión vencida llega como redirección a la página del PIN.
  if (r.status === 401 || r.type === "opaqueredirect") throw new SesionVencida();
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Error ${r.status}`);
  return r.json();
}

async function enviar(): Promise<void> {
  while (cola.length) {
    poner({ estado: "enviando" });
    // Un "vaciar" va solo al inicio del lote, para respetar el orden.
    const lote: Entrada[] = [];
    const ops: unknown[] = [];
    let bytes = 0;
    for (const e of cola) {
      if (lote.length >= MAX_LOTE || bytes > MAX_BYTES_LOTE) break;
      if ("vaciar" in e) {
        if (lote.length) break;
        lote.push(e);
        ops.push({ op: "vaciar", t: e.t });
        continue;
      }
      const fila = await db.table(e.t).get(pkDe(e.c) as never);
      lote.push(e);
      if (fila !== undefined) {
        const d = serializar(fila);
        bytes += d.length;
        ops.push({ op: "put", t: e.t, c: e.c, d });
      } else if (e.tipo === "del") {
        ops.push({ op: "del", t: e.t, c: e.c });
      }
      // Un "put" sin fila local viene de una transacción que no se completó: no se envía nada.
    }
    if (ops.length) await api("/api/cambios", { method: "POST", body: JSON.stringify({ ops }) });
    // Solo se quitan las entradas que no cambiaron mientras se enviaban.
    const enviadas = new Map(lote.map((e) => [e, e.g]));
    cola = cola.filter((e) => !enviadas.has(e) || enviadas.get(e) !== e.g);
    guardarCola();
  }
}

function leerCursor(): { v: number; k: string } {
  try {
    return JSON.parse(localStorage.getItem(LS_CURSOR) ?? '{"v":0,"k":""}');
  } catch {
    return { v: 0, k: "" };
  }
}

async function descargar(): Promise<number> {
  let total = 0;
  let cursor = leerCursor();
  for (;;) {
    const r = (await api(`/api/cambios?v=${cursor.v}&k=${encodeURIComponent(cursor.k)}&limite=200`)) as {
      cambios: { t: NombreTabla; c: string; d: string | null }[];
      cursor: { v: number; k: string };
      mas: boolean;
    };
    if (r.cambios.length) {
      poner({ estado: "recibiendo" });
      const pendientes = new Set(cola.flatMap((e) => ("vaciar" in e ? [] : [`${e.t}|${e.c}`])));
      const tablas = TABLAS_SYNC.map((t) => db.table(t));
      await db.transaction("rw", tablas, async (tx) => {
        (tx as unknown as { __remota: boolean }).__remota = true;
        const porTabla = new Map<NombreTabla, { poner: unknown[]; quitar: unknown[] }>();
        for (const x of r.cambios) {
          if (pendientes.has(`${x.t}|${x.c}`)) continue; // el cambio local pendiente gana
          const g = porTabla.get(x.t) ?? { poner: [], quitar: [] };
          if (x.d === null) g.quitar.push(pkDe(x.c));
          else g.poner.push(deserializar(x.d));
          porTabla.set(x.t, g);
        }
        for (const [t, g] of porTabla) {
          if (g.quitar.length) await db.table(t).bulkDelete(g.quitar as never[]);
          if (g.poner.length) await db.table(t).bulkPut(g.poner as object[]);
        }
      });
      total += r.cambios.length;
    }
    cursor = r.cursor;
    try { localStorage.setItem(LS_CURSOR, JSON.stringify(cursor)); } catch { /* nada */ }
    if (!r.mas) break;
  }
  if (total) await quitarFilasSobrantes();
  return total;
}

/**
 * Si dos computadores subieron el mismo mes y el último traía menos filas, pueden quedar filas del
 * anterior más allá de las que dice el mes. Se borran (y el borrado se envía al servidor).
 */
async function quitarFilasSobrantes() {
  for (const c of await db.cruces.toArray()) {
    if (c.id === undefined || c.filas === undefined) continue;
    const sobran = db.cruceDetalle.where("id").between(c.id * 100_000 + c.filas, (c.id + 1) * 100_000);
    if (await sobran.count()) await sobran.delete();
  }
}

let corriendo: Promise<void> | null = null;

/** Envía lo pendiente y descarga lo nuevo. Una sola a la vez por pestaña, y entre pestañas con Web Locks. */
export function sincronizarAhora(): Promise<void> {
  if (!activa) return Promise.resolve();
  corriendo ??= (async () => {
    const tarea = async () => {
      try {
        await enviar();
        await descargar();
        poner({ estado: "listo", ultima: new Date().toISOString(), mensaje: undefined });
      } catch (e) {
        if (e instanceof SesionVencida) {
          poner({ estado: "error", mensaje: "La sesión venció" });
          alVencerSesion();
        } else if (e instanceof TypeError) {
          poner({ estado: "sin-conexion", mensaje: "Sin conexión: los cambios se guardan en este equipo y se envían al volver." });
        } else {
          poner({ estado: "error", mensaje: e instanceof Error ? e.message : String(e) });
        }
      }
    };
    if (navigator.locks) await navigator.locks.request("sintra-sync", tarea);
    else await tarea();
  })().finally(() => { corriendo = null; });
  return corriendo;
}

/** Activa la sincronización (después de iniciar sesión en el servidor). */
export function activarSincronizacion(vencio: () => void) {
  alVencerSesion = vencio;
  instalarHooks();
  activa = true;
  poner({ pendientes: cola.length });
  if (!intervalo) {
    intervalo = setInterval(() => { sincronizarAhora(); }, CADA_MS);
    window.addEventListener("focus", () => { sincronizarAhora(); });
    window.addEventListener("online", () => { sincronizarAhora(); });
  }
  return sincronizarAhora();
}

export function detenerSincronizacion() {
  activa = false;
  if (intervalo) clearInterval(intervalo);
  intervalo = null;
}

export const hayPendientes = () => cola.length > 0;

/** Al cerrar sesión: borra la copia local (puede ser un PC compartido). */
export async function borrarCopiaLocal() {
  await Promise.all(TABLAS_SYNC.map((t) => db.table(t).clear()));
  cola = [];
  guardarCola();
  try { localStorage.removeItem(LS_CURSOR); } catch { /* nada */ }
}
