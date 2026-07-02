import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// Sister rule to `rerender-lazy-ref-init` (which covers `useRef(new X())`)
// and `rerender-lazy-state-init` (which bails on non-CallExpression
// initializers, so `new X()` sails through). `useState` only uses its
// argument on the first render but still evaluates it every render and
// discards the result. Cheap built-in containers and DOM geometry value
// objects with constant arguments (`new Set()`, `new Map()`, `new Date()`,
// `new DOMRect()`) cost about as much as the lazy closure would, so they are
// exempt; the rule targets user-defined class constructors, side-effecting
// web APIs (new IntersectionObserver / AbortController / Worker), and
// containers rebuilt from a call result (`new Map(items.map(...))`). The fix
// is the lazy form `useState(() => new X())`.
const CHEAP_BUILTIN_CONSTRUCTOR_NAMES = new Set([
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Date",
  "RegExp",
  "URL",
  "URLSearchParams",
  "Headers",
  "DOMRect",
  "DOMRectReadOnly",
  "DOMPoint",
  "DOMPointReadOnly",
  "DOMMatrix",
  "DOMMatrixReadOnly",
  "DOMQuad",
  "Path2D",
]);

const isConstantConstructorArgument = (argumentNode: EsTreeNode): boolean => {
  const stripped = stripParenExpression(argumentNode);
  if (isNodeOfType(stripped, "Literal") || isNodeOfType(stripped, "Identifier")) return true;
  if (isNodeOfType(stripped, "TemplateLiteral")) {
    return stripped.expressions.every(isConstantConstructorArgument);
  }
  if (isNodeOfType(stripped, "UnaryExpression")) {
    return isConstantConstructorArgument(stripped.argument);
  }
  if (isNodeOfType(stripped, "MemberExpression")) {
    return (
      isConstantConstructorArgument(stripped.object) &&
      (!stripped.computed || isConstantConstructorArgument(stripped.property))
    );
  }
  if (isNodeOfType(stripped, "SpreadElement")) {
    return isConstantConstructorArgument(stripped.argument);
  }
  if (isNodeOfType(stripped, "ArrayExpression")) {
    return stripped.elements.every(
      (element) => element === null || isConstantConstructorArgument(element),
    );
  }
  if (isNodeOfType(stripped, "ObjectExpression")) {
    return stripped.properties.every((property) => {
      if (isNodeOfType(property, "SpreadElement")) {
        return isConstantConstructorArgument(property.argument);
      }
      return isNodeOfType(property, "Property") && isConstantConstructorArgument(property.value);
    });
  }
  return false;
};

const constructorName = (newExpression: EsTreeNodeOfType<"NewExpression">): string => {
  const callee = newExpression.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return "fn";
};

const isExemptNewExpression = (newExpression: EsTreeNodeOfType<"NewExpression">): boolean => {
  const name = constructorName(newExpression);
  if (TRIVIAL_INITIALIZER_NAMES.has(name)) return true;
  return (
    CHEAP_BUILTIN_CONSTRUCTOR_NAMES.has(name) &&
    newExpression.arguments.every(isConstantConstructorArgument)
  );
};

const findReportableNewExpression = (
  argument: EsTreeNode,
): EsTreeNodeOfType<"NewExpression"> | null => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "NewExpression")) {
    return isExemptNewExpression(stripped) ? null : stripped;
  }
  // `useState(cond ? new A() : new B())` / `useState(flag && new A())` —
  // a branch that is directly a `new` expression still constructs eagerly.
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    return (
      findReportableNewExpression(stripped.consequent) ??
      findReportableNewExpression(stripped.alternate)
    );
  }
  if (isNodeOfType(stripped, "LogicalExpression")) {
    return (
      findReportableNewExpression(stripped.left) ?? findReportableNewExpression(stripped.right)
    );
  }
  return null;
};

export const noEagerNewInUseStateInitializer = defineRule({
  id: "no-eager-new-in-use-state-initializer",
  title: "Eager new in useState initializer runs every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Wrap the constructor in a function (`useState(() => new X())`) so it only runs on the first render instead of allocating (and leaking) a fresh instance every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, "useState") || !node.arguments?.length) return;
      const eagerNew = findReportableNewExpression(node.arguments[0]);
      if (!eagerNew) return;

      const name = constructorName(eagerNew);
      context.report({
        node: eagerNew,
        message: `useState(new ${name}()) builds a fresh instance on every render and throws it away. Wrap it as useState(() => new ${name}()) so it only runs once.`,
      });
    },
  }),
});
