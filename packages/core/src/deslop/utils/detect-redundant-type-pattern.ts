import type { RedundantTypePatternKind } from "../types.js";

export interface RedundantTypePatternDetection {
  kind: RedundantTypePatternKind;
  reason: string;
  suggestion: string;
}

interface TypeNodeLike {
  type: string;
  [key: string]: unknown;
}

const isTypeNode = (value: unknown): value is TypeNodeLike =>
  Boolean(value) && typeof value === "object" && typeof (value as TypeNodeLike).type === "string";

const isEmptyTypeLiteral = (node: TypeNodeLike): boolean => {
  if (node.type !== "TSTypeLiteral") return false;
  const members = node.members as unknown[] | undefined;
  return Array.isArray(members) && members.length === 0;
};

const typeReferenceName = (node: TypeNodeLike): string | undefined => {
  if (node.type !== "TSTypeReference") return undefined;
  const typeName = node.typeName as TypeNodeLike | undefined;
  if (!typeName || typeName.type !== "Identifier") return undefined;
  return typeName.name as string;
};

const isKeyofOfType = (candidate: TypeNodeLike, expectedReferenceName: string): boolean => {
  if (candidate.type !== "TSTypeOperator") return false;
  if (candidate.operator !== "keyof") return false;
  const operand = candidate.typeAnnotation as TypeNodeLike | undefined;
  if (!operand) return false;
  const operandName = typeReferenceName(operand);
  return operandName === expectedReferenceName;
};

const isNeverKeyword = (node: TypeNodeLike): boolean => node.type === "TSNeverKeyword";

const isLiterallyEqualByJson = (left: TypeNodeLike, right: TypeNodeLike): boolean => {
  const stripPositions = (key: string, value: unknown): unknown => {
    if (key === "start" || key === "end") return undefined;
    return value;
  };
  return JSON.stringify(left, stripPositions) === JSON.stringify(right, stripPositions);
};

const detectIntersectionWithEmpty = (
  node: TypeNodeLike,
): RedundantTypePatternDetection | undefined => {
  if (node.type !== "TSIntersectionType") return undefined;
  const operands = node.types as TypeNodeLike[] | undefined;
  if (!Array.isArray(operands) || operands.length < 2) return undefined;
  const hasEmptyLiteral = operands.some(isEmptyTypeLiteral);
  if (!hasEmptyLiteral) return undefined;
  return {
    kind: "intersection-with-empty-object",
    reason: "intersection with `{}` is a no-op; the empty object type does not constrain anything",
    suggestion: "drop the `& {}` term",
  };
};

const detectSelfUnion = (node: TypeNodeLike): RedundantTypePatternDetection | undefined => {
  if (node.type !== "TSUnionType") return undefined;
  const operands = node.types as TypeNodeLike[] | undefined;
  if (!Array.isArray(operands) || operands.length < 2) return undefined;
  for (let leftIndex = 0; leftIndex < operands.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < operands.length; rightIndex++) {
      if (isLiterallyEqualByJson(operands[leftIndex], operands[rightIndex])) {
        return {
          kind: "self-union",
          reason: "union contains the same member twice",
          suggestion: "deduplicate the union members",
        };
      }
    }
  }
  return undefined;
};

const detectSelfIntersection = (node: TypeNodeLike): RedundantTypePatternDetection | undefined => {
  if (node.type !== "TSIntersectionType") return undefined;
  const operands = node.types as TypeNodeLike[] | undefined;
  if (!Array.isArray(operands) || operands.length < 2) return undefined;
  for (let leftIndex = 0; leftIndex < operands.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < operands.length; rightIndex++) {
      if (isLiterallyEqualByJson(operands[leftIndex], operands[rightIndex])) {
        return {
          kind: "self-intersection",
          reason: "intersection contains the same operand twice",
          suggestion: "deduplicate the intersection operands",
        };
      }
    }
  }
  return undefined;
};

const detectNestedUtility = (
  node: TypeNodeLike,
  utilityName: string,
  kind: RedundantTypePatternKind,
): RedundantTypePatternDetection | undefined => {
  if (node.type !== "TSTypeReference") return undefined;
  if (typeReferenceName(node) !== utilityName) return undefined;
  const typeArguments = node.typeArguments as TypeNodeLike | undefined;
  if (!typeArguments) return undefined;
  const params = (typeArguments as { params?: TypeNodeLike[] }).params;
  if (!Array.isArray(params) || params.length === 0) return undefined;
  const firstArg = params[0];
  if (firstArg.type !== "TSTypeReference") return undefined;
  if (typeReferenceName(firstArg) !== utilityName) return undefined;
  return {
    kind,
    reason: `${utilityName}<${utilityName}<T>> collapses to ${utilityName}<T>`,
    suggestion: `flatten the nested ${utilityName}<...>`,
  };
};

const detectPickAllKeys = (node: TypeNodeLike): RedundantTypePatternDetection | undefined => {
  if (node.type !== "TSTypeReference") return undefined;
  if (typeReferenceName(node) !== "Pick") return undefined;
  const typeArguments = node.typeArguments as TypeNodeLike | undefined;
  if (!typeArguments) return undefined;
  const params = (typeArguments as { params?: TypeNodeLike[] }).params;
  if (!Array.isArray(params) || params.length !== 2) return undefined;
  const targetType = params[0];
  const keys = params[1];
  const targetName = typeReferenceName(targetType);
  if (!targetName) return undefined;
  if (!isKeyofOfType(keys, targetName)) return undefined;
  return {
    kind: "pick-all-keys",
    reason: `Pick<${targetName}, keyof ${targetName}> is equivalent to ${targetName} itself`,
    suggestion: `replace with ${targetName}`,
  };
};

const detectOmitNoKeys = (node: TypeNodeLike): RedundantTypePatternDetection | undefined => {
  if (node.type !== "TSTypeReference") return undefined;
  if (typeReferenceName(node) !== "Omit") return undefined;
  const typeArguments = node.typeArguments as TypeNodeLike | undefined;
  if (!typeArguments) return undefined;
  const params = (typeArguments as { params?: TypeNodeLike[] }).params;
  if (!Array.isArray(params) || params.length !== 2) return undefined;
  const targetType = params[0];
  const keys = params[1];
  const targetName = typeReferenceName(targetType);
  if (!targetName) return undefined;
  if (!isNeverKeyword(keys)) return undefined;
  return {
    kind: "omit-no-keys",
    reason: `Omit<${targetName}, never> is equivalent to ${targetName} itself`,
    suggestion: `replace with ${targetName}`,
  };
};

const isZodInferDeclarationMergingExtension = (
  parentExpression: TypeNodeLike | undefined,
): boolean => {
  if (!parentExpression || parentExpression.type !== "MemberExpression") return false;
  const propertyNode = parentExpression.property as TypeNodeLike | undefined;
  if (!propertyNode || propertyNode.type !== "Identifier") return false;
  return (propertyNode as { name?: string }).name === "infer";
};

const isRadixStylePropsAliasExtension = (parentExpression: TypeNodeLike | undefined): boolean => {
  if (!parentExpression || parentExpression.type !== "MemberExpression") return false;
  const propertyNode = parentExpression.property as TypeNodeLike | undefined;
  if (!propertyNode || propertyNode.type !== "Identifier") return false;
  return (propertyNode as { name?: string }).name === "Props";
};

const detectEmptyInterfaceExtendsOne = (
  declarationNode: TypeNodeLike,
): RedundantTypePatternDetection | undefined => {
  if (declarationNode.type !== "TSInterfaceDeclaration") return undefined;
  const body = declarationNode.body as { body?: unknown[] } | undefined;
  if (!body || !Array.isArray(body.body) || body.body.length !== 0) return undefined;
  const extendsClauses = declarationNode.extends as unknown[] | undefined;
  if (!Array.isArray(extendsClauses) || extendsClauses.length !== 1) return undefined;
  const declarationName = (declarationNode.id as { name?: string } | undefined)?.name;
  const parentNode = extendsClauses[0] as TypeNodeLike | undefined;
  const parentExpression = parentNode?.expression as TypeNodeLike | undefined;
  if (isZodInferDeclarationMergingExtension(parentExpression)) return undefined;
  if (isRadixStylePropsAliasExtension(parentExpression)) return undefined;
  const parentName =
    parentExpression && parentExpression.type === "Identifier"
      ? (parentExpression as { name?: string }).name
      : undefined;
  return {
    kind: "empty-interface-extends-one",
    reason: `interface ${declarationName ?? "<anon>"} extends ${parentName ?? "<base>"} with no new members`,
    suggestion: `replace with \`type ${declarationName ?? "X"} = ${parentName ?? "Base"}\``,
  };
};

export const detectRedundantTypePatternForTypeAnnotation = (
  typeAnnotation: unknown,
): RedundantTypePatternDetection | undefined => {
  if (!isTypeNode(typeAnnotation)) return undefined;
  return (
    detectIntersectionWithEmpty(typeAnnotation) ??
    detectSelfUnion(typeAnnotation) ??
    detectSelfIntersection(typeAnnotation) ??
    detectNestedUtility(typeAnnotation, "Partial", "nested-partial") ??
    detectNestedUtility(typeAnnotation, "Readonly", "nested-readonly") ??
    detectNestedUtility(typeAnnotation, "Required", "nested-required") ??
    detectPickAllKeys(typeAnnotation) ??
    detectOmitNoKeys(typeAnnotation)
  );
};

export const detectRedundantInterfaceDeclaration = (
  declarationNode: unknown,
): RedundantTypePatternDetection | undefined => {
  if (!isTypeNode(declarationNode)) return undefined;
  return detectEmptyInterfaceExtendsOne(declarationNode);
};
