import { DIAGNOSTIC_SOURCE } from "../constants.js";
import type { ReactDoctorDiagnosticData } from "../types.js";

/**
 * Reads the structured payload this server attaches to every diagnostic's
 * `data` field and a client echoes back on hover / code-action / command
 * requests. Returns `null` for diagnostics this server didn't emit. The
 * cast is sound: `ruleId` discriminates our own round-tripped payload.
 */
export const readDiagnosticData = (diagnostic: {
  source?: string;
  data?: unknown;
}): ReactDoctorDiagnosticData | null => {
  if (diagnostic.source !== DIAGNOSTIC_SOURCE) return null;
  const { data } = diagnostic;
  if (data === null || typeof data !== "object" || !("ruleId" in data)) return null;
  return data as ReactDoctorDiagnosticData;
};
