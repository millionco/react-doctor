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

// Inline text-run elements: an index-keyed sequence of these renders
// decomposed text (syntax-highlight tokens, ANSI-decoded fragments) whose
// position IS its identity, matching the string-derived carve-out in
// spirit. Block/list rows (`li`, `tr`, `div`) stay conservative — their
// items are data records that can carry real identity.
const INLINE_TEXT_LEAF_TAGS = new Set([
  "span",
  "b",
  "i",
  "em",
  "strong",
  "small",
  "mark",
  "del",
  "ins",
  "sub",
  "sup",
  "u",
  "s",
  "code",
  "kbd",
  "samp",
  "var",
  "abbr",
  "cite",
  "q",
  "bdi",
  "bdo",
  "time",
  "data",
]);

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

const ARITHMETIC_KEY_OPERATORS = new Set(["+", "-", "*", "/", "%"]);
const bindingMutationResultsByProgram = new WeakMap<EsTreeNode, Map<string, boolean>>();

// The identifiers a key expression could get its value from — the bare
// identifier, template-literal slots, `x.toString()`, `String(x)` /
// `Number(x)`, `x + ""` / `"" + x` coercions, arithmetic offsets
// (`x + 1`, `x * 2`), and unary negation (`-x`).
const extractCandidateIdentifiers = (
  expression: EsTreeNode,
): Array<EsTreeNodeOfType<"Identifier">> => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Identifier")) return [node];

  // `-index` / `+index` / `~index` — still index-derived: the mapping
  // from position to key is injective, so reorders remint keys.
  if (
    isNodeOfType(node, "UnaryExpression") &&
    (node.operator === "-" || node.operator === "+" || node.operator === "~") &&
    isNodeOfType(node.argument, "Identifier")
  ) {
    return [node.argument];
  }

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

  if (isNodeOfType(node, "BinaryExpression")) {
    if (node.operator === "+") {
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
    // `index + 1` / `index - 1` / `index * 2` — a numeric-literal offset
    // keeps the key index-derived (injective in the position).
    if (ARITHMETIC_KEY_OPERATORS.has(node.operator)) {
      if (
        isNodeOfType(node.left, "Identifier") &&
        isNodeOfType(node.right, "Literal") &&
        typeof node.right.value === "number"
      ) {
        return [node.left];
      }
      if (
        isNodeOfType(node.right, "Identifier") &&
        isNodeOfType(node.left, "Literal") &&
        typeof node.left.value === "number"
      ) {
        return [node.right];
      }
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
  let mutationResultsByBindingName = bindingMutationResultsByProgram.get(programRoot);
  if (!mutationResultsByBindingName) {
    mutationResultsByBindingName = new Map();
    bindingMutationResultsByProgram.set(programRoot, mutationResultsByBindingName);
  }
  const cachedResult = mutationResultsByBindingName.get(bindingName);
  if (cachedResult !== undefined) return cachedResult;
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
  mutationResultsByBindingName.set(bindingName, didFindWrite);
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
 * `useMemo(factory, [])` and `useMemo(() => [ … ], deps)` receivers are
 * provably fixed: the list is computed once (or rebuilt positionally
 * from a literal) and can never reorder or filter afterwards. Plain
 * array literals do NOT qualify — corpus misses (audius pwdChecks,
 * tracecat commonProps) show literal rows carry real identity (labels,
 * property names) that should be the key.
 */
const isFixedMemoReceiver = (receiver: EsTreeNode): boolean => {
  const node = stripParenExpression(receiver);
  if (!isNodeOfType(node, "Identifier")) return false;
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
  if (!isUseMemoCall(initializer)) return false;
  return useMemoReturnsArrayLiteral(initializer) || hasEmptyDependencyArray(initializer);
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
 * `[...str]` and `Array.from(str)` slice ONE PROVEN string into its
 * characters. Character position IS the entry's stable identity —
 * nothing reorders, filters, or carries per-item state — so an index
 * key is correct there. `.split(...)` output does NOT qualify: split
 * lines/tokens are data rows (corpus misses: bulwarkmail shortcut keys,
 * tracecat validation lines), and the doc excludes only placeholder
 * constructions.
 */
const isStringDerivedReceiver = (receiver: EsTreeNode, depth = 0): boolean => {
  const node = stripParenExpression(receiver);
  // `const chars = [...name]; chars.map(...)` — follow the local
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

// A destructured-parameter DEFAULT resolving to a spread-free array
// literal (`{ bullets = LOCKED_FEATURE_BULLETS }`) marks the list as
// static content shipped with the component — position is the row's
// identity unless a caller overrides it, which corpus data shows they
// don't for this shape.
const isStaticDefaultLiteralReceiver = (receiver: EsTreeNode): boolean => {
  const node = stripParenExpression(receiver);
  if (!isNodeOfType(node, "Identifier")) return false;
  const binding = findVariableInitializer(node, node.name);
  if (!binding?.initializer) return false;
  const declarator = binding.bindingIdentifier.parent;
  const isDirectDeclaratorInit =
    declarator &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.init === binding.initializer;
  if (isDirectDeclaratorInit) return false;
  const defaultExpression = stripParenExpression(binding.initializer);
  if (isSpreadFreeArrayLiteral(defaultExpression)) return true;
  if (!isNodeOfType(defaultExpression, "Identifier")) return false;
  const moduleBinding = findVariableInitializer(defaultExpression, defaultExpression.name);
  if (!moduleBinding?.initializer) return false;
  const moduleDeclarator = moduleBinding.bindingIdentifier.parent;
  if (
    !moduleDeclarator ||
    !isNodeOfType(moduleDeclarator, "VariableDeclarator") ||
    moduleDeclarator.init !== moduleBinding.initializer
  ) {
    return false;
  }
  if (isBindingReassignedOrMutated(defaultExpression, defaultExpression.name)) return false;
  return isSpreadFreeArrayLiteral(stripParenExpression(moduleBinding.initializer));
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
  // The function whose parameter binds the index — the iterator
  // callback, or a render helper the index is forwarded into. Null for
  // loop counters and for-of tuple bindings.
  bindingFunction: EsTreeNode | null;
  // Slot of the index parameter within `bindingFunction`, or null when
  // the index isn't a direct parameter (entries tuples, counters).
  indexParameterPosition: number | null;
}

interface PositionalIndexUse {
  identifier: EsTreeNodeOfType<"Identifier">;
  binding: PositionalIndexBinding;
}

/**
 * Resolves whether an identifier is PROVABLY the positional array
 * index, by classifying its binding. Per the official rule prompt,
 * only indexes NAMED `index` / `idx` / `i` fire:
 *   - second-or-later direct parameter named like an index → index,
 *     whether the function is an iterator callback or a render helper
 *     the map index is forwarded into;
 *   - FIRST parameter of an iterator callback → the item, never the
 *     index (regardless of name);
 *   - FIRST parameter of a NON-iterator function named like an index →
 *     index (`const getButtons = (index) => …` called as
 *     `rows.map((row, index) => getButtons(index))`);
 *   - array `entries()` tuple destructures → index (name-gated);
 *   - numeric-literal loop counters named like an index → index;
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
    const isDirectIdentifierParameter =
      parameterInfo.parameterRoot === binding.bindingIdentifier ||
      (isNodeOfType(parameterInfo.parameterRoot, "AssignmentPattern") &&
        parameterInfo.parameterRoot.left === binding.bindingIdentifier);
    const iteratorCall = findIteratorCallOfCallback(parameterInfo.functionNode);
    if (parameterInfo.parameterPosition >= 1) {
      if (!isDirectIdentifierParameter) return null;
      if (!INDEX_PARAMETER_NAMES.has(identifierNode.name)) return null;
      return {
        iteratorCall,
        bindingFunction: parameterInfo.functionNode,
        indexParameterPosition: parameterInfo.parameterPosition,
      };
    }
    if (
      isEntriesTupleIndexParameter(binding.bindingIdentifier, identifierNode.name, parameterInfo)
    ) {
      return {
        iteratorCall: null,
        bindingFunction: parameterInfo.functionNode,
        indexParameterPosition: null,
      };
    }
    if (
      !iteratorCall &&
      isDirectIdentifierParameter &&
      INDEX_PARAMETER_NAMES.has(identifierNode.name)
    ) {
      return {
        iteratorCall: null,
        bindingFunction: parameterInfo.functionNode,
        indexParameterPosition: 0,
      };
    }
    return null;
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
      if (!INDEX_PARAMETER_NAMES.has(identifierNode.name)) return null;
      return isLoopCounterDeclarator(declarator, identifierNode, identifierNode.name)
        ? { iteratorCall: null, bindingFunction: null, indexParameterPosition: null }
        : null;
    }
    return findPositionalIndexUse(initializer, depth + 1)?.binding ?? null;
  }

  if (
    INDEX_PARAMETER_NAMES.has(identifierNode.name) &&
    isForOfEntriesTupleBinding(binding.bindingIdentifier)
  ) {
    return { iteratorCall: null, bindingFunction: null, indexParameterPosition: null };
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
// string-character slices, fixed useMemo lists, and static default
// literals all have position as the entry's identity. Plain array
// literals are deliberately NOT exempt — their rows carry identity.
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
    isFixedMemoReceiver(receiver) ||
    isStaticDefaultLiteralReceiver(receiver) ||
    isStringDerivedReceiver(receiver)
  );
};

// The key expression as a template literal — directly, or laundered one
// declarator hop (`const key = \`\${section.id}-\${idx}\`; … key={key}`).
const resolveKeyTemplateLiteral = (
  expression: EsTreeNode,
): EsTreeNodeOfType<"TemplateLiteral"> | null => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "TemplateLiteral")) return node;
  if (!isNodeOfType(node, "Identifier")) return null;
  const binding = findVariableInitializer(node, node.name);
  if (!binding?.initializer) return null;
  const declarator = binding.bindingIdentifier.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== binding.initializer
  ) {
    return null;
  }
  const initializer = stripParenExpression(binding.initializer);
  return isNodeOfType(initializer, "TemplateLiteral") ? initializer : null;
};

/**
 * True when a composite template key carries a member-read identity
 * whose root binding lives OUTSIDE the function that binds the index —
 * `\`\${section.id}-\${idx}\`` where `section` is an enclosing prop or
 * outer map item. The outer id scopes the inner index, and corpus data
 * shows such lists are static within that scope. Identity rooted at the
 * SAME map's item (`\`\${backlink.path}-\${idx}\``) does NOT exempt:
 * appending the index still remints every key on reorder or filter.
 */
const templateHasOuterMemberIdentity = (
  template: EsTreeNodeOfType<"TemplateLiteral">,
  bindingFunction: EsTreeNode | null,
): boolean => {
  if (!bindingFunction) return false;
  const expressions = template.expressions ?? [];
  if (expressions.length < 2) return false;
  for (const expression of expressions) {
    // `${String(section.id)}-${index}` — the coercion wrapper hides
    // the member read from root-identifier resolution; unwrap it.
    const unwrapped =
      isNodeOfType(expression, "CallExpression") &&
      isNodeOfType(expression.callee, "Identifier") &&
      STRING_COERCION_FUNCTIONS.has(expression.callee.name) &&
      expression.arguments?.[0]
        ? expression.arguments[0]
        : expression;
    const stripped = stripParenExpression(unwrapped);
    // Bare identifiers (`${prefix}-${index}`) carry no per-entity
    // identity — only property reads do.
    if (isNodeOfType(stripped, "Identifier")) continue;
    const rootName = getRootIdentifierName(stripped, { followCallChains: true });
    if (rootName === null) continue;
    const rootBinding = findVariableInitializer(expression, rootName);
    if (!rootBinding) continue;
    let cursor: EsTreeNode | null | undefined = rootBinding.bindingIdentifier;
    let isBoundInsideIndexFunction = false;
    while (cursor) {
      if (cursor === bindingFunction) {
        isBoundInsideIndexFunction = true;
        break;
      }
      cursor = cursor.parent ?? null;
    }
    if (!isBoundInsideIndexFunction) return true;
  }
  return false;
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

const EMPTY_NAME_SET: ReadonlySet<string> = new Set();

// The first-parameter names of the function binding the index — `token`
// in `const renderToken = (token, i) => …`, or the map item — resolved
// from the binding itself so laundered keys (`const key = \`p-\${i}\``)
// still find the sibling item.
const findIteratorItemNamesOfBinding = (binding: PositionalIndexBinding): Set<string> => {
  const names = new Set<string>();
  if (!binding.bindingFunction || !isFunctionLike(binding.bindingFunction)) return names;
  if (binding.indexParameterPosition === null || binding.indexParameterPosition < 1) return names;
  const firstParameter = (binding.bindingFunction.params ?? [])[0];
  if (firstParameter) collectPatternNames(firstParameter, names);
  return names;
};

const DERIVED_NAME_SCAN_BUDGET = 200;

// Locals derived from the iteration item inside the index-binding
// function — `children` in `const children = node.content?.map(…)` —
// render the item's own content, which travels with the row.
const collectDerivedRowContentNames = (
  bindingFunction: EsTreeNode | null,
  itemNames: ReadonlySet<string>,
): Set<string> => {
  const names = new Set<string>();
  if (!bindingFunction || itemNames.size === 0) return names;
  let budget = DERIVED_NAME_SCAN_BUDGET;
  walkAst(bindingFunction, (child: EsTreeNode): boolean | void => {
    if (budget <= 0) return false;
    budget -= 1;
    if (isFunctionLike(child) && child !== bindingFunction) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.init
    ) {
      const rootName = getRootIdentifierName(child.init as EsTreeNode, {
        followCallChains: true,
      });
      if (rootName !== null && itemNames.has(rootName)) names.add(child.id.name);
    }
  });
  return names;
};

/**
 * A fragment has no DOM identity of its own, but its CHILDREN inherit
 * the key's identity. Display-only fragment rows (member reads, bare
 * item text runs, item-invoked renderer calls) survive reorder without
 * observable harm; anything stateful — form controls, media, custom
 * components, unknown calls — keeps the diagnostic.
 */
const fragmentHasStatefulChildren = (
  openingElement: EsTreeNode,
  itemNames: ReadonlySet<string>,
  derivedNames: ReadonlySet<string>,
): boolean => {
  const jsxElement = openingElement.parent;
  if (!jsxElement || !isNodeOfType(jsxElement, "JSXElement")) return false;
  const children = jsxElement.children ?? [];
  const hasTopLevelElementChildren = children.some((child) => isNodeOfType(child, "JSXElement"));
  // A fragment of PURE text runs (`{index > 0 ? " and " : null}{part}`)
  // renders decomposed text whose position is its identity; once real
  // elements appear, bare item reads are treated conservatively again.
  const bareIdentifierNames = hasTopLevelElementChildren
    ? derivedNames
    : new Set([...derivedNames, ...itemNames]);
  return children.some((child) =>
    containsStatefulDescendant(child, {
      memberRootNames: itemNames,
      allowAnyMemberRead: true,
      bareIdentifierNames,
      callCalleeRootNames: itemNames,
    }),
  );
};

// A callback that conditionally skips rows (`if (…) return null`)
// renders a FILTERED projection — positions shift as data changes, so
// even attribute-only SVG primitives get misassociated.
const callbackFiltersRows = (bindingFunction: EsTreeNode | null): boolean => {
  if (!bindingFunction) return false;
  let didFindNullReturn = false;
  walkAst(bindingFunction, (child: EsTreeNode): boolean | void => {
    if (didFindNullReturn) return false;
    if (isFunctionLike(child) && child !== bindingFunction) return false;
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      isNodeOfType(child.argument, "Literal") &&
      child.argument.value === null
    ) {
      didFindNullReturn = true;
      return false;
    }
  });
  return didFindNullReturn;
};

// An index-keyed list inside an `aria-hidden` container (a height-0 /
// visibility-hidden sizer used only to measure rows) is invisible and
// non-interactive — "users can see & submit the wrong data" cannot occur.
const isLiteralTrueAriaHidden = (attribute: EsTreeNode): boolean => {
  if (!isNodeOfType(attribute, "JSXAttribute")) return false;
  if (!isNodeOfType(attribute.name, "JSXIdentifier") || attribute.name.name !== "aria-hidden") {
    return false;
  }
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) return attribute.value.value === "true";
  if (isNodeOfType(attribute.value, "JSXExpressionContainer")) {
    const expression = attribute.value.expression as EsTreeNode;
    return isNodeOfType(expression, "Literal") && expression.value === true;
  }
  return false;
};

const hasAriaHiddenAncestor = (attributeNode: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = attributeNode.parent;
  while (current) {
    if (isNodeOfType(current, "Program")) return false;
    if (isFunctionLike(current)) {
      // Iterator callbacks (`{items.map((item, i) => …)}`) render inline
      // within the surrounding JSX, so the walk continues through them;
      // any other function boundary leaves the render tree.
      const parent = current.parent;
      const isInlineRenderCallback =
        isNodeOfType(parent, "CallExpression") && parent.arguments.includes(current as never);
      if (!isInlineRenderCallback) return false;
    }
    if (isNodeOfType(current, "JSXElement")) {
      const opening = current.openingElement as EsTreeNode;
      if (
        isNodeOfType(opening, "JSXOpeningElement") &&
        (opening.attributes ?? []).some((attribute) => isLiteralTrueAriaHidden(attribute))
      ) {
        return true;
      }
    }
    current = current.parent ?? null;
  }
  return false;
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
      const keyTemplate = resolveKeyTemplateLiteral(node.value.expression);
      if (
        keyTemplate &&
        templateHasOuterMemberIdentity(keyTemplate, indexUse.binding.bindingFunction)
      ) {
        return;
      }
      if (hasAriaHiddenAncestor(node)) return;

      const itemNames = findIteratorItemNamesOfBinding(indexUse.binding);
      const derivedNames = collectDerivedRowContentNames(
        indexUse.binding.bindingFunction,
        itemNames,
      );

      const openingElement = node.parent;
      if (openingElement && isNodeOfType(openingElement, "JSXOpeningElement")) {
        const elementName = openingElement.name as EsTreeNode;
        if (isNodeOfType(elementName, "JSXIdentifier")) {
          if (elementName.name === "Fragment") {
            if (!fragmentHasStatefulChildren(openingElement, itemNames, derivedNames)) return;
          } else if (PURE_SVG_PRIMITIVE_TAGS.has(elementName.name)) {
            // Pure SVG primitives (`<g>`, `<path>`, …) only re-diff
            // attributes on reorder — no observable consequence, UNLESS
            // the callback filters rows out (positions shift with data).
            if (!callbackFiltersRows(indexUse.binding.bindingFunction)) return;
          } else if (STATELESS_HTML_LEAF_TAGS.has(elementName.name)) {
            // Stateless HTML leaf element whose subtree contains no
            // form controls, no media, no custom components, no
            // function-call children — reorder hazard doesn't apply.
            // For inline text runs (`<span key={i}>{token.text}</span>`),
            // member reads of the iteration item are the text itself, not
            // stateful UI; block rows keep the conservative treatment,
            // exempting only locals DERIVED from the item (recursive
            // renderer `children`).
            const jsxElement = openingElement.parent;
            if (jsxElement && isNodeOfType(jsxElement, "JSXElement")) {
              const isInlineTextRun = INLINE_TEXT_LEAF_TAGS.has(elementName.name);
              const isStateful = containsStatefulDescendant(jsxElement as EsTreeNode, {
                memberRootNames: isInlineTextRun ? itemNames : EMPTY_NAME_SET,
                bareIdentifierNames: derivedNames,
              });
              if (!isStateful) return;
            }
          }
        }
        if (
          isNodeOfType(elementName, "JSXMemberExpression") &&
          isNodeOfType(elementName.object, "JSXIdentifier") &&
          isNodeOfType(elementName.property, "JSXIdentifier") &&
          elementName.object.name === "React" &&
          elementName.property.name === "Fragment" &&
          !fragmentHasStatefulChildren(openingElement, itemNames, derivedNames)
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
