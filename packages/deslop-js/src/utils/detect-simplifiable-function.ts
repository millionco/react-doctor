import type { SimplifiableFunctionKind } from "../types.js";
import { MAX_FUNCTION_BODY_INSPECT_DEPTH } from "../constants.js";
import { isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

export interface SimplifiableFunctionDetection {
  kind: SimplifiableFunctionKind;
  startOffset: number;
  reason: string;
  suggestion: string;
}

const containsAwaitExpression = (node: unknown, recursionDepth = 0): boolean => {
  if (recursionDepth > MAX_FUNCTION_BODY_INSPECT_DEPTH) return false;
  if (!isOxcAstNode(node)) return false;
  if (node.type === "AwaitExpression") return true;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return false;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (containsAwaitExpression(element, recursionDepth + 1)) return true;
      }
    } else if (isOxcAstNode(value)) {
      if (containsAwaitExpression(value, recursionDepth + 1)) return true;
    }
  }
  return false;
};

const containsCallOrPromiseSurface = (node: unknown, recursionDepth = 0): boolean => {
  if (recursionDepth > MAX_FUNCTION_BODY_INSPECT_DEPTH) return false;
  if (!isOxcAstNode(node)) return false;
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return false;
  }
  if (
    node.type === "CallExpression" ||
    node.type === "NewExpression" ||
    node.type === "TaggedTemplateExpression" ||
    node.type === "ThrowStatement" ||
    node.type === "YieldExpression"
  ) {
    return true;
  }
  if (node.type === "MemberExpression") {
    const objectNode = (node as { object?: OxcAstNode }).object;
    if (objectNode && isOxcAstNode(objectNode) && objectNode.type === "Identifier") {
      const objectName = (objectNode as { name?: string }).name;
      if (objectName === "Promise") return true;
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (containsCallOrPromiseSurface(element, recursionDepth + 1)) return true;
      }
    } else if (isOxcAstNode(value)) {
      if (containsCallOrPromiseSurface(value, recursionDepth + 1)) return true;
    }
  }
  return false;
};

const unwrapParenthesizedExpression = (node: OxcAstNode): OxcAstNode => {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    const inner = (current as { expression?: OxcAstNode }).expression;
    if (!inner || !isOxcAstNode(inner)) return current;
    current = inner;
  }
  return current;
};

const isSimpleReturnArgument = (argumentNode: unknown): boolean => {
  if (!isOxcAstNode(argumentNode)) return false;
  const unwrapped = unwrapParenthesizedExpression(argumentNode);
  if (unwrapped.type === "BlockStatement") return false;
  if (unwrapped.type === "ObjectExpression") return false;
  if (unwrapped.type === "JSXElement") return false;
  if (unwrapped.type === "JSXFragment") return false;
  return true;
};

const detectBlockArrowSingleReturn = (
  functionNode: OxcAstNode,
): SimplifiableFunctionDetection | undefined => {
  if (functionNode.type !== "ArrowFunctionExpression") return undefined;
  if ((functionNode as { async?: boolean }).async) return undefined;
  const bodyNode = functionNode.body as OxcAstNode | undefined;
  if (!bodyNode || bodyNode.type !== "BlockStatement") return undefined;
  const statements = (bodyNode.body as unknown[]) ?? [];
  if (statements.length !== 1) return undefined;
  const onlyStatement = statements[0];
  if (!isOxcAstNode(onlyStatement)) return undefined;
  if (onlyStatement.type !== "ReturnStatement") return undefined;
  const returnArgument = (onlyStatement as { argument?: unknown }).argument;
  if (!returnArgument) return undefined;
  if (!isSimpleReturnArgument(returnArgument)) return undefined;
  return {
    kind: "block-arrow-single-return",
    startOffset: functionNode.start ?? 0,
    reason:
      "arrow body is a single `return` statement; the block can be replaced by the expression directly",
    suggestion: "rewrite as `() => expression` without `{}`",
  };
};

const detectRedundantAwaitReturn = (
  functionNode: OxcAstNode,
): SimplifiableFunctionDetection | undefined => {
  const bodyNode = functionNode.body as OxcAstNode | undefined;
  if (!bodyNode || bodyNode.type !== "BlockStatement") return undefined;
  const statements = (bodyNode.body as unknown[]) ?? [];
  if (statements.length < 2) return undefined;
  const penultimate = statements[statements.length - 2];
  const last = statements[statements.length - 1];
  if (!isOxcAstNode(penultimate) || !isOxcAstNode(last)) return undefined;
  if (penultimate.type !== "VariableDeclaration") return undefined;
  if (last.type !== "ReturnStatement") return undefined;

  const declarators = (penultimate.declarations as unknown[]) ?? [];
  if (declarators.length !== 1) return undefined;
  const declarator = declarators[0];
  if (!isOxcAstNode(declarator)) return undefined;
  const declaredIdentifier = (declarator as { id?: { name?: string } }).id;
  const initializer = (declarator as { init?: OxcAstNode }).init;
  if (!declaredIdentifier?.name) return undefined;
  if (!isOxcAstNode(initializer)) return undefined;
  if (initializer.type !== "AwaitExpression") return undefined;

  const returnedArgument = (last as { argument?: OxcAstNode }).argument;
  if (!isOxcAstNode(returnedArgument)) return undefined;
  if (returnedArgument.type !== "Identifier") return undefined;
  if ((returnedArgument as { name?: string }).name !== declaredIdentifier.name) return undefined;

  return {
    kind: "redundant-await-return",
    startOffset: penultimate.start ?? 0,
    reason: `\`const ${declaredIdentifier.name} = await …; return ${declaredIdentifier.name};\` can be \`return …;\` (the await is preserved by the implicit promise chain)`,
    suggestion: `replace the await/assign/return sequence with a single \`return await …\` or \`return …\` if no try/catch wraps it`,
  };
};

const isAsyncFunction = (functionNode: OxcAstNode): boolean =>
  Boolean((functionNode as { async?: boolean }).async);

const containsPromiseTypeReference = (node: unknown, recursionDepth = 0): boolean => {
  if (recursionDepth > MAX_FUNCTION_BODY_INSPECT_DEPTH) return false;
  if (!isOxcAstNode(node)) return false;
  if (node.type === "TSTypeReference") {
    const typeName = (node as { typeName?: { name?: string; right?: { name?: string } } }).typeName;
    if (typeName?.name === "Promise") return true;
    if (typeName?.right?.name === "Promise") return true;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const element of value) {
        if (containsPromiseTypeReference(element, recursionDepth + 1)) return true;
      }
    } else if (isOxcAstNode(value)) {
      if (containsPromiseTypeReference(value, recursionDepth + 1)) return true;
    }
  }
  return false;
};

const hasExplicitPromiseReturnType = (functionNode: OxcAstNode): boolean => {
  const returnType = (functionNode as { returnType?: OxcAstNode }).returnType;
  if (!returnType || !isOxcAstNode(returnType)) return false;
  const annotation = (returnType as { typeAnnotation?: OxcAstNode }).typeAnnotation;
  if (!annotation || !isOxcAstNode(annotation)) return false;
  return containsPromiseTypeReference(annotation);
};

export interface DetectSimplifiableFunctionContext {
  isMethodContext?: boolean;
  isInlineCallback?: boolean;
}

const detectUselessAsync = (
  functionNode: OxcAstNode,
  context: DetectSimplifiableFunctionContext,
): SimplifiableFunctionDetection | undefined => {
  if (!isAsyncFunction(functionNode)) return undefined;
  if (functionNode.type === "ClassDeclaration" || functionNode.type === "MethodDefinition") {
    return undefined;
  }
  if (context.isMethodContext) return undefined;
  if (context.isInlineCallback) return undefined;
  if (hasExplicitPromiseReturnType(functionNode)) return undefined;
  const bodyNode = functionNode.body as unknown;
  if (!isOxcAstNode(bodyNode)) return undefined;
  if (containsAwaitExpression(bodyNode)) return undefined;
  if (containsCallOrPromiseSurface(bodyNode)) return undefined;
  return {
    kind: "useless-async-no-await",
    startOffset: functionNode.start ?? 0,
    reason:
      "async function body contains no `await`, no function calls, and no Promise surface — the implicit Promise wrap is purely decorative",
    suggestion:
      "drop `async` (caller's existing `await` keeps the type identical) or add an explicit return type",
  };
};

export const detectSimplifiableFunctionPatterns = (
  functionNode: unknown,
  context: DetectSimplifiableFunctionContext = {},
): SimplifiableFunctionDetection[] => {
  if (!isOxcAstNode(functionNode)) return [];
  const findings: SimplifiableFunctionDetection[] = [];
  const blockArrow = detectBlockArrowSingleReturn(functionNode);
  if (blockArrow) findings.push(blockArrow);
  const awaitReturn = detectRedundantAwaitReturn(functionNode);
  if (awaitReturn) findings.push(awaitReturn);
  const uselessAsync = detectUselessAsync(functionNode, context);
  if (uselessAsync) findings.push(uselessAsync);
  return findings;
};
