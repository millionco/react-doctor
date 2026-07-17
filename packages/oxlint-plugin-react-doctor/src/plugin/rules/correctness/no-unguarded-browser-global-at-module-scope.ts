import * as path from "node:path";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isDomGuardIdentifierName } from "../../utils/is-dom-guard-identifier-name.js";
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
// - modules whose top level already throws/returns under a
//   `typeof window === "undefined"` check — that IS the guard the rule
//   asks for, so every read in the module is deliberate browser-only code;
// - `window.<prop> = ...` assignment targets — the "expose a global on
//   window" idiom lives in browser bootstrap entries, not SSR-shared code.
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
  "PropertyDefinition",
  "AccessorProperty",
  "StaticBlock",
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
  if (basename.includes(".client.")) return true;
  const rootedFilename = filename.startsWith("/") ? filename : `/${filename}`;
  return rootedFilename.includes("/cache-dir/");
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

// `window.___emitter = emitter` — the flagged global is the root of an
// assignment-target member chain, the "install a global" bootstrap idiom.
const isAssignmentTargetRead = (globalIdentifier: EsTreeNode): boolean => {
  let current: EsTreeNode = globalIdentifier;
  let ancestor = current.parent;
  while (ancestor && isNodeOfType(ancestor, "MemberExpression") && ancestor.object === current) {
    current = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return Boolean(
    ancestor && isNodeOfType(ancestor, "AssignmentExpression") && ancestor.left === current,
  );
};

const isEvaluatedAtImportTime = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (DEFERRED_EXECUTION_NODE_TYPES.has(ancestor.type)) return false;
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
  return isNodeOfType(processObject, "Identifier") && processObject.name === "process";
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
      if (isNodeOfType(argument, "Identifier") && GUARD_GLOBAL_NAMES.has(argument.name)) {
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
// - "browser-guard": the export is (or boolean-derives from) a literal
//   environment check — a const initializer like
//   `export const canUseDOM = typeof window !== "undefined"` or a function
//   returning one — so it guards exactly like a same-file alias;
// - "resolved-not-guard": the export resolved to something that provably is
//   NOT an environment check (`export const canUseDOM = true`), so the
//   guard-name heuristic must not vouch for it;
// - "unresolved": the import could not be followed (specifier that doesn't
//   resolve, node_modules, no absolute filename, resolution budget spent) —
//   keep the current name-heuristic behavior.
type ImportedGuardResolution = "browser-guard" | "resolved-not-guard" | "unresolved";

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
const functionBodyReturnsBrowserEnvironmentCheck = (functionNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return false;
  }
  const body = functionNode.body;
  if (!body) return false;
  if (!isNodeOfType(body, "BlockStatement")) return subtreeProvesBrowserEnvironmentCheck(body);
  let returnsCheck = false;
  walkAst(body, (child) => {
    if (returnsCheck) return false;
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      subtreeProvesBrowserEnvironmentCheck(child.argument)
    ) {
      returnsCheck = true;
      return false;
    }
  });
  return returnsCheck;
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
    if (importedResolution === "browser-guard") {
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
    if (guardAliasNames.has(child.name) || isDomGuardIdentifierName(child.name)) {
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
): boolean => {
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
  if (!guardIdentifier || !isNodeOfType(guardIdentifier, "Identifier")) return false;
  const importedResolution = classifyImportedGuardIdentifier(guardIdentifier);
  if (importedResolution === "resolved-not-guard") return false;
  return (
    predicateResult &&
    (importedResolution === "browser-guard" ||
      guardAliasNames.has(guardIdentifier.name) ||
      isDomGuardIdentifierName(guardIdentifier.name))
  );
};

const moduleDeclaresBrowserOnly = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
  guardAliasNames: ReadonlySet<string>,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean =>
  (program.body ?? []).some(
    (statement) =>
      isNodeOfType(statement, "IfStatement") &&
      isFlowTerminatingStatement(statement.consequent) &&
      browserIsAvailableWhenPredicate(
        statement.test,
        true,
        "window",
        context,
        guardAliasNames,
        classifyImportedGuardIdentifier,
      ) === false,
  );

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
      Boolean(ancestor.handler) &&
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
    if (isTestlikeFilename(context.filename)) return {};
    if (isBrowserOnlyModuleFilename(context.filename)) return {};

    let guardAliasNames: ReadonlySet<string> = NO_GUARD_ALIASES;
    let moduleIsDeclaredBrowserOnly = false;

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
        resolution = subtreeProvesBrowserEnvironmentCheck(resolvedExport.node)
          ? "browser-guard"
          : "resolved-not-guard";
      } else if (resolvedExport?.kind === "function") {
        resolution = functionBodyReturnsBrowserEnvironmentCheck(resolvedExport.node)
          ? "browser-guard"
          : "resolved-not-guard";
      }
      importedGuardResolutionByName.set(identifier.name, resolution);
      return resolution;
    };

    const reportRead = (node: EsTreeNode, globalName: string): void => {
      if (moduleIsDeclaredBrowserOnly) return;
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
        moduleIsDeclaredBrowserOnly = moduleDeclaresBrowserOnly(
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
        if (isAssignmentTargetRead(node)) return;
        reportRead(node, node.name);
      },
    };
  },
});
