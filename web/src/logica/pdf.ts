import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Afiliado, Evento } from "../datos/tipos";
import logoPdf from "../assets/logo-sintraeducacion-pdf.png";
import { fechaLarga } from "./fechas";

const SINDICATO = "SINDICATO DE EJEMPLO";
const PERSONERIA = "Personería Jurídica de ejemplo · Nit: 000.000.000-0";
const PIE = [
  "Dirección de ejemplo",
  "Cel: 300 000 0000 · usuario@ejemplo.com",
];
const VERDE: [number, number, number] = [23, 92, 60];

/** El logo como data URL, para incrustarlo en el PDF. Se carga una vez. */
let logoDatos: Promise<string> | null = null;
function cargarLogo(): Promise<string> {
  logoDatos ??= fetch(logoPdf).then((r) => r.blob()).then((b) => new Promise<string>((res, rej) => {
    const lector = new FileReader();
    lector.onload = () => res(String(lector.result));
    lector.onerror = () => rej(lector.error);
    lector.readAsDataURL(b);
  }));
  return logoDatos;
}

function encabezado(doc: jsPDF, titulo: string, logo?: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...VERDE);
  doc.rect(0, 0, w, 22, "F");
  // Logo a la izquierda de la franja (proporción del original 600 x 491)
  // sobre un recuadro blanco, para que no se pierda contra el verde.
  if (logo) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(6, 1.5, 26, 19, 2, 2, "F");
    doc.addImage(logo, "PNG", 8, 2, 22, 18);
  }
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(SINDICATO, w / 2, 9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(PERSONERIA, w / 2, 15, { align: "center" });
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(titulo, w / 2, 32, { align: "center" });
  doc.setFont("helvetica", "normal");
}

function pie(doc: jsPDF) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFontSize(7.5);
  doc.setTextColor(90);
  PIE.forEach((l, i) => doc.text(l, w / 2, h - 10 + i * 4, { align: "center" }));
  doc.setTextColor(0);
}

export async function planillaAsistenciaPDF(e: Evento, afiliados: Afiliado[]) {
  const doc = new jsPDF({ orientation: "landscape", format: "letter", unit: "mm" });
  // Sin el logo (por ejemplo, sin conexión la primera vez) la planilla sale igual.
  encabezado(doc, "PLANILLA DE ASISTENCIA", await cargarLogo().catch(() => undefined));
  doc.setFontSize(11);
  doc.text(`Evento: ${e.nombre}`, 14, 42);
  doc.text(`Fecha: ${fechaLarga(e.fecha)}`, 14, 48);
  doc.text(`Lugar: ${e.lugar || "________________"}`, 140, 42);
  doc.text(`Invitados: ${afiliados.length}`, 140, 48);
  autoTable(doc, {
    startY: 54,
    head: [["N°", "Cédula", "Nombres y apellidos", "Institución / entidad", "Celular", "Firma"]],
    body: afiliados.map((a, i) => [i + 1, a.cedula ?? "", a.nombre, a.institucion || a.pagador, a.celular, ""]),
    styles: { fontSize: 9, cellPadding: 2.2, minCellHeight: 9, valign: "middle" },
    headStyles: { fillColor: VERDE },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 26 }, 2: { cellWidth: 70 }, 4: { cellWidth: 26 }, 5: { cellWidth: 55 } },
    didDrawPage: () => pie(doc),
    margin: { bottom: 18 },
  });
  doc.save(`Planilla asistencia ${e.nombre} ${e.fecha}.pdf`);
}

function linea(doc: jsPDF, etiqueta: string, valor: string, x: number, y: number, ancho: number) {
  doc.setFont("helvetica", "bold");
  doc.text(etiqueta, x, y);
  const lx = x + doc.getTextWidth(etiqueta) + 2;
  doc.setFont("helvetica", "normal");
  doc.text(valor || "", lx + 1, y - 0.8);
  doc.setDrawColor(150);
  doc.line(lx, y + 1, x + ancho, y + 1);
}

const marca = (v: boolean) => (v ? "X" : " ");

/** Formato de afiliación, igual al del sindicato. Si no hay afiliado, sale en blanco para imprimir. */
export async function formularioAfiliacionPDF(tipo: "docente" | "administrativo", a?: Afiliado) {
  const doc = new jsPDF({ format: "letter", unit: "mm" });
  const w = doc.internal.pageSize.getWidth();
  // Sin el logo (por ejemplo, sin conexión la primera vez) el formato sale igual.
  const logo = await cargarLogo().catch(() => undefined);
  encabezado(doc, "SOLICITUD DE AFILIACIÓN", logo);
  doc.setFontSize(11);
  let y = 46;
  ["Señores", "JUNTA DIRECTIVA SINTRA EDUCACIÓN DEL TOLIMA", "Ibagué, Tolima"].forEach((t) => (doc.text(t, 20, y), (y += 6)));
  y += 6;
  const cuota = tipo === "docente"
    ? "a realizar el pago de las cuotas ordinarias mensualmente con un valor para los docentes del 0,5 y extraordinarias."
    : "a realizar el pago de las cuotas ordinarias y extraordinarias.";
  const cuerpo =
    `Por medio de la presente YO ${a?.nombre || "______________________________________"}, identificado(a) con cédula de ciudadanía ` +
    `número ${a?.cedula || "________________"} de ${a?.cedulaExpedidaEn || "______________"}, me permito solicitar ser afiliado(a) al ` +
    `Sindicato de Trabajadores de Educación y Servidores Públicos del Tolima SINTRAEDUCACIÓN, me comprometo a cumplir con los estatutos, y ${cuota}`;
  doc.text(doc.splitTextToSize(cuerpo, w - 40), 20, y, { lineHeightFactor: 1.6 });
  y += 40;
  doc.text("Autorizo al señor(a) tesorero(a) del sindicato para efectuar el descuento correspondiente ante el pagador de la entidad:", 20, y, { maxWidth: w - 40 });
  y += 14;
  const p = a?.pagador ?? "";
  doc.text(`[${marca(/Tolima/.test(p))}] Secretaría de Educación del Tolima`, 24, y);
  doc.text(`[${marca(/Educación de Ibagué/.test(p))}] Secretaría de Educación de Ibagué`, 112, y);
  if (tipo === "administrativo") {
    y += 9;
    const alc = /^Alcald/i.test(p) ? p.replace(/^Alcald[ií]a de /i, "") : "";
    const per = /^Personer/i.test(p) ? p.replace(/^Personer[ií]a de /i, "") : "";
    doc.text(`[${marca(!!alc)}] Alcaldía de ${alc || "______________"}`, 24, y);
    doc.text(`[${marca(!!per)}] Personería de ${per || "______________"}`, 112, y);
  }
  y += 30;
  doc.text("Cordialmente,", 20, y);
  y += 26;
  doc.line(20, y, 90, y);
  doc.line(110, y, 180, y);
  doc.text(a?.nombre || "NOMBRE Y APELLIDO", 20, y + 5);
  doc.text(a?.cedula || "No DE CÉDULA", 110, y + 5);
  doc.line(20, y + 26, 90, y + 26);
  doc.text("FIRMA", 20, y + 31);
  pie(doc);

  doc.addPage();
  encabezado(doc, "FICHA PERSONAL", logo);
  doc.setFontSize(10.5);
  y = 46;
  const L = (e: string, v = "", x = 20, ancho = w - 40) => linea(doc, e, v, x, y, x + ancho > w - 20 ? w - 20 - x : ancho);
  L("NOMBRES Y APELLIDOS:", a?.nombre); y += 10;
  L("CÉDULA:", a?.cedula ?? "", 20, 80); L("EXPEDIDA EN:", a?.cedulaExpedidaEn, 105); y += 10;
  L("FECHA DE NACIMIENTO:", a?.fechaNacimiento ? fechaLarga(a.fechaNacimiento) : a?.fechaNacimientoOriginal); y += 10;
  L("TELÉFONO FIJO:", a?.telefonoFijo, 20, 80); L("CELULAR:", a?.celular, 105); y += 10;
  L("CORREO ELECTRÓNICO:", a?.correo); y += 16;
  doc.setFont("helvetica", "bold");
  doc.text("INFORMACIÓN LABORAL", 20, y); y += 10;
  L("MUNICIPIO:", a?.municipio); y += 10;
  L("ENTIDAD:", a?.pagador); y += 10;
  L("INSTITUCIÓN EDUCATIVA QUE LABORA:", a?.institucion); y += 10;
  if (tipo === "docente") { L("CARGO:", a?.cargo, 20, 95); L("ÁREA:", a?.area, 120); }
  else L("CARGO:", a?.cargo);
  y += 10;
  const caja = (a?.cajaCompensacion ?? "").toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.text(`CAJA COMPENSACIÓN:   COMFENALCO [${marca(caja.includes("COMFENALCO"))}]   COMFATOLIMA [${marca(caja.includes("COMFATOLIMA"))}]`, 20, y); y += 10;
  L("COMUNA:", a?.comuna, 20, 80); y += 10;
  const v = (a?.vinculacion ?? "").toUpperCase();
  doc.setFont("helvetica", "bold");
  doc.text(`PROVISIONAL [${marca(v.includes("PROVISIONAL"))}]   DE CARRERA [${marca(v.includes("CARRERA"))}]   DESVINCULADO [${marca(a?.estado === "desvinculado")}]`, 20, y); y += 10;
  L("FECHA DE POSESIÓN:", a?.fechaPosesion ? fechaLarga(a.fechaPosesion) : ""); y += 10;
  L("FECHA DE AFILIACIÓN:", a?.fechaAfiliacion ? fechaLarga(a.fechaAfiliacion) : a?.fechaAfiliacionOriginal); y += 10;
  L("QUIEN LO AFILIA:", a?.quienAfilia);
  pie(doc);
  doc.save(`Formato afiliacion ${tipo}${a ? " " + a.nombre : ""}.pdf`);
}

