import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findExportedValue } from "./find-exported-value.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasBoundedCssFormatterSkeleton } from "./has-bounded-css-formatter-skeleton.js";
import { hasBoundedGeneratedCssOutput } from "./has-bounded-generated-css-output.js";
import { hasPhysicalDataModuleStartup } from "./has-physical-data-module-startup.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceText } from "./parse-source-file.js";
import { readBoundedCssTokenInputs } from "./read-bounded-css-token-inputs.js";
import { readFlatNpmWorkspaceViteBuild } from "./read-flat-npm-workspace-vite-build.js";
import {
  readOwnedStaticDataModules,
  type StaticDataModule,
} from "./read-owned-static-data-modules.js";
import { readScopedCssFormatter } from "./read-scoped-css-formatter.js";
import { readStaticCssWriterModule } from "./read-static-css-writer-module.js";
import { readViteCssConfigStartup } from "./read-vite-css-config-startup.js";
import { readVite5Tailwind4StyleFence } from "./read-vite5-tailwind4-style-fence.js";
import { readViteLiteralLazyJsxRoute } from "./read-vite-literal-lazy-jsx-route.js";
import { readVitePlainCssRoots } from "./read-vite-plain-css-roots.js";
import type { RuleContext } from "./rule-context.js";
import { stockVite5CompilerProfile } from "./stock-vite5-compiler-profile.js";
import {
  readProviderMember,
  resolveStockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";

import { validateOwnedCssTokenValues } from "./validate-owned-css-token-values.js";

type Program = EsTreeNodeOfType<"Program">;
const LOCAL_MODULE = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.m?js$/u;
const JSX_PRAGMA = /@jsx(?:Runtime|ImportSource|Frag)?\b/u;
const FIXED_CONFIG_PROVIDERS = new Set([
  "node:fs",
  "node:url",
  "vite",
  "@vitejs/plugin-react",
  "@tailwindcss/vite",
]);

const stat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const readSource = (filename: string): string | null => {
  const info = stat(filename);
  if (!info?.isFile() || info.nlink !== 1 || info.size > 128 * 1024) return null;
  return readProviderMember(filename)?.toString("utf8") ?? null;
};

const readModule = (filename: string): Program | null => {
  const sourceText = readSource(filename);
  if (sourceText === null) return null;
  const program = parseSourceText({ filename, sourceText });
  return isNodeOfType(program, "Program") && program.sourceType === "module" ? program : null;
};

const getCssFactoryBinding = (program: Program, scopes: ScopeAnalysis) => {
  const config = findExportedValue(program, "default");
  const configValues = isNodeOfType(config, "CallExpression") ? config.arguments[0] : null;
  if (!isNodeOfType(configValues, "ObjectExpression")) return null;
  const plugins = configValues.properties.find(
    (entry) => isNodeOfType(entry, "Property") && getStaticPropertyKeyName(entry) === "plugins",
  );
  if (!isNodeOfType(plugins, "Property") || !isNodeOfType(plugins.value, "ArrayExpression")) {
    return null;
  }
  const first = plugins.value.elements[0];
  return isNodeOfType(first, "CallExpression") && isNodeOfType(first.callee, "Identifier")
    ? scopes.symbolFor(first.callee)
    : null;
};

const hasNoNestedPackage = (root: string, moduleFile: string): boolean => {
  for (
    let directory = path.dirname(moduleFile);
    directory !== root;
    directory = path.dirname(directory)
  ) {
    if (stat(path.join(directory, "package.json"))) return false;
  }
  return true;
};

const readTokenModules = (
  project: string,
  inputs: NonNullable<ReturnType<typeof readBoundedCssTokenInputs>>,
) => {
  const byFilename = new Map<string, StaticDataModule>();
  const read = (filename: string): StaticDataModule | null => {
    const prior = byFilename.get(filename);
    if (prior) return prior;
    if (
      byFilename.size >= 16 ||
      !isPathInside(filename, project) ||
      filename.split(path.sep).includes("node_modules") ||
      !hasNoNestedPackage(project, filename)
    )
      return null;
    const program = readModule(filename);
    if (!program) return null;
    const resolvedImports = new Map<string, StaticDataModule>();
    const module = { program, resolvedImports, scopes: analyzeScopes(program) };
    byFilename.set(filename, module);
    for (const statement of program.body) {
      if (!isNodeOfType(statement, "ImportDeclaration")) continue;
      const request = statement.source.value;
      if (
        typeof request !== "string" ||
        !request.startsWith("./") ||
        !LOCAL_MODULE.test(request.slice(2))
      )
        return null;
      const selected = read(path.resolve(path.dirname(filename), request));
      if (!selected) return null;
      resolvedImports.set(request, selected);
    }
    return module;
  };

  const selection = new Map<string, StaticDataModule>();
  for (const { property, relativeFile } of inputs) {
    if (!LOCAL_MODULE.test(relativeFile) || relativeFile.split("/").includes("node_modules"))
      return null;
    const module = read(path.join(project, relativeFile));
    if (!module) return null;
    selection.set(property, module);
  }
  const owners = readOwnedStaticDataModules([...selection.values()]);
  if (!owners) return null;
  return new Map([...selection].map(([key, module]) => [key, owners.get(module)!]));
};

const readBoundedCssOutput = (
  workspace: string,
  project: string,
  configFilename: string,
): string | null => {
  const configProgram = readModule(configFilename);
  if (!configProgram) return null;
  const configScopes = analyzeScopes(configProgram);
  const cssFactory = getCssFactoryBinding(configProgram, configScopes);
  if (!cssFactory) return null;
  const startup = readViteCssConfigStartup(configProgram, configScopes, cssFactory);
  if (!startup) return null;
  const writerRequest = startup.cssFactoryRequest.source;
  if (!writerRequest.startsWith("./") || !LOCAL_MODULE.test(writerRequest.slice(2))) return null;
  const writerFilename = path.resolve(project, writerRequest);
  if (
    path.dirname(path.dirname(writerFilename)) !== project ||
    !hasNoNestedPackage(project, writerFilename)
  )
    return null;
  const writerProgram = readModule(writerFilename);
  if (!writerProgram) return null;
  const writerScopes = analyzeScopes(writerProgram);
  const writer = readStaticCssWriterModule(writerProgram, writerScopes);
  if (
    !writer ||
    findExportedValue(writerProgram, startup.cssFactoryRequest.imported) !==
      writer.factory.declarationNode ||
    !hasBoundedGeneratedCssOutput({
      projectRoot: project,
      cssOutput: writer.outputRelativeFile,
      buildOverrides: startup.overrideRelativeFilename.slice(2),
    })
  )
    return null;
  const eager = startup.eagerModuleRequests.filter(
    (request) => request !== writerRequest && !FIXED_CONFIG_PROVIDERS.has(request),
  );
  if (
    eager.length > 0 &&
    !hasPhysicalDataModuleStartup({
      workspaceRoot: workspace,
      configFile: configFilename,
      requests: eager,
    })
  )
    return null;
  const inputs = readBoundedCssTokenInputs(writerProgram, writer, writerScopes);
  const formatter = readScopedCssFormatter(writer.formatter.declarationNode, writerScopes);
  const values = inputs && readTokenModules(project, inputs);
  if (
    !formatter ||
    !values ||
    !hasBoundedCssFormatterSkeleton(writer.formatter.declarationNode, writerScopes) ||
    !validateOwnedCssTokenValues(values, formatter.recordPaths, formatter.primitivePaths)
  )
    return null;
  return writer.outputRelativeFile;
};

const hasNoTypeScriptConfig = (filename: string): boolean => {
  for (let directory = path.dirname(filename); ; directory = path.dirname(directory)) {
    if (
      stat(path.join(directory, "tsconfig.json")) ||
      stat(path.join(directory, "jsconfig.json"))
    ) {
      return false;
    }
    if (path.dirname(directory) === directory) return true;
  }
};

const hasSelectedStylesheets = (
  workspace: string,
  project: string,
  localStylesheets: readonly string[],
): boolean => {
  const tailwind = stockVite5CompilerProfile.packages.find(({ name }) => name === "tailwindcss");
  if (!tailwind) return false;
  const cssDigest = tailwind.entryMembers["index.css"];
  if (!cssDigest) return false;
  return Boolean(
    readVite5Tailwind4StyleFence({
      appDirectory: project,
      aliases: [],
      localStylesheets,
      resolveStockTailwindStylesheet: (issuer) => {
        const selected = resolveStockPhysicalEntry({
          projectRoot: workspace,
          importerDirectory: path.dirname(issuer),
          specifier: "tailwindcss",
          profile: "vite-style",
          contract: {
            packageName: tailwind.name,
            version: tailwind.version,
            files: tailwind.entryMembers,
          },
        });
        return selected?.entry === path.join(workspace, tailwind.directory, "index.css")
          ? { filename: selected.entry, sha256: cssDigest }
          : null;
      },
    }),
  );
};

const hasSelectedReact = (
  workspace: string,
  route: NonNullable<ReturnType<typeof readViteLiteralLazyJsxRoute>>,
): boolean => {
  const react = stockVite5CompilerProfile.packages.find(({ name }) => name === "react");
  const reactDom = stockVite5CompilerProfile.packages.find(({ name }) => name === "react-dom");
  if (!react || !reactDom) return false;
  return [route.entryFile, route.appFile, route.lazyFile, route.focalFile].every((issuer) =>
    (
      [
        ["react", react],
        ["react/jsx-runtime", react],
        ["react-dom/client", reactDom],
      ] as const
    ).every(([specifier, expected]) => {
      const selection = resolveStockPhysicalEntry({
        projectRoot: workspace,
        importerDirectory: path.dirname(issuer),
        specifier,
        profile: "vite-production-import",
        contract: {
          packageName: expected.name,
          version: expected.version,
          files: expected.entryMembers,
        },
      });
      return selection?.packageDirectory === path.join(workspace, expected.directory);
    }),
  );
};

// Static recognition of an ordinary npm Vite build with default React JSX
// and a local, data-only generated stylesheet hook.
export const hasAutomaticStockViteCssJsx = (context: RuleContext): boolean => {
  const project = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (
    !project ||
    !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/u.test(project) ||
    !context.filename?.endsWith(".jsx")
  )
    return false;
  const workspace = path.dirname(project);
  const filename = path.resolve(project, context.filename);
  const sourceText = context.getSourceText?.();
  if (!isPathInside(filename, project) || !sourceText || JSX_PRAGMA.test(sourceText)) return false;
  try {
    if (readSource(filename) !== sourceText || !hasNoTypeScriptConfig(filename)) return false;
    const route = readViteLiteralLazyJsxRoute({
      projectDirectory: project,
      htmlFile: path.join(project, "index.html"),
      focalFile: filename,
      aliases: [],
    });
    if (!route) return false;
    const cssOutput = readBoundedCssOutput(
      workspace,
      project,
      path.join(project, "vite.config.js"),
    );
    if (!cssOutput) return false;
    const moduleFiles = [route.entryFile, route.appFile, route.lazyFile, route.focalFile];
    const routeModules = moduleFiles.flatMap((moduleFile) => {
      const program = readModule(moduleFile);
      return program ? [{ filename: moduleFile, program }] : [];
    });
    if (routeModules.length !== moduleFiles.length) return false;
    const css = readVitePlainCssRoots({
      appDirectory: project,
      entryFile: route.entryFile,
      routeModules,
    });
    if (!css?.localStylesheets.includes(path.join(project, cssOutput))) return false;
    const build = readFlatNpmWorkspaceViteBuild(workspace, project, stockVite5CompilerProfile);
    return Boolean(
      build?.npmDispatcherVerified &&
      hasSelectedReact(workspace, route) &&
      hasSelectedStylesheets(workspace, project, css.localStylesheets),
    );
  } catch {
    return false;
  }
};
