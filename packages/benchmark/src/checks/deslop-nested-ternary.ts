import type { AstCheck, ScanFinding } from "../types/index.js";
import { makeAstFinding } from "../utils/make-ast-finding.js";
import { walkAst } from "../utils/walk-ast.js";

const asNode = (value: unknown): { type?: string; start?: unknown } | null =>
  typeof value === "object" && value !== null ? (value as { type?: string }) : null;

// Flags nested ternaries (the deslop skill calls them out explicitly): a
// `ConditionalExpression` whose consequent or alternate is itself a
// `ConditionalExpression`. Only the outermost of each chain is reported — inner
// conditionals reached as a parent's branch are tracked and skipped — so one
// `a ? b : c ? d : e` chain yields exactly one finding, not a cascade.
export const deslopNestedTernary: AstCheck = (file): ScanFinding[] => {
  const nestedChildren = new Set<unknown>();
  const candidates: Array<{ type?: string; start?: unknown }> = [];

  walkAst(file.program, (node) => {
    if (node.type !== "ConditionalExpression") return;
    const consequent = asNode(node.consequent);
    const alternate = asNode(node.alternate);
    const consequentIsTernary = consequent?.type === "ConditionalExpression";
    const alternateIsTernary = alternate?.type === "ConditionalExpression";
    if (consequentIsTernary) nestedChildren.add(node.consequent);
    if (alternateIsTernary) nestedChildren.add(node.alternate);
    if (consequentIsTernary || alternateIsTernary) candidates.push(node);
  });

  return candidates
    .filter((node) => !nestedChildren.has(node))
    .map((node) =>
      makeAstFinding({
        file,
        scanner: "deslop-heuristics",
        dimension: "maintainability",
        ruleId: "deslop/nested-ternary",
        severity: "warning",
        offset: typeof node.start === "number" ? node.start : 0,
        message: "Nested ternary is hard to read; use an if/else chain, switch, or extracted helper.",
      }),
    );
};
