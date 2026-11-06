import { db } from "../datos/db";
import { FUENTES, type Afiliado, type Cruce, type CruceDetalle, type LineaReporte, type Resultado } from "../datos/tipos";
import { periodoAnterior } from "./fechas";
import type { ReporteLeido } from "./reportes";

export interface ResultadoCruce {
  cruce: Cruce;
  detalle: CruceDetalle[];
}

/** Una novedad de afiliación se considera "en trámite" durante los 2 meses siguientes. */
const MESES_TRAMITE = 2;

export function cruzar(periodo: string, reportes: ReporteLeido[], afiliados: Afiliado[], usuario: string): ResultadoCruce {
  const ordinarias = new Map<string, LineaReporte[]>();
  const extraordinarias: LineaReporte[] = [];
  for (const r of reportes) {
    for (const l of r.lineas) {
      if (l.concepto === "extraordinaria") extraordinarias.push(l);
      else ordinarias.set(l.cedula, [...(ordinarias.get(l.cedula) ?? []), l]);
    }
  }
  // Un archivo que es solo una parte de la entidad (planta central) no dice nada de quienes no aparecen en él.
  const pagadoresCargados = new Set(reportes.filter((r) => !FUENTES[r.fuente].parte).map((r) => FUENTES[r.fuente].pagador));
  const porCedula = new Map(afiliados.filter((a) => a.cedula).map((a) => [a.cedula!, a]));
  const detalle: CruceDetalle[] = [];
  const agregar = (d: Omit<CruceDetalle, "cruceId" | "periodo">) => detalle.push({ ...d, cruceId: 0, periodo });
  let sinCedula = 0;

  for (const a of afiliados) {
    const activo = a.estado === "activo" || a.estado === "pendiente_novedad";
    if (!a.cedula) {
      if (activo && pagadoresCargados.has(a.pagador)) sinCedula++;
      continue;
    }
    const lineas = ordinarias.get(a.cedula);
    if (lineas) {
      agregar({
        cedula: a.cedula, afiliadoId: a.id ?? null, nombre: a.nombre, fuente: lineas[0].fuente,
        valor: lineas.reduce((s, l) => s + l.valor, 0),
        resultado: activo ? "descontado" : "retirado_con_descuento",
      });
    } else if (activo && pagadoresCargados.has(a.pagador)) {
      // En trámite solo los meses siguientes a pedir la afiliación; después, si no aparece, es "sin descuento".
      const enTramite = a.novedadPeriodo !== null
        ? a.novedadPeriodo >= periodoAnterior(periodo, MESES_TRAMITE)
        : a.estado === "pendiente_novedad";
      agregar({
        cedula: a.cedula, afiliadoId: a.id ?? null, nombre: a.nombre, fuente: null, valor: 0,
        // Pedida hace rato y nunca descontada: no se sabe si la aplazaron, así que no se trata como "sin descuento".
        resultado: enTramite ? "pendiente_novedad" : a.estado === "pendiente_novedad" ? "novedad_demorada" : "sin_descuento",
      });
    }
  }

  for (const [cedula, lineas] of ordinarias) {
    if (porCedula.has(cedula)) continue;
    agregar({
      cedula, afiliadoId: null, nombre: lineas[0].nombre, fuente: lineas[0].fuente,
      valor: lineas.reduce((s, l) => s + l.valor, 0), resultado: "no_en_base",
    });
  }

  for (const l of extraordinarias) {
    const a = porCedula.get(l.cedula);
    agregar({
      cedula: l.cedula, afiliadoId: a?.id ?? null, nombre: a?.nombre ?? l.nombre,
      fuente: l.fuente, valor: l.valor, resultado: "extraordinaria",
    });
  }

  const totales: Partial<Record<Resultado, number>> = {};
  for (const d of detalle) totales[d.resultado] = (totales[d.resultado] ?? 0) + 1;

  const cruce: Cruce = {
    periodo,
    fuentes: reportes.map((r) => ({
      fuente: r.fuente, archivo: r.archivo, lineas: r.lineas.length,
      // Solo el descuento mensual: el ahorro del viaje (grupo extraordinario) va aparte.
      total: r.lineas.reduce((s, l) => (l.concepto === "extraordinaria" ? s : s + l.valor), 0),
      ...(r.sinPlantaCentral ? { sinPlantaCentral: true } : {}),
    })),
    totales,
    sinCedula,
    creadoEn: new Date().toISOString(),
    creadoPor: usuario,
  };
  return { cruce, detalle };
}

/** Número fijo del cruce de un mes (2026-09 -> 202609). */
export const idCruce = (periodo: string) => Number(periodo.replace("-", ""));

/**
 * Guarda el cruce. Si ya había uno del mismo periodo, lo reemplaza.
 * El cruce y su detalle usan números fijos por mes: si dos computadores cruzan el mismo mes
 * (por ejemplo, uno estaba sin internet), escriben los mismos registros y el mes no queda duplicado.
 */
export async function guardarCruce({ cruce, detalle }: ResultadoCruce): Promise<number> {
  const id = idCruce(cruce.periodo);
  return db.transaction("rw", db.cruces, db.cruceDetalle, async () => {
    const viejos = (await db.cruces.where("periodo").equals(cruce.periodo).primaryKeys()) as number[];
    await db.cruceDetalle.where("cruceId").anyOf([...viejos, id]).delete();
    await db.cruceDetalle.where("periodo").equals(cruce.periodo).delete();
    await db.cruces.bulkDelete(viejos);
    await db.cruces.put({ ...cruce, id, filas: detalle.length });
    await db.cruceDetalle.bulkAdd(detalle.map((d, k) => ({ ...d, cruceId: id, id: id * 100_000 + k })));
    return id;
  });
}

/**
 * Meses seguidos sin descuento, contando hacia atrás desde el cruce más reciente.
 * Devuelve afiliadoId -> número de meses.
 */
export async function calcularRachas(): Promise<Map<number, { meses: number; desde: string }>> {
  const cruces = (await db.cruces.toArray()).sort((a, b) => b.periodo.localeCompare(a.periodo));
  const rachas = new Map<number, { meses: number; desde: string }>();
  const cortadas = new Set<number>();
  for (const c of cruces) {
    const det = await db.cruceDetalle.where("cruceId").equals(c.id!).toArray();
    const sin = new Set(det.filter((d) => d.resultado === "sin_descuento" && d.afiliadoId).map((d) => d.afiliadoId!));
    for (const id of sin) {
      if (cortadas.has(id)) continue;
      const r = rachas.get(id);
      rachas.set(id, { meses: (r?.meses ?? 0) + 1, desde: c.periodo });
    }
    for (const id of rachas.keys()) if (!sin.has(id)) cortadas.add(id);
    for (const d of det) if (d.afiliadoId && d.resultado !== "sin_descuento") cortadas.add(d.afiliadoId);
  }
  return rachas;
}
