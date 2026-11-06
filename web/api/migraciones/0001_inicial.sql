-- Base de datos de Sintraeducación en Cloudflare D1.
--
-- La app guarda sus tablas (afiliados, hijos, cruces, contactos...) como registros
-- sincronizables: cada cambio recibe un número de versión global y los demás equipos
-- descargan lo que cambió desde la última versión que vieron.

CREATE TABLE registros (
  tabla       TEXT    NOT NULL,
  clave       TEXT    NOT NULL,
  datos       TEXT,               -- JSON del registro; NULL si se borró
  version     INTEGER NOT NULL,
  borrado     INTEGER NOT NULL DEFAULT 0,
  autor       TEXT,
  actualizado TEXT    NOT NULL,
  PRIMARY KEY (tabla, clave)
);
CREATE INDEX idx_registros_version ON registros(version);

-- Contador global de versiones (una sola fila).
CREATE TABLE contador (id INTEGER PRIMARY KEY CHECK (id = 1), valor INTEGER NOT NULL);
INSERT INTO contador (id, valor) VALUES (1, 0);

CREATE TABLE usuarios (
  usuario    TEXT PRIMARY KEY,
  nombre     TEXT NOT NULL,
  hash       TEXT NOT NULL,       -- PBKDF2-SHA256 en base64
  sal        TEXT NOT NULL,
  rol        TEXT NOT NULL DEFAULT 'usuaria',   -- 'admin' | 'usuaria'
  activo     INTEGER NOT NULL DEFAULT 1,
  creado     TEXT NOT NULL,
  intentos   INTEGER NOT NULL DEFAULT 0,        -- fallos seguidos al ingresar
  bloqueado_hasta TEXT
);

CREATE TABLE sesiones (
  token_hash TEXT PRIMARY KEY,    -- se guarda el hash, nunca el token
  usuario    TEXT NOT NULL,
  expira     TEXT NOT NULL,
  creada     TEXT NOT NULL
);
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario);
