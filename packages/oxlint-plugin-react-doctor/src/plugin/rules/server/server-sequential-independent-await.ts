import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isAuthGuardName } from "../../utils/is-auth-guard-name.js";
import { tokenizeIdentifierWords } from "../../utils/tokenize-identifier-words.js";
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

// Leading verbs that mark an await run for ordering / a side effect rather
// than to fetch data: a permission gate, a connection, a transaction begin, an
// acquired lock, an init step. Parallelizing such a call with `Promise.all`
// would change behavior (e.g. run the next call even when the gate throws), so
// the pair is NOT an independent-fetch waterfall.
const GATE_LEADING_VERBS = new Set([
  "require",
  "ensure",
  "assert",
  "verify",
  "validate",
  "check",
  "connect",
  "disconnect",
  "begin",
  "acquire",
  "lock",
  "init",
  "initialize",
  "setup",
  "authorize",
  "authenticate",
]);

// True when the declaration awaits an already-existing promise value
// rather than starting new work — a bare Identifier (`await postsPromise`)
// or a member read (`await props.params` in Next.js 15). The promise was
// created before this statement ran, so the await is not the second leg
// of a waterfall.
const declarationAwaitsExistingPromise = (declaration: EsTreeNode): boolean => {
  if (!isNodeOfType(declaration, "VariableDeclaration")) return false;
  for (const declarator of declaration.declarations ?? []) {
    const init = declarator.init;
    if (!isNodeOfType(init, "AwaitExpression")) continue;
    const argument = init.argument;
    if (isNodeOfType(argument, "Identifier") || isNodeOfType(argument, "MemberExpression")) {
      return true;
    }
  }
  return false;
};

// Next.js request-scoped async APIs (`headers()`, `cookies()`,
// `draftMode()`, `connection()`) and next-intl's server helpers
// (`getTranslations()`, `getMessages()`, …) resolve from the ambient
// request context, not the network — wrapping them in `Promise.all`
// saves nothing.
const REQUEST_SCOPED_IMPORT_SOURCES = ["next/headers", "next-intl/server"];

const isRequestScopedCallee = (callee: EsTreeNode): boolean => {
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (
    REQUEST_SCOPED_IMPORT_SOURCES.some(
      (moduleSource) => getImportedNameFromModule(callee, callee.name, moduleSource) !== null,
    )
  ) {
    return true;
  }
  return getImportedNameFromModule(callee, callee.name, "next/server") === "connection";
};

const declarationAwaitsRequestScopedCall = (declaration: EsTreeNode): boolean => {
  if (!isNodeOfType(declaration, "VariableDeclaration")) return false;
  for (const declarator of declaration.declarations ?? []) {
    const init = declarator.init;
    if (!isNodeOfType(init, "AwaitExpression")) continue;
    const argument = init.argument;
    if (isNodeOfType(argument, "CallExpression") && isRequestScopedCallee(argument.callee)) {
      return true;
    }
  }
  return false;
};

// True when the first declaration awaits a guard / side-effect gate, so its
// ordering before the next await is intentional (`await requireSession()`,
// `await db.connect()`, `await beginTransaction()`).
const declarationAwaitsGate = (declaration: EsTreeNode): boolean => {
  if (!isNodeOfType(declaration, "VariableDeclaration")) return false;
  for (const declarator of declaration.declarations ?? []) {
    if (!isNodeOfType(declarator.init, "AwaitExpression")) continue;
    // Only a function call is a gate — an awaited constructor (`await new X()`)
    // must not suppress, so keep this CallExpression-only (getCalleeName also
    // resolves NewExpression, which would over-suppress here).
    const argument = declarator.init.argument;
    if (!isNodeOfType(argument, "CallExpression")) continue;
    const calleeName = getCalleeName(argument);
    if (!calleeName) continue;
    if (isAuthGuardName(calleeName)) return true;
    const [leadingToken] = tokenizeIdentifierWords(calleeName);
    if (leadingToken && GATE_LEADING_VERBS.has(leadingToken)) return true;
  }
  return false;
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
        // The second await is on a promise that already exists
        // (`const p = fetchPosts(); … const posts = await p;`,
        // `await props.params`) — already running, so there's no
        // waterfall to flatten.
        if (declarationAwaitsExistingPromise(nextStatement)) continue;
        // A request-scoped API (`await headers()`, `await getTranslations()`)
        // resolves from the ambient request context, not the network, so
        // pairing it with a real fetch is not a waterfall.
        if (
          declarationAwaitsRequestScopedCall(currentStatement) ||
          declarationAwaitsRequestScopedCall(nextStatement)
        )
          continue;
        // A guard / side-effect gate (`await requireSession()`, `db.connect()`)
        // must run before the next await — its ordering is intentional, not a
        // parallelizable waterfall.
        if (declarationAwaitsGate(currentStatement)) continue;

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
