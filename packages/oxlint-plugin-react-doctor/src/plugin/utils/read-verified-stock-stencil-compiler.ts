import * as fs from "node:fs";
import * as path from "node:path";
import {
  hasExpectedNpmLauncher,
  hasStockNodeNpmCompilerEnvironment,
} from "./has-stock-node-npm-compiler-environment.js";
import { STOCK_STENCIL_COMPILER_PROFILE } from "./stock-stencil-compiler-profile.js";
import { resolveStockPhysicalEntry } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { verifyStockNpmCompilerPackages } from "./verify-stock-npm-compiler-packages.js";

export const hasVerifiedStockStencilCompiler = (projectRoot: string, filename: string): boolean => {
  try {
    if (
      !hasStockNodeNpmCompilerEnvironment(projectRoot) ||
      Object.entries(process.env).some(
        ([name, value]) => value && (name.startsWith("STENCIL_") || name === "TS_ETW_MODULE_PATH"),
      )
    ) {
      return false;
    }
    const moduleRoot = path.join(projectRoot, "node_modules");
    if (
      !hasExpectedNpmLauncher(
        path.join(moduleRoot, ".bin", "stencil"),
        "../@stencil/core/bin/stencil",
      ) ||
      !verifyStockNpmCompilerPackages(projectRoot, STOCK_STENCIL_COMPILER_PROFILE)
    ) {
      return false;
    }
    const resolve = (
      name: string,
      issuer: string,
      specifier = name,
      mode: "node-import" | "node-require" = "node-require",
    ) => {
      const definition = STOCK_STENCIL_COMPILER_PROFILE.packages.find(
        (entry) => entry.directory === `node_modules/${name}`,
      );
      return definition
        ? resolveStockPhysicalEntry({
            projectRoot,
            importerDirectory: issuer,
            specifier,
            profile: mode,
            contract: {
              packageName: name,
              version: definition.version,
              files: definition.entryMembers,
            },
          })
        : null;
    };
    const packageDirectory = path.join(moduleRoot, "@stencil", "core");
    const compiler = resolve("@stencil/core", projectRoot, "@stencil/core/compiler");
    if (compiler?.entry !== path.join(packageDirectory, "compiler", "stencil.js")) return false;
    const runtime = resolve(
      "@stencil/core",
      path.dirname(filename),
      "@stencil/core",
      "node-import",
    );
    if (runtime?.packageDirectory !== packageDirectory) return false;
    const compilerDirectory = path.dirname(compiler.entry);
    if (
      fs.lstatSync(path.join(compilerDirectory, "rollup.linux-x64-gnu.node"), {
        throwIfNoEntry: false,
      }) ||
      !resolve("@rollup/rollup-linux-x64-gnu", compilerDirectory)
    ) {
      return false;
    }
    const svelteIssuer = path.join(moduleRoot, "@revolist", "svelte-output-target", "dist");
    return resolve("svelte", svelteIssuer, "svelte/compiler") !== null;
  } catch {
    return false;
  }
};
