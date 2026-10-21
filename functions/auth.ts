import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createDb, schema, type Env } from "./db";
import { validateDeliverableEmail, sendVerificationOtpEmail, sendVerificationLinkEmail } from "./email";

export function createAuth(env: Env) {
  const db = createDb(env);

  return betterAuth({
    appName: "NexGen Tax Pro",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,

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
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationLinkEmail(env, { email: user.email, url });
      },
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
        secure: true,
        path: "/",
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email" && ctx.path !== "/email-otp/send-verification-otp") {
          return;
        }
        const rawEmail = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof rawEmail !== "string" || !rawEmail.trim()) return;

        const result = await validateDeliverableEmail(rawEmail);
        if (!result.ok) {
          const message = result.suggestion
            ? `${result.error} ¿Quisiste decir ${result.suggestion}?`
            : result.error;
          throw new APIError("BAD_REQUEST", { message });
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
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          await sendVerificationOtpEmail(env, { email, otp, type });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
