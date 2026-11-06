import { registrarReportes } from "../logica/descuentosMes";
import { importarMaestro } from "../logica/importarMaestro";
import { leerReporte } from "../logica/reportes";
import { db, guardarMeta, leerMeta } from "./db";
import { leerEstadoApp } from "./sesion";

const ARCHIVOS = {
  base: "base.xlsx",
  reportes: ["reporte-ibague.xls", "reporte-tolima.xlsx", "reporte-alcaldia.pdf"],
};

async function bajar(nombre: string): Promise<File> {
  const r = await fetch(`/__demo/${nombre}`);
  if (!r.ok) throw new Error(`No se encontró demo-data/${nombre}`);
  return new File([await r.blob()], nombre);
}

/** true si hay archivos de demo disponibles (solo en `npm run dev`, nunca con el servidor). */
export function hayDemo(): boolean {
  return import.meta.env.DEV && leerEstadoApp().modo === "local";
}

/**
 * Carga la base real, cruza el mes de los reportes y arma el evento de integración
 * a partir de la columna "ASISTENCIA INTEGRACIÓN FIN DE AÑO" del Excel.
 */
export async function cargarDemo(avance: (t: string) => void = () => {}) {
  // Marca de "carga a medias": si cierran la página antes de terminar, se reanuda al volver.
  await guardarMeta("demoEnCurso", new Date().toISOString());
  avance("Importando la base de datos de afiliados");
  await importarMaestro(await bajar(ARCHIVOS.base));

  avance("Leyendo los reportes de descuento de septiembre");
  const reportes = [];
  for (const n of ARCHIVOS.reportes) reportes.push(await leerReporte(await bajar(n)));

  avance("Cruzando descuentos con la base");
  await registrarReportes(reportes, "Carga automática de la demo");
  const afiliados = await db.afiliados.toArray();

  avance("Creando el evento de integración");
  const columna = (k: string) => k.startsWith("ASISTENCIA INTEGRACI");
  const conColumna = afiliados.filter((a) => Object.keys(a.extra).some(columna) || a.hojas.some((h) => /SEMIBAGUE|DEPARTAMENTO|ALCALDIAS/.test(h)));
  const vigentes = conColumna.filter((a) => a.estado === "activo" || a.estado === "pendiente_novedad");
  await db.eventos.clear();
  await db.eventos.add({
    nombre: "Integración de fin de año",
    fecha: "2025-12-12",
    lugar: "Por confirmar",
    descripcion: "Asistencia tomada de la columna \"ASISTENCIA INTEGRACIÓN FIN DE AÑO\" del Excel. La fecha y el lugar reales se confirman en la reunión.",
    invitados: vigentes.map((a) => a.id!),
    asistentes: vigentes.filter((a) => Object.entries(a.extra).some(([k, v]) => columna(k) && v === "Sí")).map((a) => a.id!),
    creadoEn: new Date().toISOString(),
  });
  await guardarMeta("demoCargada", new Date().toISOString());
  await db.meta.delete("demoEnCurso");
}

let enCurso: Promise<boolean> | null = null;

/** Carga la demo una sola vez, aunque se llame varias veces a la vez. */
export function cargarDemoSiVacia(avance: (t: string) => void): Promise<boolean> {
  enCurso ??= (async () => {
    if (!hayDemo()) return false;
    if (await leerMeta("demoCargada")) return false;
    // Si hay datos y no quedó una carga de demo a medias, son datos propios: no se tocan.
    if (!(await leerMeta("demoEnCurso")) && (await db.afiliados.count()) > 0) return false;
    await cargarDemo(avance);
    return true;
  })().finally(() => (enCurso = null));
  return enCurso;
}
