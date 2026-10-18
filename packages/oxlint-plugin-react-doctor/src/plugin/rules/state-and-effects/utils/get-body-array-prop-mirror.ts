import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findSameFileTypeDeclarations } from "../../../utils/find-same-file-type-declaration.js";
import { findVisibleSymbol } from "../../../utils/find-visible-symbol.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { isInitialOnlyPropName } from "../../../utils/is-initial-only-prop-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { unwrapDiscardedExpression } from "../../../utils/unwrap-discarded-expression.js";
import {
  BODY_ARRAY_MIRROR_READONLY_REACT_APIS,
  BODY_ARRAY_MIRROR_REFLECTION_METHODS,
  BODY_ARRAY_MIRROR_UNSUPPORTED_MODULES,
  BODY_ARRAY_MIRROR_UNSUPPORTED_NAMES,
  MAX_BODY_ARRAY_MIRROR_TYPE_DEPTH,
} from "./constants.js";

interface BodyArrayPropMirrorInput {
  initializer: EsTreeNode;
  componentBody: EsTreeNode;
  scopes: ScopeAnalysis;
}

export interface BodyArrayPropMirror {
  propRootName: string;
  effectCall: EsTreeNode;
}

interface SelectedArrayProperty {
  arrayDeclaration: EsTreeNode | null;
  hasConflict: boolean;
}

interface BodyArrayMirrorModuleFacts {
  readonly program: EsTreeNode;
  readonly isSupported: boolean;
}

const moduleFactsByScopes = new WeakMap<ScopeAnalysis, BodyArrayMirrorModuleFacts>();

const mergeSelectedProperties = (
  properties: ReadonlyArray<SelectedArrayProperty>,
): SelectedArrayProperty => {
  const declarations = properties.flatMap((property) =>
    property.arrayDeclaration ? [property.arrayDeclaration] : [],
  );
  return {
    arrayDeclaration: declarations[0] ?? null,
    hasConflict: properties.some((property) => property.hasConflict) || declarations.length > 1,
  };
};

const getSelectedArrayProperty = (
  node: EsTreeNode,
  propertyName: string,
  scopes: ScopeAnalysis,
  visited: ReadonlySet<EsTreeNode> = new Set(),
): SelectedArrayProperty => {
  const absent = { arrayDeclaration: null, hasConflict: false };
  const conflict = { arrayDeclaration: null, hasConflict: true };
  if (visited.has(node) || visited.size >= MAX_BODY_ARRAY_MIRROR_TYPE_DEPTH) return conflict;
  const nextVisited = new Set(visited).add(node);
  if (isNodeOfType(node, "TSTypeAliasDeclaration")) {
    return getSelectedArrayProperty(node.typeAnnotation, propertyName, scopes, nextVisited);
  }
  if (isNodeOfType(node, "TSIntersectionType")) {
    return mergeSelectedProperties(
      node.types.map((member) =>
        getSelectedArrayProperty(member, propertyName, scopes, nextVisited),
      ),
    );
  }
  if (isNodeOfType(node, "TSUnionType")) {
    const members = node.types.map((member) =>
      getSelectedArrayProperty(member, propertyName, scopes, nextVisited),
    );
    return members.some((member) => member.arrayDeclaration || member.hasConflict)
      ? conflict
      : absent;
  }
  if (isNodeOfType(node, "TSInterfaceDeclaration") || isNodeOfType(node, "TSTypeLiteral")) {
    const members = isNodeOfType(node, "TSInterfaceDeclaration") ? node.body.body : node.members;
    const selected = members.filter(
      (member) => "key" in member && getStaticKeyName(member.key) === propertyName,
    );
    if (selected.length > 1 || members.some((member) => isNodeOfType(member, "TSIndexSignature"))) {
      return conflict;
    }
    const property = selected[0];
    let ownProperty: SelectedArrayProperty = absent;
    if (property) {
      if (
        !isNodeOfType(property, "TSPropertySignature") ||
        property.computed ||
        property.optional ||
        !isNodeOfType(property.typeAnnotation?.typeAnnotation, "TSArrayType")
      ) {
        return conflict;
      }
      ownProperty = { arrayDeclaration: property, hasConflict: false };
    }
    return isNodeOfType(node, "TSInterfaceDeclaration")
      ? mergeSelectedProperties([
          ownProperty,
          ...node.extends.map((extension) =>
            getSelectedArrayProperty(extension.expression, propertyName, scopes, nextVisited),
          ),
        ])
      : ownProperty;
  }
  const identifier = isNodeOfType(node, "TSTypeReference") ? node.typeName : node;
  if (!isNodeOfType(identifier, "Identifier")) return conflict;
  if (hasEnclosingTypeParameterNamed(identifier, identifier.name)) return conflict;
  const symbol = findVisibleSymbol(identifier, scopes);
  if (symbol?.kind === "import") return absent;
  if (
    !symbol ||
    symbol.scope !== scopes.rootScope ||
    (symbol.kind !== "ts-interface" && symbol.kind !== "ts-type-alias")
  ) {
    return conflict;
  }
  const declarations = findSameFileTypeDeclarations(identifier, identifier.name);
  if (declarations.length !== 1 || declarations[0] !== symbol.declarationNode) return conflict;
  return getSelectedArrayProperty(declarations[0], propertyName, scopes, nextVisited);
};

const hasOnlyReferences = (symbol: SymbolDescriptor, allowed: ReadonlySet<EsTreeNode>): boolean =>
  symbol.references.every((reference) => {
    const bindingProperty = symbol.bindingIdentifier.parent;
    if (
      isNodeOfType(bindingProperty, "Property") &&
      !bindingProperty.computed &&
      isNodeOfType(bindingProperty.parent, "ObjectPattern") &&
      bindingProperty.value === symbol.bindingIdentifier &&
      bindingProperty.key === reference.identifier
    )
      return true;
    return (
      isTypeScriptTypePosition(reference.identifier) ||
      (reference.flag === "read" && allowed.has(reference.identifier))
    );
  });

const isNamedValueHook = (call: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  if (!isNodeOfType(call.callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(call.callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === name,
  );
};

const hasUnsupportedModuleShape = (program: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  someAst(program, (node) => {
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") &&
        BODY_ARRAY_MIRROR_UNSUPPORTED_NAMES.has(node.name) &&
        Boolean(scopes.referenceFor(node)) &&
        !isTypeScriptTypePosition(node))
    ) {
      return true;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      if (getStaticPropertyName(node) === "constructor") return true;
      const receiver = stripParenExpression(node.object);
      return (
        isNodeOfType(receiver, "Identifier") &&
        (receiver.name === "Object" || receiver.name === "Reflect") &&
        BODY_ARRAY_MIRROR_REFLECTION_METHODS.has(getStaticPropertyName(node) ?? "")
      );
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      return getStaticPropertyKeyName(node, { allowComputedString: true }) === "constructor";
    }
    return false;
  });

const hasClosedReactProviders = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    const source = statement.source.value;
    const hasValueImport =
      statement.specifiers.length === 0 ||
      statement.specifiers.some(
        (specifier) =>
          statement.importKind !== "type" &&
          (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type"),
      );
    if (
      typeof source === "string" &&
      hasValueImport &&
      (BODY_ARRAY_MIRROR_UNSUPPORTED_MODULES.has(source) || source.startsWith("preact"))
    ) {
      return false;
    }
    if (source !== "react") continue;
    for (const specifier of statement.specifiers) {
      const symbol = scopes.symbolFor(specifier.local);
      if (!symbol) return false;
      const isValue = getValueImportSource(symbol) === "react";
      for (const reference of symbol.references) {
        const identifier = reference.identifier;
        if (isTypeScriptTypePosition(identifier)) continue;
        if (!isValue || reference.flag !== "read") return false;
        const parent = identifier.parent;
        if (
          isNodeOfType(specifier, "ImportSpecifier") &&
          getImportedName(specifier) !== "default"
        ) {
          if (
            !isNodeOfType(parent, "CallExpression") ||
            parent.callee !== identifier ||
            parent.optional
          )
            return false;
          continue;
        }
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== identifier ||
          parent.optional ||
          !BODY_ARRAY_MIRROR_READONLY_REACT_APIS.has(getStaticPropertyName(parent) ?? "") ||
          !isNodeOfType(parent.parent, "CallExpression") ||
          parent.parent.callee !== parent ||
          parent.parent.optional
        ) {
          return false;
        }
      }
    }
  }
  return true;
};

const hasAdmittedSiblings = (pattern: EsTreeNode): boolean => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  return pattern.properties.every((property, index) => {
    if (isNodeOfType(property, "RestElement")) {
      return (
        index === pattern.properties.length - 1 && isNodeOfType(property.argument, "Identifier")
      );
    }
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      getStaticKeyName(property.key) === null
    )
      return false;
    if (isNodeOfType(property.value, "Identifier")) return true;
    return (
      isNodeOfType(property.value, "AssignmentPattern") &&
      isNodeOfType(property.value.left, "Identifier") &&
      isNodeOfType(property.value.right, "Literal") &&
      (property.value.right.value === null ||
        typeof property.value.right.value === "string" ||
        typeof property.value.right.value === "number" ||
        typeof property.value.right.value === "boolean")
    );
  });
};

export const getBodyArrayPropMirror = ({
  initializer,
  componentBody,
  scopes,
}: BodyArrayPropMirrorInput): BodyArrayPropMirror | null => {
  if (
    !isNodeOfType(initializer, "Identifier") ||
    isInitialOnlyPropName(initializer.name) ||
    !isNodeOfType(componentBody, "BlockStatement")
  )
    return null;
  const component = componentBody.parent;
  if (
    (!isNodeOfType(component, "ArrowFunctionExpression") &&
      !isNodeOfType(component, "FunctionExpression") &&
      !isNodeOfType(component, "FunctionDeclaration")) ||
    component.params.length !== 1 ||
    !isNodeOfType(component.params[0], "Identifier")
  )
    return null;
  const props = scopes.symbolFor(component.params[0]);
  const alias = scopes.symbolFor(initializer);
  const declaration = alias?.declarationNode;
  if (
    !props ||
    props.kind !== "parameter" ||
    !alias ||
    alias.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !hasAdmittedSiblings(declaration.id) ||
    !isNodeOfType(declaration.init, "Identifier") ||
    scopes.symbolFor(declaration.init) !== props ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    declaration.parent.declarations.length !== 1 ||
    declaration.parent.parent !== componentBody
  )
    return null;
  const selected = declaration.id.properties.find(
    (property) => isNodeOfType(property, "Property") && property.value === alias.bindingIdentifier,
  );
  if (
    !isNodeOfType(selected, "Property") ||
    selected.computed ||
    !isNodeOfType(selected.key, "Identifier") ||
    !isNodeOfType(selected.value, "Identifier") ||
    isInitialOnlyPropName(selected.key.name)
  )
    return null;
  const annotation = getSymbolTypeAnnotation(props);
  if (!annotation) return null;
  const propertyContract = getSelectedArrayProperty(annotation, selected.key.name, scopes);
  if (
    !propertyContract.arrayDeclaration ||
    propertyContract.hasConflict ||
    !hasOnlyReferences(props, new Set([declaration.init]))
  )
    return null;
  const stateCall = initializer.parent;
  const stateDeclaration = stateCall?.parent;
  if (
    !isNodeOfType(stateCall, "CallExpression") ||
    stateCall.arguments.length !== 1 ||
    stateCall.arguments[0] !== initializer ||
    !isNamedValueHook(stateCall, "useState", scopes) ||
    !isNodeOfType(stateDeclaration, "VariableDeclarator") ||
    !isNodeOfType(stateDeclaration.id, "ArrayPattern") ||
    stateDeclaration.id.elements.length !== 2 ||
    !isNodeOfType(stateDeclaration.id.elements[0], "Identifier") ||
    !isNodeOfType(stateDeclaration.id.elements[1], "Identifier") ||
    !isNodeOfType(stateDeclaration.parent, "VariableDeclaration") ||
    stateDeclaration.parent.kind !== "const" ||
    stateDeclaration.parent.declarations.length !== 1 ||
    stateDeclaration.parent.parent !== componentBody ||
    declaration.range[0] >= stateDeclaration.range[0]
  )
    return null;
  const setter = scopes.symbolFor(stateDeclaration.id.elements[1]);
  if (
    !setter ||
    setter.references.some(
      (reference) =>
        reference.flag !== "read" ||
        !isNodeOfType(reference.identifier.parent, "CallExpression") ||
        reference.identifier.parent.callee !== reference.identifier,
    )
  )
    return null;
  const program = findProgramRoot(componentBody);
  if (!program) return null;
  let moduleFacts = moduleFactsByScopes.get(scopes);
  if (!moduleFacts || moduleFacts.program !== program) {
    moduleFacts = {
      program,
      isSupported:
        !hasUnsupportedModuleShape(program, scopes) && hasClosedReactProviders(program, scopes),
    };
    moduleFactsByScopes.set(scopes, moduleFacts);
  }
  if (!moduleFacts.isSupported) return null;
  for (const statement of componentBody.body) {
    if (!isNodeOfType(statement, "ExpressionStatement")) continue;
    const effectCall = statement.expression;
    if (
      !isNodeOfType(effectCall, "CallExpression") ||
      !isNamedValueHook(effectCall, "useEffect", scopes) ||
      effectCall.arguments.length !== 2 ||
      stateDeclaration.range[0] >= effectCall.range[0]
    )
      continue;
    const dependencies = effectCall.arguments[1];
    if (!isNodeOfType(dependencies, "ArrayExpression") || dependencies.elements.length !== 1)
      continue;
    const dependency = dependencies.elements[0];
    if (!isNodeOfType(dependency, "Identifier") || scopes.symbolFor(dependency) !== alias) continue;
    const callback = getEffectCallback(effectCall);
    if (
      (!isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")) ||
      callback.async ||
      callback.generator ||
      callback.params.length !== 0
    )
      continue;
    const statements = getCallbackStatements(callback);
    if (statements.length !== 1) continue;
    const onlyStatement = statements[0];
    const expression = unwrapDiscardedExpression(
      isNodeOfType(onlyStatement, "ReturnStatement") && onlyStatement.argument
        ? onlyStatement.argument
        : onlyStatement,
    );
    if (
      !isNodeOfType(expression, "CallExpression") ||
      expression.optional ||
      !isNodeOfType(expression.callee, "Identifier") ||
      scopes.symbolFor(expression.callee) !== setter ||
      expression.arguments.length !== 1
    )
      continue;
    const argument = expression.arguments[0];
    if (
      !isNodeOfType(argument, "Identifier") ||
      scopes.symbolFor(argument) !== alias ||
      !hasOnlyReferences(alias, new Set([initializer, dependency, argument]))
    )
      continue;
    return { propRootName: initializer.name, effectCall };
  }
  return null;
};
