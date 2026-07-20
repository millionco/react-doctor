import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasStableCallTarget } from "../../utils/has-stable-call-target.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isJsxElementOrFragment } from "../../utils/is-jsx-element-or-fragment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

// Callees that legitimately take an inline JSX-returning function and either
// preserve hooks analysis (useCallback/useMemo/forwardRef/memo) or are not
// HOCs at all (styled, and common lowercase iteration/conditional helpers).
// `observer` is the canonical MobX component form — the MobX docs recommend
// `const Timer = observer(() => ...)` as the primary API, so flagging it
// would fire on effectively every mobx-react-lite component. React.* member
// forms are covered structurally: this rule only matches bare-Identifier /
// curried callees, never a MemberExpression callee, so `React.memo(...)` /
// `lodash.map(...)` never fire.
const WHITELISTED_CALLEE_NAMES = new Set([
  "useCallback",
  "useMemo",
  "forwardRef",
  "memo",
  "observer",
  // react-tracking's canonical form is `track()(props => ...)` — the curried
  // resolver reads the inner callee name, so the bare name covers both.
  "track",
  "styled",
  "map",
  "filter",
  "forEach",
  "times",
  "when",
]);

// Relay's container creators (`createFragmentContainer`, `createRefetchContainer`,
// `createPaginationContainer`) take the component implementation inline as their
// documented API shape — the same category as Mantine's `factory`.
const RELAY_CONTAINER_CREATOR_NAMES = new Set([
  "createFragmentContainer",
  "createPaginationContainer",
  "createRefetchContainer",
]);

// Wrappers that pass their first argument through unchanged for the purpose
// of "does this produce a component binding": `memo(withTheme(fn))` still
// assigns the HOC result to the outer binding, so the inline function inside
// `withTheme` keeps every harm the rule describes.
const TRANSPARENT_WRAPPER_CALLEE_NAMES = new Set(["memo", "forwardRef", "observer"]);
const RENDER_OUTPUT_MAPPING_METHOD_NAMES: ReadonlySet<string> = new Set(["flatMap", "map"]);

// Component *factory primitives* — Mantine's `factory` / `polymorphicFactory`,
// any `createXFactory`, and codebase-local typed wrappers around the React
// primitives (`polymorphicForwardRef`, `typedMemo`, `genericForwardRef`) —
// take the component implementation inline and wire up refs + a stable
// display name themselves (the same category as the whitelisted `forwardRef`
// / `memo` / `styled`), rather than wrapping a pre-existing component. Match
// them structurally by name so the whitelist doesn't have to grow one
// framework helper at a time.
const isComponentFactoryName = (calleeName: string): boolean =>
  /(?:factory|forwardref)$/i.test(calleeName) || /^(?:generic|typed)Memo$/i.test(calleeName);

// Resolves the wrapper name of the CallExpression the inline function is
// handed to. A bare `hoc(fn)` callee is the Identifier name; a curried
// `connect(mapState)(fn)` callee is itself a CallExpression, so we read the
// inner Identifier. A MemberExpression callee (`lib.render(fn)`) returns null
// so the rule stays quiet — keeping the match deliberately narrow.
const resolveInlineHocCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "CallExpression") && isNodeOfType(callee.callee, "Identifier")) {
    return callee.callee.name;
  }
  return null;
};

// A named, uppercase FunctionExpression defeats both harms the rule cites:
// `fn.name` gives a stable display name, and rules-of-hooks analyzes
// capitalized named function expressions — this is the exact fix the MobX
// docs recommend for anonymous observer components.
const isNamedComponentFunctionExpression = (functionNode: EsTreeNode): boolean =>
  isNodeOfType(functionNode, "FunctionExpression") &&
  functionNode.id != null &&
  isUppercaseName(functionNode.id.name);

const isSynchronousRenderOutputCallback = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callbackExpression = findTransparentExpressionRoot(functionNode);
  const call = callbackExpression.parent;
  if (!call || !isNodeOfType(call, "CallExpression")) return false;
  if (
    call.arguments[0] === callbackExpression &&
    isReactApiCall(call, "useMemo", scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    }) &&
    hasStableCallTarget(call, scopes)
  ) {
    return true;
  }
  const isArrayFromMapper = call.arguments[1] === callbackExpression;
  if (isArrayFromMapper) return executesDuringRender(callbackExpression, scopes);
  if (call.arguments[0] !== callbackExpression) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyKeyName(callee, { allowComputedString: false });
  return methodName !== null && RENDER_OUTPUT_MAPPING_METHOD_NAMES.has(methodName);
};

// Only mapper callbacks synchronously compose their result into the returned
// expression. Other nested functions stay separate closures.
const containsJsxInOwnExpression = (root: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let didFindJsx = false;
  walkAst(root, (node: EsTreeNode) => {
    if (didFindJsx) return false;
    if (isFunctionLike(node)) {
      if (
        isSynchronousRenderOutputCallback(node, scopes) &&
        functionReturnValueIsJsx(node, scopes)
      ) {
        didFindJsx = true;
      }
      return false;
    }
    if (isJsxElementOrFragment(node)) {
      didFindJsx = true;
      return false;
    }
  });
  return didFindJsx;
};

// A function is component-shaped when its own RETURN value is JSX — not when
// JSX merely appears somewhere in a deeper closure. Arrow expression bodies
// return directly; block bodies return through same-scope `ReturnStatement`s.
const returnValueContainsJsx = (
  expression: EsTreeNode,
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (containsJsxInOwnExpression(unwrappedExpression, scopes)) return true;
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const symbol = scopes.symbolFor(unwrappedExpression);
  const hasOnlyReadReferences = symbol?.references.every((reference) => reference.flag === "read");
  return Boolean(
    (symbol?.kind === "const" || (symbol?.kind === "let" && hasOnlyReadReferences)) &&
    symbol.initializer &&
    findEnclosingFunction(symbol.declarationNode) === functionNode &&
    containsJsxInOwnExpression(stripParenExpression(symbol.initializer), scopes),
  );
};

const functionReturnValueIsJsx = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return returnValueContainsJsx(functionNode.body, functionNode, scopes);
  }
  let returnsJsx = false;
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (returnsJsx) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      if (returnValueContainsJsx(child.argument, functionNode, scopes)) returnsJsx = true;
    }
  });
  return returnsJsx;
};

// A hook call is a bare `useX(...)` / `use(...)` identifier or the
// `React.useX(...)` namespace form. Property names on other receivers are
// NOT hooks: chainable `.use(plugin)` pipelines (markdown-it, unified/remark,
// postcss, i18next) would otherwise defeat the hook-free classic-HOC
// exemption below via the React 19 bare-`use` special case.
const isReactHookInvocation = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isNodeOfType(node.callee, "Identifier")) return isReactHookName(node.callee.name);
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    node.callee.object.name === "React"
  ) {
    const propertyName = getStaticPropertyKeyName(node.callee, { allowComputedString: true });
    return Boolean(
      propertyName &&
      isReactHookName(propertyName) &&
      isReactApiCall(node, propertyName, scopes, { allowGlobalReactNamespace: true }),
    );
  }
  return false;
};

// The headline harm — rules-of-hooks / exhaustive-deps no longer analyzing
// the component — only exists when the inline function actually calls a hook.
// Hook-free inline wrappers are the documented idiom of classic pre-hooks
// HOCs (react-sortable-hoc, react-instantsearch connectors), and the
// remaining display-name nit alone is below reporting threshold.
const callsHookInOwnScope = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let didCallHook = false;
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (didCallHook) return false;
    if (isReactHookInvocation(child, scopes)) {
      didCallHook = true;
      return false;
    }
  });
  return didCallHook;
};

// The wrapping call's result must land in a component-shaped slot — an
// uppercase binding / assignment target, or a default export — so
// non-component HOC-like helpers whose results are lowercase-named (act(),
// render(), reduce()) stay quiet. Transparent wrappers (`memo`, `forwardRef`,
// TS casts) and curried HOC applications (`connect(mapState)(...)` — the
// callee is itself a CallExpression) between the HOC call and the slot are
// peeled.
const producesComponentValue = (wrappingCall: EsTreeNode): boolean => {
  const outermostExpression = findTransparentExpressionRoot(wrappingCall);
  const consumer = outermostExpression.parent;
  if (!consumer) return false;
  if (isNodeOfType(consumer, "VariableDeclarator")) {
    return isNodeOfType(consumer.id, "Identifier") && isUppercaseName(consumer.id.name);
  }
  if (isNodeOfType(consumer, "ExportDefaultDeclaration")) return true;
  if (isNodeOfType(consumer, "AssignmentExpression") && consumer.right === outermostExpression) {
    if (isNodeOfType(consumer.left, "Identifier")) return isUppercaseName(consumer.left.name);
    if (isNodeOfType(consumer.left, "MemberExpression")) {
      const propertyName = getStaticPropertyKeyName(consumer.left, { allowComputedString: true });
      return propertyName !== null && isUppercaseName(propertyName);
    }
    return false;
  }
  if (isNodeOfType(consumer, "CallExpression") && consumer.arguments[0] === outermostExpression) {
    if (isNodeOfType(consumer.callee, "CallExpression")) return producesComponentValue(consumer);
    const outerCalleeName = getCalleeName(consumer);
    if (outerCalleeName !== null && TRANSPARENT_WRAPPER_CALLEE_NAMES.has(outerCalleeName)) {
      return producesComponentValue(consumer);
    }
  }
  return false;
};

export const noInlineHocOnComponent = defineRule({
  id: "no-inline-hoc-on-component",
  title: "Function component defined inline inside an HOC call",
  tags: ["test-noise", "react-jsx-only"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Extract the inline function into a named base component at module scope and pass the reference to the HOC (`const CardBase = (props) => ...; const Card = withTracking(CardBase);`). This restores rules-of-hooks and exhaustive-deps analysis and gives the component a stable display name.",
  create: (context: RuleContext) => {
    const checkInlineFunction = (functionNode: EsTreeNode): void => {
      const passedExpression = findTransparentExpressionRoot(functionNode);
      const wrappingCall = passedExpression.parent;
      if (!wrappingCall || !isNodeOfType(wrappingCall, "CallExpression")) return;
      if (wrappingCall.arguments[0] !== passedExpression) return;

      const calleeName = resolveInlineHocCalleeName(wrappingCall.callee);
      if (
        calleeName === null ||
        WHITELISTED_CALLEE_NAMES.has(calleeName) ||
        isComponentFactoryName(calleeName) ||
        RELAY_CONTAINER_CREATOR_NAMES.has(calleeName)
      ) {
        return;
      }
      if (isNamedComponentFunctionExpression(functionNode)) return;
      if (!functionReturnValueIsJsx(functionNode, context.scopes)) return;
      if (!callsHookInOwnScope(functionNode, context.scopes)) return;
      if (!producesComponentValue(wrappingCall)) return;

      context.report({
        node: functionNode,
        message:
          "This component is defined inline inside an HOC call, so rules-of-hooks and exhaustive-deps stop analyzing it and it has no stable display name; extract it as a named base component and pass the reference to the HOC.",
      });
    };

    return {
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        checkInlineFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        checkInlineFunction(node);
      },
    };
  },
});
