/// <reference types="@cloudflare/workers-types" />
import { manejar, type Env } from "../../api/servidor";

// Todas las rutas /api/* las atiende el mismo manejador.
export const onRequest: PagesFunction<Env> = ({ request, env }) => manejar(request, env);
