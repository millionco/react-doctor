import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface Ktx2LoaderCall {
  readonly loaderKey: string;
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly owner: EsTreeNode | null;
}

const KTX2_DETECT_SUPPORT_METHOD_NAMES: ReadonlySet<string> = new Set([
  "detectSupport",
  "detectSupportAsync",
]);
const KTX2_LOAD_METHOD_NAMES: ReadonlySet<string> = new Set(["load", "loadAsync"]);

export const threeRequireKtx2DetectSupport = defineRule({
  id: "three-require-ktx2-detect-support",
  title: "KTX2Loader used before renderer support detection",
  category: "Correctness",
  severity: "error",
  recommendation:
    "Call detectSupport(renderer), or await detectSupportAsync(renderer), before loading KTX2 textures",
  create: (context: RuleContext) => {
    const detectionCalls: Ktx2LoaderCall[] = [];
    const loadCalls: Ktx2LoaderCall[] = [];
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          getThreeConstructorName(node.callee.object, context.scopes) !== "KTX2Loader"
        ) {
          return;
        }
        const methodName = getStaticPropertyName(node.callee);
        const loaderKey = resolveExpressionKey(node.callee.object, context);
        if (!methodName || !loaderKey) return;
        const call = { loaderKey, node, owner: findEnclosingFunction(node) };
        if (KTX2_DETECT_SUPPORT_METHOD_NAMES.has(methodName)) detectionCalls.push(call);
        if (KTX2_LOAD_METHOD_NAMES.has(methodName)) loadCalls.push(call);
      },
      "Program:exit"() {
        for (const loadCall of loadCalls) {
          const loadStart = getRangeStart(loadCall.node);
          if (
            loadStart === null ||
            detectionCalls.some((detectionCall) => {
              const detectionStart = getRangeStart(detectionCall.node);
              return (
                detectionCall.loaderKey === loadCall.loaderKey &&
                detectionCall.owner === loadCall.owner &&
                detectionStart !== null &&
                detectionStart < loadStart
              );
            })
          ) {
            continue;
          }
          context.report({
            node: loadCall.node,
            message:
              "KTX2Loader must detect renderer texture-compression support before load or loadAsync chooses a transcode format",
          });
        }
      },
    };
  },
});
