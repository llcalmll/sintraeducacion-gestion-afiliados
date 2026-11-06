import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { db } from "../datos/db";
import type { Hijo } from "../datos/tipos";
import { edadHijo, textoEdadHijo } from "../logica/fechas";
import { RegistroCivil } from "./RegistroCivil";
import { useUI } from "./ui";

/** Editar los datos de un hijo sin tener que borrarlo y crearlo de nuevo. */
export function EditarHijo({ hijo, cerrar }: { hijo: Hijo; cerrar: () => void }) {
  const { avisar } = useUI();
  const [nombre, setNombre] = useState(hijo.nombre);
  const [fecha, setFecha] = useState(hijo.fechaNacimiento ?? "");
  const [sexo, setSexo] = useState(hijo.sexo ?? "");
  const [registro, setRegistro] = useState(hijo.registroCivil.startsWith("http") ? "" : hijo.registroCivil);
  // El documento se adjunta o se quita al momento; se lee el registro vivo para mostrarlo al día.
  const vivo = useLiveQuery(() => db.hijos.get(hijo.id!), [hijo.id]) ?? hijo;
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cerrar]);

  const aprox = !fecha && edadHijo(hijo).aprox;

  async function guardar() {
    if (!nombre.trim()) return;
    await db.hijos.update(hijo.id!, {
      nombre: nombre.replace(/\s+/g, " ").trim(),
      fechaNacimiento: fecha || null,
      fechaNacimientoOriginal: fecha || hijo.fechaNacimientoOriginal,
      sexo: sexo as Hijo["sexo"],
      // Un enlace viejo (de la base importada) se conserva si no se escribe un número.
      registroCivil: registro.trim() || (hijo.registroCivil.startsWith("http") ? hijo.registroCivil : ""),
    });
    avisar(`Datos de ${nombre.trim()} actualizados`);
    cerrar();
  }

  return createPortal(
    <>
      <div className="velo" onClick={cerrar} />
      <form className="modal" role="dialog" aria-label={`Editar a ${hijo.nombre}`} onSubmit={(e) => { e.preventDefault(); guardar(); }}>
        <div className="modal-cuerpo pila">
          <h2>Editar hijo(a)</h2>
          <div><label className="etq">Nombre completo</label><input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
          <div className="fila-wrap" style={{ gap: 12 }}>
            <div style={{ flex: 1, minWidth: 170 }}>
              <label className="etq">Fecha de nacimiento</label>
              <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              {aprox && <div className="ayuda">Hoy solo se sabe la edad del formulario ({textoEdadHijo(edadHijo(hijo))}). Con la fecha, la edad queda exacta y aparece en Cumpleaños.</div>}
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label className="etq">Género</label>
              <select className="select" value={sexo} onChange={(e) => setSexo(e.target.value as Hijo["sexo"] & string)}>
                <option value="">—</option><option value="F">Niña</option><option value="M">Niño</option>
              </select>
            </div>
          </div>
          <div><label className="etq">N.° de registro civil</label><input className="input" placeholder="Opcional" value={registro} onChange={(e) => setRegistro(e.target.value)} /></div>
          <div>
            <label className="etq">Documento del registro civil</label>
            <RegistroCivil hijo={vivo} />
          </div>
        </div>
        <div className="modal-pie">
          <button type="button" className="btn" onClick={cerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={!nombre.trim()}>Guardar cambios</button>
        </div>
      </form>
    </>,
    document.body,
  );
}
