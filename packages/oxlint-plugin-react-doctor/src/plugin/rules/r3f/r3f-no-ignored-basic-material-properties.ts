import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES } from "./constants.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

export const r3fNoIgnoredBasicMaterialProperties = defineRule({
  id: "r3f-no-ignored-basic-material-properties",
  title: "PBR prop ignored by R3F meshBasicMaterial",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use meshStandardMaterial or meshPhysicalMaterial when a mesh needs roughness or metalness",
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
          node.name.name !== "meshBasicMaterial"
        ) {
          return;
        }
        for (const propertyName of MESH_BASIC_MATERIAL_IGNORED_PBR_PROPERTY_NAMES) {
          const attribute = getAuthoritativeJsxAttribute(node.attributes, propertyName);
          if (!attribute) continue;
          context.report({
            node: attribute,
            message: `meshBasicMaterial ignores ${propertyName} because it is not a PBR material. Use meshStandardMaterial or meshPhysicalMaterial for this prop`,
          });
        }
      },
    };
  },
});
