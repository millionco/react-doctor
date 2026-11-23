import * as fs from "node:fs";
import { isBuiltin } from "node:module";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import {
  buildSourceProjectIndex,
  readSelectedTypedSourceClosure,
} from "./build-source-project-index.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceText } from "./parse-source-file.js";
import { readDeclaredElectronRendererConfig } from "./read-declared-electron-renderer-config.js";
import { readProjectHtmlScripts } from "./read-project-html-scripts.js";
import { readVerifiedElectronRendererCompiler } from "./read-verified-electron-renderer-compiler.js";
import type { RuleContext } from "./rule-context.js";
import { createViteTypedRuntimeEdgeReader } from "./vite-typed-runtime-edges.js";

const JSX_PRAGMA = /@jsx(?:Runtime|ImportSource|Frag)?\b/u;
const DEFAULT_LAYER_ENTRY_EXTENSIONS = [".js", ".ts", ".mjs", ".cjs"];
const ELECTRON_IMAGE_ASSET = /\.(?:png|jpe?g|gif|svg|ico|webp)\?asset$/iu;
const MAX_DECLARED_CONFIG_BYTES = 128 * 1024;

const isPhysicalFile = (filename: string): boolean =>
  fs.lstatSync(filename, { throwIfNoEntry: false })?.isFile() === true &&
  fs.realpathSync(filename) === filename;

const readDefaultLayerEntry = (rootDirectory: string, layer: string): string | null => {
  const entries = DEFAULT_LAYER_ENTRY_EXTENSIONS.map((extension) =>
    path.join(rootDirectory, "src", layer, "index" + extension),
  ).filter((filename) => fs.lstatSync(filename, { throwIfNoEntry: false }) !== undefined);
  if (entries.length !== 1 || !isPhysicalFile(entries[0])) return null;
  return entries[0];
};

const hasUnresolvedReactValue = (context: RuleContext): boolean => {
  const pending = [context.scopes.rootScope];
  while (pending.length > 0) {
    const scope = pending.pop();
    if (!scope) break;
    if (
      scope.references.some(
        ({ identifier }) =>
          isNodeOfType(identifier, "Identifier") &&
          identifier.name === "React" &&
          context.scopes.isGlobalReference(identifier),
      )
    ) {
      return true;
    }
    pending.push(...scope.children);
  }
  return false;
};

export const hasAutomaticElectronRendererJsx = (context: RuleContext): boolean => {
  const configuredRoot = getReactDoctorStringSetting(context.settings, "rootDirectory");
  if (!context.filename?.endsWith(".jsx") || !configuredRoot || !path.isAbsolute(configuredRoot))
    return false;
  const rootDirectory = path.resolve(configuredRoot);
  const rendererDirectory = path.join(rootDirectory, "src", "renderer");
  const filename = path.resolve(rootDirectory, context.filename);
  if (!isPathInside(filename, rendererDirectory)) return false;

  try {
    const configPath = path.join(rootDirectory, "electron.vite.config.mjs");
    if (
      !isPhysicalFile(configPath) ||
      fs.statSync(configPath).size > MAX_DECLARED_CONFIG_BYTES ||
      !isPhysicalFile(filename)
    ) {
      return false;
    }
    const sourceText = context.getSourceText?.();
    const program = context.scopes.rootScope.node;
    if (
      sourceText === undefined ||
      !isNodeOfType(program, "Program") ||
      JSX_PRAGMA.test(sourceText) ||
      sourceText !== fs.readFileSync(filename, "utf8") ||
      hasUnresolvedReactValue(context)
    ) {
      return false;
    }
    const config = parseSourceText({
      filename: configPath,
      sourceText: fs.readFileSync(configPath, "utf8"),
    });
    if (!isNodeOfType(config, "Program")) return false;
    const declared = readDeclaredElectronRendererConfig(config, analyzeScopes(config));
    if (!declared) return false;

    const htmlPath = path.join(rendererDirectory, "index.html");
    if (!isPhysicalFile(htmlPath)) return false;
    const scripts = readProjectHtmlScripts(rendererDirectory, htmlPath, {
      onlyLocalModuleScripts: true,
    });
    if (!scripts || scripts.inlinePrograms.length > 0 || scripts.localEntrypoints.length !== 1) {
      return false;
    }
    const mainEntry = readDefaultLayerEntry(rootDirectory, "main");
    const preloadEntry = readDefaultLayerEntry(rootDirectory, "preload");
    if (!mainEntry || !preloadEntry) return false;

    const alias = declared.rendererSourceAlias;
    const rendererEdges = createViteTypedRuntimeEdgeReader({
      projectDirectory: rendererDirectory,
      aliases: alias
        ? [{ find: alias.find, replacement: path.join(rootDirectory, alias.relativeReplacement) }]
        : [],
      defaultJsonModuleEmitter: false,
    });
    const otherLayerEdges = createViteTypedRuntimeEdgeReader({
      projectDirectory: rootDirectory,
      aliases: [],
      defaultJsonModuleEmitter: false,
    });
    const indexInput = {
      rootDirectory: path.join(rootDirectory, "src"),
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
      includeTestlikeSources: true,
    };
    const rendererIndex = buildSourceProjectIndex({
      ...indexInput,
      readTypedRuntimeEdge: rendererEdges,
    });
    if (!rendererIndex) return false;
    const rendered = readSelectedTypedSourceClosure(rendererIndex, scripts.localEntrypoints);
    if (!rendered?.reachable.has(filename)) return false;

    const desktopIndex = buildSourceProjectIndex({
      ...indexInput,
      rootDirectory,
      readTypedRuntimeEdge: (module, node, source) => {
        if (source && isBuiltin(source)) return { kind: "external" };
        if (source && /^\.{1,2}\//u.test(source) && ELECTRON_IMAGE_ASSET.test(source)) {
          const asset = path.resolve(
            path.dirname(module.filePath),
            source.slice(0, -"?asset".length),
          );
          if (isPathInside(asset, rootDirectory) && isPhysicalFile(asset))
            return { kind: "data", filenames: [asset] };
          return { kind: "opaque" };
        }
        return otherLayerEdges(module, node, source);
      },
    });
    if (!desktopIndex) return false;
    const otherLayers = readSelectedTypedSourceClosure(desktopIndex, [mainEntry, preloadEntry]);
    if (!otherLayers || otherLayers.opaqueIssuers.size > 0 || otherLayers.reachable.has(filename)) {
      return false;
    }
    return Boolean(
      readVerifiedElectronRendererCompiler({
        projectRoot: rootDirectory,
        filename,
        configFile: configPath,
      }),
    );
  } catch {
    return false;
  }
};
