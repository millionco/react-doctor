import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  getTypeofBrowserGlobalName,
  readBrowserGlobalAvailability,
} from "./read-browser-global-availability.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const getSwitchDiscriminantWhenGlobalIsMissing = (
  expression: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): string | boolean | null => {
  const discriminant = stripParenExpression(expression);
  if (getTypeofBrowserGlobalName(discriminant, context) === browserGlobalName) {
    return "undefined";
  }
  if (
    !isNodeOfType(discriminant, "BinaryExpression") ||
    (getTypeofBrowserGlobalName(discriminant.left, context) !== browserGlobalName &&
      getTypeofBrowserGlobalName(discriminant.right, context) !== browserGlobalName)
  ) {
    return null;
  }
  return readBrowserGlobalAvailability(discriminant, browserGlobalName, context, false);
};

export const isSwitchCaseGuardedByBrowserAvailability = (
  switchCase: EsTreeNodeOfType<"SwitchCase">,
  childNode: EsTreeNode,
  browserGlobalName: string,
  context: RuleContext,
): boolean => {
  const switchStatement = switchCase.parent;
  if (
    !isNodeOfType(switchStatement, "SwitchStatement") ||
    !switchCase.consequent.some((statement) => statement === childNode)
  ) {
    return false;
  }
  const missingValue = getSwitchDiscriminantWhenGlobalIsMissing(
    switchStatement.discriminant,
    browserGlobalName,
    context,
  );
  if (missingValue === null) return false;

  const cases = switchStatement.cases;
  const targetIndex = cases.findIndex((candidate) => candidate === switchCase);
  let defaultIndex = -1;
  let matchingIndex = -1;
  for (const [index, candidate] of cases.entries()) {
    if (!candidate.test) {
      defaultIndex = index;
      continue;
    }
    const selector = stripParenExpression(candidate.test);
    if (!isNodeOfType(selector, "Literal")) return false;
    if (selector.value === missingValue) {
      matchingIndex = index;
      break;
    }
  }

  const entryIndex = matchingIndex === -1 ? defaultIndex : matchingIndex;
  if (entryIndex === -1 || entryIndex > targetIndex) return true;
  return cases
    .slice(entryIndex, targetIndex)
    .some((candidate) =>
      candidate.consequent.some(
        (statement) =>
          isNodeOfType(statement, "BreakStatement") ||
          isNodeOfType(statement, "ReturnStatement") ||
          isNodeOfType(statement, "ThrowStatement"),
      ),
    );
};
