import type { AstCheck, ScanFinding } from "../types/index.js";
import { makeAstFinding } from "../utils/make-ast-finding.js";
import { walkAst } from "../utils/walk-ast.js";

// Flags the non-null assertion operator (`value!`). It silences the compiler's
// null/undefined check without proving the value is present, turning a
// would-be type error into a potential runtime crash.
export const tsNoNonNullAssertion: AstCheck = (file): ScanFinding[] => {
  const findings: ScanFinding[] = [];
  walkAst(file.program, (node) => {
    if (node.type !== "TSNonNullExpression") return;
    findings.push(
      makeAstFinding({
        file,
        scanner: "typescript",
        dimension: "ts-strictness",
        ruleId: "ts/no-non-null-assertion",
        severity: "warning",
        offset: typeof node.start === "number" ? node.start : 0,
        message: "Non-null assertion (`!`) hides a possible null/undefined; narrow the type instead.",
      }),
    );
  });
  return findings;
};
