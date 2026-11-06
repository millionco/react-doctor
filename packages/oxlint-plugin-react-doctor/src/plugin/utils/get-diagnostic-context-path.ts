import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DiagnosticContextIdentity {
  readonly filename: string;
  readonly rule: string;
  readonly offset: number;
  readonly message: string;
}

interface DiagnosticContextPathInput extends DiagnosticContextIdentity {
  readonly directory: string;
}

export const getDiagnosticContextPath = (input: DiagnosticContextPathInput): string => {
  let filename = path.resolve(input.filename);
  try {
    filename = fs.realpathSync(filename);
  } catch {
    filename = path.normalize(filename);
  }
  const identity = [filename, input.rule, input.offset, input.message];
  const digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  return path.join(input.directory, `${encodeURIComponent(input.rule)}-${digest}.json`);
};
