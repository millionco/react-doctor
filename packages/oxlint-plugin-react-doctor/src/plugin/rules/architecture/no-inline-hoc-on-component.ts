import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

// Callees that legitimately take an inline JSX-returning function and either
// preserve hooks analysis (useCallback/useMemo/forwardRef/memo) or are not
// HOCs at all (styled, and the lowercase iteration/conditional helpers Faire's
// in-house rule enumerated). React.* member forms are covered structurally:
// this rule only matches bare-Identifier / curried callees, never a
// MemberExpression callee, so `React.memo(...)` / `lodash.map(...)` never fire.
const WHITELISTED_CALLEE_NAMES = new Set([
  "useCallback",
  "useMemo",
  "forwardRef",
  "memo",
  "styled",
  "map",
  "filter",
  "forEach",
  "times",
  "when",
]);

// Component *factory primitives* — Mantine's `factory` / `polymorphicFactory`
// and any `createXFactory` — take the component implementation inline and wire
// up refs + a stable display name themselves (the same category as the
// whitelisted `forwardRef` / `memo` / `styled`), rather than wrapping a
// pre-existing component. Match them structurally by name so the whitelist
// doesn't have to grow one framework helper at a time.
const isComponentFactoryName = (calleeName: string): boolean => /factory$/i.test(calleeName);

// Resolves the wrapper name of the CallExpression the inline function is
// handed to. A bare `hoc(fn)` callee is the Identifier name; a curried
// `connect(mapState)(fn)` callee is itself a CallExpression, so we read the
// inner Identifier. A MemberExpression callee (`lib.render(fn)`) returns null
// so the rule stays quiet — matching the narrow shape Faire's rule matched.
const resolveInlineHocCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "CallExpression") && isNodeOfType(callee.callee, "Identifier")) {
    return callee.callee.name;
  }
  return null;
};

// A function is component-shaped when its RETURN value is JSX — not merely when
// its subtree contains JSX (which would also match a data callback that renders
// JSX in a nested, non-returned map callback). Arrow expression bodies return
// directly; block bodies return through `ReturnStatement`s in the same scope.
const functionReturnValueIsJsx = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return containsJsxElement(stripParenExpression(functionNode.body));
  }
  let returnsJsx = false;
  walkOwnFunctionScope(functionNode, (child: EsTreeNode) => {
    if (returnsJsx) return false;
    if (isNodeOfType(child, "ReturnStatement") && child.argument) {
      if (containsJsxElement(child.argument)) returnsJsx = true;
    }
  });
  return returnsJsx;
};

// The wrapping call's result must be assigned to an uppercase-named binding —
// i.e. it produces a *component*. This filters non-component HOC-like helpers
// whose results are lowercase-named (act(), render(), reduce()), pushing the
// false-positive rate down without an ever-growing denylist.
const isAssignedToComponentBinding = (wrappingCall: EsTreeNode): boolean => {
  const declarator = wrappingCall.parent;
  return Boolean(
    declarator &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    isNodeOfType(declarator.id, "Identifier") &&
    isUppercaseName(declarator.id.name),
  );
};

export const noInlineHocOnComponent = defineRule({
  id: "no-inline-hoc-on-component",
  title: "Function component defined inline inside an HOC call",
  tags: ["test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Extract the inline function into a named base component at module scope and pass the reference to the HOC (`const CardBase = (props) => ...; const Card = withTracking(CardBase);`). This restores rules-of-hooks and exhaustive-deps analysis and gives the component a stable display name.",
  create: (context: RuleContext) => {
    const checkInlineFunction = (functionNode: EsTreeNode): void => {
      const wrappingCall = functionNode.parent;
      if (!wrappingCall || !isNodeOfType(wrappingCall, "CallExpression")) return;
      if (wrappingCall.arguments?.[0] !== functionNode) return;

      const calleeName = resolveInlineHocCalleeName(wrappingCall.callee);
      if (
        calleeName === null ||
        WHITELISTED_CALLEE_NAMES.has(calleeName) ||
        isComponentFactoryName(calleeName)
      ) {
        return;
      }
      if (!functionReturnValueIsJsx(functionNode)) return;
      if (!isAssignedToComponentBinding(wrappingCall)) return;

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
