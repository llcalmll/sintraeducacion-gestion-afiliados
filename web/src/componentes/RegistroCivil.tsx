import { Download, ExternalLink, FileText, ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { db } from "../datos/db";
import type { Afiliado, ArchivoAdjunto, Hijo } from "../datos/tipos";
import { ACEPTA, borrarArchivo, esPdf, hayArchivos, subirArchivo, urlArchivo, type TipoArchivo } from "../logica/archivos";
import { esVacio } from "../logica/texto";
import { useUI } from "./ui";

/**
 * Un documento adjunto (foto o PDF en el servidor): "Adjuntar" (o soltar el archivo encima) si no hay,
 * y si ya hay, "Ver" (vista previa sin salir de la app) y quitarlo. Lo usan la cédula del afiliado y el
 * registro civil de cada hijo.
 */
function Adjunto({ tipo, dueno, archivo, documento, guardar, extra, textoAdjuntar = "Adjuntar", textoVer = "Ver" }: {
  tipo: TipoArchivo;
  dueno: number;
  archivo: ArchivoAdjunto | undefined;
  /** "el registro civil de Ana", "la cédula de Pedro": para los avisos y la vista previa. */
  documento: { titulo: string; frase: string };
  guardar: (a: ArchivoAdjunto | undefined) => Promise<unknown>;
  extra?: ReactNode;
  textoAdjuntar?: string;
  textoVer?: string;
}) {
  const { avisar, confirmar } = useUI();
  const [subiendo, setSubiendo] = useState(false);
  const [viendo, setViendo] = useState(false);
  const [encima, setEncima] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  async function adjuntar(f: File | undefined) {
    if (!f) return;
    setSubiendo(true);
    try {
      const nuevo = await subirArchivo(tipo, dueno, f);
      await guardar(nuevo);
      if (archivo) borrarArchivo(archivo.clave).catch(() => {});
      avisar(`Quedó adjunta ${documento.frase}`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSubiendo(false);
    }
  }

  async function quitar() {
    if (!archivo || !(await confirmar({ titulo: `Quitar ${documento.frase}`, texto: "El archivo se borra del servidor. Se puede volver a adjuntar.", boton: "Quitar", peligro: true }))) return;
    try {
      await borrarArchivo(archivo.clave);
      await guardar(undefined);
      avisar("Archivo quitado");
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), "error");
    }
  }

  if (!hayArchivos()) return <span className="fila" style={{ gap: 6 }}>{extra}{!extra && <span className="peq tenue" title="Los archivos se adjuntan en la versión publicada">—</span>}</span>;

  return (
    <span className={`rc ${encima ? "soltar" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setEncima(true); } }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => { e.preventDefault(); setEncima(false); adjuntar(e.dataTransfer.files[0]); }}
      onClick={(e) => e.stopPropagation()}>
      {archivo ? (
        <>
          <button type="button" className="btn btn-sm" onClick={() => setViendo(true)} title={archivo.nombre}>
            {esPdf(archivo) ? <FileText size={13} /> : <ImageIcon size={13} />}{textoVer}
          </button>
          <button type="button" className="btn btn-sm btn-fantasma btn-icono" title="Quitar el archivo" onClick={quitar}><X size={14} /></button>
        </>
      ) : (
        <button type="button" className="btn btn-sm" disabled={subiendo} onClick={() => entrada.current?.click()} title="Foto o PDF, máximo 10 MB. También puede soltar el archivo aquí.">
          {subiendo ? <Loader2 size={13} className="girando" /> : <Paperclip size={13} />}{subiendo ? "Subiendo…" : textoAdjuntar}
        </button>
      )}
      {extra}
      <input ref={entrada} type="file" accept={ACEPTA} hidden aria-label={documento.titulo}
        onChange={(e) => { adjuntar(e.target.files?.[0]); e.target.value = ""; }} />
      {viendo && archivo && <VisorArchivo archivo={archivo} titulo={documento.titulo} cerrar={() => setViendo(false)} />}
    </span>
  );
}

/** Registro civil de un hijo. */
export function RegistroCivil({ hijo }: { hijo: Hijo }) {
  const texto = !esVacio(hijo.registroCivil)
    ? hijo.registroCivil.startsWith("http")
      ? <a href={hijo.registroCivil} target="_blank" rel="noreferrer" className="peq" onClick={(e) => e.stopPropagation()}>Enlace</a>
      : <span className="peq tenue" title="Número del registro civil">{hijo.registroCivil}</span>
    : null;
  return (
    <Adjunto tipo="rc" dueno={hijo.id!} archivo={hijo.registroCivilArchivo} extra={texto}
      documento={{ titulo: `Registro civil de ${hijo.nombre}`, frase: `el registro civil de ${hijo.nombre}` }}
      guardar={(a) => db.hijos.update(hijo.id!, { registroCivilArchivo: a })} />
  );
}

/** Cédula del afiliado (foto o PDF del documento). */
export function CedulaAdjunta({ afiliado }: { afiliado: Afiliado }) {
  // En la versión local de demostración no hay dónde guardar archivos: no se muestra nada.
  if (!hayArchivos()) return null;
  return (
    <Adjunto tipo="ced" dueno={afiliado.id!} archivo={afiliado.cedulaArchivo} textoAdjuntar="Adjuntar cédula" textoVer="Ver cédula"
      documento={{ titulo: `Cédula de ${afiliado.nombre}`, frase: `la cédula de ${afiliado.nombre}` }}
      guardar={(a) => db.afiliados.update(afiliado.id!, { cedulaArchivo: a, editados: [...new Set([...(afiliado.editados ?? []), "cedulaArchivo"])], actualizadoEn: new Date().toISOString() })} />
  );
}

/** Vista previa en grande (foto o PDF), sin salir de la app. Esc o la X cierran. */
export function VisorArchivo({ archivo, titulo, cerrar }: { archivo: ArchivoAdjunto; titulo: string; cerrar: () => void }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cerrar]);
  const url = urlArchivo(archivo);
  return createPortal(
    <div className="visor" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="visor-cab">
        <div className="visor-titulo"><b>{titulo}</b><small>{archivo.nombre}</small></div>
        <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} />Abrir</a>
        <a className="btn btn-sm" href={urlArchivo(archivo, true)}><Download size={14} />Descargar</a>
        <button className="btn btn-sm btn-icono" aria-label="Cerrar" title="Cerrar (Esc)" onClick={cerrar}><X size={16} /></button>
      </div>
      <div className="visor-cuerpo" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
        {esPdf(archivo) ? <iframe src={`${url}#view=FitH`} title={titulo} /> : <img src={url} alt={titulo} />}
      </div>
    </div>,
    document.body,
  );
}
