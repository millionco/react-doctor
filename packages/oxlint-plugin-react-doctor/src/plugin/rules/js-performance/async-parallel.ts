import {
  BROWSER_TEST_FILE_PATTERN,
  INTENTIONAL_SEQUENCING_CALLEE_NAMES,
  ORDERED_UI_FLOW_CALLEE_NAMES,
  ORDERED_UI_FLOW_CALLEE_PREFIXES,
} from "../../constants/js.js";
import { SEQUENTIAL_AWAIT_THRESHOLD } from "../../constants/thresholds.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { getCalleeIdentifierTrail } from "../../utils/get-callee-identifier-trail.js";
import { getOrderIndependentLocalFunction } from "../../utils/get-order-independent-local-function.js";
import { hasPossibleStaticMemberCallWrite } from "../../utils/has-static-property-write-before.js";
import { isTestLibraryImportSource } from "../../utils/is-test-library-import-source.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
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

// A bare `await sideEffect();` executes for its effect, and its position
// in the sequence usually IS the point (save → refresh → open, protocol
// handshakes, cache invalidation after a write). A run containing one is
// ordered by intent, not by accident.
const isBareExpressionAwait = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "ExpressionStatement") &&
  isNodeOfType(statement.expression, "AwaitExpression");

const hasOrderIndependentBareAwaitArguments = (callExpression: EsTreeNode): boolean => {
  const unwrappedCallExpression = stripParenExpression(callExpression);
  if (!isNodeOfType(unwrappedCallExpression, "CallExpression")) return false;
  return unwrappedCallExpression.arguments.every((argument) => {
    if (isNodeOfType(argument, "SpreadElement")) return false;
    const unwrappedArgument = stripParenExpression(argument);
    return (
      isNodeOfType(unwrappedArgument, "Identifier") || isNodeOfType(unwrappedArgument, "Literal")
    );
  });
};

// Awaiting something that is not a call (`await feManifestPromise`)
// settles work that already started — sequencing it costs no wall time,
// so there is nothing to parallelize.
const isNonCallAwait = (statement: EsTreeNode): boolean => {
  const awaitedExpression = getAwaitedCall(statement);
  if (!awaitedExpression) return false;
  const stripped = stripParenExpression(awaitedExpression);
  return (
    !isNodeOfType(stripped, "CallExpression") &&
    !isNodeOfType(stripped, "NewExpression") &&
    !isNodeOfType(stripped, "ImportExpression")
  );
};

// Skip a consecutive-await block whenever any one of its awaits is an
// ordered-UI-flow call, an intentional sequencing call, a bare
// side-effect await, or an await of an already-started promise. A single
// `await page.click(...)` in the middle of three otherwise-independent
// awaits is enough to mark the whole sequence as deliberately
// serialized — collapsing it into `Promise.all([...])` would change
// observable behavior.
const sequenceContainsSerializationSignal = (
  statements: EsTreeNode[],
  context: RuleContext,
): boolean => {
  let bareAwaitFunction: EsTreeNode | null = null;
  for (const statement of statements) {
    if (isNonCallAwait(statement)) return true;
    const awaitedCall = getAwaitedCall(statement);
    if (awaitedCall && hasPossibleStaticMemberCallWrite(awaitedCall, context.scopes)) return true;
    const orderIndependentFunction = awaitedCall
      ? getOrderIndependentLocalFunction(awaitedCall, context.scopes)
      : null;
    if (isBareExpressionAwait(statement)) {
      if (orderIndependentFunction === null) return true;
      if (!awaitedCall || !hasOrderIndependentBareAwaitArguments(awaitedCall)) return true;
      if (bareAwaitFunction !== null && bareAwaitFunction !== orderIndependentFunction) return true;
      bareAwaitFunction = orderIndependentFunction;
    }
    if (isOrderedUiFlowAwait(awaitedCall)) return true;
    if (isIntentionalSequencingAwait(awaitedCall) && orderIndependentFunction === null) return true;
  }
  return false;
};

// Statements inside a `db.transaction(async (tx) => { ... })` callback
// run on one dedicated connection; issuing them concurrently is not just
// pointless but incorrect, so the whole block is exempt.
const isInsideTransactionCallback = (node: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      const callParent = current.parent;
      if (callParent && isNodeOfType(callParent, "CallExpression")) {
        const callee = callParent.callee;
        if (
          isNodeOfType(callee, "MemberExpression") &&
          isNodeOfType(callee.property, "Identifier") &&
          callee.property.name === "transaction"
        ) {
          return true;
        }
        if (isNodeOfType(callee, "Identifier") && callee.name === "transaction") return true;
      }
    }
    current = current.parent ?? null;
  }
  return false;
};

const reportIfIndependent = (statements: EsTreeNode[], context: RuleContext): void => {
  const declaredNames = new Set<string>();

  for (const statement of statements) {
    const awaitArgument = getAwaitedCall(statement);
    if (!awaitArgument) continue;

    let referencesEarlierResult = false;
    walkAst(awaitArgument, (child: EsTreeNode) => {
      if (isNodeOfType(child, "Identifier") && declaredNames.has(child.name)) {
        referencesEarlierResult = true;
      }
    });

    if (referencesEarlierResult) return;

    // Destructured results (`const { prepareConfig } = await import(…)`,
    // `const [row] = await db.insert(…)`) bind names a later await may
    // consume, so every pattern-bound name must join the dependency set —
    // not just plain identifier declarations.
    if (isNodeOfType(statement, "VariableDeclaration") && statement.declarations[0]?.id) {
      collectPatternNames(statement.declarations[0].id, declaredNames);
    }
  }

  context.report({
    node: statements[0],
    message: `These ${statements.length} sequential await statements run one after another even though they look independent, so the page waits longer than it needs to. Run them together with Promise.all() instead`,
  });
};

export const asyncParallel = defineRule({
  id: "async-parallel",
  title: "Independent awaits run sequentially",
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
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` so independent calls run at the same time",
  create: (context: RuleContext) => {
    const filename = normalizeFilename(context.filename ?? "");
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
        if (isInsideTransactionCallback(node)) return;
        const consecutiveAwaitStatements: EsTreeNode[] = [];

        const flushConsecutiveAwaits = (): void => {
          if (consecutiveAwaitStatements.length >= SEQUENTIAL_AWAIT_THRESHOLD) {
            if (!sequenceContainsSerializationSignal(consecutiveAwaitStatements, context)) {
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
