import type { Env } from "../db";
import { sanitizeNoPrices } from "./chat";

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

type VoiceTtsEnv = Env & { AI?: AiBinding };

interface Ctx {
  request: Request;
  env: VoiceTtsEnv;
}

type Lang = "es" | "en";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeLang(value: unknown): Lang {
  return value === "en" ? "en" : "es";
}

export function stripHtmlAndMarkdown(input: string): string {
  return String(input || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~|#>-]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "").trim();
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function extractAudioPayload(
  result: unknown
): Promise<Uint8Array | ReadableStream<Uint8Array> | null> {
  if (!result) return null;
  if (result instanceof ReadableStream) return result;
  if (result instanceof Response) {
    if (!result.ok) return null;
    const ab = await result.arrayBuffer();
    return ab.byteLength > 0 ? new Uint8Array(ab) : null;
  }
  if (result instanceof ArrayBuffer) {
    return result.byteLength > 0 ? new Uint8Array(result) : null;
  }
  if (ArrayBuffer.isView(result)) {
    return result.byteLength > 0
      ? new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
      : null;
  }
  if (typeof result === "string" && result.length > 0) {
    return decodeBase64(result);
  }
  if (typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.audio === "string" && record.audio.length > 0) {
      return decodeBase64(record.audio);
    }
    if (record.audio instanceof ReadableStream) {
      return record.audio;
    }
    if (record.audio instanceof ArrayBuffer && record.audio.byteLength > 0) {
      return new Uint8Array(record.audio);
    }
    if (ArrayBuffer.isView(record.audio) && record.audio.byteLength > 0) {
      return new Uint8Array(
        record.audio.buffer,
        record.audio.byteOffset,
        record.audio.byteLength
      );
    }
  }
  return null;
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await context.request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  const lang = normalizeLang(body.lang);
  if (!rawText) {
    return json({ error: "Text is required." }, 400);
  }

  const cleanText = sanitizeNoPrices(stripHtmlAndMarkdown(rawText)).slice(0, 1200);
  if (!cleanText) {
    return json({ error: "Empty text after sanitization." }, 400);
  }

  if (!context.env.AI || typeof context.env.AI.run !== "function") {
    return json({ error: "TTS fallback needed", code: "NO_AI" }, 503);
  }

  const attempts: Array<{ model: string; input: Record<string, unknown> }> =
    lang === "en"
      ? [
          { model: "@cf/deepgram/aura-2-en", input: { text: cleanText, speaker: "asteria" } },
          { model: "@cf/myshell-ai/melotts", input: { prompt: cleanText, text: cleanText, lang: "en" } },
        ]
      : [
          { model: "@cf/deepgram/aura-2-es", input: { text: cleanText, speaker: "diana" } },
          { model: "@cf/myshell-ai/melotts", input: { prompt: cleanText, text: cleanText, lang: "es" } },
        ];

  for (const attempt of attempts) {
    try {
      const result = await context.env.AI.run(attempt.model, attempt.input);
      const audio = await extractAudioPayload(result);
      if (audio) {
        return new Response(audio, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }
    } catch (error) {
      console.error(`[voice-tts] model ${attempt.model} failed`, error);
    }
  }

  return json({ error: "TTS fallback needed", code: "NO_AI" }, 503);
};
