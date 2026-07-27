import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type { AssignmentNode, Path } from "@shaderfrog/glsl-parser/ast/index.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  resolveStaticThreeShaderMaterial,
  type StaticThreeShaderStage,
} from "./utils/resolve-static-three-shader-material.js";

const FRAGMENT_DEPTH_OUTPUT_NAMES: ReadonlySet<string> = new Set([
  "gl_FragDepth",
  "gl_FragDepthEXT",
]);
const CONDITIONAL_NODE_TYPES: ReadonlySet<string> = new Set([
  "do_statement",
  "for_statement",
  "if_statement",
  "switch_statement",
  "ternary",
  "while_statement",
]);

const isDefaultFragmentDepthAssignment = (node: AssignmentNode): boolean => {
  if (
    node.operator.literal !== "=" ||
    node.left.type !== "identifier" ||
    !FRAGMENT_DEPTH_OUTPUT_NAMES.has(node.left.identifier) ||
    node.right.type !== "postfix" ||
    node.right.expression.type !== "identifier" ||
    node.right.expression.identifier !== "gl_FragCoord" ||
    node.right.postfix.type !== "field_selection"
  ) {
    return false;
  }
  return Reflect.get(node.right.postfix.selection, "identifier") === "z";
};

const isUnconditionalMainAssignment = (path: Path<AssignmentNode>): boolean => {
  let currentPath = path.parentPath;
  while (currentPath) {
    if (CONDITIONAL_NODE_TYPES.has(currentPath.node.type)) return false;
    if (currentPath.node.type === "binary") {
      const operator = currentPath.node.operator.literal;
      if (operator === "&&" || operator === "||") return false;
    }
    if (currentPath.node.type === "function") {
      return currentPath.node.prototype.header.name.identifier === "main";
    }
    currentPath = currentPath.parentPath;
  }
  return false;
};

const checkShader = (shader: StaticThreeShaderStage, context: RuleContext): void => {
  const depthAssignments: Array<Path<AssignmentNode>> = [];
  visit(shader.program, {
    assignment: {
      enter: (path) => {
        if (
          path.node.left.type === "identifier" &&
          FRAGMENT_DEPTH_OUTPUT_NAMES.has(path.node.left.identifier)
        ) {
          depthAssignments.push(path);
        }
      },
    },
  });
  if (
    depthAssignments.length !== 1 ||
    !isDefaultFragmentDepthAssignment(depthAssignments[0].node) ||
    !isUnconditionalMainAssignment(depthAssignments[0])
  ) {
    return;
  }
  const assignment = depthAssignments[0].node;
  context.report({
    node: shader.source.getOriginNodeAtOffset(assignment.location?.start.offset ?? 0),
    message:
      "This shader unconditionally writes the fixed-function depth value back to gl_FragDepth. Remove the redundant write so early depth testing remains available",
  });
};

export const threeShaderNoRedundantFragDepth = defineRule({
  id: "three-shader-no-redundant-frag-depth",
  title: "Shader redundantly writes fragment depth",
  category: "Performance",
  severity: "warn",
  recommendation: "Let fixed-function depth supply gl_FragCoord.z when depth is unchanged",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      const material = resolveStaticThreeShaderMaterial(node, context);
      if (material?.fragmentShader) checkShader(material.fragmentShader, context);
    },
  }),
});
