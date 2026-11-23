import { type ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasClosedDefaultFunctionExport } from "../../utils/has-closed-default-function-export.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isDirectNamedReactHookCall } from "../../utils/is-direct-named-react-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

interface NegatedEffectPropProof {
  readonly property: string;
  readonly component: EsTreeNodeOfType<"FunctionDeclaration">;
  readonly effect: EsTreeNodeOfType<"CallExpression">;
}

interface NamedNegatedEffectPropProof extends NegatedEffectPropProof {
  readonly name: string;
}

const readNegatedEffectPropAtGate = (
  gate: EsTreeNodeOfType<"IfStatement">,
  condition: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): NegatedEffectPropProof | null => {
  const test = stripParenExpression(condition);
  if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return null;
  const operand = stripParenExpression(test.argument);
  if (!isNodeOfType(operand, "Identifier")) return null;

  const callbackBody = gate.parent;
  const callback = callbackBody?.parent;
  const effect = callback?.parent;
  if (
    !isNodeOfType(callbackBody, "BlockStatement") ||
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.body !== callbackBody ||
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments[0] !== callback ||
    !isReactHookCall(effect, "useEffect", scopes)
  )
    return null;
  const hookStatement = effect.parent;
  const functionBody = hookStatement?.parent;
  const component = functionBody?.parent;
  if (
    !isNodeOfType(hookStatement, "ExpressionStatement") ||
    hookStatement.expression !== effect ||
    !isNodeOfType(functionBody, "BlockStatement") ||
    !isNodeOfType(component, "FunctionDeclaration") ||
    component.body !== functionBody ||
    !isNodeOfType(component.params[0], "ObjectPattern")
  )
    return null;

  const prop = scopes.symbolFor(operand);
  if (
    prop?.kind !== "parameter" ||
    prop.references.some(
      ({ flag, identifier }) => flag !== "read" || isWithinAssignmentTarget(identifier),
    ) ||
    !hasCompleteSymbolReferences(prop, program, scopes)
  )
    return null;
  const property = component.params[0].properties.find(
    (entry) => isNodeOfType(entry, "Property") && entry.value === prop.bindingIdentifier,
  );
  const name = property ? getStaticPropertyKeyName(property) : null;
  return name ? { property: name, component, effect } : null;
};

export const findNegatedEffectProp = (
  call: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): NegatedEffectPropProof | null => {
  const statement = call.parent;
  const branch = statement?.parent;
  const gate = branch?.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.expression !== call ||
    !isNodeOfType(branch, "BlockStatement") ||
    !isNodeOfType(gate, "IfStatement") ||
    gate.consequent !== branch
  )
    return null;

  return readNegatedEffectPropAtGate(gate, gate.test, program, scopes);
};

const readNamedComponentProof = (
  proof: NegatedEffectPropProof | null,
  program: EsTreeNodeOfType<"Program">,
): NamedNegatedEffectPropProof | null => {
  const name = proof?.component.id?.name;
  return proof &&
    name &&
    findExportedValue(program, "default") === proof.component &&
    findExportedValue(program, name) === proof.component
    ? { ...proof, name }
    : null;
};

export const readNamedNegatedEffectProp = (
  writer: EsTreeNode,
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): NamedNegatedEffectPropProof | null =>
  readNamedComponentProof(findNegatedEffectProp(writer, program, scopes), program);

export const readNamedNegatedMountEffect = (
  effect: EsTreeNode,
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): NamedNegatedEffectPropProof | null => {
  if (
    !isNodeOfType(effect, "CallExpression") ||
    !isDirectNamedReactHookCall(effect, "useEffect", scopes)
  )
    return null;
  const [callback] = effect.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 1
  )
    return null;
  const [gate] = callback.body.body;
  if (!isNodeOfType(gate, "IfStatement") || gate.alternate) return null;
  const test = stripParenExpression(gate.test);
  if (!isNodeOfType(test, "LogicalExpression") || test.operator !== "&&") return null;
  const proof = readNamedComponentProof(
    readNegatedEffectPropAtGate(gate, test.left, program, scopes),
    program,
  );
  return proof && hasClosedDefaultFunctionExport(proof.component, program, scopes) ? proof : null;
};

const hasPotentialMountGuard = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
  readGuard: typeof readNamedNegatedEffectProp,
): boolean => {
  let candidate = false;
  walkAst(program, (node) => {
    if (candidate) return false;
    if (isNodeOfType(node, "CallExpression") && readGuard(node, program, scopes)) {
      candidate = true;
      return false;
    }
  });
  return candidate;
};

export const hasPotentialMountPropReset = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): boolean => hasPotentialMountGuard(program, scopes, readNamedNegatedEffectProp);

export const hasPotentialNegatedMountEffect = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): boolean => hasPotentialMountGuard(program, scopes, readNamedNegatedMountEffect);
