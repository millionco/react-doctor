import { SCORE_API_EMPTY_RESPONSE_STATUS } from "../constants";
import { SCORE_API_CORS_HEADERS } from "./score-api-cors-headers";

export const createScoreApiOptionsResponse = (): Response =>
  new Response(null, { status: SCORE_API_EMPTY_RESPONSE_STATUS, headers: SCORE_API_CORS_HEADERS });
