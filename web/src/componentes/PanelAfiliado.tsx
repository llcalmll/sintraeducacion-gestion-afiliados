import { useLiveQuery } from "dexie-react-hooks";
import { FileText, MessageCircle, Phone } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { db } from "../datos/db";
import { useUltimoCruce } from "../datos/hooks";
import { useModoDemo } from "../datos/preferencias";
import type { Afiliado } from "../datos/tipos";
import { edad, fechaLarga } from "../logica/fechas";
import { formularioAfiliacionPDF } from "../logica/pdf";
import { faltantesAfiliado } from "../logica/pendientes";
import { esVacio } from "../logica/texto";
import { Avatar, BadgeEntidad, BadgeEstado, BadgeResultado, Panel } from "./ui";

/** Vista rápida de un afiliado en un panel lateral. */
export function PanelAfiliado({ afiliadoId, onCerrar }: { afiliadoId: number | null; onCerrar: () => void }) {
  const a = useLiveQuery(() => (afiliadoId ? db.afiliados.get(afiliadoId) : undefined), [afiliadoId]);
  const hijos = useLiveQuery(() => (afiliadoId ? db.hijos.where("afiliadoId").equals(afiliadoId).toArray() : []), [afiliadoId]) ?? [];
  const ultimo = useUltimoCruce();
  const demo = useModoDemo();
  const nav = useNavigate();
  const abierto = !!afiliadoId && !!a;
  const d = a ? ultimo?.porAfiliado.get(a.id!) : undefined;
  const tel = a?.celular.replace(/\D/g, "") ?? "";

  return (
    <Panel
      abierto={abierto}
      onCerrar={onCerrar}
      cabecera={a && (
        <div className="fila" style={{ gap: 12 }}>
          <Avatar nombre={a.nombre} grande />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 16 }}>{a.nombre}</h2>
            <div className="fila-wrap" style={{ marginTop: 6 }}>
              <BadgeEstado estado={a.estado} />
              <BadgeEntidad p={a.pagador} corta />
              {d && <BadgeResultado r={d.resultado} />}
            </div>
          </div>
        </div>
      )}
      pie={a && (
        <>
          <button className="btn btn-primario" onClick={() => nav(`/afiliados/${a.id}`)}>Ver ficha completa</button>
          {tel.length === 10 && <a className="btn" href={`https://wa.me/57${tel}`} target="_blank" rel="noreferrer"><MessageCircle size={15} />WhatsApp</a>}
          {tel.length >= 7 && <a className="btn btn-icono" href={`tel:${tel}`} title="Llamar"><Phone size={15} /></a>}
          <button className="btn btn-icono" title="Formato de afiliación" onClick={() => formularioAfiliacionPDF(a.tipo, a)}><FileText size={15} /></button>
        </>
      )}
    >
      {a && <Contenido a={a} hijos={hijos.map((h) => h.nombre)} demo={demo} faltan={faltantesAfiliado(a, hijos).filter((x) => x.campo !== "Datos del formulario")} />}
    </Panel>
  );
}

function Contenido({ a, hijos, demo, faltan }: { a: Afiliado; hijos: string[]; demo: boolean; faltan: { campo: string; solicitar: string }[] }) {
  const D = ({ k, v }: { k: string; v: string | number | null | undefined }) => (
    <div><dt>{k}</dt><dd>{v === null || v === undefined || v === "" || esVacio(String(v)) ? <span className="vacio-celda">—</span> : v}</dd></div>
  );
  return (
    <>
      <dl className="dl" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <D k="Cédula" v={a.cedula} />
        <D k="Celular" v={a.celular} />
        <D k="Correo" v={a.correo} />
        <D k="Municipio" v={a.municipio} />
        <D k="Institución" v={a.institucion} />
        <D k="Cargo" v={a.cargo} />
        <D k="Nacimiento" v={a.fechaNacimiento ? `${fechaLarga(a.fechaNacimiento)} (${edad(a.fechaNacimiento)} años)` : a.fechaNacimientoOriginal} />
        <D k="Afiliación" v={a.fechaAfiliacion ? fechaLarga(a.fechaAfiliacion) : a.fechaAfiliacionOriginal} />
        <D k="Quién lo afilia" v={a.quienAfilia} />
        <D k="Hijos" v={hijos.length ? hijos.join(", ") : "Ninguno registrado"} />
      </dl>
      {a.observaciones && (
        <div>
          <div className="peq tenue" style={{ marginBottom: 4 }}>Observaciones</div>
          <div>{a.observaciones}</div>
        </div>
      )}
      {demo && faltan.length > 0 && (
        <div className="pila" style={{ gap: 8 }}>
          <h3>Pendientes para la reunión ({faltan.length})</h3>
          {faltan.map((x) => <div key={x.campo} className="pendiente"><div><b>{x.campo}. </b>{x.solicitar}</div></div>)}
        </div>
      )}
    </>
  );
}
