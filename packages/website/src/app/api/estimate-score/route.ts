import { getScoreLabel, scoreFromRuleCounts, countUniqueRules } from "react-doctor-web";
import { SCORE_API_CORS_HEADERS } from "../../../utils/score-api-cors-headers";
import { createScoreApiOptionsResponse } from "../../../utils/create-score-api-options-response";
import { parseDiagnosticsFromBody } from "../../../utils/parse-diagnostics-from-body";

const ERROR_ESTIMATED_FIX_RATE = 0.85;
const WARNING_ESTIMATED_FIX_RATE = 0.8;

export const OPTIONS = createScoreApiOptionsResponse;

export const POST = async (request: Request): Promise<Response> => {
  const body = await request.json().catch(() => null);
  console.log("[/api/estimate-score]", JSON.stringify(body));

  const parsed = parseDiagnosticsFromBody(body);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { errorRuleCount, warningRuleCount } = countUniqueRules(parsed.diagnostics);

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
    { headers: SCORE_API_CORS_HEADERS },
  );
};
