import { CalendarCheck, FileSearch, ShieldCheck, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import logo from "../assets/logo-sintraeducacion.png";
import { configurarAdmin, ingresar, SALIR_ACCESS, useEstadoApp, USUARIO_DEMO, type EstadoApp } from "../datos/sesion";

export default function Ingreso() {
  const app = useEstadoApp();
  const primeraVez = app.modo === "servidor" && !app.configurado;
  return (
    <div className="ingreso">
      <div className="ingreso-arte">
        <img className="ingreso-logo" src={logo} alt="Logo de Sintraeducación" />
        <div>
          <h2>Gestión de afiliados del sindicato, en un solo lugar.</h2>
          <div className="pila" style={{ marginTop: 28, gap: 14, fontSize: 14 }}>
            <div className="fila"><Users size={18} /> Base de afiliados de Ibagué, Tolima y alcaldías</div>
            <div className="fila"><FileSearch size={18} /> Cruce mensual de descuentos por cédula</div>
            <div className="fila"><CalendarCheck size={18} /> Eventos, asistencia y cumpleaños</div>
            <div className="fila"><ShieldCheck size={18} /> Acceso con usuario y clave</div>
          </div>
        </div>
        <div className="peq" style={{ color: "#7d889a" }}>Sindicato de Trabajadores de Educación, Servidores Públicos y Pensionados del Tolima</div>
      </div>
      <div className="ingreso-form">
        <img className="ingreso-logo-movil" src={logo} alt="Logo de Sintraeducación" />
        {app.acceso === "correo" ? <IngresoCorreo app={app} /> : primeraVez ? <CrearAdmin /> : <FormIngreso local={app.modo === "local"} aviso={app.aviso} />}
      </div>
    </div>
  );
}

/** Con Cloudflare Access el correo ya se verificó con un PIN antes de abrir la página. */
function IngresoCorreo({ app }: { app: EstadoApp }) {
  if (app.aviso) {
    return (
      <div className="pila">
        <h1>Ingresar de nuevo</h1>
        <div className="aviso info">{app.aviso}</div>
        <button className="btn btn-primario btn-lg" onClick={() => location.reload()}>Continuar</button>
      </div>
    );
  }
  return (
    <div className="pila">
      <h1>Sin acceso</h1>
      {app.correo ? (
        <p className="muted" style={{ margin: 0 }}>
          El correo <b>{app.correo}</b> no tiene acceso a la app. Pídale a un administrador del sindicato que se lo comparta desde Configuración, Usuarios.
        </p>
      ) : (
        <p className="muted" style={{ margin: 0 }}>No se pudo verificar su correo. Vuelva a intentarlo.</p>
      )}
      <a className="btn btn-primario btn-lg" href={SALIR_ACCESS}>Entrar con otro correo</a>
    </div>
  );
}

function Campo({ id, etiqueta, children }: { id: string; etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <label className="etq" htmlFor={id}>{etiqueta}</label>
      {children}
    </div>
  );
}

function FormIngreso({ local, aviso }: { local: boolean; aviso?: string }) {
  const [usuario, setUsuario] = useState(local ? USUARIO_DEMO.usuario : "");
  const [clave, setClave] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setError((await ingresar(usuario, clave)) ?? "");
        setEnviando(false);
      }}
    >
      <div>
        <h1>Iniciar sesión</h1>
        <p className="muted" style={{ marginTop: 4 }}>Ingrese con su usuario asignado.</p>
      </div>
      {aviso && <div className="aviso info">{aviso}</div>}
      <Campo id="u" etiqueta="Usuario o correo">
        <input id="u" className="input" style={{ height: 40 }} value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoFocus={!local} />
      </Campo>
      <Campo id="c" etiqueta="Clave">
        <input id="c" className="input" style={{ height: 40 }} type="password" autoFocus={local} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" />
      </Campo>
      {error && <div className="aviso error">{error}</div>}
      <button className="btn btn-primario btn-lg" disabled={enviando}>{enviando ? "Ingresando…" : "Entrar"}</button>
      {local && <div className="aviso info">Demo: usuario <b>{USUARIO_DEMO.usuario}</b>, clave <b>{USUARIO_DEMO.clave}</b>.</div>}
      {!local && <p className="peq muted" style={{ margin: 0 }}>¿Olvidó la clave? Pídale al administrador que le asigne una nueva.</p>}
    </form>
  );
}

function CrearAdmin() {
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (clave !== repetir) return setError("Las dos claves no coinciden.");
        setEnviando(true);
        setError((await configurarAdmin(nombre, usuario, clave, codigo)) ?? "");
        setEnviando(false);
      }}
    >
      <div>
        <h1>Bienvenido</h1>
        <p className="muted" style={{ marginTop: 4 }}>Es la primera vez que se abre la app. Cree la cuenta de administrador: con ella después se crean las cuentas de las demás personas.</p>
      </div>
      <Campo id="k" etiqueta="Código de instalación">
        <input id="k" className="input" style={{ height: 40 }} value={codigo} onChange={(e) => setCodigo(e.target.value)} autoFocus autoComplete="off" />
        <div className="ayuda">Lo entrega quien instaló la app. Evita que otra persona cree esta cuenta primero.</div>
      </Campo>
      <Campo id="n" etiqueta="Nombre completo"><input id="n" className="input" style={{ height: 40 }} value={nombre} onChange={(e) => setNombre(e.target.value)} /></Campo>
      <Campo id="u" etiqueta="Usuario: su correo o un nombre corto">
        <input id="u" className="input" style={{ height: 40 }} value={usuario} onChange={(e) => setUsuario(e.target.value.toLowerCase().replace(/\s/g, ""))} autoComplete="username" />
      </Campo>
      <Campo id="c" etiqueta="Clave (mínimo 8 caracteres)"><input id="c" className="input" style={{ height: 40 }} type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" /></Campo>
      <Campo id="c2" etiqueta="Repita la clave"><input id="c2" className="input" style={{ height: 40 }} type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" /></Campo>
      {error && <div className="aviso error">{error}</div>}
      <button className="btn btn-primario btn-lg" disabled={enviando || !codigo.trim() || !nombre.trim() || !usuario || clave.length < 8}>{enviando ? "Creando…" : "Crear cuenta y entrar"}</button>
    </form>
  );
}
