import type { InlineTypeContext } from "../types.js";
import {
  INLINE_TYPE_PREVIEW_KEYS,
  MAX_AST_WALK_DEPTH,
  MAX_TYPE_REFERENCE_WALK_DEPTH,
  MIN_PROPERTIES_FOR_INLINE_TYPE_LITERAL,
} from "../constants.js";
import { normalizeTypeAstHash } from "./normalize-type-hash.js";
import { getIdentifierName, isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

export interface InlineTypeLiteralCapture {
  structuralHash: string;
  memberCount: number;
  preview: string;
  context: InlineTypeContext;
  nearestName?: string;
  startOffset: number;
}

const isTypeLiteralNode = (node: OxcAstNode): boolean => node.type === "TSTypeLiteral";

const buildPreview = (typeLiteralNode: OxcAstNode): string => {
  const members = (typeLiteralNode.members as unknown[]) ?? [];
  const propertyKeys: string[] = [];
  for (const memberCandidate of members) {
    if (!isOxcAstNode(memberCandidate)) continue;
    if (memberCandidate.type !== "TSPropertySignature") continue;
    const keyNode = memberCandidate.key as { name?: string; value?: string } | undefined;
    const keyName = keyNode?.name ?? keyNode?.value;
    if (keyName) propertyKeys.push(String(keyName));
  }
  propertyKeys.sort();
  const truncatedKeys = propertyKeys.slice(0, INLINE_TYPE_PREVIEW_KEYS);
  const suffix =
    propertyKeys.length > INLINE_TYPE_PREVIEW_KEYS
      ? `, +${propertyKeys.length - INLINE_TYPE_PREVIEW_KEYS} more`
      : "";
  return `{ ${truncatedKeys.join(", ")}${suffix} }`;
};

const countPropertySignatures = (typeLiteralNode: OxcAstNode): number => {
  const members = (typeLiteralNode.members as unknown[]) ?? [];
  let signatureCount = 0;
  for (const memberCandidate of members) {
    if (!isOxcAstNode(memberCandidate)) continue;
    if (memberCandidate.type === "TSPropertySignature") signatureCount++;
  }
  return signatureCount;
};

const captureIfTypeLiteral = (
  candidateNode: unknown,
  captures: InlineTypeLiteralCapture[],
  context: InlineTypeContext,
  nearestName: string | undefined,
): void => {
  if (!isOxcAstNode(candidateNode)) return;
  if (!isTypeLiteralNode(candidateNode)) return;
  const memberCount = countPropertySignatures(candidateNode);
  if (memberCount < MIN_PROPERTIES_FOR_INLINE_TYPE_LITERAL) return;
  captures.push({
    structuralHash: `inline:${normalizeTypeAstHash(candidateNode)}`,
    memberCount,
    preview: buildPreview(candidateNode),
    context,
    nearestName,
    startOffset: candidateNode.start ?? 0,
  });
};

const GENERIC_WRAPPERS_TO_RECURSE = new Set([
  "Array",
  "ReadonlyArray",
  "Promise",
  "Set",
  "ReadonlySet",
  "Map",
  "ReadonlyMap",
  "Record",
  "Partial",
  "Required",
  "Readonly",
  "NonNullable",
  "Awaited",
]);

const inspectAnyTypeNode = (
  candidateNode: unknown,
  captures: InlineTypeLiteralCapture[],
  context: InlineTypeContext,
  nearestName: string | undefined,
  recursionDepth: number,
): void => {
  if (!isOxcAstNode(candidateNode)) return;
  if (recursionDepth > MAX_TYPE_REFERENCE_WALK_DEPTH) return;

  if (isTypeLiteralNode(candidateNode)) {
    captureIfTypeLiteral(candidateNode, captures, context, nearestName);
    const members = (candidateNode.members as unknown[]) ?? [];
    for (const memberCandidate of members) {
      if (!isOxcAstNode(memberCandidate)) continue;
      if (memberCandidate.type !== "TSPropertySignature") continue;
      const memberKey = (memberCandidate as { key?: { name?: string } }).key?.name;
      const nested = (memberCandidate as { typeAnnotation?: unknown }).typeAnnotation;
      inspectAnyTypeNode(
        nested,
        captures,
        "interface-property",
        memberKey ?? nearestName,
        recursionDepth + 1,
      );
    }
    return;
  }

  if (candidateNode.type === "TSTypeAnnotation") {
    inspectAnyTypeNode(
      (candidateNode as { typeAnnotation?: unknown }).typeAnnotation,
      captures,
      context,
      nearestName,
      recursionDepth + 1,
    );
    return;
  }

  if (candidateNode.type === "TSArrayType") {
    inspectAnyTypeNode(
      (candidateNode as { elementType?: unknown }).elementType,
      captures,
      context,
      nearestName,
      recursionDepth + 1,
    );
    return;
  }

  if (candidateNode.type === "TSUnionType" || candidateNode.type === "TSIntersectionType") {
    const operands = (candidateNode.types as unknown[]) ?? [];
    for (const operand of operands) {
      inspectAnyTypeNode(operand, captures, context, nearestName, recursionDepth + 1);
    }
    return;
  }

  if (candidateNode.type === "TSTupleType") {
    const elements = (candidateNode.elementTypes as unknown[]) ?? [];
    for (const element of elements) {
      inspectAnyTypeNode(element, captures, context, nearestName, recursionDepth + 1);
    }
    return;
  }

  if (candidateNode.type === "TSTypeReference") {
    const referenceTypeName = (candidateNode as { typeName?: { name?: string } }).typeName?.name;
    const typeArguments = (candidateNode as { typeArguments?: { params?: unknown[] } })
      .typeArguments;
    if (
      referenceTypeName &&
      typeArguments?.params &&
      GENERIC_WRAPPERS_TO_RECURSE.has(referenceTypeName)
    ) {
      for (const param of typeArguments.params) {
        inspectAnyTypeNode(param, captures, context, nearestName, recursionDepth + 1);
      }
    }
  }
};

const inspectTypeAnnotation = (
  typeAnnotationNode: unknown,
  captures: InlineTypeLiteralCapture[],
  context: InlineTypeContext,
  nearestName: string | undefined,
): void => {
  inspectAnyTypeNode(typeAnnotationNode, captures, context, nearestName, 0);
};

const visitFunctionParameters = (
  parameters: unknown[] | undefined,
  captures: InlineTypeLiteralCapture[],
  functionName: string | undefined,
): void => {
  if (!parameters) return;
  for (const parameter of parameters) {
    if (!isOxcAstNode(parameter)) continue;
    const parameterIdentifierName = getIdentifierName(parameter);
    inspectTypeAnnotation(
      parameter.typeAnnotation,
      captures,
      "function-parameter",
      functionName ? `${functionName}(${parameterIdentifierName ?? "?"})` : parameterIdentifierName,
    );
  }
};

const visitFunctionLike = (
  functionNode: OxcAstNode,
  captures: InlineTypeLiteralCapture[],
  functionName: string | undefined,
): void => {
  const parameters = functionNode.params as unknown[] | undefined;
  visitFunctionParameters(parameters, captures, functionName);
  const returnTypeNode = functionNode.returnType as unknown;
  if (returnTypeNode) {
    inspectTypeAnnotation(returnTypeNode, captures, "function-return", functionName);
  }
  const bodyNode = functionNode.body as unknown;
  if (bodyNode) {
    walkBodyForInlineTypes(bodyNode, captures, functionName);
  }
};

const visitVariableDeclaration = (
  declarationNode: OxcAstNode,
  captures: InlineTypeLiteralCapture[],
  enclosingName: string | undefined,
): void => {
  const declarators = (declarationNode.declarations as unknown[]) ?? [];
  for (const declarator of declarators) {
    if (!isOxcAstNode(declarator)) continue;
    const declarationName = getIdentifierName(declarator.id);
    inspectTypeAnnotation(
      declarator.typeAnnotation ??
        (declarator.id && isOxcAstNode(declarator.id) ? declarator.id.typeAnnotation : undefined),
      captures,
      "variable-annotation",
      declarationName,
    );
    const initializerNode = declarator.init;
    if (isOxcAstNode(initializerNode)) {
      if (
        initializerNode.type === "ArrowFunctionExpression" ||
        initializerNode.type === "FunctionExpression"
      ) {
        visitFunctionLike(initializerNode, captures, declarationName ?? enclosingName);
      } else {
        walkExpressionForInlineTypes(initializerNode, captures, declarationName ?? enclosingName);
      }
    }
  }
};

const walkBodyForInlineTypes = (
  bodyNode: unknown,
  captures: InlineTypeLiteralCapture[],
  enclosingName: string | undefined,
  recursionDepth: number = 0,
): void => {
  if (recursionDepth > MAX_AST_WALK_DEPTH) return;
  if (!isOxcAstNode(bodyNode)) return;
  const statements = (bodyNode.body as unknown[]) ?? [];
  if (!Array.isArray(statements)) return;
  for (const statement of statements) {
    if (!isOxcAstNode(statement)) continue;
    if (statement.type === "VariableDeclaration") {
      visitVariableDeclaration(statement, captures, enclosingName);
    } else if (statement.type === "FunctionDeclaration") {
      const functionName = getIdentifierName(statement.id);
      visitFunctionLike(statement, captures, functionName ?? enclosingName);
    } else if (statement.type === "TSTypeAliasDeclaration") {
      const typeAliasName = getIdentifierName(statement.id);
      captureIfTypeLiteral(statement.typeAnnotation, captures, "local-type-alias", typeAliasName);
    } else if (statement.type === "ReturnStatement") {
      walkExpressionForInlineTypes(statement.argument, captures, enclosingName, recursionDepth + 1);
    } else if (statement.type === "BlockStatement") {
      walkBodyForInlineTypes(statement, captures, enclosingName, recursionDepth + 1);
    } else if (statement.type === "ExpressionStatement") {
      walkExpressionForInlineTypes(
        statement.expression,
        captures,
        enclosingName,
        recursionDepth + 1,
      );
    }
  }
};

const walkExpressionForInlineTypes = (
  expressionNode: unknown,
  captures: InlineTypeLiteralCapture[],
  enclosingName: string | undefined,
  recursionDepth: number = 0,
): void => {
  if (recursionDepth > MAX_AST_WALK_DEPTH) return;
  if (!isOxcAstNode(expressionNode)) return;
  if (
    expressionNode.type === "ArrowFunctionExpression" ||
    expressionNode.type === "FunctionExpression"
  ) {
    visitFunctionLike(expressionNode, captures, enclosingName);
    return;
  }
  for (const value of Object.values(expressionNode)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        walkExpressionForInlineTypes(element, captures, enclosingName, recursionDepth + 1);
      }
    } else if (isOxcAstNode(value)) {
      walkExpressionForInlineTypes(value, captures, enclosingName, recursionDepth + 1);
    }
  }
};

const visitTopLevelStatement = (
  statementNode: unknown,
  captures: InlineTypeLiteralCapture[],
): void => {
  if (!isOxcAstNode(statementNode)) return;

  const innerNode =
    statementNode.type === "ExportNamedDeclaration" ||
    statementNode.type === "ExportDefaultDeclaration"
      ? ((statementNode.declaration as unknown) ?? statementNode)
      : statementNode;
  const targetNode = isOxcAstNode(innerNode) ? innerNode : statementNode;

  if (targetNode.type === "FunctionDeclaration") {
    const functionName = getIdentifierName(targetNode.id);
    visitFunctionLike(targetNode, captures, functionName);
    return;
  }

  if (targetNode.type === "VariableDeclaration") {
    visitVariableDeclaration(targetNode, captures, undefined);
    return;
  }

  if (targetNode.type === "ClassDeclaration") {
    const className = getIdentifierName(targetNode.id);
    const bodyContainer = targetNode.body as { body?: unknown[] } | undefined;
    const members = bodyContainer?.body ?? [];
    for (const memberCandidate of members) {
      if (!isOxcAstNode(memberCandidate)) continue;
      const memberKeyName = getIdentifierName((memberCandidate as { key?: unknown }).key);
      const qualifiedName =
        className && memberKeyName ? `${className}.${memberKeyName}` : memberKeyName;
      if (memberCandidate.type === "PropertyDefinition") {
        inspectTypeAnnotation(
          (memberCandidate as { typeAnnotation?: unknown }).typeAnnotation,
          captures,
          "class-property",
          qualifiedName,
        );
        continue;
      }
      if (
        memberCandidate.type === "MethodDefinition" ||
        memberCandidate.type === "TSAbstractMethodDefinition"
      ) {
        const methodValue = (memberCandidate as { value?: OxcAstNode }).value;
        if (isOxcAstNode(methodValue)) {
          visitFunctionLike(methodValue, captures, qualifiedName);
        }
      }
    }
    return;
  }

  if (targetNode.type === "TSInterfaceDeclaration") {
    const interfaceName = getIdentifierName(targetNode.id);
    const interfaceBodyContainer = targetNode.body as { body?: unknown[] } | undefined;
    const interfaceMembers = interfaceBodyContainer?.body ?? [];
    for (const memberCandidate of interfaceMembers) {
      if (!isOxcAstNode(memberCandidate)) continue;
      if (memberCandidate.type !== "TSPropertySignature") continue;
      const memberKeyName = getIdentifierName((memberCandidate as { key?: unknown }).key);
      const qualifiedName =
        interfaceName && memberKeyName ? `${interfaceName}.${memberKeyName}` : memberKeyName;
      inspectTypeAnnotation(
        (memberCandidate as { typeAnnotation?: unknown }).typeAnnotation,
        captures,
        "interface-property",
        qualifiedName,
      );
    }
  }
};

export const collectInlineTypeLiterals = (programBody: unknown[]): InlineTypeLiteralCapture[] => {
  const captures: InlineTypeLiteralCapture[] = [];
  for (const statement of programBody) {
    visitTopLevelStatement(statement, captures);
  }
  return captures;
};
