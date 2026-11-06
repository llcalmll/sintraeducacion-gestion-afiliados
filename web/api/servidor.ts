/// <reference types="@cloudflare/workers-types" />
/**
 * API de Sintraeducación (Cloudflare Pages Functions + D1).
 *
 *   GET   /api/estado        ¿hay usuarios? ¿quién soy?
 *   POST  /api/configurar    crea la primera cuenta (admin) si todavía no hay ninguna; pide el código de instalación
 *   POST  /api/ingresar      usuario + clave -> cookie de sesión
 *   POST  /api/salir
 *   POST  /api/clave         cambiar la clave propia
 *   GET   /api/usuarios      (admin) listar
 *   POST  /api/usuarios      (admin) crear
 *   PATCH /api/usuarios      (admin) cambiar nombre, rol, clave o activar/desactivar
 *   GET   /api/cambios       registros que cambiaron desde un cursor
 *   POST  /api/cambios       subir cambios (guardar, borrar, vaciar tabla)
 *
 * Dos formas de ingresar:
 * - Con correo (Cloudflare Access configurado, ver acceso.ts): Cloudflare verifica el correo con un PIN;
 *   no hay claves, y /configurar, /ingresar y /clave no aplican. Compartir acceso actualiza el grupo de Access.
 * - Con usuario y clave (sin Access): sesiones propias con cookie.
 */

import { accesoActivo, actualizarGrupo, correoVerificado, type EnvAcceso } from "./acceso";
import { manejarArchivos, type EnvArchivos } from "./archivos";

export interface Env extends EnvAcceso, EnvArchivos {
  DB: D1Database;
  /** Secreto que se mezcla con las claves. Si se roba la base sin él, los hashes no sirven. */
  PIMIENTA?: string;
  /** Código que se pide al crear la primera cuenta, para que nadie más la cree antes que el sindicato. */
  CODIGO_INSTALACION?: string;
}

const TABLAS = new Set(["afiliados", "hijos", "cruces", "cruceDetalle", "eventos", "meta", "contactos", "reportes", "celdas"]);
const ITERACIONES = 20_000; // el plan gratis limita la CPU por petición
const DIAS_SESION = 30;
const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 10;
const MAX_OPERACIONES = 100;
const MAX_DATOS = 1_900_000; // D1 admite filas de hasta 2 MB

type Usuario = { usuario: string; nombre: string; rol: string };

/* ───────────────────────── utilidades ───────────────────────── */

const ahora = () => new Date().toISOString();
const enMinutos = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function json(cuerpo: unknown, estado = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });
}
const error = (mensaje: string, estado = 400) => json({ error: mensaje }, estado);

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const b64url = (b: Uint8Array) => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function derivar(clave: string, sal: string, pimienta: string): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave + pimienta), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(atob(sal), (c) => c.charCodeAt(0)), iterations: ITERACIONES }, material, 256);
  return b64(bits);
}

function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const sha256 = async (t: string) => b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));

function cookie(req: Request, nombre: string) {
  const m = (req.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function cookieSesion(req: Request, token: string | null) {
  const segura = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return token
    ? `sesion=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}${segura}`
    : `sesion=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${segura}`;
}

async function leerJSON<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// Un nombre corto (mlopez) o un correo (usuario@ejemplo.com), en minúsculas y sin espacios.
const validarUsuario = (u: unknown) => typeof u === "string" && /^[a-z0-9._+-]+(@[a-z0-9-]+(\.[a-z0-9-]+)+)?$/.test(u) && u.length >= 3 && u.length <= 100;
const validarClave = (c: unknown) => typeof c === "string" && c.length >= 8 && c.length <= 200;

/* ───────────────────────── sesiones ───────────────────────── */

async function crearSesion(env: Env, req: Request, usuario: string) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sesiones (token_hash, usuario, expira, creada) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), usuario, enMinutos(DIAS_SESION * 24 * 60), ahora()).run();
  // De paso se limpian las sesiones vencidas.
  await env.DB.prepare("DELETE FROM sesiones WHERE expira < ?").bind(ahora()).run();
  return cookieSesion(req, token);
}

async function sesionActual(env: Env, req: Request): Promise<Usuario | null> {
  if (accesoActivo(env)) {
    const correo = await correoVerificado(env, req);
    if (!correo) return null;
    return (await env.DB.prepare("SELECT usuario, nombre, rol FROM usuarios WHERE usuario = ? AND activo = 1").bind(correo).first<Usuario>()) ?? null;
  }
  const token = cookie(req, "sesion");
  if (!token) return null;
  const fila = await env.DB.prepare(
    "SELECT u.usuario, u.nombre, u.rol FROM sesiones s JOIN usuarios u ON u.usuario = s.usuario WHERE s.token_hash = ? AND s.expira > ? AND u.activo = 1",
  ).bind(await sha256(token), ahora()).first<Usuario>();
  return fila ?? null;
}

async function nuevoHash(env: Env, clave: string) {
  const sal = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { sal, hash: await derivar(clave, sal, env.PIMIENTA!) };
}

/* ───────────────────────── rutas ───────────────────────── */

export async function manejar(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const ruta = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const m = req.method;

  // Peticiones que cambian algo solo se aceptan desde la misma página (protección CSRF).
  if (m !== "GET" && m !== "HEAD") {
    const origen = req.headers.get("Origin");
    if (origen && origen !== url.origin) return error("Origen no permitido", 403);
  }

  const conCorreo = accesoActivo(env);
  // Sin este secreto las claves quedarían más débiles; mejor no arrancar.
  if (!conCorreo && !env.PIMIENTA) return error("El servidor no está configurado: falta el secreto PIMIENTA.", 500);

  try {
    if (conCorreo && ruta === "/estado" && m === "GET") {
      const correo = await correoVerificado(env, req);
      return json({ servidor: true, configurado: true, acceso: "correo", correo, usuario: await sesionActual(env, req) });
    }
    if (conCorreo && ruta === "/salir" && m === "POST") return json({ ok: true });
    if (conCorreo && (ruta === "/configurar" || ruta === "/ingresar" || ruta === "/clave")) return error("En esta app se ingresa con el correo, sin clave.", 404);

    if (ruta === "/estado" && m === "GET") {
      const hay = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first<{ n: number }>();
      return json({ servidor: true, configurado: (hay?.n ?? 0) > 0, usuario: await sesionActual(env, req) });
    }

    if (ruta === "/configurar" && m === "POST") {
      const d = await leerJSON<{ nombre: string; usuario: string; clave: string; codigo: string }>(req);
      if (!env.CODIGO_INSTALACION) return error("El servidor no está configurado: falta el secreto CODIGO_INSTALACION.", 500);
      if (!iguales(String(d?.codigo ?? "").trim(), env.CODIGO_INSTALACION)) return error("El código de instalación no es correcto.", 403);
      if (!d || !validarUsuario(d.usuario) || !validarClave(d.clave) || !d.nombre?.trim()) return error("Datos inválidos. El usuario es un correo o un nombre corto en minúsculas, sin espacios, y la clave mínimo 8 caracteres.");
      const { sal, hash } = await nuevoHash(env, d.clave);
      // Solo funciona si la tabla está vacía: la condición va dentro del mismo INSERT.
      const r = await env.DB.prepare(
        "INSERT INTO usuarios (usuario, nombre, hash, sal, rol, creado) SELECT ?, ?, ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM usuarios)",
      ).bind(d.usuario, d.nombre.trim(), hash, sal, ahora()).run();
      if (!r.meta.changes) return error("La app ya tiene cuentas creadas.", 409);
      return json({ ok: true }, 200, { "Set-Cookie": await crearSesion(env, req, d.usuario) });
    }

    if (ruta === "/ingresar" && m === "POST") {
      const d = await leerJSON<{ usuario: string; clave: string }>(req);
      const usuario = String(d?.usuario ?? "").trim().toLowerCase();
      const fallo = error("Usuario o clave incorrectos.", 401);
      if (!usuario || typeof d?.clave !== "string") return fallo;
      const u = await env.DB.prepare("SELECT * FROM usuarios WHERE usuario = ?").bind(usuario).first<{ usuario: string; hash: string; sal: string; activo: number; intentos: number; bloqueado_hasta: string | null }>();
      if (!u || !u.activo) {
        // Mismo tiempo de respuesta que con un usuario real, para no revelar qué usuarios existen.
        await derivar(d.clave, "AAAAAAAAAAAAAAAAAAAAAA==", env.PIMIENTA!);
        return fallo;
      }
      if (u.bloqueado_hasta && u.bloqueado_hasta > ahora()) return error(`Demasiados intentos. Espere ${MINUTOS_BLOQUEO} minutos e intente de nuevo.`, 429);
      if (!iguales(await derivar(d.clave, u.sal, env.PIMIENTA!), u.hash)) {
        const intentos = u.intentos + 1;
        await env.DB.prepare("UPDATE usuarios SET intentos = ?, bloqueado_hasta = ? WHERE usuario = ?")
          .bind(intentos >= MAX_INTENTOS ? 0 : intentos, intentos >= MAX_INTENTOS ? enMinutos(MINUTOS_BLOQUEO) : null, usuario).run();
        return fallo;
      }
      await env.DB.prepare("UPDATE usuarios SET intentos = 0, bloqueado_hasta = NULL WHERE usuario = ?").bind(usuario).run();
      return json({ ok: true }, 200, { "Set-Cookie": await crearSesion(env, req, usuario) });
    }

    if (ruta === "/salir" && m === "POST") {
      const token = cookie(req, "sesion");
      if (token) await env.DB.prepare("DELETE FROM sesiones WHERE token_hash = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, { "Set-Cookie": cookieSesion(req, null) });
    }

    // Todo lo demás exige sesión.
    const yo = await sesionActual(env, req);
    if (!yo) return error("La sesión venció. Ingrese de nuevo.", 401);

    if (ruta === "/archivos" || ruta.startsWith("/archivos/")) return await manejarArchivos(env, req, ruta, url);

    if (ruta === "/clave" && m === "POST") {
      const d = await leerJSON<{ actual: string; nueva: string }>(req);
      if (!d || !validarClave(d.nueva)) return error("La clave nueva debe tener mínimo 8 caracteres.");
      const u = await env.DB.prepare("SELECT hash, sal FROM usuarios WHERE usuario = ?").bind(yo.usuario).first<{ hash: string; sal: string }>();
      if (!u || !iguales(await derivar(String(d.actual ?? ""), u.sal, env.PIMIENTA!), u.hash)) return error("La clave actual no es correcta.", 403);
      const { sal, hash } = await nuevoHash(env, d.nueva);
      await env.DB.batch([
        env.DB.prepare("UPDATE usuarios SET hash = ?, sal = ? WHERE usuario = ?").bind(hash, sal, yo.usuario),
        env.DB.prepare("DELETE FROM sesiones WHERE usuario = ?").bind(yo.usuario),
      ]);
      return json({ ok: true }, 200, { "Set-Cookie": await crearSesion(env, req, yo.usuario) });
    }

    if (ruta === "/usuarios") {
      if (yo.rol !== "admin") return error("Solo un administrador puede gestionar usuarios.", 403);
      if (m === "GET") {
        const { results } = await env.DB.prepare("SELECT usuario, nombre, rol, activo, creado, invitado_por, invitado_en FROM usuarios ORDER BY nombre").all();
        return json({ usuarios: results });
      }
      if (m === "POST" && conCorreo) {
        const d = await leerJSON<{ usuario: string; nombre: string; rol?: string }>(req);
        const correo = String(d?.usuario ?? "").trim().toLowerCase();
        if (!d || !correo.includes("@") || !validarUsuario(correo) || !d.nombre?.trim()) return error("Revise los datos: nombre y un correo válido.");
        try {
          await env.DB.prepare("INSERT INTO usuarios (usuario, nombre, hash, sal, rol, creado, invitado_por, invitado_en) VALUES (?, ?, '', '', ?, ?, ?, ?)")
            .bind(correo, d.nombre.trim(), d.rol === "admin" ? "admin" : "usuaria", ahora(), yo.usuario, ahora()).run();
        } catch {
          return error("Ese correo ya está en la lista. Si está desactivado, actívelo.", 409);
        }
        try {
          await sincronizarGrupo(env);
        } catch (e) {
          await env.DB.prepare("DELETE FROM usuarios WHERE usuario = ?").bind(correo).run();
          return error(e instanceof Error ? e.message : "No se pudo compartir el acceso.", 502);
        }
        return json({ ok: true });
      }
      if (m === "POST") {
        const d = await leerJSON<{ usuario: string; nombre: string; clave: string; rol?: string }>(req);
        if (!d || !validarUsuario(d.usuario) || !validarClave(d.clave) || !d.nombre?.trim()) return error("Revise los datos: usuario (un correo o un nombre corto, sin espacios) y clave de mínimo 8 caracteres.");
        const { sal, hash } = await nuevoHash(env, d.clave);
        try {
          await env.DB.prepare("INSERT INTO usuarios (usuario, nombre, hash, sal, rol, creado, invitado_por, invitado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(d.usuario, d.nombre.trim(), hash, sal, d.rol === "admin" ? "admin" : "usuaria", ahora(), yo.usuario, ahora()).run();
        } catch {
          return error("Ya existe un usuario con ese nombre.", 409);
        }
        return json({ ok: true });
      }
      if (m === "PATCH") {
        const d = await leerJSON<{ usuario: string; nombre?: string; clave?: string; rol?: string; activo?: boolean }>(req);
        if (!d?.usuario) return error("Falta el usuario.");
        const u = await env.DB.prepare("SELECT rol, activo FROM usuarios WHERE usuario = ?").bind(d.usuario).first<{ rol: string; activo: number }>();
        if (!u) return error("No existe ese usuario.", 404);
        const quitaAdmin = u.rol === "admin" && u.activo && ((d.rol && d.rol !== "admin") || d.activo === false);
        if (quitaAdmin) {
          const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1").first<{ n: number }>();
          if ((n?.n ?? 0) <= 1) return error("Debe quedar al menos un administrador activo.", 409);
        }
        const sentencias: D1PreparedStatement[] = [];
        if (d.nombre?.trim()) sentencias.push(env.DB.prepare("UPDATE usuarios SET nombre = ? WHERE usuario = ?").bind(d.nombre.trim(), d.usuario));
        if (d.rol) sentencias.push(env.DB.prepare("UPDATE usuarios SET rol = ? WHERE usuario = ?").bind(d.rol === "admin" ? "admin" : "usuaria", d.usuario));
        if (d.clave !== undefined && conCorreo) return error("En esta app se ingresa con el correo, sin clave.");
        if (d.clave !== undefined) {
          if (!validarClave(d.clave)) return error("La clave debe tener mínimo 8 caracteres.");
          const { sal, hash } = await nuevoHash(env, d.clave);
          sentencias.push(env.DB.prepare("UPDATE usuarios SET hash = ?, sal = ?, intentos = 0, bloqueado_hasta = NULL WHERE usuario = ?").bind(hash, sal, d.usuario));
          sentencias.push(env.DB.prepare("DELETE FROM sesiones WHERE usuario = ?").bind(d.usuario));
        }
        if (d.activo !== undefined) {
          sentencias.push(env.DB.prepare("UPDATE usuarios SET activo = ? WHERE usuario = ?").bind(d.activo ? 1 : 0, d.usuario));
          if (!d.activo) sentencias.push(env.DB.prepare("DELETE FROM sesiones WHERE usuario = ?").bind(d.usuario));
        }
        if (sentencias.length) await env.DB.batch(sentencias);
        if (conCorreo && d.activo !== undefined && !!u.activo !== d.activo) {
          try {
            await sincronizarGrupo(env);
          } catch (e) {
            // Sin el cambio en Cloudflare la lista quedaría distinta: se deshace.
            await env.DB.prepare("UPDATE usuarios SET activo = ? WHERE usuario = ?").bind(u.activo, d.usuario).run();
            return error(e instanceof Error ? e.message : "No se pudo cambiar el acceso.", 502);
          }
        }
        return json({ ok: true });
      }
    }

    if (ruta === "/cambios" && m === "GET") return await bajarCambios(env, url);
    if (ruta === "/cambios" && m === "POST") return await subirCambios(env, req, yo);

    return error("Ruta no encontrada", 404);
  } catch (e) {
    console.error(e);
    return error("Error interno del servidor.", 500);
  }
}

/** El grupo de Cloudflare Access queda con los correos de los usuarios activos. */
async function sincronizarGrupo(env: Env) {
  const { results } = await env.DB.prepare("SELECT usuario FROM usuarios WHERE activo = 1 AND usuario LIKE '%@%' ORDER BY usuario").all<{ usuario: string }>();
  await actualizarGrupo(env, results.map((r) => r.usuario));
}

/* ───────────────────────── sincronización ───────────────────────── */

/**
 * Devuelve los registros cambiados después del cursor (versión + clave, porque al vaciar
 * una tabla muchos registros comparten la misma versión). El JSON de cada registro se
 * copia tal cual, sin interpretarlo, para gastar poca CPU.
 */
async function bajarCambios(env: Env, url: URL): Promise<Response> {
  const v = Number(url.searchParams.get("v") ?? 0) || 0;
  const k = url.searchParams.get("k") ?? "";
  const limite = Math.min(300, Math.max(1, Number(url.searchParams.get("limite") ?? 200)));
  const { results } = await env.DB.prepare(
    `SELECT tabla, clave, datos, version, borrado FROM registros
     WHERE version > ?1 OR (version = ?1 AND (tabla || char(31) || clave) > ?2)
     ORDER BY version, tabla, clave LIMIT ?3`,
  ).bind(v, k, limite).all<{ tabla: string; clave: string; datos: string | null; version: number; borrado: number }>();
  const ultimo = results[results.length - 1];
  const partes = results.map((r) => `{"t":${JSON.stringify(r.tabla)},"c":${JSON.stringify(r.clave)},"d":${r.borrado || r.datos === null ? "null" : JSON.stringify(r.datos)}}`);
  const cursor = ultimo ? { v: ultimo.version, k: `${ultimo.tabla}\u001f${ultimo.clave}` } : { v, k };
  return new Response(`{"cambios":[${partes.join(",")}],"cursor":${JSON.stringify(cursor)},"mas":${results.length === limite}}`, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

type Operacion = { op: "put"; t: string; c: string; d: string } | { op: "del"; t: string; c: string } | { op: "vaciar"; t: string };

/**
 * Guarda un lote de cambios en una sola transacción: cada operación toma la siguiente
 * versión del contador y el contador avanza al final. Así ningún cambio queda "atrás"
 * de otro que otro equipo ya descargó.
 */
async function subirCambios(env: Env, req: Request, yo: Usuario): Promise<Response> {
  const d = await leerJSON<{ ops: Operacion[] }>(req);
  if (!d || !Array.isArray(d.ops) || d.ops.length === 0) return error("Lote vacío.");
  if (d.ops.length > MAX_OPERACIONES) return error("Lote demasiado grande.", 413);
  const cuando = ahora();
  const sentencias: D1PreparedStatement[] = [];
  // Se valida todo el lote antes de escribir: o entra completo o no entra nada.
  for (const o of d.ops) {
    if (!o || !TABLAS.has(o.t)) return error(`Tabla no permitida: ${String(o?.t)}`);
    if (o.op !== "vaciar" && (typeof o.c !== "string" || !o.c || o.c.length > 500)) return error("Clave de registro inválida.");
    if (o.op === "put" && (typeof o.d !== "string" || o.d.length > MAX_DATOS)) return error("Registro inválido o demasiado grande.", 413);
    if (o.op !== "put" && o.op !== "del" && o.op !== "vaciar") return error("Operación desconocida.");
    // Eliminar afiliados o reemplazar una tabla entera (importar la base, borrar todo) es solo de administradores.
    if (yo.rol !== "admin" && (o.op === "vaciar" || (o.op === "del" && o.t === "afiliados"))) {
      return error("Solo un administrador puede eliminar afiliados o reemplazar la base.", 403);
    }
  }
  const upsert = `INSERT INTO registros (tabla, clave, datos, version, borrado, autor, actualizado)
    VALUES (?1, ?2, ?3, (SELECT valor FROM contador WHERE id = 1) + ?4, ?5, ?6, ?7)
    ON CONFLICT (tabla, clave) DO UPDATE SET datos = excluded.datos, version = excluded.version,
      borrado = excluded.borrado, autor = excluded.autor, actualizado = excluded.actualizado`;
  d.ops.forEach((o, i) => {
    const n = i + 1;
    if (o.op === "put") {
      sentencias.push(env.DB.prepare(upsert).bind(o.t, o.c, o.d, n, 0, yo.usuario, cuando));
    } else if (o.op === "del") {
      sentencias.push(env.DB.prepare(upsert).bind(o.t, o.c, null, n, 1, yo.usuario, cuando));
    } else {
      sentencias.push(env.DB.prepare(
        "UPDATE registros SET datos = NULL, borrado = 1, version = (SELECT valor FROM contador WHERE id = 1) + ?1, autor = ?2, actualizado = ?3 WHERE tabla = ?4 AND borrado = 0",
      ).bind(n, yo.usuario, cuando, o.t));
    }
  });
  sentencias.push(env.DB.prepare("UPDATE contador SET valor = valor + ? WHERE id = 1").bind(d.ops.length));
  await env.DB.batch(sentencias);
  return json({ ok: true });
}
