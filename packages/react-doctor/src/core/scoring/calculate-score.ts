import type { Diagnostic } from "../../types/diagnostic.js";
import type { ScoreResult } from "../../types/score.js";
import { calculateScoreLocally } from "./calculate-score-locally.js";
import { tryScoreFromApi } from "./try-score-from-api.js";
import { proxyFetch } from "./proxy-fetch.js";

export { calculateScoreLocally, calculateScoreBreakdown } from "./calculate-score-locally.js";

export const calculateScore = async (diagnostics: Diagnostic[]): Promise<ScoreResult | null> =>
  (await tryScoreFromApi(diagnostics, proxyFetch)) ?? calculateScoreLocally(diagnostics);
