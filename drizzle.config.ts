import { existsSync, readFileSync } from "node:fs";
import type { Config } from "drizzle-kit";

function loadDevVars(): Record<string, string> {
  if (!existsSync(".dev.vars")) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const devVars = loadDevVars();
const url = process.env.TURSO_DATABASE_URL ?? devVars.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN ?? devVars.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error("Falta TURSO_DATABASE_URL en .dev.vars para ejecutar drizzle-kit.");
}

export default {
  schema: "./functions/db/schema.ts",
  out: "./functions/db/migrations",
  dialect: "turso",
  dbCredentials: { url, authToken },
} satisfies Config;
