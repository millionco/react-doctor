import { VITE_ENVIRONMENT_VARIABLE_PREFIX } from "./constants.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { hasCapability } from "../../../utils/get-react-doctor-setting.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const closedEnvironmentByProgram = new WeakMap<EsTreeNode, boolean>();

const getPlainMemberName = (node: EsTreeNode | null | undefined): string | null =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier")
    ? node.property.name
    : null;

const isNativeImportMeta = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MetaProperty") &&
  node.meta.name === "import" &&
  node.property.name === "meta";

const hasClosedEnvironmentReads = (program: EsTreeNode): boolean => {
  const cachedResult = closedEnvironmentByProgram.get(program);
  if (cachedResult !== undefined) return cachedResult;
  let hasOnlySupportedReads = true;
  walkAst(program, (node) => {
    if (!hasOnlySupportedReads) return false;
    if (!isNativeImportMeta(node) || isTypeScriptTypePosition(node)) return;
    const carrier = findTransparentExpressionRoot(node).parent;
    const carrierName = getPlainMemberName(carrier);
    let value = carrier;
    if (carrierName === "env" && carrier) {
      value = findTransparentExpressionRoot(carrier).parent;
      if (!getPlainMemberName(value)) value = null;
    } else if (carrierName !== "url") {
      value = null;
    }
    if (!value) {
      hasOnlySupportedReads = false;
      return false;
    }
    const valueRoot = findTransparentExpressionRoot(value);
    const parent = valueRoot.parent;
    if (
      isWithinAssignmentTarget(valueRoot) ||
      (isNodeOfType(parent, "MemberExpression") && parent.object === valueRoot) ||
      (isNodeOfType(parent, "CallExpression") && parent.callee === valueRoot) ||
      (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === valueRoot)
    ) {
      hasOnlySupportedReads = false;
      return false;
    }
  });
  closedEnvironmentByProgram.set(program, hasOnlySupportedReads);
  return hasOnlySupportedReads;
};

export const isStableViteEnvironmentDependency = (
  dependency: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!hasCapability(context.settings, "vite") || !isNodeOfType(dependency, "Identifier")) {
    return false;
  }
  const symbol = context.scopes.symbolFor(dependency);
  const initializer = symbol ? getDirectConstInitializer(symbol) : null;
  const owner = findEnclosingFunction(dependency);
  if (
    !symbol ||
    !initializer ||
    !owner ||
    findEnclosingFunction(symbol.declarationNode) !== owner ||
    symbol.scope.symbols.some(
      (otherSymbol) => otherSymbol !== symbol && otherSymbol.name === symbol.name,
    ) ||
    symbol.references.some(
      (reference) =>
        !isTypeScriptTypePosition(reference.identifier) &&
        (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)),
    )
  ) {
    return false;
  }
  const value = stripParenExpression(initializer);
  const variableName = getPlainMemberName(value);
  if (
    !isNodeOfType(value, "MemberExpression") ||
    !variableName?.startsWith(VITE_ENVIRONMENT_VARIABLE_PREFIX) ||
    variableName === VITE_ENVIRONMENT_VARIABLE_PREFIX
  ) {
    return false;
  }
  const environment = stripParenExpression(value.object);
  const metadata = isNodeOfType(environment, "MemberExpression")
    ? stripParenExpression(environment.object)
    : null;
  const program = context.scopes.rootScope.node;
  return Boolean(
    getPlainMemberName(environment) === "env" &&
    metadata &&
    isNativeImportMeta(metadata) &&
    isNodeOfType(program, "Program") &&
    hasClosedEnvironmentReads(program),
  );
};
