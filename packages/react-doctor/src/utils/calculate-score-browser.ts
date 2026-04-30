import type { Diagnostic, ScoreResult } from "../types.js";
import { calculateScoreLocally } from "../core/calculate-score-locally.js";
import { tryScoreFromApi } from "../core/try-score-from-api.js";

export { calculateScoreLocally } from "../core/calculate-score-locally.js";

const getGlobalFetch = (): typeof fetch | undefined =>
  typeof fetch === "function" ? fetch : undefined;

export const calculateScore = async (
  diagnostics: Diagnostic[],
  fetchImplementation: typeof fetch | undefined = getGlobalFetch(),
): Promise<ScoreResult | null> =>
  (await tryScoreFromApi(diagnostics, fetchImplementation)) ?? calculateScoreLocally(diagnostics);
