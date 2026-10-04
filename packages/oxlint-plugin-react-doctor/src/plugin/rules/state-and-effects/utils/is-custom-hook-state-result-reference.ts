import type { Reference } from "eslint-scope";
import { BUILTIN_HOOK_NAMES, HOOK_NAME_PATTERN } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getDownstreamRefs } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isProp } from "./effect/react.js";
import { isComparisonMemoizerHookName } from "./is-comparison-memoizer-hook-name.js";

const NON_STATE_CUSTOM_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useCallbackRef",
  "useEffectEvent",
  "useEvent",
  "useEventCallback",
  "useLatest",
  "useMemoizedFn",
  "useStableCallback",
]);

const REACT_STATE_HOOK_NAMES: ReadonlySet<string> = new Set(["useReducer", "useState"]);

const isLocalNonStateMemoizerHook = (
  initializer: EsTreeNode,
  hookName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isComparisonMemoizerHookName(hookName)) return false;
  const candidate = stripParenExpression(initializer);
  if (!isNodeOfType(candidate, "CallExpression")) return false;
  const hookFunction = resolveExactLocalFunction(candidate.callee, scopes);
  if (!hookFunction) return false;
  let doesCreateState = false;
  walkAst(hookFunction, (child) => {
    if (child !== hookFunction && isNodeOfType(child, "CallExpression")) {
      if (isReactApiCall(child, REACT_STATE_HOOK_NAMES, scopes)) {
        doesCreateState = true;
        return false;
      }
    }
  });
  return !doesCreateState;
};

const EXTERNAL_SUBSCRIPTION_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useIntersectionObserver",
  "useMatchMedia",
  "useMediaJobProgress",
  "useMediaQuery",
  "useResizeObserver",
  "useVisibility",
  "useWindowSize",
]);

const getHookCalleeName = (initializer: EsTreeNode): string | null => {
  const unwrappedInitializer = stripParenExpression(initializer);
  if (!isNodeOfType(unwrappedInitializer, "CallExpression")) return null;
  const callee = stripParenExpression(unwrappedInitializer.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

export const isCustomHookStateResultReference = (
  analysis: ProgramAnalysis,
  reference: Reference,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    reference.resolved?.defs.some((definition) => {
      const declarator = definition.node as unknown as EsTreeNode;
      if (!isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) return false;
      const calleeName = getHookCalleeName(declarator.init as EsTreeNode);
      if (
        !calleeName ||
        !HOOK_NAME_PATTERN.test(calleeName) ||
        BUILTIN_HOOK_NAMES.has(calleeName) ||
        NON_STATE_CUSTOM_HOOK_NAMES.has(calleeName) ||
        isLocalNonStateMemoizerHook(declarator.init as EsTreeNode, calleeName, scopes) ||
        EXTERNAL_SUBSCRIPTION_HOOK_NAMES.has(calleeName)
      ) {
        return false;
      }
      const initializer = stripParenExpression(declarator.init as EsTreeNode);
      if (!isNodeOfType(initializer, "CallExpression")) return false;
      return initializer.arguments.some((argument) =>
        getDownstreamRefs(analysis, argument as EsTreeNode).some((argumentReference) =>
          isProp(analysis, argumentReference),
        ),
      );
    }),
  );
