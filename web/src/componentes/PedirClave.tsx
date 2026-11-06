import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Pide la contraseña de un archivo. Solo se usa para abrirlo en este equipo: no se guarda ni se envía a ningún lado. */
export function PedirClave({ archivo, incorrecta, responder }: { archivo: string; incorrecta: boolean; responder: (clave: string | null) => void }) {
  const [clave, setClave] = useState("");
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && responder(null);
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [responder]);
  return createPortal(
    <>
      <div className="velo" onClick={() => responder(null)} />
      <form className="modal" role="dialog" aria-label="Contraseña del archivo" onSubmit={(e) => { e.preventDefault(); if (clave) responder(clave); }}>
        <div className="modal-cuerpo pila">
          <h2 className="fila" style={{ gap: 8 }}><KeyRound size={18} className="tenue" />Este archivo tiene contraseña</h2>
          <p className="muted" style={{ margin: 0, overflowWrap: "anywhere" }}>{archivo}</p>
          {incorrecta && <div className="aviso error" role="alert">Esa contraseña no es correcta. Revise mayúsculas y minúsculas e intente de nuevo.</div>}
          <div>
            <label className="etq" htmlFor="clave-archivo">Contraseña del archivo</label>
            <input id="clave-archivo" className="input" type="password" autoFocus autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} />
            <div className="ayuda">Solo se usa para abrirlo en este equipo: no se guarda ni se envía.</div>
          </div>
        </div>
        <div className="modal-pie">
          <button type="button" className="btn" onClick={() => responder(null)}>Cancelar</button>
          <button className="btn btn-primario" disabled={!clave}>Abrir archivo</button>
        </div>
      </form>
    </>,
    document.body,
  );
}
