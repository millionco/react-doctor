import {
  CHAINABLE_ITERATION_METHODS,
  ITERATOR_PRODUCING_METHOD_NAMES,
} from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

const isIteratorProducingCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  generatorNamesInFile: ReadonlySet<string>,
): boolean => {
  const callee = callExpression.callee;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Iterator" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "from"
  ) {
    return true;
  }
  if (isNodeOfType(callee, "Identifier") && generatorNamesInFile.has(callee.name)) {
    return true;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    ITERATOR_PRODUCING_METHOD_NAMES.has(callee.property.name)
  ) {
    const receiver = callee.object;
    if (isNodeOfType(receiver, "Identifier") && receiver.name === "Object") return false;
    return true;
  }
  return false;
};

const isChainPassThroughCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return CHAINABLE_ITERATION_METHODS.has(callee.property.name);
};

const isReceiverChainIteratorRooted = (
  receiverNode: EsTreeNode | null | undefined,
  generatorNamesInFile: ReadonlySet<string>,
): boolean => {
  let cursor: EsTreeNode | null | undefined = receiverNode;
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    if (!isNodeOfType(cursor, "CallExpression")) return false;
    if (isIteratorProducingCall(cursor, generatorNamesInFile)) return true;
    if (!isChainPassThroughCall(cursor)) return false;
    const nextCallee = cursor.callee;
    if (!isNodeOfType(nextCallee, "MemberExpression")) return false;
    cursor = nextCallee.object;
  }
  return false;
};

const collectGeneratorNames = (programNode: EsTreeNode): Set<string> => {
  const generatorNames = new Set<string>();
  walkAst(programNode, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "FunctionDeclaration") &&
      child.generator === true &&
      isNodeOfType(child.id, "Identifier")
    ) {
      generatorNames.add(child.id.name);
      return;
    }
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      isNodeOfType(child.init, "FunctionExpression") &&
      child.init.generator === true
    ) {
      generatorNames.add(child.id.name);
    }
  });
  return generatorNames;
};

export const jsCombineIterations = defineRule<Rule>({
  id: "js-combine-iterations",
  severity: "warn",
  recommendation:
    "Combine `.map().filter()` (or similar chains) into a single pass with `.reduce()` or a `for...of` loop to avoid iterating the array twice",
  create: (context: RuleContext) => {
    let generatorNamesInFile: ReadonlySet<string> = new Set();

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        generatorNamesInFile = collectGeneratorNames(programNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          !isNodeOfType(node.callee.property, "Identifier")
        )
          return;

        const outerMethod = node.callee.property.name;
        if (!CHAINABLE_ITERATION_METHODS.has(outerMethod)) return;

        const innerCall = node.callee.object;
        if (
          !isNodeOfType(innerCall, "CallExpression") ||
          !isNodeOfType(innerCall.callee, "MemberExpression") ||
          !isNodeOfType(innerCall.callee.property, "Identifier")
        )
          return;

        const innerMethod = innerCall.callee.property.name;
        if (!CHAINABLE_ITERATION_METHODS.has(innerMethod)) return;

        if (innerMethod === "map" && outerMethod === "filter") {
          const filterArgument = node.arguments?.[0];
          const isBooleanOrIdentityFilter =
            (isNodeOfType(filterArgument, "Identifier") && filterArgument.name === "Boolean") ||
            (isNodeOfType(filterArgument, "ArrowFunctionExpression") &&
              filterArgument.params?.length === 1 &&
              isNodeOfType(filterArgument.body, "Identifier") &&
              isNodeOfType(filterArgument.params[0], "Identifier") &&
              filterArgument.body.name === filterArgument.params[0].name);
          if (isBooleanOrIdentityFilter) return;
        }

        if (isReceiverChainIteratorRooted(innerCall.callee.object, generatorNamesInFile)) return;

        context.report({
          node,
          message: `.${innerMethod}().${outerMethod}() iterates the array twice — combine into a single loop with .reduce() or for...of`,
        });
      },
    };
  },
});
