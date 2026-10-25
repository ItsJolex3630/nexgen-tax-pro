import { eq } from "drizzle-orm";
import { createAuth, isAdminEmail } from "../../auth";
import { createDb, schema, type Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const auth = createAuth(context.env, context.request);
  const session = await auth.api.getSession({ headers: context.request.headers });

  const user = session?.user as { id: string; email?: string; role?: string } | undefined;
  if (!user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const email = String(user.email || "").trim().toLowerCase();
  const whitelisted = isAdminEmail(email);
  if (user.role !== "admin" && !whitelisted) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
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
      console.error("[admin/check] role sync failed", error);
    }
  }

  return new Response(JSON.stringify({ ok: true, admin: user }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
