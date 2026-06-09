import type { AstCheck, AstVisitorNode, ScanFinding } from "../types/index.js";
import { makeAstFinding } from "../utils/make-ast-finding.js";
import { walkAst } from "../utils/walk-ast.js";

// `as const` is a readonly/literal-narrowing assertion, not a slop type-cast,
// so it is exempt.
const isAsConst = (node: AstVisitorNode): boolean => {
  const annotation = node.typeAnnotation;
  if (typeof annotation !== "object" || annotation === null) return false;
  const reference = annotation as { type?: string; typeName?: { name?: string } };
  return reference.type === "TSTypeReference" && reference.typeName?.name === "const";
};

// Flags type assertions (`value as Foo` and `<Foo>value`). A cast overrides the
// compiler's inferred type and is a frequent source of unsound code; `as const`
// is exempt because it narrows rather than overrides.
export const tsNoTypeAssertion: AstCheck = (file): ScanFinding[] => {
  const findings: ScanFinding[] = [];
  walkAst(file.program, (node) => {
    if (node.type !== "TSAsExpression" && node.type !== "TSTypeAssertion") return;
    if (isAsConst(node)) return;
    findings.push(
      makeAstFinding({
        file,
        scanner: "typescript",
        dimension: "ts-strictness",
        ruleId: "ts/no-type-assertion",
        severity: "warning",
        offset: typeof node.start === "number" ? node.start : 0,
        message: "Type assertion overrides the inferred type; prefer a correct type or a runtime guard.",
      }),
    );
  });
  return findings;
};
