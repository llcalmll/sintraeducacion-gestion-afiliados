import { fechaLarga, hoyISO } from "../logica/fechas";
import { DEFINICIONES, ejecutar, type Bloque, type Contexto } from "./herramientas";

/** Mensajes en el formato de Chat Completions de OpenAI. */
export type MensajeIA =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LlamadaHerramienta[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface LlamadaHerramienta {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type Evento =
  | { tipo: "texto"; texto: string }
  | { tipo: "bloque"; bloque: Bloque }
  | { tipo: "herramienta"; nombre: string };

export class ErrorAsistente extends Error {}

export function instrucciones(): string {
  return `Usted es el asistente de la app de afiliados de SINTRAEDUCACIÓN (sindicato de trabajadores de la educación del Tolima, Colombia).
Lo usan secretarias con poca experiencia en tecnología. Hoy es ${fechaLarga(hoyISO())}.

CÓMO HABLAR
- Español de Colombia, trato de usted, frases cortas y amables. Máximo unas 80 palabras por respuesta.
- Sin tecnicismos: no diga "cruce", "base de datos relacional", "API" ni "herramienta". Diga "comparé el archivo con la base".
- Termine con lo que conviene hacer ahora, en 1 a 3 viñetas cortas.

REGLAS
1. Nunca invente cifras, nombres ni resultados: toda cifra sale de una herramienta. Si no hay datos, dígalo.
2. Por privacidad usted no ve nombres, cédulas ni celulares. Las herramientas muestran a las personas en la pantalla, debajo de su mensaje. Diga "las personas que le muestro abajo" en vez de nombrarlas. No pida que le dicten datos personales salvo para llenar un formulario.
3. Si el usuario adjuntó archivos, llame primero a subir_reportes_adjuntos.
4. Para saludar o si preguntan qué hay pendiente, use resumen_del_dia.
5. Crear eventos y cambiar el mensaje de WhatsApp piden confirmación en la app; no la vuelva a pedir usted.
6. Afiliar a alguien: use abrir_formulario_afiliacion con los datos que le den; la secretaria revisa y guarda.
7. Usted no envía mensajes: los botones de WhatsApp de la pantalla abren el chat con el mensaje listo y la secretaria lo envía.

QUÉ HACER EN CADA CASO (después de subir el archivo del mes)
- No les descontaron: escribirles por WhatsApp con el botón; preguntar si cambiaron de colegio o entidad, si están en licencia o si pagaduría cometió un error. Luego marcar "Contactada" o "Resuelto".
- Dos meses o más sin descuento: empezar por esas personas; puede que hayan salido de nómina. Confirmar si siguen afiliadas.
- Retirados a los que les siguen descontando: confirmar el retiro, pedir la novedad de retiro en pagaduría y revisar si hay que devolver el dinero.
- Descontados que no están en la base: puede ser una afiliación sin registrar; buscar el formulario y agregarla con "Agregar afiliado".
- Afiliación en trámite: es normal; esperar al próximo mes.
- Ahorro del viaje a San Andrés (en los datos, cuota_extraordinaria): se informa aparte, no requiere acción.
- Si falta el reporte de una entidad, recordar que sin él esas personas no se pueden revisar.

DATOS DE CONTEXTO
- Cada mes llegan hasta 3 reportes: Secretaría de Educación de Ibagué (.xls), Secretaría de Educación del Tolima (.xlsx) y Alcaldía de Ibagué (.pdf).
- Las alcaldías de Venadillo y Santa Isabel y la Personería de Falán todavía no envían reporte.`;
}

/**
 * Un turno del agente: llama al modelo, ejecuta las herramientas que pida y repite
 * hasta que responda con texto. Devuelve el historial nuevo para la próxima pregunta.
 */
export async function turnoAgente(historial: MensajeIA[], ctx: Contexto, modelo: string, alEvento: (e: Evento) => void): Promise<MensajeIA[]> {
  const mensajes = [...historial];
  for (let vuelta = 0; vuelta < 8; vuelta++) {
    const r = await fetch("/__ia/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: mensajes, tools: DEFINICIONES, modelo: modelo || undefined }),
    }).catch(() => null);
    if (!r) throw new ErrorAsistente("No hay conexión con el servidor de la app.");
    const datos = await r.json().catch(() => ({ error: "Respuesta inválida del servidor." }));
    if (!r.ok || datos.error) throw new ErrorAsistente(typeof datos.error === "string" ? datos.error : datos.error?.message ?? "Error del asistente.");

    const msg = datos.choices?.[0]?.message as { content: string | null; tool_calls?: LlamadaHerramienta[] } | undefined;
    if (!msg) throw new ErrorAsistente("El asistente no respondió.");
    mensajes.push({ role: "assistant", content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (msg.content?.trim()) alEvento({ tipo: "texto", texto: msg.content.trim() });
    if (!msg.tool_calls?.length) return mensajes;

    for (const llamada of msg.tool_calls) {
      alEvento({ tipo: "herramienta", nombre: llamada.function.name });
      let contenido: string;
      try {
        const args = JSON.parse(llamada.function.arguments || "{}") as Record<string, unknown>;
        const res = await ejecutar(llamada.function.name, args, ctx);
        res.bloques?.forEach((bloque) => alEvento({ tipo: "bloque", bloque }));
        contenido = JSON.stringify(res.paraIA);
      } catch (e) {
        contenido = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
      mensajes.push({ role: "tool", tool_call_id: llamada.id, content: contenido });
    }
  }
  alEvento({ tipo: "texto", texto: "Hice varias consultas seguidas y me detuve para no demorarme. ¿Me repite lo que necesita?" });
  return mensajes;
}

export interface EstadoIA {
  configurada: boolean;
  modelo: string | null;
  modelos: string[];
  error?: string;
}

export async function consultarEstado(): Promise<EstadoIA> {
  try {
    const r = await fetch("/__ia/estado");
    if (!r.ok) throw new Error();
    return (await r.json()) as EstadoIA;
  } catch {
    return { configurada: false, modelo: null, modelos: [], error: "El servidor de la app no tiene el asistente disponible (solo funciona con npm run dev)." };
  }
}
