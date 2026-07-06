import { INDEX_PARAMETER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  containsStatefulDescendant,
  PURE_SVG_PRIMITIVE_TAGS,
  STATELESS_HTML_LEAF_TAGS,
} from "../../utils/jsx-stateless-leaf.js";

const STRING_COERCION_FUNCTIONS = new Set(["String", "Number"]);

const ITERATOR_METHOD_NAMES = new Set(["map", "flatMap", "forEach"]);

const MUTATING_ARRAY_METHOD_NAMES = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const TYPE_RESOLUTION_DEPTH_LIMIT = 4;

// The identifiers a key expression could get its value from — the bare
// identifier, template-literal slots, `x.toString()`, `String(x)` /
// `Number(x)`, and `x + ""` / `"" + x` coercions.
const extractCandidateIdentifiers = (
  expression: EsTreeNode,
): Array<EsTreeNodeOfType<"Identifier">> => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Identifier")) return [node];

  if (isNodeOfType(node, "TemplateLiteral")) {
    const identifiers: Array<EsTreeNodeOfType<"Identifier">> = [];
    for (const templateExpression of node.expressions ?? []) {
      if (isNodeOfType(templateExpression, "Identifier")) identifiers.push(templateExpression);
    }
    return identifiers;
  }

  if (isNodeOfType(node, "CallExpression")) {
    if (
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "toString"
    ) {
      return [node.callee.object];
    }
    if (
      isNodeOfType(node.callee, "Identifier") &&
      STRING_COERCION_FUNCTIONS.has(node.callee.name) &&
      isNodeOfType(node.arguments?.[0], "Identifier")
    ) {
      return [node.arguments[0]];
    }
    return [];
  }

  if (isNodeOfType(node, "BinaryExpression") && node.operator === "+") {
    if (
      isNodeOfType(node.left, "Identifier") &&
      isNodeOfType(node.right, "Literal") &&
      node.right.value === ""
    ) {
      return [node.left];
    }
    if (
      isNodeOfType(node.right, "Identifier") &&
      isNodeOfType(node.left, "Literal") &&
      node.left.value === ""
    ) {
      return [node.right];
    }
  }

  return [];
};

// `Array(count)` / `new Array(count)` with at most one argument is a
// placeholder construction: a numeric argument makes N identityless
// holes, and any other single value makes a one-element list that
// cannot reorder. Two-plus arguments build a real element list instead.
const isArrayConstructorPlaceholderCall = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (
    (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "NewExpression")) &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "Array"
  ) {
    return (node.arguments?.length ?? 0) <= 1;
  }
  return false;
};

const isArrayFromCall = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "from",
  );
};

const isBindingReassignedOrMutated = (referenceNode: EsTreeNode, bindingName: string): boolean => {
  const programRoot = findProgramRoot(referenceNode);
  if (!programRoot) return false;
  let didFindWrite = false;
  walkAst(programRoot, (child: EsTreeNode): boolean | void => {
    if (didFindWrite) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === bindingName
    ) {
      didFindWrite = true;
      return false;
    }
    if (
      isNodeOfType(child, "UpdateExpression") &&
      isNodeOfType(child.argument, "Identifier") &&
      child.argument.name === bindingName
    ) {
      didFindWrite = true;
      return false;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.object, "Identifier") &&
      child.callee.object.name === bindingName &&
      isNodeOfType(child.callee.property, "Identifier") &&
      MUTATING_ARRAY_METHOD_NAMES.has(child.callee.property.name)
    ) {
      didFindWrite = true;
      return false;
    }
  });
  return didFindWrite;
};

/**
 * True if the receiver looks like a placeholder constructor whose
 * elements have no identity beyond their position — i.e. `Array.from(...)`,
 * `Array(N)`, `new Array(N)`, `<placeholder>.fill(...)`, or
 * `[...<placeholder>]`.
 */
const isStaticPlaceholderReceiver = (receiver: EsTreeNode, depth = 0): boolean => {
  if (isArrayFromCall(receiver)) return true;
  if (isArrayConstructorPlaceholderCall(receiver)) return true;

  if (isNodeOfType(receiver, "Identifier")) {
    if (depth >= TYPE_RESOLUTION_DEPTH_LIMIT) return false;
    const binding = findVariableInitializer(receiver, receiver.name);
    if (!binding?.initializer) return false;
    if (isBindingReassignedOrMutated(receiver, receiver.name)) return false;
    return isStaticPlaceholderReceiver(binding.initializer, depth + 1);
  }

  if (isNodeOfType(receiver, "CallExpression")) {
    const callee = receiver.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "fill" &&
      depth < TYPE_RESOLUTION_DEPTH_LIMIT &&
      isStaticPlaceholderReceiver(callee.object, depth + 1)
    )
      return true;
  }

  if (isNodeOfType(receiver, "ArrayExpression") && receiver.elements?.length === 1) {
    const only = receiver.elements[0];
    if (only && isNodeOfType(only, "SpreadElement") && depth < TYPE_RESOLUTION_DEPTH_LIMIT) {
      return isStaticPlaceholderReceiver(only.argument, depth + 1);
    }
  }

  return false;
};

const isSpreadFreeArrayLiteral = (node: EsTreeNode): boolean => {
  const stripped = stripParenExpression(node);
  if (!isNodeOfType(stripped, "ArrayExpression")) return false;
  const elements = stripped.elements ?? [];
  if (elements.length === 0) return false;
  for (const element of elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) return false;
  }
  return true;
};

const isUseMemoCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name === "useMemo";
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "useMemo"
  );
};

// `useMemo(factory, [])` computes the list exactly once for the
// component's lifetime — it can never reorder or filter afterwards.
const hasEmptyDependencyArray = (useMemoCall: EsTreeNode): boolean => {
  if (!isNodeOfType(useMemoCall, "CallExpression")) return false;
  const dependencies = useMemoCall.arguments?.[1];
  return Boolean(
    dependencies &&
    isNodeOfType(dependencies, "ArrayExpression") &&
    (dependencies.elements ?? []).length === 0,
  );
};

// `useMemo(() => [ … ], deps)` where every return is a spread-free
// array literal — the memoized list is rebuilt positionally each time,
// so it can never reorder or filter.
const useMemoReturnsArrayLiteral = (useMemoCall: EsTreeNode): boolean => {
  if (!isNodeOfType(useMemoCall, "CallExpression")) return false;
  const factory = useMemoCall.arguments?.[0];
  if (!factory || !isFunctionLike(factory)) return false;
  const body = factory.body;
  if (!isNodeOfType(body, "BlockStatement")) return isSpreadFreeArrayLiteral(body);
  let didFindReturn = false;
  let allReturnsAreFixedArrays = true;
  walkAst(body, (child: EsTreeNode): boolean | void => {
    if (isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement")) {
      didFindReturn = true;
      if (!child.argument || !isSpreadFreeArrayLiteral(child.argument)) {
        allReturnsAreFixedArrays = false;
      }
      return false;
    }
  });
  return didFindReturn && allReturnsAreFixedArrays;
};

/**
 * A spread-free array literal (directly, via a never-reassigned,
 * never-mutated binding, or via a `useMemo` factory returning one) has
 * a fixed length and fixed positional meaning at every render — the
 * list can never reorder or filter, so an index key cannot
 * misassociate entries.
 */
const isStaticArrayLiteralReceiver = (receiver: EsTreeNode, depth = 0): boolean => {
  const node = stripParenExpression(receiver);
  if (isSpreadFreeArrayLiteral(node)) return true;
  if (isNodeOfType(node, "Identifier")) {
    if (depth >= TYPE_RESOLUTION_DEPTH_LIMIT) return false;
    const binding = findVariableInitializer(node, node.name);
    if (!binding?.initializer) return false;
    // Only a direct declarator init proves the value — a destructuring
    // default only applies when the source is undefined.
    const declarator = binding.bindingIdentifier.parent;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== binding.initializer
    ) {
      return false;
    }
    if (isBindingReassignedOrMutated(node, node.name)) return false;
    const initializer = stripParenExpression(binding.initializer);
    if (isUseMemoCall(initializer)) {
      return useMemoReturnsArrayLiteral(initializer) || hasEmptyDependencyArray(initializer);
    }
    return isStaticArrayLiteralReceiver(initializer, depth + 1);
  }
  return false;
};

const isArrayFromLengthObjectCall = (node: EsTreeNode): boolean => {
  if (!isArrayFromCall(node)) return false;
  if (!isNodeOfType(node, "CallExpression")) return false;
  const first = node.arguments?.[0];
  if (!first || !isNodeOfType(first, "ObjectExpression")) return false;
  for (const prop of first.properties ?? []) {
    if (!isNodeOfType(prop, "Property")) continue;
    const key = prop.key;
    const isLengthKey =
      (isNodeOfType(key, "Identifier") && key.name === "length") ||
      (isNodeOfType(key, "Literal") && key.value === "length");
    if (!isLengthKey) continue;
    if (isNodeOfType(prop.value, "Literal") && typeof prop.value.value === "number") return true;
    if (isNodeOfType(prop.value, "Identifier") && prop.value.name === "undefined") return true;
    // also accept simple identifier — `{length: count}` — assume it's a numeric
    // constant; almost always is in placeholder constructions.
    if (isNodeOfType(prop.value, "Identifier")) return true;
    // `{length: values.length}` — a `.length` read is a numeric count too.
    if (
      isNodeOfType(prop.value, "MemberExpression") &&
      isNodeOfType(prop.value.property, "Identifier") &&
      prop.value.property.name === "length"
    )
      return true;
  }
  return false;
};

const isStringKeywordAnnotation = (typeAnnotation: EsTreeNode | null | undefined): boolean =>
  Boolean(
    typeAnnotation &&
    isNodeOfType(typeAnnotation, "TSTypeAnnotation") &&
    isNodeOfType(typeAnnotation.typeAnnotation, "TSStringKeyword"),
  );

const findSameFileTypeDeclaration = (
  referenceNode: EsTreeNode,
  typeName: string,
): EsTreeNode | null => {
  const programRoot = findProgramRoot(referenceNode);
  if (!programRoot || !isNodeOfType(programRoot, "Program")) return null;
  for (const statement of programRoot.body) {
    const declaration: EsTreeNode | null = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (!declaration) continue;
    if (
      (isNodeOfType(declaration, "TSInterfaceDeclaration") ||
        isNodeOfType(declaration, "TSTypeAliasDeclaration")) &&
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id.name === typeName
    ) {
      return declaration;
    }
  }
  return null;
};

// Does `typeNode` (a type-literal, or a reference to a same-file
// interface / type alias) declare `propertyName: string`?
const typeDeclaresStringProperty = (
  typeNode: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
  depth: number,
): boolean => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return false;
  let members: ReadonlyArray<EsTreeNode> | null = null;
  if (isNodeOfType(typeNode, "TSTypeLiteral")) members = typeNode.members;
  else if (isNodeOfType(typeNode, "TSInterfaceDeclaration")) members = typeNode.body.body;
  if (members) {
    for (const member of members) {
      if (!isNodeOfType(member, "TSPropertySignature")) continue;
      if (!isNodeOfType(member.key, "Identifier") || member.key.name !== propertyName) continue;
      return isStringKeywordAnnotation(member.typeAnnotation);
    }
    return false;
  }
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    return typeDeclaresStringProperty(
      typeNode.typeAnnotation,
      propertyName,
      referenceNode,
      depth + 1,
    );
  }
  if (isNodeOfType(typeNode, "TSTypeReference") && isNodeOfType(typeNode.typeName, "Identifier")) {
    const declaration = findSameFileTypeDeclaration(referenceNode, typeNode.typeName.name);
    if (!declaration) return false;
    return typeDeclaresStringProperty(declaration, propertyName, referenceNode, depth + 1);
  }
  return false;
};

// `{ name }: MatchedNameProps` / `{ name }: { name: string }` — the
// identifier is destructured from an object pattern whose annotation
// (inline type literal, or same-file interface / type alias) declares
// the property as `string`.
const isDestructuredFromStringTypedPattern = (bindingIdentifier: EsTreeNode): boolean => {
  const property = bindingIdentifier.parent;
  if (!property || !isNodeOfType(property, "Property")) return false;
  if (!isNodeOfType(property.key, "Identifier")) return false;
  const pattern = property.parent;
  if (!pattern || !isNodeOfType(pattern, "ObjectPattern")) return false;
  const typeAnnotation = pattern.typeAnnotation;
  if (!typeAnnotation || !isNodeOfType(typeAnnotation, "TSTypeAnnotation")) return false;
  return typeDeclaresStringProperty(
    typeAnnotation.typeAnnotation,
    property.key.name,
    bindingIdentifier,
    0,
  );
};

// Provably-string expressions only — a wrong exemption here silences a
// real reorder hazard, so name heuristics are deliberately not used.
const isProvablyStringValued = (expression: EsTreeNode, depth: number): boolean => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return false;
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Literal")) return typeof node.value === "string";
  if (isNodeOfType(node, "TemplateLiteral")) return true;
  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "String"
  ) {
    return true;
  }
  if (isNodeOfType(node, "Identifier")) {
    const binding = findVariableInitializer(node, node.name);
    if (!binding) return false;
    if (binding.initializer && isProvablyStringValued(binding.initializer, depth + 1)) return true;
    if (
      isNodeOfType(binding.bindingIdentifier, "Identifier") &&
      isStringKeywordAnnotation(binding.bindingIdentifier.typeAnnotation)
    ) {
      return true;
    }
    return isDestructuredFromStringTypedPattern(binding.bindingIdentifier);
  }
  return false;
};

const hasProvablyStringFirstArgument = (callNode: EsTreeNode): boolean => {
  if (!isNodeOfType(callNode, "CallExpression")) return false;
  const source = callNode.arguments?.[0];
  return Boolean(source && isProvablyStringValued(source, 0));
};

/**
 * `[...str]`, `str.split(...)`, and `Array.from(str)` slice ONE string
 * into positional fragments (characters, lines, tokens). Fragment
 * position IS the entry's stable identity — nothing reorders, filters,
 * or carries per-item state — so an index key is correct there.
 * `.split(...)` needs no string proof (only strings have `.split`);
 * the spread / `Array.from` forms do, because both are equally common
 * on arrays.
 */
const isStringDerivedReceiver = (receiver: EsTreeNode, depth = 0): boolean => {
  const node = stripParenExpression(receiver);
  // `const parts = line.split(" "); parts.map(...)` — follow the local
  // binding to its initializer (bounded, one hop per level).
  if (isNodeOfType(node, "Identifier")) {
    if (depth >= TYPE_RESOLUTION_DEPTH_LIMIT) return false;
    const binding = findVariableInitializer(node, node.name);
    if (!binding?.initializer) return false;
    return isStringDerivedReceiver(binding.initializer, depth + 1);
  }
  if (isNodeOfType(node, "ArrayExpression") && node.elements?.length === 1) {
    const only = node.elements[0];
    if (only && isNodeOfType(only, "SpreadElement")) {
      return isProvablyStringValued(only.argument, 0);
    }
  }
  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "split"
  ) {
    return true;
  }
  return isArrayFromCall(node) && hasProvablyStringFirstArgument(node);
};

// The call this function is an iterator callback of — `items.map(fn)`,
// `items.flatMap(fn)`, `items.forEach(fn)`, `Array.from(src, fn)` —
// or null when the function is not directly such a callback.
const findIteratorCallOfCallback = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return null;
  if (!parent.arguments.includes(functionNode as never)) return null;
  const callee = parent.callee;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    ITERATOR_METHOD_NAMES.has(callee.property.name)
  ) {
    return parent;
  }
  if (isArrayFromCall(parent) && parent.arguments[1] === functionNode) return parent;
  return null;
};

interface EnclosingParameterInfo {
  functionNode: EsTreeNode;
  parameterPosition: number;
  parameterRoot: EsTreeNode;
}

// If the binding identifier is declared inside a function's parameter
// list, return the function, the parameter slot it sits in, and the
// top-level pattern node of that slot.
const findEnclosingParameter = (bindingIdentifier: EsTreeNode): EnclosingParameterInfo | null => {
  let current: EsTreeNode = bindingIdentifier;
  while (current.parent) {
    const parent = current.parent;
    if (isFunctionLike(parent)) {
      const parameters = parent.params ?? [];
      const parameterPosition = parameters.indexOf(current as never);
      return parameterPosition >= 0
        ? { functionNode: parent, parameterPosition, parameterRoot: current }
        : null;
    }
    if (isNodeOfType(parent, "VariableDeclarator") || isNodeOfType(parent, "Program")) return null;
    current = parent;
  }
  return null;
};

// `.entries()` on anything except `Object` — an Array `entries()` tuple
// leads with the positional index. (`Object.entries` tuples lead with a
// stable property key instead.)
const isArrayEntriesCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "entries" &&
  !(isNodeOfType(node.callee.object, "Identifier") && node.callee.object.name === "Object");

const containsArrayEntriesCall = (node: EsTreeNode): boolean => {
  let didFindEntriesCall = false;
  walkAst(node, (child: EsTreeNode): boolean | void => {
    if (didFindEntriesCall) return false;
    if (isArrayEntriesCall(child)) {
      didFindEntriesCall = true;
      return false;
    }
  });
  return didFindEntriesCall;
};

// `[...items.entries()].map(([index, item]) => …)` — the first tuple
// element of an array `entries()` destructure IS the positional index.
// Name-gated: a `Map#entries()` tuple leads with a stable key instead,
// and the two receivers are indistinguishable statically.
const isEntriesTupleIndexParameter = (
  bindingIdentifier: EsTreeNode,
  indexName: string,
  parameterInfo: EnclosingParameterInfo,
): boolean => {
  if (!INDEX_PARAMETER_NAMES.has(indexName)) return false;
  const arrayPattern = bindingIdentifier.parent;
  if (!arrayPattern || !isNodeOfType(arrayPattern, "ArrayPattern")) return false;
  if (arrayPattern !== parameterInfo.parameterRoot) return false;
  if (arrayPattern.elements?.[0] !== bindingIdentifier) return false;
  const iteratorCall = findIteratorCallOfCallback(parameterInfo.functionNode);
  if (!iteratorCall) return false;
  const source = isArrayFromCall(iteratorCall)
    ? iteratorCall.arguments?.[0]
    : isNodeOfType(iteratorCall.callee, "MemberExpression")
      ? iteratorCall.callee.object
      : null;
  return Boolean(source && containsArrayEntriesCall(source));
};

// `for (const [index, item] of items.entries()) { … }` — same tuple
// shape as above, bound by a for-of instead of a callback.
const isForOfEntriesTupleBinding = (bindingIdentifier: EsTreeNode): boolean => {
  const arrayPattern = bindingIdentifier.parent;
  if (!arrayPattern || !isNodeOfType(arrayPattern, "ArrayPattern")) return false;
  if (arrayPattern.elements?.[0] !== bindingIdentifier) return false;
  const declarator = arrayPattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return false;
  const forOfStatement = declaration.parent;
  if (!forOfStatement || !isNodeOfType(forOfStatement, "ForOfStatement")) return false;
  if (forOfStatement.left !== declaration) return false;
  return isArrayEntriesCall(stripParenExpression(forOfStatement.right));
};

// A numeric-literal declarator is a positional counter only when it
// drives a `for(;;)` loop or is incremented / reassigned somewhere —
// a plain `const index = 5` is a fixed value, not an array index.
const isLoopCounterDeclarator = (
  declarator: EsTreeNode,
  referenceNode: EsTreeNode,
  indexName: string,
): boolean => {
  const declaration = declarator.parent;
  if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
    const forStatement = declaration.parent;
    if (
      forStatement &&
      isNodeOfType(forStatement, "ForStatement") &&
      forStatement.init === declaration
    ) {
      return true;
    }
  }
  return isBindingReassignedOrMutated(referenceNode, indexName);
};

interface PositionalIndexBinding {
  // The `.map` / `.flatMap` / `.forEach` / `Array.from` call whose
  // callback binds the index, when the index came from one.
  iteratorCall: EsTreeNodeOfType<"CallExpression"> | null;
}

interface PositionalIndexUse {
  identifier: EsTreeNodeOfType<"Identifier">;
  binding: PositionalIndexBinding;
}

/**
 * Resolves whether an identifier is PROVABLY the positional array
 * index, by classifying its binding:
 *   - second-or-later direct parameter of an iterator callback → index
 *     (any name — `.map((item, key) => …)` still positions `key` as
 *     the index);
 *   - second-or-later direct parameter of any other function → index
 *     only when the name matches (`index` / `idx` / `i`), since render
 *     props usually forward the map index;
 *   - anything bound inside the FIRST parameter (the item itself, or a
 *     property destructured from it) → NOT the index;
 *   - array `entries()` tuple destructures → index (name-gated);
 *   - numeric-literal loop counters → index;
 *   - a variable laundered from any of the above (`const key = index`,
 *     `const key = \`item-\${i}\``) → index, resolved transitively.
 * Unprovable bindings (state values, props, imports) stay silent —
 * precision over recall.
 */
const resolvePositionalIndexBinding = (
  identifierNode: EsTreeNodeOfType<"Identifier">,
  depth: number,
): PositionalIndexBinding | null => {
  if (depth > TYPE_RESOLUTION_DEPTH_LIMIT) return null;
  const binding = findVariableInitializer(identifierNode, identifierNode.name);
  if (!binding) return null;

  const parameterInfo = findEnclosingParameter(binding.bindingIdentifier);
  if (parameterInfo) {
    if (parameterInfo.parameterPosition >= 1) {
      const isDirectIdentifierParameter =
        parameterInfo.parameterRoot === binding.bindingIdentifier ||
        (isNodeOfType(parameterInfo.parameterRoot, "AssignmentPattern") &&
          parameterInfo.parameterRoot.left === binding.bindingIdentifier);
      if (!isDirectIdentifierParameter) return null;
      const iteratorCall = findIteratorCallOfCallback(parameterInfo.functionNode);
      if (iteratorCall) return { iteratorCall };
      return INDEX_PARAMETER_NAMES.has(identifierNode.name) ? { iteratorCall: null } : null;
    }
    return isEntriesTupleIndexParameter(
      binding.bindingIdentifier,
      identifierNode.name,
      parameterInfo,
    )
      ? { iteratorCall: null }
      : null;
  }

  const declarator = binding.bindingIdentifier.parent;
  if (
    declarator &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.id === binding.bindingIdentifier &&
    declarator.init
  ) {
    const initializer = stripParenExpression(declarator.init);
    if (isNodeOfType(initializer, "Literal") && typeof initializer.value === "number") {
      return isLoopCounterDeclarator(declarator, identifierNode, identifierNode.name)
        ? { iteratorCall: null }
        : null;
    }
    return findPositionalIndexUse(initializer, depth + 1)?.binding ?? null;
  }

  if (
    INDEX_PARAMETER_NAMES.has(identifierNode.name) &&
    isForOfEntriesTupleBinding(binding.bindingIdentifier)
  ) {
    return { iteratorCall: null };
  }

  return null;
};

const findPositionalIndexUse = (
  expression: EsTreeNode,
  depth: number,
): PositionalIndexUse | null => {
  for (const candidate of extractCandidateIdentifiers(expression)) {
    const binding = resolvePositionalIndexBinding(candidate, depth);
    if (binding) return { identifier: candidate, binding };
  }
  return null;
};

// Receiver-level exemptions applied to the exact iterator call whose
// callback binds the index (not a walk-up guess): placeholder arrays,
// static array literals, and string-sliced fragments all have position
// as the entry's identity.
const iteratorCallExemptsIndexKey = (iteratorCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (isArrayFromCall(iteratorCall)) {
    return (
      isArrayFromLengthObjectCall(iteratorCall) || hasProvablyStringFirstArgument(iteratorCall)
    );
  }
  if (!isNodeOfType(iteratorCall.callee, "MemberExpression")) return false;
  const receiver = iteratorCall.callee.object;
  return (
    isStaticPlaceholderReceiver(receiver) ||
    isStaticArrayLiteralReceiver(receiver) ||
    isStringDerivedReceiver(receiver)
  );
};

/**
 * Walk up from a JSXAttribute node looking for the enclosing iterator
 * callback (`.map(cb)`, `.flatMap(cb)`, `.forEach(cb)`, `Array.from(_, cb)`)
 * and return the names bound by the first parameter — `item` in
 * `arr.map((item, index) => …)`, or every destructured field in
 * `arr.map(({ id, label }, index) => …)`.
 */
const findIteratorItemNames = (node: EsTreeNode): Set<string> | null => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;

    // Stop crossing function boundaries unless we're crossing INTO the
    // iterator callback itself.
    if (
      isFunctionLike(current) &&
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.includes(current as never)
    ) {
      const callee = parent.callee;
      const isIteratorMethodCall =
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        ITERATOR_METHOD_NAMES.has(callee.property.name);
      const isArrayFromCallback =
        isArrayFromCall(parent) && parent.arguments.length >= 2 && parent.arguments[1] === current;

      if (isIteratorMethodCall || isArrayFromCallback) {
        const cbParams = (current as EsTreeNodeOfType<"ArrowFunctionExpression">).params ?? [];
        const first = cbParams[0];
        if (!first) return null;
        const names = new Set<string>();
        collectPatternNames(first, names);
        return names.size > 0 ? names : null;
      }
    }

    current = parent;
  }
  return null;
};

const templateLiteralHasIteratorIdentity = (
  template: EsTreeNodeOfType<"TemplateLiteral">,
  itemNames: ReadonlySet<string>,
): boolean => {
  for (const expression of template.expressions ?? []) {
    // `${String(option.value)}-${index}` — the coercion wrapper hides
    // the item read from root-identifier resolution; unwrap it.
    const unwrapped =
      isNodeOfType(expression, "CallExpression") &&
      isNodeOfType(expression.callee, "Identifier") &&
      STRING_COERCION_FUNCTIONS.has(expression.callee.name) &&
      expression.arguments?.[0]
        ? expression.arguments[0]
        : expression;
    const rootName = getRootIdentifierName(unwrapped, { followCallChains: true });
    if (rootName !== null && itemNames.has(rootName)) return true;
  }
  return false;
};

/**
 * True when the JSX key value is a template literal mixing an index with at
 * least one stable per-item identifier (e.g. `${item.id}-${index}`). Common
 * defensive pattern in user code — the index is just a uniqueness fallback,
 * the real identity is `item.id`.
 */
const isCompositeKeyWithIteratorIdentity = (
  keyExpression: EsTreeNode,
  attributeNode: EsTreeNode,
): boolean => {
  if (!isNodeOfType(keyExpression, "TemplateLiteral")) return false;
  const expressions = keyExpression.expressions ?? [];
  if (expressions.length < 2) return false;
  const itemNames = findIteratorItemNames(attributeNode);
  if (!itemNames) return false;
  return templateLiteralHasIteratorIdentity(keyExpression, itemNames);
};

const forLoopTestReadsDataLength = (test: EsTreeNode): boolean => {
  let didFindLengthRead = false;
  walkAst(test, (child: EsTreeNode): boolean | void => {
    if (didFindLengthRead) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      child.property.name === "length"
    ) {
      didFindLengthRead = true;
      return false;
    }
  });
  return didFindLengthRead;
};

// `for (let i = 0; i < count; i++) { children.push(<Col key={i} />) }` is
// the imperative twin of the exempt `Array.from({length: count}).map(…)`
// placeholder — the counter has no identity beyond its position.
const isNumericForLoopCounter = (attributeNode: EsTreeNode, indexName: string): boolean => {
  const binding = findVariableInitializer(attributeNode, indexName);
  if (!binding) return false;
  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return false;
  const forStatement = declaration.parent;
  if (
    !forStatement ||
    !isNodeOfType(forStatement, "ForStatement") ||
    forStatement.init !== declaration ||
    !declarator.init ||
    !isNodeOfType(declarator.init, "Literal") ||
    typeof declarator.init.value !== "number"
  ) {
    return false;
  }
  // `for (let i = 0; i < items.length; i++)` walks real list data — the
  // items carry identity, so an index key there still breaks on reorder.
  if (forStatement.test && forLoopTestReadsDataLength(forStatement.test as EsTreeNode)) {
    return false;
  }
  return true;
};

// A fragment has no DOM identity of its own, but its CHILDREN inherit
// the key's identity — reordering an index-keyed fragment wrapping an
// input loses that input's state just like a keyed div would.
const fragmentHasStatefulChildren = (openingElement: EsTreeNode): boolean => {
  const jsxElement = openingElement.parent;
  if (!jsxElement || !isNodeOfType(jsxElement, "JSXElement")) return false;
  const children = jsxElement.children ?? [];
  return children.some((child) => containsStatefulDescendant(child));
};

export const noArrayIndexAsKey = defineRule({
  id: "no-array-index-as-key",
  title: "Array index used as a key",
  severity: "warn",
  recommendation:
    "Use a stable id from the item, like `key={item.id}` or `key={item.slug}`. Index keys break when the list reorders or filters.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "key") return;
      if (!node.value || !isNodeOfType(node.value, "JSXExpressionContainer")) return;

      const indexUse = findPositionalIndexUse(node.value.expression, 0);
      if (!indexUse) return;
      const indexName = indexUse.identifier.name;
      if (isNumericForLoopCounter(node, indexName)) return;
      if (
        indexUse.binding.iteratorCall &&
        iteratorCallExemptsIndexKey(indexUse.binding.iteratorCall)
      ) {
        return;
      }
      if (isCompositeKeyWithIteratorIdentity(node.value.expression, node)) return;

      // Pure SVG primitives (`<g>`, `<path>`, …) only re-diff
      // attributes on reorder — a misidentification has no observable
      // consequence (there's nothing to lose).
      const openingElement = node.parent;
      if (openingElement && isNodeOfType(openingElement, "JSXOpeningElement")) {
        const elementName = openingElement.name as EsTreeNode;
        if (isNodeOfType(elementName, "JSXIdentifier")) {
          if (elementName.name === "Fragment") {
            if (!fragmentHasStatefulChildren(openingElement)) return;
          } else if (PURE_SVG_PRIMITIVE_TAGS.has(elementName.name)) {
            return;
          } else if (STATELESS_HTML_LEAF_TAGS.has(elementName.name)) {
            // Stateless HTML leaf element whose subtree contains no
            // form controls, no media, no custom components, no
            // function-call children — reorder hazard doesn't apply.
            const jsxElement = openingElement.parent;
            if (jsxElement && isNodeOfType(jsxElement, "JSXElement")) {
              if (!containsStatefulDescendant(jsxElement as EsTreeNode)) return;
            }
          }
        }
        if (
          isNodeOfType(elementName, "JSXMemberExpression") &&
          isNodeOfType(elementName.object, "JSXIdentifier") &&
          isNodeOfType(elementName.property, "JSXIdentifier") &&
          elementName.object.name === "React" &&
          elementName.property.name === "Fragment" &&
          !fragmentHasStatefulChildren(openingElement)
        ) {
          return;
        }
      }

      context.report({
        node,
        message: `Your users can see & submit the wrong data when this list reorders or filters, so use a stable id like \`key={item.id}\`, not the array index "${indexName}".`,
      });
    },
  }),
});
