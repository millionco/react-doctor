import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const HOOKS_WITH_DEPS_AT_INDEX_1 = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useCallback",
  "useMemo",
  "useImperativeHandle",
  "useSignalEffect",
]);

const NAN_MESSAGE =
  "`NaN` in a hook dependency array silently disables update tracking — `NaN !== NaN`, so the dependency comparison always rerun the hook. Use a stable sentinel or guard the value before passing it.";

const isNanLiteral = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "Identifier") && node.name === "NaN") return true;
  if (
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    isNodeOfType(node.object, "Identifier") &&
    node.object.name === "Number" &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === "NaN"
  ) {
    return true;
  }
  return false;
};

// Mirrors the runtime check in `preact/debug/src/debug.js`:
//   if (isNaN(arg)) {
//     console.warn(`Invalid argument passed to hook. Hooks should not be
//                  called with NaN in the dependency array. ...`);
//   }
// React's `Object.is`-based dependency comparison does treat `NaN === NaN`
// as equal, but that subtlety is rarely the developer's intent. The wider
// failure mode is the typical javascript pattern `Number(value)` returning
// `NaN` from an unchecked input — once that lands in the dep array the
// hook never re-runs again. preact/debug surfaces this as a warning at
// runtime; lifting it to static analysis catches it at authoring time on
// the literal `NaN` and `Number.NaN` shapes (the dynamic cases need
// runtime support).
//
// Covers all standard hooks whose 2nd arg (1st for useImperativeHandle:
// 3rd) is a dep array, including signal-flavoured `useSignalEffect`.
export const hooksNoNanInDeps = defineRule<Rule>({
  id: "hooks-no-nan-in-deps",
  severity: "warn",
  recommendation:
    "Remove `NaN` (or `Number.NaN`) from the dependency array. If a value can be NaN at runtime, normalise it (`Number.isNaN(x) ? 0 : x`) before passing it.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, HOOKS_WITH_DEPS_AT_INDEX_1)) return;
      // useImperativeHandle puts the dep array at index 2; everything else at 1.
      const calleeName = isNodeOfType(node.callee, "Identifier")
        ? node.callee.name
        : isNodeOfType(node.callee, "MemberExpression") &&
            isNodeOfType(node.callee.property, "Identifier")
          ? node.callee.property.name
          : null;
      const depsIndex = calleeName === "useImperativeHandle" ? 2 : 1;
      const depsArgument = node.arguments[depsIndex];
      if (!depsArgument || !isNodeOfType(depsArgument, "ArrayExpression")) return;
      for (const element of depsArgument.elements) {
        if (!element) continue;
        if (isNanLiteral(element)) {
          context.report({ node: element, message: NAN_MESSAGE });
        }
      }
    },
  }),
});
