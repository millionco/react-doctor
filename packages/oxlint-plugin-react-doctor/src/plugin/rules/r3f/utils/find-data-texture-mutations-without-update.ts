import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { doNodesCoverEveryPathAfterNode } from "../../../utils/do-nodes-cover-every-path-after-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveExpressionKey } from "../../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import {
  getDataTextureMutationReceiver,
  resolvesToDataTexture,
} from "./get-data-texture-mutation-receiver.js";
import { getNeedsUpdateReceiver } from "./get-needs-update-receiver.js";
import { walkFunctionExecution } from "./walk-function-execution.js";

interface TextureMutation {
  readonly node: EsTreeNode;
  readonly textureKey: string;
}

interface TextureUpdate {
  readonly node: EsTreeNode;
  readonly textureKey: string;
}

export const findDataTextureMutationsWithoutUpdate = (
  callback: EsTreeNode,
  context: RuleContext,
  managedDataTextureRefSymbolIds: ReadonlySet<number> = new Set(),
): ReadonlyArray<EsTreeNode> => {
  const mutations: TextureMutation[] = [];
  const updates: TextureUpdate[] = [];
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    const mutationReceiver = getDataTextureMutationReceiver(
      candidate,
      context.scopes,
      managedDataTextureRefSymbolIds,
    );
    const mutationKey = mutationReceiver ? resolveExpressionKey(mutationReceiver, context) : null;
    if (mutationKey) mutations.push({ node: candidate, textureKey: mutationKey });
    if (!isNodeOfType(candidate, "AssignmentExpression")) return;
    const updateReceiver = getNeedsUpdateReceiver(candidate);
    if (
      !updateReceiver ||
      !resolvesToDataTexture(updateReceiver, context.scopes, managedDataTextureRefSymbolIds)
    ) {
      return;
    }
    const updateKey = resolveExpressionKey(updateReceiver, context);
    if (updateKey) updates.push({ node: candidate, textureKey: updateKey });
  });
  return mutations
    .filter((mutation) => {
      const matchingUpdates = updates.filter((update) => update.textureKey === mutation.textureKey);
      return !doNodesCoverEveryPathAfterNode(
        mutation.node,
        matchingUpdates.map((update) => update.node),
        context,
      );
    })
    .map((mutation) => mutation.node);
};
