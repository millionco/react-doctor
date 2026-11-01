import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNonEscapingReactApiReference } from "../../../utils/is-non-escaping-react-api-reference.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { BOOLEAN_CONVERSION_ARGUMENT_COUNT } from "./effect/constants.js";

const booleanOriginSafetyByAnalysis = new WeakMap<ScopeAnalysis, boolean>();
const GLOBAL_PROVIDER_NAMES = new Set(["globalThis", "window", "self", "global"]);
const DYNAMIC_CALLABLE_PROPERTY_NAMES = new Set(["constructor", "caller", "callee", "__proto__"]);
const GLOBAL_EXECUTION_API_NAMES = new Set(["eval", "Function"]);
const REFLECTION_NAMESPACE_NAMES = new Set(["Object", "Reflect"]);
const COERCION_METHOD_NAMES = new Set(["toString", "valueOf"]);
const SCALAR_UNARY_OPERATORS = new Set(["typeof", "void", "!", "+", "-", "~"]);

export const isProvenUnmodifiedBooleanCall = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== BOOLEAN_CONVERSION_ARGUMENT_COUNT ||
    call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
  ) {
    return false;
  }
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "Identifier") ||
    callee.name !== "Boolean" ||
    !scopes.isGlobalReference(callee)
  ) {
    return false;
  }
  const cachedSafety = booleanOriginSafetyByAnalysis.get(scopes);
  if (cachedSafety !== undefined) return cachedSafety;
  const program = findProgramRoot(call);
  if (!program) return false;
  let isOriginSafe = true;
  walkAst(program, (candidate) => {
    if (!isOriginSafe) return false;
    if (isNodeOfType(candidate, "WithStatement")) {
      isOriginSafe = false;
      return false;
    }
    if (isNodeOfType(candidate, "MemberExpression")) {
      const propertyName = getStaticPropertyName(candidate);
      const root = findTransparentExpressionRoot(candidate);
      const parent = root.parent;
      if (
        (propertyName !== null && DYNAMIC_CALLABLE_PROPERTY_NAMES.has(propertyName)) ||
        (propertyName !== null &&
          COERCION_METHOD_NAMES.has(propertyName) &&
          isMemberMutationTarget(candidate)) ||
        (propertyName === null &&
          !isNodeOfType(parent, "TemplateLiteral") &&
          !(
            isNodeOfType(parent, "UnaryExpression") &&
            parent.argument === root &&
            SCALAR_UNARY_OPERATORS.has(parent.operator)
          ))
      ) {
        isOriginSafe = false;
      }
      return;
    }
    if (isNodeOfType(candidate, "Property") && isNodeOfType(candidate.parent, "ObjectPattern")) {
      const propertyName = getStaticPropertyKeyName(candidate, { allowComputedString: true });
      const key = stripParenExpression(candidate.key);
      const isBooleanKeyRead =
        isNodeOfType(key, "Identifier") && key.name === "Boolean" && scopes.isGlobalReference(key);
      if (
        (propertyName !== null && DYNAMIC_CALLABLE_PROPERTY_NAMES.has(propertyName)) ||
        (propertyName === null && !isBooleanKeyRead)
      ) {
        isOriginSafe = false;
      }
      return;
    }
    if (!isNodeOfType(candidate, "Identifier")) return;
    const binding = scopes.symbolFor(candidate);
    if (
      !scopes.isGlobalReference(candidate) &&
      !(
        binding &&
        scopes.referenceFor(candidate) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      )
    )
      return;
    if (
      GLOBAL_EXECUTION_API_NAMES.has(candidate.name) ||
      REFLECTION_NAMESPACE_NAMES.has(candidate.name)
    ) {
      isOriginSafe = false;
      return;
    }
    if (candidate.name === "Boolean") {
      if (isBindingAssignmentTarget(candidate) || !isNonEscapingReactApiReference(candidate)) {
        isOriginSafe = false;
      }
      return;
    }
    if (!GLOBAL_PROVIDER_NAMES.has(candidate.name)) return;
    const root = findTransparentExpressionRoot(candidate);
    const parent = root.parent;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "typeof") return;
    if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root) {
      isOriginSafe = false;
      return;
    }
    const propertyName = getStaticPropertyName(parent);
    if (
      propertyName === null ||
      GLOBAL_PROVIDER_NAMES.has(propertyName) ||
      GLOBAL_EXECUTION_API_NAMES.has(propertyName) ||
      REFLECTION_NAMESPACE_NAMES.has(propertyName) ||
      (propertyName === "Boolean" &&
        (isMemberMutationTarget(parent) || !isNonEscapingReactApiReference(parent)))
    ) {
      isOriginSafe = false;
    }
  });
  booleanOriginSafetyByAnalysis.set(scopes, isOriginSafe);
  return isOriginSafe;
};
