import { LOOP_TYPES } from "../../constants/js.js";
import { SMALL_LITERAL_ARRAY_MAX_ELEMENTS } from "../../constants/thresholds.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isExpressionMutatedWithin } from "../../utils/is-expression-mutated-within.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

// HACK: methods that ALWAYS return a string when called on a string
// receiver. Used to recognize `.toLowerCase().includes(x)` chains as
// string-on-string lookups.
const STRING_RETURNING_METHODS: ReadonlySet<string> = new Set([
  "toString",
  "toLocaleString",
  "toLowerCase",
  "toUpperCase",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "padStart",
  "padEnd",
  "normalize",
  "repeat",
  "replace",
  "replaceAll",
  "substring",
  "substr",
  "charAt",
  "join",
  "toFixed",
  "toExponential",
  "toPrecision",
  "toJSON",
]);

// HACK: DOM/built-in properties whose value is statically `string`.
const STRING_TYPED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "textContent",
  "innerText",
  "innerHTML",
  "outerHTML",
  "nodeValue",
  "nodeName",
  "localName",
  "namespaceURI",
  "baseURI",
  "documentURI",
  "tagName",
  "className",
  "id",
  "lang",
  "dir",
  "title",
  "alt",
  "type",
  "name",
  "placeholder",
  "href",
  "src",
  "value",
  "accessKey",
  "contentEditable",
  "hash",
  "host",
  "hostname",
  "pathname",
  "port",
  "protocol",
  "search",
  "origin",
  "username",
  "password",
  "characterSet",
  "contentType",
  "charset",
  "mimeType",
  "mediaType",
  "cssText",
  "text",
  "body",
  "content",
  "message",
  "stack",
  "fileName",
  "code",
  "label",
  "slug",
  "prefix",
]);

// Identifier suffix conventions whose binding is overwhelmingly a
// string: `*Text` (`spanText`, `labelText`), `*Path` (`lowerPath`,
// `filePath`), `*Url` / `*Uri` / `*Href`, `*Name` (when paired with
// `.includes('literal')`), `*Pattern`, `*Tag`.
const STRING_TYPED_IDENTIFIER_SUFFIXES: ReadonlyArray<string> = [
  "Text",
  "Path",
  "Url",
  "Uri",
  "Href",
  "Pattern",
  "Suffix",
  "Prefix",
  "String",
  "Source",
  "Locale",
  "Codepoint",
  "Char",
  "Word",
  "Markdown",
  "HTML",
  "Html",
  "Css",
  "Xml",
  "Json",
  "Yaml",
  "Sql",
  "Query",
  "Line",
  "Filename",
  "Filepath",
];

const hasStringTypedSuffix = (name: string): boolean => {
  for (const suffix of STRING_TYPED_IDENTIFIER_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) return true;
  }
  return false;
};

// Array names whose ELEMENTS are strings: `contentLines`, `words`,
// `tokensSplit` (a `.split()` result).
const STRING_ARRAY_TYPED_SUFFIXES: ReadonlyArray<string> = [
  "Lines",
  "Words",
  "Chars",
  "Segments",
  "Parts",
  "Split",
];

const STRING_ARRAY_TYPED_NAMES: ReadonlySet<string> = new Set([
  "lines",
  "words",
  "chars",
  "segments",
  "parts",
  "tokens",
]);

const hasStringArrayTypedName = (name: string): boolean => {
  if (STRING_ARRAY_TYPED_NAMES.has(name)) return true;
  for (const suffix of STRING_ARRAY_TYPED_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) return true;
  }
  return false;
};

// HACK: identifier names that overwhelmingly bind to strings.
const STRING_TYPED_IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  "text",
  "string",
  "str",
  "content",
  "contents",
  "html",
  "xml",
  "json",
  "css",
  "yaml",
  "markdown",
  "md",
  "source",
  "sourceCode",
  "template",
  "raw",
  "comment",
  "description",
  "desc",
  "summary",
  "snippet",
  "url",
  "uri",
  "path",
  "filename",
  "filepath",
  "fileName",
  "filePath",
  "line",
  "char",
  "character",
  "letter",
  "word",
  "phrase",
  "sentence",
  "paragraph",
  "query",
  "search",
  "pathname",
  "href",
  "hash",
  "haystack",
  "needle",
  // A destructured `for (const [key] of Object.entries(...))` key is a
  // string; `key.includes(sep)` is a substring search (a numeric Map key
  // wouldn't have `.includes` at all), so the Set-rewrite never applies.
  "key",
  // Common string-typed naming conventions in addition to the above
  "suffix",
  "prefix",
  "extension",
  "ext",
  "tableSuffix",
  "tablePrefix",
  "filenameSuffix",
  "filenamePrefix",
  "moduleSuffix",
  "modulePrefix",
  "declaration",
  "expression",
  "statement",
  "literal",
  "alias",
  "title",
]);

const STRING_RETURNING_CALLEE_PREFIX_PATTERN = /^(?:normalize|format|stringify|serialize)/;

// HACK: returns true when the receiver of `.includes()` / `.indexOf()`
// is obviously a string, so the Set rewrite suggestion doesn't apply.
const isLikelyStringReceiver = (receiver: EsTreeNode | null | undefined): boolean => {
  if (!receiver) return false;
  if (isNodeOfType(receiver, "Literal") && typeof receiver.value === "string") return true;
  if (isNodeOfType(receiver, "TemplateLiteral")) return true;
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "Identifier") &&
    receiver.callee.name === "String"
  ) {
    return true;
  }
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    isNodeOfType(receiver.callee.property, "Identifier") &&
    STRING_RETURNING_METHODS.has(receiver.callee.property.name)
  ) {
    return true;
  }
  // `normalizeForMatch(text).includes(q)` — free functions named
  // normalize*/format*/stringify*/serialize* return strings.
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "Identifier") &&
    STRING_RETURNING_CALLEE_PREFIX_PATTERN.test(receiver.callee.name)
  ) {
    return true;
  }
  if (isNodeOfType(receiver, "MemberExpression") && isNodeOfType(receiver.property, "Identifier")) {
    if (STRING_TYPED_PROPERTY_NAMES.has(receiver.property.name)) return true;
  }
  if (
    isNodeOfType(receiver, "ChainExpression") &&
    receiver.expression &&
    isLikelyStringReceiver(receiver.expression)
  ) {
    return true;
  }
  if (isNodeOfType(receiver, "Identifier")) {
    if (STRING_TYPED_IDENTIFIER_NAMES.has(receiver.name)) return true;
    if (hasStringTypedSuffix(receiver.name)) return true;
  }
  if (isNodeOfType(receiver, "MemberExpression") && isNodeOfType(receiver.property, "Identifier")) {
    if (hasStringTypedSuffix(receiver.property.name)) return true;
  }
  // `contentLines[i]` / `pathSegmentsSplit[last]` — an element of an
  // array whose name says "array of strings" is itself a string.
  if (isNodeOfType(receiver, "MemberExpression") && receiver.computed) {
    const arrayName = isNodeOfType(receiver.object, "Identifier")
      ? receiver.object.name
      : isNodeOfType(receiver.object, "MemberExpression") &&
          isNodeOfType(receiver.object.property, "Identifier")
        ? receiver.object.property.name
        : null;
    if (arrayName && hasStringArrayTypedName(arrayName)) return true;
  }
  // `a + ':' + b` — string concatenation yields a string.
  if (isNodeOfType(receiver, "BinaryExpression") && receiver.operator === "+") {
    return isLikelyStringReceiver(receiver.left) || isLikelyStringReceiver(receiver.right);
  }
  if (isNodeOfType(receiver, "ConditionalExpression")) {
    return (
      isLikelyStringReceiver(receiver.consequent) && isLikelyStringReceiver(receiver.alternate)
    );
  }
  return false;
};

// `lines[i]` / `tokens[cursor]` — indexing into an array by a numeric
// index. The result is the array's element type, which is overwhelmingly
// `string` in the cases that survive after `isLikelyStringReceiver`
// (other element types' membership tests don't even compile without
// the right operand being the same shape). We require the indexer to
// be an index-named Identifier OR a numeric literal so we don't
// accidentally pass through `record[someKey]`.
const INDEX_LIKE_IDENTIFIER_NAMES: ReadonlySet<string> = new Set([
  "i",
  "j",
  "k",
  "idx",
  "index",
  "cursor",
  "position",
  "pos",
  "lineNumber",
  "lineIndex",
  "ln",
  "row",
  "col",
  "column",
]);

const isIndexedArrayElementWithStringArgument = (
  receiver: EsTreeNode | null | undefined,
  callArgument: EsTreeNode | null | undefined,
): boolean => {
  if (!receiver || !isNodeOfType(receiver, "MemberExpression") || !receiver.computed) {
    return false;
  }
  const property = receiver.property as EsTreeNode;
  const isIndexLike =
    (isNodeOfType(property, "Identifier") && INDEX_LIKE_IDENTIFIER_NAMES.has(property.name)) ||
    (isNodeOfType(property, "Literal") &&
      typeof (property as { value?: unknown }).value === "number");
  if (!isIndexLike) return false;
  // Pair with `.includes("literal-string")` — only skip when the
  // argument is itself a string literal so we don't paper over genuine
  // `arr[i].includes(otherObj)` cases.
  if (!callArgument) return false;
  if (isNodeOfType(callArgument, "Literal") && typeof callArgument.value === "string") {
    return true;
  }
  if (isNodeOfType(callArgument, "TemplateLiteral")) return true;
  return false;
};

// `["admin", "owner"].includes(role)` — an inline literal array small
// enough that a linear scan is trivial. Building a `Set` for a handful of
// constants is pure ceremony, so skip it (same threshold the iteration-
// combination rules use). A named/large array still scans on every loop
// pass, so those stay flagged.
const isSmallInlineLiteralArray = (receiver: EsTreeNode | null | undefined): boolean => {
  if (!receiver) return false;
  // `Object.freeze(['high', 'medium', 'low'])` / `[...] as const` — the
  // frozen/const wrapper doesn't change the fixed-size nature.
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    isNodeOfType(receiver.callee.object, "Identifier") &&
    receiver.callee.object.name === "Object" &&
    isNodeOfType(receiver.callee.property, "Identifier") &&
    receiver.callee.property.name === "freeze"
  ) {
    return isSmallInlineLiteralArray(receiver.arguments?.[0]);
  }
  if (isNodeOfType(receiver, "TSAsExpression") || isNodeOfType(receiver, "TSSatisfiesExpression")) {
    return isSmallInlineLiteralArray(receiver.expression);
  }
  // `[componentType].flat()` — the normalize-to-array idiom: the flattened
  // result's size is bounded by the tiny literal it started from.
  if (
    isNodeOfType(receiver, "CallExpression") &&
    isNodeOfType(receiver.callee, "MemberExpression") &&
    isNodeOfType(receiver.callee.property, "Identifier") &&
    receiver.callee.property.name === "flat"
  ) {
    return isSmallInlineLiteralArray(receiver.callee.object);
  }
  if (!isNodeOfType(receiver, "ArrayExpression")) return false;
  const elements = receiver.elements ?? [];
  if (elements.length === 0 || elements.length > SMALL_LITERAL_ARRAY_MAX_ELEMENTS) return false;
  return elements.every((element) => element == null || !isNodeOfType(element, "SpreadElement"));
};

// `SEVERITY_ORDER.includes(c.severity)` — a SCREAMING_SNAKE_CASE receiver
// is a module constant: a fixed allowlist whose size does not grow with
// the data being looped over, so the scan is O(1) w.r.t. input and the
// Set rewrite is ceremony.
const isScreamingSnakeCaseConstantReceiver = (receiver: EsTreeNode | null | undefined): boolean =>
  Boolean(receiver) &&
  isNodeOfType(receiver, "Identifier") &&
  receiver.name.length > 1 &&
  /^[A-Z][A-Z0-9_]*$/.test(receiver.name);

// `propSchema.enum.includes(value)` — a JSON-schema `enum` is a tiny
// per-property constant list that differs each iteration, so a hoisted
// Set cannot exist.
const SMALL_FIXED_LIST_PROPERTY_NAMES: ReadonlySet<string> = new Set(["enum"]);

const isSmallFixedListMember = (receiver: EsTreeNode | null | undefined): boolean => {
  if (!receiver) return false;
  if (isNodeOfType(receiver, "ChainExpression")) return isSmallFixedListMember(receiver.expression);
  return (
    isNodeOfType(receiver, "MemberExpression") &&
    isNodeOfType(receiver.property, "Identifier") &&
    SMALL_FIXED_LIST_PROPERTY_NAMES.has(receiver.property.name)
  );
};

interface ResolvedInitializer {
  readonly initializer: EsTreeNode;
  readonly isDefault: boolean;
}

// Follow an identifier receiver to its declaration so `const ct =
// flare.contentType; … ct.includes('json')` is recognized as the string
// lookup it is, and `const KNOWN = ['a', 'b']; … KNOWN.includes(x)` as a
// tiny fixed allowlist.
const getResolvedInitializer = (receiver: EsTreeNode): ResolvedInitializer | null => {
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const binding = findVariableInitializer(receiver, receiver.name);
  const initializer = binding?.initializer ?? null;
  if (!binding || !initializer) return null;
  const isDefault = isNodeOfType(binding.bindingIdentifier.parent, "AssignmentPattern");
  // Follow one alias hop: `const supported = LOCALES;`.
  if (isNodeOfType(initializer, "Identifier")) {
    const aliased = findVariableInitializer(initializer, initializer.name);
    if (aliased?.initializer) {
      return {
        initializer: aliased.initializer,
        isDefault: isDefault || isNodeOfType(aliased.bindingIdentifier.parent, "AssignmentPattern"),
      };
    }
  }
  return { initializer, isDefault };
};

// `cookie.split(';')` produces string elements; a binding iterating over a
// split result (`for (const c of cookie.split(';'))`) is a string, so its
// `.includes` / `.indexOf` is substring matching.
const isSplitCall = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  if (isNodeOfType(expression, "ChainExpression")) return isSplitCall(expression.expression);
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = expression.callee;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "split"
  );
};

const resolvesToSplitCall = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  if (isSplitCall(expression)) return true;
  if (isNodeOfType(expression, "Identifier")) {
    const binding = findVariableInitializer(expression, expression.name);
    return isSplitCall(binding?.initializer);
  }
  return false;
};

const isStringElementOfSplitIteration = (receiver: EsTreeNode): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const binding = findVariableInitializer(receiver, receiver.name);
  if (!binding) return false;
  const bindingParent = binding.bindingIdentifier.parent;
  if (isNodeOfType(bindingParent, "VariableDeclarator")) {
    const declaration = bindingParent.parent;
    const forOfStatement = declaration?.parent;
    if (
      isNodeOfType(declaration, "VariableDeclaration") &&
      isNodeOfType(forOfStatement, "ForOfStatement") &&
      forOfStatement.left === declaration
    ) {
      return resolvesToSplitCall(forOfStatement.right);
    }
    return false;
  }
  if (
    isInlineFunctionExpression(bindingParent) &&
    bindingParent.params?.[0] === binding.bindingIdentifier
  ) {
    const callbackCall = bindingParent.parent;
    if (
      isNodeOfType(callbackCall, "CallExpression") &&
      isNodeOfType(callbackCall.callee, "MemberExpression")
    ) {
      return resolvesToSplitCall(callbackCall.callee.object);
    }
  }
  return false;
};

// `importClause.includes('{')` — a single-character argument is a
// substring/character search on a string receiver in practice, not an
// array membership test, so the Set rewrite never applies. Same for
// literals carrying punctuation (`'.min'`, `'file:'`, `'&lt;rss'`): no
// sane array holds those as members, but substring searches for them
// constantly.
const SUBSTRING_PUNCTUATION_PATTERN = /[^\p{L}\p{N}_-]/u;

const isSubstringSearchLiteral = (callArgument: EsTreeNode | null | undefined): boolean => {
  if (!callArgument) return false;
  if (isNodeOfType(callArgument, "TemplateLiteral")) {
    for (const quasi of callArgument.quasis ?? []) {
      const cookedText = quasi.value?.cooked ?? "";
      if (SUBSTRING_PUNCTUATION_PATTERN.test(cookedText)) return true;
    }
    return false;
  }
  if (!isNodeOfType(callArgument, "Literal")) return false;
  if (typeof callArgument.value !== "string") return false;
  if (callArgument.value.length === 1) return true;
  return callArgument.value.length > 0 && SUBSTRING_PUNCTUATION_PATTERN.test(callArgument.value);
};

const NATIVE_ARRAY_TYPE_NAMES: ReadonlySet<string> = new Set([
  "Array",
  "ReadonlyArray",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

const NATIVE_ARRAY_RETURNING_METHOD_NAMES: ReadonlySet<string> = new Set([
  "concat",
  "filter",
  "flat",
  "flatMap",
  "map",
  "slice",
  "splice",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);

const isNativeArrayType = (typeNode: EsTreeNode | null | undefined): boolean => {
  if (!typeNode) return false;
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) return true;
  if (isNodeOfType(typeNode, "TSTypeOperator")) {
    return isNativeArrayType(typeNode.typeAnnotation);
  }
  return (
    isNodeOfType(typeNode, "TSTypeReference") &&
    isNodeOfType(typeNode.typeName, "Identifier") &&
    NATIVE_ARRAY_TYPE_NAMES.has(typeNode.typeName.name)
  );
};

const getDeclaredTypeMember = (
  typeNode: EsTreeNode | null | undefined,
  propertyName: string,
  referenceNode: EsTreeNode,
  visitedDeclarations = new Set<EsTreeNode>(),
): EsTreeNode | null => {
  if (!typeNode) return null;
  const members = isNodeOfType(typeNode, "TSTypeLiteral")
    ? typeNode.members
    : isNodeOfType(typeNode, "TSInterfaceDeclaration")
      ? typeNode.body.body
      : null;
  if (members) {
    for (const member of members) {
      if (
        isNodeOfType(member, "TSPropertySignature") &&
        !member.computed &&
        isNodeOfType(member.key, "Identifier") &&
        member.key.name === propertyName
      ) {
        return member.typeAnnotation?.typeAnnotation ?? null;
      }
    }
    return null;
  }
  if (isNodeOfType(typeNode, "TSTypeAliasDeclaration")) {
    return getDeclaredTypeMember(
      typeNode.typeAnnotation,
      propertyName,
      referenceNode,
      visitedDeclarations,
    );
  }
  if (
    !isNodeOfType(typeNode, "TSTypeReference") ||
    !isNodeOfType(typeNode.typeName, "Identifier")
  ) {
    return null;
  }
  const programRoot = findProgramRoot(referenceNode);
  if (!programRoot) return null;
  for (const statement of programRoot.body) {
    const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (
      declaration &&
      (isNodeOfType(declaration, "TSInterfaceDeclaration") ||
        isNodeOfType(declaration, "TSTypeAliasDeclaration")) &&
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id.name === typeNode.typeName.name &&
      !visitedDeclarations.has(declaration)
    ) {
      visitedDeclarations.add(declaration);
      return getDeclaredTypeMember(declaration, propertyName, referenceNode, visitedDeclarations);
    }
  }
  return null;
};

const getDeclaredMemberType = (
  receiver: EsTreeNodeOfType<"MemberExpression">,
): EsTreeNode | null => {
  const propertyName = getStaticPropertyName(receiver);
  if (!propertyName) return null;
  const object = stripParenExpression(receiver.object);
  if (isNodeOfType(object, "Identifier")) {
    const binding = findVariableInitializer(object, object.name);
    if (binding && isNodeOfType(binding.bindingIdentifier, "Identifier")) {
      return getDeclaredTypeMember(
        binding.bindingIdentifier.typeAnnotation?.typeAnnotation,
        propertyName,
        receiver,
      );
    }
  }
  if (!isNodeOfType(object, "ThisExpression")) return null;
  let ancestor: EsTreeNode | null | undefined = receiver.parent;
  while (ancestor && !isNodeOfType(ancestor, "ClassBody")) ancestor = ancestor.parent;
  if (!ancestor) return null;
  for (const classElement of ancestor.body) {
    if (
      isNodeOfType(classElement, "PropertyDefinition") &&
      !classElement.computed &&
      isNodeOfType(classElement.key, "Identifier") &&
      classElement.key.name === propertyName
    ) {
      return classElement.typeAnnotation?.typeAnnotation ?? null;
    }
  }
  return null;
};

const hasProvenNonArrayType = (receiver: EsTreeNode): boolean => {
  if (isNodeOfType(receiver, "MemberExpression")) {
    const declaredType = getDeclaredMemberType(receiver);
    if (declaredType) return !isNativeArrayType(declaredType);
    const object = stripParenExpression(receiver.object);
    if (isNodeOfType(object, "Identifier")) {
      const binding = findVariableInitializer(object, object.name);
      return Boolean(
        binding &&
        isNodeOfType(binding.bindingIdentifier, "Identifier") &&
        binding.bindingIdentifier.typeAnnotation,
      );
    }
    return false;
  }
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const binding = findVariableInitializer(receiver, receiver.name);
  if (!binding || !isNodeOfType(binding.bindingIdentifier, "Identifier")) return false;
  const typeAnnotation = binding.bindingIdentifier.typeAnnotation;
  return Boolean(typeAnnotation) && !isNativeArrayType(typeAnnotation?.typeAnnotation);
};

const isUnshadowedNativeArrayConstructor = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "Identifier") &&
  NATIVE_ARRAY_TYPE_NAMES.has(callee.name) &&
  findVariableInitializer(callee, callee.name) === null;

const isProvenNativeArrayReceiver = (
  receiver: EsTreeNode,
  visitedBindings = new Set<EsTreeNode>(),
): boolean => {
  const strippedReceiver = stripParenExpression(receiver);
  if (isNodeOfType(strippedReceiver, "ArrayExpression")) return true;
  if (isNodeOfType(strippedReceiver, "NewExpression")) {
    return isUnshadowedNativeArrayConstructor(strippedReceiver.callee);
  }
  if (isNodeOfType(strippedReceiver, "CallExpression")) {
    return isNativeArrayReturningCall(strippedReceiver, visitedBindings);
  }
  if (!isNodeOfType(strippedReceiver, "Identifier")) return false;
  const binding = findVariableInitializer(strippedReceiver, strippedReceiver.name);
  if (!binding || visitedBindings.has(binding.bindingIdentifier)) return false;
  if (
    isNodeOfType(binding.bindingIdentifier, "Identifier") &&
    isNativeArrayType(binding.bindingIdentifier.typeAnnotation?.typeAnnotation)
  ) {
    return true;
  }
  visitedBindings.add(binding.bindingIdentifier);
  return Boolean(
    binding.initializer && isProvenNativeArrayReceiver(binding.initializer, visitedBindings),
  );
};

const isNativeArrayReturningCall = (
  receiver: EsTreeNodeOfType<"CallExpression">,
  visitedBindings = new Set<EsTreeNode>(),
): boolean => {
  const callee = stripParenExpression(receiver.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return callee.name === "Array" && findVariableInitializer(callee, callee.name) === null;
  }
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    callee.property.name === "from" &&
    findVariableInitializer(callee.object, callee.object.name) === null
  ) {
    return true;
  }
  return (
    NATIVE_ARRAY_RETURNING_METHOD_NAMES.has(callee.property.name) &&
    isProvenNativeArrayReceiver(callee.object, visitedBindings)
  );
};

const isProvenUserlandIncludesReceiver = (
  receiver: EsTreeNode,
  visitedBindings = new Set<EsTreeNode>(),
): boolean => {
  const strippedReceiver = stripParenExpression(receiver);
  if (isProvenNativeArrayReceiver(strippedReceiver)) return false;
  if (hasProvenNonArrayType(strippedReceiver)) return true;
  if (isNodeOfType(strippedReceiver, "ObjectExpression")) return true;
  if (isNodeOfType(strippedReceiver, "NewExpression")) {
    return !isUnshadowedNativeArrayConstructor(strippedReceiver.callee);
  }
  if (isNodeOfType(strippedReceiver, "CallExpression")) {
    return !isNativeArrayReturningCall(strippedReceiver);
  }
  if (isNodeOfType(strippedReceiver, "Identifier")) {
    const binding = findVariableInitializer(strippedReceiver, strippedReceiver.name);
    if (!binding || visitedBindings.has(binding.bindingIdentifier)) return false;
    visitedBindings.add(binding.bindingIdentifier);
    if (binding.initializer) {
      return isProvenUserlandIncludesReceiver(binding.initializer, visitedBindings);
    }
  }
  return false;
};

// `.filter(option => value.includes(option.value))` iterates like a loop —
// the callback runs once per element, so a linear `.includes` inside it is
// the same O(n·m) scan as inside a `for` statement.
const ITERATION_CALLBACK_METHOD_NAMES: ReadonlySet<string> = new Set([
  "forEach",
  "map",
  "flatMap",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "reduce",
  "reduceRight",
]);

const isIterationCallbackCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (
    !isNodeOfType(node.callee, "MemberExpression") ||
    !isNodeOfType(node.callee.property, "Identifier")
  ) {
    return false;
  }
  if (!ITERATION_CALLBACK_METHOD_NAMES.has(node.callee.property.name)) return false;
  return isInlineFunctionExpression(node.arguments?.[0]);
};

const LOOP_CONTEXT_STATEMENT_TYPES: ReadonlySet<string> = new Set(LOOP_TYPES);

const findNearestLoopContext = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (LOOP_CONTEXT_STATEMENT_TYPES.has(ancestor.type)) return ancestor;
    if (isNodeOfType(ancestor, "CallExpression") && isIterationCallbackCall(ancestor)) {
      return ancestor;
    }
    ancestor = ancestor.parent;
  }
  return null;
};

// A receiver freshly created inside the innermost loop iteration (`const
// tokens = raw.split('.').slice(0, 3)` in the loop body) is rebuilt every
// pass — converting it to a Set each iteration costs more than the scan,
// so hoisting advice does not apply.
const isReceiverDeclaredInNearestLoop = (receiver: EsTreeNode, lookupCall: EsTreeNode): boolean => {
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const binding = findVariableInitializer(receiver, receiver.name);
  if (!binding || !binding.initializer) return false;
  const nearestLoop = findNearestLoopContext(lookupCall);
  if (!nearestLoop) return false;
  let ancestor: EsTreeNode | null | undefined = binding.bindingIdentifier;
  while (ancestor) {
    if (ancestor === nearestLoop) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

// `for (const [id, viewIds] of Object.entries(map)) { viewIds.includes(x) }`
// or `.filter(col => col.parentGroupIds.includes(id))` — the scanned array
// is a DIFFERENT array on every iteration and is queried once, so there is
// no repeated lookup to hoist into a Set. The owning loop may be an OUTER
// one (`items.filter((country) => regions.map((r) => country.regions
// .includes(r)))`), so every enclosing loop's bindings count.
const collectEnclosingLoopIterationBindingNames = (lookupCall: EsTreeNode): Set<string> => {
  const iterationNames = new Set<string>();
  let ancestor: EsTreeNode | null | undefined = lookupCall.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "ForOfStatement") || isNodeOfType(ancestor, "ForInStatement")) {
      const left = ancestor.left;
      if (isNodeOfType(left, "VariableDeclaration")) {
        for (const declarator of left.declarations ?? []) {
          if (declarator.id) collectPatternNames(declarator.id, iterationNames);
        }
      } else if (left) {
        collectPatternNames(left, iterationNames);
      }
    }
    if (isNodeOfType(ancestor, "CallExpression") && isIterationCallbackCall(ancestor)) {
      const callback = ancestor.arguments?.[0];
      if (isInlineFunctionExpression(callback)) {
        for (const param of callback.params ?? []) {
          collectPatternNames(param, iterationNames);
        }
      }
    }
    ancestor = ancestor.parent;
  }
  return iterationNames;
};

// Root identifier plus every computed-index identifier along the member
// chain: `BACKEND_URLS[key]` depends on both `BACKEND_URLS` and `key`.
const collectReceiverDependencyNames = (receiver: EsTreeNode): Set<string> => {
  const dependencyNames = new Set<string>();
  let current = stripParenExpression(receiver);
  while (isNodeOfType(current, "MemberExpression")) {
    if (current.computed && isNodeOfType(current.property, "Identifier")) {
      dependencyNames.add(current.property.name);
    }
    current = stripParenExpression(current.object);
  }
  if (isNodeOfType(current, "Identifier")) dependencyNames.add(current.name);
  return dependencyNames;
};

const isPerIterationReceiver = (receiver: EsTreeNode, lookupCall: EsTreeNode): boolean => {
  const dependencyNames = collectReceiverDependencyNames(receiver);
  if (dependencyNames.size === 0) return false;
  const iterationNames = collectEnclosingLoopIterationBindingNames(lookupCall);
  for (const dependencyName of dependencyNames) {
    if (iterationNames.has(dependencyName)) return true;
  }
  return false;
};

const getIteratedCollection = (loopContext: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(loopContext, "ForOfStatement") || isNodeOfType(loopContext, "ForInStatement")) {
    return loopContext.right as EsTreeNode;
  }
  if (
    isNodeOfType(loopContext, "CallExpression") &&
    isNodeOfType(loopContext.callee, "MemberExpression")
  ) {
    return loopContext.callee.object as EsTreeNode;
  }
  return null;
};

const isBoundedConstantCollection = (collection: EsTreeNode): boolean => {
  const stripped = stripParenExpression(collection);
  if (isScreamingSnakeCaseConstantReceiver(stripped)) return true;
  if (isSmallInlineLiteralArray(stripped)) return true;
  if (isNodeOfType(stripped, "Identifier")) {
    const resolved = getResolvedInitializer(stripped);
    if (resolved && !resolved.isDefault && isSmallInlineLiteralArray(resolved.initializer)) {
      return true;
    }
  }
  return false;
};

// `AGENT_OPTIONS.map(({ field }) => managed?.includes(field))` — when EVERY
// enclosing loop iterates a fixed module constant (SCREAMING_SNAKE_CASE
// name or a small array literal), the lookup runs a small bounded number of
// times: total work is O(k·n) for constant k, which a hoisted Set cannot
// beat — building it already costs O(n). Any unbounded enclosing loop
// (plain for/while, or iteration over data) voids the bound and keeps the
// diagnostic.
const isLookupBoundedByConstantIteration = (lookupCall: EsTreeNode): boolean => {
  let sawBoundedLoop = false;
  let ancestor: EsTreeNode | null | undefined = lookupCall.parent;
  while (ancestor) {
    const isLoopStatement = LOOP_CONTEXT_STATEMENT_TYPES.has(ancestor.type);
    const isCallbackLoop =
      isNodeOfType(ancestor, "CallExpression") && isIterationCallbackCall(ancestor);
    if (isLoopStatement || isCallbackLoop) {
      const collection = getIteratedCollection(ancestor);
      if (!collection || !isBoundedConstantCollection(collection)) return false;
      sawBoundedLoop = true;
    }
    ancestor = ancestor.parent;
  }
  return sawBoundedLoop;
};

export const jsSetMapLookups = defineRule({
  id: "js-set-map-lookups",
  title: "Array lookup inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use a `Set` or `Map` when you check for the same items over and over. `Array.includes`/`find` scans the whole list each time",
  create: (context: RuleContext) => {
    let loopDepth = 0;
    const visitors: RuleVisitors = {};
    for (const loopType of LOOP_TYPES) {
      visitors[loopType] = () => {
        loopDepth++;
      };
      visitors[`${loopType}:exit`] = () => {
        loopDepth--;
      };
    }

    const inspectLookupCall = (node: EsTreeNodeOfType<"CallExpression">): void => {
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        node.callee.computed ||
        node.callee.optional ||
        node.optional ||
        !isNodeOfType(node.callee.property, "Identifier")
      )
        return;
      const methodName = node.callee.property.name;
      if (methodName !== "includes" || node.arguments.length !== 1) return;
      if (isNodeOfType(node.arguments[0], "SpreadElement")) return;
      const rawReceiver = node.callee.object;
      if (!rawReceiver) return;
      const receiver = stripParenExpression(rawReceiver);
      if (isNodeOfType(receiver, "CallExpression") || isNodeOfType(receiver, "NewExpression")) {
        return;
      }
      if (
        isNodeOfType(receiver, "MemberExpression") &&
        receiver.computed &&
        getStaticPropertyName(receiver) === null
      ) {
        return;
      }
      if (isLikelyStringReceiver(receiver)) return;
      if (isProvenUserlandIncludesReceiver(receiver)) return;
      if (isSmallInlineLiteralArray(receiver)) return;
      if (isScreamingSnakeCaseConstantReceiver(receiver)) return;
      if (isSmallFixedListMember(receiver)) return;
      if (isSubstringSearchLiteral(node.arguments?.[0] as EsTreeNode | undefined)) return;
      if (
        isIndexedArrayElementWithStringArgument(
          receiver,
          node.arguments?.[0] as EsTreeNode | undefined,
        )
      ) {
        return;
      }
      const resolvedInitializer = getResolvedInitializer(receiver);
      if (resolvedInitializer) {
        if (isLikelyStringReceiver(resolvedInitializer.initializer)) return;
        if (
          !resolvedInitializer.isDefault &&
          isSmallInlineLiteralArray(resolvedInitializer.initializer)
        ) {
          return;
        }
      }
      if (isStringElementOfSplitIteration(receiver)) return;
      if (isReceiverDeclaredInNearestLoop(receiver, node)) return;
      if (isPerIterationReceiver(receiver, node)) return;
      if (isLookupBoundedByConstantIteration(node)) return;
      const nearestLoop = findNearestLoopContext(node);
      if (nearestLoop && isExpressionMutatedWithin(receiver, nearestLoop)) return;
      context.report({
        node,
        message: `This scales poorly because \`array.${methodName}()\` inside a loop scans the whole list every time. Use a Set for constant-time lookups.`,
      });
    };

    visitors.CallExpression = (node: EsTreeNodeOfType<"CallExpression">) => {
      if (isIterationCallbackCall(node)) {
        loopDepth++;
        return;
      }
      if (loopDepth > 0) inspectLookupCall(node);
    };
    visitors["CallExpression:exit"] = (node: EsTreeNodeOfType<"CallExpression">) => {
      if (isIterationCallbackCall(node)) loopDepth--;
    };

    return visitors;
  },
});
