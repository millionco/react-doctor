import { AST_CHECKS } from "../checks/index.js";
import type { ScanFinding, ScannerContext } from "../types/index.js";
import { parseSourceFile } from "../utils/parse-source-file.js";

// Parse each changed source file once and run every AST check over it. Covers
// the TypeScript-strictness, composition, and deslop dimensions that React
// Doctor does not. Unparsable / non-source files are silently skipped — a file
// the parser rejects cannot be fairly scored for AST-level slop.
export const runAstChecks = (context: ScannerContext): ScanFinding[] => {
  const findings: ScanFinding[] = [];
  for (const filePath of context.changedFiles) {
    const parsed = parseSourceFile(context.rootDirectory, filePath);
    if (!parsed) continue;
    for (const check of AST_CHECKS) {
      findings.push(...check(parsed));
    }
  }
  return findings;
};
