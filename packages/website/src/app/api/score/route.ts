import { calculateScoreLocally } from "react-doctor-web";
import {
  parseDiagnosticsFromBody,
  SCORE_API_CORS_HEADERS,
  scoreApiOptions,
} from "../../../lib/diagnostics-score-api";

export const OPTIONS = scoreApiOptions;

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
