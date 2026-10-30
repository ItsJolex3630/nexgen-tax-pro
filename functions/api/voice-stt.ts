import type { Env } from "../db";

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

type VoiceSttEnv = Env & { AI?: AiBinding };

interface Ctx {
  request: Request;
  env: VoiceSttEnv;
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const SENSITIVE_PATTERN = /\b\d{3}[- ]\d{2}[- ]\d{4}\b|\b\d{2}-\d{7}\b|\b\d{9}\b/g;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function readAudioBytes(request: Request): Promise<Uint8Array | null> {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const entry = formData.get("audio") ?? formData.get("file");
    if (entry && typeof entry === "object" && "arrayBuffer" in entry) {
      const ab = await (entry as Blob).arrayBuffer();
      return new Uint8Array(ab);
    }
    return null;
  }

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body?.audio === "string" && body.audio.trim()) {
      const clean = body.audio.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, "").trim();
      const bin = atob(clean);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return null;
  }

  const ab = await request.arrayBuffer();
  return ab.byteLength > 0 ? new Uint8Array(ab) : null;
}

function extractTranscript(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.trim();
  if (record.result && typeof record.result === "object") {
    const nested = record.result as Record<string, unknown>;
    if (typeof nested.text === "string") return nested.text.trim();
  }
  return "";
}

export const onRequest = async (context: Ctx): Promise<Response> => {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  if (!context.env.AI || typeof context.env.AI.run !== "function") {
    return json({ text: "", error: "STT unavailable", code: "NO_AI" }, 503);
  }

  let audioBytes: Uint8Array | null = null;
  try {
    audioBytes = await readAudioBytes(context.request);
  } catch {
    return json({ error: "Invalid audio payload." }, 400);
  }

  if (!audioBytes || audioBytes.byteLength === 0) {
    return json({ error: "Empty audio payload." }, 400);
  }

  if (audioBytes.byteLength > MAX_AUDIO_BYTES) {
    return json({ error: "Audio payload exceeds maximum size." }, 413);
  }

  try {
    let result: unknown;
    try {
      result = await context.env.AI.run("@cf/openai/whisper-large-v3-turbo", {
        audio: uint8ToBase64(audioBytes),
      });
    } catch {
      result = await context.env.AI.run("@cf/openai/whisper-large-v3-turbo", {
        audio: Array.from(audioBytes),
      });
    }

    const rawText = extractTranscript(result);
    const hasSensitive = SENSITIVE_PATTERN.test(rawText);
    SENSITIVE_PATTERN.lastIndex = 0;
    const safeText = rawText.replace(SENSITIVE_PATTERN, "[REDACTED]").trim();

    return json({
      text: safeText,
      ...(hasSensitive ? { sensitive: true } : {}),
    });
  } catch (error) {
    console.error("[voice-stt] Workers AI error", error);
    return json({ text: "", error: "Transcription failed." }, 500);
  }
};
