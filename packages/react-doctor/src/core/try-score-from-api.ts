import { FETCH_TIMEOUT_MS, SCORE_API_URL } from "../constants.js";
import type { Diagnostic } from "../types/diagnostic.js";
import type { ScoreResult } from "../types/score.js";

const parseScoreResult = (value: unknown): ScoreResult | null => {
  if (typeof value !== "object" || value === null) return null;
  if (!("score" in value) || !("label" in value)) return null;
  const scoreValue = Reflect.get(value, "score");
  const labelValue = Reflect.get(value, "label");
  if (typeof scoreValue !== "number" || typeof labelValue !== "string") return null;
  return { score: scoreValue, label: labelValue };
};

const stripFilePaths = (diagnostics: Diagnostic[]): Omit<Diagnostic, "filePath">[] =>
  diagnostics.map(({ filePath: _filePath, ...rest }) => rest);

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

const describeFailure = (error: unknown): string => {
  if (isAbortError(error)) {
    return `timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  }
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};

export const tryScoreFromApi = async (
  diagnostics: Diagnostic[],
  fetchImplementation: typeof fetch | undefined,
): Promise<ScoreResult | null> => {
  if (typeof fetchImplementation !== "function") return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(SCORE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostics: stripFilePaths(diagnostics) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(
        `[react-doctor] Score API returned ${response.status} ${response.statusText} — using local scoring`,
      );
      return null;
    }

    return parseScoreResult(await response.json());
  } catch (error) {
    console.warn(
      `[react-doctor] Score API unreachable (${describeFailure(error)}) — using local scoring`,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
