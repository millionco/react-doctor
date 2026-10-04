import { APICallError, InvalidResponseDataError, TypeValidationError } from "ai";
import type { z } from "zod";

import { sanitizeClassificationEvidence } from "./utils/sanitize-classification-evidence.js";

export class ClassificationResponseError extends Error {
  readonly evidence: z.core.util.JSONType;

  constructor(message: string, evidence: unknown) {
    super(message);
    this.evidence = sanitizeClassificationEvidence(evidence);
  }
}

export const classificationErrorEvidence = (error: unknown): unknown => {
  if (error instanceof ClassificationResponseError) return error.evidence;
  if (InvalidResponseDataError.isInstance(error)) return error.data;
  if (TypeValidationError.isInstance(error)) return error.value;
  if (APICallError.isInstance(error)) {
    let body: unknown = error.responseBody;
    try {
      body = error.responseBody ? JSON.parse(error.responseBody) : null;
    } catch {
      body = "[Non-JSON response body omitted]";
    }
    return { statusCode: error.statusCode, responseBody: body };
  }
  return null;
};
