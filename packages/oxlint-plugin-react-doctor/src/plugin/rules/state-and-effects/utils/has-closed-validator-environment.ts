import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";
import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  OWN_HOOK_REACT_API_NAMES,
  OWN_HOOK_RUNTIME_TS_NODES,
  OWN_HOOK_DATA_OBJECT_METHODS,
  OWN_HOOK_PROVIDER_CAPABILITIES,
} from "./constants.js";

export const hasClosedValidatorEnvironment = (
  modules: ReadonlyArray<AsyncEventSourceModule>,
): boolean => {
  for (const module of modules) {
    if (
      [...OWN_HOOK_REACT_API_NAMES].some((name) =>
        hasReactDefaultProviderMutation(name, module.scopes),
      )
    )
      return false;
    for (const symbol of module.scopes.rootScope.symbols) {
      const imported = getImportBindingForName(module.program, symbol.name);
      if (
        !imported ||
        imported.source !== "styled-components" ||
        imported.exportedName !== "default"
      )
        continue;
      if (!hasReadonlyAsyncEventBinding(symbol, module)) return false;
      for (const reference of symbol.references) {
        const value = findTransparentExpressionRoot(reference.identifier);
        const parent = value.parent;
        if (
          isNodeOfType(parent, "MemberExpression") &&
          !parent.optional &&
          getStaticPropertyName(parent) &&
          isNodeOfType(parent.parent, "TaggedTemplateExpression") &&
          parent.parent.tag === parent
        )
          continue;
        if (
          isNodeOfType(parent, "CallExpression") &&
          !parent.optional &&
          parent.callee === value &&
          isNodeOfType(parent.parent, "TaggedTemplateExpression") &&
          parent.parent.tag === parent
        )
          continue;
        return false;
      }
    }
    let supported = true;
    walkAst(module.program, (node) => {
      if (!supported) return false;
      if (OWN_HOOK_RUNTIME_TS_NODES.has(node.type)) {
        supported = false;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (
        isNodeOfType(node, "Identifier") &&
        ["Object", "JSON"].includes(node.name) &&
        module.scopes.symbolFor(node) &&
        module.scopes.referenceFor(node)
      )
        supported = false;
      if (isNodeOfType(node, "WithStatement")) supported = false;
      if (
        isNodeOfType(node, "MemberExpression") &&
        OWN_HOOK_PROVIDER_CAPABILITIES.has(getStaticPropertyName(node) ?? "")
      )
        supported = false;
      if (!isNodeOfType(node, "Identifier") || !module.scopes.isGlobalReference(node)) return;
      if (
        ["RegExp", "Reflect", "eval", "Function", "require", "globalThis", "global"].includes(
          node.name,
        )
      )
        supported = false;
      if (node.name === "JSON") {
        const member = findTransparentExpressionRoot(node).parent;
        const call = member ? findTransparentExpressionRoot(member).parent : null;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          !["parse", "stringify"].includes(getStaticPropertyName(member) ?? "") ||
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          stripParenExpression(call.callee) !== member
        )
          supported = false;
      }
      if (node.name === "Array") {
        const parent = findTransparentExpressionRoot(node).parent;
        if (
          !(isNodeOfType(parent, "NewExpression") && parent.callee === node) &&
          !(
            isNodeOfType(parent, "MemberExpression") &&
            getStaticPropertyName(parent) === "isArray" &&
            isNodeOfType(parent.parent, "CallExpression") &&
            parent.parent.callee === parent
          )
        )
          supported = false;
      }
      if (node.name === "Object") {
        const member = findTransparentExpressionRoot(node).parent;
        const call = member ? findTransparentExpressionRoot(member).parent : null;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.optional ||
          !OWN_HOOK_DATA_OBJECT_METHODS.has(getStaticPropertyName(member) ?? "") ||
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          stripParenExpression(call.callee) !== member
        )
          supported = false;
      }
      if (node.name === "window" || node.name === "self") {
        const member = findTransparentExpressionRoot(node).parent;
        const name = isNodeOfType(member, "MemberExpression")
          ? getStaticPropertyName(member)
          : null;
        if (
          !name ||
          ["RegExp", "Object", "JSON", "Array", "Reflect", "eval", "Function"].includes(name)
        )
          supported = false;
      }
    });
    if (!supported) return false;
  }
  return true;
};
