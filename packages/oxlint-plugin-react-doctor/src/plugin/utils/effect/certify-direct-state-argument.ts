import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getSingleReturnExpression } from "../get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../get-static-property-key-name.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isWithinAssignmentTarget } from "../is-within-assignment-target.js";
import { resolveReactUseStatePair } from "../resolve-react-use-state-pair.js";
import type { RuleContext } from "../rule-context.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { isClosedReactHookCall } from "./is-closed-react-hook-call.js";
import { isOwnedNativePrimitive } from "./certify-owned-native-dom-operation.js";
import { isImperativePrimitive } from "./is-imperative-primitive.js";

interface DirectStateArgumentInput {
  call: EsTreeNodeOfType<"CallExpression">;
  context: RuleContext;
  project: SourceProjectIndex;
}

interface StateUpdaterReturn {
  parameter: SymbolDescriptor;
  expression: EsTreeNode;
}

const getStateUpdaterReturn = (
  argument: EsTreeNode,
  context: RuleContext,
): StateUpdaterReturn | null => {
  const updater = stripParenExpression(argument);
  if (
    !isFunctionLike(updater) ||
    updater.async ||
    updater.generator ||
    updater.params.length !== 1 ||
    !isNodeOfType(updater.params[0], "Identifier")
  )
    return null;
  const parameter = context.scopes.symbolFor(updater.params[0]);
  const returned = getSingleReturnExpression(updater);
  return parameter &&
    returned &&
    parameter.references.length === 1 &&
    parameter.references.every((reference) => reference.flag === "read")
    ? { parameter, expression: stripParenExpression(returned) }
    : null;
};

const isIdentityStateUpdater = (updater: StateUpdaterReturn, context: RuleContext): boolean =>
  isNodeOfType(updater.expression, "Identifier") &&
  context.scopes.symbolFor(updater.expression) === updater.parameter;

const getPrimitiveRecordKeys = (
  argument: EsTreeNode,
  context: RuleContext,
  project: SourceProjectIndex,
  previousParameter?: SymbolDescriptor,
): Set<string> | null => {
  const record = stripParenExpression(argument);
  if (!isNodeOfType(record, "ObjectExpression")) return null;
  const properties = record.properties;
  if (previousParameter) {
    const spread = properties[0];
    if (
      !isNodeOfType(spread, "SpreadElement") ||
      !isNodeOfType(spread.argument, "Identifier") ||
      context.scopes.symbolFor(spread.argument) !== previousParameter
    )
      return null;
  }
  const keys = new Set<string>();
  for (const property of previousParameter ? properties.slice(1) : properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (
      key === null ||
      key === "__proto__" ||
      keys.has(key) ||
      (!isImperativePrimitive(property.value, {
        scopes: context.scopes,
        primitiveSymbols: new Set<SymbolDescriptor>(),
      }) &&
        !isOwnedNativePrimitive(property.value, context, project))
    )
      return null;
    keys.add(key);
  }
  return keys;
};

const hasClosedOwnRecordState = ({ call, context, project }: DirectStateArgumentInput): boolean => {
  const pair = resolveReactUseStatePair(call.callee, context.scopes);
  if (
    !pair?.stateSymbol ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    pair.declarator.init.arguments.length !== 1 ||
    !isClosedReactHookCall(pair.declarator.init, "useState", context.scopes)
  )
    return false;
  const initializer = pair.declarator.init.arguments[0];
  const initialKeys = initializer && getPrimitiveRecordKeys(initializer, context, project);
  if (!initialKeys) return false;
  if (
    !pair.setterSymbol.references.every((reference) => {
      const root = findTransparentExpressionRoot(reference.identifier);
      const writer = root.parent;
      if (
        reference.flag !== "read" ||
        !isNodeOfType(writer, "CallExpression") ||
        writer.callee !== root ||
        writer.optional ||
        writer.arguments.length !== 1
      )
        return false;
      const argument = writer.arguments[0];
      const directKeys = getPrimitiveRecordKeys(argument, context, project);
      if (directKeys)
        return (
          directKeys.size === initialKeys.size &&
          [...directKeys].every((key) => initialKeys.has(key))
        );
      const updater = getStateUpdaterReturn(argument, context);
      if (!updater) return false;
      if (isIdentityStateUpdater(updater, context)) return true;
      const updatedKeys = getPrimitiveRecordKeys(
        updater.expression,
        context,
        project,
        updater.parameter,
      );
      return Boolean(updatedKeys && [...updatedKeys].every((key) => initialKeys.has(key)));
    })
  )
    return false;
  return pair.stateSymbol.references.every((reference) => {
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      isWithinAssignmentTarget(member)
    )
      return false;
    const key = getStaticPropertyKeyName(member, { allowComputedString: true });
    if (key === null || !initialKeys.has(key)) return false;
    const memberRoot = findTransparentExpressionRoot(member);
    const parent = memberRoot.parent;
    return !(
      ((isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
        parent.callee === memberRoot) ||
      (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === memberRoot)
    );
  });
};

export const certifyDirectStateArgument = (input: DirectStateArgumentInput): boolean => {
  const { call, context, project } = input;
  if (call.arguments.length !== 1) return false;
  const argument = call.arguments[0];
  if (getPrimitiveRecordKeys(argument, context, project)) return true;
  const updater = getStateUpdaterReturn(argument, context);
  return Boolean(
    updater &&
    (isIdentityStateUpdater(updater, context) ||
      (getPrimitiveRecordKeys(updater.expression, context, project, updater.parameter) &&
        hasClosedOwnRecordState(input))),
  );
};
