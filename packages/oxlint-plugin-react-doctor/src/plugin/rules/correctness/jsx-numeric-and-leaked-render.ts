import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getDirectUnreassignedInitializer } from "../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { flattenLogicalAndChain } from "../../utils/flatten-logical-and-chain.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ARITHMETIC_BINARY_OPERATORS = new Set(["-", "*", "/", "%"]);
const NUMERIC_COERCION_CALLEE_NAMES = new Set(["Number", "parseInt", "parseFloat"]);
const MAP_OR_SET_CONSTRUCTOR_NAMES = new Set(["Map", "Set"]);
const PASSTHROUGH_WRAPPER_PARENT_TYPES = new Set<string>([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);

const isJsxNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment");

const isMapOrSetConstruction = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  return (
    isNodeOfType(stripped, "NewExpression") &&
    isNodeOfType(stripped.callee, "Identifier") &&
    MAP_OR_SET_CONSTRUCTOR_NAMES.has(stripped.callee.name)
  );
};

const isHookCallNamed = (node: EsTreeNode, hookName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "Identifier")) return callee.name === hookName;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === hookName
  );
};

const isHookCallSeededWithMapOrSet = (node: EsTreeNode, hookName: string): boolean => {
  if (!isHookCallNamed(node, hookName) || !isNodeOfType(node, "CallExpression")) return false;
  const firstArgument = node.arguments[0];
  return Boolean(firstArgument && isMapOrSetConstruction(firstArgument));
};

const isFirstElementOfUseStateWithMapOrSet = (bindingIdentifier: EsTreeNode): boolean => {
  const pattern = bindingIdentifier.parent;
  if (!pattern || !isNodeOfType(pattern, "ArrayPattern")) return false;
  if (pattern.elements[0] !== bindingIdentifier) return false;
  const declarator = pattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return false;
  }
  return isHookCallSeededWithMapOrSet(stripParenExpression(declarator.init), "useState");
};

const identifierResolvesToMapOrSet = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  if (binding.initializer && isMapOrSetConstruction(binding.initializer)) return true;
  return isFirstElementOfUseStateWithMapOrSet(binding.bindingIdentifier);
};

const isRefCurrentOfMapOrSet = (objectNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(objectNode, "MemberExpression") ||
    objectNode.computed ||
    !isNodeOfType(objectNode.property, "Identifier") ||
    objectNode.property.name !== "current"
  ) {
    return false;
  }
  const refIdentifier = stripParenExpression(objectNode.object);
  if (!isNodeOfType(refIdentifier, "Identifier")) return false;
  const binding = findVariableInitializer(refIdentifier, refIdentifier.name);
  if (!binding || !binding.initializer) return false;
  return isHookCallSeededWithMapOrSet(stripParenExpression(binding.initializer), "useRef");
};

// `.size` collides with react-hook-form FieldError objects and string
// `size` props ("sm"/"md") far more often than it identifies a Map/Set,
// so it only counts when the receiver provably is one: a direct
// `new Map`/`new Set`, a binding initialized to one (including
// `useState(new Set())` destructures), or a `ref.current` whose ref was
// seeded with one.
const isProvableCollectionReceiver = (objectNode: EsTreeNode): boolean => {
  const stripped = stripParenExpression(objectNode);
  if (isMapOrSetConstruction(stripped)) return true;
  if (isNodeOfType(stripped, "Identifier")) return identifierResolvesToMapOrSet(stripped);
  return isRefCurrentOfMapOrSet(stripped);
};

// Serializes `errors.length` / `formState.errors.length` to a dotted path
// of non-computed identifier links, or null for anything else.
const memberPathOf = (node: EsTreeNode): string | null => {
  const parts: string[] = [];
  let current = stripParenExpression(node);
  while (isNodeOfType(current, "MemberExpression")) {
    if (current.computed || !isNodeOfType(current.property, "Identifier")) return null;
    parts.unshift(current.property.name);
    current = stripParenExpression(current.object as EsTreeNode);
  }
  if (!isNodeOfType(current, "Identifier")) return null;
  parts.unshift(current.name);
  return parts.join(".");
};

// How many identifier-initializer hops the provably-positive guards
// follow before giving up (`isExpanded` → `isExpandable && …` →
// `children.length > 0` is three).
const PROVENANCE_HOP_LIMIT = 6;
const NUMBER_MEMBER_NAMES = new Set([
  "toExponential",
  "toFixed",
  "toLocaleString",
  "toPrecision",
  "toString",
  "valueOf",
]);

const numericLiteralValue = (node: EsTreeNode): number | null => {
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "number") {
    return stripped.value;
  }
  return null;
};

// `path > 0`, `path >= 1`, `path !== 0`, `path === 3` and their mirrored
// forms all prove the (non-negative) length/size at `targetPath` is
// positive, so the `&&` can never short-circuit to a rendered `0`.
const comparisonProvesPositive = (
  binary: EsTreeNodeOfType<"BinaryExpression">,
  targetPath: string,
): boolean => {
  const provesForOperandSide = (
    pathSide: EsTreeNode,
    literalSide: EsTreeNode,
    greaterOperator: string,
    greaterOrEqualOperator: string,
  ): boolean => {
    if (memberPathOf(pathSide) !== targetPath) return false;
    const literalValue = numericLiteralValue(literalSide);
    if (literalValue === null) return false;
    if (binary.operator === greaterOperator) return literalValue >= 0;
    if (binary.operator === greaterOrEqualOperator) return literalValue >= 1;
    if (binary.operator === "!==" || binary.operator === "!=") return literalValue === 0;
    if (binary.operator === "===" || binary.operator === "==") return literalValue >= 1;
    return false;
  };
  return (
    provesForOperandSide(binary.left as EsTreeNode, binary.right, ">", ">=") ||
    provesForOperandSide(binary.right, binary.left as EsTreeNode, "<", "<=")
  );
};

// A dominating condition proves the length positive when it is (or
// resolves through identifier initializers to) a `targetPath > 0`-style
// comparison, possibly nested in `&&` — the cloudscape tree-item shape:
// `isExpandable = children.length > 0`, `isExpanded = isExpandable && …`,
// `{isExpanded && children.length && <ul/>}`.
const conditionProvesPositive = (
  condition: EsTreeNode,
  targetPath: string,
  remainingHops: number,
  context: RuleContext,
): boolean => {
  if (remainingHops <= 0) return false;
  const stripped = stripParenExpression(condition);
  if (isNodeOfType(stripped, "BinaryExpression")) {
    return comparisonProvesPositive(stripped, targetPath);
  }
  if (isNodeOfType(stripped, "LogicalExpression") && stripped.operator === "&&") {
    return (
      conditionProvesPositive(stripped.left, targetPath, remainingHops - 1, context) ||
      conditionProvesPositive(stripped.right, targetPath, remainingHops - 1, context)
    );
  }
  if (isNodeOfType(stripped, "Identifier")) {
    const symbol = context.scopes.symbolFor(stripped);
    const initializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
    if (!initializer) return false;
    return conditionProvesPositive(initializer, targetPath, remainingHops - 1, context);
  }
  return false;
};

const isNonEmptyArrayLiteral = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  return (
    isNodeOfType(stripped, "ArrayExpression") &&
    stripped.elements.some((element) => element && !isNodeOfType(element, "SpreadElement"))
  );
};

// `const [features, setFeatures] = useState([…nonEmpty…])` where the
// setter is never referenced: the array can never change, so its length
// is a constant positive number and no `0` can leak.
const isConstantNonEmptyUseStateArray = (
  receiver: EsTreeNodeOfType<"Identifier">,
  context: RuleContext,
): boolean => {
  const binding = findVariableInitializer(receiver, receiver.name);
  if (!binding) return false;
  const pattern = binding.bindingIdentifier.parent;
  if (!pattern || !isNodeOfType(pattern, "ArrayPattern")) return false;
  if (pattern.elements[0] !== binding.bindingIdentifier) return false;
  const declarator = pattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return false;
  }
  const useStateCall = stripParenExpression(declarator.init);
  if (!isHookCallNamed(useStateCall, "useState") || !isNodeOfType(useStateCall, "CallExpression")) {
    return false;
  }
  const initialValue = useStateCall.arguments[0];
  if (!initialValue || !isNonEmptyArrayLiteral(initialValue)) return false;
  const setterElement = pattern.elements[1];
  if (!setterElement) return true;
  if (!isNodeOfType(setterElement, "Identifier")) return false;
  return context.scopes.symbolFor(setterElement)?.references.length === 0;
};

// The function's own top-level returns — nested callbacks' returns are
// theirs, not this function's.
const collectOwnReturnExpressions = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode) || !functionNode.body) return [];
  const body = functionNode.body as EsTreeNode;
  if (!isNodeOfType(body, "BlockStatement")) return [body];
  const returnedExpressions: EsTreeNode[] = [];
  walkAst(body, (child: EsTreeNode) => {
    if (isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement")) {
      // A bare `return;` yields undefined — nullish, so provably safe.
      if (child.argument) returnedExpressions.push(child.argument);
      return false;
    }
  });
  return returnedExpressions;
};

const isNullishExpression = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  if (isNodeOfType(stripped, "Identifier")) return stripped.name === "undefined";
  if (isNodeOfType(stripped, "Literal")) return stripped.value === null;
  return isNodeOfType(stripped, "UnaryExpression") && stripped.operator === "void";
};

const unwrapCallableFunction = (node: EsTreeNode): EsTreeNode | null => {
  const stripped = stripParenExpression(node);
  if (isFunctionLike(stripped)) return stripped;
  if (isHookCallNamed(stripped, "useCallback") && isNodeOfType(stripped, "CallExpression")) {
    const callbackArgument = stripped.arguments[0];
    if (callbackArgument && isFunctionLike(stripParenExpression(callbackArgument))) {
      return stripParenExpression(callbackArgument);
    }
  }
  return null;
};

// Every value this expression can take is either nullish (renders
// nothing) or an array proven non-empty (`allGlobalErrors.length > 0 ?
// allGlobalErrors : undefined`), followed through ternaries, identifier
// initializers, `useMemo` results, and calls to in-file (`useCallback`)
// functions — the remix-forms `globalErrorsToDisplay?.length` shape,
// where `?.length` is undefined or positive and a literal `0` can never
// leak.
const isProvablyNonEmptyOrNullish = (
  node: EsTreeNode,
  remainingHops: number,
  context: RuleContext,
): boolean => {
  if (remainingHops <= 0) return false;
  const stripped = stripParenExpression(node);
  if (isNullishExpression(stripped)) return true;
  if (isNonEmptyArrayLiteral(stripped)) return true;
  if (isNodeOfType(stripped, "ConditionalExpression")) {
    const branchIsProvable = (branch: EsTreeNode): boolean => {
      if (isProvablyNonEmptyOrNullish(branch, remainingHops - 1, context)) return true;
      const branchPath = memberPathOf(branch);
      const test = stripParenExpression(stripped.test);
      return Boolean(
        branchPath &&
        isNodeOfType(test, "BinaryExpression") &&
        comparisonProvesPositive(test, `${branchPath}.length`),
      );
    };
    return (
      branchIsProvable(stripped.consequent) &&
      isProvablyNonEmptyOrNullish(stripped.alternate, remainingHops - 1, context)
    );
  }
  if (isNodeOfType(stripped, "Identifier")) {
    const symbol = context.scopes.symbolFor(stripped);
    const directInitializer = symbol ? getDirectUnreassignedInitializer(symbol) : null;
    if (!directInitializer) return false;
    const initializer = stripParenExpression(directInitializer);
    if (isHookCallNamed(initializer, "useMemo") && isNodeOfType(initializer, "CallExpression")) {
      const memoCallback = initializer.arguments[0];
      if (!memoCallback) return false;
      const returnedExpressions = collectOwnReturnExpressions(stripParenExpression(memoCallback));
      return returnedExpressions.every((returned) =>
        isProvablyNonEmptyOrNullish(returned, remainingHops - 1, context),
      );
    }
    return isProvablyNonEmptyOrNullish(initializer, remainingHops - 1, context);
  }
  if (isNodeOfType(stripped, "CallExpression")) {
    const callee = stripParenExpression(stripped.callee);
    if (!isNodeOfType(callee, "Identifier")) return false;
    const binding = findVariableInitializer(callee, callee.name);
    if (!binding?.initializer) return false;
    const callableFunction = unwrapCallableFunction(binding.initializer);
    if (!callableFunction) return false;
    const returnedExpressions = collectOwnReturnExpressions(callableFunction);
    return returnedExpressions.every((returned) =>
      isProvablyNonEmptyOrNullish(returned, remainingHops - 1, context),
    );
  }
  return false;
};

// A `.length`/`.size` guard whose value is provably positive (or the
// receiver provably non-empty-or-nullish) at this branch cannot render
// a literal `0`, so the finding would be wrong.
const guardedCountCannotBeZero = (
  leakingOperand: EsTreeNode,
  precedingOperands: EsTreeNode[],
  context: RuleContext,
): boolean => {
  const strippedOperand = stripParenExpression(leakingOperand);
  if (!isNodeOfType(strippedOperand, "MemberExpression")) return false;
  const leakPath = memberPathOf(strippedOperand);
  if (
    leakPath &&
    precedingOperands.some((preceding) =>
      conditionProvesPositive(preceding, leakPath, PROVENANCE_HOP_LIMIT, context),
    )
  ) {
    return true;
  }
  const receiver = stripParenExpression(strippedOperand.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (isConstantNonEmptyUseStateArray(receiver, context)) return true;
  return isProvablyNonEmptyOrNullish(receiver, PROVENANCE_HOP_LIMIT, context);
};

// `{errors.length && <p>{errors.length.message}</p>}` — the render side
// reads a member OFF the guard's own `.length` path, proving the guarded
// value is an object (react-hook-form's FieldError for a field named
// "length"), not a count. Numbers have no such chained reads in JSX.
const renderSideReadsMemberOfGuardPath = (
  guardOperand: EsTreeNode,
  renderOperand: EsTreeNode,
): boolean => {
  const guardPath = memberPathOf(guardOperand);
  if (!guardPath) return false;
  let found = false;
  walkAst(renderOperand, (child: EsTreeNode) => {
    if (found) return false;
    if (!isNodeOfType(child, "MemberExpression") || child.computed) return;
    const objectPath = memberPathOf(child.object as EsTreeNode);
    const propertyName = isNodeOfType(child.property, "Identifier") ? child.property.name : null;
    if (objectPath === guardPath && propertyName && !NUMBER_MEMBER_NAMES.has(propertyName)) {
      found = true;
      return false;
    }
  });
  return found;
};

// A `length` member whose receiver's in-file TS type declares `length` as a
// non-numeric member (`interface Track { length: string }` — a duration
// label, not a count) cannot leak a `0`. Resolves one hop: a direct
// `param: Track` annotation or a destructured `({ track }: { track: Track })`
// object-pattern property.
const inFileTypeDeclaresNonNumericLength = (receiverNode: EsTreeNode): boolean => {
  const receiver = stripParenExpression(receiverNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const typeName = resolveReceiverTypeName(receiver);
  if (!typeName) return false;
  let cursor: EsTreeNode | null | undefined = receiver;
  while (cursor && !isNodeOfType(cursor, "Program")) cursor = cursor.parent ?? null;
  if (!cursor) return false;
  let typeNames = nonNumericLengthTypeNamesByProgram.get(cursor);
  if (!typeNames) {
    typeNames = new Set<string>();
    nonNumericLengthTypeNamesByProgram.set(cursor, typeNames);
    walkAst(cursor, (child: EsTreeNode) => {
      if (!isNodeOfType(child, "TSInterfaceDeclaration") || !isNodeOfType(child.id, "Identifier")) {
        return;
      }
      for (const member of child.body?.body ?? []) {
        if (
          isNodeOfType(member, "TSPropertySignature") &&
          !member.computed &&
          isNodeOfType(member.key, "Identifier") &&
          member.key.name === "length" &&
          isNodeOfType(member.typeAnnotation, "TSTypeAnnotation") &&
          !isNodeOfType(member.typeAnnotation.typeAnnotation, "TSNumberKeyword")
        ) {
          typeNames?.add(child.id.name);
          return false;
        }
      }
    });
  }
  return typeNames.has(typeName);
};

const nonNumericLengthTypeNamesByProgram = new WeakMap<EsTreeNode, Set<string>>();

const resolveReceiverTypeName = (receiver: EsTreeNodeOfType<"Identifier">): string | null => {
  let cursor: EsTreeNode | null | undefined = receiver.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      for (const param of cursor.params ?? []) {
        const paramNode = param as EsTreeNode;
        // param: Track
        if (
          isNodeOfType(paramNode, "Identifier") &&
          paramNode.name === receiver.name &&
          isNodeOfType(paramNode.typeAnnotation, "TSTypeAnnotation") &&
          isNodeOfType(paramNode.typeAnnotation.typeAnnotation, "TSTypeReference") &&
          isNodeOfType(paramNode.typeAnnotation.typeAnnotation.typeName, "Identifier")
        ) {
          return paramNode.typeAnnotation.typeAnnotation.typeName.name;
        }
        // ({ track }: { track: Track })
        if (
          isNodeOfType(paramNode, "ObjectPattern") &&
          isNodeOfType(paramNode.typeAnnotation, "TSTypeAnnotation") &&
          isNodeOfType(paramNode.typeAnnotation.typeAnnotation, "TSTypeLiteral")
        ) {
          for (const member of paramNode.typeAnnotation.typeAnnotation.members ?? []) {
            if (
              isNodeOfType(member, "TSPropertySignature") &&
              !member.computed &&
              isNodeOfType(member.key, "Identifier") &&
              member.key.name === receiver.name &&
              isNodeOfType(member.typeAnnotation, "TSTypeAnnotation") &&
              isNodeOfType(member.typeAnnotation.typeAnnotation, "TSTypeReference") &&
              isNodeOfType(member.typeAnnotation.typeAnnotation.typeName, "Identifier")
            ) {
              return member.typeAnnotation.typeAnnotation.typeName.name;
            }
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// True only for expressions whose runtime value is syntactically numeric, so
// short-circuiting to a falsy `0`/`NaN` leaks a visible text node. No type
// inference — comparisons, `!`/`!!`, `Boolean(...)`, strings, and bare
// identifiers are deliberately excluded because their falsy values render
// nothing.
const isSyntacticallyNumeric = (node: EsTreeNode, context: RuleContext): boolean => {
  const stripped = stripParenExpression(node);

  if (isNodeOfType(stripped, "MemberExpression")) {
    const propertyName = getStaticPropertyName(stripped);
    if (propertyName === "length") {
      return !inFileTypeDeclaresNonNumericLength(stripped.object as EsTreeNode);
    }
    if (propertyName === "size") return isProvableCollectionReceiver(stripped.object);
    return false;
  }

  if (
    isNodeOfType(stripped, "BinaryExpression") &&
    (ARITHMETIC_BINARY_OPERATORS.has(stripped.operator) ||
      (stripped.operator === "+" &&
        isSyntacticallyNumeric(stripped.left, context) &&
        isSyntacticallyNumeric(stripped.right, context)))
  ) {
    return true;
  }

  if (
    isNodeOfType(stripped, "CallExpression") &&
    isNodeOfType(stripped.callee, "Identifier") &&
    NUMERIC_COERCION_CALLEE_NAMES.has(stripped.callee.name) &&
    context.scopes.isGlobalReference(stripped.callee)
  ) {
    return true;
  }

  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "number") return true;

  return false;
};

const isJsxProducingMapCall = (node: EsTreeNode): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== "map"
  ) {
    return false;
  }
  const callback = node.arguments[0];
  return Boolean(
    callback &&
    (isNodeOfType(callback, "ArrowFunctionExpression") ||
      isNodeOfType(callback, "FunctionExpression")) &&
    containsJsxElement(callback),
  );
};

const isRenderExpression = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  return isJsxNode(stripped) || isJsxProducingMapCall(stripped);
};

// A falsy-numeric `&&` leaks its `0` whenever the expression's value
// reaches a JSX child position, including through ternary branches, the
// right arm of any logical, and the LEFT arm of `&&`/`??` — a falsy left
// IS the `&&` result, and `0` is not nullish so `??` passes it through.
// Only a left arm of `||` swallows the falsy value.
const flowsIntoJsxChild = (node: EsTreeNode): boolean => {
  let current: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = current.parent;
  while (parent) {
    if (isNodeOfType(parent, "JSXExpressionContainer")) {
      const containerParent = parent.parent;
      return Boolean(
        containerParent &&
        (isNodeOfType(containerParent, "JSXElement") ||
          isNodeOfType(containerParent, "JSXFragment")),
      );
    }
    const isPassthroughWrapper = PASSTHROUGH_WRAPPER_PARENT_TYPES.has(parent.type);
    const isFlowingConditionalBranch =
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current);
    const isFlowingLogicalArm =
      isNodeOfType(parent, "LogicalExpression") &&
      (parent.right === current || (parent.left === current && parent.operator !== "||"));
    if (!isPassthroughWrapper && !isFlowingConditionalBranch && !isFlowingLogicalArm) {
      return false;
    }
    current = parent;
    parent = parent.parent;
  }
  return false;
};

export const jsxNumericAndLeakedRender = defineRule({
  id: "jsx-numeric-and-leaked-render",
  title: "Numeric && renders a stray 0",
  severity: "warn",
  recommendation:
    "In `{items.length && <List/>}` React renders a literal `0` when the count is 0. Compare explicitly (`items.length > 0 && <List/>`) or use a ternary (`items.length ? <List/> : null`).",
  create: (context: RuleContext) => ({
    LogicalExpression(node: EsTreeNodeOfType<"LogicalExpression">) {
      if (node.operator !== "&&") return;

      // Only handle the outermost `&&` of a chain; inner ones are folded in
      // via `flattenLogicalAndChain` below.
      const parent = node.parent;
      if (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&") return;

      if (!flowsIntoJsxChild(node)) return;

      const operands = flattenLogicalAndChain(node);
      const renderOperand = operands[operands.length - 1];
      if (!renderOperand || !isRenderExpression(renderOperand)) return;

      const leakingOperand = operands
        .slice(0, -1)
        .find((guardOperand) => isSyntacticallyNumeric(guardOperand, context));
      if (!leakingOperand) return;
      if (renderSideReadsMemberOfGuardPath(leakingOperand, renderOperand)) return;
      const precedingOperands = operands.slice(0, operands.indexOf(leakingOperand));
      if (guardedCountCannotBeZero(leakingOperand, precedingOperands, context)) return;

      context.report({
        node: leakingOperand,
        message:
          "React renders a literal `0` into your page when this count is 0 instead of nothing — compare it explicitly (`count > 0 && <X/>`) or use a ternary (`count ? <X/> : null`).",
      });
    },
  }),
});
