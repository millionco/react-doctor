import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFiniteStaticStringValues } from "../../../utils/get-finite-static-string-values.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getReactDoctorStringArraySetting } from "../../../utils/get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  EDITABLE_POSITION_CHARACTER_COUNT,
  EDITABLE_POSITION_LABEL_OFFSET_COUNT,
  EDITABLE_POSITION_PAIR_COUNT,
  EDITABLE_POSITION_SINGLE_COUNT,
  EDITABLE_POSITION_REFLECTION_PROPERTIES,
  EDITABLE_POSITION_UNSUPPORTED_CALLS,
  EDITABLE_POSITION_UNSUPPORTED_GLOBALS,
  EDITABLE_POSITION_UNSUPPORTED_MODULES,
} from "./constants.js";

interface EditablePositionMap {
  readonly component: EsTreeNodeOfType<"ArrowFunctionExpression">;
  readonly attributes: ReadonlyMap<string, EsTreeNodeOfType<"JSXAttribute">>;
  readonly item: SymbolDescriptor;
  readonly index: SymbolDescriptor;
  readonly state: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly initial: EsTreeNodeOfType<"ArrayExpression">;
  readonly stateRead: EsTreeNode;
  readonly itemReads: Set<EsTreeNode>;
  readonly indexReads: Set<EsTreeNode>;
}

interface EditablePositionWriter {
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly stateRead: EsTreeNode;
}

const providerSupportByScopes = new WeakMap<ScopeAnalysis, boolean>();

const isErasedReference = (node: EsTreeNode): boolean => {
  if (isTypeScriptTypePosition(node)) return true;
  const specifier = node.parent;
  if (!isNodeOfType(specifier, "ExportSpecifier")) return false;
  return (
    ("exportKind" in specifier && specifier.exportKind === "type") ||
    (isNodeOfType(specifier.parent, "ExportNamedDeclaration") &&
      specifier.parent.exportKind === "type")
  );
};

const hasOnlyReferences = (symbol: SymbolDescriptor, allowed: ReadonlySet<EsTreeNode>): boolean =>
  symbol.references.every(
    (reference) =>
      isErasedReference(reference.identifier) ||
      (reference.flag === "read" && allowed.has(reference.identifier)),
  );

const isSameSymbol = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;

const isDirectMethod = (
  node: EsTreeNode | null | undefined,
  name: string,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  !node.callee.optional &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === name &&
  node.arguments.length === EDITABLE_POSITION_SINGLE_COUNT;

const isNativeHook = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== EDITABLE_POSITION_SINGLE_COUNT ||
    !isNodeOfType(node.callee, "Identifier") ||
    node.callee.name !== name
  )
    return false;
  const symbol = scopes.symbolFor(node.callee);
  return Boolean(
    symbol &&
    getValueImportSource(symbol) === "react" &&
    getImportedName(symbol.declarationNode) === name,
  );
};

const hasSupportedProviders = (context: RuleContext): boolean => {
  const scopes = context.scopes;
  const cached = providerSupportByScopes.get(scopes);
  if (cached !== undefined) return cached;
  const unsupported = someAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression")) return true;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (EDITABLE_POSITION_UNSUPPORTED_MODULES.has(node.source.value)) {
        return (
          !isTypeOnlyImport(node) ||
          node.specifiers.some((specifier) => {
            const symbol = scopes.symbolFor(specifier.local);
            return (
              !symbol ||
              symbol.references.some((reference) => !isErasedReference(reference.identifier))
            );
          })
        );
      }
      if (node.source.value !== "react") return false;
      return node.specifiers.some((specifier) => {
        const symbol = scopes.symbolFor(specifier.local);
        if (!symbol) return true;
        return symbol.references.some((reference) => {
          if (isErasedReference(reference.identifier)) return false;
          const call = reference.identifier.parent;
          return (
            getValueImportSource(symbol) !== "react" ||
            !isNodeOfType(specifier, "ImportSpecifier") ||
            reference.flag !== "read" ||
            !isNodeOfType(call, "CallExpression") ||
            call.optional ||
            call.callee !== reference.identifier
          );
        });
      });
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (
        node.computed &&
        [...getFiniteStaticStringValues(node.property, context)].some((value) =>
          EDITABLE_POSITION_REFLECTION_PROPERTIES.has(value),
        )
      )
        return true;
      if (property && EDITABLE_POSITION_REFLECTION_PROPERTIES.has(property)) return true;
      if (
        node.computed &&
        !property &&
        isNodeOfType(node.object, "Identifier") &&
        node.object.name === "Array"
      )
        return true;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const property = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (
        node.computed &&
        [...getFiniteStaticStringValues(node.key, context)].some((value) =>
          EDITABLE_POSITION_REFLECTION_PROPERTIES.has(value),
        )
      )
        return true;
      if (property === null || EDITABLE_POSITION_REFLECTION_PROPERTIES.has(property)) return true;
    }
    if (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "NewExpression")) {
      const callee = stripParenExpression(node.callee);
      if (
        isNodeOfType(callee, "Identifier") &&
        EDITABLE_POSITION_UNSUPPORTED_CALLS.has(callee.name)
      )
        return true;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      !isErasedReference(node) &&
      (EDITABLE_POSITION_UNSUPPORTED_GLOBALS.has(node.name) ||
        EDITABLE_POSITION_UNSUPPORTED_CALLS.has(node.name)) &&
      scopes.referenceFor(node)
    )
      return true;
    return false;
  });
  providerSupportByScopes.set(scopes, !unsupported);
  return !unsupported;
};

const isEmptyStringArray = (node: EsTreeNode): node is EsTreeNodeOfType<"ArrayExpression"> =>
  isNodeOfType(node, "ArrayExpression") &&
  node.elements.length > 0 &&
  node.elements.every((element) => isNodeOfType(element, "Literal") && element.value === "");

const getAttributeExpression = (
  attributes: EditablePositionMap["attributes"],
  name: string,
): EsTreeNode | null => {
  const value = attributes.get(name)?.value;
  return isNodeOfType(value, "JSXExpressionContainer") ? value.expression : null;
};

const readPositionMap = (
  key: EsTreeNodeOfType<"JSXAttribute">,
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): EditablePositionMap | null => {
  if (
    !isDirectMethod(call, "map") ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    !isNodeOfType(call.callee.object, "Identifier")
  )
    return null;
  const [callback] = call.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.generator ||
    callback.params.length !== EDITABLE_POSITION_PAIR_COUNT ||
    !isNodeOfType(callback.body, "JSXElement") ||
    callback.body.children.length !== 0
  )
    return null;
  const opening = callback.body.openingElement;
  if (key.parent !== opening || !isNodeOfType(opening.name, "JSXIdentifier")) return null;
  const [itemParameter, indexParameter] = callback.params;
  if (!isNodeOfType(itemParameter, "Identifier") || !isNodeOfType(indexParameter, "Identifier"))
    return null;
  const item = scopes.symbolFor(itemParameter);
  const index = scopes.symbolFor(indexParameter);
  const state = scopes.symbolFor(call.callee.object);
  const declaration = state?.declarationNode;
  if (
    !item ||
    !index ||
    !state ||
    state.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    declaration.parent.declarations.length !== EDITABLE_POSITION_SINGLE_COUNT ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== EDITABLE_POSITION_PAIR_COUNT ||
    !declaration.init ||
    !isNativeHook(declaration.init, "useState", scopes)
  )
    return null;
  const [stateBinding, setterBinding] = declaration.id.elements;
  if (stateBinding !== state.bindingIdentifier || !isNodeOfType(setterBinding, "Identifier"))
    return null;
  const setter = scopes.symbolFor(setterBinding);
  if (!setter || setter.kind !== "const" || !isNodeOfType(declaration.init, "CallExpression"))
    return null;
  const [initial] = declaration.init.arguments;
  const component = findEnclosingFunction(declaration);
  if (
    !initial ||
    !isEmptyStringArray(initial) ||
    !isNodeOfType(component, "ArrowFunctionExpression") ||
    component.async ||
    component.generator ||
    !isNodeOfType(component.body, "BlockStatement") ||
    declaration.parent.parent !== component.body ||
    findEnclosingFunction(call) !== component
  )
    return null;
  const attributes = new Map<string, EsTreeNodeOfType<"JSXAttribute">>();
  for (const attribute of opening.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attributes.has(attribute.name.name)
    )
      return null;
    attributes.set(attribute.name.name, attribute);
  }
  if (attributes.get("key") !== key) return null;
  const keyExpression = getAttributeExpression(attributes, "key");
  const itemExpression = getAttributeExpression(attributes, "value");
  if (!isSameSymbol(keyExpression, index, scopes) || !isSameSymbol(itemExpression, item, scopes))
    return null;
  return {
    component,
    attributes,
    item,
    index,
    state,
    setter,
    initial,
    stateRead: call.callee.object,
    itemReads: new Set(itemExpression ? [itemExpression] : []),
    indexReads: new Set(keyExpression ? [keyExpression] : []),
  };
};

const readLocalArrow = (
  identifier: EsTreeNode,
  map: EditablePositionMap,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = scopes.symbolFor(identifier);
  const arrow = symbol && getDirectConstInitializer(symbol);
  const declaration = symbol?.declarationNode;
  return isNodeOfType(arrow, "ArrowFunctionExpression") &&
    !arrow.async &&
    !arrow.generator &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.parent, "VariableDeclaration") &&
    declaration.parent.declarations.length === EDITABLE_POSITION_SINGLE_COUNT &&
    declaration.parent.parent === map.component.body
    ? arrow
    : null;
};

const readExpressionStatement = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (isNodeOfType(node, "ExpressionStatement")) return node.expression;
  if (isNodeOfType(node, "BlockStatement") && node.body.length === EDITABLE_POSITION_SINGLE_COUNT) {
    const [statement] = node.body;
    if (isNodeOfType(statement, "ExpressionStatement")) return statement.expression;
  }
  return null;
};

const isLengthRead = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyName(node) === "length" &&
  isSameSymbol(node.object, symbol, scopes);

const isScalarCall = (
  node: EsTreeNode | null,
  position: SymbolDescriptor,
  map: EditablePositionMap,
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === EDITABLE_POSITION_SINGLE_COUNT &&
  isSameSymbol(node.arguments[0], position, scopes) &&
  Boolean(readLocalArrow(node.callee, map, scopes));

const readEditWriter = (
  map: EditablePositionMap,
  scopes: ScopeAnalysis,
): EditablePositionWriter | null => {
  const adapter = getAttributeExpression(map.attributes, "onChangeText");
  if (
    !isNodeOfType(adapter, "ArrowFunctionExpression") ||
    adapter.async ||
    adapter.generator ||
    adapter.params.length !== EDITABLE_POSITION_SINGLE_COUNT ||
    !isNodeOfType(adapter.body, "CallExpression") ||
    adapter.body.optional ||
    adapter.body.arguments.length !== EDITABLE_POSITION_PAIR_COUNT
  )
    return null;
  const [incomingParameter] = adapter.params;
  const [incomingArgument, indexArgument] = adapter.body.arguments;
  if (
    !isNodeOfType(incomingParameter, "Identifier") ||
    !isSameSymbol(indexArgument, map.index, scopes)
  )
    return null;
  const incoming = scopes.symbolFor(incomingParameter);
  const arrow = readLocalArrow(adapter.body.callee, map, scopes);
  const handler = isNodeOfType(adapter.body.callee, "Identifier")
    ? scopes.symbolFor(adapter.body.callee)
    : null;
  if (
    !incoming ||
    !isSameSymbol(incomingArgument, incoming, scopes) ||
    !hasOnlyReferences(incoming, new Set([incomingArgument])) ||
    !arrow ||
    !handler ||
    !hasOnlyReferences(handler, new Set([adapter.body.callee])) ||
    arrow.params.length !== EDITABLE_POSITION_PAIR_COUNT ||
    !isNodeOfType(arrow.body, "BlockStatement")
  )
    return null;
  const [valueParameter, positionParameter] = arrow.params;
  if (!isNodeOfType(valueParameter, "Identifier") || !isNodeOfType(positionParameter, "Identifier"))
    return null;
  const value = scopes.symbolFor(valueParameter);
  const position = scopes.symbolFor(positionParameter);
  const [
    lengthGuard,
    patternGuard,
    copyStatement,
    writeStatement,
    commitStatement,
    focusStatement,
    ...extra
  ] = arrow.body.body;
  if (
    !value ||
    !position ||
    extra.length !== 0 ||
    !isNodeOfType(lengthGuard, "IfStatement") ||
    lengthGuard.alternate ||
    !isNodeOfType(lengthGuard.consequent, "ReturnStatement") ||
    lengthGuard.consequent.argument ||
    !isNodeOfType(lengthGuard.test, "BinaryExpression") ||
    lengthGuard.test.operator !== ">" ||
    !isLengthRead(lengthGuard.test.left, value, scopes) ||
    !isNodeOfType(lengthGuard.test.right, "Literal") ||
    lengthGuard.test.right.value !== EDITABLE_POSITION_CHARACTER_COUNT ||
    !isNodeOfType(patternGuard, "IfStatement") ||
    patternGuard.alternate ||
    !isNodeOfType(patternGuard.consequent, "ReturnStatement") ||
    patternGuard.consequent.argument ||
    !isNodeOfType(patternGuard.test, "UnaryExpression") ||
    patternGuard.test.operator !== "!" ||
    !isDirectMethod(patternGuard.test.argument, "test") ||
    !isNodeOfType(patternGuard.test.argument.callee, "MemberExpression") ||
    !isNodeOfType(patternGuard.test.argument.callee.object, "Literal") ||
    !("regex" in patternGuard.test.argument.callee.object)
  )
    return null;
  const patternCall = patternGuard.test.argument;
  const [patternValue] = patternCall.arguments;
  if (
    !isSameSymbol(patternValue, value, scopes) ||
    !isNodeOfType(copyStatement, "VariableDeclaration") ||
    copyStatement.kind !== "const" ||
    copyStatement.declarations.length !== EDITABLE_POSITION_SINGLE_COUNT
  )
    return null;
  const [copyDeclaration] = copyStatement.declarations;
  if (
    !copyDeclaration ||
    !isNodeOfType(copyDeclaration.id, "Identifier") ||
    !isNodeOfType(copyDeclaration.init, "ArrayExpression") ||
    copyDeclaration.init.elements.length !== EDITABLE_POSITION_SINGLE_COUNT
  )
    return null;
  const [spread] = copyDeclaration.init.elements;
  const copy = scopes.symbolFor(copyDeclaration.id);
  const assignment = readExpressionStatement(writeStatement);
  const commit = readExpressionStatement(commitStatement);
  if (
    !copy ||
    !isNodeOfType(spread, "SpreadElement") ||
    !isSameSymbol(spread.argument, map.state, scopes) ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    !assignment.left.computed ||
    assignment.left.optional ||
    !isSameSymbol(assignment.left.object, copy, scopes) ||
    !isSameSymbol(assignment.left.property, position, scopes) ||
    !isSameSymbol(assignment.right, value, scopes) ||
    !isNodeOfType(commit, "CallExpression") ||
    commit.optional ||
    commit.arguments.length !== EDITABLE_POSITION_SINGLE_COUNT ||
    !isSameSymbol(commit.callee, map.setter, scopes) ||
    !isSameSymbol(commit.arguments[0], copy, scopes) ||
    !hasOnlyReferences(copy, new Set([assignment.left.object, commit.arguments[0]])) ||
    !isNodeOfType(focusStatement, "IfStatement") ||
    focusStatement.alternate ||
    !isSameSymbol(focusStatement.test, value, scopes)
  )
    return null;
  const focus = readExpressionStatement(focusStatement.consequent);
  if (
    !isScalarCall(focus, position, map, scopes) ||
    !isNodeOfType(lengthGuard.test.left, "MemberExpression") ||
    !hasOnlyReferences(
      value,
      new Set([lengthGuard.test.left.object, patternValue, assignment.right, focusStatement.test]),
    ) ||
    !hasOnlyReferences(position, new Set([assignment.left.property, focus.arguments[0]]))
  )
    return null;
  map.indexReads.add(indexArgument);
  return { call: commit, stateRead: spread.argument };
};

const readKeypress = (map: EditablePositionMap, scopes: ScopeAnalysis): EsTreeNode | null => {
  const adapter = getAttributeExpression(map.attributes, "onKeyPress");
  if (
    !isNodeOfType(adapter, "ArrowFunctionExpression") ||
    adapter.async ||
    adapter.generator ||
    adapter.params.length !== EDITABLE_POSITION_SINGLE_COUNT ||
    !isNodeOfType(adapter.body, "CallExpression") ||
    adapter.body.optional ||
    adapter.body.arguments.length !== EDITABLE_POSITION_PAIR_COUNT
  )
    return null;
  const [eventParameter] = adapter.params;
  if (
    !isNodeOfType(eventParameter, "ObjectPattern") ||
    eventParameter.properties.length !== EDITABLE_POSITION_SINGLE_COUNT
  )
    return null;
  const [eventProperty] = eventParameter.properties;
  if (
    !isNodeOfType(eventProperty, "Property") ||
    eventProperty.computed ||
    !isNodeOfType(eventProperty.key, "Identifier") ||
    eventProperty.key.name !== "nativeEvent" ||
    !isNodeOfType(eventProperty.value, "Identifier")
  )
    return null;
  const nativeEvent = scopes.symbolFor(eventProperty.value);
  const [keyArgument, indexArgument] = adapter.body.arguments;
  if (
    !nativeEvent ||
    !isSameSymbol(indexArgument, map.index, scopes) ||
    !isNodeOfType(keyArgument, "MemberExpression") ||
    keyArgument.computed ||
    keyArgument.optional ||
    getStaticPropertyName(keyArgument) !== "key" ||
    !isSameSymbol(keyArgument.object, nativeEvent, scopes) ||
    !hasOnlyReferences(nativeEvent, new Set([keyArgument.object]))
  )
    return null;
  const arrow = readLocalArrow(adapter.body.callee, map, scopes);
  const handler = isNodeOfType(adapter.body.callee, "Identifier")
    ? scopes.symbolFor(adapter.body.callee)
    : null;
  if (
    !arrow ||
    !handler ||
    !hasOnlyReferences(handler, new Set([adapter.body.callee])) ||
    arrow.params.length !== EDITABLE_POSITION_PAIR_COUNT ||
    !isNodeOfType(arrow.body, "BlockStatement") ||
    arrow.body.body.length !== EDITABLE_POSITION_SINGLE_COUNT
  )
    return null;
  const [keyParameter, positionParameter] = arrow.params;
  if (!isNodeOfType(keyParameter, "Identifier") || !isNodeOfType(positionParameter, "Identifier"))
    return null;
  const key = scopes.symbolFor(keyParameter);
  const position = scopes.symbolFor(positionParameter);
  const [statement] = arrow.body.body;
  if (
    !key ||
    !position ||
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !isNodeOfType(statement.test, "LogicalExpression") ||
    statement.test.operator !== "&&" ||
    !isNodeOfType(statement.test.left, "BinaryExpression") ||
    statement.test.left.operator !== "===" ||
    !isSameSymbol(statement.test.left.left, key, scopes) ||
    !isNodeOfType(statement.test.left.right, "Literal") ||
    typeof statement.test.left.right.value !== "string" ||
    !isNodeOfType(statement.test.right, "UnaryExpression") ||
    statement.test.right.operator !== "!" ||
    !isNodeOfType(statement.test.right.argument, "MemberExpression")
  )
    return null;
  const read = statement.test.right.argument;
  const focus = readExpressionStatement(statement.consequent);
  if (
    !read.computed ||
    read.optional ||
    !isSameSymbol(read.object, map.state, scopes) ||
    !isSameSymbol(read.property, position, scopes) ||
    !isScalarCall(focus, position, map, scopes) ||
    !hasOnlyReferences(key, new Set([statement.test.left.left])) ||
    !hasOnlyReferences(position, new Set([read.property, focus.arguments[0]]))
  )
    return null;
  map.indexReads.add(indexArgument);
  return read.object;
};

const hasClosedRef = (map: EditablePositionMap, scopes: ScopeAnalysis): boolean => {
  const callback = getAttributeExpression(map.attributes, "ref");
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.generator ||
    callback.params.length !== EDITABLE_POSITION_SINGLE_COUNT ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== EDITABLE_POSITION_SINGLE_COUNT
  )
    return false;
  const [parameter] = callback.params;
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const value = scopes.symbolFor(parameter);
  const [statement] = callback.body.body;
  const assignment = readExpressionStatement(statement);
  if (
    !value ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isSameSymbol(assignment.right, value, scopes) ||
    !hasOnlyReferences(value, new Set([assignment.right])) ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    !assignment.left.computed ||
    assignment.left.optional ||
    !isSameSymbol(assignment.left.property, map.index, scopes) ||
    !isNodeOfType(assignment.left.object, "MemberExpression") ||
    assignment.left.object.computed ||
    assignment.left.object.optional ||
    getStaticPropertyName(assignment.left.object) !== "current" ||
    !isNodeOfType(assignment.left.object.object, "Identifier")
  )
    return false;
  const reference = scopes.symbolFor(assignment.left.object.object);
  const initializer = reference && getDirectConstInitializer(reference);
  if (
    !initializer ||
    !isNativeHook(initializer, "useRef", scopes) ||
    !isNodeOfType(initializer, "CallExpression")
  )
    return false;
  const [initial] = initializer.arguments;
  if (!isNodeOfType(initial, "ArrayExpression") || initial.elements.length !== 0) return false;
  map.indexReads.add(assignment.left.property);
  return true;
};

const isPrimitiveLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") &&
  (node.value === null ||
    typeof node.value === "string" ||
    typeof node.value === "number" ||
    typeof node.value === "boolean");

const isStaticAttribute = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  if (!attribute.value || isPrimitiveLiteral(attribute.value)) return true;
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return false;
  const expression = attribute.value.expression;
  if (isPrimitiveLiteral(expression)) return true;
  return (
    isNodeOfType(expression, "ObjectExpression") &&
    expression.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.method &&
        !property.computed &&
        getStaticPropertyKeyName(property) !== null &&
        isPrimitiveLiteral(property.value),
    )
  );
};

const hasClosedAttributes = (map: EditablePositionMap, scopes: ScopeAnalysis): boolean => {
  for (const [name, attribute] of map.attributes) {
    if (
      name === "key" ||
      name === "value" ||
      name === "onChangeText" ||
      name === "onKeyPress" ||
      name === "ref"
    )
      continue;
    const expression = getAttributeExpression(map.attributes, name);
    if (
      name === "borderColor" &&
      isNodeOfType(expression, "ConditionalExpression") &&
      isSameSymbol(expression.test, map.item, scopes) &&
      isPrimitiveLiteral(expression.consequent) &&
      isPrimitiveLiteral(expression.alternate)
    ) {
      map.itemReads.add(expression.test);
      continue;
    }
    if (
      name === "accessibilityLabel" &&
      isNodeOfType(expression, "TemplateLiteral") &&
      expression.expressions.length === EDITABLE_POSITION_SINGLE_COUNT
    ) {
      const [position] = expression.expressions;
      if (
        !isNodeOfType(position, "BinaryExpression") ||
        position.operator !== "+" ||
        !isSameSymbol(position.left, map.index, scopes) ||
        !isNodeOfType(position.right, "Literal") ||
        position.right.value !== EDITABLE_POSITION_LABEL_OFFSET_COUNT
      )
        return false;
      map.indexReads.add(position.left);
      continue;
    }
    if (!isStaticAttribute(attribute)) return false;
  }
  return hasOnlyReferences(map.item, map.itemReads) && hasOnlyReferences(map.index, map.indexReads);
};

const isScalarStateRead = (reference: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const member = reference.parent;
  const call = member?.parent;
  if (!isNodeOfType(member, "MemberExpression") || member.object !== reference) return false;
  if (getStaticPropertyName(member) === "join") {
    if (!isDirectMethod(call, "join")) return false;
    const [separator] = call.arguments;
    return isNodeOfType(separator, "Literal") && typeof separator.value === "string";
  }
  if (!isDirectMethod(call, "every")) return false;
  const [callback] = call.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.generator ||
    callback.params.length !== EDITABLE_POSITION_SINGLE_COUNT ||
    !isNodeOfType(callback.body, "BinaryExpression") ||
    callback.body.operator !== "===" ||
    !isNodeOfType(callback.body.right, "Literal") ||
    callback.body.right.value !== EDITABLE_POSITION_CHARACTER_COUNT
  )
    return false;
  const [parameter] = callback.params;
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const item = scopes.symbolFor(parameter);
  return Boolean(
    item &&
    isNodeOfType(callback.body.left, "MemberExpression") &&
    isLengthRead(callback.body.left, item, scopes) &&
    hasOnlyReferences(item, new Set([callback.body.left.object])),
  );
};

export const isClosedEditableStringPositionKey = (
  key: EsTreeNodeOfType<"JSXAttribute">,
  iterator: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const capabilities = getReactDoctorStringArraySetting(context.settings, "capabilities");
  if (
    (capabilities.includes("preact") && !capabilities.includes("react")) ||
    !hasSupportedProviders(context)
  )
    return false;
  const map = readPositionMap(key, iterator, context.scopes);
  if (!map) return false;
  const writer = readEditWriter(map, context.scopes);
  const keypressRead = readKeypress(map, context.scopes);
  if (
    !writer ||
    !keypressRead ||
    !hasClosedRef(map, context.scopes) ||
    !hasClosedAttributes(map, context.scopes)
  )
    return false;
  const stateReads = new Set([map.stateRead, writer.stateRead, keypressRead]);
  if (
    !map.state.references.every(
      (reference) =>
        isErasedReference(reference.identifier) ||
        (reference.flag === "read" &&
          (stateReads.has(reference.identifier) ||
            isScalarStateRead(reference.identifier, context.scopes))),
    )
  )
    return false;
  return map.setter.references.every((reference) => {
    if (isErasedReference(reference.identifier)) return true;
    const call = reference.identifier.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== reference.identifier ||
      call.arguments.length !== EDITABLE_POSITION_SINGLE_COUNT
    )
      return false;
    if (call === writer.call) return true;
    const [reset] = call.arguments;
    return Boolean(
      reset && isEmptyStringArray(reset) && reset.elements.length === map.initial.elements.length,
    );
  });
};
