import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isProvenReactClassComponent } from "../../../utils/is-proven-react-class-component.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  PLATFORM_SUBSCRIPTION_ASSET_PATTERN,
  PLATFORM_SUBSCRIPTION_ASSET_ARGUMENT_COUNT,
  PLATFORM_SUBSCRIPTION_EXPOSED_GLOBALS,
  PLATFORM_SUBSCRIPTION_EXPOSED_PROPERTIES,
  PLATFORM_SUBSCRIPTION_UNSUPPORTED_TS_RUNTIME_TYPES,
} from "./constants.js";

const isSuperclassReference = (expression: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(expression);
  const parent = root.parent;
  return Boolean(
    (isNodeOfType(parent, "ClassDeclaration") || isNodeOfType(parent, "ClassExpression")) &&
    parent.superClass === root,
  );
};

const isClosedProviderReference = (
  identifier: EsTreeNode,
  source: string,
  importedName: string | undefined,
): boolean => {
  if (isTypeScriptTypePosition(identifier)) return true;
  if (isWithinAssignmentTarget(identifier)) return false;
  const root = findTransparentExpressionRoot(identifier);
  if (source === "react" && (importedName === "Component" || importedName === "PureComponent"))
    return isSuperclassReference(root);
  const member = root.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== root ||
    member.computed ||
    member.optional ||
    isWithinAssignmentTarget(member)
  )
    return false;
  const name = getStaticPropertyName(member);
  if (source === "react-native" && importedName === "Platform") return name === "OS";
  if (source === "react-native" && importedName === "NativeEventEmitter") return name === "name";
  if (source === "react" && (name === "Component" || name === "PureComponent"))
    return isSuperclassReference(member);
  const parent = findTransparentExpressionRoot(member).parent;
  if (
    !isNodeOfType(parent, "CallExpression") ||
    parent.optional ||
    parent.callee !== findTransparentExpressionRoot(member)
  )
    return false;
  if (source === "react") return name === "isValidElement";
  return (
    importedName === "Keyboard" &&
    (name === "addListener" || (name === "dismiss" && parent.arguments.length === 0))
  );
};

export const hasClosedPlatformSubscriptionProviders = (
  classNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(classNode, "ClassDeclaration") ||
    !classNode.superClass ||
    !isProvenReactClassComponent(classNode, scopes)
  )
    return false;
  const superclass = stripParenExpression(classNode.superClass);
  const baseIdentifier = isNodeOfType(superclass, "Identifier")
    ? superclass
    : isNodeOfType(superclass, "MemberExpression") &&
        !superclass.computed &&
        !superclass.optional &&
        (getStaticPropertyName(superclass) === "Component" ||
          getStaticPropertyName(superclass) === "PureComponent")
      ? stripParenExpression(superclass.object)
      : null;
  if (!isNodeOfType(baseIdentifier, "Identifier")) return false;
  const baseBinding = scopes.symbolFor(baseIdentifier);
  if (!baseBinding || getValueImportSource(baseBinding) !== "react") return false;
  const baseImportedName = getImportedName(baseBinding.declarationNode);
  if (
    isNodeOfType(superclass, "Identifier") &&
    baseImportedName !== "Component" &&
    baseImportedName !== "PureComponent"
  )
    return false;
  if (
    isNodeOfType(superclass, "MemberExpression") &&
    !isNodeOfType(baseBinding.declarationNode, "ImportDefaultSpecifier") &&
    !isNodeOfType(baseBinding.declarationNode, "ImportNamespaceSpecifier") &&
    baseImportedName !== "default"
  )
    return false;
  let admitted = true;
  walkAst(scopes.rootScope.node, (candidate) => {
    if (!admitted) return false;
    if (isNodeOfType(candidate, "Identifier") && !isTypeScriptTypePosition(candidate)) {
      const binding = scopes.symbolFor(candidate);
      if (
        binding &&
        binding.bindingIdentifier !== candidate &&
        PLATFORM_SUBSCRIPTION_EXPOSED_GLOBALS.has(candidate.name) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        admitted = false;
        return false;
      }
    }
    if (PLATFORM_SUBSCRIPTION_UNSUPPORTED_TS_RUNTIME_TYPES.has(candidate.type)) {
      admitted = false;
      return false;
    }
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      isNodeOfType(stripParenExpression(candidate.object), "Super")
    ) {
      admitted = false;
      return false;
    }
    if (isTypeScriptTypePosition(candidate)) return false;
    if (isNodeOfType(candidate, "ImportSpecifier") && candidate.importKind === "type") return false;
    if (
      isNodeOfType(candidate, "ImportExpression") ||
      isNodeOfType(candidate, "WithStatement") ||
      isNodeOfType(candidate, "TSImportEqualsDeclaration")
    ) {
      admitted = false;
      return;
    }
    if (isNodeOfType(candidate, "ImportDeclaration")) {
      const source = candidate.source.value;
      if (
        typeof source === "string" &&
        (source === "react" ||
          source === "react-native" ||
          source.startsWith("react/") ||
          source.startsWith("react-native/") ||
          source === "module" ||
          source === "node:module")
      ) {
        for (const specifier of candidate.specifiers) {
          if (
            !isTypeOnlyImport(candidate) &&
            !(isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
          )
            continue;
          const binding = scopes.symbolFor(specifier.local);
          if (
            !binding ||
            binding.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
          ) {
            admitted = false;
            return false;
          }
        }
      }
      if (isTypeOnlyImport(candidate)) return false;
      if (
        typeof source === "string" &&
        (source.startsWith("react-native/") ||
          source.startsWith("react/") ||
          source === "module" ||
          source === "node:module")
      ) {
        admitted = false;
        return;
      }
      if (source !== "react" && source !== "react-native") return;
      for (const specifier of candidate.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const importedName = getImportedName(specifier);
        if (
          source === "react-native" &&
          (!isNodeOfType(specifier, "ImportSpecifier") || importedName === "default")
        ) {
          admitted = false;
          break;
        }
        if (
          source === "react-native" &&
          importedName !== "Platform" &&
          importedName !== "Keyboard" &&
          importedName !== "NativeEventEmitter"
        )
          continue;
        if (
          source === "react" &&
          isNodeOfType(specifier, "ImportSpecifier") &&
          importedName !== "default" &&
          importedName !== "Component" &&
          importedName !== "PureComponent"
        ) {
          admitted = false;
          break;
        }
        const binding = scopes.symbolFor(specifier.local);
        if (
          !binding ||
          binding.references.some(
            (reference) =>
              (!isTypeScriptTypePosition(reference.identifier) && reference.flag !== "read") ||
              !isClosedProviderReference(reference.identifier, source, importedName),
          )
        ) {
          admitted = false;
          break;
        }
      }
    }
    if (isNodeOfType(candidate, "Identifier")) {
      const binding = scopes.symbolFor(candidate);
      const isRuntimeGlobal =
        scopes.isGlobalReference(candidate) ||
        Boolean(binding?.kind === "import" && getValueImportSource(binding) === null);
      if (PLATFORM_SUBSCRIPTION_EXPOSED_GLOBALS.has(candidate.name) && isRuntimeGlobal)
        admitted = false;
      if (candidate.name === "require" && (isRuntimeGlobal || Boolean(binding))) {
        const root = findTransparentExpressionRoot(candidate);
        const call = root.parent;
        const argument = isNodeOfType(call, "CallExpression") ? call.arguments[0] : null;
        if (
          !isRuntimeGlobal ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== root ||
          call.optional ||
          call.arguments.length !== PLATFORM_SUBSCRIPTION_ASSET_ARGUMENT_COUNT ||
          !isNodeOfType(argument, "Literal") ||
          typeof argument.value !== "string" ||
          !PLATFORM_SUBSCRIPTION_ASSET_PATTERN.test(argument.value)
        )
          admitted = false;
      }
    }
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      PLATFORM_SUBSCRIPTION_EXPOSED_PROPERTIES.has(getStaticPropertyName(candidate) ?? "")
    )
      admitted = false;
    if (
      isNodeOfType(candidate, "Property") &&
      isNodeOfType(candidate.parent, "ObjectPattern") &&
      PLATFORM_SUBSCRIPTION_EXPOSED_PROPERTIES.has(
        getStaticPropertyKeyName(candidate, { allowComputedString: true }) ?? "",
      )
    )
      admitted = false;
  });
  return admitted;
};
