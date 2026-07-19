import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getLoaderCacheTerminalPropertyName,
  resolvesToLoaderCacheValue,
} from "./utils/resolve-loader-cache-provenance.js";

const DESTRUCTIVE_METHOD_NAMES = new Set([
  "add",
  "applyMatrix4",
  "center",
  "clear",
  "remove",
  "removeFromParent",
  "rotateX",
  "rotateY",
  "rotateZ",
  "setValues",
  "translate",
]);
const DESTRUCTIVE_PROPERTY_NAMES = new Set(["geometry", "material", "parent"]);
const MUTABLE_DESCENDANT_PROPERTY_NAMES = new Set([
  "center",
  "color",
  "emissive",
  "normalScale",
  "offset",
  "position",
  "quaternion",
  "repeat",
  "rotation",
  "scale",
  "up",
]);
const MUTABLE_SCALAR_PROPERTY_NAMES = new Set([
  "anisotropy",
  "castShadow",
  "colorSpace",
  "depthTest",
  "depthWrite",
  "flipY",
  "frustumCulled",
  "intensity",
  "magFilter",
  "metalness",
  "minFilter",
  "needsUpdate",
  "opacity",
  "receiveShadow",
  "renderOrder",
  "roughness",
  "side",
  "transparent",
  "visible",
  "wireframe",
  "wrapS",
  "wrapT",
]);
const MUTABLE_DESCENDANT_METHOD_NAMES = new Set([
  "copy",
  "lerp",
  "lerpVectors",
  "set",
  "setScalar",
  "slerp",
  "slerpQuaternions",
]);
const REPARENTING_METHOD_NAMES = new Set(["add", "attach", "remove"]);

export const r3fNoMutateLoaderCache = defineRule({
  id: "r3f-no-mutate-loader-cache",
  title: "Mutation of a cached R3F loader asset",
  category: "Correctness",
  severity: "warn",
  recommendation: "Clone the loaded object or resource before mutating it",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      const methodName = getStaticPropertyName(node.callee);
      const receiverPropertyName = getLoaderCacheTerminalPropertyName(
        node.callee.object,
        context.scopes,
      );
      if (!methodName) return;
      const mutatesCachedReceiver =
        (DESTRUCTIVE_METHOD_NAMES.has(methodName) ||
          (MUTABLE_DESCENDANT_METHOD_NAMES.has(methodName) &&
            receiverPropertyName !== null &&
            MUTABLE_DESCENDANT_PROPERTY_NAMES.has(receiverPropertyName))) &&
        resolvesToLoaderCacheValue(node.callee.object, context.scopes);
      if (mutatesCachedReceiver) {
        context.report({
          node,
          message: `This ${methodName}() call mutates an asset shared by the R3F loader cache. Clone the loaded object or resource before mutating it`,
        });
        return;
      }
      if (!REPARENTING_METHOD_NAMES.has(methodName)) return;
      for (const argument of node.arguments) {
        if (
          isNodeOfType(argument, "SpreadElement") ||
          !resolvesToLoaderCacheValue(argument, context.scopes)
        ) {
          continue;
        }
        context.report({
          node: argument,
          message:
            "This reparents an object shared by the R3F loader cache. Clone the loaded object before attaching it to an imperative parent",
        });
      }
    },
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      if (!isNodeOfType(node.left, "MemberExpression")) return;
      const propertyName = getStaticPropertyName(node.left);
      const receiverPropertyName = getLoaderCacheTerminalPropertyName(
        node.left.object,
        context.scopes,
      );
      if (
        !propertyName ||
        (!DESTRUCTIVE_PROPERTY_NAMES.has(propertyName) &&
          !MUTABLE_SCALAR_PROPERTY_NAMES.has(propertyName) &&
          !(receiverPropertyName && MUTABLE_DESCENDANT_PROPERTY_NAMES.has(receiverPropertyName))) ||
        !resolvesToLoaderCacheValue(node.left.object, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message: `This assignment mutates the ${propertyName} property of an asset shared by the R3F loader cache. Clone the loaded object or resource before mutating it`,
      });
    },
  }),
});
