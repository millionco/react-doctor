import {
  BROWSER_TEST_FILE_PATTERN,
  INTENTIONAL_SEQUENCING_CALLEE_NAMES,
  ORDERED_UI_FLOW_CALLEE_NAMES,
  ORDERED_UI_FLOW_CALLEE_PREFIXES,
} from "../../constants/js.js";
import { SEQUENTIAL_AWAIT_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeIdentifierTrail } from "../../utils/get-callee-identifier-trail.js";
import { isTestLibraryImportSource } from "../../utils/is-test-library-import-source.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const getAwaitedCall = (statement: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(statement, "VariableDeclaration")) {
    const declarator = statement.declarations?.[0];
    if (declarator && isNodeOfType(declarator.init, "AwaitExpression")) {
      return declarator.init.argument ?? null;
    }
  }
  if (
    isNodeOfType(statement, "ExpressionStatement") &&
    isNodeOfType(statement.expression, "AwaitExpression")
  ) {
    return statement.expression.argument ?? null;
  }
  return null;
};

const isOrderedUiFlowName = (name: string): boolean => {
  if (ORDERED_UI_FLOW_CALLEE_NAMES.has(name)) return true;
  return ORDERED_UI_FLOW_CALLEE_PREFIXES.some((prefix) => name.startsWith(prefix));
};

// True when ANY identifier in the callee chain — leaf method, owning
// object, or bare callee — names an ordered UI-flow operation. So
// `await screen.findByRole(...)`, `await page.locator(...).click()`,
// and `await render(...)` all qualify.
const isOrderedUiFlowAwait = (awaitedCall: EsTreeNode | null): boolean => {
  if (!awaitedCall) return false;
  const trail = getCalleeIdentifierTrail(awaitedCall);
  return trail.some(isOrderedUiFlowName);
};

const isIntentionalSequencingAwait = (awaitedCall: EsTreeNode | null): boolean => {
  if (!awaitedCall) return false;
  const trail = getCalleeIdentifierTrail(awaitedCall);
  return trail.some((name) => INTENTIONAL_SEQUENCING_CALLEE_NAMES.has(name));
};

// Skip a consecutive-await block whenever any one of its awaits is an
// ordered-UI-flow call or an intentional sequencing call. A single
// `await page.click(...)` in the middle of three otherwise-independent
// awaits is enough to mark the whole sequence as deliberately
// serialized — collapsing it into `Promise.all([...])` would change
// observable behavior.
const sequenceContainsSerializationSignal = (statements: EsTreeNode[]): boolean => {
  for (const statement of statements) {
    const awaitedCall = getAwaitedCall(statement);
    if (isOrderedUiFlowAwait(awaitedCall)) return true;
    if (isIntentionalSequencingAwait(awaitedCall)) return true;
  }
  return false;
};

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
  id: "async-parallel",
  // `test-noise` opts every file `isTestFilePath(...)` recognises
  // (`*.test.*`, `*.spec.*`, `__tests__/`, `e2e/`, `playwright/`,
  // `cypress/`, fixtures, mocks, Windows-slashed equivalents, …) out
  // of this rule via `mergeAndFilterDiagnostics`. The in-rule guards
  // below handle the cases that path matching can't see: Vitest
  // browser fixtures (`*.browser.tsx`), production-co-located helpers
  // that import a test library, and ordered render→assert→click
  // flows. Allow intentional animation/demo pacing or a documented
  // inline `// react-doctor-disable-next-line` opt-out.
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to run independent operations concurrently",
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isBrowserTestFile = BROWSER_TEST_FILE_PATTERN.test(filename);
    let hasTestLibraryImport = false;

    const shouldSkipFile = (): boolean => isBrowserTestFile || hasTestLibraryImport;

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (hasTestLibraryImport) return;
        if (isTestLibraryImportSource(node.source?.value)) {
          hasTestLibraryImport = true;
        }
      },
      BlockStatement(node: EsTreeNodeOfType<"BlockStatement">) {
        if (shouldSkipFile()) return;
        const consecutiveAwaitStatements: EsTreeNode[] = [];

        const flushConsecutiveAwaits = (): void => {
          if (consecutiveAwaitStatements.length >= SEQUENTIAL_AWAIT_THRESHOLD) {
            if (!sequenceContainsSerializationSignal(consecutiveAwaitStatements)) {
              reportIfIndependent(consecutiveAwaitStatements, context);
            }
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
