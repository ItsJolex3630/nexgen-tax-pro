import type { Env } from "./db";

/* =====================================================================
   NEXGEN TAX PRO · EMAIL DELIVERABILITY + OTP TRANSPORT
   Edge-safe: only fetch / Web APIs.
   ===================================================================== */

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const DISPOSABLE = [
  "yopmail", "mailinator", "tempmail", "temp-mail", "10minutemail", "guerrillamail",
  "trashmail", "sharklasers", "getnada", "dispostable", "fakeinbox", "maildrop",
  "throwawaymail", "mintemail", "spamgourmet", "mytrashmail",
];

const TEST_LOCAL = /^(prueba|test|testing|tests|asdf+|qwerty|fake|falso|ejemplo|example|demo|aaa+|abc|123456?)([._+-]|$)/i;

const TYPO_DOMAINS: Record<string, string> = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com",
  "gmail.co": "gmail.com", "gnail.com": "gmail.com", "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmal.com": "hotmail.com",
  "outlok.com": "outlook.com", "outllok.com": "outlook.com", "outlook.co": "outlook.com",
  "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com",
  "icloud.co": "icloud.com", "iclud.com": "icloud.com",
};

const KNOWN_VALID_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "zoho.com"
]);

export type EmailValidation =
  | { ok: true }
  | { ok: false; code: "format" | "test" | "disposable" | "typo" | "no-mx"; error: string; suggestion?: string };

async function domainHasMx(domain: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(
      "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(domain) + "&type=MX",
      { headers: { accept: "application/dns-json" }, signal: ctrl.signal }
    );
    if (!res.ok) return true; // fail-open on resolver outage
    const json: { Status?: number; Answer?: Array<{ type?: number }> } = await res.json();
    if (json.Status !== 0) return false; // NXDOMAIN / SERVFAIL for the domain
    return Array.isArray(json.Answer) && json.Answer.some((a) => a.type === 15);
  } catch {
    return true; // fail-open on network/timeout to avoid blocking real users
  } finally {
    clearTimeout(timer);
  }
}

export async function validateDeliverableEmail(email: string): Promise<EmailValidation> {
  const addr = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) {
    return { ok: false, code: "format", error: "El correo no tiene un formato válido." };
  }
  const [local, domain] = addr.split("@");
  if (TEST_LOCAL.test(local)) {
    return { ok: false, code: "test", error: "Usa un correo real: no se aceptan direcciones de prueba." };
  }
  if (DISPOSABLE.some((d) => domain.includes(d))) {
    return { ok: false, code: "disposable", error: "No se aceptan correos temporales o desechables." };
  }
  if (TYPO_DOMAINS[domain]) {
    return {
      ok: false,
      code: "typo",
      error: "Parece que hay un error de escritura en el dominio.",
      suggestion: local + "@" + TYPO_DOMAINS[domain],
    };
  }
  // Fast-path: si el dominio es un proveedor oficial reconocido, es entregable de inmediato
  if (KNOWN_VALID_DOMAINS.has(domain)) {
    return { ok: true };
  }
  const deliverable = await domainHasMx(domain);
  if (!deliverable) {
    return { ok: false, code: "no-mx", error: "El dominio del correo no puede recibir mensajes (sin registros MX)." };
  }
  return { ok: true };
}

/* --------------------------------------------------------------------- */

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function subjectFor(type: string): string {
  if (type === "sign-in") return "Tu código de acceso · NexGen Tax Pro";
  if (type === "forget-password") return "Restablece tu contraseña · NexGen Tax Pro";
  return "Verifica tu correo · NexGen Tax Pro";
}

function introFor(type: string): string {
  if (type === "sign-in") return "Usa este código para completar tu inicio de sesión.";
  if (type === "forget-password") return "Usa este código para restablecer tu contraseña.";
  return "Usa este código para verificar tu correo y activar tu cuenta.";
}

function otpHtml(otp: string, type: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subjectFor(type))}</title></head>
<body style="margin:0;padding:0;background:#090b10;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090b10;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#121620;border:1px solid #c99846;border-radius:18px;overflow:hidden;">
<tr><td style="padding:26px 30px 18px;border-bottom:1px solid rgba(201,152,70,.25);">
<div style="font-size:13px;letter-spacing:2.5px;color:#c99846;font-weight:700;text-transform:uppercase;">NexGen Tax Pro</div>
<div style="font-size:12px;color:#8b93a3;margin-top:4px;">Professional Tax Software · Ecosystem 2026</div>
</td></tr>
<tr><td style="padding:28px 30px 8px;color:#e9edf5;font-size:16px;line-height:1.6;">
<p style="margin:0 0 10px;">Hola,</p>
<p style="margin:0 0 22px;">${esc(introFor(type))}</p>
<div style="text-align:center;margin:6px 0 22px;">
<div style="display:inline-block;background:#0b0e14;border:1.5px solid #c99846;border-radius:14px;padding:16px 26px;box-shadow:0 0 34px -12px rgba(201,152,70,.6);">
<span style="font-family:'Courier New',monospace;font-size:32px;letter-spacing:10px;color:#f5d79a;font-weight:700;">${esc(otp)}</span>
</div>
<p style="margin:12px 0 0;font-size:13px;color:#8b93a3;">⏱️ Este código expira en <b style="color:#10b981;">10 minutos</b>.</p>
</div>
<p style="margin:0 0 8px;font-size:13px;color:#8b93a3;line-height:1.55;">Si no solicitaste este código, ignora este mensaje. Por seguridad, <b style="color:#e9edf5;">NexGen nunca te solicitará este código por teléfono ni chat</b>.</p>
</td></tr>
<tr><td style="padding:18px 30px 26px;border-top:1px solid rgba(201,152,70,.18);">
<p style="margin:0;font-size:11px;color:#67707f;line-height:1.5;">NexGen Tax Pro · Software tributario, capacitación y soporte para profesionales de impuestos.<br>Florida &amp; Nationwide · info@nexgentaxpro.com</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function otpText(otp: string, type: string): string {
  return [
    "NexGen Tax Pro · Professional Tax Software",
    "",
    introFor(type),
    "",
    "Código: " + otp,
    "Expira en 10 minutos.",
    "",
    "NexGen nunca te solicitará este código por teléfono ni chat.",
  ].join("\n");
}

interface SendArgs { to: string; subject: string; html: string; text: string; }
interface SendResult { ok: boolean; channel: "gmail-webhook" | "brevo" | "resend" | "console" }

async function sendEmail(env: Env, { to, subject, html, text }: SendArgs): Promise<SendResult> {
  const from = env.EMAIL_FROM || "no-reply@nexgentaxpro.com";
  const fromName = env.EMAIL_FROM_NAME || "NexGen Tax Pro";

  if (env.GMAIL_WEBHOOK_URL) {
    const res = await fetch(env.GMAIL_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.GMAIL_WEBHOOK_SECRET ? { "x-webhook-secret": env.GMAIL_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify({
        secret: env.GMAIL_WEBHOOK_SECRET || "",
        to, subject, html, text,
        name: fromName,
        fromName: fromName,
        from: fromName + " <" + from + ">",
      }),
    });
    if (res.ok) return { ok: true, channel: "gmail-webhook" };
    throw new Error("Gmail webhook respondió " + res.status);
  }

  if (env.BREVO_API_KEY) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { email: from, name: fromName },
        to: [{ email: to }],
        subject, htmlContent: html, textContent: text,
      }),
    });
    if (res.ok) return { ok: true, channel: "brevo" };
    throw new Error("Brevo respondió " + res.status);
  }

  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
      body: JSON.stringify({ from: fromName + " <" + from + ">", to: [to], subject, html, text }),
    });
    if (res.ok) return { ok: true, channel: "resend" };
    throw new Error("Resend respondió " + res.status);
  }

  console.log("[NexGen OTP · console mode] to=" + to + " subject=" + subject + " code=" + text.match(/\b\d{6}\b/)?.[0]);
  return { ok: true, channel: "console" };
}

export async function sendVerificationOtpEmail(
  env: Env,
  { email, otp, type }: { email: string; otp: string; type: string }
): Promise<void> {
  await sendEmail(env, {
    to: email,
    subject: subjectFor(type),
    html: otpHtml(otp, type),
    text: otpText(otp, type),
  });
}

/* Auxiliary link mail used by Better Auth's default email-verification hook. */
export async function sendVerificationLinkEmail(
  env: Env,
  { email, url }: { email: string; url: string }
): Promise<void> {
  const safeUrl = esc(url);
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#090b10;font-family:Arial,sans-serif;padding:32px 12px;">
<div style="max-width:540px;margin:0 auto;background:#121620;border:1px solid #c99846;border-radius:18px;padding:30px;color:#e9edf5;">
<div style="font-size:13px;letter-spacing:2.5px;color:#c99846;font-weight:700;text-transform:uppercase;">NexGen Tax Pro</div>
<p style="font-size:16px;line-height:1.6;margin:20px 0;">Confirma tu correo para activar tu cuenta.</p>
<p style="text-align:center;margin:26px 0;"><a href="${safeUrl}" style="display:inline-block;background:linear-gradient(135deg,#e3c581,#c99846);color:#17130a;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:99px;">Verificar mi correo</a></p>
<p style="font-size:12px;color:#8b93a3;">Si el botón no funciona, copia este enlace:<br><span style="word-break:break-all;color:#c99846;">${safeUrl}</span></p>
</div></body></html>`;
  await sendEmail(env, {
    to: email,
    subject: "Confirma tu correo · NexGen Tax Pro",
    html,
    text: "Confirma tu correo en NexGen Tax Pro: " + url,
  });
}
