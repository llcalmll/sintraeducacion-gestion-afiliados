import {
  Baby, Bell, Cake, CalendarCheck, ChevronDown, ChevronRight, ClipboardList, FileSearch, LayoutDashboard, LogOut,
  Cloud, CloudOff, Moon, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Settings, Sheet, Sparkles, Sun, ToggleLeft, ToggleRight, UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AsistenteIA } from "./componentes/AsistenteIA";
import { MenuContextualRaiz } from "./componentes/MenuContextual";
import { Noticas } from "./componentes/Noticas";
import { Paleta } from "./componentes/Paleta";
import { inicialesPersona, Menu, ProveedorUI, useUI } from "./componentes/ui";
import { useAfiliados, useHijosPorAfiliado, usePorContactar } from "./datos/hooks";
import { abrirAsistente, ponerModoDemo, ponerTema, useAsistenteAbierto, useIAActiva, useModoDemo, useOscuro } from "./datos/preferencias";
import { cargarDemoSiVacia } from "./datos/semilla";
import { iniciarApp, salir, useEstadoApp } from "./datos/sesion";
import { sincronizarAhora, useEstadoSync } from "./datos/sincronizacion";
import logo from "./assets/logo-sintraeducacion.png";
import { MESES } from "./logica/fechas";
import { calcularPendientes } from "./logica/pendientes";
import Afiliados from "./pantallas/Afiliados";
import Cumpleanos from "./pantallas/Cumpleanos";
import Configuracion from "./pantallas/Configuracion";
import DescuentosMes from "./pantallas/DescuentosMes";
import Eventos from "./pantallas/Eventos";
import FichaAfiliado from "./pantallas/FichaAfiliado";
import Hijos from "./pantallas/Hijos";
import Ingreso from "./pantallas/Ingreso";
import Inicio from "./pantallas/Inicio";
import NuevaAfiliacion from "./pantallas/NuevaAfiliacion";
import Reunion from "./pantallas/Reunion";
import ResultadoGuardado from "./pantallas/ResultadoGuardado";

const PRINCIPAL = [
  { a: "/", icono: Sheet, texto: "Base de datos", tambien: ["/afiliados/", "/nuevo"] },
  { a: "/descuentos", icono: FileSearch, texto: "Descuentos del mes", tambien: ["/cruces"] },
  { a: "/cumpleanos", icono: Cake, texto: "Cumpleaños", tambien: [] },
  { a: "/hijos", icono: Baby, texto: "Hijos", tambien: [] },
];
const MAS = [
  { a: "/resumen", icono: LayoutDashboard, texto: "Resumen general" },
  { a: "/eventos", icono: CalendarCheck, texto: "Eventos y asistencia" },
  { a: "/configuracion", icono: Settings, texto: "Configuración" },
];

function leerColapsada() {
  try { return localStorage.getItem("lateral-colapsada") === "1"; } catch { return false; }
}

export default function App() {
  const app = useEstadoApp();
  useEffect(() => { iniciarApp(); }, []);
  if (app.modo === "cargando") return <div className="cargando"><div className="caja"><div className="giro" /><span>Cargando…</span></div></div>;
  return <ProveedorUI>{app.usuario ? <Marco usuario={app.usuario.nombre} /> : <Ingreso />}</ProveedorUI>;
}

/** Estado de la sincronización con el servidor, en la barra superior. */
function IndicadorSync() {
  const s = useEstadoSync();
  const sinRed = s.estado === "sin-conexion" || s.estado === "error";
  const trabajando = s.estado === "enviando" || s.estado === "recibiendo";
  const texto = sinRed ? s.mensaje ?? "Sin conexión" : trabajando ? "Guardando en el servidor…" : s.pendientes ? `${s.pendientes} cambios por enviar` : "Todo guardado en el servidor";
  return (
    <button className={`top-btn ${sinRed ? "alerta" : ""}`} title={`${texto}. Clic para sincronizar ahora.`} onClick={() => sincronizarAhora()}>
      {sinRed ? <CloudOff size={18} /> : trabajando ? <RefreshCw size={17} className="girando" /> : <Cloud size={18} />}
      {s.pendientes > 0 && <span className="contador">{s.pendientes}</span>}
    </button>
  );
}

function Marco({ usuario }: { usuario: string }) {
  const app = useEstadoApp();
  const local = app.modo === "local";
  const { confirmar } = useUI();
  const [colapsada, setColapsada] = useState(leerColapsada);
  const [paleta, setPaleta] = useState(false);
  const [carga, setCarga] = useState<string | null>(null);
  const [errorCarga, setErrorCarga] = useState("");
  // El modo demo (pendientes de la reunión) solo existe en la versión local, nunca en la publicada.
  const demo = useModoDemo() && local;
  const iaActiva = useIAActiva();
  const oscuro = useOscuro();
  const asistenteAbierto = useAsistenteAbierto();
  const nav = useNavigate();
  const ruta = useLocation().pathname;
  const enMas = MAS.some((m) => ruta.startsWith(m.a)) || ruta.startsWith("/reunion");
  const [masAbierto, setMasAbierto] = useState(enMas);
  useEffect(() => { if (enMas) setMasAbierto(true); }, [enMas]);

  const afiliados = useAfiliados();
  const porContactar = usePorContactar();
  const hijos = useHijosPorAfiliado();
  const pendientes = useMemo(
    () => (demo && afiliados?.length ? calcularPendientes({ afiliados, hijos: [...(hijos?.values() ?? [])].flat(), hojasOmitidas: [], pagadores: [...new Set(afiliados.map((a) => a.pagador))] }).length : 0),
    [demo, afiliados, hijos],
  );

  useEffect(() => {
    let vivo = true;
    cargarDemoSiVacia((t) => vivo && setCarga(t))
      .catch((e) => setErrorCarga(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setCarga(null));
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaleta(true); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  const alternar = () => setColapsada((c) => {
    try { localStorage.setItem("lateral-colapsada", c ? "0" : "1"); } catch { /* nada */ }
    return !c;
  });
  const hoy = new Date();
  const activo = (a: string, tambien: string[]) => (a === "/" ? ruta === "/" : ruta.startsWith(a)) || tambien.some((t) => ruta.startsWith(t));
  const rutas = [...PRINCIPAL, ...MAS, ...(demo ? [{ a: "/reunion", texto: "Para la reunión" }] : [])].map((m) => ({ a: m.a, t: m.texto }));

  return (
    <div className={`app ${colapsada ? "colapsada" : ""}`}>
      <MenuContextualRaiz />
      <div className="topbar">
        <div className="marca"><img className="logo-img" src={logo} alt="Logo de Sintraeducación" /><span>Sintraeducación</span></div>
        <button className="busqueda-global" onClick={() => setPaleta(true)}>
          <Search size={15} /> Buscar afiliado por nombre o cédula
          <span className="kbd">Ctrl K</span>
        </button>
        {/* Las noticas, a la vista en el centro de la barra (en cualquier pantalla), con su botón para verlas todas. */}
        <Noticas />
        <Menu derecha boton={(abrir) => <button className="top-btn" onClick={abrir} title="Crear"><Plus size={18} /></button>}>
          {(cerrar) => (
            <>
              <button className="menu-item" onClick={() => { nav("/descuentos"); cerrar(); }}><FileSearch size={15} />Subir descuentos del mes</button>
              <button className="menu-item" onClick={() => { nav("/nuevo"); cerrar(); }}><UserPlus size={15} />Agregar afiliado</button>
              <button className="menu-item" onClick={() => { nav("/eventos?nuevo=1"); cerrar(); }}><CalendarCheck size={15} />Nuevo evento</button>
            </>
          )}
        </Menu>
        {iaActiva && (
          <button className="top-btn" title="Asistente" onClick={() => abrirAsistente(!asistenteAbierto)} style={asistenteAbierto ? { background: "#2a3342", color: "white" } : undefined}>
            <Sparkles size={18} />
          </button>
        )}
        <div className="fecha-top">
          <b>{hoy.getDate()}</b>
          <span><small>{MESES[hoy.getMonth()]}</small><small>{hoy.toLocaleDateString("es-CO", { weekday: "long" })}</small></span>
        </div>
        {demo && (
          <button className="top-btn" title="Pendientes para la reunión" onClick={() => nav("/reunion")}>
            <Bell size={18} />
            {pendientes > 0 && <span className="contador">{pendientes}</span>}
          </button>
        )}
        {!local && <IndicadorSync />}
        <Menu derecha boton={(abrir) => <button className="avatar-top" onClick={abrir} title={usuario}>{inicialesPersona(usuario)}</button>}>
          {(cerrar) => (
            <>
              <div className="titulo">{usuario}</div>
              {local && (
                <button className="menu-item" onClick={() => { ponerModoDemo(!demo); cerrar(); }}>
                  {demo ? <ToggleRight size={16} color="var(--primario)" /> : <ToggleLeft size={16} />}
                  Modo demo (pendientes de la reunión)
                </button>
              )}
              <button className="menu-item" onClick={() => { ponerTema(oscuro ? "claro" : "oscuro"); cerrar(); }}>
                {oscuro ? <Sun size={15} /> : <Moon size={15} />}{oscuro ? "Modo claro" : "Modo oscuro"}
              </button>
              <button className="menu-item" onClick={() => { nav("/configuracion"); cerrar(); }}><Settings size={15} />Configuración</button>
              <hr />
              <button className="menu-item" onClick={async () => {
                cerrar();
                const aviso = await salir();
                if (aviso && (await confirmar({ titulo: "Hay cambios sin enviar", texto: aviso, boton: "Salir de todas formas", peligro: true }))) await salir(true);
              }}><LogOut size={15} />Cerrar sesión</button>
            </>
          )}
        </Menu>
      </div>

      <div className="cuerpo">
        <nav className="lateral">
          <div className="seccion">Principal</div>
          {PRINCIPAL.map((m) => {
            // Descuentos del mes avisa en rojo cuántas personas faltan por contactar.
            const alerta = m.a === "/descuentos" && !!porContactar;
            return (
              <NavLink key={m.a} to={m.a} end={m.a === "/"} className={`${activo(m.a, m.tambien) ? "active" : ""} ${alerta ? "con-alerta" : ""}`}
                title={alerta ? `${m.texto}: ${porContactar} por contactar` : m.texto}>
                <m.icono size={17} /><span>{m.texto}</span>
                {alerta && <b className="insignia roja">{porContactar}</b>}
              </NavLink>
            );
          })}
          <a href="#" className="seccion-boton" onClick={(e) => { e.preventDefault(); setMasAbierto(!masAbierto); }} title="Más opciones">
            {masAbierto ? <ChevronDown size={17} /> : <ChevronRight size={17} />}<span>Más</span>
          </a>
          {masAbierto && (
            <>
              {MAS.map((m) => (
                <NavLink key={m.a} to={m.a} title={m.texto} className="sub">
                  <m.icono size={17} /><span>{m.texto}</span>
                </NavLink>
              ))}
              {demo && (
                <NavLink to="/reunion" title="Para la reunión" className="sub">
                  <ClipboardList size={17} /><span>Para la reunión</span>
                  {pendientes > 0 && <b className="insignia">{pendientes}</b>}
                </NavLink>
              )}
            </>
          )}
          <a className="colapsar" href="#" onClick={(e) => { e.preventDefault(); alternar(); }} title={colapsada ? "Expandir menú" : "Contraer menú"}>
            {colapsada ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>Contraer menú</span>
          </a>
        </nav>

        <div className="principal">
          {demo && (
            <div className="banda-demo">
              <ClipboardList size={14} />
              Modo demo: se muestran los pendientes para la reunión con el cliente. Se apaga desde el menú de usuario.
            </div>
          )}
          {errorCarga && <div className="aviso error" style={{ margin: "12px 24px 0" }}>No se pudo cargar la demo: {errorCarga}</div>}
          <Routes>
            <Route path="/" element={<Afiliados />} />
            <Route path="/descuentos" element={<DescuentosMes />} />
            <Route path="/base" element={<Navigate to="/" replace />} />
            <Route path="/afiliados" element={<Navigate to="/" replace />} />
            <Route path="/afiliados/:id" element={<FichaAfiliado />} />
            <Route path="/nuevo" element={<NuevaAfiliacion />} />
            <Route path="/cumpleanos" element={<Cumpleanos />} />
            <Route path="/resumen" element={<Inicio />} />
            <Route path="/hijos" element={<Hijos />} />
            <Route path="/historial" element={<Navigate to="/descuentos?vista=mes" replace />} />
            <Route path="/cruces/:id" element={<ResultadoGuardado />} />
            <Route path="/cruce" element={<Navigate to="/descuentos" replace />} />
            <Route path="/eventos" element={<Eventos />} />
            <Route path="/eventos/:id" element={<Eventos />} />
            <Route path="/asistente" element={<AbrirAsistente />} />
            <Route path="/reunion" element={<Reunion />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="/datos" element={<Navigate to="/configuracion?seccion=datos" replace />} />
          </Routes>
        </div>
      </div>

      {iaActiva && <AsistenteIA />}
      {paleta && <Paleta onCerrar={() => setPaleta(false)} afiliados={afiliados ?? []} rutas={rutas} />}
      {carga && (
        <div className="cargando">
          <div className="caja">
            <div className="giro" />
            <b style={{ color: "var(--texto)" }}>Preparando la demo</b>
            <span>{carga}…</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Enlaces viejos a /asistente: abren el panel y vuelven a la base de datos. */
function AbrirAsistente() {
  useEffect(() => { abrirAsistente(true); }, []);
  return <Navigate to="/" replace />;
}
