import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Browser-only globals that do not exist during a Node SSR/SSG render.
// Reading one on the render path throws `ReferenceError` on the server,
// or seeds a client-only initial value that disagrees with the server
// HTML (hydration mismatch).
const BROWSER_GLOBAL_NAMES = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "matchMedia",
]);

// Hooks whose FIRST-render argument runs during render (so a browser
// read inside their lazy initializer is unsafe under SSR). `useMemo`
// / `useEffect` are deliberately absent — the definition scopes the
// render-time path to these three initializers plus bare body reads.
const RENDER_TIME_INITIALIZER_HOOKS = new Set([
  "useState",
  "useReducer",
  "useRef",
]);

// Identifiers that, when present in a dominating condition, mark the
// read as SSR-guarded (mounted-state / can-use-DOM feature checks).
const DOM_GUARD_IDENTIFIER_NAMES = new Set([
  "canUseDOM",
  "isMounted",
  "mounted",
  "isBrowser",
  "isClient",
  "hasWindow",
]);

const isBrowserGlobalIdentifier = (
  node: EsTreeNode
): node is EsTreeNodeOfType<"Identifier"> =>
  isNodeOfType(node, "Identifier") && BROWSER_GLOBAL_NAMES.has(node.name);

// True when `identifier` is the real browser global and not a same-file
// local binding of the same name (e.g. `const navigator = useAgent()`
// or `location` from react-router's `useLocation()`).
const isTrueBrowserGlobal = (
  identifier: EsTreeNodeOfType<"Identifier">
): boolean => findVariableInitializer(identifier, identifier.name) === null;

// A function passed as the lazy-initializer argument of
// `useState` / `useReducer` / `useRef`.
const isRenderTimeInitializerCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (!parent.arguments?.some((argument) => argument === functionNode))
    return false;
  const calleeName = getCalleeName(parent);
  return Boolean(calleeName && RENDER_TIME_INITIALIZER_HOOKS.has(calleeName));
};

// True when `node` executes during a component/hook render: directly in
// the component/hook body, or inside a useState/useReducer/useRef lazy
// initializer within one. Reads inside effects, event handlers,
// useMemo, or any other nested callback return false.
const isOnRenderTimePath = (node: EsTreeNode): boolean => {
  const enclosingFunction = nearestEnclosingFunction(node);
  if (!enclosingFunction) return false;
  if (componentOrHookDisplayNameForFunction(enclosingFunction)) return true;
  if (isRenderTimeInitializerCallback(enclosingFunction)) {
    const outerFunction = nearestEnclosingFunction(enclosingFunction);
    return Boolean(
      outerFunction && componentOrHookDisplayNameForFunction(outerFunction)
    );
  }
  return false;
};

const conditionContainsDomGuard = (condition: EsTreeNode): boolean => {
  let guarded = false;
  walkAst(condition, (child) => {
    if (guarded) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "typeof") {
      const argument = stripParenExpression(child.argument);
      if (
        isNodeOfType(argument, "Identifier") &&
        BROWSER_GLOBAL_NAMES.has(argument.name)
      ) {
        guarded = true;
        return false;
      }
    }
    if (
      isNodeOfType(child, "Identifier") &&
      DOM_GUARD_IDENTIFIER_NAMES.has(child.name)
    ) {
      guarded = true;
      return false;
    }
  });
  return guarded;
};

// True when a `typeof window`/`canUseDOM`/`isMounted` check dominates
// the read via an enclosing `if` / ternary / `&&`. Conservative: any
// such guard on an ancestor suppresses the report.
const isDominatedByDomGuard = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      conditionContainsDomGuard(ancestor.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      conditionContainsDomGuard(ancestor.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      conditionContainsDomGuard(ancestor.left)
    ) {
      return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const noUnguardedBrowserGlobalInRenderOrHookInit = defineRule({
  id: "no-unguarded-browser-global-in-render-or-hook-init",
  title: "Browser global read during render or hook init",
  severity: "warn",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    'Reading `window`/`document`/`navigator`/`localStorage`/`sessionStorage` during render or in a useState/useReducer/useRef initializer crashes the server render and causes hydration mismatches. Seed a stable default and read the browser global inside a useEffect after mount, or guard with `typeof window !== "undefined"`.',
  create: (context: RuleContext) => {
    const reportRead = (readNode: EsTreeNode, globalName: string): void => {
      if (!isOnRenderTimePath(readNode)) return;
      if (isDominatedByDomGuard(readNode)) return;
      context.report({
        node: readNode,
        message: `Reading \`${globalName}\` during render or in a useState/useReducer/useRef initializer crashes SSR ("${globalName} is not defined") and causes hydration mismatches. Seed a stable default and read \`${globalName}\` inside a useEffect after mount, or guard it with \`typeof ${globalName} !== "undefined"\`.`,
      });
    };

    return {
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        const object = stripParenExpression(node.object);
        if (!isBrowserGlobalIdentifier(object) || !isTrueBrowserGlobal(object))
          return;
        reportRead(node, object.name);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        // Bare `matchMedia(...)` — the member form `window.matchMedia`
        // is already covered by the MemberExpression visitor.
        const callee = stripParenExpression(node.callee);
        if (!isBrowserGlobalIdentifier(callee) || !isTrueBrowserGlobal(callee))
          return;
        reportRead(callee, callee.name);
      },
    };
  },
});
