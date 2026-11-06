import { db } from "../datos/db";
import { FUENTES, type Fuente } from "../datos/tipos";
import { cruzar, guardarCruce } from "./cruce";
import type { ReporteLeido } from "./reportes";

/**
 * Guarda los reportes que se suben y vuelve a cruzar cada mes afectado con todos los
 * reportes que ese mes tenga. Así se pueden subir los tres archivos juntos o de a uno.
 * Devuelve los meses cruzados.
 */
export async function registrarReportes(reportes: ReporteLeido[], usuario: string): Promise<string[]> {
  const meses = new Set<string>();
  for (const r of reportes) {
    // No se adivina el mes: un archivo atrasado quedaría en el mes equivocado.
    if (!r.periodo) throw new Error(`"${r.archivo}" no dice de qué mes es; revise que sea el reporte completo.`);
    const periodo = r.periodo;
    meses.add(periodo);
    await db.reportes.put({ periodo, fuente: r.fuente, archivo: r.archivo, lineas: r.lineas, cargadoEn: new Date().toISOString(), ...(r.sinPlantaCentral && r.fuente === "SEM_IBAGUE" ? { sinPlantaCentral: true } : {}) });
  }
  for (const p of meses) await recruzar(p, usuario);
  return [...meses].sort();
}

export async function recruzar(periodo: string, usuario: string) {
  const guardados = await db.reportes.where("periodo").equals(periodo).toArray();
  if (!guardados.length) return;
  const reportes: ReporteLeido[] = guardados.map((g) => ({ fuente: g.fuente, archivo: g.archivo, periodo, lineas: g.lineas, advertencias: [], sinPlantaCentral: g.sinPlantaCentral }));
  const resultado = cruzar(periodo, reportes, await db.afiliados.toArray(), usuario);
  await guardarCruce(resultado);
  // Quien estaba "pendiente de novedad" y ya aparece descontado queda activo.
  const confirmados = resultado.detalle.filter((d) => d.resultado === "descontado" && d.afiliadoId).map((d) => d.afiliadoId!);
  for (const a of await db.afiliados.bulkGet(confirmados)) {
    if (a?.estado === "pendiente_novedad") await db.afiliados.update(a.id!, { estado: "activo", actualizadoEn: new Date().toISOString() });
  }
}

export async function quitarReporte(periodo: string, fuente: Fuente, usuario: string) {
  await db.reportes.delete([periodo, fuente]);
  if ((await db.reportes.where("periodo").equals(periodo).count()) === 0) {
    const ids = (await db.cruces.where("periodo").equals(periodo).primaryKeys()) as number[];
    await db.cruceDetalle.where("cruceId").anyOf(ids).delete();
    await db.cruces.bulkDelete(ids);
  } else {
    await recruzar(periodo, usuario);
  }
}

/** Los reportes que hay que subir cada mes (la planta central de Ibagué se muestra aparte, solo si aplica). */
export const FUENTES_ORDEN = (Object.keys(FUENTES) as Fuente[]).filter((f) => !FUENTES[f].parte);
