const PERFECT_SCORE = 100;
const ERROR_RULE_PENALTY = 1.5;
const WARNING_RULE_PENALTY = 0.75;
const SCORE_GOOD_THRESHOLD = 75;
const SCORE_OK_THRESHOLD = 50;
const MAX_REQUEST_BODY_BYTES = 1_000_000;
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

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

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
  "Access-Control-Allow-Headers": "Content-Type",
};

export const OPTIONS = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

const respondError = (status: number, message: string): Response =>
  Response.json({ error: message }, { status, headers: CORS_HEADERS });

export const POST = async (request: Request): Promise<Response> => {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    return respondError(413, "Request body exceeds 1MB");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
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
