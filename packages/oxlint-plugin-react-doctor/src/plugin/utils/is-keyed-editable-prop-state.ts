import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { findProgramRoot } from "./find-program-root.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getClosedComponentJsxCalls } from "./get-closed-component-jsx-calls.js";
import { getControlledInputChangeProp } from "./get-controlled-input-change-prop.js";
import { getFlatStringRecordFields } from "./get-flat-string-record-fields.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasOrdinaryKeyedDraftReactProvider } from "./has-ordinary-keyed-draft-react-provider.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import type { RuleContext } from "./rule-context.js";

const getAttributeValue = (attribute: EsTreeNode | null): EsTreeNode | null =>
  isNodeOfType(attribute, "JSXAttribute") &&
  isNodeOfType(attribute.value, "JSXExpressionContainer") &&
  !isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
    ? stripParenExpression(attribute.value.expression)
    : null;

const hasUniqueAttributes = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const names = new Set<string>();
  for (const attribute of opening.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (!name || names.has(name)) return false;
    names.add(name);
  }
  return true;
};

const hasClosedRecordReads = (
  record: SymbolDescriptor,
  fields: ReadonlySet<string>,
  props: ReadonlySet<EsTreeNode>,
  program: EsTreeNode,
  context: RuleContext,
): boolean =>
  hasCompleteSymbolReferences(record, program, context.scopes) &&
  record.references.every((reference) => {
    if (isKeyedDraftTypeReference(reference.identifier)) return true;
    if (reference.flag !== "read") return false;
    const identifier = reference.identifier;
    const expression = findTransparentExpressionRoot(identifier);
    const parent = expression.parent;
    if (props.has(identifier)) return true;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
      const name = getStaticPropertyName(parent);
      return (
        !parent.computed &&
        !parent.optional &&
        name !== null &&
        fields.has(name) &&
        !isWithinAssignmentTarget(parent)
      );
    }
    return Boolean(
      ((isNodeOfType(parent, "ConditionalExpression") || isNodeOfType(parent, "IfStatement")) &&
        parent.test === expression) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "!" &&
        parent.argument === expression),
    );
  });

const getRecordProp = (record: SymbolDescriptor, component: EsTreeNode): string | null => {
  const property = record.bindingIdentifier.parent;
  if (
    record.kind !== "parameter" ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== record.bindingIdentifier ||
    !isNodeOfType(property.parent, "ObjectPattern") ||
    (!isNodeOfType(component, "FunctionDeclaration") &&
      !isNodeOfType(component, "ArrowFunctionExpression")) ||
    component.params.length !== 1 ||
    component.params[0] !== property.parent
  )
    return null;
  const names = new Set<string>();
  for (const parameter of property.parent.properties) {
    if (
      !isNodeOfType(parameter, "Property") ||
      parameter.computed ||
      !isNodeOfType(parameter.value, "Identifier")
    )
      return null;
    const name = getStaticKeyName(parameter.key);
    if (!name || names.has(name)) return null;
    names.add(name);
  }
  const name = getStaticKeyName(property.key);
  return name !== "key" && name !== "ref" ? name : null;
};

const isEditedFromControl = (
  reference: EsTreeNode,
  state: SymbolDescriptor,
  setter: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const callee = findTransparentExpressionRoot(reference);
  const call = callee.parent;
  const callRoot = call && findTransparentExpressionRoot(call);
  const handler = callRoot?.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    stripParenExpression(call.callee) !== reference ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.body !== callRoot ||
    handler.async ||
    handler.typeParameters ||
    handler.params.length !== 1 ||
    !isNodeOfType(handler.params[0], "Identifier")
  )
    return false;
  const container = findTransparentExpressionRoot(handler).parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !hasUniqueAttributes(opening)
  )
    return false;
  const changeProp = getControlledInputChangeProp(opening, context);
  const value = getAttributeValue(getAuthoritativeJsxAttribute(opening.attributes, "value"));
  if (
    !changeProp ||
    getJsxAttributeName(attribute.name) !== changeProp ||
    context.scopes.symbolFor(value ?? opening) !== state ||
    context.scopes.symbolFor(reference) !== setter
  )
    return false;
  const rawArgument = call.arguments[0];
  if (!rawArgument) return false;
  let argument = stripParenExpression(rawArgument);
  const fallback = isNodeOfType(argument, "LogicalExpression")
    ? stripParenExpression(argument.right)
    : null;
  if (
    isNodeOfType(argument, "LogicalExpression") &&
    argument.operator === "??" &&
    isNodeOfType(fallback, "Literal") &&
    fallback.value === ""
  )
    argument = stripParenExpression(argument.left);
  if (changeProp === "onChange") {
    if (
      !isNodeOfType(argument, "MemberExpression") ||
      argument.computed ||
      argument.optional ||
      getStaticPropertyName(argument) !== "value" ||
      !isNodeOfType(stripParenExpression(argument.object), "MemberExpression")
    )
      return false;
    const target = stripParenExpression(argument.object);
    if (
      !isNodeOfType(target, "MemberExpression") ||
      target.computed ||
      target.optional ||
      getStaticPropertyName(target) !== "target"
    )
      return false;
    argument = stripParenExpression(target.object);
  }
  return (
    isNodeOfType(argument, "Identifier") &&
    context.scopes.symbolFor(argument) === context.scopes.symbolFor(handler.params[0])
  );
};

export const isKeyedEditablePropState = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const component = findEnclosingFunction(call);
  const program = findProgramRoot(call);
  const declarator = findTransparentExpressionRoot(call).parent;
  const rawSeed = call.arguments[0];
  const seed = rawSeed && stripParenExpression(rawSeed);
  const seedObject = isNodeOfType(seed, "MemberExpression")
    ? stripParenExpression(seed.object)
    : null;
  const callee = stripParenExpression(call.callee);
  if (
    !component ||
    !program ||
    !hasOrdinaryKeyedDraftReactProvider(
      program,
      context.scopes,
      context.sourceCode?.getText?.() ?? "",
      context.settings,
    ) ||
    !isReactApiCall(call, "useState", context.scopes) ||
    call.optional ||
    call.arguments.length !== 1 ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isNodeOfType(seed, "MemberExpression") ||
    seed.optional ||
    seed.computed ||
    !isNodeOfType(seedObject, "Identifier")
  )
    return false;
  const hook = context.scopes.symbolFor(callee);
  const importedHook = hook && getImportDeclarationForSymbol(hook);
  if (
    !isNodeOfType(callee, "Identifier") ||
    !hook ||
    importedHook?.source.value !== "react" ||
    importedHook.importKind === "type" ||
    !isNodeOfType(hook.declarationNode, "ImportSpecifier") ||
    hook.declarationNode.importKind === "type" ||
    getImportedName(hook.declarationNode) !== "useState"
  )
    return false;
  const [stateBinding, setterBinding] = declarator.id.elements;
  if (
    declarator.id.elements.length !== 2 ||
    !isNodeOfType(stateBinding, "Identifier") ||
    !isNodeOfType(setterBinding, "Identifier")
  )
    return false;
  const record = context.scopes.symbolFor(seedObject);
  const state = context.scopes.symbolFor(stateBinding);
  const setter = context.scopes.symbolFor(setterBinding);
  const seedField = getStaticPropertyName(seed);
  if (!record || !state || !setter || !seedField) return false;
  const propName = getRecordProp(record, component);
  const fields = getFlatStringRecordFields(record, context);
  const callers = getClosedComponentJsxCalls(component, context);
  const setterReferences = setter.references.filter(
    (reference) => !isKeyedDraftTypeReference(reference.identifier),
  );
  if (
    !propName ||
    !fields?.has(seedField) ||
    !callers ||
    !hasClosedRecordReads(record, fields, new Set(), program, context) ||
    !hasCompleteSymbolReferences(state, program, context.scopes) ||
    !hasCompleteSymbolReferences(setter, program, context.scopes) ||
    state.references.some(
      (reference) => !isKeyedDraftTypeReference(reference.identifier) && reference.flag !== "read",
    ) ||
    setterReferences.length === 0 ||
    !setterReferences.every(
      (reference) =>
        reference.flag === "read" &&
        isEditedFromControl(reference.identifier, state, setter, context),
    )
  )
    return false;
  const callerProps = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  for (const caller of callers) {
    if (!hasUniqueAttributes(caller)) return false;
    const prop = getAttributeValue(getAuthoritativeJsxAttribute(caller.attributes, propName));
    const key = getAttributeValue(getAuthoritativeJsxAttribute(caller.attributes, "key"));
    if (
      !isNodeOfType(prop, "Identifier") ||
      !isNodeOfType(key, "MemberExpression") ||
      key.computed ||
      key.optional ||
      !isNodeOfType(stripParenExpression(key.object), "Identifier")
    )
      return false;
    const keyField = getStaticPropertyName(key);
    const callerRecord = context.scopes.symbolFor(prop);
    if (
      !keyField ||
      !fields.has(keyField) ||
      !callerRecord ||
      (callerRecord.kind !== "const" && callerRecord.kind !== "parameter") ||
      context.scopes.symbolFor(stripParenExpression(key.object)) !== callerRecord
    )
      return false;
    const props = callerProps.get(callerRecord) ?? new Set<EsTreeNode>();
    props.add(prop);
    callerProps.set(callerRecord, props);
  }
  return [...callerProps].every(([recordSymbol, props]) =>
    hasClosedRecordReads(recordSymbol, fields, props, program, context),
  );
};
