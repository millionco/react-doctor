import * as fs from "node:fs";
import * as path from "node:path";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingClass } from "./find-enclosing-class.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { collectJsxRuntimeImports } from "./non-react-jsx-dialect.js";
import {
  hasDirectStencilFactoryBinding,
  readDeclaredStencilLocalOutputFactory,
  readPhysicalStencilBuild,
} from "./read-declared-stencil-config.js";
import { readPhysicalImplicitJsxProgram } from "./read-physical-implicit-jsx-program.js";
import { hasVerifiedStockStencilCompiler } from "./read-verified-stock-stencil-compiler.js";
import type { RuleContext } from "./rule-context.js";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";

const SOURCE_PACKAGE = "@stencil/core";
const sourceSupportsStencil = new WeakMap<RuleContext, boolean>();
const LOCAL_FACTORY_EXTENSIONS = ["", ".js", ".cjs", ".mjs", ".ts", ".mts", ".cts", ".json"];

const supportsStencilBindings = (node: EsTreeNode, context: RuleContext): boolean => {
  const cached = sourceSupportsStencil.get(context);
  if (cached !== undefined) return cached;
  const source = context.getSourceText?.();
  const program = findProgramRoot(node);
  const supports = Boolean(
    source?.includes(SOURCE_PACKAGE) &&
    context.filename?.endsWith(".tsx") &&
    !source.includes("@jsx") &&
    isNodeOfType(program, "Program") &&
    !collectJsxRuntimeImports(program).hasReactRuntime,
  );
  sourceSupportsStencil.set(context, supports);
  return supports;
};

export const isStencilComponentJsx = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!supportsStencilBindings(node, context)) return false;
  const { scopes } = context;
  if (!hasDirectStencilFactoryBinding(node, "h", scopes)) return false;
  const ownerMethod = findEnclosingFunction(node)?.parent;
  if (
    !isNodeOfType(ownerMethod, "MethodDefinition") ||
    ownerMethod.static ||
    ownerMethod.kind !== "method"
  )
    return false;
  return (
    findEnclosingClass(node)?.decorators?.some(({ expression }) => {
      if (
        !isNodeOfType(expression, "CallExpression") ||
        !isNodeOfType(expression.callee, "Identifier")
      )
        return false;
      const symbol = scopes.symbolFor(expression.callee);
      return (
        symbol !== null &&
        symbol !== undefined &&
        getValueImportSource(symbol) === SOURCE_PACKAGE &&
        getImportedName(symbol.declarationNode) === "Component"
      );
    }) === true
  );
};

const readLocalFactorySource = (projectRoot: string, source: string): string | null => {
  const base = path.resolve(projectRoot, source);
  if (!isPathInside(base, projectRoot)) return null;
  const parent = path.dirname(base);
  const candidates = LOCAL_FACTORY_EXTENSIONS.map((ending) => base + ending).filter(
    (candidate) => fs.lstatSync(candidate, { throwIfNoEntry: false }) !== undefined,
  );
  const expected = base + ".ts";
  if (
    candidates.length !== 1 ||
    candidates[0] !== expected ||
    fs.realpathSync(expected) !== expected ||
    fs.lstatSync(path.join(parent, "node_modules"), { throwIfNoEntry: false }) ||
    fs.lstatSync(path.join(parent, "package.json"), { throwIfNoEntry: false })
  )
    return null;
  const bytes = readProviderMember(expected);
  return bytes && bytes.length <= 128 * 1024 ? bytes.toString("utf8") : null;
};

const validOutputPath = (root: string, relative: string): boolean => {
  const destination = path.resolve(root, relative);
  if (destination === root || !isPathInside(destination, root)) return false;
  for (let current = destination; current !== root; current = path.dirname(current)) {
    const info = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!info) continue;
    if (fs.realpathSync(current) !== current) return false;
    if (info.isDirectory()) continue;
    if (current !== destination || !info.isFile() || info.nlink !== 1) return false;
  }
  return true;
};

export const hasVerifiedStencilClassCompiler = (context: RuleContext): boolean => {
  const configuredRoot = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!context.filename || !configuredRoot || !path.isAbsolute(configuredRoot)) return false;
  const projectRoot = path.resolve(configuredRoot);
  const filename = path.resolve(projectRoot, context.filename);
  try {
    const selection = readPhysicalStencilBuild({ projectRoot, filename });
    if (!selection || !readPhysicalImplicitJsxProgram(context, filename)) return false;
    const rootOutputs = ["dist", "loader", "www", "hydrate", "vscode-data.json"];
    for (const target of selection.projection.builtinOutputTargets) {
      for (const key of ["dir", "file"]) {
        const destination = target[key];
        if (typeof destination === "string") rootOutputs.push(destination);
      }
    }
    for (const factory of selection.projection.outputFactories) {
      if (factory.deferredLocalOutputs) {
        const source = readLocalFactorySource(projectRoot, factory.module);
        if (!source || !readDeclaredStencilLocalOutputFactory(source, factory.exportedName))
          return false;
        rootOutputs.push(...factory.deferredLocalOutputs);
      } else {
        for (const key of [
          "proxiesFile",
          "directivesProxyFile",
          "directivesArrayFile",
          "outputDir",
        ]) {
          const destination = factory.arguments[key];
          if (typeof destination === "string") rootOutputs.push(destination);
        }
      }
    }
    return (
      rootOutputs.every((destination) => validOutputPath(projectRoot, destination)) &&
      hasVerifiedStockStencilCompiler(projectRoot, filename)
    );
  } catch {
    return false;
  }
};
