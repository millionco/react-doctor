import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { isIntrinsicElementRefReceiver } from "./is-intrinsic-element-ref-receiver.js";

export const isMediaElementRefReceiver = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  receiverCache?: WeakMap<SymbolDescriptor, boolean>,
): boolean =>
  isIntrinsicElementRefReceiver(expression, scopes, {
    receiverCache,
    allowsAttachment: (element) => {
      const elementName = resolveJsxElementType(element);
      return elementName === "audio" || elementName === "video";
    },
  });
