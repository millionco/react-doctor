import {
  HOOK_LIBRARY_MAP,
  type HookLibraryAvailability,
} from "../../constants/hook-libraries.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const HOOK_LIBRARY_MODULE_SOURCES = ["react-use", "usehooks-ts"] as const;

// True when `node` is at the file's module/top level — i.e. its parent is
// the `Program` root, optionally through one `ExportNamedDeclaration` or
// `ExportDefaultDeclaration` wrapper. Nested hooks (defined inside a
// component or another hook) are out of v1 scope because legitimate
// factory-style nesting is common (`useResetOnNavigate` calling
// `usePrevious` internally) and the same-name match would false-fire.
const isAtModuleScope = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "Program")) return true;
  if (
    isNodeOfType(parent, "ExportNamedDeclaration") ||
    isNodeOfType(parent, "ExportDefaultDeclaration")
  ) {
    return isNodeOfType(parent.parent, "Program");
  }
  return false;
};

// Walks `body` without descending into nested FunctionDeclaration /
// FunctionExpression / ArrowFunctionExpression / ClassBody children, so
// callbacks passed to `useEffect(() => { use... }, [])` don't accidentally
// register as a "real React hook call" — the only signal we care about is
// hooks called DIRECTLY inside the candidate hook's body. Returns the first
// CallExpression whose callee resolves to a React-hook-shaped name (`use`
// + uppercase / digit, or the bare React 19 `use`). Handles arrow
// expression bodies (`(cb) => useEffect(cb, [])`) by checking `body`
// itself as well as its descendants — without this check, a one-line
// reimplementation of `useMount` would slip past while the parenthesized
// variant `(cb) => (useEffect(cb, []))` would not.
const findReactHookCallInOwnBody = (
  body: EsTreeNode | null | undefined
): EsTreeNode | null => {
  if (!body) return null;
  let firstHookCall: EsTreeNode | null = null;
  walkAst(body, (child) => {
    if (firstHookCall) return false;
    // Prune nested functions / classes so callbacks aren't mistaken for
    // direct hook calls. The body itself bypasses this pruning so an
    // arrow with a CallExpression body still gets checked.
    if (
      child !== body &&
      (isNodeOfType(child, "FunctionDeclaration") ||
        isNodeOfType(child, "FunctionExpression") ||
        isNodeOfType(child, "ArrowFunctionExpression") ||
        isNodeOfType(child, "ClassDeclaration") ||
        isNodeOfType(child, "ClassExpression"))
    ) {
      return false;
    }
    if (isNodeOfType(child, "CallExpression")) {
      const calleeName = getCalleeName(child);
      if (calleeName && isReactHookName(calleeName)) {
        firstHookCall = child;
        return false;
      }
    }
    return;
  });
  return firstHookCall;
};

// A "delegation wrapper" hook is one whose body is a single statement that
// returns a call to the SAME canonical hook — either by name match
// (`function useDebounce(v) { return useDebounce(v, 500) }`) or via a
// renamed import from a known hook library
// (`import { useDebounce as upstream } from "react-use"; function
// useDebounce(v) { return upstream(v, 500) }`). The author is pre-binding
// the library hook, not reimplementing it; skipping these keeps the rule
// from flagging legitimate facade patterns.
const isDelegationWrapper = (
  body: EsTreeNode | null | undefined,
  hookName: string
): boolean => {
  if (!body) return false;
  if (!isNodeOfType(body, "BlockStatement")) {
    const expression = stripParenExpression(body);
    return isCallToSameCanonicalHook(expression, hookName);
  }
  if (body.body.length !== 1) return false;
  const onlyStatement = body.body[0];
  if (isNodeOfType(onlyStatement, "ReturnStatement")) {
    if (!onlyStatement.argument) return false;
    return isCallToSameCanonicalHook(
      stripParenExpression(onlyStatement.argument),
      hookName
    );
  }
  if (isNodeOfType(onlyStatement, "ExpressionStatement")) {
    return isCallToSameCanonicalHook(
      stripParenExpression(onlyStatement.expression),
      hookName
    );
  }
  return false;
};

const isCallToSameCanonicalHook = (
  node: EsTreeNode,
  hookName: string
): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  const calleeName = node.callee.name;
  if (calleeName === hookName) return true;
  for (const moduleSource of HOOK_LIBRARY_MODULE_SOURCES) {
    if (getImportedNameFromModule(node, calleeName, moduleSource) === hookName)
      return true;
  }
  return false;
};

const formatLibrarySuggestion = (
  availability: HookLibraryAvailability
): string => {
  if (availability.reactUse && availability.usehooksTs) {
    return "`react-use` or `usehooks-ts`";
  }
  if (availability.reactUse) return "`react-use`";
  return "`usehooks-ts`";
};

const buildDiagnosticMessage = (
  hookName: string,
  availability: HookLibraryAvailability
): string => {
  const librarySuggestion = formatLibrarySuggestion(availability);
  return `\`${hookName}\` is a well-known hook already shipped by ${librarySuggestion}. Reimplementing it commonly misses SSR safety, cleanup races, stale closures from identity-unstable callbacks, or Strict-Mode double-fire — use the library version. If neither is installed, add \`react-use\` for the broader catalog.`;
};

const reportIfCandidateHookReimplementation = (
  context: RuleContext,
  declarationNode: EsTreeNode,
  identifierNode: EsTreeNode,
  hookName: string,
  body: EsTreeNode | null | undefined
): void => {
  const availability = HOOK_LIBRARY_MAP.get(hookName);
  if (!availability) return;
  if (!isAtModuleScope(declarationNode)) return;
  if (isDelegationWrapper(body, hookName)) return;
  if (!findReactHookCallInOwnBody(body)) return;
  context.report({
    node: identifierNode,
    message: buildDiagnosticMessage(hookName, availability),
  });
};

// Catches top-level custom hooks whose names match a well-known hook from
// `react-use` or `usehooks-ts`. Detection is name-only by design — the
// hook map is curated to exclude ambiguous names (`useLocation`,
// `useEvent`, `useSearchParams`, `useNavigation`, `useEventCallback`,
// `useSpring`, etc.) so a same-name match almost always means the user
// hand-rolled the library hook.
//
// V1 scope:
//   - Module-level FunctionDeclaration / VariableDeclarator only.
//   - Body must call at least one React hook (filters out plain utilities
//     that happen to start with `use`).
//   - Skips single-statement delegation wrappers that just forward to a
//     same-named hook (facade pattern, not a reimplementation).
//   - Test files auto-skipped via the `test-noise` tag wrapper.
//
// Intentionally out of v1:
//   - Pattern-based detection (e.g. `useEffect(() => setTimeout(...), [])`
//     → suggest `useTimeout`). Different rule, much higher FP risk.
//   - Hooks defined inside other components / hooks (factory patterns are
//     usually intentional).
//   - Re-export-only files (`export { useDebounce } from "./impl"` —
//     there's no declarator to visit).
export const preferExistingHookLibrary = defineRule<Rule>({
  id: "prefer-existing-hook-library",
  title: "Custom hook reimplements a library hook",
  tags: ["test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Replace the hand-rolled hook with the same-named hook from `react-use` or `usehooks-ts`. Library hooks handle SSR safety, cleanup, Strict-Mode double-fire, and identity-unstable callbacks that hand-rolled versions usually miss.",
  create: (context: RuleContext) => ({
    FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
      if (!node.id?.name) return;
      reportIfCandidateHookReimplementation(
        context,
        node,
        node.id,
        node.id.name,
        node.body
      );
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier")) return;
      const init = node.init;
      if (!init) return;
      if (
        !isNodeOfType(init, "ArrowFunctionExpression") &&
        !isNodeOfType(init, "FunctionExpression")
      ) {
        return;
      }
      // VariableDeclarator's grandparent is the module-scope check target:
      // Program > VariableDeclaration > VariableDeclarator (optionally with
      // an ExportNamedDeclaration wrapper above the VariableDeclaration).
      const declarationParent = node.parent;
      if (!declarationParent) return;
      reportIfCandidateHookReimplementation(
        context,
        declarationParent,
        node.id,
        node.id.name,
        init.body
      );
    },
  }),
});
