import { db, leerMeta, vigilar } from "../datos/db";
import { PAG_IBAGUE, PAG_TOLIMA, type Afiliado } from "../datos/tipos";
import { leerFecha } from "./fechas";
import { claveColumna, MAPA_COLUMNAS } from "./importarMaestro";
import { normalizar, texto } from "./texto";
import { FILAS_ELIMINADAS, type FilaEliminada } from "./eliminar";

const mostrarEncabezado = (h: unknown) => (h instanceof Date ? `Columna ${texto(h)}` : texto(h));

const esEncabezado = (r: unknown[]) => r.some((c) => claveColumna(c) === "CEDULA");

let cache: { marca: string; originales: Record<string, unknown[][]> } | null = null;

/** Filas originales del Excel. Quedan en memoria hasta que se importe otra base. */
export async function filasOriginales(): Promise<Record<string, unknown[][]> | undefined> {
  const marca = (await leerMeta<{ fecha?: string }>("importacion"))?.fecha ?? "";
  if (cache && cache.marca === marca && marca) return cache.originales;
  const orden = (await leerMeta<string[]>("ordenHojas")) ?? [];
  const porHoja: Record<string, unknown[][]> = {};
  for (const h of orden) {
    const filas = await leerMeta<unknown[][]>(`filasOriginales:${h}`);
    if (filas) porHoja[h] = filas;
  }
  // Bases importadas antes de guardar por hoja.
  const originales = Object.keys(porHoja).length ? porHoja : await leerMeta<Record<string, unknown[][]>>("filasOriginales");
  if (originales) cache = { marca, originales };
  return originales;
}

/** Copia de las filas originales del Excel con las celdas editadas en la app. */
export async function hojasConEdiciones() {
  const originales = await filasOriginales();
  const orden = (await leerMeta<string[]>("ordenHojas")) ?? [];
  if (!originales) throw new Error("Primero hay que importar la base de datos.");
  const afiliados = await db.afiliados.toArray();
  const hojas: Record<string, unknown[][]> = {};
  for (const [h, filas] of Object.entries(originales)) hojas[h] = filas.map((f) => [...(f ?? [])]);
  // Afiliados eliminados en la app: su fila del Excel original queda vacía.
  for (const { hoja, fila } of (await leerMeta<FilaEliminada[]>(FILAS_ELIMINADAS)) ?? []) {
    const f = hojas[hoja]?.[fila];
    if (f) hojas[hoja][fila] = f.map(() => null);
  }

  for (const a of afiliados) {
    if (!a.editados?.length) continue;
    for (const o of a.origen) {
      const filas = hojas[o.hoja];
      if (!filas?.[o.fila]) continue;
      let hi = o.fila;
      while (hi >= 0 && !esEncabezado(filas[hi] ?? [])) hi--;
      if (hi < 0) continue;
      const fila = filas[o.fila];
      const usadas = new Set<string>();
      filas[hi].forEach((h, i) => {
        const campo = MAPA_COLUMNAS[claveColumna(h)];
        if (!campo || usadas.has(campo)) return;
        usadas.add(campo);
        if (!a.editados!.includes(campo)) return;
        const raw = fila[i];
        if (campo === "cedula") {
          if (a.cedula && texto(raw).replace(/\D/g, "") !== a.cedula) fila[i] = Number(a.cedula);
        } else if (campo === "fechaNacimiento" || campo === "fechaAfiliacion") {
          const actual = a[campo];
          if (actual && leerFecha(raw) !== actual) fila[i] = new Date(`${actual}T00:00:00`);
        } else if (texto(raw) !== a[campo]) {
          // Respeta el tipo original: si la celda era número (ej. celular), sigue siendo número.
          fila[i] = typeof raw === "number" && /^\d+$/.test(a[campo]) ? Number(a[campo]) : a[campo];
        }
      });
    }
  }
  for (const c of await db.celdas.toArray()) {
    const fila = hojas[c.hoja]?.[c.fila];
    if (!fila) continue;
    while (fila.length <= c.col) fila.push(null);
    fila[c.col] = c.valor;
  }
  return { hojas, orden: orden.filter((h) => hojas[h]), afiliados };
}

export interface FilaHoja {
  afiliadoId: number | null;
  /** Número de fila en el Excel (1 = primera). null para afiliados creados en la app. */
  numero: number | null;
  celdas: unknown[];
}
export interface Bloque {
  titulo: string | null;
  encabezados: unknown[];
  filas: FilaHoja[];
}
export interface HojaVista {
  nombre: string;
  deAfiliados: boolean;
  columnas: number;
  bloques: Bloque[];
  total: number;
}

/** Hoja donde se muestra un afiliado creado en la app, según quién le descuenta. */
function hojaPara(a: Afiliado): string {
  if (a.pagador === PAG_IBAGUE) return "SEMIBAGUE";
  if (a.pagador === PAG_TOLIMA) return "DEPARTAMENTO";
  if (/^(Alcald|Personer)/i.test(a.pagador)) return "ALCALDIAS";
  return "SEMIBAGUE";
}

/** Arma las hojas tal como se ven en el Excel: mismas columnas, orden y secciones. */
export async function construirHojas(): Promise<HojaVista[]> {
  await vigilar(db.meta, db.afiliados, db.celdas);
  const { hojas, orden, afiliados } = await hojasConEdiciones();
  const porFila = new Map<string, number>();
  for (const a of afiliados) for (const o of a.origen) porFila.set(`${o.hoja}#${o.fila}`, a.id!);

  const vistas: HojaVista[] = orden.map((nombre) => {
    const filas = hojas[nombre];
    if (!filas.slice(0, 6).some((r) => esEncabezado(r ?? []))) {
      // Hoja sin afiliados (ej. "Hoja 10"): se muestra tal cual.
      const llenas = filas.map((r, i) => ({ r: r ?? [], i })).filter(({ r }) => r.some((c) => c !== null && c !== ""));
      const [enc, ...resto] = llenas;
      return {
        nombre, deAfiliados: false, columnas: 0, total: 0,
        bloques: [{ titulo: null, encabezados: enc?.r ?? [], filas: resto.map(({ r, i }) => ({ afiliadoId: null, numero: i + 1, celdas: r })) }],
      };
    }
    const bloques: Bloque[] = [];
    let actual: Bloque | null = null;
    let tituloPendiente: string | null = null;
    filas.forEach((r0, i) => {
      const r = r0 ?? [];
      const llenas = r.filter((c) => c !== null && c !== "");
      if (llenas.length === 1 && typeof llenas[0] === "string" && !porFila.has(`${nombre}#${i}`) && /AFILIADOS|RETIRADOS|PERSONAL/i.test(llenas[0])) {
        tituloPendiente = llenas[0].trim();
        return;
      }
      if (esEncabezado(r)) {
        actual = { titulo: tituloPendiente, encabezados: r, filas: [] };
        tituloPendiente = null;
        bloques.push(actual);
        return;
      }
      const id = porFila.get(`${nombre}#${i}`);
      if (actual && id !== undefined) actual.filas.push({ afiliadoId: id, numero: i + 1, celdas: r });
    });

    for (const a of afiliados.filter((x) => x.origen.length === 0 && hojaPara(x) === nombre)) {
      const destino = bloques.find((b) => b.titulo && normalizar(b.titulo).includes(normalizar(a.pagador.replace(/^\S+ de /, "")))) ?? bloques[bloques.length - 1];
      if (!destino) continue;
      destino.filas.push({ afiliadoId: a.id!, numero: null, celdas: filaNueva(destino.encabezados, a, destino.filas.length + 1) });
    }
    return { nombre, deAfiliados: true, columnas: 0, total: bloques.reduce((s, b) => s + b.filas.length, 0), bloques };
  });

  for (const v of vistas) {
    let ultima = 0;
    for (const b of v.bloques) {
      b.encabezados.forEach((h, i) => { if (h !== null && h !== "") ultima = Math.max(ultima, i + 1); });
      for (const f of b.filas) f.celdas.forEach((c, i) => { if (c !== null && c !== "" && c !== false) ultima = Math.max(ultima, i + 1); });
    }
    v.columnas = ultima;
    if (!v.deAfiliados) v.total = v.bloques[0]?.filas.length ?? 0;
  }
  return vistas;
}

function filaNueva(encabezados: unknown[], a: Afiliado, n: number): unknown[] {
  const fila: unknown[] = encabezados.map(() => null);
  const usadas = new Set<string>();
  encabezados.forEach((h, i) => {
    const clave = claveColumna(h);
    if (clave === "N°" || clave === "NO") { fila[i] = n; return; }
    const campo = MAPA_COLUMNAS[clave];
    if (!campo) {
      const extra = a.extra[mostrarEncabezado(h)];
      if (extra !== undefined) fila[i] = extra;
      return;
    }
    if (usadas.has(campo)) return;
    usadas.add(campo);
    const v = a[campo];
    fila[i] = campo.startsWith("fecha") && v ? new Date(`${v}T00:00:00`) : v ?? null;
  });
  return fila;
}
