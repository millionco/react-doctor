import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";
import { extractScriptInvocations } from "./extract-script-binary-names.js";
import { hasImportedCallInExportedConfig } from "./has-imported-call-in-exported-config.js";

export const collectStencilCompanionPackageNames = (
  rootDirectory: string,
  declaredPackageNames: ReadonlySet<string>,
): Set<string> => {
  const companionPackageNames = new Set<string>();
  const stencilConfigPaths = fg.sync(["stencil.config.{ts,js,mts,mjs,cts,cjs}"], {
    cwd: rootDirectory,
    absolute: true,
    onlyFiles: true,
  });
  for (const stencilConfigPath of stencilConfigPaths) {
    let stencilConfig = "";
    try {
      stencilConfig = readFileSync(stencilConfigPath, "utf8");
    } catch {
      continue;
    }
    if (
      declaredPackageNames.has("@revolist/stencil-angular-output") &&
      declaredPackageNames.has("@angular/core") &&
      hasImportedCallInExportedConfig(
        stencilConfig,
        "@revolist/stencil-angular-output",
        "angularOutputTarget",
      )
    ) {
      companionPackageNames.add("@angular/core");
    }
    if (
      declaredPackageNames.has("@stencil/vue-output-target") &&
      declaredPackageNames.has("vue") &&
      hasImportedCallInExportedConfig(
        stencilConfig,
        "@stencil/vue-output-target",
        "vueOutputTarget",
      )
    ) {
      companionPackageNames.add("vue");
    }
  }

  if (!declaredPackageNames.has("@stencil/core")) return companionPackageNames;
  try {
    const packageJson = JSON.parse(readFileSync(resolve(rootDirectory, "package.json"), "utf8"));
    const scripts = packageJson.scripts;
    const hasStencilTestScript =
      scripts &&
      typeof scripts === "object" &&
      Object.values(scripts).some(
        (scriptCommand) =>
          typeof scriptCommand === "string" &&
          extractScriptInvocations(scriptCommand).some(
            (invocation) =>
              invocation.binaryName === "stencil" && invocation.argumentValues[0] === "test",
          ),
      );
    if (hasStencilTestScript) {
      for (const packageName of ["@types/jest", "jest", "jest-cli"]) {
        if (declaredPackageNames.has(packageName)) companionPackageNames.add(packageName);
      }
    }
  } catch {}
  return companionPackageNames;
};
