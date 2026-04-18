import { getScoreLabel, scoreFromRuleCounts, countUniqueRules } from "react-doctor-core/browser";

const ERROR_ESTIMATED_FIX_RATE = 0.85;
const WARNING_ESTIMATED_FIX_RATE = 0.8;

interface DiagnosticInput {
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

const isValidDiagnostic = (value: unknown): value is DiagnosticInput => {
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const OPTIONS = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST = async (request: Request): Promise<Response> => {
  const body = await request.json().catch(() => null);
  console.log("[/api/estimate-score]", JSON.stringify(body));

  if (!body || !Array.isArray(body.diagnostics)) {
    return Response.json(
      { error: "Request body must contain a 'diagnostics' array" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const isValidPayload = body.diagnostics.every((entry: unknown) => isValidDiagnostic(entry));

  if (!isValidPayload) {
    return Response.json(
      {
        error:
          "Each diagnostic must have 'filePath', 'plugin', 'rule', 'severity', 'message', 'help', 'line', 'column', and 'category'",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { errorRuleCount, warningRuleCount } = countUniqueRules(body.diagnostics);

  const currentScore = scoreFromRuleCounts(errorRuleCount, warningRuleCount);

  const estimatedUnfixedErrorRuleCount = Math.round(
    errorRuleCount * (1 - ERROR_ESTIMATED_FIX_RATE),
  );
  const estimatedUnfixedWarningRuleCount = Math.round(
    warningRuleCount * (1 - WARNING_ESTIMATED_FIX_RATE),
  );
  const estimatedScore = scoreFromRuleCounts(
    estimatedUnfixedErrorRuleCount,
    estimatedUnfixedWarningRuleCount,
  );

  return Response.json(
    {
      currentScore,
      currentLabel: getScoreLabel(currentScore),
      estimatedScore,
      estimatedLabel: getScoreLabel(estimatedScore),
    },
    { headers: CORS_HEADERS },
  );
};
