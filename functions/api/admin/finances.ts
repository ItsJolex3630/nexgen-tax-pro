import { desc, eq } from "drizzle-orm";
import { createDb, schema, type Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
  data: Record<string, unknown>;
}

const TYPES = ["income", "expense"] as const;
const STATUSES = ["paid", "pending"] as const;
type FinanceType = (typeof TYPES)[number];
type FinanceStatus = (typeof STATUSES)[number];

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
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
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

function summarize(rows: Array<typeof schema.financialRecords.$inferSelect>) {
  const income = rows.filter((row) => row.type === "income");
  const expense = rows.filter((row) => row.type === "expense");
  const totalIncome = income.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalExpense = expense.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const netProfit = totalIncome - totalExpense;
  const profitMargin = totalIncome ? Math.round((netProfit / totalIncome) * 1000) / 10 : 0;
  return {
    totalIncome,
    totalExpense,
    netProfit,
    profitMargin,
    pendingIncome: income
      .filter((row) => row.status === "pending")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    pendingExpense: expense
      .filter((row) => row.status === "pending")
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    incomeCount: income.length,
    expenseCount: expense.length,
  };
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  const db = createDb(context.env);
  const method = context.request.method;
  const url = new URL(context.request.url);

  if (method === "GET") {
    const rows = await db
      .select()
      .from(schema.financialRecords)
      .orderBy(desc(schema.financialRecords.date), desc(schema.financialRecords.createdAt));

    const type = url.searchParams.get("type") || "";
    const category = url.searchParams.get("category") || "";
    const q = (url.searchParams.get("q") || "").toLowerCase();

    const records = rows
      .filter((row) => (type ? row.type === type : true))
      .filter((row) => (category ? row.category === category : true))
      .filter((row) => {
        if (!q) return true;
        return [row.description, row.categoryDetail, row.notes, row.paymentMethod]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });

    return json({ records, summary: summarize(rows) });
  }

  if (method === "POST") {
    const body = await readBody(context.request);
    const type = text(body.type);
    const category = text(body.category);
    const categoryDetail = text(body.categoryDetail);
    const description = text(body.description);
    const amount = money(body.amount);
    const movementDate = date(body.date);
    const status = STATUSES.includes(text(body.status) as FinanceStatus)
      ? (text(body.status) as FinanceStatus)
      : "paid";

    if (!TYPES.includes(type as FinanceType)) {
      return json({ error: "El tipo debe ser income o expense." }, 400);
    }
    if (!category) {
      return json({ error: "La categoría es obligatoria." }, 400);
    }
    if (category === "other" && !categoryDetail) {
      return json({ error: "Especifica el detalle cuando la categoría es Otro." }, 400);
    }
    if (!description) {
      return json({ error: "La descripción es obligatoria." }, 400);
    }
    if (amount <= 0) {
      return json({ error: "El monto debe ser mayor que cero." }, 400);
    }
    if (!movementDate) {
      return json({ error: "La fecha del movimiento no es válida." }, 400);
    }

    const [record] = await db
      .insert(schema.financialRecords)
      .values({
        id: text(body.id) || crypto.randomUUID(),
        type: type as FinanceType,
        category,
        categoryDetail: category === "other" ? categoryDetail : null,
        description,
        amount,
        date: movementDate,
        season: text(body.season) || "2026",
        status,
        paymentMethod: text(body.paymentMethod) || null,
        notes: text(body.notes) || null,
        createdAt: new Date(),
      })
      .returning();

    return json({ record }, 201);
  }

  if (method === "DELETE") {
    const body = await readBody(context.request);
    const id = text(body.id) || url.searchParams.get("id") || "";
    if (!id) return json({ error: "Falta el id del movimiento." }, 400);
    const existing = await db
      .select()
      .from(schema.financialRecords)
      .where(eq(schema.financialRecords.id, id))
      .limit(1);
    if (!existing.length) return json({ error: "Movimiento no encontrado." }, 404);
    await db.delete(schema.financialRecords).where(eq(schema.financialRecords.id, id));
    return json({ ok: true });
  }

  return json({ error: "Método no permitido." }, 405);
};
