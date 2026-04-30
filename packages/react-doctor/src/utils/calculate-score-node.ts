import type { Diagnostic, ScoreResult } from "../types.js";
import { calculateScore as calculateScoreShared } from "./calculate-score-browser.js";
import { proxyFetch } from "./proxy-fetch.js";

export { calculateScoreLocally } from "../core/calculate-score-locally.js";

export const calculateScore = (diagnostics: Diagnostic[]): Promise<ScoreResult | null> =>
  calculateScoreShared(diagnostics, proxyFetch);
