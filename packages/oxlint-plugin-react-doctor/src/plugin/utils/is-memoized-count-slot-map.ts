import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { hasOnlyJsxKeyIndexReads } from "./has-only-jsx-key-index-reads.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { walkAst } from "./walk-ast.js";

// Count changes may add/remove tail slots; every retained slot keeps its value.
export const isMemoizedCountSlotMap = (
  iterator: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const scopes = context.scopes;
  if (
    !isNodeOfType(iterator.callee, "MemberExpression") ||
    iterator.callee.computed ||
    !isNodeOfType(iterator.callee.property, "Identifier") ||
    iterator.callee.property.name !== "map" ||
    !isNodeOfType(iterator.callee.object, "Identifier")
  )
    return false;
  const rendered = iterator.arguments[0];
  if (
    iterator.optional ||
    iterator.arguments.length !== 1 ||
    !isNodeOfType(rendered, "ArrowFunctionExpression") ||
    rendered.async ||
    rendered.params.length !== 2 ||
    !isNodeOfType(rendered.params[0], "Identifier") ||
    !isNodeOfType(rendered.params[1], "Identifier") ||
    !hasOnlyJsxKeyIndexReads(rendered)
  )
    return false;
  const value = scopes.symbolFor(rendered.params[0]);
  const key = scopes.symbolFor(rendered.params[1]);
  if (
    !value ||
    !key ||
    !hasCompleteSymbolReferences(key, scopes.rootScope.node, scopes) ||
    key.references.some((ref) => ref.flag !== "read") ||
    !hasCompleteSymbolReferences(value, scopes.rootScope.node, scopes) ||
    value.references.some((ref) => ref.flag !== "read")
  )
    return false;
  const presentation = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "JSXText") || isNodeOfType(node, "JSXEmptyExpression")) return true;
    if (isNodeOfType(node, "Literal"))
      return node.value === null || ["string", "number", "boolean"].includes(typeof node.value);
    if (isNodeOfType(node, "Identifier"))
      return scopes.symbolFor(node) === value || scopes.symbolFor(node) === key;
    if (isNodeOfType(node, "JSXExpressionContainer")) return presentation(node.expression);
    if (isNodeOfType(node, "JSXFragment")) return node.children.every(presentation);
    if (!isNodeOfType(node, "JSXElement")) return false;
    return (
      node.openingElement.attributes.every(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name !== "ref" &&
          !attribute.name.name.startsWith("on") &&
          (!attribute.value || presentation(attribute.value)),
      ) && node.children.every(presentation)
    );
  };
  if (
    (!isNodeOfType(rendered.body, "JSXElement") && !isNodeOfType(rendered.body, "JSXFragment")) ||
    !presentation(rendered.body)
  )
    return false;
  const receiver = iterator.callee.object;
  const list = scopes.symbolFor(receiver);
  if (
    list?.kind !== "const" ||
    !hasCompleteSymbolReferences(list, scopes.rootScope.node, scopes) ||
    list.references.length !== 1 ||
    list.references[0]?.identifier !== receiver ||
    list.references[0]?.flag !== "read" ||
    !isNodeOfType(list.initializer, "CallExpression")
  )
    return false;
  const memo = getDirectConstInitializer(list);
  if (!isNodeOfType(memo, "CallExpression")) return false;
  if (memo.optional || memo.arguments.length !== 2 || !isNodeOfType(memo.callee, "Identifier"))
    return false;
  const api = scopes.symbolFor(memo.callee);
  const specifier = api?.declarationNode;
  const declaration = specifier?.parent;
  if (
    api?.kind !== "import" ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type" ||
    !isNodeOfType(specifier.imported, "Identifier") ||
    specifier.imported.name !== "useMemo" ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    declaration.importKind === "type" ||
    declaration.source.value !== "react" ||
    !hasCompleteSymbolReferences(api, scopes.rootScope.node, scopes) ||
    api.references.some(
      (ref) =>
        ref.flag !== "read" ||
        !isNodeOfType(ref.identifier.parent, "CallExpression") ||
        ref.identifier.parent.callee !== ref.identifier,
    )
  )
    return false;
  const factory = memo.arguments[0];
  const dependencies = memo.arguments[1];
  if (
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params.length !== 0 ||
    !isNodeOfType(factory.body, "CallExpression") ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 1
  )
    return false;
  const build = factory.body;
  if (
    build.optional ||
    build.arguments.length !== 2 ||
    !isNodeOfType(build.callee, "MemberExpression") ||
    build.callee.computed ||
    !isNodeOfType(build.callee.object, "Identifier") ||
    build.callee.object.name !== "Array" ||
    scopes.symbolFor(build.callee.object) ||
    !isNodeOfType(build.callee.property, "Identifier") ||
    build.callee.property.name !== "from"
  )
    return false;
  const arrayReceiver = build.callee.object;
  const input = build.arguments[0];
  if (!isNodeOfType(input, "ObjectExpression") || input.properties.length !== 1) return false;
  const length = input.properties[0];
  const dep = dependencies.elements[0];
  if (
    !isNodeOfType(length, "Property") ||
    length.computed ||
    length.kind !== "init" ||
    length.method ||
    !isNodeOfType(length.key, "Identifier") ||
    length.key.name !== "length" ||
    !isNodeOfType(length.value, "Identifier") ||
    !isNodeOfType(dep, "Identifier") ||
    scopes.symbolFor(dep) !== scopes.symbolFor(length.value) ||
    !scopes.symbolFor(dep)
  )
    return false;
  const mapper = build.arguments[1];
  if (
    !isNodeOfType(mapper, "ArrowFunctionExpression") ||
    mapper.async ||
    mapper.params.length !== 2 ||
    !isNodeOfType(mapper.params[0], "Identifier") ||
    !isNodeOfType(mapper.params[1], "Identifier")
  )
    return false;
  const item = scopes.symbolFor(mapper.params[0]);
  const index = scopes.symbolFor(mapper.params[1]);
  if (
    !item ||
    !index ||
    !hasCompleteSymbolReferences(item, scopes.rootScope.node, scopes) ||
    item.references.length !== 0 ||
    !hasCompleteSymbolReferences(index, scopes.rootScope.node, scopes) ||
    index.references.some((ref) => ref.flag !== "read")
  )
    return false;
  const primitive = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "Literal"))
      return node.value === null || ["string", "number", "boolean"].includes(typeof node.value);
    if (isNodeOfType(node, "Identifier")) return scopes.symbolFor(node) === index;
    if (isNodeOfType(node, "TemplateLiteral")) return node.expressions.every(primitive);
    if (
      !isNodeOfType(node, "MemberExpression") ||
      !node.computed ||
      !isNodeOfType(node.object, "Identifier") ||
      !isNodeOfType(node.property, "BinaryExpression") ||
      node.property.operator !== "%" ||
      !isNodeOfType(node.property.left, "Identifier") ||
      scopes.symbolFor(node.property.left) !== index ||
      !isNodeOfType(node.property.right, "MemberExpression") ||
      node.property.right.computed ||
      !isNodeOfType(node.property.right.object, "Identifier") ||
      !isNodeOfType(node.property.right.property, "Identifier") ||
      node.property.right.property.name !== "length"
    )
      return false;
    const patternReceiver = node.object;
    const lengthReceiver = node.property.right.object;
    const pattern = scopes.symbolFor(patternReceiver);
    const patternInitializer = pattern ? getDirectConstInitializer(pattern) : null;
    return Boolean(
      pattern?.kind === "const" &&
      pattern === scopes.symbolFor(lengthReceiver) &&
      hasCompleteSymbolReferences(pattern, scopes.rootScope.node, scopes) &&
      !isNodeOfType(pattern.bindingIdentifier.parent?.parent?.parent, "ExportNamedDeclaration") &&
      isNodeOfType(patternInitializer, "ArrayExpression") &&
      patternInitializer.elements.length > 0 &&
      patternInitializer.elements.every(
        (element) =>
          isNodeOfType(element, "Literal") &&
          ["string", "number", "boolean"].includes(typeof element.value),
      ) &&
      pattern.references.every(
        (ref) =>
          ref.flag === "read" &&
          (ref.identifier === patternReceiver || ref.identifier === lengthReceiver),
      ),
    );
  };
  if (!primitive(mapper.body)) return false;
  let replaced = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (replaced) return false;
    if (isNodeOfType(node, "Identifier") && !scopes.symbolFor(node)) {
      if (
        ["globalThis", "window", "self", "global"].includes(node.name) ||
        (node.name === "Array" && node !== arrayReceiver)
      )
        replaced = true;
    }
    if (
      getGlobalRequireModuleSource(node, scopes) === "react" ||
      (isNodeOfType(node, "ImportExpression") &&
        isNodeOfType(node.source, "Literal") &&
        node.source.value === "react")
    )
      replaced = true;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      node.source.value === "react" &&
      node.specifiers.some(
        (entry) =>
          !isNodeOfType(entry, "ImportSpecifier") ||
          (entry.importKind !== "type" &&
            isNodeOfType(entry.imported, "Identifier") &&
            entry.imported.name === "default"),
      )
    )
      replaced = true;
  });
  return !replaced;
};
