import { desc, eq } from "drizzle-orm";
import { createDb, schema, type Database, type Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
  data: Record<string, unknown>;
}

const STATUSES = ["paid", "pending", "installment", "cancelled"] as const;
type InvoiceStatus = (typeof STATUSES)[number];

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

function date(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function syncInvoiceFinance(db: Database, invoice: typeof schema.invoices.$inferSelect): Promise<void> {
  const finId = `inv_${invoice.id}`;
  if (invoice.status === "paid" && Number(invoice.amount) > 0) {
    const values = {
      type: "income" as const,
      category: "software_taxwise",
      categoryDetail: null,
      description: `Factura pagada: ${invoice.customerName} (${invoice.package})`,
      amount: Number(invoice.amount),
      date: invoice.paidAt || new Date(),
      season: "2026",
      status: "paid" as const,
      paymentMethod: "bank_transfer",
      notes: invoice.notes || null,
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
    const rows = await db.select().from(schema.invoices).orderBy(desc(schema.invoices.createdAt));
    const paid = rows.filter((row) => row.status === "paid");
    const pending = rows.filter((row) => row.status === "pending" || row.status === "installment");

    return json({
      invoices: rows,
      summary: {
        total: rows.length,
        paidCount: paid.length,
        pendingCount: pending.length,
        paidAmount: paid.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        pendingAmount: pending.reduce((sum, row) => sum + Number(row.amount || 0), 0),
        billedAmount: rows
          .filter((row) => row.status !== "cancelled")
          .reduce((sum, row) => sum + Number(row.amount || 0), 0),
      },
    });
  }

  if (method === "POST") {
    const body = await readBody(context.request);
    const customerName = text(body.customerName);
    const packageName = text(body.package);
    const amount = money(body.amount);
    const status = STATUSES.includes(text(body.status) as InvoiceStatus) ? (text(body.status) as InvoiceStatus) : "pending";

    if (!customerName || !packageName) {
      return json({ error: "Cliente y paquete son obligatorios." }, 400);
    }
    if (amount <= 0) {
      return json({ error: "El monto debe ser mayor que cero." }, 400);
    }

    const now = new Date();
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        id: text(body.id) || crypto.randomUUID(),
        leadId: text(body.leadId) || null,
        userId: text(body.userId) || null,
        customerName,
        package: packageName,
        amount,
        status,
        dueDate: date(body.dueDate),
        paidAt: status === "paid" ? date(body.paidAt) || now : null,
        notes: text(body.notes) || null,
        createdAt: now,
      })
      .returning();

    await syncInvoiceFinance(db, invoice);
    return json({ invoice }, 201);
  }

  if (method === "PATCH") {
    const body = await readBody(context.request);
    const id = text(body.id) || url.searchParams.get("id") || "";
    if (!id) return json({ error: "Falta el id de la factura." }, 400);

    const existing = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    if (!existing.length) return json({ error: "Factura no encontrada." }, 404);

    const patch: Partial<typeof schema.invoices.$inferInsert> = {};
    if (body.customerName !== undefined) patch.customerName = text(body.customerName);
    if (body.package !== undefined) patch.package = text(body.package);
    if (body.amount !== undefined) patch.amount = money(body.amount);
    if (body.notes !== undefined) patch.notes = text(body.notes) || null;
    if (body.dueDate !== undefined) patch.dueDate = date(body.dueDate);
    if (body.status !== undefined) {
      if (!STATUSES.includes(text(body.status) as InvoiceStatus)) {
        return json({ error: "Estado de factura no válido." }, 400);
      }
      patch.status = text(body.status) as InvoiceStatus;
      patch.paidAt = text(body.status) === "paid" ? date(body.paidAt) || new Date() : null;
    } else if (body.paidAt !== undefined) {
      patch.paidAt = date(body.paidAt);
    }

    const [invoice] = await db.update(schema.invoices).set(patch).where(eq(schema.invoices.id, id)).returning();
    await syncInvoiceFinance(db, invoice);
    return json({ invoice });
  }

  if (method === "DELETE") {
    const body = await readBody(context.request);
    const id = text(body.id) || url.searchParams.get("id") || "";
    if (!id) return json({ error: "Falta el id de la factura." }, 400);
    await db.delete(schema.invoices).where(eq(schema.invoices.id, id));
    await db.delete(schema.financialRecords).where(eq(schema.financialRecords.id, `inv_${id}`));
    return json({ ok: true });
  }

  return json({ error: "Método no permitido." }, 405);
};
