import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { accesoExterno } from "./servidor/acceso";
import { intermediarioIA } from "./servidor/ia";

const TIPOS: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
};

/**
 * Sirve los archivos reales de demo-data/ en /__demo/ SOLO con `npm run dev`.
 * No se copian al build, así que nunca quedan publicados si la app se despliega.
 * Soporta Range para que el video se pueda adelantar.
 */
function datosDemo(): Plugin {
  const dir = path.resolve(__dirname, "demo-data");
  return {
    name: "datos-demo",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__demo", (req, res, next) => {
        const nombre = path.basename(decodeURIComponent((req.url ?? "").split("?")[0]));
        const archivo = path.join(dir, nombre);
        if (!nombre || !existsSync(archivo)) return next();
        const tam = statSync(archivo).size;
        res.setHeader("Content-Type", TIPOS[path.extname(nombre).toLowerCase()] ?? "application/octet-stream");
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-store");
        const rango = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
        if (rango) {
          const ini = rango[1] ? Number(rango[1]) : 0;
          const fin = rango[2] ? Math.min(Number(rango[2]), tam - 1) : tam - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${ini}-${fin}/${tam}`);
          res.setHeader("Content-Length", fin - ini + 1);
          if (req.method === "HEAD") return res.end();
          return createReadStream(archivo, { start: ini, end: fin }).pipe(res);
        }
        res.setHeader("Content-Length", tam);
        if (req.method === "HEAD") return res.end();
        createReadStream(archivo).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [accesoExterno(__dirname), react(), datosDemo(), intermediarioIA(__dirname)],
  // officecrypto-tool (abrir Excel con contraseña) está hecho para Node: en el navegador usa estas dos piezas pequeñas.
  resolve: {
    alias: [
      { find: /^crypto$/, replacement: path.resolve(__dirname, "src/logica/descifrado/crypto-navegador.ts") },
      { find: /^xml2js$/, replacement: path.resolve(__dirname, "src/logica/descifrado/xml2js-navegador.ts") },
    ],
  },
  // Permite abrir la demo por un túnel de Cloudflare; quien entra por ahí debe dar la clave de acceso.
  server: { port: 5180, allowedHosts: [".trycloudflare.com"] },
});
