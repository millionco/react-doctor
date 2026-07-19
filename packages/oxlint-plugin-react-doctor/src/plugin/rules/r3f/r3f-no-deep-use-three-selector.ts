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

const getDeepMutableStateProperty = (
  expression: EsTreeNode,
  selector: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  let candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    !MUTABLE_SCALAR_PROPERTY_NAMES.has(getStaticPropertyName(candidate) ?? "")
  ) {
    return null;
  }
  candidate = stripParenExpression(candidate.object);
  while (true) {
    for (const propertyName of MUTABLE_ROOT_STATE_PROPERTIES) {
      if (isR3fCallbackStateProperty(candidate, selector, propertyName, scopes)) {
        return propertyName;
      }
    }
    if (!isNodeOfType(candidate, "MemberExpression")) return null;
    candidate = stripParenExpression(candidate.object);
  }
};

const findDeepSelectorReturns = (
  selector: EsTreeNode,
  context: RuleContext,
): ReadonlyArray<{ node: EsTreeNode; propertyName: string }> => {
  if (!isFunctionLike(selector)) return [];
  if (!isNodeOfType(selector.body, "BlockStatement")) {
    const propertyName = getDeepMutableStateProperty(selector.body, selector, context.scopes);
    return propertyName ? [{ node: selector.body, propertyName }] : [];
  }
  const returns: Array<{ node: EsTreeNode; propertyName: string }> = [];
  walkAst(selector.body, (candidate) => {
    if (candidate !== selector.body && isFunctionLike(candidate)) return false;
    if (!isNodeOfType(candidate, "ReturnStatement") || !candidate.argument) return;
    const propertyName = getDeepMutableStateProperty(candidate.argument, selector, context.scopes);
    if (propertyName) returns.push({ node: candidate.argument, propertyName });
  });
  return returns;
};

export const r3fNoDeepUseThreeSelector = defineRule({
  id: "r3f-no-deep-use-three-selector",
  title: "useThree selector reads a mutable Three.js field",
  severity: "warn",
  recommendation:
    "Select the stable R3F store object, then read its mutable Three.js fields where they are consumed",
  requires: ["r3f:3"],
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
          message: `This selector reads a mutable ${returnedValue.propertyName} field, but deep Three.js mutations do not update the R3F store. Select ${returnedValue.propertyName} itself and read the field at the point of use`,
        });
      }
    },
  }),
});
