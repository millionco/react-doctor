import { gunzipSync } from "node:zlib";
import { PERFECT_SCORE } from "@/constants";
import { getScoreLabel } from "@/utils/get-score-label";

const ERROR_RULE_PENALTY = 1.5;
const WARNING_RULE_PENALTY = 0.75;
// 4 MB — Vercel's serverless request body limit; the platform rejects
// anything larger before it reaches this handler, so this is the most we
// can accept inline.
// TODO: switch to a Vercel Blob upload reference for larger diagnostic
// payloads instead of inline JSON.
const MAX_REQUEST_BODY_BYTES = 4_000_000;
// Hold the decompressed (gzip) payload to the same 4 MB ceiling — a
// compressed body must not expand beyond what we'd accept uncompressed.
const MAX_DECOMPRESSED_BODY_BYTES = 4_000_000;
const MAX_DIAGNOSTICS_PER_REQUEST = 50_000;

interface DiagnosticInput {
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
}

const calculateScore = (diagnostics: DiagnosticInput[]): number => {
  if (diagnostics.length === 0) return PERFECT_SCORE;

  const errorRules = new Set<string>();
  const warningRules = new Set<string>();

  for (const diagnostic of diagnostics) {
    const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (diagnostic.severity === "error") {
      errorRules.add(ruleKey);
    } else {
      warningRules.add(ruleKey);
    }
  }

  const penalty = errorRules.size * ERROR_RULE_PENALTY + warningRules.size * WARNING_RULE_PENALTY;

  return Math.max(0, Math.round(PERFECT_SCORE - penalty));
};

const isValidDiagnostic = (value: unknown): value is DiagnosticInput => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.plugin === "string" &&
    typeof record.rule === "string" &&
    (record.severity === "error" || record.severity === "warning") &&
    typeof record.message === "string" &&
    typeof record.help === "string" &&
    typeof record.line === "number" &&
    typeof record.column === "number" &&
    typeof record.category === "string"
  );
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Content-Encoding",
};

export const OPTIONS = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

const respondError = (status: number, message: string): Response =>
  Response.json({ error: message }, { status, headers: CORS_HEADERS });

class DecompressedBodyTooLargeError extends Error {
  constructor() {
    super("decompressed body exceeds limit");
    this.name = "DecompressedBodyTooLargeError";
  }
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds limit");
    this.name = "RequestBodyTooLargeError";
  }
}

const isBufferTooLargeError = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE";

const decodeRequestBody = async (request: Request): Promise<unknown> => {
  const contentEncoding = request.headers.get("content-encoding")?.toLowerCase() ?? "";
  // Enforce the cap on the bytes actually read — the content-length
  // header is client-controlled (omittable / spoofable), so it can't be
  // the only guard, and the non-gzip path previously had no app-level cap.
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new RequestBodyTooLargeError();
  }
  if (contentEncoding === "gzip") {
    let decompressed: Buffer;
    try {
      decompressed = gunzipSync(rawBody, { maxOutputLength: MAX_DECOMPRESSED_BODY_BYTES });
    } catch (error) {
      if (isBufferTooLargeError(error)) throw new DecompressedBodyTooLargeError();
      throw error;
    }
    return JSON.parse(decompressed.toString("utf8"));
  }
  return JSON.parse(rawBody.toString("utf8"));
};

export const POST = async (request: Request): Promise<Response> => {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    return respondError(413, "Request body exceeds 4MB");
  }

  let body: unknown;
  try {
    body = await decodeRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return respondError(413, "Request body exceeds 4MB");
    }
    if (error instanceof DecompressedBodyTooLargeError) {
      return respondError(413, "Decompressed request body exceeds 4MB");
    }
    body = null;
  }

  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { diagnostics: unknown }).diagnostics)
  ) {
    return respondError(400, "Request body must contain a 'diagnostics' array");
  }

  const diagnostics = (body as { diagnostics: unknown[] }).diagnostics;
  if (diagnostics.length > MAX_DIAGNOSTICS_PER_REQUEST) {
    return respondError(413, "Too many diagnostics in a single request");
  }

  const isValidPayload = diagnostics.every((entry: unknown) => isValidDiagnostic(entry));

  if (!isValidPayload) {
    return respondError(
      400,
      "Each diagnostic must have 'plugin', 'rule', 'severity', 'message', 'help', 'line', 'column', and 'category'",
    );
  }

  const score = calculateScore(diagnostics as DiagnosticInput[]);

  return Response.json({ score, label: getScoreLabel(score) }, { headers: CORS_HEADERS });
};
