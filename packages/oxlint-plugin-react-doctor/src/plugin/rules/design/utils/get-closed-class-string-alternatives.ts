import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  CLOSED_CLASS_MERGER_ALTERNATIVE_LIMIT,
  CLOSED_CLASS_MERGER_EXPRESSION_LIMIT,
  CLOSED_CLASS_MERGER_STRING_LENGTH_LIMIT,
} from "./closed-class-merger/constants.js";

export const getClosedClassStringAlternatives = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyArray<string> | null => {
  const program = findProgramRoot(expression);
  if (!program) return null;
  let remainingExpressions = CLOSED_CLASS_MERGER_EXPRESSION_LIMIT;
  const resolving = new Set<EsTreeNode>();
  const resolve = (rawExpression: EsTreeNode): ReadonlyArray<string> | null => {
    if (--remainingExpressions < 0) return null;
    const candidate = stripParenExpression(rawExpression);
    if (resolving.has(candidate)) return null;
    const value = getStaticStringExpression(candidate);
    if (value !== null)
      return value.length <= CLOSED_CLASS_MERGER_STRING_LENGTH_LIMIT ? [value] : null;
    if (isNodeOfType(candidate, "Literal")) {
      return candidate.value === null || candidate.value === false || candidate.value === 0
        ? [""]
        : null;
    }
    if (isNodeOfType(candidate, "Identifier")) {
      if (candidate.name === "undefined" && scopes.isGlobalReference(candidate)) return [""];
      const symbol = scopes.symbolFor(candidate);
      const initializer = symbol && getDirectConstInitializer(symbol);
      if (
        !symbol ||
        !initializer ||
        !isSymbolReadOnly(symbol) ||
        !hasCompleteSymbolReferences(symbol, program, scopes)
      )
        return null;
      resolving.add(candidate);
      const values = resolve(initializer);
      resolving.delete(candidate);
      return values;
    }
    if (isNodeOfType(candidate, "LogicalExpression") && candidate.operator === "&&") {
      const values = resolve(candidate.right);
      return values && values.length < CLOSED_CLASS_MERGER_ALTERNATIVE_LIMIT
        ? [...new Set(["", ...values])]
        : null;
    }
    if (!isNodeOfType(candidate, "ConditionalExpression")) return null;
    const consequent = resolve(candidate.consequent);
    const alternate = resolve(candidate.alternate);
    if (!consequent || !alternate) return null;
    const values = [...new Set([...consequent, ...alternate])];
    return values.length <= CLOSED_CLASS_MERGER_ALTERNATIVE_LIMIT ? values : null;
  };
  return resolve(expression);
};
