import { desc, eq } from "drizzle-orm";
import { createDb, schema, type Database, type Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
  data: Record<string, unknown>;
}

const STATUSES = ["new", "contacted", "demo_scheduled", "trial_sent", "won", "lost"] as const;
const SOURCES = ["web_demo", "questionnaire", "whatsapp", "manual", "admin"] as const;
type LeadStatus = (typeof STATUSES)[number];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
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

async function syncLeadFinance(db: Database, lead: typeof schema.leads.$inferSelect): Promise<void> {
  const finId = `lead_${lead.id}`;
  if (lead.status === "won" && Number(lead.estimatedValue) > 0) {
    const values = {
      type: "income" as const,
      category: "software_taxwise",
      categoryDetail: null,
      description: `Venta cerrada (Lead): ${lead.name}`,
      amount: Number(lead.estimatedValue),
      season: "2026",
      status: "paid" as const,
      paymentMethod: "zelle",
      notes: lead.officeName ? `Oficina: ${lead.officeName}` : null,
    };
    const existing = await db
      .select()
      .from(schema.financialRecords)
      .where(eq(schema.financialRecords.id, finId))
      .limit(1);
    if (existing.length) {
      await db
        .update(schema.financialRecords)
        .set(values)
        .where(eq(schema.financialRecords.id, finId));
    } else {
      await db.insert(schema.financialRecords).values({
        id: finId,
        ...values,
        date: new Date(),
        createdAt: new Date(),
      });
    }
  } else {
    await db.delete(schema.financialRecords).where(eq(schema.financialRecords.id, finId));
  }
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const db = createDb(context.env);
  const method = context.request.method;
  const url = new URL(context.request.url);

  if (method === "GET") {
    const [leadRows, noteRows] = await Promise.all([
      db.select().from(schema.leads).orderBy(desc(schema.leads.updatedAt)),
      db.select().from(schema.adminNotes).orderBy(desc(schema.adminNotes.createdAt)),
    ]);

    const status = url.searchParams.get("status") || "";
    const topic = url.searchParams.get("topic") || "";
    const q = (url.searchParams.get("q") || "").toLowerCase();

    const leads = leadRows
      .filter((lead) => (status ? lead.status === status : true))
      .filter((lead) => (topic ? lead.topic === topic : true))
      .filter((lead) => {
        if (!q) return true;
        return [lead.name, lead.email, lead.phone, lead.officeName, lead.notes]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .map((lead) => ({
        ...lead,
        notesLog: noteRows
          .filter((note) => note.entityType === "lead" && note.entityId === lead.id)
          .map((note) => ({
            id: note.id,
            authorName: note.authorName,
            content: note.content,
            createdAt: note.createdAt,
          })),
      }));

    return json({ leads });
  }

  if (method === "POST") {
    const body = await readBody(context.request);
    const name = text(body.name);
    const email = text(body.email).toLowerCase();
    const phone = text(body.phone);

    if (!name || !email || !phone) {
      return json({ error: "Nombre, correo y teléfono son obligatorios." }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "El correo no tiene un formato válido." }, 400);
    }

    const topic = text(body.topic) || "software";
    const status = STATUSES.includes(text(body.status) as LeadStatus) ? (text(body.status) as LeadStatus) : "new";
    const source = SOURCES.includes(text(body.source) as (typeof SOURCES)[number]) ? text(body.source) : "manual";
    const now = new Date();
    const id = text(body.id) || crypto.randomUUID();
    const notes = text(body.notes) || null;
    const author = adminName(context.data);

    const [lead] = await db
      .insert(schema.leads)
      .values({
        id,
        name,
        email,
        phone,
        officeName: text(body.officeName) || null,
        topic,
        status,
        notes,
        source,
        estimatedValue: money(body.estimatedValue),
        assignedTo: text(body.assignedTo) || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (notes) {
      await db.insert(schema.adminNotes).values({
        id: crypto.randomUUID(),
        entityType: "lead",
        entityId: id,
        authorName: author,
        content: notes,
        createdAt: now,
      });
    }

    await syncLeadFinance(db, lead);
    return json({ lead }, 201);
  }

  if (method === "PATCH") {
    const body = await readBody(context.request);
    const id = text(body.id) || url.searchParams.get("id") || "";
    if (!id) return json({ error: "Falta el id del prospecto." }, 400);

    const existing = await db.select().from(schema.leads).where(eq(schema.leads.id, id)).limit(1);
    if (!existing.length) return json({ error: "Prospecto no encontrado." }, 404);

    if (body.name !== undefined && !text(body.name)) {
      return json({ error: "El nombre es obligatorio." }, 400);
    }
    if (body.phone !== undefined && !text(body.phone)) {
      return json({ error: "El teléfono es obligatorio." }, 400);
    }
    if (body.email !== undefined) {
      const email = text(body.email).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "El correo no tiene un formato válido." }, 400);
      }
    }
    if (body.source !== undefined && !SOURCES.includes(text(body.source) as (typeof SOURCES)[number])) {
      return json({ error: "El origen no es válido." }, 400);
    }

    const patch: Partial<typeof schema.leads.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = text(body.name);
    if (body.email !== undefined) patch.email = text(body.email).toLowerCase();
    if (body.phone !== undefined) patch.phone = text(body.phone);
    if (body.source !== undefined) patch.source = text(body.source);
    if (body.officeName !== undefined) patch.officeName = text(body.officeName) || null;
    if (body.topic !== undefined) patch.topic = text(body.topic) || "software";
    if (body.status !== undefined) {
      if (!STATUSES.includes(text(body.status) as LeadStatus)) {
        return json({ error: "Estado de prospecto no válido." }, 400);
      }
      patch.status = text(body.status) as LeadStatus;
    }
    if (body.notes !== undefined) patch.notes = text(body.notes) || null;
    if (body.estimatedValue !== undefined) patch.estimatedValue = money(body.estimatedValue);
    if (body.assignedTo !== undefined) patch.assignedTo = text(body.assignedTo) || null;

    const [lead] = await db.update(schema.leads).set(patch).where(eq(schema.leads.id, id)).returning();
    const noteContent = text(body.note);
    let note = null;

    if (noteContent) {
      [note] = await db
        .insert(schema.adminNotes)
        .values({
          id: crypto.randomUUID(),
          entityType: "lead",
          entityId: id,
          authorName: adminName(context.data),
          content: noteContent,
          createdAt: new Date(),
        })
        .returning();
    }

    await syncLeadFinance(db, lead);
    return json({ lead, note });
  }

  if (method === "DELETE") {
    const body = await readBody(context.request);
    const noteId = text(body.noteId) || url.searchParams.get("noteId") || "";
    if (noteId) {
      await db.delete(schema.adminNotes).where(eq(schema.adminNotes.id, noteId));
      return json({ ok: true });
    }

    const id = text(body.id) || url.searchParams.get("id") || "";
    if (!id) return json({ error: "Falta el id del prospecto." }, 400);

    await db.delete(schema.adminNotes).where(eq(schema.adminNotes.entityId, id));
    await db.delete(schema.financialRecords).where(eq(schema.financialRecords.id, `lead_${id}`));
    await db.delete(schema.leads).where(eq(schema.leads.id, id));
    return json({ ok: true });
  }

  return json({ error: "Método no permitido." }, 405);
};
