import { SCORE_API_CLIENT_ERROR_STATUS } from "../constants";
import type { Diagnostic } from "react-doctor-web";
import { isValidScoreApiDiagnostic } from "./is-valid-score-api-diagnostic";
import { SCORE_API_CORS_HEADERS } from "./score-api-cors-headers";

const MISSING_DIAGNOSTICS_ARRAY_MESSAGE = "Request body must contain a 'diagnostics' array";

const INVALID_DIAGNOSTIC_FIELDS_MESSAGE =
  "Each diagnostic must have 'filePath', 'plugin', 'rule', 'severity', 'message', 'help', 'line', 'column', and 'category'";

const respondWithScoreApiClientError = (message: string): Response =>
  Response.json(
    { error: message },
    { status: SCORE_API_CLIENT_ERROR_STATUS, headers: SCORE_API_CORS_HEADERS },
  );

const readDiagnosticsArray = (body: unknown): unknown[] | null => {
  if (typeof body !== "object" || body === null) return null;
  const diagnostics = Reflect.get(body, "diagnostics");
  return Array.isArray(diagnostics) ? diagnostics : null;
};

export const parseDiagnosticsFromBody = (
  body: unknown,
): { ok: true; diagnostics: Diagnostic[] } | { ok: false; response: Response } => {
  const diagnosticsArray = readDiagnosticsArray(body);

  if (diagnosticsArray === null) {
    return {
      ok: false,
      response: respondWithScoreApiClientError(MISSING_DIAGNOSTICS_ARRAY_MESSAGE),
    };
  }

  const isValidPayload = diagnosticsArray.every((entry: unknown) =>
    isValidScoreApiDiagnostic(entry),
  );

  if (!isValidPayload) {
    return {
      ok: false,
      response: respondWithScoreApiClientError(INVALID_DIAGNOSTIC_FIELDS_MESSAGE),
    };
  }

  return { ok: true, diagnostics: diagnosticsArray };
};
