import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
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
    if (isNodeOfType(declarator.id, "Identifier")) {
      names.add(declarator.id.name);
    } else if (isNodeOfType(declarator.id, "ObjectPattern")) {
      for (const property of declarator.id.properties ?? []) {
        if (isNodeOfType(property, "Property") && isNodeOfType(property.value, "Identifier")) {
          names.add(property.value.name);
        } else if (
          isNodeOfType(property, "RestElement") &&
          isNodeOfType(property.argument, "Identifier")
        ) {
          names.add(property.argument.name);
        }
      }
    } else if (isNodeOfType(declarator.id, "ArrayPattern")) {
      for (const element of declarator.id.elements ?? []) {
        if (isNodeOfType(element, "Identifier")) names.add(element.name);
      }
    }
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

const declarationReadsAnyName = (declaration: EsTreeNode, names: Set<string>): boolean => {
  if (names.size === 0) return false;
  let didRead = false;
  walkAst(declaration, (child: EsTreeNode) => {
    if (didRead) return;
    if (isNodeOfType(child, "Identifier") && names.has(child.name)) didRead = true;
  });
  return didRead;
};

export const serverSequentialIndependentAwait = defineRule<Rule>({
  id: "server-sequential-independent-await",
  framework: "global",
  severity: "warn",
  category: "Server",
  recommendation:
    "Wrap independent awaits in `Promise.all([...])` so they race instead of waterfalling — second call doesn't depend on the first",
  examples: [
    {
      before:
        "export default async function Page() {\n  const user = await getUser();\n  const posts = await getPosts();\n  return <Layout user={user} posts={posts} />;\n}",
      after:
        "export default async function Page() {\n  const [user, posts] = await Promise.all([getUser(), getPosts()]);\n  return <Layout user={user} posts={posts} />;\n}",
    },
  ],
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
            "Sequential `await` without a data dependency on the previous result — wrap the independent calls in `Promise.all([...])` so they race instead of waterfalling",
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
