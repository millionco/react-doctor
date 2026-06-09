import type { AstCheck, ScanFinding } from "../types/index.js";
import { makeAstFinding } from "../utils/make-ast-finding.js";
import { walkAst } from "../utils/walk-ast.js";

// Flags every explicit `any` type annotation. `any` opts a value out of the
// type system entirely — the single loudest TypeScript slop signal — so each
// occurrence is a finding. (Implicit `any` is a tsc concern; this catches the
// explicit, agent-authored kind without needing a type-checker.)
export const tsNoExplicitAny: AstCheck = (file): ScanFinding[] => {
  const findings: ScanFinding[] = [];
  walkAst(file.program, (node) => {
    if (node.type !== "TSAnyKeyword") return;
    findings.push(
      makeAstFinding({
        file,
        scanner: "typescript",
        dimension: "ts-strictness",
        ruleId: "ts/no-explicit-any",
        severity: "warning",
        offset: typeof node.start === "number" ? node.start : 0,
        message: "Explicit `any` disables type checking for this value; give it a real type.",
      }),
    );
  });
  return findings;
};
