import {
  FETCH_CALLEE_NAMES,
  FETCH_MEMBER_OBJECTS,
  LOOP_TYPES,
  MUTATING_HTTP_METHODS,
  MUTATION_METHOD_NAMES,
  SETTER_PATTERN,
  UPPERCASE_PATTERN,
} from "./constants.js";
import type { EsTreeNode, RuleVisitors } from "./types.js";

// HACK: AST is acyclic except for `parent` back-references, which we skip.
// Visitors may return `false` to prune the subtree below `node` (e.g. to
// stop walking into nested functions when collecting `await` expressions
// for the enclosing function only). Returning anything else (including
// `undefined`, the natural value of statements) continues the walk.
export const walkAst = (node: EsTreeNode, visitor: (child: EsTreeNode) => boolean | void): void => {
  if (!node || typeof node !== "object") return;
  if (visitor(node) === false) return;
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

// HACK: walk a MemberExpression chain (computed or not) down to the
// underlying root identifier. `state.nested.items` → "state",
// `items[0]` → "items". Returns null if the chain bottoms out at
// anything other than a plain Identifier (e.g. a CallExpression,
// `this`, etc.). Bare Identifiers also resolve to themselves.
export const getRootIdentifierName = (node: EsTreeNode | undefined | null): string | null => {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  let cursor: EsTreeNode | undefined = node;
  while (cursor?.type === "MemberExpression") {
    cursor = cursor.object;
  }
  return cursor?.type === "Identifier" ? cursor.name : null;
};

// HACK: structural equality for "value-shaped" expressions used by
// detectors that need to assert two reads of the same external value
// (e.g. `prefer-use-sync-external-store` checks that the
// `useState(getSnapshot())` initializer matches the
// `setSnapshot(getSnapshot())` inside the subscribe handler).
// Deliberately conservative — we only model Identifier / Literal /
// MemberExpression / CallExpression because any other shape
// (assignments, ternaries, template strings) shouldn't be relied on
// for a "same external store read" claim.
export const areExpressionsStructurallyEqual = (
  a: EsTreeNode | null | undefined,
  b: EsTreeNode | null | undefined,
): boolean => {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === "Identifier") return a.name === b.name;
  if (a.type === "Literal") return a.value === b.value;
  if (a.type === "MemberExpression") {
    if (a.computed !== b.computed) return false;
    return (
      areExpressionsStructurallyEqual(a.object, b.object) &&
      areExpressionsStructurallyEqual(a.property, b.property)
    );
  }
  if (a.type === "CallExpression") {
    if (!areExpressionsStructurallyEqual(a.callee, b.callee)) return false;
    const argumentsA = a.arguments ?? [];
    const argumentsB = b.arguments ?? [];
    if (argumentsA.length !== argumentsB.length) return false;
    return argumentsA.every((argument: EsTreeNode, index: number) =>
      areExpressionsStructurallyEqual(argument, argumentsB[index]),
    );
  }
  return false;
};

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

// HACK: extracted so `findSideEffect` can re-use the EXACT same shape
// predicate when it goes hunting for the literal method to render in
// the diagnostic. Previously `findSideEffect` used a looser `key.name
// === "method"` predicate and could pick a non-Literal `method:` entry
// (when duplicate keys are present), producing
// `"fetch() with method undefined"` in the message.
const isMutatingMethodProperty = (property: EsTreeNode): boolean =>
  property.type === "Property" &&
  property.key?.type === "Identifier" &&
  property.key.name === "method" &&
  property.value?.type === "Literal" &&
  typeof property.value.value === "string" &&
  MUTATING_HTTP_METHODS.has(property.value.value.toUpperCase());

const isMutatingFetchCall = (node: EsTreeNode): boolean => {
  if (node.type !== "CallExpression") return false;
  if (node.callee?.type !== "Identifier" || node.callee.name !== "fetch") return false;
  const optionsArgument = node.arguments?.[1];
  if (!optionsArgument || optionsArgument.type !== "ObjectExpression") return false;
  return Boolean(optionsArgument.properties?.some(isMutatingMethodProperty));
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
      // HACK: re-use the EXACT predicate `isMutatingFetchCall` already
      // matched on so we can't pick a non-Literal duplicate `method:`
      // entry by mistake (a looser `key.name === "method"` predicate
      // would).
      const methodProperty = child.arguments[1].properties.find(isMutatingMethodProperty);
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

// HACK: collects every locally-bound name introduced by a parameter list,
// recursing into nested object/array patterns. We need every binding so
// `noDerivedUseState` can detect e.g. `function Foo({ user: { name } })` →
// `useState(name)` (false negative if we only added "user").
export const collectPatternNames = (pattern: EsTreeNode | null, into: Set<string>): void => {
  if (!pattern) return;

  if (pattern.type === "Identifier") {
    into.add(pattern.name);
    return;
  }

  if (pattern.type === "AssignmentPattern") {
    collectPatternNames(pattern.left, into);
    return;
  }

  if (pattern.type === "RestElement") {
    collectPatternNames(pattern.argument, into);
    return;
  }

  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements ?? []) {
      collectPatternNames(element, into);
    }
    return;
  }

  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties ?? []) {
      if (property.type === "RestElement") {
        collectPatternNames(property.argument, into);
        continue;
      }
      if (property.type === "Property") {
        // The bound name lives in `property.value` (which may itself be
        // a nested pattern). The `property.key` is the source-side name
        // and only matters when it equals `property.value` (shorthand).
        collectPatternNames(property.value, into);
      }
    }
  }
};

export const extractDestructuredPropNames = (params: EsTreeNode[]): Set<string> => {
  const propNames = new Set<string>();
  for (const param of params) {
    collectPatternNames(param, propNames);
  }
  return propNames;
};
