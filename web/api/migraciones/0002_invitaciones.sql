-- Quién compartió el acceso a cada persona y cuándo (responsabilidad sobre los datos).
ALTER TABLE usuarios ADD COLUMN invitado_por TEXT;
ALTER TABLE usuarios ADD COLUMN invitado_en TEXT;
