import { createDb, schema, type Env } from "../../db";

interface Ctx {
  request: Request;
  env: Env;
}

const OPEN_STATUSES = new Set(["new", "contacted", "demo_scheduled", "trial_sent"]);
const DAY = 24 * 60 * 60 * 1000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[admin/stats] query failed", err);
    return fallback;
  }
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  if (context.request.method !== "GET") {
    return json({ error: "Método no permitido." }, 405);
  }

  const db = createDb(context.env);
  const [leadRows, profileRows, invoiceRows, noteRows, financialRows] = await Promise.all([
    safe(() => db.select().from(schema.leads), []),
    safe(() => db.select().from(schema.preparerProfiles), []),
    safe(() => db.select().from(schema.invoices), []),
    safe(() => db.select().from(schema.adminNotes), []),
    safe(() => db.select().from(schema.financialRecords), []),
  ]);

  const now = Date.now();
  const paidInvoices = invoiceRows.filter((invoice) => invoice.status === "paid");
  const invoiceRevenue = paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const invoicePendingRevenue = invoiceRows
    .filter((invoice) => invoice.status === "pending" || invoice.status === "installment")
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const financeIncomeRows = financialRows.filter((row) => row.type === "income");
  const financeExpenseRows = financialRows.filter((row) => row.type === "expense");
  const financeIncome = financeIncomeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const financeExpense = financeExpenseRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingFinanceIncome = financeIncomeRows
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const pendingFinanceExpense = financeExpenseRows
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalRevenue = invoiceRevenue + financeIncome;
  const totalExpenses = financeExpense;
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue ? Math.round((netProfit / totalRevenue) * 1000) / 10 : 0;
  const pendingRevenue = invoicePendingRevenue + pendingFinanceIncome;
  const activeLicenses = profileRows.filter((profile) => profile.licenseType && profile.licenseType !== "none").length;
  const efinReady = profileRows.filter(
    (profile) => profile.efinStatus === "approved" && profile.wispStatus === "completed"
  ).length;
  const efinRate = profileRows.length ? Math.round((efinReady / profileRows.length) * 100) : 0;
  const openLeads = leadRows.filter((lead) => OPEN_STATUSES.has(lead.status));
  const wonLeads = leadRows.filter((lead) => lead.status === "won");
  const staleLeads = openLeads.filter(
    (lead) => now - new Date(lead.updatedAt).getTime() > DAY
  );
  const efinPending = profileRows.filter(
    (profile) => profile.efinStatus === "pending_irs" || profile.efinStatus === "not_started" || !profile.efinStatus
  );
  const overdueInvoices = invoiceRows.filter(
    (invoice) =>
      (invoice.status === "pending" || invoice.status === "installment") &&
      invoice.dueDate &&
      new Date(invoice.dueDate).getTime() < now
  );

  const months: Array<{ key: string; label: string; revenue: number; efile: number }> = [];
  const base = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  for (let index = 11; index >= 0; index -= 1) {
    const month = new Date(base);
    month.setUTCMonth(base.getUTCMonth() - index);
    const key = monthKey(month);
    const revenue = paidInvoices
      .filter((invoice) => monthKey(new Date(invoice.paidAt || invoice.createdAt)) === key)
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0) +
      financeIncomeRows
        .filter((row) => monthKey(new Date(row.date)) === key)
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const seasonal = [1.6, 1.8, 1.55, 1.2, 0.55, 0.35, 0.3, 0.3, 0.4, 0.55, 0.8, 1.1][month.getUTCMonth()];
    const efile = Math.round(activeLicenses * seasonal * 18);
    months.push({
      key,
      label: month.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      revenue,
      efile,
    });
  }

  const packageNames = ["Solo Software", "Pro + Training", "Tax Office Startup", "Custom"];
  const packageMix = packageNames.map((name) => ({
    name,
    value: invoiceRows.filter((invoice) => invoice.package === name).length,
    revenue: invoiceRows
      .filter((invoice) => invoice.package === name && invoice.status === "paid")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0),
  }));

  const recentLeads = [...leadRows]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6)
    .map((lead) => ({
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      officeName: lead.officeName,
      topic: lead.topic,
      status: lead.status,
      assignedTo: lead.assignedTo,
      estimatedValue: lead.estimatedValue,
      updatedAt: lead.updatedAt,
    }));

  const activity = [...noteRows]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8)
    .map((note) => ({
      id: note.id,
      type: "note",
      title: note.authorName,
      detail: note.content,
      entityType: note.entityType,
      entityId: note.entityId,
      createdAt: note.createdAt,
    }));

  return json({
    stats: {
      revenue: {
        total: totalRevenue,
        invoices: invoiceRevenue,
        financialIncome: financeIncome,
        expenses: totalExpenses,
        netProfit,
        profitMargin,
        pending: pendingRevenue,
        pendingInvoices: invoicePendingRevenue,
        pendingFinanceIncome,
        pendingFinanceExpense,
        target: Math.max(100000, Math.ceil(totalRevenue / 10000) * 10000),
        progress: Math.min(100, Math.round((totalRevenue / Math.max(100000, Math.ceil(totalRevenue / 10000) * 10000)) * 100)),
      },
      finance: {
        totalIncome: financeIncome,
        totalExpense: financeExpense,
        netProfit,
        profitMargin,
        pendingIncome: pendingFinanceIncome,
        pendingExpense: pendingFinanceExpense,
        incomeCount: financeIncomeRows.length,
        expenseCount: financeExpenseRows.length,
      },
      licenses: {
        active: activeLicenses,
        total: profileRows.length,
        target: Math.max(40, activeLicenses),
      },
      leads: {
        total: leadRows.length,
        open: openLeads.length,
        won: wonLeads.length,
        stale: staleLeads.length,
        conversion: leadRows.length ? Math.round((wonLeads.length / leadRows.length) * 100) : 0,
      },
      compliance: {
        efinReady,
        total: profileRows.length,
        rate: efinRate,
        pending: efinPending.length,
        wispReady: profileRows.filter((profile) => profile.wispStatus === "completed").length,
      },
      trend: months,
      packageMix,
      goals: {
        season: {
          current: totalRevenue,
          target: Math.max(100000, Math.ceil(totalRevenue / 10000) * 10000),
        },
        earlyBird: {
          current: activeLicenses,
          target: Math.max(40, activeLicenses),
        },
      },
      alerts: [
        {
          type: "leads",
          severity: staleLeads.length ? "warn" : "ok",
          title: `${staleLeads.length} leads requieren contacto urgente`,
          detail: "Sin seguimiento en las últimas 24 horas.",
          count: staleLeads.length,
        },
        {
          type: "efin",
          severity: efinPending.length ? "danger" : "ok",
          title: `${efinPending.length} EFIN pendientes de IRS`,
          detail: "Revisa el compliance antes del arranque de temporada.",
          count: efinPending.length,
        },
        {
          type: "invoices",
          severity: overdueInvoices.length ? "warn" : "ok",
          title: `${overdueInvoices.length} pagos o cuotas vencidas`,
          detail: "Facturas pendientes con fecha de pago superada.",
          count: overdueInvoices.length,
        },
      ],
      recentLeads,
      activity,
      generatedAt: new Date().toISOString(),
    },
  });
};
