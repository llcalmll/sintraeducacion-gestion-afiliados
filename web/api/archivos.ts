/**
 * Archivos adjuntos (registros civiles de los hijos y cédulas de los afiliados) en Cloudflare R2. Nunca públicos: solo se sirven a una sesión válida.
 *
 *   PUT    /api/archivos/rc/:hijoId     sube el registro civil de un hijo (cuerpo = el archivo; X-Nombre-Archivo = su nombre)
 *   PUT    /api/archivos/ced/:afiliadoId sube la cédula de un afiliado
 *   GET    /api/archivos?clave=...      lo muestra (con &descargar, lo descarga)
 *   DELETE /api/archivos?clave=...      lo borra
 *
 * En la base solo queda la clave del archivo, dentro del registro del hijo o del afiliado (se sincroniza como cualquier dato).
 */

export interface EnvArchivos {
  ARCHIVOS?: R2Bucket;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const CLAVE = /^(rc|ced)\/\d+\/[0-9a-f-]{36}$/;

const json = (d: unknown, estado = 200) => new Response(JSON.stringify(d), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8" } });
const error = (mensaje: string, estado = 400) => json({ error: mensaje }, estado);

export async function manejarArchivos(env: EnvArchivos, req: Request, ruta: string, url: URL): Promise<Response> {
  if (!env.ARCHIVOS) return error("El almacenamiento de archivos todavía no está activado en el servidor.", 503);
  const m = req.method;

  const subir = ruta.match(/^\/archivos\/(rc|ced)\/(\d+)$/);
  if (subir && m === "PUT") {
    const tipo = (req.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TIPOS.test(tipo)) return error("Solo se aceptan fotos (JPG, PNG, WEBP, HEIC) o PDF.", 415);
    if (Number(req.headers.get("Content-Length") ?? 0) > MAX_BYTES) return error("El archivo pesa más de 10 MB.", 413);
    const datos = await req.arrayBuffer();
    if (!datos.byteLength) return error("El archivo está vacío.");
    if (datos.byteLength > MAX_BYTES) return error("El archivo pesa más de 10 MB.", 413);
    let nombre = subir[1] === "ced" ? "cedula" : "registro-civil";
    try { nombre = decodeURIComponent(req.headers.get("X-Nombre-Archivo") ?? nombre).slice(0, 150) || nombre; } catch { /* nombre por defecto */ }
    const clave = `${subir[1]}/${subir[2]}/${crypto.randomUUID()}`;
    await env.ARCHIVOS.put(clave, datos, { httpMetadata: { contentType: tipo }, customMetadata: { nombre } });
    return json({ clave, nombre, tipo, tamano: datos.byteLength, subidoEn: new Date().toISOString() });
  }

  if (ruta === "/archivos" && (m === "GET" || m === "DELETE")) {
    const clave = url.searchParams.get("clave") ?? "";
    if (!CLAVE.test(clave)) return error("Archivo no válido.", 404);
    if (m === "DELETE") {
      await env.ARCHIVOS.delete(clave);
      return json({ ok: true });
    }
    const o = await env.ARCHIVOS.get(clave);
    if (!o) return error("El archivo ya no existe.", 404);
    const nombre = o.customMetadata?.nombre ?? "documento";
    const disposicion = url.searchParams.has("descargar") ? "attachment" : "inline";
    return new Response(o.body, {
      headers: {
        "Content-Type": o.httpMetadata?.contentType ?? "application/octet-stream",
        "Content-Disposition": `${disposicion}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        // Datos de menores: que el navegador no los guarde en caché compartida.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return error("Ruta no encontrada", 404);
}
