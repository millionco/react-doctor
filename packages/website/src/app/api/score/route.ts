import { calculateScoreLocally } from "react-doctor-web";
import { SCORE_API_CORS_HEADERS } from "../../../utils/score-api-cors-headers";
import { createScoreApiOptionsResponse } from "../../../utils/create-score-api-options-response";
import { parseDiagnosticsFromBody } from "../../../utils/parse-diagnostics-from-body";

export const OPTIONS = createScoreApiOptionsResponse;

export const POST = async (request: Request): Promise<Response> => {
  const body = await request.json().catch(() => null);
  console.log("[/api/score]", JSON.stringify(body));

  const parsed = parseDiagnosticsFromBody(body);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { score, label } = calculateScoreLocally(parsed.diagnostics);

  return Response.json({ score, label }, { headers: SCORE_API_CORS_HEADERS });
};
