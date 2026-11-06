import * as XLSX from "xlsx";
import { db } from "../datos/db";
import { ESTADOS, RESULTADOS, type Afiliado, type Cruce, type CruceDetalle, type Evento, type Hijo, type Resultado } from "../datos/tipos";
import { edad, edadHijo, generoHijo, hoyISO } from "./fechas";
import { filasOriginales, hojasConEdiciones } from "./hojas";
import type { Pendiente } from "./pendientes";
import { faltantesAfiliado } from "./pendientes";
import { texto } from "./texto";

type Filas = Record<string, unknown>[];

function libro(hojas: { nombre: string; filas: Filas }[], archivo: string) {
  const wb = XLSX.utils.book_new();
  for (const h of hojas) {
    const ws = XLSX.utils.json_to_sheet(h.filas.length ? h.filas : [{ "(sin registros)": "" }]);
    const cols = Object.keys(h.filas[0] ?? {});
    ws["!cols"] = cols.map((c) => ({ wch: Math.min(45, Math.max(c.length, ...h.filas.slice(0, 200).map((f) => texto(f[c]).length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, h.nombre.slice(0, 31));
  }
  XLSX.writeFile(wb, archivo);
}

export function filaAfiliado(a: Afiliado, n?: number): Record<string, unknown> {
  return {
    ...(n !== undefined ? { "N°": n } : {}),
    "Cédula": a.cedula ?? "",
    "Nombre y apellidos": a.nombre,
    "Tipo": a.tipo,
    "Estado": ESTADOS[a.estado],
    "Entidad que descuenta": a.pagador,
    "Municipio": a.municipio,
    "Institución": a.institucion,
    "Cargo": a.cargo,
    "Área": a.area,
    "Celular": a.celular,
    "Correo": a.correo,
    "Fecha de nacimiento": a.fechaNacimiento ?? a.fechaNacimientoOriginal,
    "Edad": edad(a.fechaNacimiento) ?? "",
    "Fecha de afiliación": a.fechaAfiliacion ?? a.fechaAfiliacionOriginal,
    "Quién lo afilia": a.quienAfilia,
    "Provisional / carrera": a.vinculacion,
    "Observaciones": a.observaciones,
    "Hojas de origen": a.hojas.join(", "),
  };
}

export function exportarCruce(cruce: Cruce, detalle: CruceDetalle[], afiliados: Map<number, Afiliado>) {
  const orden: Resultado[] = ["sin_descuento", "retirado_con_descuento", "pendiente_novedad", "novedad_demorada", "no_en_base", "extraordinaria", "descontado"];
  const hojas = [
    {
      nombre: "Resumen",
      filas: [
        ...orden.map((r) => ({ "Resultado": RESULTADOS[r].titulo, "Cantidad": cruce.totales[r] ?? 0, "Qué significa": RESULTADOS[r].ayuda })),
        { "Resultado": "Activos sin cédula (no se pudieron cruzar)", "Cantidad": cruce.sinCedula, "Qué significa": "" },
      ],
    },
    ...orden.map((r) => ({
      nombre: RESULTADOS[r].titulo,
      filas: detalle.filter((d) => d.resultado === r).map((d, i) => {
        const a = d.afiliadoId ? afiliados.get(d.afiliadoId) : undefined;
        return {
          "N°": i + 1, "Cédula": d.cedula, "Nombre": a?.nombre ?? d.nombre, "Entidad": a?.pagador ?? "",
          "Institución": a?.institucion ?? "", "Celular": a?.celular ?? "", "Valor descontado": d.valor || "",
          "Observaciones": a?.observaciones ?? "",
        };
      }),
    })),
  ];
  libro(hojas, `Cruce descuentos ${cruce.periodo}.xlsx`);
}

/** Reconstruye el Excel original con sus hojas, columnas y orden, aplicando los cambios hechos en la app. */
/**
 * Descarga la base. Si está guardado el Excel original, sale con sus colores, bordes, filtros y formato
 * (solo cambian las celdas editadas). Si no, sale solo con los valores. Devuelve si conservó el formato.
 */
export async function exportarBaseOriginal(): Promise<boolean> {
  const { hojas, orden, afiliados } = await hojasConEdiciones();
  const originales = await filasOriginales();
  const nuevosApp = afiliados.filter((a) => a.origen.length === 0);
  if (originales) {
    const { excelConFormato } = await import("./xlsxOriginal");
    const filasNuevos = nuevosApp.map((a, i) => filaAfiliado(a, i + 1));
    const columnas = Object.keys(filasNuevos[0] ?? {});
    const r = await excelConFormato(originales, hojas, filasNuevos.length ? { nombre: "NUEVOS DESDE LA APP", filas: [columnas, ...filasNuevos.map((f) => columnas.map((c) => f[c] ?? ""))] } : null);
    if (r) {
      const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `BASE DE DATOS SINTRAEDUCACION ${hoyISO()}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return true;
    }
  }
  const wb = XLSX.utils.book_new();
  for (const h of orden) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hojas[h], { cellDates: true }), h);
  const nuevos = afiliados.filter((a) => a.origen.length === 0);
  if (nuevos.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(nuevos.map((a, i) => filaAfiliado(a, i + 1))), "NUEVOS DESDE LA APP");
  XLSX.writeFile(wb, `BASE DE DATOS SINTRAEDUCACION ${hoyISO()}.xlsx`);
  return false;
}

export async function exportarRespaldo() {
  const [afiliados, hijos, cruces, detalle, eventos] = await Promise.all([
    db.afiliados.toArray(), db.hijos.toArray(), db.cruces.toArray(), db.cruceDetalle.toArray(), db.eventos.toArray(),
  ]);
  const porId = new Map(afiliados.map((a) => [a.id!, a]));
  libro(
    [
      { nombre: "Afiliados", filas: afiliados.map((a, i) => ({ ...filaAfiliado(a, i + 1), ...a.extra })) },
      {
        nombre: "Hijos",
        filas: hijos.map((h: Hijo) => ({
          "Cédula del afiliado": porId.get(h.afiliadoId)?.cedula ?? "", "Afiliado": porId.get(h.afiliadoId)?.nombre ?? "",
          "Hijo": h.nombre, "Fecha de nacimiento": h.fechaNacimiento ?? h.fechaNacimientoOriginal,
          "Edad": edadHijo(h).anos ?? "", "Edad aproximada": edadHijo(h).aprox ? "Sí" : "", "Género": generoHijo(h.sexo), "Afiliado al servicio": h.afiliado === null ? "Sin confirmar" : h.afiliado ? "Sí" : "No",
          "Registro civil": h.registroCivil,
        })),
      },
      {
        nombre: "Cruces",
        filas: cruces.map((c) => ({
          "Periodo": c.periodo, "Archivos": c.fuentes.map((f) => f.archivo).join(" | "),
          ...Object.fromEntries(Object.entries(RESULTADOS).map(([k, v]) => [v.titulo, c.totales[k as Resultado] ?? 0])),
          "Fecha": c.creadoEn.slice(0, 10),
        })),
      },
      {
        nombre: "Detalle de cruces",
        filas: detalle.filter((d) => d.resultado !== "descontado").map((d) => ({
          "Periodo": d.periodo, "Cédula": d.cedula, "Nombre": d.nombre, "Resultado": RESULTADOS[d.resultado].titulo, "Valor": d.valor || "",
        })),
      },
      {
        nombre: "Eventos",
        filas: eventos.map((e: Evento) => ({
          "Evento": e.nombre, "Fecha": e.fecha, "Lugar": e.lugar, "Invitados": e.invitados.length, "Asistentes": e.asistentes.length,
        })),
      },
    ],
    `Respaldo Sintraeducacion ${hoyISO()}.xlsx`,
  );
}

export function exportarAsistenciaExcel(e: Evento, afiliados: Afiliado[]) {
  libro(
    [{
      nombre: "Asistencia",
      filas: afiliados.map((a, i) => ({
        "N°": i + 1, "Cédula": a.cedula ?? "", "Nombres y apellidos": a.nombre, "Institución / entidad": a.institucion || a.pagador,
        "Celular": a.celular, "Asistió": e.asistentes.includes(a.id!) ? "Sí" : "", "Firma": "",
      })),
    }],
    `Asistencia ${e.nombre} ${e.fecha}.xlsx`,
  );
}

export function exportarLista(nombre: string, afiliados: Afiliado[]) {
  libro([{ nombre: "Afiliados", filas: afiliados.map((a, i) => filaAfiliado(a, i + 1)) }], `${nombre} ${hoyISO()}.xlsx`);
}

export function exportarPendientes(
  pendientes: Pendiente[],
  afiliados: Afiliado[],
  hijosPor: Map<number, Hijo[]>,
  respuestas: Record<string, { resuelto: boolean; respuesta: string }> = {},
) {
  libro(
    [
      {
        nombre: "Para la reunión",
        filas: pendientes.map((p, i) => ({
          "N°": i + 1, "Prioridad": p.prioridad ?? "", "Tema": p.categoria, "Pendiente": p.titulo, "Por qué importa": p.porque ?? "", "Qué solicitar": p.solicitar,
          "Afectados": p.afectados ?? "", "Mientras tanto": p.mientras, "Resuelto": respuestas[p.id]?.resuelto ? "Sí" : "", "Respuesta del cliente": respuestas[p.id]?.respuesta ?? "",
        })),
      },
      {
        nombre: "Datos por afiliado",
        filas: afiliados.flatMap((a) =>
          faltantesAfiliado(a, hijosPor.get(a.id!) ?? [])
            .filter((f) => !["Tipo", "Datos del formulario"].includes(f.campo))
            .map((f) => ({
              "Cédula": a.cedula ?? "(sin cédula)", "Nombre": a.nombre, "Hoja": a.hojas.join(", "),
              "Falta": f.campo, "Qué solicitar": f.solicitar, "Dato correcto": "",
            })),
        ),
      },
    ],
    `Pendientes reunion Sintraeducacion ${hoyISO()}.xlsx`,
  );
}

export function exportarContactos(
  periodo: string,
  filas: { a: Afiliado | undefined; d: CruceDetalle; estado: string; nota: string }[],
) {
  libro(
    [{
      nombre: "Para contactar",
      filas: filas.map(({ a, d, estado, nota }, i) => ({
        "N°": i + 1, "Cédula": d.cedula, "Nombre": a?.nombre ?? d.nombre, "Entidad": a?.pagador ?? "",
        "Institución": a?.institucion ?? "", "Celular": a?.celular ?? "", "Correo": a?.correo ?? "",
        "Seguimiento": estado, "Nota": nota, "Observaciones de la base": a?.observaciones ?? "",
      })),
    }],
    `No les descontaron ${periodo}.xlsx`,
  );
}
