import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isAstNode } from "../../../utils/is-ast-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { moduleReferencesReact } from "../../../utils/module-references-react.js";
import { readNearestPackageManifest } from "../../../utils/read-nearest-package-manifest.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NODE_FILE_URL_ARGUMENT_COUNT,
  NODE_FILE_URL_ERASED_TYPES,
  NODE_FILE_URL_RUNTIME_TYPES,
} from "./constants.js";

export const isNodeFileUrlConfigurationModule = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): boolean => {
  if (!context.filename || moduleReferencesReact(program)) return false;
  const manifest = readNearestPackageManifest(context.filename);
  if (
    !manifest ||
    "browser" in manifest ||
    "exports" in manifest ||
    typeof manifest.main !== "string" ||
    !manifest.main.trim() ||
    !("engines" in manifest) ||
    typeof manifest.engines !== "object" ||
    manifest.engines === null ||
    !("node" in manifest.engines) ||
    typeof manifest.engines.node !== "string" ||
    !manifest.engines.node.trim()
  ) {
    return false;
  }

  let hasUnsupportedSyntax = false;
  const providers: SymbolDescriptor[] = [];
  const typeOnlyProviderNames = new Set<string>();
  walkAst(program, (node) => {
    if (hasUnsupportedSyntax) return false;
    if (NODE_FILE_URL_ERASED_TYPES.has(node.type)) return false;
    if (
      NODE_FILE_URL_RUNTIME_TYPES.has(node.type) ||
      node.type === "WithStatement" ||
      (isNodeOfType(node, "Identifier") && node.name === "eval") ||
      (isNodeOfType(node, "MemberExpression") &&
        isNodeOfType(node.property, "Literal") &&
        node.property.value === "eval")
    ) {
      hasUnsupportedSyntax = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      node.type.startsWith("TS") &&
      (!("expression" in node) ||
        !isAstNode(node.expression) ||
        isTypeScriptTypePosition(node.expression))
    ) {
      hasUnsupportedSyntax = true;
      return false;
    }
    if (!isNodeOfType(node, "ImportDeclaration") || node.source.value !== "url") return;
    for (const specifier of node.specifiers) {
      const symbol = context.scopes.symbolFor(specifier.local);
      if (!symbol || symbol.kind !== "import" || symbol.declarationNode !== specifier) {
        hasUnsupportedSyntax = true;
        return false;
      }
      const isTypeOnly =
        node.importKind === "type" ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type");
      if (isTypeOnly) {
        typeOnlyProviderNames.add(symbol.name);
        continue;
      }
      if (!isNodeOfType(specifier, "ImportSpecifier") || getImportedName(specifier) === "default") {
        hasUnsupportedSyntax = true;
        return false;
      }
      if (getImportedName(specifier) !== "pathToFileURL") continue;
      if (providers.length > 0) {
        hasUnsupportedSyntax = true;
        return false;
      }
      providers.push(symbol);
    }
  });
  const provider = providers[0];
  if (hasUnsupportedSyntax || !provider) return false;
  if (typeOnlyProviderNames.size) {
    const pendingScopes = [context.scopes.rootScope];
    let currentScope = pendingScopes.pop();
    while (currentScope) {
      pendingScopes.push(...currentScope.children);
      for (const reference of currentScope.references) {
        const identifier = reference.identifier;
        if (
          !isNodeOfType(identifier, "Identifier") ||
          !typeOnlyProviderNames.has(identifier.name) ||
          isTypeScriptTypePosition(identifier)
        ) {
          continue;
        }
        if (!reference.resolvedSymbol || !hasRuntimeValueBinding(reference.resolvedSymbol)) {
          return false;
        }
      }
      currentScope = pendingScopes.pop();
    }
  }
  const references = provider.references.filter(
    (reference) => !isTypeScriptTypePosition(reference.identifier),
  );
  return (
    references.length > 0 &&
    references.every((reference) => {
      const identifier = reference.identifier;
      const call = identifier.parent;
      if (
        reference.flag !== "read" ||
        isWithinAssignmentTarget(identifier) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== identifier ||
        call.optional ||
        call.arguments.length !== NODE_FILE_URL_ARGUMENT_COUNT ||
        isNodeOfType(call.arguments[0], "SpreadElement")
      ) {
        return false;
      }
      const member = call.parent;
      return (
        isNodeOfType(member, "MemberExpression") &&
        member.object === call &&
        !member.computed &&
        !member.optional &&
        isNodeOfType(member.property, "Identifier") &&
        member.property.name === "href" &&
        isNodeOfType(member.parent, "ImportExpression") &&
        member.parent.source === member
      );
    })
  );
};
