import { leerEstadoApp } from "../datos/sesion";
import type { ArchivoAdjunto } from "../datos/tipos";

/** Los archivos viven en el servidor (Cloudflare R2): en la versión local de demostración no hay dónde guardarlos. */
export const hayArchivos = () => leerEstadoApp().modo === "servidor";

/** rc = registro civil de un hijo; ced = cédula de un afiliado. */
export type TipoArchivo = "rc" | "ced";

export const MAX_MB = 10;
export const ACEPTA = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

export const urlArchivo = (a: ArchivoAdjunto, descargar = false) => `/api/archivos?clave=${encodeURIComponent(a.clave)}${descargar ? "&descargar" : ""}`;
export const esPdf = (a: ArchivoAdjunto) => a.tipo === "application/pdf";

async function respuesta(r: Response) {
  if (r.status === 401 || r.type === "opaqueredirect") throw new Error("La sesión venció: ingrese de nuevo y vuelva a intentarlo.");
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error ?? `Error ${r.status}`);
  return d;
}

/** Sube un documento (de un hijo o de un afiliado) y devuelve lo que se guarda en su registro. */
export async function subirArchivo(tipo: TipoArchivo, dueno: number, archivo: File): Promise<ArchivoAdjunto> {
  if (!hayArchivos()) throw new Error("Los archivos solo se pueden adjuntar en la versión publicada de la app.");
  if (archivo.size > MAX_MB * 1024 * 1024) throw new Error(`"${archivo.name}" pesa más de ${MAX_MB} MB.`);
  if (!ACEPTA.split(",").includes(archivo.type)) throw new Error(`"${archivo.name}" no es una foto ni un PDF.`);
  let r: Response;
  try {
    r = await fetch(`/api/archivos/${tipo}/${dueno}`, {
      method: "PUT", credentials: "same-origin", redirect: "manual",
      headers: { "Content-Type": archivo.type, "X-Nombre-Archivo": encodeURIComponent(archivo.name) },
      body: archivo,
    });
  } catch {
    throw new Error("Sin conexión: el archivo no se subió.");
  }
  return (await respuesta(r)) as ArchivoAdjunto;
}

export const subirRegistroCivil = (hijoId: number, archivo: File) => subirArchivo("rc", hijoId, archivo);

export async function borrarArchivo(clave: string): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`/api/archivos?clave=${encodeURIComponent(clave)}`, { method: "DELETE", credentials: "same-origin", redirect: "manual" });
  } catch {
    throw new Error("Sin conexión: el archivo no se quitó.");
  }
  await respuesta(r);
}

export const borrarRegistroCivil = borrarArchivo;
