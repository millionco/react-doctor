import {
  FETCH_CALLEE_NAMES,
  FETCH_MEMBER_OBJECTS,
  LOOP_TYPES,
  MUTATING_HTTP_METHODS,
  MUTATION_METHOD_NAMES,
  SETTER_PATTERN,
  UPPERCASE_PATTERN,
} from "./constants";
import type { EsTreeNode, RuleVisitors } from "./types";

export const walkAst = (node: EsTreeNode, visitor: (child: EsTreeNode) => void): void => {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          walkAst(item, visitor);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      walkAst(child, visitor);
    }
  }
};

export const isSetterIdentifier = (name: string): boolean => SETTER_PATTERN.test(name);

export const isSetterCall = (node: EsTreeNode): boolean =>
  node.type === "CallExpression" &&
  node.callee?.type === "Identifier" &&
  isSetterIdentifier(node.callee.name);

export const isUppercaseName = (name: string): boolean => UPPERCASE_PATTERN.test(name);

export const isMemberProperty = (node: EsTreeNode, propertyName: string): boolean =>
  node.type === "MemberExpression" &&
  node.property?.type === "Identifier" &&
  node.property.name === propertyName;

export const getEffectCallback = (node: EsTreeNode): EsTreeNode | null => {
  if (!node.arguments?.length) return null;
  const callback = node.arguments[0];
  if (callback.type === "ArrowFunctionExpression" || callback.type === "FunctionExpression") {
    return callback;
  }
  return null;
};

export const getCallbackStatements = (callback: EsTreeNode): EsTreeNode[] => {
  if (callback.body?.type === "BlockStatement") {
    return callback.body.body ?? [];
  }
  return callback.body ? [callback.body] : [];
};

export const countSetStateCalls = (node: EsTreeNode): number => {
  let setStateCallCount = 0;
  walkAst(node, (child) => {
    if (isSetterCall(child)) setStateCallCount++;
  });
  return setStateCallCount;
};

export const isSimpleExpression = (node: EsTreeNode | null): boolean => {
  if (!node) return false;
  switch (node.type) {
    case "Identifier":
    case "Literal":
    case "TemplateLiteral":
      return true;
    case "BinaryExpression":
      return isSimpleExpression(node.left) && isSimpleExpression(node.right);
    case "UnaryExpression":
      return isSimpleExpression(node.argument);
    case "MemberExpression":
      return !node.computed && isSimpleExpression(node.object);
    case "ConditionalExpression":
      return (
        isSimpleExpression(node.test) &&
        isSimpleExpression(node.consequent) &&
        isSimpleExpression(node.alternate)
      );
    default:
      return false;
  }
};

export const isComponentDeclaration = (node: EsTreeNode): boolean =>
  node.type === "FunctionDeclaration" && Boolean(node.id?.name) && isUppercaseName(node.id.name);

export const isComponentAssignment = (node: EsTreeNode): boolean =>
  node.type === "VariableDeclarator" &&
  node.id?.type === "Identifier" &&
  isUppercaseName(node.id.name) &&
  Boolean(node.init) &&
  (node.init.type === "ArrowFunctionExpression" || node.init.type === "FunctionExpression");

export const getCalleeName = (node: EsTreeNode): string | null => {
  if (node.callee?.type === "Identifier") return node.callee.name;
  if (node.callee?.type === "MemberExpression" && node.callee.property?.type === "Identifier") {
    return node.callee.property.name;
  }
  return null;
};

export const isHookCall = (node: EsTreeNode, hookName: string | Set<string>): boolean => {
  if (node.type !== "CallExpression") return false;
  const calleeName = getCalleeName(node);
  if (!calleeName) return false;
  return typeof hookName === "string" ? calleeName === hookName : hookName.has(calleeName);
};

export const hasDirective = (programNode: EsTreeNode, directive: string): boolean =>
  Boolean(
    programNode.body?.some(
      (statement: EsTreeNode) =>
        statement.type === "ExpressionStatement" &&
        statement.expression?.type === "Literal" &&
        statement.expression.value === directive,
    ),
  );

export const hasUseServerDirective = (node: EsTreeNode): boolean => {
  if (node.body?.type !== "BlockStatement") return false;
  return Boolean(
    node.body.body?.some(
      (statement: EsTreeNode) =>
        statement.type === "ExpressionStatement" && statement.directive === "use server",
    ),
  );
};

export const containsFetchCall = (node: EsTreeNode): boolean => {
  let didFindFetchCall = false;
  walkAst(node, (child) => {
    if (didFindFetchCall || child.type !== "CallExpression") return;
    if (child.callee?.type === "Identifier" && FETCH_CALLEE_NAMES.has(child.callee.name)) {
      didFindFetchCall = true;
    }
    if (
      child.callee?.type === "MemberExpression" &&
      child.callee.object?.type === "Identifier" &&
      FETCH_MEMBER_OBJECTS.has(child.callee.object.name)
    ) {
      didFindFetchCall = true;
    }
  });
  return didFindFetchCall;
};

export const findJsxAttribute = (
  attributes: EsTreeNode[],
  attributeName: string,
): EsTreeNode | undefined =>
  attributes?.find(
    (attr: EsTreeNode) =>
      attr.type === "JSXAttribute" &&
      attr.name?.type === "JSXIdentifier" &&
      attr.name.name === attributeName,
  );

export const hasJsxAttribute = (attributes: EsTreeNode[], attributeName: string): boolean =>
  Boolean(findJsxAttribute(attributes, attributeName));

export const createLoopAwareVisitors = (
  innerVisitors: Record<string, (node: EsTreeNode) => void>,
): RuleVisitors => {
  let loopDepth = 0;
  const incrementLoopDepth = (): void => {
    loopDepth++;
  };
  const decrementLoopDepth = (): void => {
    loopDepth--;
  };

  const visitors: RuleVisitors = {};

  for (const loopType of LOOP_TYPES) {
    visitors[loopType] = incrementLoopDepth;
    visitors[`${loopType}:exit`] = decrementLoopDepth;
  }

  for (const [nodeType, handler] of Object.entries(innerVisitors)) {
    visitors[nodeType] = (node: EsTreeNode) => {
      if (loopDepth > 0) handler(node);
    };
  }

  return visitors;
};

const isCookiesOrHeadersCall = (node: EsTreeNode, methodName: string): boolean => {
  if (node.type !== "CallExpression" || node.callee?.type !== "MemberExpression") return false;
  const { object, property } = node.callee;
  if (property?.type !== "Identifier" || !MUTATION_METHOD_NAMES.has(property.name)) return false;
  if (object?.type !== "CallExpression" || object.callee?.type !== "Identifier") return false;
  return object.callee.name === methodName;
};

const isMutatingDbCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression" || node.callee?.type !== "MemberExpression") return false;
  const { property } = node.callee;
  return property?.type === "Identifier" && MUTATION_METHOD_NAMES.has(property.name);
};

const isMutatingFetchCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  if (node.callee?.type !== "Identifier" || node.callee.name !== "fetch") return false;
  const optionsArgument = node.arguments?.[1];
  if (!optionsArgument || optionsArgument.type !== "ObjectExpression") return false;
  return optionsArgument.properties?.some(
    (property: EsTreeNode) =>
      property.type === "Property" &&
      property.key?.type === "Identifier" &&
      property.key.name === "method" &&
      property.value?.type === "Literal" &&
      typeof property.value.value === "string" &&
      MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase()),
  );
};

export const findSideEffect = (node: EsTreeNode): string | null => {
  let sideEffectDescription: string | null = null;
  walkAst(node, (child: EsTreeNode) => {
    if (sideEffectDescription) return;
    if (isCookiesOrHeadersCall(child, "cookies")) {
      const methodName = child.callee.property.name;
      sideEffectDescription = `cookies().${methodName}()`;
    } else if (isCookiesOrHeadersCall(child, "headers")) {
      const methodName = child.callee.property.name;
      sideEffectDescription = `headers().${methodName}()`;
    } else if (isMutatingFetchCall(child)) {
      const methodProperty = child.arguments[1].properties.find(
        (property: EsTreeNode) =>
          property.key?.type === "Identifier" && property.key.name === "method",
      );
      sideEffectDescription = `fetch() with method ${methodProperty.value.value}`;
    } else if (isMutatingDbCall(child)) {
      const methodName = child.callee.property.name;
      const objectName =
        child.callee.object?.type === "Identifier" ? child.callee.object.name : null;
      sideEffectDescription = objectName ? `${objectName}.${methodName}()` : `.${methodName}()`;
    }
  });
  return sideEffectDescription;
};

export const extractDestructuredPropNames = (params: EsTreeNode[]): Set<string> => {
  const propNames = new Set<string>();
  for (const param of params) {
    if (param.type === "ObjectPattern") {
      for (const property of param.properties ?? []) {
        if (property.type === "Property" && property.key?.type === "Identifier") {
          propNames.add(property.key.name);
        }
      }
    } else if (param.type === "Identifier") {
      propNames.add(param.name);
    }
  }
  return propNames;
};
