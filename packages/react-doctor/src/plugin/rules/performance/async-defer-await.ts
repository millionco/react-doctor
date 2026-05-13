import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const collectIdentifierNames = (node: EsTreeNode | null | undefined, into: Set<string>): void => {
  if (!node) return;
  walkAst(node, (child: EsTreeNode) => {
    if (child.type === "Identifier") into.add(child.name);
  });
};

const isEarlyReturnIfStatement = (statement: EsTreeNode): boolean => {
  if (statement.type !== "IfStatement") return false;
  const consequent = statement.consequent;
  if (!consequent) return false;
  if (consequent.type === "ReturnStatement") return true;
  if (consequent.type !== "BlockStatement") return false;
  for (const inner of consequent.body ?? []) {
    if (inner.type === "ReturnStatement") return true;
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
  recommendation:
    "Move the `await` after the synchronous early-return guard so the skip path stays fast",
  create: (context: RuleContext) => {
    const inspectStatements = (statements: EsTreeNode[]): void => {
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const currentStatement = statements[statementIndex];
        if (currentStatement.type !== "VariableDeclaration") continue;

        const awaitedBindingNames = new Set<string>();
        let didAwait = false;
        for (const declarator of currentStatement.declarations ?? []) {
          if (declarator.init?.type === "AwaitExpression") {
            didAwait = true;
            if (declarator.id?.type === "Identifier") {
              awaitedBindingNames.add(declarator.id.name);
            } else if (declarator.id?.type === "ObjectPattern") {
              for (const property of declarator.id.properties ?? []) {
                if (property.type === "Property" && property.value?.type === "Identifier") {
                  awaitedBindingNames.add(property.value.name);
                }
              }
            }
          }
        }
        if (!didAwait) continue;

        const nextStatement = statements[statementIndex + 1];
        if (!isEarlyReturnIfStatement(nextStatement)) continue;

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
      if (!node.async) return;
      if (node.body?.type !== "BlockStatement") return;
      inspectStatements(node.body.body ?? []);
    };

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
    };
  },
});
