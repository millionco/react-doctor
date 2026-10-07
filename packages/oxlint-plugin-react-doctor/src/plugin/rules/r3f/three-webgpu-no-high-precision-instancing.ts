import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../utils/read-static-boolean.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface HighPrecisionAssignment {
  readonly node: EsTreeNodeOfType<"AssignmentExpression">;
  readonly rendererKey: string;
}

interface IncompatibleSceneRoot {
  readonly node: EsTreeNode;
  readonly rootKey: string;
}

interface RendererSceneRender {
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly rendererKey: string;
  readonly rootKey: string;
}

const HIGH_PRECISION_INCOMPATIBLE_OBJECT_NAMES: ReadonlySet<string> = new Set([
  "InstancedMesh",
  "SkinnedMesh",
]);

export const threeWebgpuNoHighPrecisionInstancing = defineRule({
  id: "three-webgpu-no-high-precision-instancing",
  title: "WebGPU high precision conflicts with instanced meshes",
  category: "Correctness",
  requires: ["three:181"],
  severity: "error",
  recommendation:
    "Disable renderer.highPrecision when rendering InstancedMesh or SkinnedMesh objects",
  create: (context: RuleContext) => {
    const assignments: HighPrecisionAssignment[] = [];
    const incompatibleRoots: IncompatibleSceneRoot[] = [];
    const renders: RendererSceneRender[] = [];
    return {
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const target = stripParenExpression(node.left);
        if (
          node.operator !== "=" ||
          readStaticBoolean(node.right) !== true ||
          !isNodeOfType(target, "MemberExpression") ||
          getStaticPropertyName(target) !== "highPrecision" ||
          getThreeConstructorName(target.object, context.scopes) !== "WebGPURenderer"
        ) {
          return;
        }
        const rendererKey = resolveExpressionKey(target.object, context);
        if (rendererKey) assignments.push({ node, rendererKey });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "MemberExpression")) return;
        const methodName = getStaticPropertyName(callee);
        if (
          methodName === "add" &&
          getThreeConstructorName(callee.object, context.scopes) === "Scene"
        ) {
          const rootKey = resolveExpressionKey(callee.object, context);
          if (!rootKey) return;
          for (const argument of node.arguments) {
            if (
              !isNodeOfType(argument, "SpreadElement") &&
              HIGH_PRECISION_INCOMPATIBLE_OBJECT_NAMES.has(
                getThreeConstructorName(argument, context.scopes) ?? "",
              )
            ) {
              incompatibleRoots.push({ node: argument, rootKey });
            }
          }
          return;
        }
        if (
          methodName !== "render" ||
          getThreeConstructorName(callee.object, context.scopes) !== "WebGPURenderer"
        ) {
          return;
        }
        const renderedRoot = node.arguments[0];
        if (!renderedRoot || isNodeOfType(renderedRoot, "SpreadElement")) return;
        const rendererKey = resolveExpressionKey(callee.object, context);
        const rootKey = resolveExpressionKey(renderedRoot, context);
        if (!rendererKey || !rootKey) return;
        renders.push({ node, rendererKey, rootKey });
        if (
          HIGH_PRECISION_INCOMPATIBLE_OBJECT_NAMES.has(
            getThreeConstructorName(renderedRoot, context.scopes) ?? "",
          )
        ) {
          incompatibleRoots.push({ node: renderedRoot, rootKey });
        }
      },
      "Program:exit"() {
        for (const assignment of assignments) {
          const assignmentStart = getRangeStart(assignment.node);
          const incompatibleRender = renders.find((render) => {
            const renderStart = getRangeStart(render.node);
            return Boolean(
              render.rendererKey === assignment.rendererKey &&
              assignmentStart !== null &&
              renderStart !== null &&
              assignmentStart < renderStart &&
              incompatibleRoots.some((root) => root.rootKey === render.rootKey),
            );
          });
          if (!incompatibleRender) continue;
          context.report({
            node: assignment.node,
            message:
              "WebGPURenderer highPrecision uses CPU 64-bit matrices that Three.js does not support with InstancedMesh or SkinnedMesh objects rendered by this renderer",
          });
        }
      },
    };
  },
});
