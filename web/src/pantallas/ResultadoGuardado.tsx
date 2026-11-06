import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Cabecera, useUI, Vacio } from "../componentes/ui";
import { VistaResultado } from "../componentes/VistaResultado";
import { db } from "../datos/db";
import { useAfiliados } from "../datos/hooks";
import { nombrePeriodo } from "../logica/fechas";

export default function ResultadoGuardado() {
  const id = Number(useParams().id);
  const cruce = useLiveQuery(() => db.cruces.get(id), [id]);
  const detalle = useLiveQuery(() => db.cruceDetalle.where("cruceId").equals(id).toArray(), [id]);
  const afiliados = useAfiliados();
  const porId = useMemo(() => new Map((afiliados ?? []).map((a) => [a.id!, a])), [afiliados]);
  const { confirmar, avisar } = useUI();
  const nav = useNavigate();
  if (cruce === undefined || !detalle) return null;
  if (!cruce) return <div className="contenido"><Vacio titulo="No se encontró el cruce"><Link to="/descuentos?vista=mes">Volver a mes a mes</Link></Vacio></div>;
  return (
    <>
      <Cabecera
        migas={[{ t: "Descuentos mes a mes", a: "/descuentos?vista=mes" }, { t: nombrePeriodo(cruce.periodo) }]}
        titulo={`Detalle de ${nombrePeriodo(cruce.periodo)}`}
        sub={`Guardado el ${new Date(cruce.creadoEn).toLocaleString("es-CO")} por ${cruce.creadoPor}`}
      >
        <button className="btn btn-peligro" onClick={async () => {
          if (!(await confirmar({ titulo: `Borrar el mes de ${nombrePeriodo(cruce.periodo)}`, texto: "Se pierde el historial de ese mes.", boton: "Borrar", peligro: true }))) return;
          await db.cruceDetalle.where("cruceId").equals(id).delete();
          await db.cruces.delete(id);
          avisar("Cruce borrado");
          nav("/descuentos?vista=mes");
        }}><Trash2 size={15} />Borrar este mes</button>
      </Cabecera>
      <div className="contenido">
        <VistaResultado cruce={cruce} detalle={detalle} afiliados={porId} />
      </div>
    </>
  );
}
