import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const collectIdentifierNames = (node: EsTreeNode | null | undefined, into: Set<string>): void => {
  if (!node) return;
  walkAst(node, (child: EsTreeNode) => {
    if (isNodeOfType(child, "Identifier")) into.add(child.name);
  });
};

const isEarlyReturnIfStatement = (statement: EsTreeNode): boolean => {
  if (!isNodeOfType(statement, "IfStatement")) return false;
  const consequent = statement.consequent;
  if (!consequent) return false;
  if (isNodeOfType(consequent, "ReturnStatement")) return true;
  if (!isNodeOfType(consequent, "BlockStatement")) return false;
  for (const inner of consequent.body ?? []) {
    if (isNodeOfType(inner, "ReturnStatement")) return true;
  }
  return false;
};

// HACK: `const x = await something(); if (skip) return defaultValue;` —
// the early-return doesn't depend on the awaited value, so the await
// blocked the function for nothing on the skip path. Move the await
// after the cheap synchronous guard so we only pay the latency when we
// actually need the data.
//
// Heuristic: an awaited VariableDeclaration immediately followed by an
// IfStatement whose test references no identifiers from the awaited
// declaration. We require the if to be the very next statement to
// stay precise (intervening statements would imply the awaited binding
// is being prepared for use).
export const asyncDeferAwait = defineRule<Rule>({
  id: "async-defer-await",
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Move the `await` after the synchronous early-return guard so the skip path stays fast",
  examples: [
    {
      before: "const data = await fetchData();\nif (!enabled) return;\nuse(data);",
      after: "if (!enabled) return;\nconst data = await fetchData();\nuse(data);",
    },
  ],
  create: (context: RuleContext) => {
    const inspectStatements = (statements: EsTreeNode[]): void => {
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const currentStatement = statements[statementIndex];
        if (!isNodeOfType(currentStatement, "VariableDeclaration")) continue;

        const awaitedBindingNames = new Set<string>();
        let didAwait = false;
        for (const declarator of currentStatement.declarations ?? []) {
          if (isNodeOfType(declarator.init, "AwaitExpression")) {
            didAwait = true;
            if (isNodeOfType(declarator.id, "Identifier")) {
              awaitedBindingNames.add(declarator.id.name);
            } else if (isNodeOfType(declarator.id, "ObjectPattern")) {
              for (const property of declarator.id.properties ?? []) {
                if (
                  isNodeOfType(property, "Property") &&
                  isNodeOfType(property.value, "Identifier")
                ) {
                  awaitedBindingNames.add(property.value.name);
                }
              }
            }
          }
        }
        if (!didAwait) continue;

        const nextStatement = statements[statementIndex + 1];
        if (!isEarlyReturnIfStatement(nextStatement)) continue;
        if (!isNodeOfType(nextStatement, "IfStatement")) continue;

        const testIdentifiers = new Set<string>();
        collectIdentifierNames(nextStatement.test, testIdentifiers);
        const usesAwaitedBinding = [...awaitedBindingNames].some((name) =>
          testIdentifiers.has(name),
        );
        if (usesAwaitedBinding) continue;

        const consequentIdentifiers = new Set<string>();
        collectIdentifierNames(nextStatement.consequent, consequentIdentifiers);
        const consequentUsesAwaited = [...awaitedBindingNames].some((name) =>
          consequentIdentifiers.has(name),
        );
        if (consequentUsesAwaited) continue;

        context.report({
          node: currentStatement,
          message:
            "await blocks the function before an early-return that doesn't use the awaited value — move the await after the synchronous guard so the skip path stays fast",
        });
      }
    };

    const enterFunction = (node: EsTreeNode): void => {
      if (
        !isNodeOfType(node, "FunctionDeclaration") &&
        !isNodeOfType(node, "FunctionExpression") &&
        !isNodeOfType(node, "ArrowFunctionExpression")
      ) {
        return;
      }
      if (!node.async) return;
      if (!isNodeOfType(node.body, "BlockStatement")) return;
      inspectStatements(node.body.body ?? []);
    };

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
    };
  },
});
