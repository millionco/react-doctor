import { SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER } from "../../constants/tanstack.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getRouteOptionsObject } from "./utils/get-route-options-object.js";
import { getPropertyKeyName } from "./utils/get-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface AwaitedStatementInfo {
  awaitedExpressions: EsTreeNode[];
  boundNames: string[];
}

// The awaited expression(s) of a top-level statement plus the names the
// statement binds. Returns null when the statement has no top-level `await`.
const getAwaitedStatementInfo = (statement: EsTreeNode): AwaitedStatementInfo | null => {
  const awaitedExpressions: EsTreeNode[] = [];
  const boundNames = new Set<string>();

  if (isNodeOfType(statement, "VariableDeclaration")) {
    for (const declarator of statement.declarations ?? []) {
      if (!isNodeOfType(declarator.init, "AwaitExpression")) continue;
      if (declarator.init.argument) awaitedExpressions.push(declarator.init.argument);
      collectPatternNames(declarator.id, boundNames);
    }
  } else if (isNodeOfType(statement, "ExpressionStatement")) {
    const expression = statement.expression;
    if (isNodeOfType(expression, "AwaitExpression")) {
      if (expression.argument) awaitedExpressions.push(expression.argument);
    } else if (
      isNodeOfType(expression, "AssignmentExpression") &&
      isNodeOfType(expression.right, "AwaitExpression")
    ) {
      if (expression.right.argument) awaitedExpressions.push(expression.right.argument);
      if (isNodeOfType(expression.left, "Identifier")) boundNames.add(expression.left.name);
    }
  } else if (isNodeOfType(statement, "ReturnStatement")) {
    if (isNodeOfType(statement.argument, "AwaitExpression") && statement.argument.argument) {
      awaitedExpressions.push(statement.argument.argument);
    }
  } else if (isNodeOfType(statement, "ForOfStatement") && statement.await) {
    if (statement.right) awaitedExpressions.push(statement.right);
    const loopBinding = isNodeOfType(statement.left, "VariableDeclaration")
      ? (statement.left.declarations?.[0]?.id ?? null)
      : statement.left;
    collectPatternNames(loopBinding, boundNames);
  }

  if (awaitedExpressions.length === 0) return null;
  return { awaitedExpressions, boundNames: [...boundNames] };
};

// Names a non-await statement binds (its `const`/`let`/`var` declarators).
// Used to launder taint: `const id = user.id` binds `id`, which inherits the
// taint of the awaited `user` so a later `await getPosts(id)` is still seen as
// dependent.
const collectStatementBoundNames = (statement: EsTreeNode, into: Set<string>): void => {
  if (!isNodeOfType(statement, "VariableDeclaration")) return;
  for (const declarator of statement.declarations ?? []) {
    collectPatternNames(declarator.id, into);
  }
};

export const tanstackStartLoaderParallelFetch = defineRule({
  id: "tanstack-start-loader-parallel-fetch",
  title: "Sequential awaits in loader",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to avoid request waterfalls in route loaders",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const optionsObject = getRouteOptionsObject(node);
      if (!optionsObject) return;

      const properties = optionsObject.properties ?? [];
      for (const property of properties) {
        const keyName = getPropertyKeyName(property);
        if (keyName !== "loader") continue;
        if (!isNodeOfType(property, "Property")) continue;

        const loaderValue = property.value;
        if (
          !loaderValue ||
          (!isNodeOfType(loaderValue, "ArrowFunctionExpression") &&
            !isNodeOfType(loaderValue, "FunctionExpression"))
        )
          continue;

        const functionBody = loaderValue.body;
        if (!functionBody || !isNodeOfType(functionBody, "BlockStatement")) continue;

        // Only count awaits that are mutually INDEPENDENT — a dependent chain
        // (`const posts = await getPosts(user.id)` consuming an earlier
        // `await getUser()`) genuinely cannot be parallelized with
        // `Promise.all`, so flagging it would suggest a broken fix.
        let independentAwaitCount = 0;
        const boundByEarlierAwaits = new Set<string>();
        for (const statement of functionBody.body ?? []) {
          const awaitedInfo = getAwaitedStatementInfo(statement);
          if (!awaitedInfo) {
            // Non-await statement: launder taint through intermediate
            // bindings. `const id = user.id` makes `id` depend on the
            // earlier `await getUser()`, so a later `await getPosts(id)`
            // is correctly treated as dependent (not parallelizable).
            const boundNames = new Set<string>();
            collectStatementBoundNames(statement, boundNames);
            if (boundNames.size === 0) continue;
            const referencedNames = new Set<string>();
            collectReferenceIdentifierNames(statement, referencedNames);
            if ([...referencedNames].some((name) => boundByEarlierAwaits.has(name))) {
              for (const name of boundNames) boundByEarlierAwaits.add(name);
            }
            continue;
          }

          const referencedNames = new Set<string>();
          for (const awaitedExpression of awaitedInfo.awaitedExpressions) {
            collectReferenceIdentifierNames(awaitedExpression, referencedNames);
          }
          const dependsOnEarlierAwait = [...referencedNames].some((name) =>
            boundByEarlierAwaits.has(name),
          );

          if (!dependsOnEarlierAwait) {
            independentAwaitCount++;
            if (independentAwaitCount >= SEQUENTIAL_AWAIT_THRESHOLD_FOR_LOADER) {
              context.report({
                node: property,
                message:
                  "Sequential awaits in this loader create a request waterfall that slows the route.",
              });
              break;
            }
          }

          for (const name of awaitedInfo.boundNames) boundByEarlierAwaits.add(name);
        }
      }
    },
  }),
});
