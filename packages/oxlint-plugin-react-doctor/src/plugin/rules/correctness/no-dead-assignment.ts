import { defineRule } from "../../utils/define-rule.js";
import { isCapturedByClosure } from "../../utils/is-captured-by-closure.js";
import { isInsideTryBlock } from "../../utils/is-inside-try-block.js";
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

// A binding written inside a `try` body is invisible to SSA liveness on the
// exceptional path: the CFG models the exception coarsely (a single edge from
// the try ENTRY to the handler), so a value that survives a throw — the
// pre-`try` init read after `try { x = risky() } catch {}`, or a write in a
// nested `catch` read in the outer `catch` — looks dead. Treat any such
// binding conservatively rather than risk a false dead-store report.
//
// Deliberately symbol-wide: one try-body write silences dead-store reports for
// EVERY write of that symbol, not just the exceptional one. That sacrifices a
// real dead store unrelated to the try (`let x = 1; x = 2; use(x); try { x = … }`)
// to stay sound under the coarse throw model — recall we accept on a `warn`
// rule. Do not narrow this to the examined write without restoring liveness on
// the exceptional edge first, or the try/catch false positives return.
const hasWriteInsideTryBlock = (symbol: SymbolDescriptor): boolean =>
  symbol.references.some(
    (reference) =>
      (reference.flag === "write" || reference.flag === "read-write") &&
      isInsideTryBlock(reference.identifier),
  );

const reportIfDeadStore = (context: RuleContext, writeIdentifier: EsTreeNode): void => {
  const symbol = context.scopes.symbolFor(writeIdentifier);
  if (!isDeadStoreCandidate(symbol)) return;
  // Two disjoint guards, not redundant: a `VariableDeclarator` id is a binding,
  // not a reference (see scope-analysis), so a declarator init inside a `try`
  // is absent from `symbol.references` and only the direct node check catches
  // it; `hasWriteInsideTryBlock` covers the init-outside / reassigned-inside
  // shape (excalidraw) whose reassignment IS a reference.
  if (isInsideTryBlock(writeIdentifier) || hasWriteInsideTryBlock(symbol)) return;
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
