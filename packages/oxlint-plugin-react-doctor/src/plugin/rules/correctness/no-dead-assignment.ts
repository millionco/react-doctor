import { defineRule } from "../../utils/define-rule.js";
import { isCapturedByClosure } from "../../utils/is-captured-by-closure.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

// A reassignable local whose value is read somewhere is the only binding a
// dead store can apply to: `const` can't be reassigned, and a binding with
// no reads at all is `no-unused-vars`'s job, not ours.
const isDeadStoreCandidate = (symbol: SymbolDescriptor | null): symbol is SymbolDescriptor => {
  if (!symbol) return false;
  if (symbol.kind !== "let" && symbol.kind !== "var") return false;
  if (isCapturedByClosure(symbol)) return false;
  return symbol.references.some(
    (reference) => reference.flag === "read" || reference.flag === "read-write",
  );
};

const reportIfDeadStore = (context: RuleContext, writeIdentifier: EsTreeNode): void => {
  const symbol = context.scopes.symbolFor(writeIdentifier);
  if (!isDeadStoreCandidate(symbol)) return;
  const value = context.ssa.versionAt(writeIdentifier);
  if (!value || context.ssa.isLiveValue(value)) return;
  context.report({
    node: writeIdentifier,
    message: `The value assigned to "${value.name}" here is never read — every path overwrites it before use. Remove this assignment or use the value.`,
  });
};

export const noDeadAssignment = defineRule({
  id: "no-dead-assignment",
  title: "Dead assignment",
  severity: "warn",
  recommendation:
    "Remove the assignment whose value is never read, or use the value before reassigning. A write that every path overwrites before reading is dead code that hides the real data flow.",
  create: (context: RuleContext) => ({
    // `x = …;` as its own statement — the clearest dead-store shape, and the
    // one our straight-line SSA buckets unambiguously.
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (node.operator !== "=") return;
      if (!isNodeOfType(node.left, "Identifier")) return;
      if (!node.parent || !isNodeOfType(node.parent, "ExpressionStatement")) return;
      reportIfDeadStore(context, node.left);
    },
    // `let x = …;` / `var x = …;` declared at statement level (not a
    // for-header or export) — a dead initializer.
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init || !isNodeOfType(node.id, "Identifier")) return;
      const declaration = node.parent;
      if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return;
      const container = declaration.parent;
      if (
        !container ||
        (!isNodeOfType(container, "BlockStatement") && !isNodeOfType(container, "Program"))
      ) {
        return;
      }
      reportIfDeadStore(context, node.id);
    },
  }),
});
