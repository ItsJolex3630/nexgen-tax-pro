import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// 1. Usuarios de NexGen Tax Pro
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
  image: text("image"),
  phone: text("phone"),
  officeName: text("office_name"),
  ptin: text("ptin"),
  efin: text("efin"),

  // RBAC: 'preparer' (default para clientes/preparadores) | 'office_admin' | 'admin'
  role: text("role", { enum: ["preparer", "office_admin", "admin"] })
    .notNull()
    .default("preparer"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp" }),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// 2. Sesiones activas (Cookies HttpOnly)
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  impersonatedBy: text("impersonated_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// 3. Cuentas y credenciales (Passwords hasheadas con Argon2/Scrypt)
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// 4. Verificaciones y tokens OTP
export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(), // Email del usuario
  value: text("value").notNull(),          // Código OTP hasheado
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// 5. Leads y prospectos comerciales de Book a Demo y Cuestionarios
export const leads = sqliteTable("leads", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  officeName: text("office_name"),
  topic: text("topic").notNull(),
  status: text("status", {
    enum: ["new", "contacted", "demo_scheduled", "trial_sent", "won", "lost"]
  }).notNull().default("new"),
  notes: text("notes"),
  source: text("source").default("web_demo"),
  estimatedValue: integer("estimated_value").default(0),
  assignedTo: text("assigned_to"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// 6. Ficha tecnica y compliance del preparador
export const preparerProfiles = sqliteTable("preparer_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ptin: text("ptin"),
  efin: text("efin"),
  efinStatus: text("efin_status", {
    enum: ["pending_irs", "approved", "action_required", "not_started"]
  }).default("not_started"),
  wispStatus: text("wisp_status", {
    enum: ["completed", "pending", "exempt"]
  }).default("pending"),
  licenseType: text("license_type", {
    enum: ["desktop_1040", "desktop_corp", "online", "none"]
  }).default("none"),
  bankPartner: text("bank_partner", {
    enum: ["tpg", "refund_advantage", "eps", "none"]
  }).default("none"),
  season: text("season").default("2026"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// 7. Facturacion y cotizaciones personalizadas
export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  leadId: text("lead_id"),
  userId: text("user_id"),
  customerName: text("customer_name").notNull(),
  package: text("package").notNull(),
  amount: integer("amount").notNull(),
  status: text("status", { enum: ["paid", "pending", "installment", "cancelled"] }).default("pending"),
  dueDate: integer("due_date", { mode: "timestamp" }),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// 8. Notas de seguimiento y bitacora de actividad
export const adminNotes = sqliteTable("admin_notes", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  authorName: text("author_name").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});
