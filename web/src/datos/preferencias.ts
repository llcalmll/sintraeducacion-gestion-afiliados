import { useSyncExternalStore } from "react";

// Preferencias por PC. Se guardan en localStorage y, si el navegador no lo permite,
// duran lo que dure la pestaña.
const oyentes = new Set<() => void>();
const memoria = new Map<string, string>();

function leer(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return memoria.get(k) ?? null;
  }
}

function escribir(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    memoria.set(k, v);
  }
  oyentes.forEach((f) => f());
}

function usar(k: string): string | null {
  return useSyncExternalStore((f) => (oyentes.add(f), () => oyentes.delete(f)), () => leer(k));
}

/** Modo demo: muestra los pendientes para la reunión. Apagado, la app se ve como producto final. */
export const useModoDemo = () => usar("modo-demo") === "1";
export const ponerModoDemo = (v: boolean) => escribir("modo-demo", v ? "1" : "0");

export const MENSAJE_POR_DEFECTO =
  "Hola {nombre}, le escribimos de SINTRAEDUCACIÓN. En la nómina de {mes} no aparece el descuento de su cuota sindical. ¿Nos ayuda a revisarlo? Quedamos atentos.";

export const useMensajeWhatsApp = () => usar("mensaje-whatsapp") ?? MENSAJE_POR_DEFECTO;
export const ponerMensajeWhatsApp = (v: string) => escribir("mensaje-whatsapp", v);

const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());

/**
 * Nombre para el saludo. La base trae APELLIDOS NOMBRES: con 4 palabras o más el tercero es
 * el primer nombre ("PRUEBA EJEMPLO ANA LUCIA" -> "ANA"). Con 3 no se sabe si hay uno o
 * dos apellidos, así que se usa el nombre completo.
 */
export function primerNombre(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  return titulo(p.length >= 4 ? p[2] : p.join(" "));
}

export function enlaceWhatsApp(celular: string, texto: string): string | null {
  const tel = celular.replace(/\D/g, "");
  if (tel.length !== 10) return null;
  return `https://wa.me/57${tel}?text=${encodeURIComponent(texto)}`;
}

/** Asistente de IA: activado por defecto. Sin clave de OpenAI funciona en modo básico. */
export const useIAActiva = () => usar("ia-activa") !== "0";
export const ponerIAActiva = (v: boolean) => escribir("ia-activa", v ? "1" : "0");

/** Modelo elegido en Configuración. Vacío = el servidor elige el "mini" más reciente. */
export const useModeloIA = () => usar("ia-modelo") ?? "";
export const leerModeloIA = () => leer("ia-modelo") ?? "";
export const ponerModeloIA = (v: string) => escribir("ia-modelo", v);

/** Abre el panel del asistente desde cualquier parte de la app. */
export const useAsistenteAbierto = () => usar("ia-panel") === "1";
export const abrirAsistente = (v = true) => {
  escribir("ia-panel", v ? "1" : "0");
};

/** Apariencia: claro (por defecto), oscuro o automático según el sistema. */
export type Tema = "claro" | "oscuro" | "auto";
export const useTema = (): Tema => (usar("tema") as Tema | null) ?? "claro";

export function aplicarTema() {
  const t = (leer("tema") as Tema | null) ?? "claro";
  const oscuro = t === "oscuro" || (t === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.tema = oscuro ? "oscuro" : "claro";
}

export function ponerTema(t: Tema) {
  escribir("tema", t);
  aplicarTema();
}

/** true si en este momento se ve oscuro (incluye "automático" con el sistema en oscuro). */
export const useOscuro = () => {
  useTema();
  return document.documentElement.dataset.tema === "oscuro";
};
