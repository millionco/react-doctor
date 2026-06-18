import type { SimplifiableFunctionKind } from "../types.js";
import { MAX_AST_WALK_DEPTH } from "../constants.js";
import { detectSimplifiableFunctionPatterns } from "./detect-simplifiable-function.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

export interface SimplifiableFunctionCapture {
  kind: SimplifiableFunctionKind;
  functionName?: string;
  startOffset: number;
  reason: string;
  suggestion: string;
}

const looksLikeFunction = (node: OxcAstNode): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const inferFunctionName = (
  functionNode: OxcAstNode,
  parentContext: string | undefined,
): string | undefined => {
  const declaredId = (functionNode as { id?: { name?: string } }).id;
  if (declaredId?.name) return declaredId.name;
  return parentContext;
};

const visitFunctionAndDescend = (
  functionNode: OxcAstNode,
  captures: SimplifiableFunctionCapture[],
  contextName: string | undefined,
  recursionDepth: number,
  isMethodContext: boolean,
  isInlineCallback: boolean,
): void => {
  const functionName = inferFunctionName(functionNode, contextName);
  const detections = detectSimplifiableFunctionPatterns(functionNode, {
    isMethodContext,
    isInlineCallback,
  });
  for (const detection of detections) {
    captures.push({
      kind: detection.kind,
      functionName,
      startOffset: detection.startOffset,
      reason: detection.reason,
      suggestion: detection.suggestion,
    });
  }
  const bodyNode = (functionNode as { body?: OxcAstNode }).body;
  if (isOxcAstNode(bodyNode))
    walkForFunctions(bodyNode, captures, functionName, recursionDepth + 1);
  const parameters = (functionNode as { params?: unknown[] }).params ?? [];
  for (const parameter of parameters) {
    if (isOxcAstNode(parameter))
      walkForFunctions(parameter, captures, functionName, recursionDepth + 1);
  }
};

const isObjectMethodShorthand = (node: OxcAstNode): boolean =>
  (node.type === "Property" || node.type === "ObjectProperty") &&
  (node as { method?: boolean }).method === true;

const isObjectPropertyAssignment = (node: OxcAstNode): boolean =>
  (node.type === "Property" || node.type === "ObjectProperty") &&
  (node as { method?: boolean }).method !== true;

const isCallOrNewExpression = (node: OxcAstNode): boolean =>
  node.type === "CallExpression" || node.type === "NewExpression";

const walkForFunctions = (
  node: OxcAstNode,
  captures: SimplifiableFunctionCapture[],
  contextName: string | undefined,
  recursionDepth: number = 0,
): void => {
  if (recursionDepth > MAX_AST_WALK_DEPTH) return;
  if (looksLikeFunction(node)) {
    visitFunctionAndDescend(node, captures, contextName, recursionDepth, false, false);
    return;
  }

  let nextContext = contextName;
  if (node.type === "VariableDeclarator") {
    const declaredName = getIdentifierName((node as { id?: unknown }).id);
    if (declaredName) nextContext = declaredName;
  }
  if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") {
    const propertyKeyName = getIdentifierName((node as { key?: unknown }).key);
    if (propertyKeyName) nextContext = propertyKeyName;
  }
  if (node.type === "ClassDeclaration") {
    const className = getIdentifierName((node as { id?: unknown }).id);
    if (className) nextContext = className;
  }

  const isMethodDefining = node.type === "MethodDefinition" || isObjectMethodShorthand(node);
  if (isMethodDefining) {
    const methodValue = (node as { value?: OxcAstNode }).value;
    if (methodValue && isOxcAstNode(methodValue) && looksLikeFunction(methodValue)) {
      const methodKeyName = getIdentifierName((node as { key?: unknown }).key);
      const methodContextName = methodKeyName ?? nextContext;
      visitFunctionAndDescend(
        methodValue,
        captures,
        methodContextName,
        recursionDepth + 1,
        true,
        false,
      );
      const keyNode = (node as { key?: OxcAstNode }).key;
      if (keyNode && isOxcAstNode(keyNode) && (node as { computed?: boolean }).computed) {
        walkForFunctions(keyNode, captures, nextContext, recursionDepth + 1);
      }
      return;
    }
  }

  if (isObjectPropertyAssignment(node)) {
    const propertyValue = (node as { value?: OxcAstNode }).value;
    if (propertyValue && isOxcAstNode(propertyValue) && looksLikeFunction(propertyValue)) {
      const propertyKeyName = getIdentifierName((node as { key?: unknown }).key);
      const propertyContextName = propertyKeyName ?? nextContext;
      visitFunctionAndDescend(
        propertyValue,
        captures,
        propertyContextName,
        recursionDepth + 1,
        false,
        true,
      );
      const keyNode = (node as { key?: OxcAstNode }).key;
      if (keyNode && isOxcAstNode(keyNode) && (node as { computed?: boolean }).computed) {
        walkForFunctions(keyNode, captures, nextContext, recursionDepth + 1);
      }
      return;
    }
  }

  if (isCallOrNewExpression(node)) {
    const callee = (node as { callee?: OxcAstNode }).callee;
    if (callee && isOxcAstNode(callee)) {
      walkForFunctions(callee, captures, nextContext, recursionDepth + 1);
    }
    const callArguments = (node as { arguments?: unknown[] }).arguments ?? [];
    for (const argument of callArguments) {
      if (!isOxcAstNode(argument)) continue;
      if (looksLikeFunction(argument)) {
        visitFunctionAndDescend(argument, captures, nextContext, recursionDepth + 1, false, true);
      } else {
        walkForFunctions(argument, captures, nextContext, recursionDepth + 1);
      }
    }
    return;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (isOxcAstNode(element))
          walkForFunctions(element, captures, nextContext, recursionDepth + 1);
      }
    } else if (isOxcAstNode(value)) {
      walkForFunctions(value, captures, nextContext, recursionDepth + 1);
    }
  }
};

export const collectSimplifiableFunctions = (
  programBody: unknown[],
): SimplifiableFunctionCapture[] => {
  const captures: SimplifiableFunctionCapture[] = [];
  for (const statement of programBody) {
    if (isOxcAstNode(statement)) walkForFunctions(statement, captures, undefined, 0);
  }
  return captures;
};
