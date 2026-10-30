import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

import { REACT_RUNTIME_MODULE_SOURCES } from "../../../constants/react.js";
import { hasRefNotificationReactCall } from "./has-ref-notification-react-call.js";
import { isRefNotificationNativeElement } from "./is-ref-notification-native-element.js";
import {
  REF_NOTIFICATION_RUNTIME_CAPABILITIES,
  REF_NOTIFICATION_RUNTIME_TYPESCRIPT,
  FOCUS_REQUEST_TOP_LEVEL_STATEMENT_COUNT,
  FOCUS_REQUEST_GUARDED_STATEMENT_COUNT,
  FOCUS_REQUEST_DEPENDENCY_COUNT,
  FOCUS_REQUEST_MAP_REFERENCE_COUNT,
  FOCUS_REQUEST_SETTER_REFERENCE_COUNT,
  FOCUS_REQUEST_WRITER_STATEMENT_COUNT,
  FOCUS_REQUEST_UNSUPPORTED_GLOBALS,
  FOCUS_REQUEST_UNSUPPORTED_PROPERTIES,
  FOCUS_REQUEST_UNSUPPORTED_ATTRIBUTES,
  FOCUS_REQUEST_ARRAY_READ_METHODS,
  FOCUS_REQUEST_PASSIVE_FETCHER_FIELDS,
} from "./constants.js";

const getStaticMember = (
  node: EsTreeNode | null | undefined,
  name: string,
  allowOptional = false,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const expression = node && stripParenExpression(node);
  return isNodeOfType(expression, "MemberExpression") &&
    !expression.computed &&
    (allowOptional || !expression.optional) &&
    getStaticPropertyKeyName(expression) === name
    ? expression
    : null;
};

const getExactCall = (
  node: EsTreeNode | null | undefined,
  argumentCount: number,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const expression = node && stripParenExpression(node);
  return isNodeOfType(expression, "CallExpression") &&
    !expression.optional &&
    expression.arguments.length === argumentCount &&
    !expression.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    ? expression
    : null;
};

const statementExpression = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  let statement = node;
  if (isNodeOfType(node, "BlockStatement")) {
    if (node.body.length !== 1) return null;
    statement = node.body[0];
  }
  return isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;
};

const getConstDeclarator = (
  node: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"VariableDeclarator"> | null =>
  isNodeOfType(node, "VariableDeclaration") &&
  node.kind === "const" &&
  node.declarations.length === 1 &&
  isNodeOfType(node.declarations[0].id, "Identifier")
    ? node.declarations[0]
    : null;

const isNull = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === null;

export const hasPostcommitFocusRequestConsumption = (
  effectNode: EsTreeNode,
  stateDeclarator: EsTreeNode | null,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(stateDeclarator.parent, "VariableDeclaration") ||
    stateDeclarator.parent.kind !== "const" ||
    !isNodeOfType(stateDeclarator.id, "ArrayPattern") ||
    stateDeclarator.id.elements.length !== 2 ||
    !isNodeOfType(effectNode, "CallExpression")
  )
    return false;
  const program = findProgramRoot(effectNode);
  const component = findEnclosingFunction(stateDeclarator);
  if (!program || !isFunctionLike(component) || findEnclosingFunction(effectNode) !== component)
    return false;
  const getBinding = (node: EsTreeNode | null | undefined): SymbolDescriptor | null =>
    node ? context.scopes.symbolFor(stripParenExpression(node)) : null;
  const hasCompleteReferences = (binding: SymbolDescriptor): boolean =>
    hasCompleteSymbolReferences(binding, program, context.scopes);
  const hasExactReadReferences = (
    binding: SymbolDescriptor | null,
    nodes: ReadonlyArray<EsTreeNode | null | undefined>,
  ): boolean =>
    Boolean(
      binding &&
      nodes.every((node) => node !== null && node !== undefined) &&
      hasCompleteReferences(binding) &&
      binding.references.length === nodes.length &&
      binding.references.every(
        (reference) => reference.flag === "read" && nodes.includes(reference.identifier),
      ),
    );
  const isReadonlyBinding = (binding: SymbolDescriptor | null): boolean =>
    Boolean(
      binding &&
      hasCompleteReferences(binding) &&
      binding.references.every(
        (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
      ),
    );
  const isBindingReference = (
    node: EsTreeNode | null | undefined,
    binding: SymbolDescriptor | null,
  ): boolean => Boolean(binding && getBinding(node) === binding);
  const isRuntimeReactHookCall = (
    node: EsTreeNode | null | undefined,
    importedName: string,
  ): boolean => {
    const hookCall = getExactCall(node, importedName === "useEffect" ? 2 : 1);
    return Boolean(hookCall && hasRefNotificationReactCall(hookCall, importedName, context));
  };
  const getRefInitializer = (
    binding: SymbolDescriptor | null,
  ): EsTreeNodeOfType<"CallExpression"> | null => {
    const initializer = binding && getDirectConstInitializer(binding);
    return binding &&
      initializer &&
      isRuntimeReactHookCall(initializer, "useRef") &&
      findEnclosingFunction(binding.declarationNode) === component
      ? getExactCall(initializer, 1)
      : null;
  };
  const isDirectCurrentRead = (
    node: EsTreeNode | null | undefined,
    binding: SymbolDescriptor | null,
  ): boolean => {
    const current = getStaticMember(node, "current");
    return Boolean(current && isBindingReference(current.object, binding));
  };
  const permittedAssignments = new Set<EsTreeNode>();
  const permittedRefAttributes = new Set<EsTreeNode>();
  const acceptNativeAttribute = (attribute: EsTreeNode, name: string, tag: string): boolean => {
    const opening = attribute.parent;
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      getJsxAttributeName(attribute.name) !== name ||
      !isNodeOfType(opening, "JSXOpeningElement") ||
      !isNodeOfType(opening.name, "JSXIdentifier") ||
      opening.name.name !== tag ||
      getAuthoritativeJsxAttribute(opening.attributes, name) !== attribute ||
      !isNodeOfType(opening.parent, "JSXElement") ||
      !isRefNotificationNativeElement(opening.parent, context.scopes, false)
    )
      return false;
    if (name === "ref") permittedRefAttributes.add(attribute);
    return true;
  };
  const hasNativeAttributeDestination = (attribute: EsTreeNode, name: string): boolean => {
    if (acceptNativeAttribute(attribute, name, "button")) return true;
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const opening = attribute.parent;
    if (
      !isNodeOfType(opening, "JSXOpeningElement") ||
      !isNodeOfType(opening.name, "JSXIdentifier") ||
      getAuthoritativeJsxAttribute(
        opening.attributes,
        getJsxAttributeName(attribute.name) ?? "",
      ) !== attribute
    )
      return false;
    const binding = getBinding(opening.name);
    const owner =
      binding?.kind === "function"
        ? binding.declarationNode
        : binding && getDirectConstInitializer(binding);
    if (
      !binding ||
      !isFunctionLike(owner) ||
      owner.async ||
      owner.generator ||
      owner.params.length !== 1 ||
      !isNodeOfType(owner.params[0], "ObjectPattern") ||
      !hasCompleteReferences(binding)
    )
      return false;
    let declaration: EsTreeNode | null | undefined = owner;
    while (declaration && !isNodeOfType(declaration, "Program")) {
      if (
        isNodeOfType(declaration, "ExportNamedDeclaration") ||
        isNodeOfType(declaration, "ExportDefaultDeclaration")
      )
        return false;
      declaration = declaration.parent;
    }
    if (
      binding.references.length === 0 ||
      binding.references.some((reference) => {
        const parent = reference.identifier.parent;
        return (
          reference.flag !== "read" ||
          (!isNodeOfType(parent, "JSXOpeningElement") &&
            !isNodeOfType(parent, "JSXClosingElement")) ||
          parent.name !== reference.identifier
        );
      })
    )
      return false;
    const properties = owner.params[0].properties;
    if (
      properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.computed ||
          property.kind !== "init" ||
          !isNodeOfType(property.value, "Identifier"),
      )
    )
      return false;
    const selectedProperties = properties.filter(
      (property) => getStaticPropertyKeyName(property) === getJsxAttributeName(attribute.name),
    );
    const property = selectedProperties.length === 1 ? selectedProperties[0] : null;
    if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier"))
      return false;
    const prop = getBinding(property.value);
    if (
      !prop ||
      !hasCompleteReferences(prop) ||
      prop.references.length !== 1 ||
      prop.references[0].flag !== "read"
    )
      return false;
    const root = findTransparentExpressionRoot(prop.references[0].identifier);
    return (
      isNodeOfType(root.parent, "JSXExpressionContainer") &&
      root.parent.expression === root &&
      acceptNativeAttribute(root.parent.parent ?? root.parent, name, "button")
    );
  };
  const getCallbackAttribute = (callback: EsTreeNode): EsTreeNode | null => {
    const root = findTransparentExpressionRoot(callback);
    const container = root.parent;
    return isNodeOfType(container, "JSXExpressionContainer") &&
      container.expression === root &&
      isNodeOfType(container.parent, "JSXAttribute")
      ? container.parent
      : null;
  };
  const getStaticIdentifierMember = (
    node: EsTreeNode | null | undefined,
  ): EsTreeNodeOfType<"MemberExpression"> | null => {
    const expression = node && stripParenExpression(node);
    return isNodeOfType(expression, "MemberExpression") &&
      !expression.computed &&
      !expression.optional &&
      isNodeOfType(expression.object, "Identifier") &&
      getStaticPropertyKeyName(expression) !== null
      ? expression
      : null;
  };
  const hasSameMemberKey = (left: EsTreeNode, right: EsTreeNode): boolean => {
    const leftMember = getStaticIdentifierMember(left),
      rightMember = getStaticIdentifierMember(right);
    return Boolean(
      leftMember &&
      rightMember &&
      getStaticPropertyKeyName(leftMember) === getStaticPropertyKeyName(rightMember) &&
      getBinding(leftMember.object) === getBinding(rightMember.object),
    );
  };
  const [stateIdentifier, setterIdentifier] = stateDeclarator.id.elements;
  if (
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !isNodeOfType(setterIdentifier, "Identifier") ||
    !isRuntimeReactHookCall(stateDeclarator.init, "useState") ||
    !isNull(getExactCall(stateDeclarator.init, 1)?.arguments[0]) ||
    !isRuntimeReactHookCall(effectNode, "useEffect")
  )
    return false;
  const state = getBinding(stateIdentifier),
    setter = getBinding(setterIdentifier);
  const effect = stripParenExpression(effectNode.arguments[0]);
  if (
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.async ||
    effect.generator ||
    effect.params.length !== 0 ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    effect.body.body.length !== FOCUS_REQUEST_TOP_LEVEL_STATEMENT_COUNT
  )
    return false;
  const [snapshotStatement, guard, snapshotAssignmentStatement] = effect.body.body;
  const snapshot = getConstDeclarator(snapshotStatement);
  const snapshotAssignment = statementExpression(snapshotAssignmentStatement);
  if (
    !snapshot ||
    !snapshot.init ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.test, "LogicalExpression") ||
    guard.test.operator !== "&&" ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== FOCUS_REQUEST_GUARDED_STATEMENT_COUNT ||
    !isNodeOfType(snapshotAssignment, "AssignmentExpression") ||
    snapshotAssignment.operator !== "="
  )
    return false;
  const stateGuard = stripParenExpression(guard.test.left),
    listIdentifier = stripParenExpression(guard.test.right);
  const list = getBinding(listIdentifier);
  if (
    !isNodeOfType(stateGuard, "BinaryExpression") ||
    stateGuard.operator !== "!==" ||
    !isBindingReference(stateGuard.left, state) ||
    !isNull(stateGuard.right) ||
    !isNodeOfType(listIdentifier, "Identifier") ||
    list?.kind !== "parameter" ||
    !isReadonlyBinding(list)
  )
    return false;
  const dependencies = stripParenExpression(effectNode.arguments[1]);
  if (
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== FOCUS_REQUEST_DEPENDENCY_COUNT ||
    !isBindingReference(dependencies.elements[0], list) ||
    !isBindingReference(dependencies.elements[1], state)
  )
    return false;
  const [positionStatement, rowStatement, targetStatement, focusGuard, resetStatement] =
    guard.consequent.body;
  const position = getConstDeclarator(positionStatement),
    row = getConstDeclarator(rowStatement),
    target = getConstDeclarator(targetStatement);
  const minimum = position && getExactCall(position.init, 2),
    minimumMember = minimum && getStaticMember(minimum.callee, "min");
  const extent = minimum?.arguments[1];
  const length =
    isNodeOfType(extent, "BinaryExpression") && extent.operator === "-"
      ? getStaticMember(extent.left, "length")
      : null;
  if (
    !position ||
    !minimum ||
    !minimumMember ||
    !isNodeOfType(minimumMember.object, "Identifier") ||
    minimumMember.object.name !== "Math" ||
    !context.scopes.isGlobalReference(minimumMember.object) ||
    !isBindingReference(minimum.arguments[0], state) ||
    !length ||
    !isBindingReference(length.object, list) ||
    !isNodeOfType(extent, "BinaryExpression") ||
    !isNodeOfType(extent.right, "Literal") ||
    extent.right.value !== 1 ||
    !row ||
    !isNodeOfType(row.init, "MemberExpression") ||
    !row.init.computed ||
    row.init.optional ||
    !isBindingReference(row.init.object, list) ||
    !isBindingReference(row.init.property, getBinding(position.id)) ||
    !target ||
    !isNodeOfType(target.init, "ConditionalExpression") ||
    !isBindingReference(target.init.test, getBinding(row.id)) ||
    !isNull(target.init.alternate)
  )
    return false;
  const getCall = getExactCall(target.init.consequent, 1),
    getMember = getCall && getStaticMember(getCall.callee, "get");
  const mapCurrent = getMember && getStaticMember(getMember.object, "current");
  const map = mapCurrent && getBinding(mapCurrent.object),
    mapHook = getRefInitializer(map);
  const mapConstructor = mapHook && stripParenExpression(mapHook.arguments[0]);
  const getKey = getCall && getStaticIdentifierMember(getCall.arguments[0]);
  if (
    !map ||
    !mapCurrent ||
    !mapHook ||
    !getCall ||
    !getKey ||
    !isBindingReference(getKey.object, getBinding(row.id)) ||
    !isNodeOfType(mapConstructor, "NewExpression") ||
    mapConstructor.arguments.length !== 0 ||
    !isNodeOfType(mapConstructor.callee, "Identifier") ||
    mapConstructor.callee.name !== "Map" ||
    !context.scopes.isGlobalReference(mapConstructor.callee) ||
    !hasCompleteReferences(map)
  )
    return false;
  let setCall: EsTreeNodeOfType<"CallExpression"> | null = null;
  let deleteCall: EsTreeNodeOfType<"CallExpression"> | null = null;
  if (map.references.length !== FOCUS_REQUEST_MAP_REFERENCE_COUNT) return false;
  for (const reference of map.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const current = getStaticMember(root.parent, "current");
    const method = current && findTransparentExpressionRoot(current).parent;
    if (
      reference.flag !== "read" ||
      !current ||
      current.object !== root ||
      !isNodeOfType(method, "MemberExpression") ||
      method.object !== current ||
      method.computed ||
      method.optional
    )
      return false;
    const operation = getStaticPropertyKeyName(method);
    const invocation = getExactCall(
      findTransparentExpressionRoot(method).parent,
      operation === "set" ? 2 : 1,
    );
    if (!invocation || invocation.callee !== method) return false;
    if (operation === "get" && invocation === getCall) continue;
    if (operation === "set" && !setCall) setCall = invocation;
    else if (operation === "delete" && !deleteCall) deleteCall = invocation;
    else return false;
  }
  const refCallback = setCall && findEnclosingFunction(setCall);
  if (
    !setCall ||
    !deleteCall ||
    !isNodeOfType(refCallback, "ArrowFunctionExpression") ||
    refCallback.async ||
    refCallback.params.length !== 1 ||
    !isNodeOfType(refCallback.params[0], "Identifier") ||
    !isNodeOfType(refCallback.body, "BlockStatement") ||
    refCallback.body.body.length !== 1 ||
    findEnclosingFunction(deleteCall) !== refCallback
  )
    return false;
  const refGuard = refCallback.body.body[0],
    element = getBinding(refCallback.params[0]);
  const setKey = getStaticIdentifierMember(setCall.arguments[0]);
  const rowCallback = findEnclosingFunction(refCallback);
  const renderCall =
    isFunctionLike(rowCallback) &&
    getExactCall(findTransparentExpressionRoot(rowCallback).parent, 1);
  const renderMap = renderCall && getStaticMember(renderCall.callee, "map", true);
  const refAttribute = getCallbackAttribute(refCallback);
  if (
    !isNodeOfType(refGuard, "IfStatement") ||
    !isBindingReference(refGuard.test, element) ||
    statementExpression(refGuard.consequent) !== setCall ||
    statementExpression(refGuard.alternate) !== deleteCall ||
    !isBindingReference(setCall.arguments[1], element) ||
    !hasExactReadReferences(element, [refGuard.test, setCall.arguments[1]]) ||
    !setKey ||
    !hasSameMemberKey(setCall.arguments[0], deleteCall.arguments[0]) ||
    getStaticPropertyKeyName(setKey) !== getStaticPropertyKeyName(getKey) ||
    !isNodeOfType(rowCallback, "ArrowFunctionExpression") ||
    rowCallback.async ||
    rowCallback.params.length !== 1 ||
    !isNodeOfType(rowCallback.params[0], "Identifier") ||
    !isBindingReference(setKey.object, getBinding(rowCallback.params[0])) ||
    !renderCall ||
    !renderMap ||
    !isBindingReference(renderMap.object, list) ||
    renderCall.arguments[0] !== rowCallback ||
    !refAttribute ||
    !hasNativeAttributeDestination(refAttribute, "ref")
  )
    return false;
  const isFocusCall = (statement: EsTreeNode | null | undefined, receiver: EsTreeNode): boolean => {
    const invocation = getExactCall(statementExpression(statement), 0),
      method = invocation && getStaticMember(invocation.callee, "focus");
    if (!method) return false;
    const expectedReceiver = stripParenExpression(receiver);
    if (isNodeOfType(expectedReceiver, "Identifier")) {
      return isBindingReference(method.object, getBinding(expectedReceiver));
    }
    const expectedCurrent = getStaticMember(expectedReceiver, "current");
    return Boolean(
      expectedCurrent && isDirectCurrentRead(method.object, getBinding(expectedCurrent.object)),
    );
  };
  if (
    !isNodeOfType(focusGuard, "IfStatement") ||
    !isBindingReference(focusGuard.test, getBinding(target.id)) ||
    !isFocusCall(focusGuard.consequent, focusGuard.test) ||
    !isNodeOfType(focusGuard.alternate, "IfStatement") ||
    focusGuard.alternate.alternate ||
    !getStaticMember(focusGuard.alternate.test, "current") ||
    !isFocusCall(focusGuard.alternate.consequent, focusGuard.alternate.test)
  )
    return false;
  const targetFocus = getExactCall(statementExpression(focusGuard.consequent), 0);
  const targetFocusMember = targetFocus && getStaticMember(targetFocus.callee, "focus");
  const fallbackGuard = focusGuard.alternate,
    fallbackCurrent = getStaticMember(fallbackGuard.test, "current");
  const fallback = fallbackCurrent && getBinding(fallbackCurrent.object),
    fallbackHook = getRefInitializer(fallback);
  const fallbackFocus = getExactCall(statementExpression(fallbackGuard.consequent), 0);
  const fallbackFocusMember = fallbackFocus && getStaticMember(fallbackFocus.callee, "focus");
  const reset = getExactCall(statementExpression(resetStatement), 1);
  if (
    !targetFocusMember ||
    !fallback ||
    !fallbackHook ||
    !isNull(fallbackHook.arguments[0]) ||
    !fallbackCurrent ||
    !fallbackFocusMember ||
    !reset ||
    !isBindingReference(reset.callee, setter) ||
    !isNull(reset.arguments[0]) ||
    !hasExactReadReferences(state, [
      stateGuard.left,
      minimum.arguments[0],
      dependencies.elements[1],
    ]) ||
    !hasExactReadReferences(getBinding(position.id), [row.init.property]) ||
    !hasExactReadReferences(getBinding(row.id), [target.init.test, getKey.object]) ||
    !hasExactReadReferences(getBinding(target.id), [focusGuard.test, targetFocusMember.object])
  )
    return false;
  const fallbackReferences: EsTreeNode[] = [
    fallbackCurrent.object,
    getStaticMember(fallbackFocusMember.object, "current")?.object ?? fallbackCurrent.object,
  ];
  let inputAttachments = 0;
  for (const reference of fallback.references) {
    if (fallbackReferences.includes(reference.identifier)) continue;
    const root = findTransparentExpressionRoot(reference.identifier),
      current = getStaticMember(root.parent, "current");
    if (
      isNodeOfType(root.parent, "JSXExpressionContainer") &&
      root.parent.expression === root &&
      acceptNativeAttribute(root.parent.parent ?? root.parent, "ref", "input")
    ) {
      inputAttachments += 1;
      fallbackReferences.push(reference.identifier);
      continue;
    }
    if (!current || current.object !== root) return false;
    const valueMember = getStaticMember(current.parent, "value");
    const assignment = valueMember?.parent;
    if (
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === valueMember &&
      isNodeOfType(assignment.right, "Literal") &&
      typeof assignment.right.value === "string"
    ) {
      const assignmentStatement = assignment.parent;
      const ownerGuard = isNodeOfType(assignmentStatement?.parent, "BlockStatement")
        ? assignmentStatement.parent.parent
        : assignmentStatement?.parent;
      if (!isNodeOfType(ownerGuard, "IfStatement") || ownerGuard.alternate) return false;
      const guardTest = stripParenExpression(ownerGuard.test);
      if (
        !isNodeOfType(guardTest, "BinaryExpression") ||
        guardTest.operator !== "!==" ||
        !isDirectCurrentRead(guardTest.left, fallback) ||
        !isNull(guardTest.right) ||
        statementExpression(ownerGuard.consequent) !== assignment
      )
        return false;
      permittedAssignments.add(assignment);
      fallbackReferences.push(reference.identifier);
      continue;
    }
    const comparison = current.parent,
      ownerGuard = comparison?.parent;
    if (
      isNodeOfType(comparison, "BinaryExpression") &&
      comparison.operator === "!==" &&
      comparison.left === current &&
      isNull(comparison.right) &&
      isNodeOfType(ownerGuard, "IfStatement") &&
      !ownerGuard.alternate &&
      ownerGuard.test === comparison
    ) {
      const assignment = statementExpression(ownerGuard.consequent);
      const value =
        isNodeOfType(assignment, "AssignmentExpression") &&
        getStaticMember(assignment.left, "value");
      if (
        !value ||
        !isDirectCurrentRead(value.object, fallback) ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.operator !== "=" ||
        !isNodeOfType(assignment.right, "Literal") ||
        typeof assignment.right.value !== "string"
      )
        return false;
      permittedAssignments.add(assignment);
      fallbackReferences.push(reference.identifier);
      continue;
    }
    return false;
  }
  if (inputAttachments !== 1 || !hasExactReadReferences(fallback, fallbackReferences)) return false;
  if (
    !setter ||
    !hasCompleteReferences(setter) ||
    setter.references.length !== FOCUS_REQUEST_SETTER_REFERENCE_COUNT
  )
    return false;
  const writerReference = setter.references.find(
    (reference) => reference.identifier !== reset.callee,
  );
  const writerCall =
    writerReference &&
    getExactCall(findTransparentExpressionRoot(writerReference.identifier).parent, 1);
  const writer = writerCall && findEnclosingFunction(writerCall);
  if (
    !writerCall ||
    writerCall.callee !== writerReference?.identifier ||
    !isNodeOfType(writer, "ArrowFunctionExpression") ||
    writer.async ||
    writer.params.length !== 1 ||
    !isNodeOfType(writer.params[0], "Identifier") ||
    !isNodeOfType(writer.body, "BlockStatement") ||
    writer.body.body.length !== FOCUS_REQUEST_WRITER_STATEMENT_COUNT
  )
    return false;
  const index = getConstDeclarator(writer.body.body[0]),
    indexGuard = writer.body.body[1];
  const lookup = index && getExactCall(index.init, 1),
    lookupMember = lookup && getStaticMember(lookup.callee, "indexOf");
  const snapshotCurrent = lookupMember && getStaticMember(lookupMember.object, "current");
  const previous = snapshotCurrent && getBinding(snapshotCurrent.object),
    previousHook = getRefInitializer(previous);
  if (
    !index ||
    !lookup ||
    !lookupMember ||
    !snapshotCurrent ||
    !previous ||
    !previousHook ||
    !isNodeOfType(previousHook.arguments[0], "ArrayExpression") ||
    previousHook.arguments[0].elements.length !== 0 ||
    !isBindingReference(lookup.arguments[0], getBinding(writer.params[0])) ||
    !hasExactReadReferences(getBinding(writer.params[0]), [lookup.arguments[0]]) ||
    !isNodeOfType(indexGuard, "IfStatement") ||
    indexGuard.alternate ||
    !isNodeOfType(indexGuard.test, "BinaryExpression") ||
    !isBindingReference(indexGuard.test.left, getBinding(index.id)) ||
    statementExpression(indexGuard.consequent) !== writerCall ||
    !isBindingReference(writerCall.arguments[0], getBinding(index.id)) ||
    !hasExactReadReferences(getBinding(index.id), [indexGuard.test.left, writerCall.arguments[0]])
  )
    return false;
  const indexBoundary = stripParenExpression(indexGuard.test.right);
  const rejectsMissing =
    indexGuard.test.operator === "!==" &&
    ((isNodeOfType(indexBoundary, "Literal") && indexBoundary.value === -1) ||
      (isNodeOfType(indexBoundary, "UnaryExpression") &&
        indexBoundary.operator === "-" &&
        isNodeOfType(indexBoundary.argument, "Literal") &&
        indexBoundary.argument.value === 1));
  if (
    !rejectsMissing &&
    !(
      indexGuard.test.operator === ">=" &&
      isNodeOfType(indexBoundary, "Literal") &&
      indexBoundary.value === 0
    )
  )
    return false;
  const snapshotValue = stripParenExpression(snapshot.init);
  const keysCall =
    isNodeOfType(snapshotValue, "LogicalExpression") && snapshotValue.operator === "||"
      ? getExactCall(snapshotValue.left, 1)
      : null;
  const keysMap = keysCall && getStaticMember(keysCall.callee, "map", true),
    keysCallback = keysCall?.arguments[0];
  const keyBody = isFunctionLike(keysCallback) && getStaticIdentifierMember(keysCallback.body);
  const snapshotTarget = getStaticMember(snapshotAssignment.left, "current");
  if (
    !isNodeOfType(snapshotValue, "LogicalExpression") ||
    !isNodeOfType(snapshotValue.right, "ArrayExpression") ||
    snapshotValue.right.elements.length !== 0 ||
    !keysMap ||
    !isBindingReference(keysMap.object, list) ||
    !isNodeOfType(keysCallback, "ArrowFunctionExpression") ||
    keysCallback.async ||
    keysCallback.params.length !== 1 ||
    !isNodeOfType(keysCallback.params[0], "Identifier") ||
    !keyBody ||
    !isBindingReference(keyBody.object, getBinding(keysCallback.params[0])) ||
    getStaticPropertyKeyName(keyBody) !== getStaticPropertyKeyName(setKey) ||
    !hasExactReadReferences(getBinding(keysCallback.params[0]), [keyBody.object]) ||
    !snapshotTarget ||
    !isBindingReference(snapshotTarget.object, previous) ||
    !isBindingReference(snapshotAssignment.right, getBinding(snapshot.id)) ||
    !hasExactReadReferences(getBinding(snapshot.id), [snapshotAssignment.right]) ||
    !hasExactReadReferences(previous, [snapshotCurrent.object, snapshotTarget.object])
  )
    return false;
  const writerIdentifier = getFunctionBindingIdentifier(writer),
    writerBinding = writerIdentifier && getBinding(writerIdentifier);
  if (
    !writerBinding ||
    getDirectConstInitializer(writerBinding) !== writer ||
    !hasCompleteReferences(writerBinding) ||
    writerBinding.references.length !== 1
  )
    return false;
  const writerUse = writerBinding.references[0],
    writerUseCall = getExactCall(findTransparentExpressionRoot(writerUse.identifier).parent, 1);
  const event = writerUseCall && findEnclosingFunction(writerUseCall),
    eventAttribute = event && getCallbackAttribute(event);
  if (
    writerUse.flag !== "read" ||
    !writerUseCall ||
    writerUseCall.callee !== writerUse.identifier ||
    !hasSameMemberKey(writerUseCall.arguments[0], setCall.arguments[0]) ||
    !isNodeOfType(event, "ArrowFunctionExpression") ||
    event.async ||
    event.params.length !== 0 ||
    stripParenExpression(event.body) !== writerUseCall ||
    !eventAttribute ||
    !hasNativeAttributeDestination(eventAttribute, "onClick") ||
    !hasExactReadReferences(setter, [reset.callee, writerCall.callee])
  )
    return false;
  permittedAssignments.add(snapshotAssignment);
  const permittedCalls = new Set<EsTreeNode>();
  for (const invocation of [
    effectNode,
    minimum,
    getCall,
    setCall,
    deleteCall,
    mapHook,
    fallbackHook,
    previousHook,
    targetFocus,
    fallbackFocus,
    reset,
    writerCall,
    lookup,
    keysCall,
    renderCall,
    writerUseCall,
  ])
    if (invocation) permittedCalls.add(invocation);
  if (stateDeclarator.init) permittedCalls.add(stripParenExpression(stateDeclarator.init));
  const isPassiveFetcherInitializer = (invocation: EsTreeNodeOfType<"CallExpression">): boolean => {
    const declaration = invocation.parent;
    const callee = stripParenExpression(invocation.callee);
    const imported = getBinding(callee),
      importDeclaration = imported && getImportDeclarationForSymbol(imported);
    const options = invocation.arguments[0];
    if (
      !isNodeOfType(callee, "Identifier") ||
      !imported ||
      !importDeclaration ||
      importDeclaration.source.value !== "react-router" ||
      importDeclaration.importKind === "type" ||
      !isNodeOfType(imported.declarationNode, "ImportSpecifier") ||
      imported.declarationNode.importKind === "type" ||
      getImportedName(imported.declarationNode) !== "useFetcher" ||
      !isReadonlyBinding(imported) ||
      imported.references.length !== 1 ||
      imported.references[0].identifier !== callee ||
      !getExactCall(invocation, 1) ||
      !isNodeOfType(options, "ObjectExpression") ||
      options.properties.length !== 1 ||
      !isNodeOfType(options.properties[0], "Property") ||
      options.properties[0].computed ||
      options.properties[0].kind !== "init" ||
      getStaticPropertyKeyName(options.properties[0]) !== "key" ||
      !isNodeOfType(options.properties[0].value, "Literal") ||
      typeof options.properties[0].value.value !== "string" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const"
    )
      return false;
    const result = getBinding(declaration.id);
    return Boolean(
      result &&
      isReadonlyBinding(result) &&
      result.references.every((reference) => {
        const root = findTransparentExpressionRoot(reference.identifier);
        const field = getStaticIdentifierMember(root.parent);
        if (
          !field ||
          field.object !== root ||
          !FOCUS_REQUEST_PASSIVE_FETCHER_FIELDS.has(getStaticPropertyKeyName(field) ?? "") ||
          isWithinAssignmentTarget(field)
        )
          return false;
        const fieldRoot = findTransparentExpressionRoot(field),
          parent = fieldRoot.parent;
        if (getStaticPropertyKeyName(field) === "data") {
          if (isNodeOfType(parent, "IfStatement") && parent.test === fieldRoot) return true;
          const owner = isNodeOfType(parent, "ArrayExpression") ? parent.parent : null;
          return Boolean(
            isNodeOfType(owner, "CallExpression") &&
            owner.arguments[1] === parent &&
            hasRefNotificationReactCall(owner, "useEffect", context),
          );
        }
        return Boolean(
          isNodeOfType(parent, "BinaryExpression") &&
          parent.left === fieldRoot &&
          (parent.operator === "!==" || parent.operator === "===") &&
          isNodeOfType(parent.right, "Literal") &&
          typeof parent.right.value === "string",
        );
      }),
    );
  };
  let unsupportedCapability = false;
  walkAst(program, (node) => {
    if (unsupportedCapability) return false;
    if (
      REF_NOTIFICATION_RUNTIME_TYPESCRIPT.has(node.type) ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression")
    ) {
      unsupportedCapability = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "AssignmentExpression") && !permittedAssignments.has(node))
      unsupportedCapability = true;
    if (
      isNodeOfType(node, "UpdateExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    )
      unsupportedCapability = true;
    if (isNodeOfType(node, "NewExpression") && node !== mapConstructor)
      unsupportedCapability = true;
    if (isNodeOfType(node, "JSXSpreadAttribute")) unsupportedCapability = true;
    if (isNodeOfType(node, "JSXAttribute")) {
      const name = getJsxAttributeName(node.name) ?? "";
      if (
        FOCUS_REQUEST_UNSUPPORTED_ATTRIBUTES.has(name) ||
        (name === "ref" && !permittedRefAttributes.has(node))
      )
        unsupportedCapability = true;
    }
    if (
      isNodeOfType(node, "Property") &&
      (node.kind !== "init" ||
        node.computed ||
        FOCUS_REQUEST_UNSUPPORTED_PROPERTIES.has(getStaticPropertyKeyName(node) ?? "") ||
        FOCUS_REQUEST_UNSUPPORTED_ATTRIBUTES.has(getStaticPropertyKeyName(node) ?? ""))
    )
      unsupportedCapability = true;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      (node.source.value === "module" || node.source.value === "node:module")
    )
      unsupportedCapability = true;
    if (isNodeOfType(node, "CallExpression") && !permittedCalls.has(node)) {
      const callee = stripParenExpression(node.callee);
      const calleeBinding = getBinding(callee),
        imported = calleeBinding && getImportDeclarationForSymbol(calleeBinding);
      const importedName =
        calleeBinding && isNodeOfType(calleeBinding.declarationNode, "ImportSpecifier")
          ? getImportedName(calleeBinding.declarationNode)
          : null;
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval")
        unsupportedCapability = true;
      if (
        imported &&
        REACT_RUNTIME_MODULE_SOURCES.has(String(imported.source.value)) &&
        importedName
      ) {
        if (
          !hasRefNotificationReactCall(node, importedName, context) ||
          !(
            (importedName === "useEffect" && getExactCall(node, 2)) ||
            (importedName === "useId" && getExactCall(node, 0))
          )
        )
          unsupportedCapability = true;
      } else if (isNodeOfType(callee, "MemberExpression")) {
        if (
          callee.computed ||
          !FOCUS_REQUEST_ARRAY_READ_METHODS.has(getStaticPropertyKeyName(callee) ?? "") ||
          !getExactCall(node, 1)
        )
          unsupportedCapability = true;
      } else if (
        findEnclosingFunction(node) === component &&
        isNodeOfType(node.parent, "VariableDeclarator") &&
        !isPassiveFetcherInitializer(node)
      )
        unsupportedCapability = true;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    if (node.name === "arguments") unsupportedCapability = true;
    if (!context.scopes.isGlobalReference(node)) return;
    if (
      (node.name === "Map" && node !== mapConstructor.callee) ||
      (node.name === "Math" && node !== minimumMember.object) ||
      REF_NOTIFICATION_RUNTIME_CAPABILITIES.has(node.name) ||
      FOCUS_REQUEST_UNSUPPORTED_GLOBALS.has(node.name)
    )
      unsupportedCapability = true;
  });
  return !unsupportedCapability;
};
