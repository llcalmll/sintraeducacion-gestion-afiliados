# Sintraeducación · Gestión de afiliados

Aplicación web para que un sindicato de educación gestione sus afiliados, sin depender de hojas de Excel sueltas: base de datos, descuentos de nómina de cada mes, eventos, cumpleaños e hijos.

> **Copia de portafolio.** Es el código de la aplicación con los datos de la organización cambiados por valores de ejemplo. No incluye datos de afiliados, secretos, configuración de acceso ni los videos del proyecto. Para ejecutarla hace falta configurar tu propia cuenta de Cloudflare.

## Qué hace
- **Base de datos con vista tipo Excel:** conserva las hojas y columnas de siempre, permite editar en la celda y exporta de nuevo a Excel.
- **Cruce de descuentos del mes:** lee los reportes de nómina de cada entidad (Excel y PDF) e identifica a quién no le descontaron, para hacerle seguimiento.
- **Fichas de afiliado,** nuevas afiliaciones, hijos, cumpleaños y asistencia a eventos.
- **Documentos en PDF** generados desde la aplicación.
- **Cuentas de usuario,** con los datos compartidos entre equipos.

## Tecnología
- **Interfaz:** React, TypeScript, Vite y React Router.
- **Datos en el navegador:** Dexie (IndexedDB).
- **Archivos:** SheetJS, pdf.js y jsPDF.
- **Servidor:** Cloudflare Pages Functions, D1 y R2.

## Ejecutarla
```bash
cd web
npm install
npm run dev
```

Para publicarla, cambia los identificadores de `web/wrangler.toml` por los de tu cuenta y define tus propios secretos. El modo de demostración original usa archivos reales que no están en este repositorio, así que la app arranca sin datos.
