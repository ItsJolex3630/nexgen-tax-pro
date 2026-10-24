import { createAuth } from "../../auth";
import type { Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
  data: Record<string, unknown>;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const auth = createAuth(context.env, context.request);
  const session = await auth.api.getSession({
    headers: context.request.headers,
  });

  if (!session || !session.user) {
    return new Response(JSON.stringify({ error: "No autenticado. Inicia sesión como administrador." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if ((session.user as { role?: string }).role !== "admin") {
    return new Response(JSON.stringify({ error: "Acceso denegado. Se requiere rol de administrador." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  context.data.adminUser = session.user;
  return context.next();
};
