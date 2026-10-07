import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES,
  PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES,
} from "./constants.js";
import { getInvalidPhysicalMaterialProperty } from "./utils/get-invalid-physical-material-property.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

const PHYSICAL_MATERIAL_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  ...PHYSICAL_MATERIAL_NORMALIZED_PROPERTY_NAMES,
  ...PHYSICAL_MATERIAL_IOR_PROPERTY_NAMES,
]);

export const r3fValidPhysicalMaterialProperties = defineRule({
  id: "r3f-valid-physical-material-properties",
  title: "Invalid R3F physical material property",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Keep meshPhysicalMaterial layer strengths and indices of refraction in their documented ranges",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          node.name.name !== "meshPhysicalMaterial" ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        for (const propertyName of PHYSICAL_MATERIAL_PROPERTY_NAMES) {
          const attribute = getAuthoritativeJsxAttribute(node.attributes, propertyName);
          if (
            !attribute?.value ||
            !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
            isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
          ) {
            continue;
          }
          const value = getStaticNumber(attribute.value.expression, context.scopes);
          if (value === null) continue;
          const invalidProperty = getInvalidPhysicalMaterialProperty(
            propertyName,
            value,
            attribute,
          );
          if (!invalidProperty) continue;
          context.report({
            node: attribute,
            message: `${propertyName} is ${String(value)}, but meshPhysicalMaterial requires ${propertyName} in [${String(invalidProperty.minimum)}, ${String(invalidProperty.maximum)}]`,
          });
        }
      },
    };
  },
});
