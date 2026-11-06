import { useLiveQuery } from "dexie-react-hooks";
import { DatabaseBackup, FileSpreadsheet, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { OrdenarEscritura } from "../componentes/OrdenarEscritura";
import { Badge, useUI, ZonaArchivo } from "../componentes/ui";
import { borrarTodo, db, guardarMeta, leerMeta } from "../datos/db";
import { useEstadoApp } from "../datos/sesion";
import { cargarDemo, hayDemo } from "../datos/semilla";
import { exportarBaseOriginal, exportarRespaldo } from "../logica/exportar";
import { importarMaestro, type ResumenImportacion } from "../logica/importarMaestro";
import { guardarArchivoOriginal, infoArchivoOriginal } from "../logica/xlsxOriginal";
import * as XLSX from "xlsx";

/** Guarda el Excel original sin reimportar, solo si es el mismo archivo que se cargó (mismas hojas y filas). */
async function adjuntarOriginal(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const wb = XLSX.read(bytes, { cellDates: true });
  const orden = (await leerMeta<string[]>("ordenHojas")) ?? [];
  const mismasHojas = orden.length === wb.SheetNames.length && orden.every((h, i) => h === wb.SheetNames[i]);
  let mismasFilas = mismasHojas;
  for (const h of mismasHojas ? orden : []) {
    const filas = await leerMeta<unknown[][]>(`filasOriginales:${h}`);
    const nuevas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[h], { header: 1, raw: true, defval: null });
    if (filas && filas.length !== nuevas.length) mismasFilas = false;
  }
  if (!mismasHojas || !mismasFilas) throw new Error("Ese archivo no es el mismo que se cargó en la app (cambian las hojas o la cantidad de filas). Adjunte el Excel original.");
  await guardarArchivoOriginal(bytes, f.name);
}

/** Sección "Datos y respaldo" de Configuración. */
export function DatosYRespaldo() {
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const imp = useLiveQuery(() => leerMeta<ResumenImportacion & { fecha: string }>("importacion"), []);
  const total = useLiveQuery(() => db.afiliados.count(), []);
  const { confirmar, avisar } = useUI();
  const original = useLiveQuery(() => infoArchivoOriginal(), []);
  const app = useEstadoApp();
  const servidor = app.modo === "servidor";
  const admin = !servidor || app.usuario?.rol === "admin";

  async function correr(etiqueta: string, fn: () => Promise<unknown>, ok?: string) {
    setError("");
    setOcupado(etiqueta);
    try {
      await fn();
      if (ok) avisar(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado("");
    }
  }

  async function importar(archivos: File[]) {
    const f = archivos[0];
    if (!f) return;
    if (!admin) return setError("Solo un administrador puede cargar o reemplazar la base de datos.");
    if (total && !(await confirmar({ titulo: "Reemplazar la base de datos", texto: `Los ${total} registros actuales se reemplazan por los de "${f.name}"${servidor ? " para todas las personas que usan la app" : ""}. Las ediciones hechas en la app sobre la base anterior se descartan; los cruces guardados se conservan.`, boton: "Reemplazar" }))) return;
    await correr("Importando", () => importarMaestro(f), "Base importada");
  }

  return (
      <div className="pila">
        {error && <div className="aviso error">{error}</div>}
        {ocupado && <div className="aviso info">{ocupado}…</div>}

        <div className="card">
          <div className="card-cab"><FileSpreadsheet size={16} className="tenue" /><h3>Base de datos de afiliados</h3>{imp && <span className="accion peq muted">Última carga: {new Date(imp.fecha).toLocaleString("es-CO")}</span>}</div>
          <div className="card-cuerpo pila">
            {imp && (
              <>
                <div className="fila-wrap">
                  <Badge tono="azul">{imp.afiliados} personas</Badge>
                  <Badge tono="rosa">{imp.hijos} hijos</Badge>
                  <Badge tono="morado">{imp.repetidas} cédulas en varias hojas (unidas)</Badge>
                  <Badge tono="ambar">{imp.fechasNoLeidas} fechas de nacimiento ilegibles</Badge>
                  <span className="peq muted">Archivo: {imp.archivo}</span>
                </div>
                <div className="tabla-ajuste">
                  <table className="tbl">
                    <thead><tr><th>Hoja</th><th className="num">Filas</th><th className="num">Con cédula</th><th className="num">Sin cédula</th><th>Secciones</th></tr></thead>
                    <tbody>
                      {imp.hojas.map((h) => (
                        <tr key={h.nombre}>
                          <td><b>{h.nombre}</b> {!h.conocida && <Badge tono="ambar">por confirmar</Badge>}</td>
                          <td className="num">{h.filas}</td>
                          <td className="num">{h.conCedula}</td>
                          <td className="num">{h.sinCedula || ""}</td>
                          <td className="muted">{h.seccion?.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {imp.omitidas.length > 0 && <p className="peq muted">Hojas sin afiliados que no se importan: {imp.omitidas.join(", ")}.</p>}
              </>
            )}
            {admin
              ? <ZonaArchivo acepta=".xlsx,.xls" onArchivos={importar} titulo="Subir otra versión del Excel de la base" ayuda="Arrastre el archivo o haga clic para buscarlo" />
              : <p className="peq muted" style={{ margin: 0 }}>Cargar o reemplazar la base lo hace un administrador.</p>}
          </div>
        </div>

        <div className="dos">
          <div className="card">
            <div className="card-cab"><FileSpreadsheet size={16} className="tenue" /><h3>Excel igual al original</h3></div>
            <div className="card-cuerpo">
              <p className="muted">El mismo Excel que manejan hoy, con sus colores, filtros y formato. Solo cambian las celdas editadas en la app; los afiliados nuevos van en una hoja aparte.</p>
              {original ? (
                <p className="peq" style={{ color: "var(--verde)", marginTop: 0 }}>Formato original guardado: {original.nombre}</p>
              ) : total ? (
                <div className="aviso info" style={{ marginBottom: 12 }}>
                  <div className="pila" style={{ gap: 8 }}>
                    <span>Para que el Excel salga con sus colores y formato, adjunte una vez el archivo original (el mismo que se cargó). No se vuelve a importar nada.</span>
                    <label className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
                      Adjuntar Excel original
                      <input type="file" accept=".xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) correr("Revisando el archivo", () => adjuntarOriginal(f), "Formato original guardado"); }} />
                    </label>
                  </div>
                </div>
              ) : null}
              <button className="btn btn-primario" disabled={!total} onClick={() => correr("Generando Excel", exportarBaseOriginal, "Excel descargado")}>Descargar base en Excel</button>
            </div>
          </div>
          <div className="card">
            <div className="card-cab"><DatabaseBackup size={16} className="tenue" /><h3>Respaldo completo</h3></div>
            <div className="card-cuerpo">
              <p className="muted">Todo lo de la app en hojas ordenadas: afiliados, hijos, cruces mensuales y eventos.</p>
              <button className="btn" disabled={!total} onClick={() => correr("Generando respaldo", exportarRespaldo, "Respaldo descargado")}>Descargar respaldo</button>
            </div>
          </div>
        </div>

        {admin && !!total && <OrdenarEscritura />}

        {admin && <div className="card card-peligro">
          <div className="card-cab"><h3 style={{ color: "var(--rojo)" }}>{servidor ? "Borrar los datos" : "Reiniciar la demo"}</h3></div>
          <div className="card-cuerpo fila-wrap">
            {hayDemo() && (
              <button className="btn" onClick={async () => {
                if (!(await confirmar({ titulo: "Restaurar los datos de la demo", texto: "Se borran los cambios y se vuelven a cargar la base, el cruce de septiembre y el evento de integración.", boton: "Restaurar" }))) return;
                await correr("Restaurando la demo", async () => { await borrarTodo(); await cargarDemo(setOcupado); }, "Demo restaurada");
              }}><RotateCcw size={15} />Restaurar datos de la demo</button>
            )}
            <button className="btn btn-peligro" onClick={async () => {
              if (!(await confirmar({
                titulo: "Borrar todos los datos",
                texto: servidor
                  ? "Se borran afiliados, hijos, cruces, contactos y eventos en el servidor y en todos los equipos. No se puede deshacer: descargue antes el respaldo completo."
                  : "Se borran afiliados, cruces y eventos de este navegador.",
                boton: "Borrar todo",
                peligro: true,
              }))) return;
              await borrarTodo();
              await guardarMeta("demoCargada", "borrada");
              avisar("Datos borrados");
            }}><Trash2 size={15} />Borrar todo</button>
          </div>
        </div>}
      </div>
  );
}
