import { DIAGNOSTIC_SOURCE } from "../constants.js";
import type { ReactDoctorDiagnosticData } from "../types.js";

/**
 * Reads the structured payload this server attaches to every diagnostic's
 * `data` field and a client echoes back on hover / code-action / command
 * requests. Returns `null` for diagnostics this server didn't emit or whose
 * round-tripped payload no longer matches the server-owned contract.
 */
export const readDiagnosticData = (diagnostic: {
  source?: string;
  data?: unknown;
}): ReactDoctorDiagnosticData | null => {
  if (diagnostic.source !== DIAGNOSTIC_SOURCE) return null;
  const { data } = diagnostic;
  if (data === null || typeof data !== "object") return null;
  const identity = Reflect.get(data, "identity");
  const plugin = Reflect.get(data, "plugin");
  const rule = Reflect.get(data, "rule");
  const ruleId = Reflect.get(data, "ruleId");
  const category = Reflect.get(data, "category");
  const help = Reflect.get(data, "help");
  const url = Reflect.get(data, "url");
  const suppressionHint = Reflect.get(data, "suppressionHint");
  const line = Reflect.get(data, "line");
  const column = Reflect.get(data, "column");
  const fsPath = Reflect.get(data, "fsPath");
  if (
    typeof identity !== "string" ||
    typeof plugin !== "string" ||
    typeof rule !== "string" ||
    typeof ruleId !== "string" ||
    typeof category !== "string" ||
    typeof help !== "string" ||
    (url !== null && typeof url !== "string") ||
    (suppressionHint !== null && typeof suppressionHint !== "string") ||
    typeof line !== "number" ||
    typeof column !== "number" ||
    typeof fsPath !== "string"
  ) {
    return null;
  }
  return {
    identity,
    plugin,
    rule,
    ruleId,
    category,
    help,
    url,
    suppressionHint,
    line,
    column,
    fsPath,
  };
};
