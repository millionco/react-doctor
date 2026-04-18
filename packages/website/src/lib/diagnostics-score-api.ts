export interface DiagnosticInput {
  filePath: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
  weight?: number;
}

export const isValidDiagnostic = (value: unknown): value is DiagnosticInput => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.filePath === "string" &&
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

export const SCORE_API_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const scoreApiOptions = (): Response =>
  new Response(null, { status: 204, headers: SCORE_API_CORS_HEADERS });

const MISSING_DIAGNOSTICS_ARRAY_MESSAGE = "Request body must contain a 'diagnostics' array";

const INVALID_DIAGNOSTIC_FIELDS_MESSAGE =
  "Each diagnostic must have 'filePath', 'plugin', 'rule', 'severity', 'message', 'help', 'line', 'column', and 'category'";

export const parseDiagnosticsFromBody = (
  body: unknown,
): { ok: true; diagnostics: DiagnosticInput[] } | { ok: false; response: Response } => {
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { diagnostics?: unknown }).diagnostics)
  ) {
    return {
      ok: false,
      response: Response.json(
        { error: MISSING_DIAGNOSTICS_ARRAY_MESSAGE },
        { status: 400, headers: SCORE_API_CORS_HEADERS },
      ),
    };
  }

  const diagnostics = (body as { diagnostics: unknown[] }).diagnostics;
  const isValidPayload = diagnostics.every((entry: unknown) => isValidDiagnostic(entry));

  if (!isValidPayload) {
    return {
      ok: false,
      response: Response.json(
        { error: INVALID_DIAGNOSTIC_FIELDS_MESSAGE },
        { status: 400, headers: SCORE_API_CORS_HEADERS },
      ),
    };
  }

  return { ok: true, diagnostics };
};
