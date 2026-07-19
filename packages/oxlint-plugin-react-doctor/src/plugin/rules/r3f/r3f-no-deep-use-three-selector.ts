import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";

const MUTABLE_ROOT_STATE_PROPERTIES: ReadonlySet<string> = new Set([
  "camera",
  "clock",
  "gl",
  "mouse",
  "pointer",
  "raycaster",
  "renderer",
  "scene",
]);
const MUTABLE_SCALAR_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "aspect",
  "autoClear",
  "autoClearColor",
  "autoClearDepth",
  "autoClearStencil",
  "backgroundBlurriness",
  "backgroundIntensity",
  "elapsedTime",
  "environmentIntensity",
  "far",
  "filmGauge",
  "filmOffset",
  "focus",
  "fov",
  "near",
  "oldTime",
  "outputColorSpace",
  "running",
  "sortObjects",
  "startTime",
  "toneMapping",
  "toneMappingExposure",
  "w",
  "x",
  "y",
  "z",
  "zoom",
]);

interface DeepMutableStateProperty {
  mutablePropertyName: string;
  rootPropertyName: string;
}

interface DeepSelectorReturn extends DeepMutableStateProperty {
  node: EsTreeNode;
}

const getDeepMutableStateProperty = (
  expression: EsTreeNode,
  selector: EsTreeNode,
  scopes: ScopeAnalysis,
): DeepMutableStateProperty | null => {
  let candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "MemberExpression")) return null;
  const mutablePropertyName = getStaticPropertyName(candidate);
  if (!mutablePropertyName || !MUTABLE_SCALAR_PROPERTY_NAMES.has(mutablePropertyName)) {
    return null;
  }
  candidate = stripParenExpression(candidate.object);
  while (true) {
    for (const rootPropertyName of MUTABLE_ROOT_STATE_PROPERTIES) {
      if (isR3fCallbackStateProperty(candidate, selector, rootPropertyName, scopes)) {
        return { mutablePropertyName, rootPropertyName };
      }
    }
    if (!isNodeOfType(candidate, "MemberExpression")) return null;
    candidate = stripParenExpression(candidate.object);
  }
};

const findDeepSelectorReturns = (
  selector: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<DeepSelectorReturn> => {
  if (!isFunctionLike(selector)) return [];
  if (!isNodeOfType(selector.body, "BlockStatement")) {
    const mutableStateProperty = getDeepMutableStateProperty(
      selector.body,
      selector,
      context.scopes,
    );
    return mutableStateProperty ? [{ node: selector.body, ...mutableStateProperty }] : [];
  }
  const returns: Array<DeepSelectorReturn> = [];
  walkAst(selector.body, (candidate) => {
    if (candidate !== selector.body && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "ReturnStatement") || !candidate.argument) return;
    const mutableStateProperty = getDeepMutableStateProperty(
      candidate.argument,
      selector,
      context.scopes,
    );
    if (mutableStateProperty) returns.push({ node: candidate.argument, ...mutableStateProperty });
  });
  return returns;
};

export const r3fNoDeepUseThreeSelector = defineRule({
  id: "r3f-no-deep-use-three-selector",
  title: "useThree selector reads a mutable Three.js field",
  severity: "warn",
  recommendation:
    "Select the stable R3F store object, then read its mutable Three.js fields where they are consumed",
  requires: ["r3f:6"],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isR3fApiCall(node, "useThree", context.scopes)) return;
      const selectorArgument = node.arguments[0];
      if (!selectorArgument || isNodeOfType(selectorArgument, "SpreadElement")) return;
      const selector = resolveLocalReactCallback(selectorArgument, context.scopes);
      if (!selector) return;
      for (const returnedValue of findDeepSelectorReturns(selector, context)) {
        context.report({
          node: returnedValue.node,
          message: `This selector reads the mutable ${returnedValue.mutablePropertyName} field from ${returnedValue.rootPropertyName}, but deep Three.js mutations do not update the R3F store. Select ${returnedValue.rootPropertyName} itself and read ${returnedValue.mutablePropertyName} at the point of use`,
        });
      }
    },
  }),
});
