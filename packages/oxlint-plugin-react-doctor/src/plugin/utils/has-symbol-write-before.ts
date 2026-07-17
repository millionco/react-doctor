import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import {
  isFunctionSynchronouslyInvokedBefore,
  isNodeOnUnconditionalPath,
} from "./has-static-property-write-before.js";

export interface HasSymbolWriteBeforeOptions {
  requireSynchronousWrite?: boolean;
}

export const hasSymbolWriteBefore = (
  symbol: SymbolDescriptor,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  options: HasSymbolWriteBeforeOptions = {},
): boolean =>
  symbol.references.some((reference) => {
    if (reference.flag === "read") return false;
    const writeFunction = findEnclosingFunction(reference.identifier);
    const referenceFunction = findEnclosingFunction(referenceNode);
    if (writeFunction === referenceFunction) {
      return (
        reference.identifier.range[0] < referenceNode.range[0] &&
        (!options.requireSynchronousWrite ||
          Boolean(writeFunction && isNodeOnUnconditionalPath(reference.identifier, writeFunction)))
      );
    }
    if (!writeFunction) return true;
    return options.requireSynchronousWrite
      ? isFunctionSynchronouslyInvokedBefore(
          writeFunction,
          referenceNode,
          scopes,
          new Set(),
          reference.identifier,
        )
      : isFunctionSynchronouslyInvokedBefore(writeFunction, referenceNode, scopes);
  });
