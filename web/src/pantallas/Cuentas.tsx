import { KeyRound, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar, Badge, useUI } from "../componentes/ui";
import { useEstadoApp } from "../datos/sesion";

/* Secciones de Configuración que solo existen en la app publicada (usuarios reales en el servidor). */

interface Cuenta { usuario: string; nombre: string; rol: "admin" | "usuaria"; activo: number; creado: string; invitado_por: string | null; invitado_en: string | null }

async function api(metodo: string, ruta: string, cuerpo?: unknown): Promise<{ error?: string } & Record<string, unknown>> {
  try {
    const r = await fetch(ruta, {
      method: metodo,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok ? d : { error: d.error ?? `Error ${r.status}` };
  } catch {
    return { error: "No hay conexión con el servidor." };
  }
}

/** Clave fácil de dictar por teléfono: sin letras que se confunden (l, 1, O, 0). */
function claveSugerida() {
  const letras = "abcdefghjkmnpqrstuvwxyz";
  const n = new Uint32Array(10);
  crypto.getRandomValues(n);
  const p = (i: number, s: string) => s[n[i] % s.length];
  return `${p(0, letras).toUpperCase()}${p(1, letras)}${p(2, letras)}${p(3, letras)}-${n[4] % 9000 + 1000}-${p(5, letras)}${p(6, letras)}`;
}

function Ventana({ titulo, children, onCerrar, onAceptar, boton, deshabilitado }: {
  titulo: string; children: React.ReactNode; onCerrar: () => void; onAceptar: () => void; boton: string; deshabilitado?: boolean;
}) {
  return createPortal(
    <>
      <div className="velo" onClick={onCerrar} />
      <form className="modal" role="dialog" onSubmit={(e) => { e.preventDefault(); onAceptar(); }}>
        <div className="modal-cuerpo pila">
          <h2>{titulo}</h2>
          {children}
        </div>
        <div className="modal-pie">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={deshabilitado}>{boton}</button>
        </div>
      </form>
    </>,
    document.body,
  );
}

export function SeccionUsuarios() {
  const app = useEstadoApp();
  const yo = app.usuario;
  // Con Cloudflare Access se comparte el acceso a un correo; sin Access, se crea usuario y clave.
  const conCorreo = app.acceso === "correo";
  const [compartido, setCompartido] = useState<{ correo: string } | null>(null);
  const { confirmar, avisar } = useUI();
  const [lista, setLista] = useState<Cuenta[] | null>(null);
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState<{ nombre: string; usuario: string; clave: string; rol: "admin" | "usuaria" } | null>(null);
  const [clave, setClave] = useState<{ cuenta: Cuenta; clave: string } | null>(null);
  const [entregada, setEntregada] = useState<{ usuario: string; clave: string } | null>(null);

  const cargar = useCallback(async () => {
    const d = await api("GET", "/api/usuarios");
    if (d.error) setError(d.error);
    else { setError(""); setLista(d.usuarios as Cuenta[]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(c: Cuenta, cambios: Record<string, unknown>, ok: string) {
    const d = await api("PATCH", "/api/usuarios", { usuario: c.usuario, ...cambios });
    if (d.error) return setError(d.error);
    avisar(ok);
    cargar();
  }

  return (
    <div className="pila">
      <div className="card">
        <div className="card-cab">
          <Users size={16} className="tenue" /><h3>Personas con acceso</h3>
          <span className="accion"><button className="btn btn-primario btn-sm" onClick={() => setNueva({ nombre: "", usuario: "", clave: conCorreo ? "" : claveSugerida(), rol: "usuaria" })}><UserPlus size={14} />{conCorreo ? "Compartir acceso" : "Nueva cuenta"}</button></span>
        </div>
        <div className="card-cuerpo pila">
          {error && <div className="aviso error">{error}</div>}
          {!lista ? <p className="muted">Cargando…</p> : (
            <div className="tabla-ajuste">
              <table className="tbl">
                <thead><tr><th>Persona</th><th>{conCorreo ? "Correo" : "Usuario"}</th><th>Permisos</th><th>Estado</th>{!conCorreo && <th />}<th /></tr></thead>
                <tbody>
                  {lista.map((c) => (
                    <tr key={c.usuario} style={{ opacity: c.activo ? 1 : 0.55 }}>
                      <td><span className="fila"><Avatar nombre={c.nombre} persona /><b>{c.nombre}</b>{c.usuario === yo?.usuario && <Badge tono="azul">Usted</Badge>}</span></td>
                      <td>
                      <div className="muted">{c.usuario}</div>
                      <div className="peq tenue">{c.invitado_por ? <>Creada por {c.invitado_por} · {new Date(c.invitado_en!).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}</> : "Desde la instalación"}</div>
                    </td>
                      <td>
                        <select className="select" style={{ height: 30, width: "auto" }} value={c.rol} disabled={c.usuario === yo?.usuario}
                          onChange={(e) => cambiar(c, { rol: e.target.value }, "Permisos actualizados")}>
                          <option value="usuaria">Uso normal</option>
                          <option value="admin">Administrador</option>
                        </select>
                      </td>
                        <td>{c.activo ? <Badge tono="verde" punto>Activa</Badge> : <Badge punto>Desactivada</Badge>}</td>
                      {!conCorreo && <td><button className="btn btn-sm" onClick={() => setClave({ cuenta: c, clave: claveSugerida() })}><KeyRound size={13} />Nueva clave</button></td>}
                      <td>
                        {c.usuario !== yo?.usuario && (
                          <button className={`btn btn-sm ${c.activo ? "btn-peligro" : ""}`} onClick={async () => {
                            if (c.activo && !(await confirmar({ titulo: `Desactivar a ${c.nombre}`, texto: conCorreo ? "Cloudflare deja de enviarle el PIN y la app la rechaza de inmediato. Se puede volver a activar." : "No podrá entrar a la app y se cierra su sesión en todos los equipos. Se puede volver a activar.", boton: "Desactivar", peligro: true }))) return;
                            cambiar(c, { activo: !c.activo }, c.activo ? (conCorreo ? "Acceso retirado" : "Cuenta desactivada") : (conCorreo ? "Acceso devuelto" : "Cuenta activada"));
                          }}>{c.activo ? "Desactivar" : "Activar"}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="peq muted" style={{ margin: 0 }}>
            <b>Uso normal</b>: trabaja con la base, descuentos, cumpleaños, hijos y eventos. <b>Administrador</b>: además {conCorreo ? "comparte o retira accesos" : "crea cuentas, asigna claves"} y puede borrar todos los datos.
            {conCorreo && <> Quien comparte un acceso responde por el uso que esa persona haga de los datos.</>}
          </p>
        </div>
      </div>

      {nueva && (
        <Ventana titulo={conCorreo ? "Compartir acceso" : "Nueva cuenta"} boton={conCorreo ? "Compartir" : "Crear cuenta"} onCerrar={() => setNueva(null)}
          deshabilitado={!nueva.nombre.trim() || (conCorreo ? !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nueva.usuario) : nueva.usuario.length < 3 || nueva.clave.length < 8)}
          onAceptar={async () => {
            const d = await api("POST", "/api/usuarios", conCorreo ? { nombre: nueva.nombre, usuario: nueva.usuario, rol: nueva.rol } : nueva);
            if (d.error) return setError(d.error);
            if (conCorreo) setCompartido({ correo: nueva.usuario });
            else setEntregada({ usuario: nueva.usuario, clave: nueva.clave });
            setNueva(null);
            cargar();
          }}>
          <div><label className="etq">Nombre completo</label><input className="input" autoFocus value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} /></div>
          {conCorreo ? (
            <div><label className="etq">Correo</label><input className="input" type="email" value={nueva.usuario} onChange={(e) => setNueva({ ...nueva, usuario: e.target.value.toLowerCase().replace(/[^a-z0-9._@+-]/g, "") })} placeholder="usuario@ejemplo.com" /><div className="ayuda">Con ese correo entra: Cloudflare le envía un código de 6 dígitos cada vez que inicia sesión.</div></div>
          ) : (
            <>
              <div><label className="etq">Usuario: su correo o un nombre corto</label><input className="input" value={nueva.usuario} onChange={(e) => setNueva({ ...nueva, usuario: e.target.value.toLowerCase().replace(/[^a-z0-9._@+-]/g, "") })} placeholder="por ejemplo: usuario@ejemplo.com o mlopez" /></div>
              <div><label className="etq">Clave inicial</label><input className="input" value={nueva.clave} onChange={(e) => setNueva({ ...nueva, clave: e.target.value })} /><div className="ayuda">La persona puede cambiarla después en Configuración, Mi cuenta.</div></div>
            </>
          )}
          <div>
            <label className="etq">Permisos</label>
            <select className="select" value={nueva.rol} onChange={(e) => setNueva({ ...nueva, rol: e.target.value as "admin" | "usuaria" })}>
              <option value="usuaria">Uso normal</option>
              <option value="admin">Administrador</option>
            </select>
          </div>
        </Ventana>
      )}

      {clave && (
        <Ventana titulo={`Nueva clave para ${clave.cuenta.nombre}`} boton="Guardar clave" onCerrar={() => setClave(null)} deshabilitado={clave.clave.length < 8}
          onAceptar={async () => {
            const d = await api("PATCH", "/api/usuarios", { usuario: clave.cuenta.usuario, clave: clave.clave });
            if (d.error) return setError(d.error);
            setEntregada({ usuario: clave.cuenta.usuario, clave: clave.clave });
            setClave(null);
          }}>
          <p className="muted" style={{ margin: 0 }}>Se cierra su sesión en todos los equipos y debe entrar con esta clave.</p>
          <input className="input" autoFocus value={clave.clave} onChange={(e) => setClave({ ...clave, clave: e.target.value })} />
        </Ventana>
      )}

      {compartido && (
        <Ventana titulo="Acceso compartido" boton="Listo" onCerrar={() => setCompartido(null)} onAceptar={() => setCompartido(null)}>
          <p className="muted" style={{ margin: 0 }}>Avísele a la persona que ya puede entrar. No necesita clave: al abrir la dirección escribe su correo y Cloudflare le envía un código.</p>
          <div className="aviso info" style={{ fontSize: 15, display: "block", lineHeight: 1.7 }}>
            <div>Dirección: <b>{location.host}</b></div>
            <div>Correo: <b>{compartido.correo}</b></div>
          </div>
          <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => {
            navigator.clipboard?.writeText(`Ya tiene acceso a la app de Sintraeducación.\nEntre a ${location.origin} con su correo ${compartido.correo}: le llegará un código de 6 dígitos.`).then(() => avisar("Copiado")).catch(() => {});
          }}>Copiar mensaje para enviarle</button>
        </Ventana>
      )}

      {entregada && (
        <Ventana titulo="Datos para entregar" boton="Listo" onCerrar={() => setEntregada(null)} onAceptar={() => setEntregada(null)}>
          <p className="muted" style={{ margin: 0 }}>Entréguele estos datos a la persona. Por seguridad la clave no se vuelve a mostrar.</p>
          <div className="aviso info" style={{ fontSize: 15, display: "block", lineHeight: 1.7 }}>
            <div>Usuario: <b>{entregada.usuario}</b></div>
            <div>Clave: <b>{entregada.clave}</b></div>
          </div>
          <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => {
            navigator.clipboard?.writeText(`Usuario: ${entregada.usuario}\nClave: ${entregada.clave}\nDirección: ${location.origin}`).then(() => avisar("Copiado")).catch(() => {});
          }}>Copiar usuario, clave y dirección</button>
        </Ventana>
      )}
    </div>
  );
}

export function SeccionMiCuenta() {
  const yo = useEstadoApp().usuario;
  const { avisar } = useUI();
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="card">
      <div className="card-cab"><KeyRound size={16} className="tenue" /><h3>Cambiar mi clave</h3><span className="accion peq muted">{yo?.nombre} · {yo?.usuario}</span></div>
      <form className="card-cuerpo pila" style={{ maxWidth: 420 }} onSubmit={async (e) => {
        e.preventDefault();
        if (nueva !== repetir) return setError("Las dos claves nuevas no coinciden.");
        const d = await api("POST", "/api/clave", { actual, nueva });
        if (d.error) return setError(d.error);
        setError(""); setActual(""); setNueva(""); setRepetir("");
        avisar("Clave cambiada. Se cerró la sesión en los demás equipos.");
      }}>
        <div><label className="etq">Clave actual</label><input className="input" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} /></div>
        <div><label className="etq">Clave nueva (mínimo 8 caracteres)</label><input className="input" type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} /></div>
        <div><label className="etq">Repita la clave nueva</label><input className="input" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} /></div>
        {error && <div className="aviso error">{error}</div>}
        <button className="btn btn-primario" style={{ alignSelf: "flex-start" }} disabled={!actual || nueva.length < 8}>Cambiar clave</button>
      </form>
    </div>
  );
}
