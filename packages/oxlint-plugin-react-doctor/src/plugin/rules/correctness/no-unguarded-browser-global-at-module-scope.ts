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

const subtreeHasTypeofBrowserGlobal = (subtree: EsTreeNode): boolean => {
  let found = false;
  walkAst(subtree, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "typeof") {
      const argument = stripParenExpression(child.argument);
      if (
        isNodeOfType(argument, "Identifier") &&
        BROWSER_GLOBAL_NAMES.has(argument.name)
      ) {
        found = true;
        return false;
      }
    }
  });
  return found;
};

// True when a `typeof <global> !== "undefined"` check dominates the read via
// an enclosing `if` / ternary / `&&`. Conservative: any such guard in an
// ancestor's condition suppresses the report (favouring a false negative over
// a false positive).
const isTypeofGuarded = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      subtreeHasTypeofBrowserGlobal(ancestor.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      subtreeHasTypeofBrowserGlobal(ancestor.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      subtreeHasTypeofBrowserGlobal(ancestor.left)
    ) {
      return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const collectModuleScopeBindingNames = (
  program: EsTreeNodeOfType<"Program">
): Set<string> => {
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

    const reportRead = (node: EsTreeNode, globalName: string): void => {
      if (!isEvaluatedAtImportTime(node)) return;
      if (isTypeofGuarded(node)) return;
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
            [...BROWSER_GLOBAL_NAMES].filter((name) => !shadowed.has(name))
          );
        }
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        const object = stripParenExpression(node.object);
        if (
          !isNodeOfType(object, "Identifier") ||
          !activeGlobalNames.has(object.name)
        )
          return;
        reportRead(object, object.name);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (
          !isNodeOfType(callee, "Identifier") ||
          !activeGlobalNames.has(callee.name)
        )
          return;
        reportRead(callee, callee.name);
      },
    };
  },
});
