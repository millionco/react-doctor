import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES } from "./constants.js";
import { getThreePropertyAssignment } from "./utils/get-three-property-assignment.js";

export const threeNoShadowsOnUnsupportedLight = defineRule({
  id: "three-no-shadows-on-unsupported-light",
  title: "Three.js light cannot cast shadows",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Use a DirectionalLight, PointLight, or SpotLight when the scene needs a shadow-casting light",
  create: (context: RuleContext) => ({
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      const assignment = getThreePropertyAssignment(node, context);
      if (
        assignment?.propertyName !== "castShadow" ||
        readStaticBoolean(assignment.value) !== true ||
        !UNSUPPORTED_SHADOW_LIGHT_CONSTRUCTOR_NAMES.has(assignment.constructorName)
      ) {
        return;
      }
      context.report({
        node,
        message: `${assignment.constructorName} has no direction and cannot cast shadows. Use a DirectionalLight, PointLight, or SpotLight for the shadow caster`,
      });
    },
  }),
});
