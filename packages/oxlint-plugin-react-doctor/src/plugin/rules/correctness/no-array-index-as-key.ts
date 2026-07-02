import { INDEX_PARAMETER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isAllLiteralArrayExpression } from "../../utils/is-all-literal-array-expression.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  containsStatefulDescendant,
  PURE_SVG_PRIMITIVE_TAGS,
  STATELESS_HTML_LEAF_TAGS,
} from "../../utils/jsx-stateless-leaf.js";

const STRING_COERCION_FUNCTIONS = new Set(["String", "Number"]);

const extractIndexName = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "Identifier") && INDEX_PARAMETER_NAMES.has(node.name)) return node.name;

  if (isNodeOfType(node, "TemplateLiteral")) {
    for (const expression of node.expressions ?? []) {
      if (isNodeOfType(expression, "Identifier") && INDEX_PARAMETER_NAMES.has(expression.name)) {
        return expression.name;
      }
    }
  }

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    INDEX_PARAMETER_NAMES.has(node.callee.object.name) &&
    isNodeOfType(node.callee.property, "Identifier") &&
    node.callee.property.name === "toString"
  )
    return node.callee.object.name;

  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    STRING_COERCION_FUNCTIONS.has(node.callee.name) &&
    isNodeOfType(node.arguments?.[0], "Identifier") &&
    INDEX_PARAMETER_NAMES.has(node.arguments[0].name)
  )
    return node.arguments[0].name;

  if (
    isNodeOfType(node, "BinaryExpression") &&
    node.operator === "+" &&
    ((isNodeOfType(node.left, "Identifier") &&
      INDEX_PARAMETER_NAMES.has(node.left.name) &&
      isNodeOfType(node.right, "Literal") &&
      node.right.value === "") ||
      (isNodeOfType(node.right, "Identifier") &&
        INDEX_PARAMETER_NAMES.has(node.right.name) &&
        isNodeOfType(node.left, "Literal") &&
        node.left.value === ""))
  ) {
    if (isNodeOfType(node.left, "Identifier")) return node.left.name;
    if (isNodeOfType(node.right, "Identifier")) return node.right.name;
    return null;
  }

  return null;
};

const isNumericLiteralOrUndefined = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal") && typeof node.value === "number") return true;
  if (isNodeOfType(node, "Identifier") && node.name === "undefined") return true;
  return false;
};

const isArrayConstructorCallWithNumericLength = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "Array" &&
    isNumericLiteralOrUndefined(node.arguments?.[0])
  )
    return true;
  if (
    isNodeOfType(node, "NewExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "Array" &&
    isNumericLiteralOrUndefined(node.arguments?.[0])
  )
    return true;
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

/**
 * True if every element of an ArrayExpression is a primitive constant
 * (number/string/boolean literal) — `[1, 2, 3]`, `['a', 'b']`. Such arrays
 * have a fixed order at every render, so an index key is stable.
 */
/**
 * True if the call expression looks like a placeholder constructor whose
 * elements have no identity beyond their position — i.e. `Array.from(...)`,
 * `Array(N)`, `new Array(N)`, `Array(N).fill(...)`, `[...Array(N)]`, or
 * a literal-only array `[1, 2, 3]` / `['a', 'b']`.
 *
 * Used both for `<receiver>.map(...)` and for `Array.from(<length>, fn)`.
 */
const isStaticPlaceholderReceiver = (receiver: EsTreeNode): boolean => {
  if (isArrayFromCall(receiver)) return true;
  if (isArrayConstructorCallWithNumericLength(receiver)) return true;
  if (isAllLiteralArrayExpression(receiver)) return true;

  if (isNodeOfType(receiver, "CallExpression")) {
    const callee = receiver.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "fill" &&
      isArrayConstructorCallWithNumericLength(callee.object)
    )
      return true;
  }

  if (isNodeOfType(receiver, "ArrayExpression") && receiver.elements?.length === 1) {
    const only = receiver.elements[0];
    if (only && isNodeOfType(only, "SpreadElement")) {
      const arg = only.argument;
      if (isArrayConstructorCallWithNumericLength(arg)) return true;
      if (isArrayFromCall(arg)) return true;
    }
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
    if (isNumericLiteralOrUndefined(prop.value)) return true;
    // also accept simple identifier — `{length: count}` — assume it's a numeric
    // constant; almost always is in placeholder constructions.
    if (isNodeOfType(prop.value, "Identifier")) return true;
  }
  return false;
};

const TYPE_RESOLUTION_DEPTH_LIMIT = 4;

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

// We must inspect only the INNERMOST iterator callback enclosing the
// keyed JSX — that's the one whose index parameter actually feeds the
// `key=` binding. Outer `Array.from({length: N}, ...)` ancestors are
// irrelevant when there's a nested `items.map(...)` between them and
// the JSX (the inner index is from the dynamic map, not the placeholder).
const isInsideIteratorMapMatching = (
  node: EsTreeNode,
  matchesMethodReceiver: (receiver: EsTreeNode) => boolean,
  matchesArrayFromCall: (arrayFromCall: EsTreeNode) => boolean,
): boolean => {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (
      isFunctionLike(current) &&
      isNodeOfType(parent, "CallExpression") &&
      parent.arguments.includes(current as never)
    ) {
      const callee = parent.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        (callee.property.name === "map" ||
          callee.property.name === "flatMap" ||
          callee.property.name === "forEach")
      ) {
        return matchesMethodReceiver(callee.object);
      }
      if (
        isArrayFromCall(parent) &&
        parent.arguments.length >= 2 &&
        parent.arguments[1] === current
      ) {
        return matchesArrayFromCall(parent);
      }
    }
    current = parent;
  }
  return false;
};

const isInsideStringDerivedMap = (node: EsTreeNode): boolean =>
  isInsideIteratorMapMatching(node, isStringDerivedReceiver, hasProvablyStringFirstArgument);

const isInsideStaticPlaceholderMap = (node: EsTreeNode): boolean =>
  isInsideIteratorMapMatching(node, isStaticPlaceholderReceiver, isArrayFromLengthObjectCall);

/**
 * Walk up from a JSXAttribute node looking for the enclosing iterator
 * callback (`.map(cb)`, `.flatMap(cb)`, `.forEach(cb)`, `Array.from(_, cb)`)
 * and return the first parameter's name. The first param is the per-item
 * value, e.g. `item` in `arr.map((item, index) => …)`.
 */
const findIteratorItemName = (node: EsTreeNode): string | null => {
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
        (callee.property.name === "map" ||
          callee.property.name === "flatMap" ||
          callee.property.name === "forEach");
      const isArrayFromCallback =
        isArrayFromCall(parent) && parent.arguments.length >= 2 && parent.arguments[1] === current;

      if (isIteratorMethodCall || isArrayFromCallback) {
        const cbParams = (current as EsTreeNodeOfType<"ArrowFunctionExpression">).params ?? [];
        const first = cbParams[0];
        if (first && isNodeOfType(first, "Identifier")) return first.name;
        return null;
      }
    }

    current = parent;
  }
  return null;
};

const templateLiteralHasIteratorIdentity = (
  template: EsTreeNodeOfType<"TemplateLiteral">,
  itemName: string,
): boolean => {
  for (const expression of template.expressions ?? []) {
    if (isNodeOfType(expression, "Identifier") && expression.name === itemName) return true;
    if (
      isNodeOfType(expression, "MemberExpression") &&
      isNodeOfType(expression.object, "Identifier") &&
      expression.object.name === itemName
    )
      return true;
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
  const itemName = findIteratorItemName(attributeNode);
  if (!itemName) return false;
  return templateLiteralHasIteratorIdentity(keyExpression, itemName);
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

      const indexName = extractIndexName(node.value.expression);
      if (!indexName) return;
      if (isInsideStaticPlaceholderMap(node)) return;
      if (isInsideStringDerivedMap(node)) return;
      if (isCompositeKeyWithIteratorIdentity(node.value.expression, node)) return;

      // Fragment / React.Fragment has no DOM identity or state — even
      // when the key is the index, a misidentification has no
      // observable consequence (there's nothing to lose). Same for
      // pure SVG primitives (`<g>`, `<path>`, …) which only re-diff
      // attributes on reorder.
      const openingElement = node.parent;
      if (openingElement && isNodeOfType(openingElement, "JSXOpeningElement")) {
        const elementName = openingElement.name as EsTreeNode;
        if (isNodeOfType(elementName, "JSXIdentifier")) {
          if (elementName.name === "Fragment") return;
          if (PURE_SVG_PRIMITIVE_TAGS.has(elementName.name)) return;
          // Stateless HTML leaf element whose subtree contains no
          // form controls, no media, no custom components, no
          // function-call children — reorder hazard doesn't apply.
          if (STATELESS_HTML_LEAF_TAGS.has(elementName.name)) {
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
          elementName.property.name === "Fragment"
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
