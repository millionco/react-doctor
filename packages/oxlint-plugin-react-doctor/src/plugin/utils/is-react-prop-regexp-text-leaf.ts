import { HTML_TAGS } from "../constants/html-tags.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findSameFileTypeDeclarations } from "./find-same-file-type-declaration.js";
import { getSymbolMutationInspector } from "./get-symbol-mutation-inspector.js";
import { isComponentFunction } from "./is-component-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { isJsxFragmentElement } from "./is-jsx-fragment-element.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  containsStatefulDescendant,
  hasStatefulHtmlAttribute,
  PURE_SVG_PRIMITIVE_TAGS,
  STATELESS_HTML_LEAF_TAGS,
} from "./jsx-stateless-leaf.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

interface ReactPropRegExpTextLeafInput {
  jsxElement: EsTreeNode;
  iteratorCall: EsTreeNode;
  indexIdentifier: EsTreeNode;
  context: RuleContext;
}

const textProtocolGlobals = new Set([
  "RegExp",
  "String",
  "Array",
  "Symbol",
  "Object",
  "Reflect",
  "Function",
  "eval",
  "globalThis",
  "global",
  "window",
  "self",
]);
const unsupportedProtocolAccessByScopes = new WeakMap<ScopeAnalysis, boolean>();

const hasUnsupportedProtocolAccess = (scopes: ScopeAnalysis): boolean => {
  const cached = unsupportedProtocolAccessByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let unsupported = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (unsupported) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MemberExpression") &&
        (node.computed ||
          (isNodeOfType(node.property, "Identifier") &&
            (node.property.name === "constructor" ||
              node.property.name === "__proto__" ||
              node.property.name === "prototype")))) ||
      (isNodeOfType(node, "Identifier") &&
        textProtocolGlobals.has(node.name) &&
        scopes.isGlobalReference(node))
    )
      unsupported = true;
  });
  unsupportedProtocolAccessByScopes.set(scopes, unsupported);
  return unsupported;
};

const visibleSymbol = (
  node: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  let scope = scopes.scopeFor(node);
  for (;;) {
    const symbol = scope.symbolsByName.get(name);
    if (symbol) return symbol;
    if (!scope.parent) return null;
    scope = scope.parent;
  }
};

const getPlainProp = (
  parameter: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"TSPropertySignature"> | null => {
  if (!isNodeOfType(parameter, "Identifier") || !parameter.typeAnnotation) return null;
  const annotation = parameter.typeAnnotation;
  if (!isNodeOfType(annotation, "TSTypeAnnotation")) return null;
  let declaration: EsTreeNode = annotation.typeAnnotation;
  if (isNodeOfType(declaration, "TSTypeReference")) {
    if (!isNodeOfType(declaration.typeName, "Identifier") || declaration.typeArguments) return null;
    const [matchingDeclaration, ...otherDeclarations] = findSameFileTypeDeclarations(
      parameter,
      declaration.typeName.name,
    );
    if (!matchingDeclaration || Boolean(otherDeclarations.length)) return null;
    if (
      visibleSymbol(parameter, declaration.typeName.name, scopes)?.declarationNode !==
      matchingDeclaration
    )
      return null;
    declaration = matchingDeclaration;
  }
  if (isNodeOfType(declaration, "TSTypeAliasDeclaration")) {
    if (declaration.typeParameters) return null;
    declaration = declaration.typeAnnotation;
  }
  let members: ReadonlyArray<EsTreeNode>;
  if (isNodeOfType(declaration, "TSInterfaceDeclaration")) {
    if (declaration.typeParameters || Boolean(declaration.extends.length)) return null;
    members = declaration.body.body;
  } else if (isNodeOfType(declaration, "TSTypeLiteral")) members = declaration.members;
  else return null;
  if (members.some((member) => isNodeOfType(member, "TSIndexSignature"))) return null;
  const matchingMembers = members.filter(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      ((isNodeOfType(member.key, "Identifier") && member.key.name === name) ||
        (isNodeOfType(member.key, "Literal") && member.key.value === name)),
  );
  const [member, ...otherMembers] = matchingMembers;
  if (!isNodeOfType(member, "TSPropertySignature") || Boolean(otherMembers.length)) return null;
  return !member.computed && isNodeOfType(member.key, "Identifier") ? member : null;
};

const hasOrdinaryRegExpType = (
  property: EsTreeNodeOfType<"TSPropertySignature">,
  reference: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (visibleSymbol(reference, "RegExp", scopes)) return false;
  const annotation = property.typeAnnotation;
  if (!isNodeOfType(annotation, "TSTypeAnnotation")) return false;
  const types = isNodeOfType(annotation.typeAnnotation, "TSUnionType")
    ? annotation.typeAnnotation.types
    : [annotation.typeAnnotation];
  let hasRegExp = false;
  return (
    types.every((type) => {
      if (
        isNodeOfType(type, "TSTypeReference") &&
        isNodeOfType(type.typeName, "Identifier") &&
        type.typeName.name === "RegExp" &&
        !type.typeArguments &&
        !hasRegExp
      ) {
        hasRegExp = true;
        return true;
      }
      return (
        isNodeOfType(type, "TSUndefinedKeyword") ||
        isNodeOfType(type, "TSNullKeyword") ||
        (isNodeOfType(type, "TSLiteralType") &&
          isNodeOfType(type.literal, "Literal") &&
          type.literal.value === null)
      );
    }) && hasRegExp
  );
};

const isSameSymbol = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"Identifier"> =>
  isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;

const hasOnlyReferences = (symbol: SymbolDescriptor, allowed: ReadonlySet<EsTreeNode>): boolean =>
  symbol.references.every(
    (reference) => reference.flag === "read" && allowed.has(reference.identifier),
  );

const isPlainMember = (
  node: EsTreeNode,
  name: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name;

const isDirectComponentOwner = (node: EsTreeNode): boolean => {
  if (!isComponentFunction(node)) return false;
  let declaration = node;
  if (!isNodeOfType(node, "FunctionDeclaration")) {
    if (isNodeOfType(node.parent, "ExportDefaultDeclaration"))
      return isNodeOfType(node.parent.parent, "Program");
    const declarator = node.parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== node ||
      !isNodeOfType(declarator.parent, "VariableDeclaration")
    )
      return false;
    declaration = declarator.parent;
  }
  if (
    isNodeOfType(declaration.parent, "ExportNamedDeclaration") ||
    isNodeOfType(declaration.parent, "ExportDefaultDeclaration")
  )
    declaration = declaration.parent;
  return isNodeOfType(declaration.parent, "Program");
};

const isClosedRenderHelper = (
  helper: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(helper) || helper.async || helper.generator || Boolean(helper.params.length))
    return false;
  const declarator = helper.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== helper ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return false;
  const declaration = declarator.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !isFunctionLike(component) ||
    declaration.parent !== component.body
  )
    return false;
  const symbol = scopes.symbolFor(declarator.id);
  if (!symbol || symbol.initializer !== helper) return false;
  const [reference, ...otherReferences] = symbol.references;
  if (!reference || Boolean(otherReferences.length) || reference.flag !== "read") return false;
  const call = reference.identifier.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== reference.identifier ||
    call.optional ||
    Boolean(call.arguments.length) ||
    findEnclosingFunction(call) !== component
  )
    return false;
  let current: EsTreeNode = call;
  if (!isNodeOfType(current.parent, "JSXExpressionContainer")) return false;
  while (current.parent && current.parent !== component) {
    current = current.parent;
    if (isNodeOfType(current, "JSXElement")) {
      const opening = current.openingElement;
      const name = opening.name;
      // A render-only helper must stay in a known DOM/fragment child position:
      // composites can transform children, and ancestor state can reach the leaves.
      const isBoundFragment =
        isNodeOfType(name, "JSXIdentifier") &&
        Boolean(scopes.symbolFor(name)) &&
        isJsxFragmentElement(opening, scopes);
      const isKnownIntrinsic =
        isNodeOfType(name, "JSXIdentifier") &&
        (HTML_TAGS.has(name.name) || PURE_SVG_PRIMITIVE_TAGS.has(name.name));
      if (
        (!isKnownIntrinsic && !isBoundFragment) ||
        opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")) ||
        hasJsxPropIgnoreCase(opening.attributes, "ref") ||
        hasJsxPropIgnoreCase(opening.attributes, "is") ||
        hasStatefulHtmlAttribute(opening)
      )
        return false;
    }
    if (isNodeOfType(current, "ReturnStatement")) {
      return Boolean(
        current.argument &&
        (isNodeOfType(current.argument, "JSXElement") ||
          isNodeOfType(current.argument, "JSXFragment")) &&
        findEnclosingFunction(current) === component,
      );
    }
    if (
      !isNodeOfType(current, "JSXExpressionContainer") &&
      !isNodeOfType(current, "JSXElement") &&
      !isNodeOfType(current, "JSXFragment")
    )
      return false;
  }
  return false;
};

const isNullPropsGuard = (identifier: EsTreeNode): boolean => {
  const test = identifier.parent;
  if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return false;
  const statement = test.parent;
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.test !== test ||
    statement.alternate ||
    !isNodeOfType(statement.consequent, "BlockStatement")
  )
    return false;
  const [exit, ...otherStatements] = statement.consequent.body;
  return (
    otherStatements.length === 0 &&
    isNodeOfType(exit, "ReturnStatement") &&
    isNodeOfType(exit.argument, "Literal") &&
    exit.argument.value === null
  );
};

const isReturnedJsxPosition = (node: EsTreeNode, component: EsTreeNode): boolean => {
  let current = node;
  while (current.parent && current.parent !== component) {
    const parent = current.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return (
        parent.argument === current &&
        findEnclosingFunction(parent) === component &&
        (isNodeOfType(current, "JSXElement") || isNodeOfType(current, "JSXFragment"))
      );
    }
    if (
      !isNodeOfType(parent, "JSXAttribute") &&
      !isNodeOfType(parent, "JSXExpressionContainer") &&
      !isNodeOfType(parent, "JSXOpeningElement") &&
      !isNodeOfType(parent, "JSXClosingElement") &&
      !isNodeOfType(parent, "JSXElement") &&
      !isNodeOfType(parent, "JSXFragment")
    )
      return false;
    current = parent;
  }
  return false;
};

const isDeferredDomEventValue = (node: EsTreeNode, component: EsTreeNode): boolean => {
  const container = node.parent;
  if (!isNodeOfType(container, "JSXExpressionContainer") || container.expression !== node)
    return false;
  const attribute = container.parent;
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    attribute.value !== container ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    !/^on[A-Z]/.test(attribute.name.name)
  )
    return false;
  const opening = attribute.parent;
  return (
    isNodeOfType(opening, "JSXOpeningElement") &&
    isNodeOfType(opening.name, "JSXIdentifier") &&
    /^[a-z]+$/.test(opening.name.name) &&
    isReturnedJsxPosition(attribute, component)
  );
};

const isOwnedDeferredHandler = (
  node: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const handler = findEnclosingFunction(node);
  if (
    !isFunctionLike(handler) ||
    handler === component ||
    handler.async ||
    handler.generator ||
    findEnclosingFunction(handler) !== component
  )
    return false;
  if (isDeferredDomEventValue(handler, component)) return true;
  const declarator = handler.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== handler ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isFunctionLike(component) ||
    declarator.parent.parent !== component.body
  )
    return false;
  const symbol = scopes.symbolFor(declarator.id);
  return Boolean(
    symbol &&
    symbol.initializer === handler &&
    symbol.references.length &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        findEnclosingFunction(reference.identifier) === component &&
        isDeferredDomEventValue(reference.identifier, component),
    ),
  );
};

const isDeferredComponentValue = (
  member: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const declarator = member.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== member ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isFunctionLike(component) ||
    declarator.parent.parent !== component.body
  )
    return false;
  const symbol = scopes.symbolFor(declarator.id);
  if (!symbol || symbol.references.length === 0) return false;
  let usedAsJsx = false;
  const closed = symbol.references.every((reference) => {
    if (reference.flag !== "read" || findEnclosingFunction(reference.identifier) !== component)
      return false;
    if (isNullPropsGuard(reference.identifier)) return true;
    const parent = reference.identifier.parent;
    if (
      (!isNodeOfType(parent, "JSXOpeningElement") && !isNodeOfType(parent, "JSXClosingElement")) ||
      parent.name !== reference.identifier ||
      !isReturnedJsxPosition(reference.identifier, component)
    )
      return false;
    usedAsJsx = true;
    return true;
  });
  return closed && usedAsJsx;
};

export const isReactPropRegExpTextLeaf = ({
  jsxElement,
  iteratorCall,
  indexIdentifier,
  context,
}: ReactPropRegExpTextLeafInput): boolean => {
  const { scopes } = context;
  if (
    !isNodeOfType(jsxElement, "JSXElement") ||
    !isNodeOfType(iteratorCall, "CallExpression") ||
    iteratorCall.optional ||
    !isPlainMember(iteratorCall.callee, "map")
  )
    return false;
  const leafName = jsxElement.openingElement.name;
  if (!isNodeOfType(leafName, "JSXIdentifier") || !STATELESS_HTML_LEAF_TAGS.has(leafName.name))
    return false;
  const [callback, ...extraMapArguments] = iteratorCall.arguments;
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    Boolean(extraMapArguments.length)
  )
    return false;
  const [item, index, ...otherParameters] = callback.params;
  if (
    !isNodeOfType(item, "Identifier") ||
    !isNodeOfType(index, "Identifier") ||
    Boolean(otherParameters.length)
  )
    return false;
  const itemSymbol = scopes.symbolFor(item);
  const indexSymbol = scopes.symbolFor(index);
  if (!itemSymbol || !indexSymbol || !isSameSymbol(indexIdentifier, indexSymbol, scopes))
    return false;
  const split = iteratorCall.callee.object;
  if (
    !isNodeOfType(split, "CallExpression") ||
    split.optional ||
    !isPlainMember(split.callee, "split")
  )
    return false;
  const [separator, ...extraSplitArguments] = split.arguments;
  if (!isNodeOfType(separator, "Identifier") || Boolean(extraSplitArguments.length)) return false;
  const receiver = split.callee.object;
  if (
    !isNodeOfType(receiver, "MemberExpression") ||
    receiver.computed ||
    receiver.optional ||
    !isNodeOfType(receiver.object, "Identifier") ||
    !isNodeOfType(receiver.property, "Identifier")
  )
    return false;
  const props = scopes.symbolFor(receiver.object);
  const pattern = scopes.symbolFor(separator);
  if (props?.kind !== "parameter" || pattern?.kind !== "const") return false;
  const component = findEnclosingFunction(props.bindingIdentifier);
  const owner = findEnclosingFunction(iteratorCall);
  if (
    !isFunctionLike(component) ||
    !isFunctionLike(owner) ||
    component.async ||
    component.generator ||
    !isDirectComponentOwner(component)
  )
    return false;
  const [propsParameter, ...otherComponentParameters] = component.params;
  if (
    !isNodeOfType(propsParameter, "Identifier") ||
    propsParameter !== props.bindingIdentifier ||
    Boolean(otherComponentParameters.length)
  )
    return false;
  if (owner !== component && !isClosedRenderHelper(owner, component, scopes)) return false;
  if (!isNodeOfType(owner.body, "BlockStatement")) return false;
  const [patternDeclaration, branch, fallback, ...otherStatements] = owner.body.body;
  if (
    Boolean(otherStatements.length) ||
    !isNodeOfType(patternDeclaration, "VariableDeclaration") ||
    patternDeclaration.kind !== "const" ||
    !isNodeOfType(branch, "IfStatement") ||
    branch.alternate ||
    !isSameSymbol(branch.test, pattern, scopes) ||
    !isNodeOfType(branch.consequent, "BlockStatement")
  )
    return false;
  const [patternDeclarator, ...otherDeclarators] = patternDeclaration.declarations;
  if (
    !patternDeclarator ||
    Boolean(otherDeclarators.length) ||
    pattern.declarationNode !== patternDeclarator ||
    !isNodeOfType(patternDeclarator.id, "ObjectPattern") ||
    !isSameSymbol(patternDeclarator.init, props, scopes)
  )
    return false;
  const [patternProperty, ...otherPatternProperties] = patternDeclarator.id.properties;
  if (
    !isNodeOfType(patternProperty, "Property") ||
    Boolean(otherPatternProperties.length) ||
    patternProperty.computed ||
    patternProperty.kind !== "init" ||
    patternProperty.method ||
    !isNodeOfType(patternProperty.key, "Identifier") ||
    patternProperty.value !== pattern.bindingIdentifier
  )
    return false;
  const patternPropertyName = patternProperty.key.name;
  const [branchReturn, ...otherBranchStatements] = branch.consequent.body;
  if (
    Boolean(otherBranchStatements.length) ||
    !isNodeOfType(branchReturn, "ReturnStatement") ||
    branchReturn.argument !== iteratorCall ||
    !isNodeOfType(fallback, "ReturnStatement") ||
    !fallback.argument ||
    !isPlainMember(fallback.argument, receiver.property.name) ||
    !isSameSymbol(fallback.argument.object, props, scopes)
  )
    return false;
  const stringProperty = getPlainProp(propsParameter, receiver.property.name, scopes);
  const regexpProperty = getPlainProp(propsParameter, patternPropertyName, scopes);
  if (
    !stringProperty ||
    stringProperty.optional ||
    !regexpProperty ||
    !isNodeOfType(stringProperty.typeAnnotation, "TSTypeAnnotation") ||
    !isNodeOfType(stringProperty.typeAnnotation.typeAnnotation, "TSStringKeyword") ||
    !hasOrdinaryRegExpType(regexpProperty, separator, scopes)
  )
    return false;
  const children = jsxElement.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || Boolean(child.value.trim()),
  );
  const [child, ...otherChildren] = children;
  if (
    Boolean(otherChildren.length) ||
    !isNodeOfType(child, "JSXExpressionContainer") ||
    !isSameSymbol(child.expression, itemSymbol, scopes)
  )
    return false;
  const itemReads = new Set<EsTreeNode>([child.expression]);
  const patternReads = new Set<EsTreeNode>([patternProperty.key, separator, branch.test]);
  const indexReads = new Set<EsTreeNode>();
  const attributeNames = new Set<string>();
  for (const attribute of jsxElement.openingElement.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attributeNames.has(attribute.name.name)
    )
      return false;
    attributeNames.add(attribute.name.name);
    if (attribute.name.name === "key") {
      if (
        !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
        !isSameSymbol(attribute.value.expression, indexSymbol, scopes)
      )
        return false;
      indexReads.add(attribute.value.expression);
    } else if (
      attribute.name.name !== "className" ||
      !isNodeOfType(attribute.value, "Literal") ||
      typeof attribute.value.value !== "string"
    )
      return false;
  }
  if (!attributeNames.has("key")) return false;
  if (callback.body !== jsxElement) {
    const conditional = callback.body;
    if (!isNodeOfType(conditional, "ConditionalExpression")) return false;
    const other =
      conditional.consequent === jsxElement ? conditional.alternate : conditional.consequent;
    if (conditional.consequent !== jsxElement && conditional.alternate !== jsxElement) return false;
    if (!isSameSymbol(other, itemSymbol, scopes)) return false;
    itemReads.add(other);
    const predicate = conditional.test;
    if (
      !isNodeOfType(predicate, "CallExpression") ||
      predicate.optional ||
      !isPlainMember(predicate.callee, "match") ||
      !isSameSymbol(predicate.callee.object, itemSymbol, scopes)
    )
      return false;
    const [matchingPattern, ...extraMatchArguments] = predicate.arguments;
    if (!isSameSymbol(matchingPattern, pattern, scopes) || Boolean(extraMatchArguments.length))
      return false;
    itemReads.add(predicate.callee.object);
    patternReads.add(matchingPattern);
  }
  if (
    !hasOnlyReferences(itemSymbol, itemReads) ||
    !hasOnlyReferences(indexSymbol, indexReads) ||
    !hasOnlyReferences(pattern, patternReads)
  )
    return false;
  const mutations = getSymbolMutationInspector(scopes);
  if (
    !props.references.every((reference) => {
      if (
        reference.flag !== "read" ||
        mutations.getMutationPropertyNames(reference.identifier) !== undefined
      )
        return false;
      if (reference.identifier === patternDeclarator.init || isNullPropsGuard(reference.identifier))
        return true;
      const member = reference.identifier.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== reference.identifier ||
        member.computed ||
        member.optional ||
        !isNodeOfType(member.property, "Identifier") ||
        member.property.name === patternPropertyName
      )
        return false;
      if (member === receiver && member.parent === split.callee) return true;
      const parent = member.parent;
      if (isNodeOfType(parent, "MemberExpression") && parent.object === member) return false;
      if (isNodeOfType(parent, "CallExpression") && parent.callee === member)
        return isOwnedDeferredHandler(reference.identifier, component, scopes);
      const property = getPlainProp(propsParameter, member.property.name, scopes);
      if (
        property &&
        isNodeOfType(property.typeAnnotation, "TSTypeAnnotation") &&
        isNodeOfType(property.typeAnnotation.typeAnnotation, "TSStringKeyword")
      )
        return true;
      if (isDeferredComponentValue(member, component, scopes)) return true;
      return (
        isNodeOfType(parent, "IfStatement") &&
        parent.test === member &&
        isOwnedDeferredHandler(reference.identifier, component, scopes)
      );
    })
  )
    return false;
  return (
    !hasUnsupportedProtocolAccess(scopes) &&
    !containsStatefulDescendant(jsxElement, { bareIdentifierNames: new Set([item.name]) })
  );
};
