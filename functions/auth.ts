import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { createDb, schema, type Env } from "./db";
import { validateDeliverableEmail, sendVerificationOtpEmail } from "./email";

export function createAuth(env: Env, request?: Request) {
  const db = createDb(env);

  let dynamicBaseUrl = env.BETTER_AUTH_URL || "https://nexgen-tax-pro.pages.dev";
  if (request) {
    try {
      dynamicBaseUrl = new URL(request.url).origin;
    } catch {
      // fallback to env.BETTER_AUTH_URL
    }
  }

  return betterAuth({
    appName: "NexGen Tax Pro",
    baseURL: dynamicBaseUrl,
    secret: env.BETTER_AUTH_SECRET,

    trustedOrigins: [
      "https://nexgen-tax-pro.pages.dev",
      "https://*.nexgen-tax-pro.pages.dev",
      "http://localhost:8788",
      "http://127.0.0.1:8788",
    ],

    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: 8,
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
    },

    user: {
      additionalFields: {
        phone: { type: "string", required: false },
        officeName: { type: "string", required: false },
        ptin: { type: "string", required: false },
        efin: { type: "string", required: false },
      },
    },

    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: dynamicBaseUrl.startsWith("https://"),
        path: "/",
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = ctx.body as { email?: unknown; type?: unknown } | undefined;
        const rawEmail = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

        // 1. Validar entregabilidad del correo en registro y envío de OTP
        if (ctx.path === "/sign-up/email" || ctx.path === "/email-otp/send-verification-otp") {
          if (rawEmail) {
            const result = await validateDeliverableEmail(rawEmail);
            if (!result.ok) {
              const message = result.suggestion
                ? `${result.error} ¿Quisiste decir ${result.suggestion}?`
                : result.error;
              throw new APIError("BAD_REQUEST", { message });
            }
          }
        }

        // 2. Limpiar OTPs previos del mismo identificador para evitar colisiones en SQLite
        if (rawEmail) {
          if (ctx.path === "/email-otp/request-password-reset" || ctx.path === "/forget-password/email-otp") {
            await db
              .delete(schema.verifications)
              .where(eq(schema.verifications.identifier, `forget-password-otp-${rawEmail}`))
              .catch(() => {});
          } else if (ctx.path === "/email-otp/send-verification-otp") {
            const otpType = typeof body?.type === "string" ? body.type : "email-verification";
            await db
              .delete(schema.verifications)
              .where(eq(schema.verifications.identifier, `${otpType}-otp-${rawEmail}`))
              .catch(() => {});
          } else if (ctx.path === "/sign-up/email") {
            await db
              .delete(schema.verifications)
              .where(eq(schema.verifications.identifier, `email-verification-otp-${rawEmail}`))
              .catch(() => {});
          }
        }
      }),
    },

    plugins: [
      admin({
        defaultRole: "preparer",
        adminRoles: ["admin"],
      }),
      emailOTP({
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: "hashed",
        rateLimit: {
          window: 60,
          max: 10,
        },
        sendVerificationOTP: async ({ email, otp, type }) => {
          await sendVerificationOtpEmail(env, { email, otp, type });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
