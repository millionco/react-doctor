import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { DEFAULT_TEXTURE_REPEAT } from "./constants.js";
import { getJsxAttributeExpression } from "./utils/get-jsx-attribute-expression.js";
import { getStaticNumberArray } from "./utils/get-static-number-array.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isThreeRepeatingWrapping } from "./utils/is-three-repeating-wrapping.js";

const R3F_TEXTURE_NAMES: ReadonlySet<string> = new Set([
  "canvasTexture",
  "compressedTexture",
  "data3DTexture",
  "dataArrayTexture",
  "dataTexture",
  "depthTexture",
  "framebufferTexture",
  "texture",
  "videoTexture",
]);

export const r3fTextureRepeatRequiresWrapping = defineRule({
  id: "r3f-texture-repeat-requires-wrapping",
  title: "R3F texture repeat without repeat wrapping",
  category: "Correctness",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Set wrapS or wrapT to RepeatWrapping or MirroredRepeatWrapping when increasing repeat on that axis",
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
          !R3F_TEXTURE_NAMES.has(node.name.name) ||
          node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
        ) {
          return;
        }
        const repeatExpression = getJsxAttributeExpression(node, "repeat");
        if (!repeatExpression) return;
        const repeatValues = getStaticNumberArray(repeatExpression, context.scopes);
        if (!repeatValues) return;
        const wrappingExpressions = [
          getJsxAttributeExpression(node, "wrapS"),
          getJsxAttributeExpression(node, "wrapT"),
        ];
        for (const [index, repeatValue] of repeatValues.slice(0, 2).entries()) {
          if (repeatValue <= DEFAULT_TEXTURE_REPEAT) continue;
          const wrappingExpression = wrappingExpressions[index];
          if (wrappingExpression && isThreeRepeatingWrapping(wrappingExpression, context.scopes)) {
            continue;
          }
          context.report({
            node: repeatExpression,
            message: `Texture repeat on the ${index === 0 ? "x" : "y"} axis is greater than one without matching ${index === 0 ? "wrapS" : "wrapT"} repeat wrapping, so the texture will not tile on that axis`,
          });
        }
      },
    };
  },
});
