import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getExecutionReferenceOffset } from "./get-execution-reference-offset.js";
import {
  getFunctionSynchronousInvocationPathsBefore,
  isNodeOnUnconditionalPath,
} from "./has-static-property-write-before.js";

export interface HasSymbolWriteBeforeOptions {
  requireSynchronousWrite?: boolean;
  isSynchronousNode?: (node: EsTreeNode) => boolean;
}

export const getSymbolWriteExecutionPathsBefore = (
  writeIdentifier: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  options: HasSymbolWriteBeforeOptions = {},
): number[][] => {
  const writeFunction = findEnclosingFunction(writeIdentifier);
  const referenceFunction = findEnclosingFunction(referenceNode);
  if (writeFunction === referenceFunction) {
    if (
      writeIdentifier.range[0] >= getExecutionReferenceOffset(referenceNode) ||
      (options.requireSynchronousWrite &&
        (!writeFunction ||
          !isNodeOnUnconditionalPath(writeIdentifier, writeFunction) ||
          (options.isSynchronousNode !== undefined && !options.isSynchronousNode(writeIdentifier))))
    ) {
      return [];
    }
    return [[writeIdentifier.range[0]]];
  }
  if (!writeFunction) {
    return options.requireSynchronousWrite
      ? []
      : [[Number.NEGATIVE_INFINITY, writeIdentifier.range[0]]];
  }
  return options.requireSynchronousWrite
    ? getFunctionSynchronousInvocationPathsBefore(
        writeFunction,
        referenceNode,
        scopes,
        new Set(),
        writeIdentifier,
        options.isSynchronousNode,
      ).map((invocationPath) => [...invocationPath, writeIdentifier.range[0]])
    : getFunctionSynchronousInvocationPathsBefore(writeFunction, referenceNode, scopes).map(
        (invocationPath) => [...invocationPath, writeIdentifier.range[0]],
      );
};

export const isSymbolWriteBefore = (
  writeIdentifier: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  options: HasSymbolWriteBeforeOptions = {},
): boolean =>
  getSymbolWriteExecutionPathsBefore(writeIdentifier, referenceNode, scopes, options).length > 0;

export const hasSymbolWriteBefore = (
  symbol: SymbolDescriptor,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  options: HasSymbolWriteBeforeOptions = {},
): boolean =>
  symbol.references.some((reference) => {
    if (reference.flag === "read") return false;
    return isSymbolWriteBefore(reference.identifier, referenceNode, scopes, options);
  });
