import type { Diagnostic, ScoreResult } from "../types.js";
import { calculateScoreLocally } from "../core/calculate-score-locally.js";
import { tryScoreFromApi } from "../core/try-score-from-api.js";

export { calculateScoreLocally } from "../core/calculate-score-locally.js";

export const calculateScore = async (diagnostics: Diagnostic[]): Promise<ScoreResult | null> =>
  (await tryScoreFromApi(diagnostics, fetch)) ?? calculateScoreLocally(diagnostics);
