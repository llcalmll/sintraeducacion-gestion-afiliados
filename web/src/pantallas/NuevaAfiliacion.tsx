import { useLiveQuery } from "dexie-react-hooks";
import { Briefcase, FileText, GraduationCap, Paperclip, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Cabecera, useUI } from "../componentes/ui";
import { db } from "../datos/db";
import { PAG_IBAGUE, PAG_TOLIMA, type Afiliado, type Tipo } from "../datos/tipos";
import { periodoActual, periodoAnterior } from "../logica/fechas";
import { nuevoAfiliado } from "../logica/importarMaestro";
import { ACEPTA, hayArchivos, subirRegistroCivil } from "../logica/archivos";
import { formularioAfiliacionPDF } from "../logica/pdf";

/** Formulario de afiliación. Replica los dos formatos del sindicato: docente y administrativo. */
export default function NuevaAfiliacion() {
  const nav = useNavigate();
  const { avisar } = useUI();
  // Si el asistente abrió el formulario, llega con los datos que le dictaron.
  const prefill = (useLocation().state as { prefill?: Partial<Afiliado> & { tipo?: Tipo } } | null)?.prefill;
  const [tipo, setTipo] = useState<Tipo>(prefill?.tipo ?? "docente");
  const [a, setA] = useState<Afiliado>(() => nuevoAfiliado({
    estado: "pendiente_novedad",
    ...Object.fromEntries(Object.entries(prefill ?? {}).filter(([k, v]) => v && k !== "tipo")),
    pagador: prefill?.pagador || PAG_IBAGUE,
  }));
  const [otra, setOtra] = useState({ clase: "Alcaldía", lugar: "" });
  const [hijos, setHijos] = useState<{ nombre: string; fecha: string; registro: string; archivo: File | null }[]>([]);
  const [error, setError] = useState("");
  const [existente, setExistente] = useState<number | null>(null);
  const conocidas = useLiveQuery(async () => [...new Set((await db.afiliados.toArray()).map((x) => x.pagador))], []) ?? [];
  const c = (k: keyof Afiliado, v: unknown) => setA((p) => ({ ...p, [k]: v }));
  const opciones = tipo === "docente" ? [PAG_TOLIMA, PAG_IBAGUE] : [PAG_TOLIMA, PAG_IBAGUE, "otra"];
  const pagadorFinal = a.pagador === "otra" ? `${otra.clase} de ${otra.lugar.trim()}` : a.pagador;

  async function guardar(imprimir: boolean) {
    setError("");
    setExistente(null);
    const ced = a.cedula?.replace(/\D/g, "") || null;
    if (!a.nombre.trim() || !ced) return setError("El nombre y la cédula son obligatorios.");
    if (a.pagador === "otra" && !otra.lugar.trim()) return setError("Escriba el municipio de la alcaldía o personería.");
    const existe = await db.afiliados.where("cedula").equals(ced).first();
    if (existe) {
      setExistente(existe.id ?? null);
      return setError(`La cédula ${ced} ya está registrada a nombre de ${existe.nombre}${existe.estado === "activo" ? "" : ` (estado: ${existe.estado.replace("_", " ")})`}. Si se está volviendo a afiliar, abra su ficha y use el botón "Reafiliar".`);
    }
    const nuevo: Afiliado = {
      ...a, cedula: ced, nombre: a.nombre.trim().toUpperCase(), tipo, tipoInferido: false, pagador: pagadorFinal,
      // La novedad se envía este mes; el descuento se espera desde el siguiente.
      novedadPeriodo: periodoAnterior(periodoActual(), -1),
      fechaNacimientoOriginal: a.fechaNacimiento ?? "", fechaAfiliacionOriginal: a.fechaAfiliacion ?? "",
      actualizadoEn: new Date().toISOString(),
    };
    const id = (await db.afiliados.add(nuevo)) as number;
    const conNombre = hijos.filter((h) => h.nombre.trim());
    const idsHijos = (await db.hijos.bulkAdd(conNombre.map((h) => ({
      afiliadoId: id, nombre: h.nombre.trim(), fechaNacimiento: h.fecha || null, fechaNacimientoOriginal: h.fecha, registroCivil: h.registro.trim(), afiliado: null,
    })), { allKeys: true })) as number[];
    // Los registros civiles se suben después de crear a cada hijo; si alguno falla, el afiliado igual queda creado.
    const fallidos: string[] = [];
    for (const [i, h] of conNombre.entries()) {
      if (!h.archivo) continue;
      try { await db.hijos.update(idsHijos[i], { registroCivilArchivo: await subirRegistroCivil(idsHijos[i], h.archivo) }); } catch { fallidos.push(h.nombre.trim()); }
    }
    if (fallidos.length) avisar(`No se pudo subir el registro civil de ${fallidos.join(", ")}. Adjúntelo desde la ficha, pestaña Hijos.`, "error");
    if (imprimir) formularioAfiliacionPDF(tipo, { ...nuevo, id });
    avisar("Afiliado creado como pendiente de novedad");
    nav(`/afiliados/${id}`);
  }

  const T = (k: keyof Afiliado, t: string, o: { type?: string; ancho?: boolean; req?: boolean } = {}) => (
    <div className={o.ancho ? "ancho" : ""}>
      <label className="etq">{t}{o.req && <span style={{ color: "var(--rojo)" }}> *</span>}</label>
      <input className="input" type={o.type ?? "text"} value={String(a[k] ?? "")} onChange={(e) => c(k, o.type === "date" ? e.target.value || null : e.target.value)} />
    </div>
  );

  return (
    <>
      <Cabecera migas={[{ t: "Afiliados", a: "/" }, { t: "Nueva afiliación" }]} titulo="Nueva afiliación" sub="Al guardar queda como pendiente de novedad hasta que aparezca el primer descuento.">
        <div className="seg">
          <button className={tipo === "docente" ? "on" : ""} onClick={() => { setTipo("docente"); if (a.pagador === "otra") c("pagador", PAG_IBAGUE); }}><GraduationCap size={14} />Docente</button>
          <button className={tipo === "administrativo" ? "on" : ""} onClick={() => setTipo("administrativo")}><Briefcase size={14} />Administrativo</button>
        </div>
        <button className="btn" onClick={() => formularioAfiliacionPDF(tipo)}><FileText size={15} />Formato en blanco</button>
      </Cabecera>

      <form className="contenido" onSubmit={(e) => { e.preventDefault(); guardar(false); }}>
        <div className="card">
          <div className="card-cab"><h3>Datos personales</h3></div>
          <div className="card-cuerpo rejilla">
            {T("nombre", "Nombres y apellidos", { ancho: true, req: true })}
            {T("cedula", "Cédula", { req: true })}
            {T("cedulaExpedidaEn", "Expedida en")}
            {T("fechaNacimiento", "Fecha de nacimiento", { type: "date" })}
            <div>
              <label className="etq">Sexo</label>
              <select className="select" value={a.sexo} onChange={(e) => c("sexo", e.target.value)}><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option></select>
            </div>
            {T("telefonoFijo", "Teléfono fijo")}
            {T("celular", "Celular")}
            {T("correo", "Correo electrónico", { type: "email" })}
          </div>
        </div>

        <div className="card">
          <div className="card-cab"><h3>Información laboral</h3></div>
          <div className="card-cuerpo rejilla">
            {T("municipio", "Municipio")}
            <div>
              <label className="etq">Entidad que hace el descuento</label>
              <select className="select" value={a.pagador} onChange={(e) => c("pagador", e.target.value)}>
                {opciones.map((o) => <option key={o} value={o}>{o === "otra" ? "ALCALDÍA O PERSONERÍA" : o.toLocaleUpperCase("es-CO")}</option>)}
              </select>
            </div>
            {a.pagador === "otra" && (
              <>
                <div>
                  <label className="etq">Tipo de entidad</label>
                  <select className="select" value={otra.clase} onChange={(e) => setOtra((p) => ({ ...p, clase: e.target.value }))}><option>Alcaldía</option><option>Personería</option></select>
                </div>
                <div>
                  <label className="etq">Municipio de la entidad</label>
                  <input className="input" list="entidades" value={otra.lugar} onChange={(e) => setOtra((p) => ({ ...p, lugar: e.target.value }))} />
                  <datalist id="entidades">{conocidas.filter((p) => /^(Alcald|Personer)/i.test(p)).map((p) => <option key={p} value={p.replace(/^\S+ de /, "")} />)}</datalist>
                </div>
              </>
            )}
            {T("institucion", tipo === "docente" ? "Institución educativa donde labora" : "Institución o dependencia donde labora", { ancho: true })}
            {T("cargo", "Cargo")}
            {tipo === "docente" && T("area", "Área")}
            <div>
              <label className="etq">Caja de compensación</label>
              <select className="select" value={a.cajaCompensacion} onChange={(e) => c("cajaCompensacion", e.target.value)}><option value="">—</option><option>COMFENALCO</option><option>COMFATOLIMA</option></select>
            </div>
            {T("comuna", "Comuna")}
            <div>
              <label className="etq">Vinculación</label>
              <select className="select" value={a.vinculacion} onChange={(e) => c("vinculacion", e.target.value)}><option value="">—</option><option>PROVISIONAL</option><option>CARRERA</option></select>
            </div>
            {T("fechaPosesion", "Fecha de posesión", { type: "date" })}
            {T("fechaAfiliacion", "Fecha de afiliación", { type: "date" })}
            {T("quienAfilia", "Quién lo afilia")}
          </div>
        </div>

        <div className="card">
          <div className="card-cab"><h3>Hijos</h3><button type="button" className="btn btn-sm accion" onClick={() => setHijos([...hijos, { nombre: "", fecha: "", registro: "", archivo: null }])}><Plus size={14} />Agregar hijo</button></div>
          <div className="card-cuerpo pila" style={{ gap: 10 }}>
            {hijos.length === 0 && <span className="muted peq">Si tiene hijos, agréguelos con su registro civil.</span>}
            {hijos.map((h, i) => (
              <div className="fila-wrap" key={i} style={{ alignItems: "flex-end" }}>
                <div style={{ flex: 2, minWidth: 220 }}><label className="etq">Nombre del hijo {i + 1}</label><input className="input" value={h.nombre} onChange={(e) => setHijos(hijos.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} /></div>
                <div style={{ flex: 1, minWidth: 160 }}><label className="etq">Fecha de nacimiento</label><input className="input" type="date" value={h.fecha} onChange={(e) => setHijos(hijos.map((x, j) => (j === i ? { ...x, fecha: e.target.value } : x)))} /></div>
                <div style={{ flex: 1, minWidth: 160 }}><label className="etq">N.° de registro civil</label><input className="input" placeholder="Opcional" value={h.registro} onChange={(e) => setHijos(hijos.map((x, j) => (j === i ? { ...x, registro: e.target.value } : x)))} /></div>
                {hayArchivos() && (
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <label className="etq">Documento del registro civil</label>
                    {h.archivo ? (
                      <span className="fila" style={{ gap: 6, height: 36 }}>
                        <Paperclip size={14} className="tenue" /><span className="recorte" style={{ maxWidth: 150 }} title={h.archivo.name}>{h.archivo.name}</span>
                        <button type="button" className="btn btn-sm btn-fantasma btn-icono" title="Quitar el archivo" onClick={() => setHijos(hijos.map((x, j) => (j === i ? { ...x, archivo: null } : x)))}><X size={14} /></button>
                      </span>
                    ) : (
                      <label className="btn" style={{ width: "100%", justifyContent: "center" }}>
                        <Paperclip size={14} />Adjuntar foto o PDF
                        <input type="file" accept={ACEPTA} hidden onChange={(e) => { const f = e.target.files?.[0] ?? null; setHijos(hijos.map((x, j) => (j === i ? { ...x, archivo: f } : x))); }} />
                      </label>
                    )}
                  </div>
                )}
                <button type="button" className="btn btn-icono btn-fantasma" title="Quitar" onClick={() => setHijos(hijos.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-cab"><h3>Observaciones</h3></div>
          <div className="card-cuerpo">
            <textarea className="input" rows={3} value={a.observaciones} onChange={(e) => c("observaciones", e.target.value)} placeholder="Notas sobre la afiliación (opcional)" />
          </div>
        </div>

        {error && (
          <div className="aviso error">
            <span>{error}</span>
            {existente !== null && <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => nav(`/afiliados/${existente}`)}>Abrir su ficha</button>}
          </div>
        )}
        <div className="fila">
          <button className="btn btn-primario btn-lg"><Save size={16} />Guardar afiliado</button>
          <button type="button" className="btn btn-lg" onClick={() => guardar(true)}><FileText size={16} />Guardar e imprimir formato</button>
        </div>
      </form>
    </>
  );
}
