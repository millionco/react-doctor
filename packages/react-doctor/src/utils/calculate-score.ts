import { SCORE_API_URL } from "../constants.js";
import type { Diagnostic, ScoreResult } from "../types.js";
import { calculateScoreLocally } from "react-doctor-core";
import { proxyFetch } from "./proxy-fetch.js";

export { calculateScoreLocally } from "react-doctor-core";

export const calculateScore = async (diagnostics: Diagnostic[]): Promise<ScoreResult | null> => {
  try {
    const response = await proxyFetch(SCORE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostics }),
    });

    if (!response.ok) return calculateScoreLocally(diagnostics);

    return (await response.json()) as ScoreResult;
  } catch {
    return calculateScoreLocally(diagnostics);
  }
};
