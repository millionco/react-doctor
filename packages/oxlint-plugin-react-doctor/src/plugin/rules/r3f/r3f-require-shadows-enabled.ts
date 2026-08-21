import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES } from "./constants.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCanvas } from "./utils/is-r3f-canvas.js";
import { isR3fHostIntrinsic } from "./utils/is-r3f-host-intrinsic.js";
import { readStaticJsxBooleanAttribute } from "./utils/read-static-jsx-boolean-attribute.js";

const SHADOW_OBJECT_PROPERTY_NAMES: ReadonlySet<string> = new Set(["castShadow", "receiveShadow"]);
const R3F_UNSUPPORTED_SHADOW_LIGHT_NAMES: ReadonlySet<string> = new Set(
  [...UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES].map(
    (constructorName) => `${constructorName[0]?.toLowerCase()}${constructorName.slice(1)}`,
  ),
);

export const r3fRequireShadowsEnabled = defineRule({
  id: "r3f-require-shadows-enabled",
  title: "R3F shadow caster without Canvas shadow maps",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Enable the Canvas shadows prop when descendants cast or receive real-time shadows",
  create: (context: RuleContext) => {
    const shadowUsersByCanvas = new Map<
      EsTreeNodeOfType<"JSXOpeningElement">,
      EsTreeNodeOfType<"JSXOpeningElement">
    >();
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementType = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
        if (
          !importsReactThreeFiber ||
          !isR3fHostIntrinsic(node) ||
          (elementType !== null && R3F_UNSUPPORTED_SHADOW_LIGHT_NAMES.has(elementType)) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const usesShadows = [...SHADOW_OBJECT_PROPERTY_NAMES].some((propertyName) => {
          const attribute = getAuthoritativeJsxAttribute(node.attributes, propertyName);
          return attribute ? readStaticJsxBooleanAttribute(attribute) === true : false;
        });
        if (!usesShadows) return;
        let ancestor = node.parent?.parent ?? null;
        while (ancestor) {
          if (
            isNodeOfType(ancestor, "JSXElement") &&
            isR3fCanvas(ancestor.openingElement, context)
          ) {
            shadowUsersByCanvas.set(ancestor.openingElement, node);
            return;
          }
          ancestor = ancestor.parent ?? null;
        }
      },
      "Program:exit"() {
        for (const [canvas, shadowUser] of shadowUsersByCanvas) {
          if (
            canvas.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")) ||
            getAuthoritativeJsxAttribute(canvas.attributes, "gl") ||
            getAuthoritativeJsxAttribute(canvas.attributes, "onCreated") ||
            (() => {
              const shadowsAttribute = getAuthoritativeJsxAttribute(canvas.attributes, "shadows");
              return shadowsAttribute
                ? readStaticJsxBooleanAttribute(shadowsAttribute) !== false
                : false;
            })()
          ) {
            continue;
          }
          context.report({
            node: shadowUser,
            message:
              "This object enables castShadow or receiveShadow, but its Canvas leaves shadow maps disabled. Add the Canvas shadows prop",
          });
        }
      },
    };
  },
});
