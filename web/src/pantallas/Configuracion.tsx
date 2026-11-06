import { Bot, CheckCircle2, CircleAlert, CircleUserRound, ClipboardList, Copy, Database, KeyRound, MessageSquareText, Monitor, Moon, Palette, ShieldCheck, Sparkles, Sun, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { refrescarEstadoIA, useEstadoIA } from "../componentes/AsistenteIA";
import { Badge, Cabecera, useUI } from "../componentes/ui";
import {
  abrirAsistente, MENSAJE_POR_DEFECTO, ponerIAActiva, ponerMensajeWhatsApp, ponerModeloIA, ponerModoDemo, ponerTema,
  useIAActiva, useMensajeWhatsApp, useModeloIA, useModoDemo, useTema, type Tema,
} from "../datos/preferencias";
import { useEstadoApp } from "../datos/sesion";
import { SeccionMiCuenta, SeccionUsuarios } from "./Cuentas";
import { DatosYRespaldo } from "./Datos";

// "solo": en qué versión aparece. local = demo con npm run dev; servidor = app publicada; admin = publicada y administrador.
const SECCIONES: { v: string; t: string; icono: typeof Palette; solo?: "local" | "servidor" | "admin" }[] = [
  { v: "apariencia", t: "Apariencia", icono: Palette },
  { v: "cuenta", t: "Mi cuenta", icono: CircleUserRound, solo: "servidor" },
  { v: "usuarios", t: "Usuarios", icono: Users, solo: "admin" },
  { v: "asistente", t: "Asistente", icono: Sparkles },
  { v: "mensajes", t: "Mensaje de WhatsApp", icono: MessageSquareText },
  { v: "demo", t: "Modo demo", icono: ClipboardList, solo: "local" },
  { v: "datos", t: "Datos y respaldo", icono: Database },
];

export default function Configuracion() {
  const [params, setParams] = useSearchParams();
  const app = useEstadoApp();
  const servidor = app.modo === "servidor";
  const visibles = SECCIONES.filter((s) => !s.solo || (s.solo === "local" ? !servidor : s.solo === "servidor" ? servidor : servidor && app.usuario?.rol === "admin"))
    // Con ingreso por correo no hay clave que cambiar.
    .filter((s) => !(s.v === "cuenta" && app.acceso === "correo"));
  const pedida = params.get("seccion") ?? "apariencia";
  const seccion = visibles.some((s) => s.v === pedida) ? pedida : "apariencia";
  return (
    <>
      <Cabecera titulo="Configuración" sub={servidor ? "Cuenta, usuarios, mensajes y copias de seguridad." : "Asistente de IA, mensajes, modo demo y copias de seguridad."}>
        <div className="seg">
          {visibles.map((s) => (
            <button key={s.v} className={seccion === s.v ? "on" : ""} onClick={() => setParams({ seccion: s.v }, { replace: true })}>
              <s.icono size={14} />{s.t}
            </button>
          ))}
        </div>
      </Cabecera>
      <div className="contenido" style={{ maxWidth: 1200 }}>
        {seccion === "apariencia" && <SeccionApariencia />}
        {seccion === "cuenta" && <SeccionMiCuenta />}
        {seccion === "usuarios" && <SeccionUsuarios />}
        {seccion === "asistente" && <SeccionAsistente basico={servidor} />}
        {seccion === "mensajes" && <SeccionMensajes />}
        {seccion === "demo" && <SeccionDemo />}
        {seccion === "datos" && <DatosYRespaldo />}
      </div>
    </>
  );
}

function Interruptor({ activo, onCambio, titulo, children }: { activo: boolean; onCambio: (v: boolean) => void; titulo: string; children?: ReactNode }) {
  return (
    <label className="fila" style={{ gap: 14, cursor: "pointer", alignItems: "flex-start" }}>
      <span className="interruptor" style={{ marginTop: 2 }}>
        <input type="checkbox" checked={activo} onChange={(e) => onCambio(e.target.checked)} />
        <span />
      </span>
      <span>
        <b style={{ fontSize: 14.5 }}>{titulo}</b>
        {children && <div className="muted" style={{ marginTop: 2 }}>{children}</div>}
      </span>
    </label>
  );
}

function SeccionAsistente({ basico }: { basico: boolean }) {
  const activa = useIAActiva();
  const estado = useEstadoIA();
  const modelo = useModeloIA();
  const { avisar } = useUI();
  const [prueba, setPrueba] = useState<{ ok: boolean; texto: string } | null>(null);
  const [probando, setProbando] = useState(false);
  const ruta = "sintraeducacion\\web\\.env.local";

  async function probar() {
    setProbando(true);
    setPrueba(null);
    const e = await refrescarEstadoIA();
    if (!e.configurada) {
      setPrueba({ ok: false, texto: "No se encontró la clave. Cree el archivo .env.local como se explica abajo." });
    } else if (e.error) {
      setPrueba({ ok: false, texto: e.error });
    } else {
      try {
        const r = await fetch("/__ia/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "Responda únicamente con estas palabras: Conexión correcta." }], modelo: modelo || undefined }),
        });
        const d = await r.json();
        setPrueba(r.ok ? { ok: true, texto: `${d.choices?.[0]?.message?.content ?? "Respondió"} (modelo ${d.modelo})` } : { ok: false, texto: d.error });
      } catch {
        setPrueba({ ok: false, texto: "No hay conexión con el servidor de la app." });
      }
    }
    setProbando(false);
  }

  const conectado = estado?.configurada && !estado.error;
  // En la app publicada el asistente funciona solo en modo básico (sin IA ni claves de OpenAI).
  if (basico) {
    return (
      <div className="card">
        <div className="card-cuerpo pila">
          <Interruptor activo={activa} onCambio={(v) => { ponerIAActiva(v); if (!v) abrirAsistente(false); avisar(v ? "Asistente activado" : "Asistente desactivado"); }} titulo="Activar el asistente">
            Muestra el botón "Asistente" en todas las pantallas. Ayuda a subir el Excel del mes, mostrar a quién escribirle, revisar cumpleaños y abrir formularios.
          </Interruptor>
          {activa && <div style={{ paddingLeft: 58 }}><button className="btn btn-sm" onClick={() => abrirAsistente(true)}><Sparkles size={13} />Abrir el asistente</button></div>}
        </div>
      </div>
    );
  }
  return (
    <div className="pila">
      <div className="card">
        <div className="card-cuerpo pila">
          <Interruptor activo={activa} onCambio={(v) => { ponerIAActiva(v); if (!v) abrirAsistente(false); avisar(v ? "Asistente activado" : "Asistente desactivado"); }} titulo="Activar el asistente">
            Muestra el botón "Asistente" en todas las pantallas. Puede subir el Excel del mes, mostrar a quién escribirle, revisar cumpleaños, crear eventos y abrir formularios, explicando qué hacer en cada caso.
          </Interruptor>
          <div className="fila-wrap" style={{ paddingLeft: 58 }}>
            {!estado ? <Badge>Revisando…</Badge>
              : conectado ? <Badge tono="verde" punto>Con IA · {estado.modelo}</Badge>
              : estado.configurada ? <Badge tono="rojo" punto>Error de conexión</Badge>
              : <Badge tono="ambar" punto>Modo básico: falta la clave de OpenAI</Badge>}
            <button className="btn btn-sm" onClick={probar} disabled={probando}>{probando ? "Probando…" : "Probar conexión"}</button>
            {activa && <button className="btn btn-sm" onClick={() => abrirAsistente(true)}><Sparkles size={13} />Abrir el asistente</button>}
          </div>
          {prueba && (
            <div className={`aviso ${prueba.ok ? "ok" : "error"}`} style={{ marginLeft: 58 }}>
              {prueba.ok ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}{prueba.texto}
            </div>
          )}
          {estado?.error && !prueba && <div className="aviso error" style={{ marginLeft: 58 }}><CircleAlert size={16} />{estado.error}</div>}
        </div>
      </div>

      <div className="dos">
        <div className="card">
          <div className="card-cab"><KeyRound size={16} className="tenue" /><h3>Conectar la clave de OpenAI</h3></div>
          <div className="card-cuerpo pila" style={{ gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>Sin clave el asistente funciona en <b>modo básico</b>: sube el Excel, muestra pendientes y entiende preguntas sencillas. Con la clave entiende cualquier pedido y explica mejor.</p>
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              <li>En la carpeta <code>web</code> copie el archivo <code>.env.local.example</code> con el nombre <code>.env.local</code>.</li>
              <li>Pegue la clave después de <code>OPENAI_API_KEY=</code> y guarde.</li>
              <li>Oprima <b>Probar conexión</b>. No hace falta reiniciar la app.</li>
            </ol>
            <div className="fila">
              <code className="peq" style={{ background: "var(--gris-s)", padding: "4px 8px", borderRadius: 6, flex: 1 }}>{ruta}</code>
              <button className="btn btn-sm btn-icono" title="Copiar ruta" onClick={() => { navigator.clipboard?.writeText(ruta).then(() => avisar("Ruta copiada")).catch(() => {}); }}><Copy size={13} /></button>
            </div>
            <p className="peq tenue" style={{ margin: 0 }}>Recomendado: ponga un límite de gasto mensual en la cuenta de OpenAI (Billing → Limits).</p>
          </div>
        </div>

        <div className="card">
          <div className="card-cab"><Bot size={16} className="tenue" /><h3>Modelo</h3></div>
          <div className="card-cuerpo pila" style={{ gap: 10 }}>
            <select className="select" value={modelo} onChange={(e) => { ponerModeloIA(e.target.value); avisar("Modelo guardado"); }} disabled={!conectado}>
              <option value="">Automático (recomendado){estado?.modelo && !modelo ? ` · ${estado.modelo}` : ""}</option>
              {(estado?.modelos ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="muted" style={{ margin: 0 }}>En automático la app usa el modelo "mini" más reciente de su cuenta: es económico y sabe usar las acciones de la app.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-cab"><ShieldCheck size={16} className="tenue" /><h3>Privacidad</h3></div>
        <div className="card-cuerpo">
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>La IA <b>no recibe nombres, cédulas ni celulares</b> de la base. Solo recibe cifras ("80 personas, 46 de Ibagué"); las personas se muestran en la pantalla.</li>
            <li>Solo ve datos personales si usted se los escribe, por ejemplo al dictarle los datos de una afiliación nueva.</li>
            <li>La clave queda en el servidor de la app y nunca llega al navegador.</li>
            <li>El asistente no envía mensajes ni borra nada: los botones de WhatsApp abren el chat y usted decide si enviar. Crear eventos o cambiar el mensaje piden confirmación.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const TEMAS: { v: Tema; t: string; d: string; icono: typeof Sun; muestra: [string, string, string] }[] = [
  { v: "claro", t: "Claro", d: "Fondo gris claro con tarjetas blancas.", icono: Sun, muestra: ["#222a37", "#e6eaf0", "#ffffff"] },
  { v: "oscuro", t: "Oscuro", d: "Descansa la vista en pantallas brillantes o de noche.", icono: Moon, muestra: ["#11151c", "#0e1218", "#171c25"] },
  { v: "auto", t: "Automático", d: "Sigue el modo claro u oscuro del computador.", icono: Monitor, muestra: ["#222a37", "#e6eaf0", "#171c25"] },
];

function SeccionApariencia() {
  const tema = useTema();
  return (
    <div className="card">
      <div className="card-cab"><Palette size={16} className="tenue" /><h3>Apariencia</h3></div>
      <div className="card-cuerpo">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {TEMAS.map((x) => (
            <button key={x.v} className={`opcion-tema ${tema === x.v ? "on" : ""}`} onClick={() => ponerTema(x.v)}>
              <div className="muestra-tema">
                <div style={{ background: x.muestra[0] }} />
                <div style={{ background: x.muestra[1], padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ background: x.muestra[2], borderRadius: 4, height: 18, border: "1px solid rgba(128,128,128,.25)" }} />
                  <div style={{ background: "#ffe38a", borderRadius: 4, height: 10, width: "60%" }} />
                </div>
              </div>
              <span className="fila"><x.icono size={16} /><b>{x.t}</b>{tema === x.v && <Badge tono="azul">En uso</Badge>}</span>
              <span className="peq muted">{x.d}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SeccionMensajes() {
  const actual = useMensajeWhatsApp();
  const [texto, setTexto] = useState(actual);
  const { avisar } = useUI();
  return (
    <div className="card">
      <div className="card-cab"><MessageSquareText size={16} className="tenue" /><h3>Mensaje para quienes no tuvieron descuento</h3></div>
      <div className="card-cuerpo pila">
        <div>
          <textarea className="input" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div className="ayuda">Escriba <b>{"{nombre}"}</b> donde va el nombre y <b>{"{mes}"}</b> donde va el mes.</div>
        </div>
        <div>
          <label className="etq">Así se verá</label>
          <div className="burbuja ia burbuja-wa" style={{ maxWidth: "100%" }}>{texto.replaceAll("{nombre}", "Carmen").replaceAll("{mes}", "septiembre 2026")}</div>
        </div>
        <div className="fila">
          <button className="btn btn-primario" disabled={!texto.includes("{nombre}")} onClick={() => { ponerMensajeWhatsApp(texto); avisar("Mensaje guardado"); }}>Guardar mensaje</button>
          <button className="btn" onClick={() => setTexto(MENSAJE_POR_DEFECTO)}>Volver al original</button>
        </div>
      </div>
    </div>
  );
}

function SeccionDemo() {
  const demo = useModoDemo();
  return (
    <div className="card">
      <div className="card-cuerpo">
        <Interruptor activo={demo} onCambio={ponerModoDemo} titulo="Mostrar los pendientes para la reunión con el cliente">
          Activa la página "Para la reunión", la campana de pendientes y los avisos amarillos de datos faltantes. Apagado, la app se ve como producto terminado.
        </Interruptor>
      </div>
    </div>
  );
}
