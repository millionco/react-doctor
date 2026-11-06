import * as fs from "node:fs";
import * as Schema from "effect/Schema";
import { getDiagnosticContextPath } from "oxlint-plugin-react-doctor/core";
import type {
  DiagnosticContextIdentity,
  DiagnosticContextRange,
} from "oxlint-plugin-react-doctor/core";
import { DiagnosticContextRangeSchema } from "./diagnostic-context-range-schema.js";
import { failOpenReadJson } from "./fail-open-read-json.js";

const decodeRanges = Schema.decodeUnknownSync(Schema.Array(DiagnosticContextRangeSchema));

export const createDiagnosticContextReader = (
  directory: string | undefined,
): ((identity: DiagnosticContextIdentity) => ReadonlyArray<DiagnosticContextRange>) => {
  const recordedRules = new Set<string>();
  if (directory) {
    try {
      for (const filename of fs.readdirSync(directory)) {
        if (!filename.endsWith(".json")) continue;
        recordedRules.add(filename.slice(0, filename.lastIndexOf("-")));
      }
    } catch {
      recordedRules.clear();
    }
  }
  return (identity) => {
    if (!directory || !recordedRules.has(encodeURIComponent(identity.rule))) return [];
    try {
      const contextPath = getDiagnosticContextPath({ ...identity, directory });
      return decodeRanges(failOpenReadJson<unknown>(contextPath, []));
    } catch {
      return [];
    }
  };
};
