import type { z } from "zod";

import { redactSensitiveText } from "../../../core/src/utils/redact-sensitive-text.js";
import {
  CLASSIFICATION_MAX_EVIDENCE_DEPTH,
  CLASSIFICATION_MAX_EVIDENCE_ENTRIES,
  CLASSIFICATION_MAX_RESPONSE_CHARACTERS,
} from "../constants.js";

export const sanitizeClassificationEvidence = (value: unknown): z.core.util.JSONType => {
  let remaining = CLASSIFICATION_MAX_RESPONSE_CHARACTERS;
  const ancestors = new Set<object>();
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  const visit = (input: unknown, depth: number): z.core.util.JSONType => {
    if (remaining <= 0 || depth > CLASSIFICATION_MAX_EVIDENCE_DEPTH) return "[omitted]";
    remaining -= 1;
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : String(input);
    if (typeof input === "string") {
      if (input.length > remaining) return "[oversized string omitted]";
      let text = input;
      if (gatewayKey) text = text.replaceAll(gatewayKey, "<redacted>");
      text = redactSensitiveText(text);
      remaining -= text.length;
      return text;
    }
    if (typeof input !== "object" || ancestors.has(input)) return "[unsupported]";
    ancestors.add(input);
    let result: z.core.util.JSONType;
    if (Array.isArray(input)) {
      result = input
        .slice(0, CLASSIFICATION_MAX_EVIDENCE_ENTRIES)
        .map((entry) => visit(entry, depth + 1));
    } else {
      const entries: Array<[string, z.core.util.JSONType]> = [];
      for (const [key, entry] of Object.entries(input).slice(
        0,
        CLASSIFICATION_MAX_EVIDENCE_ENTRIES,
      )) {
        if (remaining <= 0) break;
        const safeKey = redactSensitiveText(
          gatewayKey ? key.replaceAll(gatewayKey, "<redacted>") : key,
        ).slice(0, CLASSIFICATION_MAX_RESPONSE_CHARACTERS);
        remaining -= safeKey.length;
        entries.push([
          safeKey,
          /key|token|secret|password|authorization|cookie|headers|request|prompt|code/i.test(key)
            ? "<redacted>"
            : visit(entry, depth + 1),
        ]);
      }
      result = Object.fromEntries(entries);
    }
    ancestors.delete(input);
    return result;
  };
  const sanitized = visit(value, 0);
  return JSON.stringify(sanitized).length <= CLASSIFICATION_MAX_RESPONSE_CHARACTERS
    ? sanitized
    : { omitted: "Evidence exceeds the serialized size budget" };
};
