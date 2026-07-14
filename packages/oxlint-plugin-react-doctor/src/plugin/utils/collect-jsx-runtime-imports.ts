import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";

export interface JsxRuntimeImports {
  hasReactRuntime: boolean;
  hasSolidRuntime: boolean;
}

const REACT_RUNTIME_PACKAGE_PREFIXES: ReadonlyArray<string> = ["react", "react-dom"];

const matchesPackage = (source: string, packageName: string): boolean =>
  source === packageName || source.startsWith(`${packageName}/`);

export const collectJsxRuntimeImports = (
  program: EsTreeNodeOfType<"Program">,
): JsxRuntimeImports => {
  let hasReactRuntime = false;
  let hasSolidRuntime = false;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    if (isTypeOnlyImport(statement)) continue;
    const source = statement.source.value;
    if (typeof source !== "string") continue;
    if (matchesPackage(source, "solid-js")) hasSolidRuntime = true;
    if (REACT_RUNTIME_PACKAGE_PREFIXES.some((packageName) => matchesPackage(source, packageName))) {
      hasReactRuntime = true;
    }
  }
  return { hasReactRuntime, hasSolidRuntime };
};
