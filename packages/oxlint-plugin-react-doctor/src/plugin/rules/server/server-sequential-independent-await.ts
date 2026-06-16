import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

// HACK: in async route handlers and Server Components, two consecutive
// `await fetch()` (or any awaited calls) where the second one doesn't
// reference the first's binding is a textbook waterfall — the second
// fetch waits for the first to land before even starting, doubling
// latency. Wrap independent awaits in `Promise.all([…])` so they race.
//
// Heuristic: scan async function bodies for two consecutive
// VariableDeclaration statements whose init is `await something(...)`,
// where the second's initializer reads no identifier introduced by the
// first declaration. We require both declarations to be at the top
// level of the same block to keep precision high.
const collectDeclaredNames = (declaration: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  if (!isNodeOfType(declaration, "VariableDeclaration")) return names;
  for (const declarator of declaration.declarations ?? []) {
    collectPatternNames(declarator.id, names);
  }
  return names;
};

const declarationStartsWithAwait = (declaration: EsTreeNode): boolean => {
  if (!isNodeOfType(declaration, "VariableDeclaration")) return false;
  for (const declarator of declaration.declarations ?? []) {
    if (isNodeOfType(declarator.init, "AwaitExpression")) return true;
  }
  return false;
};

// HACK: walk only each initializer, not the whole declaration. A name in
// the next statement's binding pattern (e.g. `const { data: x } = await
// b()` after `const { data } = await a()`) is a re-bind evaluated after
// the await resolves, not a read of the first result — counting it would
// miss the waterfall.
const declarationReadsAnyName = (declaration: EsTreeNode, names: Set<string>): boolean => {
  if (names.size === 0) return false;
  if (!isNodeOfType(declaration, "VariableDeclaration")) return false;
  let didRead = false;
  for (const declarator of declaration.declarations ?? []) {
    if (!declarator.init) continue;
    walkAst(declarator.init, (child: EsTreeNode) => {
      if (didRead) return;
      if (isNodeOfType(child, "Identifier") && names.has(child.name)) didRead = true;
    });
  }
  return didRead;
};

export const serverSequentialIndependentAwait = defineRule({
  id: "server-sequential-independent-await",
  title: "Sequential independent awaits",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "These two awaits don't depend on each other. Wrap them in `Promise.all([...])` so they run at the same time.",
  create: (context: RuleContext) => {
    const inspectStatements = (statements: EsTreeNode[]): void => {
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const currentStatement = statements[statementIndex];
        if (!isNodeOfType(currentStatement, "VariableDeclaration")) continue;
        if (!declarationStartsWithAwait(currentStatement)) continue;
        const declaredNames = collectDeclaredNames(currentStatement);

        const nextStatement = statements[statementIndex + 1];
        if (!isNodeOfType(nextStatement, "VariableDeclaration")) continue;
        if (!declarationStartsWithAwait(nextStatement)) continue;

        if (declarationReadsAnyName(nextStatement, declaredNames)) continue;

        context.report({
          node: nextStatement,
          message:
            "This await doesn't use the previous result, so your users wait twice as long for nothing.",
        });
        // Skip past the next so we don't double-report a chain.
        statementIndex++;
      }
    };

    const visitFunctionBody = (node: EsTreeNode): void => {
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
      FunctionDeclaration: visitFunctionBody,
      FunctionExpression: visitFunctionBody,
      ArrowFunctionExpression: visitFunctionBody,
    };
  },
});
