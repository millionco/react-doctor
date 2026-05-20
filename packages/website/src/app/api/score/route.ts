import { gunzipSync } from "node:zlib";
import { PERFECT_SCORE } from "@/constants";
import { getScoreLabel } from "@/utils/get-score-label";

const ERROR_RULE_PENALTY = 1.5;
const WARNING_RULE_PENALTY = 0.75;
const MAX_REQUEST_BODY_BYTES = 2_000_000;
const MAX_DECOMPRESSED_BODY_BYTES = 25_000_000;
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

const isBufferTooLargeError = (error: unknown): boolean =>
  error instanceof Error && (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE";

const decodeRequestBody = async (request: Request): Promise<unknown> => {
  const contentEncoding = request.headers.get("content-encoding")?.toLowerCase() ?? "";
  if (contentEncoding === "gzip") {
    const rawBody = Buffer.from(await request.arrayBuffer());
    let decompressed: Buffer;
    try {
      decompressed = gunzipSync(rawBody, { maxOutputLength: MAX_DECOMPRESSED_BODY_BYTES });
    } catch (error) {
      if (isBufferTooLargeError(error)) throw new DecompressedBodyTooLargeError();
      throw error;
    }
    return JSON.parse(decompressed.toString("utf8"));
  }
  return request.json();
};

export const POST = async (request: Request): Promise<Response> => {
  // used for rate limiting bad actors
  const ip = (request as any).ip || request.headers.get("x-forwarded-for") || "unknown";
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    return respondError(413, "Request body exceeds 2MB");
  }

  let body: unknown;
  try {
    body = await decodeRequestBody(request);
  } catch (error) {
    if (error instanceof DecompressedBodyTooLargeError) {
      return respondError(413, "Decompressed request body exceeds 25MB");
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

  console.log({ ip, score }, diagnostics);

  return Response.json({ score, label: getScoreLabel(score) }, { headers: CORS_HEADERS });
};
