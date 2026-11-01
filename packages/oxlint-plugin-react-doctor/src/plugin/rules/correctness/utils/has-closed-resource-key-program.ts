import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  RESOURCE_KEY_REFLECTION_PROPERTIES,
  RESOURCE_KEY_THEME_PROPERTIES,
  RESOURCE_KEY_UNSUPPORTED_GLOBAL_NAMES,
} from "./constants.js";

const programAdmission = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedResourceKeyProgram = (scopes: ScopeAnalysis): boolean => {
  const cached = programAdmission.get(scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  const canonicalBindings = new Set<string>();
  walkAst(scopes.rootScope.node, (node: EsTreeNode) => {
    if (!supported) return false;
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const binding = scopes.symbolFor(node);
      if (
        binding &&
        binding.bindingIdentifier !== node &&
        RESOURCE_KEY_UNSUPPORTED_GLOBAL_NAMES.has(node.name) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        supported = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "ImportExpression") ||
      node.type === "WithStatement" ||
      node.type === "TSExportAssignment" ||
      node.type === "TSParameterProperty" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSModuleDeclaration"
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Literal") &&
      typeof node.value === "string" &&
      RESOURCE_KEY_THEME_PROPERTIES.has(node.value)
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (isTypeOnlyImport(node)) return false;
      const source = node.source.value;
      if (
        source === "node:module" ||
        source === "module" ||
        source === "@mui/system" ||
        (typeof source === "string" && source.startsWith("@mui/system/")) ||
        (typeof source === "string" &&
          (source.startsWith("uuid/") ||
            source.startsWith("@mui/x-data-grid/") ||
            source.startsWith("@mui/material/")))
      ) {
        supported = false;
        return false;
      }
      if (source !== "uuid" && source !== "@mui/x-data-grid" && source !== "@mui/material")
        return false;
      for (const specifier of node.specifiers) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) {
          supported = false;
          break;
        }
        if (specifier.importKind === "type") continue;
        const importedName = getImportedName(specifier);
        if (
          importedName === "default" ||
          (source === "@mui/material" &&
            (importedName === "ThemeProvider" || importedName === "createTheme"))
        ) {
          supported = false;
          break;
        }
        if (
          (source === "uuid" && importedName === "v4") ||
          (source === "@mui/x-data-grid" && importedName === "DataGrid") ||
          (source === "@mui/material" && importedName === "Stack")
        ) {
          const bindingKey = `${source}:${importedName}`;
          if (canonicalBindings.has(bindingKey)) supported = false;
          canonicalBindings.add(bindingKey);
        }
      }
      return false;
    }
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      const symbol = scopes.symbolFor(node);
      const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
      const source = declaration?.source.value;
      if (
        declaration &&
        typeof source === "string" &&
        (source === "uuid" ||
          source === "@mui/x-data-grid" ||
          source === "@mui/material" ||
          source === "node:module" ||
          source === "module" ||
          source.startsWith("uuid/") ||
          source.startsWith("@mui/x-data-grid/") ||
          source.startsWith("@mui/material/")) &&
        (isTypeOnlyImport(declaration) ||
          (symbol &&
            isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
            symbol.declarationNode.importKind === "type"))
      ) {
        supported = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "Identifier") &&
      RESOURCE_KEY_UNSUPPORTED_GLOBAL_NAMES.has(node.name) &&
      scopes.isGlobalReference(node)
    ) {
      supported = false;
      return false;
    }
    let propertyName: string | null = null;
    if (isNodeOfType(node, "MemberExpression")) propertyName = getStaticPropertyName(node);
    if (isNodeOfType(node, "Property")) {
      propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
    }
    if (
      propertyName &&
      (RESOURCE_KEY_REFLECTION_PROPERTIES.has(propertyName) ||
        RESOURCE_KEY_THEME_PROPERTIES.has(propertyName))
    )
      supported = false;
  });
  programAdmission.set(scopes, supported);
  return supported;
};
