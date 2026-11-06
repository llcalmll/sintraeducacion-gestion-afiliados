/// <reference types="@cloudflare/workers-types" />
/**
 * Ingreso con Cloudflare Access (Zero Trust): la persona escribe su correo, Cloudflare le envía un PIN
 * y solo deja pasar a los correos de un grupo. La app recibe un JWT firmado por Cloudflare con el correo
 * verificado; aquí se valida y la app decide los permisos con su propia tabla de usuarios.
 *
 * El grupo de Cloudflare se mantiene igual a la lista de usuarios activos de la app, así que compartir
 * o quitar el acceso desde la app basta: Cloudflare deja de enviarle el PIN a quien no está.
 *
 * Documentación: developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface EnvAcceso {
  /** Nombre del equipo de Zero Trust (https://<equipo>.cloudflareaccess.com). Si falta, la app usa usuario y clave. */
  ACCESS_EQUIPO?: string;
  /** "Application Audience (AUD) Tag" de la aplicación de Access. */
  ACCESS_AUD?: string;
  /** Id del grupo de Access con los correos permitidos. */
  ACCESS_GRUPO?: string;
  /** Id de la aplicación de Access (se vuelve a guardar para que Cloudflare relea el grupo). */
  ACCESS_APP?: string;
  /** Id de la cuenta de Cloudflare. */
  CF_CUENTA?: string;
  /** Llave con permisos de Access para mantener el grupo. */
  CF_API_TOKEN?: string;
  /** Solo para pruebas locales: dónde están las llaves públicas y la API. */
  ACCESS_CERTS_URL?: string;
  CF_API_URL?: string;
}

export const accesoActivo = (env: EnvAcceso) => !!(env.ACCESS_EQUIPO && env.ACCESS_AUD);

const emisor = (env: EnvAcceso) => `https://${env.ACCESS_EQUIPO}.cloudflareaccess.com`;

const deB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

// Llaves públicas de Cloudflare en memoria (Cloudflare las rota cada cierto tiempo).
let llaves: { url: string; hasta: number; porKid: Map<string, CryptoKey> } | null = null;

async function llavePara(env: EnvAcceso, kid: string, forzar = false): Promise<CryptoKey | undefined> {
  const url = env.ACCESS_CERTS_URL || `${emisor(env)}/cdn-cgi/access/certs`;
  if (forzar || !llaves || llaves.url !== url || llaves.hasta < Date.now()) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudieron leer las llaves de Access (${r.status})`);
    const { keys } = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] };
    const porKid = new Map<string, CryptoKey>();
    for (const k of keys ?? []) {
      porKid.set(k.kid, await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
    }
    llaves = { url, hasta: Date.now() + 3_600_000, porKid };
  }
  return llaves.porKid.get(kid);
}

/** Correo verificado por Cloudflare Access, o null si el token falta o no es válido. */
export async function correoVerificado(env: EnvAcceso, req: Request): Promise<string | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const cabecera = JSON.parse(new TextDecoder().decode(deB64url(partes[0]))) as { alg: string; kid: string };
    if (cabecera.alg !== "RS256") return null;
    // Si el kid no está, puede ser una llave nueva: se recarga una vez.
    const llave = (await llavePara(env, cabecera.kid)) ?? (await llavePara(env, cabecera.kid, true));
    if (!llave) return null;
    const firmaOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", llave, deB64url(partes[2]), new TextEncoder().encode(`${partes[0]}.${partes[1]}`));
    if (!firmaOk) return null;
    const p = JSON.parse(new TextDecoder().decode(deB64url(partes[1]))) as { aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string };
    const ahora = Date.now() / 1000;
    const auds = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!auds.includes(env.ACCESS_AUD)) return null;
    if (p.iss !== emisor(env)) return null;
    if (!p.exp || p.exp < ahora - 30) return null;
    if (p.nbf && p.nbf > ahora + 30) return null;
    return typeof p.email === "string" && p.email.includes("@") ? p.email.trim().toLowerCase() : null;
  } catch (e) {
    console.error("JWT de Access inválido", e);
    return null;
  }
}

/** Deja el grupo de Access con exactamente estos correos. */
export async function actualizarGrupo(env: EnvAcceso, correos: string[]): Promise<void> {
  if (!env.CF_API_TOKEN || !env.CF_CUENTA || !env.ACCESS_GRUPO) throw new Error("Falta configurar la llave de Cloudflare para compartir accesos.");
  if (!correos.length) throw new Error("El grupo de acceso no puede quedar vacío.");
  const base = env.CF_API_URL || "https://api.cloudflare.com/client/v4";
  const r = await fetch(`${base}/accounts/${env.CF_CUENTA}/access/groups/${env.ACCESS_GRUPO}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Sintraeducación - usuarios", include: correos.map((email) => ({ email: { email } })) }),
  });
  if (!r.ok) throw new Error(`Cloudflare no aceptó el cambio de accesos: ${await errores(r)}`);
  if (env.ACCESS_APP) await refrescarApp(env, base);
}

async function errores(r: Response) {
  const d = (await r.json().catch(() => ({}))) as { errors?: { message: string }[] };
  return d.errors?.map((e) => e.message).join("; ") || String(r.status);
}

/**
 * Cloudflare puede seguir usando la lista anterior para decidir a quién enviarle el PIN hasta que
 * la aplicación cambia (pasó en producción el 2026-10-10). Volver a guardarla, igual, hace que la relea.
 */
async function refrescarApp(env: EnvAcceso, base: string) {
  const url = `${base}/accounts/${env.CF_CUENTA}/access/apps/${env.ACCESS_APP}`;
  const h = { Authorization: `Bearer ${env.CF_API_TOKEN}`, "Content-Type": "application/json" };
  const g = await fetch(url, { headers: h });
  if (!g.ok) throw new Error(`No se pudo leer la aplicación de acceso: ${await errores(g)}`);
  type Politica = { id: string; name: string; decision: string; include: unknown[]; exclude?: unknown[]; require?: unknown[] };
  const app = ((await g.json()) as { result: Record<string, unknown> & { policies?: Politica[] } }).result;
  const cuerpo = {
    name: app.name, type: app.type, domain: app.domain, destinations: app.destinations, session_duration: app.session_duration,
    allowed_idps: app.allowed_idps, auto_redirect_to_identity: app.auto_redirect_to_identity, app_launcher_visible: app.app_launcher_visible,
    policies: (app.policies ?? []).map((p, i) => ({ id: p.id, name: p.name, decision: p.decision, include: p.include, exclude: p.exclude, require: p.require, precedence: i + 1 })),
  };
  const r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error(`No se pudo actualizar la aplicación de acceso: ${await errores(r)}`);
}
