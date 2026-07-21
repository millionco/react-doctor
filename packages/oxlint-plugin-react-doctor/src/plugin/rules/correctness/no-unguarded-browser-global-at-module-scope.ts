import * as path from "node:path";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isDomGuardIdentifierName } from "../../utils/is-dom-guard-identifier-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNonSourceFilename } from "../../utils/is-non-source-filename.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { readBrowserGlobalAvailability } from "../../utils/read-browser-global-availability.js";
import { resolveCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// `document` is deliberately excluded — legacy SPA mount entrypoints read
// `document.getElementById('root')` at module scope in files that are never
// server-rendered, and flagging those is the dominant false positive.
//
// Additional exemptions (corpus-audited, this rule scored 0 true positives
// on 121 repos so it is narrowed aggressively):
// - browser-only-by-convention files: Remix/React Router `.client.` module
//   filenames and Gatsby's `cache-dir/` client runtime are never evaluated
//   during SSR;
// - modules whose top level already throws/returns under a preceding
//   `typeof window === "undefined"` check.
const BROWSER_GLOBAL_NAMES = new Set([
  "window",
  "navigator",
  "localStorage",
  "sessionStorage",
  "matchMedia",
]);

// Guard recognition is broader than the report set: `typeof document` implies
// a browser environment just as strongly, even though `document` reads are
// not reported.
const GUARD_GLOBAL_NAMES = new Set([...BROWSER_GLOBAL_NAMES, "document"]);

// Scopes that run AFTER import time — a browser-global read inside any of
// them is deferred to browser-only execution and never crashes Node SSR.
const DEFERRED_EXECUTION_NODE_TYPES = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "MethodDefinition",
]);

// Remix/React Router `.client.` modules and Gatsby's `cache-dir/` client
// runtime are loaded exclusively in the browser bundle — never by the SSR
// entry — so module-scope browser-global reads there cannot crash Node.
// NOTE: duplicated in no-unguarded-browser-global-in-render-or-hook-init
// (shared utils are frozen for this pass).
const isBrowserOnlyModuleFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  const filename = rawFilename.replaceAll("\\", "/").toLowerCase();
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  if (/\.client\.[^.]+$/.test(basename)) return true;
  const rootedFilename = filename.startsWith("/") ? filename : `/${filename}`;
  return rootedFilename.includes("/gatsby/cache-dir/");
};

const isFlowTerminatingStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ThrowStatement") || isNodeOfType(statement, "ReturnStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    const lastStatement = statement.body[statement.body.length - 1];
    return Boolean(lastStatement && isFlowTerminatingStatement(lastStatement));
  }
  return false;
};

const isEvaluatedAtImportTime = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (DEFERRED_EXECUTION_NODE_TYPES.has(ancestor.type)) return false;
    if (
      (isNodeOfType(ancestor, "PropertyDefinition") ||
        isNodeOfType(ancestor, "AccessorProperty")) &&
      !ancestor.static
    ) {
      return false;
    }
    ancestor = ancestor.parent ?? null;
  }
  return true;
};

const isImportMetaEnvSsrRead = (node: EsTreeNodeOfType<"MemberExpression">): boolean => {
  if (node.computed) return false;
  if (!isNodeOfType(node.property, "Identifier") || node.property.name !== "SSR") return false;
  const envObject = stripParenExpression(node.object);
  if (!isNodeOfType(envObject, "MemberExpression") || envObject.computed) return false;
  if (!isNodeOfType(envObject.property, "Identifier") || envObject.property.name !== "env") {
    return false;
  }
  const metaObject = stripParenExpression(envObject.object);
  return isNodeOfType(metaObject, "MetaProperty") && metaObject.meta.name === "import";
};

const isProcessBrowserRead = (node: EsTreeNodeOfType<"MemberExpression">): boolean => {
  if (node.computed) return false;
  if (!isNodeOfType(node.property, "Identifier") || node.property.name !== "browser") return false;
  const processObject = stripParenExpression(node.object);
  return (
    isNodeOfType(processObject, "Identifier") &&
    processObject.name === "process" &&
    !findVariableInitializer(processObject, processObject.name)
  );
};

const getTypeofGuardGlobalName = (expression: EsTreeNode): string | null => {
  const strippedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(strippedExpression, "UnaryExpression") ||
    strippedExpression.operator !== "typeof"
  ) {
    return null;
  }
  const argument = stripParenExpression(strippedExpression.argument);
  return isNodeOfType(argument, "Identifier") &&
    GUARD_GLOBAL_NAMES.has(argument.name) &&
    !findVariableInitializer(argument, argument.name)
    ? argument.name
    : null;
};

const browserAvailabilityWhenExpressionIsTrue = (expression: EsTreeNode): boolean | null => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "UnaryExpression") && strippedExpression.operator === "!") {
    const innerAvailability = browserAvailabilityWhenExpressionIsTrue(strippedExpression.argument);
    return innerAvailability === null ? null : !innerAvailability;
  }
  if (isNodeOfType(strippedExpression, "MemberExpression")) {
    if (isImportMetaEnvSsrRead(strippedExpression)) return false;
    if (isProcessBrowserRead(strippedExpression)) return true;
  }
  if (!isNodeOfType(strippedExpression, "BinaryExpression")) return null;
  const leftGlobalName = getTypeofGuardGlobalName(strippedExpression.left);
  const rightGlobalName = getTypeofGuardGlobalName(strippedExpression.right);
  const leftString =
    isNodeOfType(strippedExpression.left, "Literal") &&
    typeof strippedExpression.left.value === "string"
      ? strippedExpression.left.value
      : null;
  const rightString =
    isNodeOfType(strippedExpression.right, "Literal") &&
    typeof strippedExpression.right.value === "string"
      ? strippedExpression.right.value
      : null;
  const globalName = leftGlobalName ?? rightGlobalName;
  const comparedType = leftGlobalName ? rightString : leftString;
  if (!globalName || !comparedType) return null;
  const isEquality = strippedExpression.operator === "===" || strippedExpression.operator === "==";
  const isInequality =
    strippedExpression.operator === "!==" || strippedExpression.operator === "!=";
  if (!isEquality && !isInequality) return null;
  const browserType = globalName === "matchMedia" ? "function" : "object";
  const browserResult = isEquality ? browserType === comparedType : browserType !== comparedType;
  const serverResult = isEquality ? comparedType === "undefined" : comparedType !== "undefined";
  return browserResult === serverResult ? null : browserResult;
};

// The literal environment checks this rule trusts on their own: a
// `typeof <browser global>` test, `import.meta.env.SSR`, or
// `process.browser`. Name-heuristic-free, so it is also safe on FOREIGN
// initializers reached through an import — a guard built from ANOTHER
// imported flag stays unproven (no cross-file recursion).
const subtreeProvesBrowserEnvironmentCheck = (subtree: EsTreeNode): boolean => {
  let found = false;
  walkAst(subtree, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "typeof") {
      const argument = stripParenExpression(child.argument);
      if (
        isNodeOfType(argument, "Identifier") &&
        GUARD_GLOBAL_NAMES.has(argument.name) &&
        !findVariableInitializer(argument, argument.name)
      ) {
        found = true;
        return false;
      }
    }
    if (
      isNodeOfType(child, "MemberExpression") &&
      (isImportMetaEnvSsrRead(child) || isProcessBrowserRead(child))
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// How an import-bound identifier in a guard position is classified after
// following the import into its source file:
// - "browser-when-true" / "browser-when-false": the export is (or
//   boolean-derives from) a literal environment check with known polarity —
//   a const initializer like
//   `export const canUseDOM = typeof window !== "undefined"` or a function
//   returning one — so it guards exactly like a same-file alias;
// - "resolved-not-guard": the export resolved to something that provably is
//   NOT an environment check (`export const canUseDOM = true`), so the
//   guard-name heuristic must not vouch for it;
// - "unresolved": the import could not be followed (specifier that doesn't
//   resolve, node_modules, no absolute filename, resolution budget spent) —
//   keep the current name-heuristic behavior.
type ImportedGuardResolution =
  | "browser-when-true"
  | "browser-when-false"
  | "resolved-not-guard"
  | "unresolved";

interface ClassifyImportedGuardIdentifier {
  (identifier: EsTreeNodeOfType<"Identifier">): ImportedGuardResolution | null;
}

// NOTE: belongs in constants/thresholds.ts; shared files are frozen for
// this pass. Caps cross-file guard resolutions per linted file.
const MAX_IMPORTED_GUARD_RESOLUTIONS = 3;

const classifyNoImportedGuards: ClassifyImportedGuardIdentifier = () => null;

// An imported guard FUNCTION (`export const canUseDOM = () => typeof window
// !== "undefined"`, exenv-style) counts when a returned expression contains
// a literal environment check.
const functionBrowserAvailabilityWhenTrue = (functionNode: EsTreeNode): boolean | null => {
  if (!isFunctionLike(functionNode)) return null;
  const body = functionNode.body;
  if (!isNodeOfType(body, "BlockStatement")) {
    return browserAvailabilityWhenExpressionIsTrue(body);
  }
  let availability: boolean | null = null;
  let hasReturn = false;
  let hasInvalidReturn = false;
  walkAst(body, (child) => {
    if (hasInvalidReturn) return false;
    if (child !== body && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returnAvailability = browserAvailabilityWhenExpressionIsTrue(child.argument);
    if (returnAvailability === null) {
      availability = null;
      hasInvalidReturn = true;
      return false;
    }
    if (hasReturn && availability !== returnAvailability) {
      availability = null;
      hasInvalidReturn = true;
      return false;
    }
    availability = returnAvailability;
    hasReturn = true;
  });
  return hasReturn && !hasInvalidReturn ? availability : null;
};

const subtreeHasBrowserEnvironmentGuard = (
  subtree: EsTreeNode,
  guardAliasNames: ReadonlySet<string>,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean => {
  if (subtreeProvesBrowserEnvironmentCheck(subtree)) return true;
  let found = false;
  walkAst(subtree, (child) => {
    if (found) return false;
    if (!isNodeOfType(child, "Identifier")) return;
    const importedResolution = classifyImportedGuardIdentifier(child);
    if (importedResolution === "browser-when-true" || importedResolution === "browser-when-false") {
      found = true;
      return false;
    }
    // A resolved import whose export provably is NOT an environment check
    // must not be vouched for by its name (`export const canUseDOM = true`);
    // an unresolved import keeps the name-heuristic fallback below.
    if (importedResolution === "resolved-not-guard") return;
    // Same-file aliases resolved from their initializer, plus guard-named
    // identifiers (`canUseDOM`, `IS_BROWSER`, …) that may be imported from a
    // shared browser-utils module — the initializer is out of reach there,
    // but the name is an unambiguous environment check.
    if (
      guardAliasNames.has(child.name) ||
      ((importedResolution === "unresolved" || !findVariableInitializer(child, child.name)) &&
        isDomGuardIdentifierName(child.name))
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const browserIsAvailableWhenPredicate = (
  expression: EsTreeNode,
  predicateResult: boolean,
  globalName: string,
  context: RuleContext,
  guardAliasNames: ReadonlySet<string>,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean | null => {
  const literalAvailability = readBrowserGlobalAvailability(
    expression,
    globalName,
    context,
    predicateResult,
  );
  if (literalAvailability !== null) return literalAvailability;
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "UnaryExpression") && strippedExpression.operator === "!") {
    return browserIsAvailableWhenPredicate(
      strippedExpression.argument,
      !predicateResult,
      globalName,
      context,
      guardAliasNames,
      classifyImportedGuardIdentifier,
    );
  }
  if (isNodeOfType(strippedExpression, "MemberExpression")) {
    if (isImportMetaEnvSsrRead(strippedExpression)) return !predicateResult;
    if (isProcessBrowserRead(strippedExpression)) return predicateResult;
  }
  const guardIdentifier = isNodeOfType(strippedExpression, "Identifier")
    ? strippedExpression
    : isNodeOfType(strippedExpression, "CallExpression") &&
        isNodeOfType(stripParenExpression(strippedExpression.callee), "Identifier")
      ? stripParenExpression(strippedExpression.callee)
      : null;
  if (!guardIdentifier || !isNodeOfType(guardIdentifier, "Identifier")) return null;
  const importedResolution = classifyImportedGuardIdentifier(guardIdentifier);
  if (importedResolution === "browser-when-true") return predicateResult;
  if (importedResolution === "browser-when-false") return !predicateResult;
  if (importedResolution === "resolved-not-guard") return null;
  if (
    importedResolution === null &&
    findVariableInitializer(guardIdentifier, guardIdentifier.name)
  ) {
    return null;
  }
  return guardAliasNames.has(guardIdentifier.name) || isDomGuardIdentifierName(guardIdentifier.name)
    ? predicateResult
    : null;
};

const collectBrowserOnlyGuardEndOffsets = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
  guardAliasNames: ReadonlySet<string>,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): Map<string, number[]> => {
  const guardEndOffsetsByGlobalName = new Map<string, number[]>();
  for (const statement of program.body ?? []) {
    if (
      !isNodeOfType(statement, "IfStatement") ||
      !isFlowTerminatingStatement(statement.consequent)
    ) {
      continue;
    }
    for (const globalName of BROWSER_GLOBAL_NAMES) {
      if (
        browserIsAvailableWhenPredicate(
          statement.test,
          false,
          globalName,
          context,
          guardAliasNames,
          classifyImportedGuardIdentifier,
        ) !== true
      ) {
        continue;
      }
      const guardEndOffsets = guardEndOffsetsByGlobalName.get(globalName) ?? [];
      guardEndOffsets.push(statement.range[1]);
      guardEndOffsetsByGlobalName.set(globalName, guardEndOffsets);
    }
  }
  return guardEndOffsetsByGlobalName;
};

const catchClauseCanThrow = (handler: EsTreeNodeOfType<"CatchClause">): boolean => {
  let canThrow = false;
  walkAst(handler.body, (child) => {
    if (canThrow) return false;
    if (child !== handler.body && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ThrowStatement")) {
      canThrow = true;
      return false;
    }
  });
  return canThrow;
};

// True when a browser-environment check dominates the read via an enclosing
// `if` / ternary / `&&` (a `typeof <global>` test, a module-scope alias like
// `canUseDOM`, or an `import.meta.env.SSR` / `process.browser` check), or
// when an enclosing try/catch swallows the ReferenceError. Conservative: any
// such guard suppresses the report (favouring a false negative over a false
// positive).
const isGuardedAgainstSsrCrash = (
  node: EsTreeNode,
  globalName: string,
  context: RuleContext,
  guardAliasNames: ReadonlySet<string>,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean => {
  let current: EsTreeNode = node;
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.handler &&
      !catchClauseCanThrow(ancestor.handler) &&
      ancestor.block === current
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ((ancestor.consequent === current &&
        browserIsAvailableWhenPredicate(
          ancestor.test,
          true,
          globalName,
          context,
          guardAliasNames,
          classifyImportedGuardIdentifier,
        )) ||
        (ancestor.alternate === current &&
          browserIsAvailableWhenPredicate(
            ancestor.test,
            false,
            globalName,
            context,
            guardAliasNames,
            classifyImportedGuardIdentifier,
          )))
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      ((ancestor.consequent === current &&
        browserIsAvailableWhenPredicate(
          ancestor.test,
          true,
          globalName,
          context,
          guardAliasNames,
          classifyImportedGuardIdentifier,
        )) ||
        (ancestor.alternate === current &&
          browserIsAvailableWhenPredicate(
            ancestor.test,
            false,
            globalName,
            context,
            guardAliasNames,
            classifyImportedGuardIdentifier,
          )))
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.right === current &&
      browserIsAvailableWhenPredicate(
        ancestor.left,
        ancestor.operator === "&&",
        globalName,
        context,
        guardAliasNames,
        classifyImportedGuardIdentifier,
      )
    ) {
      return true;
    }
    current = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const NO_GUARD_ALIASES: ReadonlySet<string> = new Set();

const collectGuardAliasNames = (program: EsTreeNodeOfType<"Program">): Set<string> => {
  const aliasNames = new Set<string>();
  const recordDeclaration = (declaration: EsTreeNode | null | undefined): void => {
    if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return;
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) continue;
      // Alias collection stays import-blind (`classifyNoImportedGuards`):
      // it runs over every module-scope initializer, so following imports
      // here would spend the per-file resolution budget before any actual
      // guard test needs it.
      if (
        subtreeHasBrowserEnvironmentGuard(
          declarator.init,
          NO_GUARD_ALIASES,
          classifyNoImportedGuards,
        )
      ) {
        aliasNames.add(declarator.id.name);
      }
    }
  };
  for (const statement of program.body ?? []) {
    if (isNodeOfType(statement, "ExportNamedDeclaration")) {
      recordDeclaration(statement.declaration);
      continue;
    }
    recordDeclaration(statement);
  }
  return aliasNames;
};

export const noUnguardedBrowserGlobalAtModuleScope = defineRule({
  id: "no-unguarded-browser-global-at-module-scope",
  title: "Browser global read at module scope",
  severity: "warn",
  requires: ["ssr"],
  recommendation:
    'Reading `window`/`navigator`/`localStorage` at module scope throws `ReferenceError: window is not defined` when the module is imported during SSR. Move the read inside a function/effect, or guard it with `typeof window !== "undefined"`.',
  create: (context: RuleContext): RuleVisitors => {
    if (/\.d\.[cm]?ts$/i.test(context.filename ?? "")) return {};
    if (isTestlikeFilename(context.filename)) return {};
    if (isNonSourceFilename(context.filename)) return {};
    if (isBrowserOnlyModuleFilename(context.filename)) return {};

    let guardAliasNames: ReadonlySet<string> = NO_GUARD_ALIASES;
    let browserOnlyGuardEndOffsetsByGlobalName = new Map<string, number[]>();

    const importedGuardResolutionByName = new Map<string, ImportedGuardResolution>();
    let importedGuardResolutionCount = 0;

    const classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier = (identifier) => {
      const importBinding = getImportBindingForName(identifier, identifier.name);
      if (!importBinding || importBinding.isNamespace || !importBinding.exportedName) return null;
      // Scope-aware confirmation: a local binding shadowing the import must
      // not inherit the import's verdict.
      const scopeBinding = findVariableInitializer(identifier, identifier.name);
      const scopeBindingParent = scopeBinding?.bindingIdentifier.parent;
      if (
        !scopeBindingParent ||
        (!isNodeOfType(scopeBindingParent, "ImportSpecifier") &&
          !isNodeOfType(scopeBindingParent, "ImportDefaultSpecifier"))
      ) {
        return null;
      }
      const cachedResolution = importedGuardResolutionByName.get(identifier.name);
      if (cachedResolution) return cachedResolution;
      const filename = context.filename;
      if (!filename || !path.isAbsolute(filename)) return "unresolved";
      if (importedGuardResolutionCount >= MAX_IMPORTED_GUARD_RESOLUTIONS) return "unresolved";
      importedGuardResolutionCount += 1;
      const resolvedExport = resolveCrossFileExport(
        filename,
        importBinding.source,
        importBinding.exportedName,
      );
      let resolution: ImportedGuardResolution = "unresolved";
      if (resolvedExport?.kind === "initializer") {
        const browserAvailability = browserAvailabilityWhenExpressionIsTrue(resolvedExport.node);
        resolution =
          browserAvailability === null
            ? "resolved-not-guard"
            : browserAvailability
              ? "browser-when-true"
              : "browser-when-false";
      } else if (resolvedExport?.kind === "function") {
        const browserAvailability = functionBrowserAvailabilityWhenTrue(resolvedExport.node);
        resolution =
          browserAvailability === null
            ? "resolved-not-guard"
            : browserAvailability
              ? "browser-when-true"
              : "browser-when-false";
      }
      importedGuardResolutionByName.set(identifier.name, resolution);
      return resolution;
    };

    const reportRead = (node: EsTreeNode, globalName: string): void => {
      if (
        browserOnlyGuardEndOffsetsByGlobalName
          .get(globalName)
          ?.some((guardEndOffset) => guardEndOffset <= node.range[0])
      ) {
        return;
      }
      if (!isEvaluatedAtImportTime(node)) return;
      if (
        isGuardedAgainstSsrCrash(
          node,
          globalName,
          context,
          guardAliasNames,
          classifyImportedGuardIdentifier,
        )
      )
        return;
      context.report({
        node,
        message: `Reading \`${globalName}\` here crashes with "ReferenceError: ${globalName} is not defined" the instant this module is imported during SSR — move the read inside a function or effect, or guard it with \`typeof ${globalName} !== "undefined"\`.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        guardAliasNames = collectGuardAliasNames(node);
        browserOnlyGuardEndOffsetsByGlobalName = collectBrowserOnlyGuardEndOffsets(
          node,
          context,
          guardAliasNames,
          classifyImportedGuardIdentifier,
        );
      },
      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        if (!BROWSER_GLOBAL_NAMES.has(node.name)) return;
        if (!context.scopes.isGlobalReference(node)) return;
        const expressionRoot = findTransparentExpressionRoot(node);
        if (
          expressionRoot.parent &&
          isNodeOfType(expressionRoot.parent, "UnaryExpression") &&
          expressionRoot.parent.operator === "typeof"
        ) {
          return;
        }
        reportRead(node, node.name);
      },
    };
  },
});
