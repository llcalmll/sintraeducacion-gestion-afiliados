import { useSyncExternalStore } from "react";
import { activarSincronizacion, borrarCopiaLocal, detenerSincronizacion, hayPendientes, sincronizarAhora } from "./sincronizacion";

/*
 * Dos modos:
 * - "servidor": la app publicada (Cloudflare). Usuario y clave reales, datos compartidos.
 * - "local": la demo con `npm run dev`. Login simulado y datos solo en este navegador.
 * Se detecta preguntando a /api/estado al arrancar.
 */

export interface Usuario { usuario: string; nombre: string; rol: "admin" | "usuaria" }
export interface EstadoApp {
  modo: "cargando" | "local" | "servidor";
  /** En modo servidor: si ya existe al menos una cuenta. */
  configurado: boolean;
  usuario: Usuario | null;
  /** Aviso para mostrar en la pantalla de ingreso (por ejemplo, sesión vencida). */
  aviso?: string;
  /** En modo servidor: "correo" si Cloudflare Access verifica el correo con un PIN; "clave" si hay usuario y clave. */
  acceso?: "clave" | "correo";
  /** Correo que verificó Cloudflare Access (aunque no tenga acceso a la app). */
  correo?: string | null;
}

/** Cierra la sesión de Cloudflare Access y vuelve a pedir el correo. */
export const SALIR_ACCESS = "/cdn-cgi/access/logout";

const CLAVE_LOCAL = "sintra-sesion";
export const USUARIO_DEMO = { usuario: "admin", clave: "demo", nombre: "Usuario de demostración" };

let estado: EstadoApp = { modo: "cargando", configurado: true, usuario: null };
const oyentes = new Set<() => void>();
function poner(e: EstadoApp) {
  estado = e;
  oyentes.forEach((f) => f());
}
export const useEstadoApp = () => useSyncExternalStore((f) => (oyentes.add(f), () => oyentes.delete(f)), () => estado);
/** Nombre de quien inició sesión, o null. */
export const useSesion = () => useEstadoApp().usuario?.nombre ?? null;
/** Administrador: crea cuentas, elimina afiliados y reemplaza la base. En la versión local de demostración, siempre. */
export const useEsAdmin = () => { const e = useEstadoApp(); return e.modo !== "servidor" || e.usuario?.rol === "admin"; };
export const leerEstadoApp = () => estado;

function leerLocal(): Usuario | null {
  try {
    const n = sessionStorage.getItem(CLAVE_LOCAL);
    return n ? { usuario: USUARIO_DEMO.usuario, nombre: n, rol: "admin" } : null;
  } catch {
    return null;
  }
}

async function api<T>(ruta: string, cuerpo?: unknown): Promise<{ ok: boolean; datos: T & { error?: string } }> {
  const r = await fetch(ruta, {
    redirect: "manual",
    method: cuerpo === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const datos = await r.json().catch(() => ({ error: "Respuesta inválida del servidor." }));
  return { ok: r.ok, datos };
}

function sesionVencida() {
  detenerSincronizacion();
  poner({
    ...estado,
    usuario: null,
    aviso: estado.acceso === "correo"
      ? "Su sesión venció. Oprima Continuar para ingresar de nuevo con su correo: los cambios que no se habían enviado siguen guardados en este equipo."
      : "Su sesión venció. Ingrese de nuevo: los cambios que no se habían enviado siguen guardados en este equipo.",
  });
}

function conUsuario(usuario: Usuario | null) {
  poner({ ...estado, usuario, aviso: undefined });
  if (usuario && estado.modo === "servidor") activarSincronizacion(sesionVencida);
}

/** Detecta el modo y si ya hay una sesión abierta. */
export async function iniciarApp() {
  try {
    const r = await fetch("/api/estado", { credentials: "same-origin" });
    const d = (await r.json()) as { servidor?: boolean; configurado: boolean; usuario: Usuario | null; error?: string; acceso?: "correo"; correo?: string | null };
    if (!d?.servidor) {
      if (d?.error && !import.meta.env.DEV) return poner({ modo: "servidor", configurado: true, usuario: null, aviso: d.error });
      throw new Error();
    }
    poner({ modo: "servidor", configurado: d.configurado, usuario: null, acceso: d.acceso ?? "clave", correo: d.correo ?? null });
    conUsuario(d.usuario);
  } catch {
    // El modo demo (login simulado) solo existe con `npm run dev`. En la app publicada, si el
    // servidor no responde no se entra: el usuario de demo no puede abrir datos guardados en el PC.
    if (import.meta.env.DEV) poner({ modo: "local", configurado: true, usuario: leerLocal() });
    else poner({ modo: "servidor", configurado: true, usuario: null, aviso: "No hay conexión con el servidor. Revise el internet y vuelva a cargar la página." });
  }
}

/** Devuelve un mensaje de error, o null si ingresó. */
export async function ingresar(usuario: string, clave: string): Promise<string | null> {
  if (estado.modo === "local") {
    if (usuario.trim().toLowerCase() !== USUARIO_DEMO.usuario || clave !== USUARIO_DEMO.clave) return "Usuario o clave incorrectos.";
    try { sessionStorage.setItem(CLAVE_LOCAL, USUARIO_DEMO.nombre); } catch { /* la sesión dura lo que la pestaña */ }
    conUsuario(leerLocal() ?? { usuario: "admin", nombre: USUARIO_DEMO.nombre, rol: "admin" });
    return null;
  }
  try {
    const r = await api<{ ok: boolean }>("/api/ingresar", { usuario: usuario.trim().toLowerCase(), clave });
    if (!r.ok) return r.datos.error ?? "No se pudo ingresar.";
    const e = await api<{ usuario: Usuario }>("/api/estado");
    conUsuario(e.datos.usuario);
    return null;
  } catch {
    return "No hay conexión con el servidor. Revise el internet e intente de nuevo.";
  }
}

/** Crea la primera cuenta (administrador) en una app recién publicada. */
export async function configurarAdmin(nombre: string, usuario: string, clave: string, codigo: string): Promise<string | null> {
  try {
    const r = await api("/api/configurar", { nombre, usuario: usuario.trim().toLowerCase(), clave, codigo });
    if (!r.ok) return r.datos.error ?? "No se pudo crear la cuenta.";
    const e = await api<{ usuario: Usuario }>("/api/estado");
    poner({ ...estado, configurado: true });
    conUsuario(e.datos.usuario);
    return null;
  } catch {
    return "No hay conexión con el servidor.";
  }
}

/**
 * Cierra la sesión. En modo servidor intenta enviar lo pendiente y borra la copia local,
 * por si el PC es compartido. Si quedan cambios sin enviar, devuelve un aviso y no sale.
 */
export async function salir(forzar = false): Promise<string | null> {
  if (estado.modo === "local") {
    try { sessionStorage.removeItem(CLAVE_LOCAL); } catch { /* nada */ }
    poner({ ...estado, usuario: null });
    return null;
  }
  await sincronizarAhora();
  if (hayPendientes() && !forzar) return "Hay cambios que todavía no se han enviado al servidor (¿sin internet?). Si sale ahora se perderán.";
  detenerSincronizacion();
  await fetch("/api/salir", { method: "POST", credentials: "same-origin", redirect: "manual" }).catch(() => {});
  await borrarCopiaLocal();
  if (estado.acceso === "correo") {
    location.href = SALIR_ACCESS;
    return null;
  }
  poner({ ...estado, usuario: null });
  return null;
}
