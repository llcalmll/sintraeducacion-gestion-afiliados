/*
 * Lo poco de xml2js que necesita officecrypto-tool: leer el XML de cifrado de un Excel, con las opciones que usa
 * (explicitArray: false, mergeAttrs: true). vite.config.ts lo pone en lugar de "xml2js", que trae dependencias de Node.
 */
type Nodo = { [nombre: string]: string | Nodo | Nodo[] };

function aObjeto(el: Element): Nodo {
  const out: Nodo = {};
  for (const a of Array.from(el.attributes)) out[a.name] = a.value;
  for (const hijo of Array.from(el.children)) {
    const v = aObjeto(hijo);
    const previo = out[hijo.tagName];
    out[hijo.tagName] = previo === undefined ? v : Array.isArray(previo) ? [...previo, v] : [previo as Nodo, v];
  }
  return out;
}

export class Parser {
  async parseStringPromise(xml: string): Promise<Nodo> {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("El archivo trae datos de cifrado dañados.");
    return { [doc.documentElement.tagName]: aObjeto(doc.documentElement) };
  }
}

/** Solo se usa al cifrar, y la app nunca cifra archivos. */
export class Builder {
  buildObject(): string { throw new Error("No disponible"); }
}

export default { Parser, Builder };
