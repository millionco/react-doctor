import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { DEFAULT_TEXTURE_REPEAT } from "./constants.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";
import { isThreeRepeatingWrapping } from "./utils/is-three-repeating-wrapping.js";

interface TextureWrappingFact {
  readonly axis: "x" | "y";
  readonly node: EsTreeNode;
  readonly owner: EsTreeNode | null;
  readonly textureKey: string;
}

const THREE_TEXTURE_CONSTRUCTOR_NAMES: ReadonlySet<string> = new Set([
  "CanvasTexture",
  "CompressedTexture",
  "Data3DTexture",
  "DataArrayTexture",
  "DataTexture",
  "DepthTexture",
  "FramebufferTexture",
  "Texture",
  "VideoTexture",
]);

export const threeTextureRepeatRequiresWrapping = defineRule({
  id: "three-texture-repeat-requires-wrapping",
  title: "Three.js texture repeat without repeat wrapping",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Set wrapS or wrapT to RepeatWrapping or MirroredRepeatWrapping before increasing repeat on that axis",
  create: (context: RuleContext) => {
    const wrappingFacts: TextureWrappingFact[] = [];
    return {
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (
          node.operator !== "=" ||
          !isNodeOfType(node.left, "MemberExpression") ||
          !isThreeRepeatingWrapping(node.right, context.scopes)
        ) {
          return;
        }
        const propertyName = getStaticPropertyName(node.left);
        if (propertyName !== "wrapS" && propertyName !== "wrapT") return;
        const textureKey = resolveExpressionKey(node.left.object, context);
        if (!textureKey) return;
        wrappingFacts.push({
          axis: propertyName === "wrapS" ? "x" : "y",
          node,
          owner: findEnclosingFunction(node),
          textureKey,
        });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "set") {
          return;
        }
        const repeatMember = stripParenExpression(callee.object);
        if (
          !isNodeOfType(repeatMember, "MemberExpression") ||
          getStaticPropertyName(repeatMember) !== "repeat" ||
          !THREE_TEXTURE_CONSTRUCTOR_NAMES.has(
            getThreeConstructorName(repeatMember.object, context.scopes) ?? "",
          )
        ) {
          return;
        }
        const textureKey = resolveExpressionKey(repeatMember.object, context);
        const repeatStart = getRangeStart(node);
        if (!textureKey || repeatStart === null) return;
        const owner = findEnclosingFunction(node);
        const axisValues = [
          { axis: "x" as const, expression: node.arguments[0] },
          { axis: "y" as const, expression: node.arguments[1] },
        ];
        for (const { axis, expression } of axisValues) {
          if (!expression || isNodeOfType(expression, "SpreadElement")) continue;
          const value = getStaticNumber(expression, context.scopes);
          if (value === null || value <= DEFAULT_TEXTURE_REPEAT) continue;
          const hasWrapping = wrappingFacts.some((fact) => {
            const wrappingStart = getRangeStart(fact.node);
            return (
              fact.axis === axis &&
              fact.textureKey === textureKey &&
              fact.owner === owner &&
              wrappingStart !== null &&
              wrappingStart < repeatStart
            );
          });
          if (hasWrapping) continue;
          context.report({
            node: expression,
            message: `texture.repeat.${axis} is greater than one, but the corresponding ${axis === "x" ? "wrapS" : "wrapT"} remains ClampToEdgeWrapping so the texture will not tile on that axis`,
          });
        }
      },
    };
  },
});
