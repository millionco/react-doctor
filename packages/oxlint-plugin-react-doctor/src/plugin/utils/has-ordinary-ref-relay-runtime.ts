import { getRuntimeSymbolReferences } from "./get-runtime-symbol-references.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { walkAst } from "./walk-ast.js";

const UNSUPPORTED_REF_RELAY_MEMBER_NAMES: ReadonlySet<string> = new Set([
  "constructor",
  "require",
  "prototype",
  "__proto__",
  "React",
  "Reflect",
  "Function",
  "eval",
  "defaultView",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "__lookupGetter__",
  "__lookupSetter__",
  "__defineGetter__",
  "__defineSetter__",
]);

const isErasedNamespace = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "TSModuleDeclaration")) return false;
  if (isNodeOfType(node.body, "TSModuleDeclaration")) return isErasedNamespace(node.body);
  if (!isNodeOfType(node.body, "TSModuleBlock")) return false;
  return node.body.body.every((statement) => {
    const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    return (
      isNodeOfType(declaration, "TSTypeAliasDeclaration") ||
      isNodeOfType(declaration, "TSInterfaceDeclaration") ||
      (isNodeOfType(declaration, "TSModuleDeclaration") && isErasedNamespace(declaration))
    );
  });
};

export const hasOrdinaryRefRelayRuntime = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let isOrdinary = true;
  walkAst(program, (node) => {
    if (!isOrdinary) return false;
    if (
      isNodeOfType(node, "TSTypeAliasDeclaration") ||
      isNodeOfType(node, "TSInterfaceDeclaration")
    )
      return false;
    if (isNodeOfType(node, "TSModuleDeclaration")) {
      if (!isErasedNamespace(node)) isOrdinary = false;
      return false;
    }
    if (
      node.type === "TSParameterProperty" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSExportAssignment" ||
      node.type === "TSEnumMember" ||
      node.type === "TSEnumDeclaration"
    ) {
      isOrdinary = false;
      return false;
    }
    if (isKeyedDraftTypeReference(node)) return false;
    const parent = node.parent;
    if (
      parent &&
      "key" in parent &&
      parent.key === node &&
      "computed" in parent &&
      !parent.computed &&
      (isNodeOfType(parent, "Property")
        ? !parent.shorthand || parent.value !== node
        : isNodeOfType(parent, "MethodDefinition") ||
          isNodeOfType(parent, "PropertyDefinition") ||
          isNodeOfType(parent, "AccessorProperty"))
    )
      return false;

    if (
      isNodeOfType(node, "Property") &&
      node.computed &&
      isNodeOfType(node.parent, "ObjectPattern")
    ) {
      isOrdinary = false;
      return false;
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (node.importKind === "type") return;
      if (
        node.source.value === "react/jsx-runtime" ||
        node.source.value === "react/jsx-dev-runtime"
      ) {
        isOrdinary = false;
        return false;
      }
      if (node.source.value !== "react") return;
      isOrdinary = node.specifiers.every((specifier) => {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
          return true;
        if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
        const name = getStaticKeyName(specifier.imported);
        if (!name || name === "default") return false;
        const symbol = scopes.symbolFor(specifier.local);
        return (
          symbol !== null &&
          hasCompleteSymbolReferences(symbol, program, scopes) &&
          getRuntimeSymbolReferences(symbol).every((reference) => {
            const root = findTransparentExpressionRoot(reference.identifier);
            return (
              reference.flag === "read" &&
              isNodeOfType(root.parent, "CallExpression") &&
              !root.parent.optional &&
              root.parent.callee === root
            );
          })
        );
      });
    }
    if (
      isNodeOfType(node, "Identifier") &&
      (node.name === "React" ||
        node.name === "Reflect" ||
        node.name === "Function" ||
        node.name === "eval" ||
        node.name === "arguments" ||
        node.name === "require" ||
        node.name === "globalThis" ||
        node.name === "global" ||
        node.name === "self" ||
        node.name === "module" ||
        node.name === "exports")
    ) {
      isOrdinary = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && node.name === "window") {
      const member = node.parent;
      const call = member?.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== node ||
        member.computed ||
        member.optional ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== member ||
        call.optional
      )
        isOrdinary = false;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyKeyName(node, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      if (node.computed && name === null) {
        const parent = node.parent;
        let comparisonOperand: EsTreeNode | null = null;
        if (
          isNodeOfType(parent, "BinaryExpression") &&
          (parent.operator === "===" || parent.operator === "!==")
        ) {
          comparisonOperand = parent.left === node ? parent.right : parent.left;
        }
        const isUndefinedComparison =
          isNodeOfType(comparisonOperand, "Identifier") &&
          comparisonOperand.name === "undefined" &&
          scopes.isGlobalReference(comparisonOperand);
        const isDeletion =
          isNodeOfType(parent, "UnaryExpression") &&
          parent.operator === "delete" &&
          parent.argument === node;
        if (!isUndefinedComparison && !isDeletion) isOrdinary = false;
      }
      if (name && UNSUPPORTED_REF_RELAY_MEMBER_NAMES.has(name)) isOrdinary = false;
    }
    if (isNodeOfType(node, "Property")) {
      const name = getStaticKeyName(node.key);
      if (
        name &&
        UNSUPPORTED_REF_RELAY_MEMBER_NAMES.has(name) &&
        (isNodeOfType(node.parent, "ObjectPattern") || node.computed || node.shorthand)
      )
        isOrdinary = false;
    }
  });
  return isOrdinary;
};
