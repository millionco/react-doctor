import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  MAXIMUM_NORMALIZED_MATERIAL_FACTOR,
  MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES,
  MINIMUM_NORMALIZED_MATERIAL_FACTOR,
} from "./constants.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

const R3F_PBR_MATERIAL_NAMES: ReadonlySet<string> = new Set([
  "meshPhysicalMaterial",
  "meshStandardMaterial",
]);

export const r3fValidPbrMaterialProperties = defineRule({
  id: "r3f-valid-pbr-material-properties",
  title: "R3F PBR material factor outside its normalized range",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Keep meshStandardMaterial and meshPhysicalMaterial roughness and metalness in [0, 1]",
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
          !R3F_PBR_MATERIAL_NAMES.has(node.name.name) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        for (const propertyName of MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES) {
          const attribute = getAuthoritativeJsxAttribute(node.attributes, propertyName);
          if (
            !attribute?.value ||
            !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
            isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
          ) {
            continue;
          }
          const value = getStaticNumber(attribute.value.expression, context.scopes);
          if (
            value === null ||
            (value >= MINIMUM_NORMALIZED_MATERIAL_FACTOR &&
              value <= MAXIMUM_NORMALIZED_MATERIAL_FACTOR)
          ) {
            continue;
          }
          context.report({
            node: attribute,
            message: `${propertyName} is ${String(value)}, but Three.js PBR material factors use the normalized [0, 1] range`,
          });
        }
      },
    };
  },
});
