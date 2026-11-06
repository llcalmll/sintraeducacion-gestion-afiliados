/*
 * Lo poco del módulo "crypto" de Node que necesita officecrypto-tool para abrir archivos de Excel con contraseña, hecho
 * para el navegador. vite.config.ts lo pone en lugar de "crypto". Solo descifra: la app nunca cifra archivos.
 */
import { cbc, ecb } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { Buffer } from "buffer";

const HASHES = { md5, sha1, sha256, sha384, sha512 };
type NombreHash = keyof typeof HASHES;
type Datos = string | Uint8Array;

function hashDe(nombre: string) {
  const h = HASHES[nombre.toLowerCase().replace("-", "") as NombreHash];
  if (!h) throw new Error(`Algoritmo no disponible: ${nombre}`);
  return h;
}
const aBytes = (d: Datos): Uint8Array => (typeof d === "string" ? Buffer.from(d, "utf8") : d);

class Resumen {
  private partes: Uint8Array[] = [];
  private calcular: (datos: Uint8Array) => Uint8Array;
  constructor(calcular: (datos: Uint8Array) => Uint8Array) { this.calcular = calcular; }
  update(d: Datos) { this.partes.push(aBytes(d)); return this; }
  digest() { return Buffer.from(this.calcular(Buffer.concat(this.partes))); }
}

export const createHash = (nombre: string) => new Resumen(hashDe(nombre));
export const createHmac = (nombre: string, clave: Uint8Array) => new Resumen((datos) => hmac(hashDe(nombre), clave, datos));
export const getHashes = () => Object.keys(HASHES);

/** AES sin relleno, entregado de una vez (la librería siempre llama update una vez y luego final). */
export function createDecipheriv(nombre: string, clave: Uint8Array, iv: Datos) {
  const modo = nombre.toLowerCase();
  const cifra = modo.endsWith("-cbc") ? cbc(clave, aBytes(iv), { disablePadding: true })
    : modo.endsWith("-ecb") ? ecb(clave, { disablePadding: true })
    : null;
  if (!cifra || !modo.startsWith("aes-")) throw new Error(`Cifrado no disponible: ${nombre}`);
  return {
    setAutoPadding() { return this; },
    update: (d: Uint8Array) => Buffer.from(cifra.decrypt(d)),
    final: () => Buffer.alloc(0),
  };
}

export function randomBytes(n: number) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
}

export default { createHash, createHmac, createDecipheriv, getHashes, randomBytes };
