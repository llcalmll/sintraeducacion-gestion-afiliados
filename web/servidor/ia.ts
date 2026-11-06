import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin } from "vite";

/**
 * Intermediario del asistente de IA. Guarda la clave de OpenAI del lado del servidor:
 * el navegador nunca la ve. En producción esta misma lógica va en el Worker de Cloudflare.
 *
 *   GET  /__ia/estado  -> { configurada, modelo, modelos }
 *   POST /__ia/chat    -> reenvía { messages, tools, modelo } a /v1/chat/completions
 *
 * La clave se lee de web/.env.local (OPENAI_API_KEY) en cada petición, así que se puede
 * crear o cambiar el archivo sin reiniciar el servidor.
 */

const PREFERIDOS = ["gpt-5-mini", "gpt-5.1-mini", "gpt-4.1-mini", "gpt-4o-mini"];
const NO_CHAT = /audio|realtime|transcribe|tts|image|search|embedding|moderation|whisper|dall-e|davinci|babbage|instruct|codex|computer/i;

let cache: { clave: string; modelos: string[]; en: number } | null = null;

function config(dir: string) {
  const env = loadEnv("development", dir, "");
  return { clave: (env.OPENAI_API_KEY ?? "").trim(), modelo: (env.OPENAI_MODEL ?? "").trim() };
}

async function modelosDisponibles(clave: string): Promise<string[]> {
  if (cache && cache.clave === clave && Date.now() - cache.en < 10 * 60_000) return cache.modelos;
  const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${clave}` } });
  if (!r.ok) throw new ErrorIA(r.status, await r.text());
  const datos = (await r.json()) as { data: { id: string }[] };
  const modelos = datos.data.map((m) => m.id).filter((id) => /^(gpt-|o\d)/.test(id) && !NO_CHAT.test(id)).sort();
  cache = { clave, modelos, en: Date.now() };
  return modelos;
}

function elegirModelo(modelos: string[], pedido?: string, deEnv?: string): string {
  if (pedido && modelos.includes(pedido)) return pedido;
  if (deEnv) return deEnv;
  return PREFERIDOS.find((m) => modelos.includes(m)) ?? modelos.filter((m) => /^gpt-.*mini$/.test(m)).sort().reverse()[0] ?? modelos[0] ?? "gpt-4o-mini";
}

class ErrorIA extends Error {
  constructor(public estado: number, public detalle: string) {
    super(detalle);
  }
}

function mensajeError(e: unknown): { estado: number; mensaje: string } {
  if (e instanceof ErrorIA) {
    if (e.estado === 401) return { estado: 401, mensaje: "La clave de OpenAI no es válida. Revise el archivo .env.local." };
    if (e.estado === 429) return { estado: 429, mensaje: "OpenAI no respondió por límite de uso o falta de saldo en la cuenta." };
    if (e.estado === 404) return { estado: 404, mensaje: "El modelo elegido no está disponible para esta clave." };
    return { estado: e.estado, mensaje: `OpenAI respondió con un error (${e.estado}).` };
  }
  return { estado: 502, mensaje: "No hay conexión con OpenAI. Revise el internet del equipo." };
}

function json(res: ServerResponse, estado: number, cuerpo: unknown) {
  res.statusCode = estado;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(cuerpo));
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > 2_000_000) throw new Error("Petición demasiado grande");
    partes.push(p as Buffer);
  }
  return Buffer.concat(partes).toString("utf8");
}

export function intermediarioIA(dir: string): Plugin {
  return {
    name: "intermediario-ia",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__ia", async (req, res) => {
        const { clave, modelo: deEnv } = config(dir);
        const ruta = (req.url ?? "").split("?")[0];

        if (ruta === "/estado" && req.method === "GET") {
          if (!clave) return json(res, 200, { configurada: false, modelo: null, modelos: [] });
          try {
            const modelos = await modelosDisponibles(clave);
            return json(res, 200, { configurada: true, modelo: elegirModelo(modelos, undefined, deEnv), modelos });
          } catch (e) {
            const { mensaje } = mensajeError(e);
            return json(res, 200, { configurada: true, modelo: null, modelos: [], error: mensaje });
          }
        }

        if (ruta === "/chat" && req.method === "POST") {
          if (!clave) return json(res, 400, { error: "No hay clave de OpenAI. Cree el archivo web/.env.local (vea .env.local.example)." });
          try {
            const pedido = JSON.parse(await leerCuerpo(req)) as { messages: unknown[]; tools?: unknown[]; modelo?: string };
            if (!Array.isArray(pedido.messages) || pedido.messages.length > 80) return json(res, 400, { error: "Conversación inválida o demasiado larga." });
            const modelos = await modelosDisponibles(clave).catch(() => [] as string[]);
            const modelo = elegirModelo(modelos, pedido.modelo, deEnv);
            const r = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: modelo, messages: pedido.messages, tools: pedido.tools, tool_choice: pedido.tools?.length ? "auto" : undefined }),
            });
            if (!r.ok) throw new ErrorIA(r.status, await r.text());
            const datos = await r.json();
            return json(res, 200, { ...datos, modelo });
          } catch (e) {
            const { estado, mensaje } = mensajeError(e);
            server.config.logger.warn(`[ia] ${mensaje}`);
            return json(res, estado, { error: mensaje });
          }
        }

        json(res, 404, { error: "Ruta no encontrada" });
      });
    },
  };
}
