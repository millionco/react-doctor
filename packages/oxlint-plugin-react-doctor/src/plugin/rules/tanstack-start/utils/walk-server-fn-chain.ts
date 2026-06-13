import {
  TANSTACK_INPUT_VALIDATOR_METHOD_NAMES,
  TANSTACK_SERVER_FN_NAMES,
} from "../../../constants/tanstack.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getCalleeName } from "../../../utils/get-callee-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export interface ServerFnChainInfo {
  isServerFnChain: boolean;
  specifiedMethod: string | null;
  hasInputValidation: boolean;
}

export const walkServerFnChain = (outerNode: EsTreeNode): ServerFnChainInfo => {
  const result: ServerFnChainInfo = {
    isServerFnChain: false,
    specifiedMethod: null,
    hasInputValidation: false,
  };

  if (!isNodeOfType(outerNode, "CallExpression")) return result;
  if (!isNodeOfType(outerNode.callee, "MemberExpression")) return result;
  let currentNode: EsTreeNode = outerNode.callee.object;

  while (isNodeOfType(currentNode, "CallExpression")) {
    const calleeName = getCalleeName(currentNode);

    if (calleeName && TANSTACK_SERVER_FN_NAMES.has(calleeName)) {
      result.isServerFnChain = true;

      const optionsArgument = currentNode.arguments?.[0];
      if (isNodeOfType(optionsArgument, "ObjectExpression")) {
        for (const property of optionsArgument.properties ?? []) {
          if (
            isNodeOfType(property, "Property") &&
            isNodeOfType(property.key, "Identifier") &&
            property.key.name === "method" &&
            isNodeOfType(property.value, "Literal") &&
            typeof property.value.value === "string"
          ) {
            result.specifiedMethod = property.value.value;
          }
        }
      }
    }

    if (calleeName && TANSTACK_INPUT_VALIDATOR_METHOD_NAMES.has(calleeName)) {
      result.hasInputValidation = true;
    }

    if (isNodeOfType(currentNode.callee, "MemberExpression")) {
      currentNode = currentNode.callee.object;
    } else {
      break;
    }
  }

  return result;
};
