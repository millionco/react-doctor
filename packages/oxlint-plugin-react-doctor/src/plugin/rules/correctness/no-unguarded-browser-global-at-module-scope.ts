import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// `document` is deliberately excluded — legacy SPA mount entrypoints read
// `document.getElementById('root')` at module scope in files that are never
// server-rendered, and flagging those is the dominant false positive.
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

const subtreeHasBrowserEnvironmentGuard = (
  subtree: EsTreeNode,
  guardAliasNames: ReadonlySet<string>,
): boolean => {
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
    if (isNodeOfType(child, "Identifier") && guardAliasNames.has(child.name)) {
      found = true;
      return false;
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

// True when a browser-environment check dominates the read via an enclosing
// `if` / ternary / `&&` (a `typeof <global>` test, a module-scope alias like
// `canUseDOM`, or an `import.meta.env.SSR` / `process.browser` check), or
// when an enclosing try/catch swallows the ReferenceError. Conservative: any
// such guard suppresses the report (favouring a false negative over a false
// positive).
const isGuardedAgainstSsrCrash = (
  node: EsTreeNode,
  guardAliasNames: ReadonlySet<string>,
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
      subtreeHasBrowserEnvironmentGuard(ancestor.test, guardAliasNames)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      subtreeHasBrowserEnvironmentGuard(ancestor.test, guardAliasNames)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      subtreeHasBrowserEnvironmentGuard(ancestor.left, guardAliasNames)
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
      if (subtreeHasBrowserEnvironmentGuard(declarator.init, NO_GUARD_ALIASES)) {
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

const collectModuleScopeBindingNames = (program: EsTreeNodeOfType<"Program">): Set<string> => {
  const names = new Set<string>();
  const record = (declaration: EsTreeNode | null | undefined): void => {
    if (!declaration) return;
    if (isNodeOfType(declaration, "VariableDeclaration")) {
      for (const declarator of declaration.declarations ?? []) {
        collectPatternNames(declarator.id, names);
      }
      return;
    }
    if (
      (isNodeOfType(declaration, "FunctionDeclaration") ||
        isNodeOfType(declaration, "ClassDeclaration")) &&
      declaration.id
    ) {
      names.add(declaration.id.name);
    }
  };

  for (const statement of program.body ?? []) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      for (const specifier of statement.specifiers ?? []) {
        names.add(specifier.local.name);
      }
      continue;
    }
    if (
      isNodeOfType(statement, "ExportNamedDeclaration") ||
      isNodeOfType(statement, "ExportDefaultDeclaration")
    ) {
      record(statement.declaration);
      continue;
    }
    record(statement);
  }
  return names;
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

    let activeGlobalNames = BROWSER_GLOBAL_NAMES;
    let guardAliasNames: ReadonlySet<string> = NO_GUARD_ALIASES;

    const reportRead = (node: EsTreeNode, globalName: string): void => {
      if (!isEvaluatedAtImportTime(node)) return;
      if (isGuardedAgainstSsrCrash(node, guardAliasNames)) return;
      context.report({
        node,
        message: `Reading \`${globalName}\` here crashes with "ReferenceError: ${globalName} is not defined" the instant this module is imported during SSR — move the read inside a function or effect, or guard it with \`typeof ${globalName} !== "undefined"\`.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        const shadowed = collectModuleScopeBindingNames(node);
        if ([...BROWSER_GLOBAL_NAMES].some((name) => shadowed.has(name))) {
          activeGlobalNames = new Set(
            [...BROWSER_GLOBAL_NAMES].filter((name) => !shadowed.has(name)),
          );
        }
        guardAliasNames = collectGuardAliasNames(node);
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        const object = stripParenExpression(node.object);
        if (!isNodeOfType(object, "Identifier") || !activeGlobalNames.has(object.name)) return;
        reportRead(object, object.name);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "Identifier") || !activeGlobalNames.has(callee.name)) return;
        reportRead(callee, callee.name);
      },
    };
  },
});
