import { desc, eq } from "drizzle-orm";
import { createDb, schema, type Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
  data: Record<string, unknown>;
}

const EFIN_STATUSES = ["pending_irs", "approved", "action_required", "not_started"] as const;
const WISP_STATUSES = ["completed", "pending", "exempt"] as const;
const LICENSE_TYPES = ["desktop_1040", "desktop_corp", "online", "none"] as const;
const BANK_PARTNERS = ["tpg", "refund_advantage", "eps", "none"] as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function allowed<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function adminName(data: Record<string, unknown>): string {
  const user = data.adminUser as { name?: string; email?: string } | undefined;
  return user?.name || user?.email || "Equipo NexGen";
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const db = createDb(context.env);
  const method = context.request.method;
  const url = new URL(context.request.url);

  if (method === "GET") {
    const rows = await db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        officeName: schema.users.officeName,
        role: schema.users.role,
        userPtin: schema.users.ptin,
        userEfin: schema.users.efin,
        userCreatedAt: schema.users.createdAt,
        profileId: schema.preparerProfiles.id,
        profilePtin: schema.preparerProfiles.ptin,
        profileEfin: schema.preparerProfiles.efin,
        efinStatus: schema.preparerProfiles.efinStatus,
        wispStatus: schema.preparerProfiles.wispStatus,
        licenseType: schema.preparerProfiles.licenseType,
        bankPartner: schema.preparerProfiles.bankPartner,
        season: schema.preparerProfiles.season,
        profileUpdatedAt: schema.preparerProfiles.updatedAt,
      })
      .from(schema.users)
      .leftJoin(schema.preparerProfiles, eq(schema.users.id, schema.preparerProfiles.userId))
      .orderBy(desc(schema.users.createdAt));

    const q = (url.searchParams.get("q") || "").toLowerCase();
    const efinStatus = url.searchParams.get("efinStatus") || "";
    const licenseType = url.searchParams.get("licenseType") || "";

    const preparers = rows
      .filter((row) => row.role !== "admin")
      .map((row) => ({
        userId: row.userId,
        profileId: row.profileId,
        name: row.name,
        email: row.email,
        phone: row.phone || "",
        officeName: row.officeName || "",
        role: row.role,
        ptin: row.profilePtin || row.userPtin || "",
        efin: row.profileEfin || row.userEfin || "",
        efinStatus: row.efinStatus || "not_started",
        wispStatus: row.wispStatus || "pending",
        licenseType: row.licenseType || "none",
        bankPartner: row.bankPartner || "none",
        season: row.season || "2026",
        updatedAt: row.profileUpdatedAt || row.userCreatedAt,
      }))
      .filter((row) => (efinStatus ? row.efinStatus === efinStatus : true))
      .filter((row) => (licenseType ? row.licenseType === licenseType : true))
      .filter((row) => {
        if (!q) return true;
        return [row.name, row.email, row.officeName, row.ptin, row.efin, row.phone]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });

    return json({
      preparers,
      summary: {
        total: preparers.length,
        efinApproved: preparers.filter((row) => row.efinStatus === "approved").length,
        efinPending: preparers.filter((row) => row.efinStatus === "pending_irs" || row.efinStatus === "not_started").length,
        wispCompleted: preparers.filter((row) => row.wispStatus === "completed").length,
        activeLicenses: preparers.filter((row) => row.licenseType !== "none").length,
      },
    });
  }

  if (method === "PATCH") {
    const body = await readBody(context.request);
    const userId = text(body.userId) || url.searchParams.get("userId") || "";
    if (!userId) return json({ error: "Falta el usuario del preparador." }, 400);

    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!userRows.length) return json({ error: "Preparador no encontrado." }, 404);

    if (body.efinStatus !== undefined && !allowed(EFIN_STATUSES, body.efinStatus)) {
      return json({ error: "Estatus EFIN no válido." }, 400);
    }
    if (body.wispStatus !== undefined && !allowed(WISP_STATUSES, body.wispStatus)) {
      return json({ error: "Estatus WISP no válido." }, 400);
    }
    if (body.licenseType !== undefined && !allowed(LICENSE_TYPES, body.licenseType)) {
      return json({ error: "Tipo de licencia no válido." }, 400);
    }
    if (body.bankPartner !== undefined && !allowed(BANK_PARTNERS, body.bankPartner)) {
      return json({ error: "Banco aliado no válido." }, 400);
    }

    const profilePatch: Partial<typeof schema.preparerProfiles.$inferInsert> = { updatedAt: new Date() };
    if (body.ptin !== undefined) profilePatch.ptin = text(body.ptin) || null;
    if (body.efin !== undefined) profilePatch.efin = text(body.efin) || null;
    if (body.efinStatus !== undefined) profilePatch.efinStatus = body.efinStatus as (typeof EFIN_STATUSES)[number];
    if (body.wispStatus !== undefined) profilePatch.wispStatus = body.wispStatus as (typeof WISP_STATUSES)[number];
    if (body.licenseType !== undefined) profilePatch.licenseType = body.licenseType as (typeof LICENSE_TYPES)[number];
    if (body.bankPartner !== undefined) profilePatch.bankPartner = body.bankPartner as (typeof BANK_PARTNERS)[number];
    if (body.season !== undefined) profilePatch.season = text(body.season) || "2026";

    const existing = await db
      .select()
      .from(schema.preparerProfiles)
      .where(eq(schema.preparerProfiles.userId, userId))
      .limit(1);

    const [profile] = existing.length
      ? await db
          .update(schema.preparerProfiles)
          .set(profilePatch)
          .where(eq(schema.preparerProfiles.userId, userId))
          .returning()
      : await db
          .insert(schema.preparerProfiles)
          .values({
            id: crypto.randomUUID(),
            userId,
            ptin: text(body.ptin) || null,
            efin: text(body.efin) || null,
            efinStatus: allowed(EFIN_STATUSES, body.efinStatus) ? body.efinStatus : "not_started",
            wispStatus: allowed(WISP_STATUSES, body.wispStatus) ? body.wispStatus : "pending",
            licenseType: allowed(LICENSE_TYPES, body.licenseType) ? body.licenseType : "none",
            bankPartner: allowed(BANK_PARTNERS, body.bankPartner) ? body.bankPartner : "none",
            season: text(body.season) || "2026",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

    const userPatch: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
    if (body.ptin !== undefined) userPatch.ptin = text(body.ptin) || null;
    if (body.efin !== undefined) userPatch.efin = text(body.efin) || null;
    if (Object.keys(userPatch).length > 1) {
      await db.update(schema.users).set(userPatch).where(eq(schema.users.id, userId));
    }

    const note = text(body.note);
    if (note) {
      await db.insert(schema.adminNotes).values({
        id: crypto.randomUUID(),
        entityType: "preparer",
        entityId: userId,
        authorName: adminName(context.data),
        content: note,
        createdAt: new Date(),
      });
    }

    return json({ profile });
  }

  return json({ error: "Método no permitido." }, 405);
};
