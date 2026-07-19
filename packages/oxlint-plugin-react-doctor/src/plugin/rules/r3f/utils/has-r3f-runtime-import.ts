import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getGlobalRequireModuleSource } from "../../../utils/get-global-require-module-source.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { getModuleNamespaceSource } from "./get-module-namespace-source.js";
import { R3F_PUBLIC_MODULES } from "./r3f-public-modules.js";

const isR3fRuntimeModule = (moduleSource: string): boolean =>
  R3F_PUBLIC_MODULES.has(moduleSource) || moduleSource.startsWith("@react-three/");

export const hasR3fRuntimeImport = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): boolean =>
  program.body.some((statement) => {
    if (
      isNodeOfType(statement, "ImportDeclaration") &&
      !isTypeOnlyImport(statement) &&
      typeof statement.source.value === "string"
    ) {
      return isR3fRuntimeModule(statement.source.value);
    }
    if (isNodeOfType(statement, "TSImportEqualsDeclaration")) {
      const moduleSource = getModuleNamespaceSource(statement.id, scopes);
      return moduleSource !== null && isR3fRuntimeModule(moduleSource);
    }
    if (isNodeOfType(statement, "ExpressionStatement")) {
      const moduleSource = getGlobalRequireModuleSource(statement.expression, scopes);
      return moduleSource !== null && isR3fRuntimeModule(moduleSource);
    }
    if (!isNodeOfType(statement, "VariableDeclaration")) return false;
    return statement.declarations.some((declaration) => {
      if (!declaration.init) return false;
      const moduleSource = getGlobalRequireModuleSource(declaration.init, scopes);
      return moduleSource !== null && isR3fRuntimeModule(moduleSource);
    });
  });
