/**
 * Abre un Excel con contraseña dentro del navegador: ni el archivo ni la contraseña salen del equipo.
 * Se carga solo cuando llega un archivo protegido, para no pesarle a la app en el uso normal.
 * Devuelve el archivo ya sin contraseña, o "incorrecta" / "no-soportado".
 */
export async function descifrarExcel(datos: ArrayBuffer, clave: string): Promise<Uint8Array | "incorrecta" | "no-soportado"> {
  const { Buffer } = await import("buffer");
  // La librería espera el Buffer de Node como global desde que se carga.
  (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
  const { default: office } = await import("officecrypto-tool");
  try {
    return new Uint8Array(await office.decrypt(Buffer.from(datos), { password: clave }));
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    return /incorrect/i.test(mensaje) ? "incorrecta" : "no-soportado";
  }
}
