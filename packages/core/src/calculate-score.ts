import { gzipSync } from "node:zlib";
import { FETCH_TIMEOUT_MS, SCORE_API_URL } from "./constants.js";
import type { Diagnostic, ScoreResult } from "./types/index.js";

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
  if (isAbortError(error)) return `timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};

export interface CalculateScoreOptions {
  /** Marks the run as CI-originated. */
  isCi?: boolean;
}

export const calculateScore = async (
  diagnostics: Diagnostic[],
  options: CalculateScoreOptions = {},
): Promise<ScoreResult | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const requestUrl = options.isCi ? `${SCORE_API_URL}?ci=1` : SCORE_API_URL;

  try {
    const requestBody = JSON.stringify({ diagnostics: stripFilePaths(diagnostics) });
    const compressedBody = gzipSync(requestBody);

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
      body: compressedBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[react-doctor] Score API returned ${response.status} ${response.statusText}`);
      return null;
    }

    return parseScoreResult(await response.json());
  } catch (error) {
    console.warn(`[react-doctor] Score API unreachable (${describeFailure(error)})`);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};
