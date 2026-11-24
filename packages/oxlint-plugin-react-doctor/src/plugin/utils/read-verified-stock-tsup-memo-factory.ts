import * as path from "node:path";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import {
  hasExpectedNpmLauncher,
  hasStockNodeNpmCompilerEnvironment,
} from "./has-stock-node-npm-compiler-environment.js";
import { isDeferredFactoryExport } from "./is-deferred-factory-export.js";
import { readDeclaredTsupProject } from "./read-declared-tsup-project.js";
import type { RuleContext } from "./rule-context.js";
import { STOCK_TSUP_MEMO_COMPILER_PROFILE } from "./stock-tsup-memo-compiler-profile.js";
import {
  readProviderMember,
  resolveStockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";

const hasStockCompilerAndReact = (root: string, filename: string): boolean => {
  const moduleRoot = path.join(root, "node_modules");
  if (
    !hasStockNodeNpmCompilerEnvironment(root) ||
    !hasExpectedNpmLauncher(path.join(moduleRoot, ".bin", "tsup"), "../tsup/dist/cli-default.js") ||
    !verifyStockNpmCompilerPackages(root, STOCK_TSUP_MEMO_COMPILER_PROFILE)
  ) {
    return false;
  }
  const react = STOCK_TSUP_MEMO_COMPILER_PROFILE.packages.find(
    ({ directory }) => directory === "node_modules/react",
  );
  if (!react) return false;
  const provider = resolveStockPhysicalEntry({
    projectRoot: root,
    importerDirectory: path.dirname(filename),
    specifier: "react",
    profile: "node-import",
    contract: { packageName: react.name, version: react.version, files: react.entryMembers },
  });
  return provider?.entry === path.join(moduleRoot, "react", "index.js");
};

export const hasVerifiedStockTsupMemoFactory = (
  factory: { readonly source: string; readonly name: string },
  context: RuleContext,
): boolean => {
  const root = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!root || !context.filename || !path.isAbsolute(root)) return false;
  const filename = path.resolve(root, context.filename);
  try {
    const declaration = readDeclaredTsupProject({
      projectRoot: root,
      focalFilename: filename,
      providerSpecifier: factory.source,
      providerExportName: factory.name,
    });
    if (!declaration) return false;
    const source = context.getSourceText?.();
    if (!source || readProviderMember(filename)?.toString("utf8") !== source) return false;
    const provider = readProviderMember(declaration.providerFilename);
    return Boolean(
      provider &&
      isDeferredFactoryExport(
        declaration.providerFilename,
        provider.toString("utf8"),
        factory.name,
      ) &&
      hasStockCompilerAndReact(root, filename),
    );
  } catch {
    return false;
  }
};
