import { getRuntimeSymbolReferences } from "../../../utils/get-runtime-symbol-references.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NATIVE_EVENT_WRITER_RUNTIME_TYPESCRIPT_NODES,
  NATIVE_EVENT_WRITER_UNSUPPORTED_IDENTIFIERS,
  NATIVE_EVENT_WRITER_UNSUPPORTED_MEMBERS,
} from "./constants.js";

const runtimeProofs = new WeakMap<ScopeAnalysis, boolean>();

export const hasOrdinaryNativeEventWriterRuntime = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  const program = findProgramRoot(node);
  const source = context.sourceCode?.getText?.();
  if (
    !program ||
    source === undefined ||
    hasJsxRuntimePragma({ program, filename: context.filename ?? "", sourceText: source })
  ) {
    return false;
  }
  const cached = runtimeProofs.get(context.scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(program, (current) => {
    if (!supported) return false;
    if (
      NATIVE_EVENT_WRITER_RUNTIME_TYPESCRIPT_NODES.has(current.type) ||
      ("declare" in current && current.declare === true) ||
      isNodeOfType(current, "WithStatement") ||
      isNodeOfType(current, "ImportExpression")
    ) {
      supported = false;
      return false;
    }
    if (isKeyedDraftTypeReference(current)) return false;
    const parent = current.parent;
    if (
      parent &&
      "key" in parent &&
      parent.key === current &&
      "computed" in parent &&
      !parent.computed &&
      (isNodeOfType(parent, "Property")
        ? !parent.shorthand || parent.value !== current
        : isNodeOfType(parent, "MethodDefinition") ||
          isNodeOfType(parent, "PropertyDefinition") ||
          isNodeOfType(parent, "AccessorProperty"))
    )
      return false;

    if (
      (isNodeOfType(current, "Identifier") &&
        NATIVE_EVENT_WRITER_UNSUPPORTED_IDENTIFIERS.has(current.name)) ||
      (isNodeOfType(current, "MemberExpression") &&
        NATIVE_EVENT_WRITER_UNSUPPORTED_MEMBERS.has(getStaticPropertyName(current) ?? "")) ||
      (isNodeOfType(current, "ObjectPattern") &&
        current.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            (property.computed ||
              (isNodeOfType(property.key, "Identifier") &&
                NATIVE_EVENT_WRITER_UNSUPPORTED_MEMBERS.has(property.key.name)) ||
              (isNodeOfType(property.key, "Literal") &&
                typeof property.key.value === "string" &&
                NATIVE_EVENT_WRITER_UNSUPPORTED_MEMBERS.has(property.key.value))),
        ))
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(current, "Identifier") && current.name === "React") {
      const symbol = context.scopes.symbolFor(current);
      if (!symbol || getValueImportSource(symbol) !== "react") {
        supported = false;
        return false;
      }
    }
    if (!isNodeOfType(current, "ImportDeclaration") || current.source.value !== "react") return;
    for (const specifier of current.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol) {
        supported = false;
        return false;
      }
      if (getValueImportSource(symbol) === null) continue;
      if (!hasCompleteSymbolReferences(symbol, program, context.scopes)) {
        supported = false;
        return false;
      }
      const importedName = getImportedName(specifier);
      if (
        getRuntimeSymbolReferences(symbol).some((reference) => {
          const identifier = reference.identifier;
          if (isKeyedDraftTypeReference(identifier)) return false;
          const expression = findTransparentExpressionRoot(identifier);
          const parent = expression.parent;
          return !(
            reference.flag === "read" &&
            importedName &&
            (isReactHookName(importedName) || importedName === "forwardRef") &&
            isNodeOfType(parent, "CallExpression") &&
            parent.callee === expression &&
            !parent.optional
          );
        })
      ) {
        supported = false;
        return false;
      }
    }
  });
  runtimeProofs.set(context.scopes, supported);
  return supported;
};
