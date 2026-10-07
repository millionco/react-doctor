import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import {
  DATA_TEXTURE_DATA_ARGUMENT_INDEX,
  DATA_TEXTURE_DEPTH_ARGUMENT_INDEX,
  DATA_TEXTURE_FORMAT_ARGUMENT_INDEX,
  DATA_TEXTURE_HEIGHT_ARGUMENT_INDEX,
  DATA_TEXTURE_WIDTH_ARGUMENT_INDEX,
  DATA_VOLUME_TEXTURE_FORMAT_ARGUMENT_INDEX,
} from "../constants.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";

export interface DataTextureConstructorShape {
  readonly data: EsTreeNode | null;
  readonly depth: EsTreeNode | null;
  readonly format: EsTreeNode | null;
  readonly height: EsTreeNode | null;
  readonly node: EsTreeNodeOfType<"NewExpression">;
  readonly width: EsTreeNode | null;
}

const getArgument = (
  node: EsTreeNodeOfType<"NewExpression">,
  argumentIndex: number,
): EsTreeNode | null => {
  const argument = node.arguments[argumentIndex];
  return argument && !isNodeOfType(argument, "SpreadElement") ? argument : null;
};

export const getDataTextureConstructorShape = (
  node: EsTreeNodeOfType<"NewExpression">,
  context: RuleContext,
): DataTextureConstructorShape | null => {
  const provenance = getApiReferenceProvenance(node.callee, context.scopes);
  if (!provenance || !isThreeModuleSource(provenance.moduleSource)) return null;
  const isVolume =
    provenance.apiName === "Data3DTexture" || provenance.apiName === "DataArrayTexture";
  if (!isVolume && provenance.apiName !== "DataTexture") return null;
  return {
    data: getArgument(node, DATA_TEXTURE_DATA_ARGUMENT_INDEX),
    depth: isVolume ? getArgument(node, DATA_TEXTURE_DEPTH_ARGUMENT_INDEX) : null,
    format: getArgument(
      node,
      isVolume ? DATA_VOLUME_TEXTURE_FORMAT_ARGUMENT_INDEX : DATA_TEXTURE_FORMAT_ARGUMENT_INDEX,
    ),
    height: getArgument(node, DATA_TEXTURE_HEIGHT_ARGUMENT_INDEX),
    node,
    width: getArgument(node, DATA_TEXTURE_WIDTH_ARGUMENT_INDEX),
  };
};
