import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Per the applied revision, `crypto.*` id/byte generators are dropped:
// stable per-process ids are the dominant, correct idiom at module scope.
// What remains fires regardless of intent: Math.random() sampling and
// wall-clock reads used in date/timezone math.
const IMPURE_MEMBER_CALLS = new Map<string, ReadonlySet<string>>([
  ["Math", new Set(["random"])],
  ["Date", new Set(["now"])],
  ["performance", new Set(["now"])],
]);

// Bindings whose name advertises an intentional per-process value
// (instance/boot/startup/init ids, module-load timestamps). Applied from the
// revision to spare those correct-by-design constants.
const PER_PROCESS_NAME_KEYWORDS = new Set([
  "instance",
  "boot",
  "startup",
  "start",
  "started",
  "init",
  "load",
  "loaded",
  "module",
  "process",
  "server",
  "build",
  // per-process ids and time origins (tabId, moduleEpoch, uptimeMs,
  // hydrationBaselineMs, sessionSeed) — the correct-by-design class the
  // crypto.* carve-out already spares
  "uptime",
  "epoch",
  "origin",
  "baseline",
  "session",
  "seed",
  // `NOW` / `NOW_MS` — the name declares a deliberate module-load
  // timestamp (hyperdx documents its `export const NOW = Date.now()` as
  // "time captured at module load, use as a stable fallback")
  "now",
  "id",
  "tab",
  "client",
  // mutable cache/refresh seeds (lastRefreshedAt, cacheExpiresAt)
  "expires",
  "expiry",
  "refreshed",
  // static preview/fixture data (react-email PreviewProps defaults)
  "preview",
  "fixture",
  "mock",
  "defaults",
  "placeholder",
]);

const isPerProcessBindingName = (bindingName: string): boolean =>
  bindingName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_-]+/)
    .some((nameWord) => PER_PROCESS_NAME_KEYWORDS.has(nameWord));

const impureBuiltinLabel = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "NewExpression")) {
    // Only the zero-argument `new Date()` is nondeterministic; a
    // timestamp/parts argument is deterministic.
    if (
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "Date" &&
      (node.arguments?.length ?? 0) === 0 &&
      !findVariableInitializer(node.callee, "Date")
    ) {
      return "new Date()";
    }
    return null;
  }
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.object, "Identifier")) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const allowedMethods = IMPURE_MEMBER_CALLS.get(callee.object.name);
  if (!allowedMethods?.has(callee.property.name)) return null;
  // A same-file binding named `Math`/`Date`/`performance` shadows the global.
  if (findVariableInitializer(callee.object, callee.object.name)) return null;
  return `${callee.object.name}.${callee.property.name}()`;
};

const testChecksTypeofWindow = (test: EsTreeNode): boolean => {
  let found = false;
  walkAst(test, (node: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(node, "UnaryExpression") &&
      node.operator === "typeof" &&
      isNodeOfType(node.argument, "Identifier") &&
      (node.argument.name === "window" || node.argument.name === "document")
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

interface ModuleScopeBinding {
  readonly bindingName: string | null;
}

// Walks up from an impure call to decide whether it is evaluated once at
// module load — either in a top-level variable initializer or a static
// class-field initializer of a module-scope class — returning the bound
// name, or null when a function boundary is crossed first or the impure
// value is an argument to a factory call (`atom(Date.now())`,
// `signal(Date.now())`), a deliberate mutable seed rather than a frozen
// constant.
const resolveModuleScopeBinding = (impureNode: EsTreeNode): ModuleScopeBinding | null => {
  let child: EsTreeNode = impureNode;
  let cursor: EsTreeNode | null = impureNode.parent ?? null;
  let staticFieldBinding: ModuleScopeBinding | null = null;
  while (cursor) {
    if (isFunctionLike(cursor) || isNodeOfType(cursor, "MethodDefinition")) return null;

    if (
      (isNodeOfType(cursor, "CallExpression") || isNodeOfType(cursor, "NewExpression")) &&
      cursor.arguments?.some((argumentNode) => argumentNode === child)
    ) {
      return null;
    }

    // `typeof window === "undefined" ? 0 : performance.now()` — the branch
    // visible to the server render is the deterministic constant; the
    // impure read only ever runs in the browser.
    if (
      isNodeOfType(cursor, "ConditionalExpression") &&
      cursor.test !== child &&
      testChecksTypeofWindow(cursor.test as EsTreeNode)
    ) {
      return null;
    }

    if (isNodeOfType(cursor, "PropertyDefinition")) {
      if (cursor.static !== true || cursor.key === child) return null;
      staticFieldBinding = {
        bindingName: isNodeOfType(cursor.key, "Identifier") ? cursor.key.name : null,
      };
    }

    if (isNodeOfType(cursor, "VariableDeclarator")) {
      const declaration = cursor.parent;
      if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
      // A `let`/`var` seed is a deliberate MUTABLE per-process value the
      // module refreshes later (`let lastRefreshedAt = Date.now()`), the
      // same intent the factory-argument exemption spares — the frozen-
      // forever hazard is specific to `const`.
      if (declaration.kind !== "const") return null;
      let declarationParent = declaration.parent ?? null;
      if (declarationParent && isNodeOfType(declarationParent, "ExportNamedDeclaration")) {
        declarationParent = declarationParent.parent ?? null;
      }
      if (!declarationParent || !isNodeOfType(declarationParent, "Program")) return null;
      return {
        bindingName: isNodeOfType(cursor.id, "Identifier") ? cursor.id.name : null,
      };
    }

    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return staticFieldBinding;
};

export const noImpureCallAtModuleScope = defineRule({
  id: "no-impure-call-at-module-scope",
  title: "Nondeterministic built-in at module scope",
  severity: "warn",
  requires: ["ssr"],
  tags: ["test-noise"],
  recommendation:
    "`Math.random()`, `Date.now()`, `performance.now()`, and `new Date()` run once at module load, so the value is frozen for the whole server process. Move the call into a function/component so it evaluates per request.",
  create: (context: RuleContext) => {
    const check = (node: EsTreeNode): void => {
      const label = impureBuiltinLabel(node);
      if (!label) return;
      const binding = resolveModuleScopeBinding(node);
      if (!binding) return;
      if (binding.bindingName && isPerProcessBindingName(binding.bindingName)) return;
      context.report({
        node,
        message: `\`${label}\` runs once when this module loads, so the value is frozen for the whole server process and every SSR request reuses it — move it into a function or component so it evaluates per request.`,
      });
    };
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        check(node);
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        check(node);
      },
    };
  },
});
