import { timingSafeEqual } from "node:crypto";
import { loadEnv, type Plugin } from "vite";

/**
 * Clave para quien entra desde afuera por un túnel (Cloudflare agrega la cabecera cf-ray).
 * En localhost no se pide nada. Si ACCESO_CLAVE no está en .env.local, el acceso externo
 * queda cerrado: así un túnel abierto por error no expone la demo.
 *
 * Usuario: tester · Clave: ACCESO_CLAVE de web/.env.local
 */
export function accesoExterno(dir: string): Plugin {
  return {
    name: "acceso-externo",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const externo = !!(req.headers["cf-ray"] || req.headers["cf-connecting-ip"]);
        if (!externo) return next();
        const clave = (loadEnv("development", dir, "").ACCESO_CLAVE ?? "").trim();
        if (!clave) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          return res.end("Acceso externo deshabilitado.");
        }
        const [tipo, valor] = (req.headers.authorization ?? "").split(" ");
        const [usuario, ...resto] = tipo === "Basic" && valor ? Buffer.from(valor, "base64").toString("utf8").split(":") : [];
        const dada = Buffer.from(resto.join(":"));
        const esperada = Buffer.from(clave);
        if (usuario === "tester" && dada.length === esperada.length && timingSafeEqual(dada, esperada)) return next();
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="Sintraeducacion demo", charset="UTF-8"');
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Se requiere usuario y clave de acceso.");
      });
    },
  };
}
