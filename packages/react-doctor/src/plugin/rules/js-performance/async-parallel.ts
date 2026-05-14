import { SEQUENTIAL_AWAIT_THRESHOLD, TEST_FILE_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const reportIfIndependent = (statements: EsTreeNode[], context: RuleContext): void => {
  const declaredNames = new Set<string>();

  for (const statement of statements) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    const declarator = statement.declarations[0];
    if (!isNodeOfType(declarator.init, "AwaitExpression")) continue;
    const awaitArgument = declarator.init.argument;

    let referencesEarlierResult = false;
    walkAst(awaitArgument, (child: EsTreeNode) => {
      if (isNodeOfType(child, "Identifier") && declaredNames.has(child.name)) {
        referencesEarlierResult = true;
      }
    });

    if (referencesEarlierResult) return;

    if (isNodeOfType(declarator.id, "Identifier")) {
      declaredNames.add(declarator.id.name);
    }
  }

  context.report({
    node: statements[0],
    message: `${statements.length} sequential await statements that appear independent — use Promise.all() for parallel execution`,
  });
};

export const asyncParallel = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Performance",
  recommendation:
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to run independent operations concurrently",
  examples: [
    {
      before: "const user = await fetchUser();\nconst posts = await fetchPosts();",
      after: "const [user, posts] = await Promise.all([fetchUser(), fetchPosts()]);",
    },
  ],
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isTestFile = TEST_FILE_PATTERN.test(filename);

    return {
      BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
        if (isTestFile) return;
        const consecutiveAwaitStatements: EsTreeNode[] = [];

        const flushConsecutiveAwaits = (): void => {
          if (consecutiveAwaitStatements.length >= SEQUENTIAL_AWAIT_THRESHOLD) {
            reportIfIndependent(consecutiveAwaitStatements, context);
          }
          consecutiveAwaitStatements.length = 0;
        };

        for (const statement of node.body ?? []) {
          const isAwaitStatement =
            (isNodeOfType(statement, "VariableDeclaration") &&
              statement.declarations?.length === 1 &&
              isNodeOfType(statement.declarations[0].init, "AwaitExpression")) ||
            (isNodeOfType(statement, "ExpressionStatement") &&
              isNodeOfType(statement.expression, "AwaitExpression"));

          if (isAwaitStatement) {
            consecutiveAwaitStatements.push(statement);
          } else {
            flushConsecutiveAwaits();
          }
        }
        flushConsecutiveAwaits();
      },
    };
  },
});
