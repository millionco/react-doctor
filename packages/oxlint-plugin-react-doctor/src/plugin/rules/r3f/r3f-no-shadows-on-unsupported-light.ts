import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES } from "./constants.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { readStaticJsxBooleanAttribute } from "./utils/read-static-jsx-boolean-attribute.js";

const R3F_UNSUPPORTED_SHADOW_LIGHT_NAMES: ReadonlySet<string> = new Set(
  [...UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES].map(
    (constructorName) => `${constructorName[0]?.toLowerCase()}${constructorName.slice(1)}`,
  ),
);

export const r3fNoShadowsOnUnsupportedLight = defineRule({
  id: "r3f-no-shadows-on-unsupported-light",
  title: "R3F light cannot cast shadows",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use a directional, point, or spot light when the scene needs a shadow-casting light",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementType = resolveJsxElementType(node);
        if (
          !importsReactThreeFiber ||
          !isR3fHostIntrinsic(node) ||
          !elementType ||
          !R3F_UNSUPPORTED_SHADOW_LIGHT_NAMES.has(elementType)
        ) {
          return;
        }
        const castShadowAttribute = getAuthoritativeJsxAttribute(node.attributes, "castShadow");
        if (!castShadowAttribute || readStaticJsxBooleanAttribute(castShadowAttribute) !== true) {
          return;
        }
        context.report({
          node: castShadowAttribute,
          message: `${elementType} has no direction and cannot cast shadows. Use a directionalLight, pointLight, or spotLight for the shadow caster`,
        });
      },
    };
  },
});
