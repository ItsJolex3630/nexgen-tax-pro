import { createAuth } from "../../auth";
import type { Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const auth = createAuth(context.env);
  const session = await auth.api.getSession({ headers: context.request.headers });

  if (!session || (session.user as { role?: string }).role !== "admin") {
    return new Response(JSON.stringify({ error: "Acceso no autorizado" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify({ ok: true, admin: session.user }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
