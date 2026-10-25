import { eq } from "drizzle-orm";
import { createAuth, isAdminEmail } from "../../auth";
import { createDb, schema, type Env } from "../../db";

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

  const user = session.user as { id: string; email?: string; role?: string };
  const email = String(user.email || "").trim().toLowerCase();
  const whitelisted = isAdminEmail(email);

  if (user.role !== "admin" && !whitelisted) {
    return new Response(JSON.stringify({ error: "Acceso denegado. Se requiere rol de administrador." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (whitelisted && user.role !== "admin") {
    try {
      const db = createDb(context.env);
      await db
        .update(schema.users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(eq(schema.users.id, user.id));
      user.role = "admin";
    } catch (error) {
      console.error("[admin/_middleware] role sync failed", error);
    }
  }

  context.data.adminUser = user;
  return context.next();
};
