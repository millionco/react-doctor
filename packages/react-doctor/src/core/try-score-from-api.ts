import { FETCH_TIMEOUT_MS, SCORE_API_URL } from "../constants.js";
import type { Diagnostic, ScoreResult } from "../types.js";

interface ScoreRequestFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

const parseScoreResult = (value: unknown): ScoreResult | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("score" in value) || !("label" in value)) return null;
  const scoreValue = Reflect.get(value, "score");
  const labelValue = Reflect.get(value, "label");
  if (typeof scoreValue !== "number" || typeof labelValue !== "string") return null;
  return { score: scoreValue, label: labelValue };
};

export const tryScoreFromApi = async (
  diagnostics: Diagnostic[],
  fetchImplementation: ScoreRequestFetch,
): Promise<ScoreResult | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(SCORE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostics }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    return parseScoreResult(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
