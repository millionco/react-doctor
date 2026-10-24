import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { isBuiltin } from "node:module";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  WEBPACK_ALIAS_CONFIG_MAX_FILE_COUNT,
  WEBPACK_ALIAS_CONFIG_MAX_DEPTH_COUNT,
  WEBPACK_ALIAS_COMMAND_MAX_TOKEN_COUNT,
  WEBPACK_ALIAS_SINGLE_VALUE_COUNT,
  WEBPACK_ALIAS_SUPPORTED_EXTENSIONS,
  WEBPACK_ALIAS_FORBIDDEN_MEMBER_NAMES,
  WEBPACK_ALIAS_UNSUPPORTED_MANIFEST_FIELDS,
  WEBPACK_ALIAS_SUPPORTED_MAJOR_VERSION,
  WEBPACK_ALIAS_MERGE_MAJOR_VERSION,
  WEBPACK_ALIAS_MIN_MERGE_ARGUMENT_COUNT,
  WEBPACK_ALIAS_MAX_NAME_SEGMENT_COUNT,
  WEBPACK_ALIAS_ALLOWED_GLOBAL_NAMES,
  WEBPACK_ALIAS_ALLOWED_BUILTIN_SOURCES,
} from "./constants.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isPathInside } from "./is-path-inside.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parsePackageVersion } from "./parse-package-version.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";
import { walkAst } from "./walk-ast.js";

export interface WebpackAliasResolution {
  readonly declared: boolean;
  readonly filePath: string | null;
}

export interface WebpackAliasResolutionOptions {
  readonly profile?: "all-scripts" | "build-script";
}

interface WebpackAliasProfile {
  readonly aliases: Map<string, string>;
  readonly extensions: readonly string[] | null;
}

interface WebpackConfigModule {
  readonly filename: string;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly consumedReferences: Set<EsTreeNode>;
  readonly selectedSymbols: Set<SymbolDescriptor>;
  readonly pathSymbols: Set<SymbolDescriptor>;
  readonly mergeSymbols: Set<SymbolDescriptor>;
  readonly exportAssignment: EsTreeNode;
}

interface WebpackConfigEnvironment {
  readonly packageDirectory: string;
  readonly manifest: PackageManifest;
  readonly modules: Map<string, WebpackConfigModule>;
  readonly activeFiles: Set<string>;
}

const literalString = (node: EsTreeNode | null | undefined): string | null =>
  node && isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const memberName = (node: EsTreeNode | null | undefined): string | null =>
  node && isNodeOfType(node, "MemberExpression") && !node.computed && !node.optional
    ? getStaticPropertyKeyName(node)
    : null;

const isGlobal = (node: EsTreeNode, name: string, module: WebpackConfigModule): boolean =>
  isNodeOfType(node, "Identifier") && node.name === name && module.scopes.isGlobalReference(node);

const readonlyConst = (node: EsTreeNode, module: WebpackConfigModule): SymbolDescriptor | null => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(node);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    isErasedTypeScriptBinding(symbol) ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    symbol.declarationNode.range[1] > node.range[0] ||
    !isNodeOfType(symbol.declarationNode.parent, "VariableDeclaration") ||
    symbol.declarationNode.parent.parent !== module.program ||
    !hasCompleteSymbolReferences(symbol, module.program, module.scopes) ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return null;
  return symbol;
};

const requireSource = (node: EsTreeNode, module: WebpackConfigModule): string | null => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== WEBPACK_ALIAS_SINGLE_VALUE_COUNT ||
    !isGlobal(node.callee, "require", module)
  )
    return null;
  const source = literalString(node.arguments.at(0));
  return source && (!isBuiltin(source) || WEBPACK_ALIAS_ALLOWED_BUILTIN_SOURCES.has(source))
    ? source
    : null;
};

const hasOrdinaryDependency = (
  manifest: PackageManifest,
  name: string,
  major?: number,
): boolean => {
  if (!/^(?:@[A-Za-z\d][A-Za-z\d._-]*\/)?[A-Za-z\d][A-Za-z\d._-]*$/.test(name)) return false;
  const declarations = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].flatMap((dependencies) => (dependencies && name in dependencies ? [dependencies[name]] : []));
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      if (typeof declaration !== "string") return false;
      const version = parsePackageVersion(declaration.trim().replace(/^[~^]/, ""));
      return Boolean(
        version && !version.isPrerelease && (major === undefined || version.major === major),
      );
    })
  );
};

const commandConfig = (command: string, manifest: PackageManifest): string | null => {
  if (!command || /["'`\\;$|&<>()\n\r]/.test(command)) return null;
  const tokens = command.trim().split(/\s+/);
  if (tokens.length > WEBPACK_ALIAS_COMMAND_MAX_TOKEN_COUNT) return null;
  if (tokens.at(0) === "cross-env") {
    if (!hasOrdinaryDependency(manifest, "cross-env")) return null;
    tokens.shift();
    if (!/^NODE_ENV=(?:development|production|test)$/.test(tokens.shift() ?? "")) return null;
  }
  const executable = tokens.shift();
  if (executable !== "webpack" && executable !== "webpack-dev-server") return null;
  if (executable === "webpack-dev-server" && !hasOrdinaryDependency(manifest, executable))
    return null;
  let config: string | null = null;
  while (tokens.length) {
    const token = tokens.shift();
    if (token === "--progress") continue;
    const candidate =
      token === "--config"
        ? tokens.shift()
        : token?.startsWith("--config=")
          ? token.slice("--config=".length)
          : null;
    if (!candidate || config || !candidate.startsWith("./") || !/\.(?:js|cjs)$/.test(candidate))
      return null;
    config = candidate;
  }
  return config;
};

const existingFile = (filename: string): boolean => {
  recordExistenceProbe(filename);
  try {
    return Boolean(fs.statSync(filename, { throwIfNoEntry: false })?.isFile());
  } catch {
    return false;
  }
};

const resolveConfigFile = (filename: string): string | null => {
  if (existingFile(filename)) return /\.(?:js|cjs)$/.test(filename) ? filename : null;
  return existingFile(`${filename}.js`) ? `${filename}.js` : null;
};

const isExportAssignment = (
  node: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "AssignmentExpression") &&
  node.operator === "=" &&
  isNodeOfType(node.parent, "ExpressionStatement") &&
  node.parent.parent === program &&
  isNodeOfType(node.left, "MemberExpression") &&
  !node.left.computed &&
  !node.left.optional &&
  getStaticPropertyKeyName(node.left) === "exports" &&
  isNodeOfType(node.left.object, "Identifier") &&
  node.left.object.name === "module" &&
  scopes.isGlobalReference(node.left.object);

const readConfigModule = (filename: string): WebpackConfigModule | null => {
  const program = parseSourceFile(filename);
  if (!program) return null;
  const scopes = analyzeScopes(program);
  if (
    !isNodeOfType(program, "Program") ||
    program.body.some(
      (statement) =>
        !(isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") &&
        !(
          isNodeOfType(statement, "ExpressionStatement") &&
          (isExportAssignment(statement.expression, program, scopes) ||
            typeof statement.directive === "string")
        ),
    )
  )
    return null;
  const exports: EsTreeNode[] = [];
  walkAst(program, (node) => {
    if (isExportAssignment(node, program, scopes)) exports.push(node);
  });
  if (exports.length !== WEBPACK_ALIAS_SINGLE_VALUE_COUNT) return null;
  const exportAssignment = exports.at(0);
  if (!exportAssignment) return null;
  return {
    filename,
    program,
    scopes,
    exportAssignment,
    consumedReferences: new Set(),
    selectedSymbols: new Set(),
    pathSymbols: new Set(),
    mergeSymbols: new Set(),
  };
};

const resolvePathValue = (node: EsTreeNode, module: WebpackConfigModule): string | null => {
  const value = literalString(node);
  if (value && path.isAbsolute(value)) return value;
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    memberName(node.callee) !== "resolve" ||
    !isNodeOfType(node.callee.object, "Identifier")
  )
    return null;
  const symbol = readonlyConst(node.callee.object, module);
  const source = symbol?.initializer ? requireSource(symbol.initializer, module) : null;
  if (!symbol || (source !== "path" && source !== "node:path")) return null;
  const [directory, ...segments] = node.arguments;
  if (!directory || !isGlobal(directory, "__dirname", module)) return null;
  const strings = segments.map(literalString);
  if (strings.some((segment) => segment === null)) return null;
  module.pathSymbols.add(symbol);
  return path.resolve(
    path.dirname(module.filename),
    ...strings.filter((segment): segment is string => segment !== null),
  );
};

const objectProfile = (
  node: EsTreeNode,
  module: WebpackConfigModule,
): WebpackAliasProfile | null => {
  const properties = getOwnDataObjectProperties(node);
  if (!properties || properties.has("default") || properties.has("then")) return null;
  const resolve = properties.get("resolve");
  if (!resolve) return { aliases: new Map(), extensions: null };
  const resolution = getOwnDataObjectProperties(resolve);
  if (
    !resolution ||
    [...resolution.keys()].some((name) => name !== "alias" && name !== "extensions")
  )
    return null;
  const aliases = new Map<string, string>();
  const aliasNode = resolution.get("alias");
  if (aliasNode) {
    const entries = getOwnDataObjectProperties(aliasNode);
    if (!entries) return null;
    for (const [name, targetNode] of entries) {
      if (
        !/^[A-Za-z_@][A-Za-z_\d@/.-]*\$?$/.test(name) ||
        name.endsWith("/") ||
        name.includes("..") ||
        name.split("/").length > WEBPACK_ALIAS_MAX_NAME_SEGMENT_COUNT
      )
        return null;
      const target = resolvePathValue(targetNode, module);
      if (!target) return null;
      aliases.set(name, target);
    }
  }
  const extensionsNode = resolution.get("extensions");
  let extensions: string[] | null = null;
  if (extensionsNode) {
    if (!isNodeOfType(extensionsNode, "ArrayExpression")) return null;
    const configuredExtensions = new Set<string>();
    for (const element of extensionsNode.elements) {
      const extension = literalString(element);
      if (
        !extension ||
        !WEBPACK_ALIAS_SUPPORTED_EXTENSIONS.has(extension) ||
        configuredExtensions.has(extension)
      )
        return null;
      configuredExtensions.add(extension);
    }
    if (!configuredExtensions.size) return null;
    extensions = [...configuredExtensions];
  }
  return { aliases, extensions };
};

const mergeProfiles = (profiles: readonly WebpackAliasProfile[]): WebpackAliasProfile | null => {
  const aliases = new Map<string, string>();
  let extensions: readonly string[] | null = null;
  for (const profile of profiles) {
    if (profile.extensions) {
      if (extensions) return null;
      extensions = profile.extensions;
    }
    for (const [name, target] of profile.aliases) {
      if (aliases.has(name)) return null;
      aliases.set(name, target);
    }
  }
  const normalizedAliasNames = new Set([...aliases.keys()].map((name) => name.replace(/\$$/, "")));
  if (normalizedAliasNames.size !== aliases.size) return null;
  for (const aliasName of normalizedAliasNames) {
    let separatorIndex = aliasName.indexOf("/");
    while (separatorIndex !== -1) {
      if (normalizedAliasNames.has(aliasName.slice(0, separatorIndex))) return null;
      separatorIndex = aliasName.indexOf("/", separatorIndex + 1);
    }
  }
  return { aliases, extensions };
};

const readProfileValue = (
  node: EsTreeNode,
  module: WebpackConfigModule,
  environment: WebpackConfigEnvironment,
  depth: number,
): WebpackAliasProfile | null => {
  if (depth >= WEBPACK_ALIAS_CONFIG_MAX_DEPTH_COUNT) return null;
  if (isNodeOfType(node, "ObjectExpression")) return objectProfile(node, module);
  if (isNodeOfType(node, "Identifier")) {
    const symbol = readonlyConst(node, module);
    if (!symbol?.initializer || module.selectedSymbols.has(symbol)) return null;
    module.selectedSymbols.add(symbol);
    module.consumedReferences.add(node);
    const source = requireSource(symbol.initializer, module);
    if (source) {
      if (!source.startsWith("./") && !source.startsWith("../")) return null;
      const filename = resolveConfigFile(path.resolve(path.dirname(module.filename), source));
      return filename
        ? readConfigProfile(filename, environment, depth + WEBPACK_ALIAS_SINGLE_VALUE_COUNT)
        : null;
    }
    return readProfileValue(
      symbol.initializer,
      module,
      environment,
      depth + WEBPACK_ALIAS_SINGLE_VALUE_COUNT,
    );
  }
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier") ||
    node.arguments.length < WEBPACK_ALIAS_MIN_MERGE_ARGUMENT_COUNT
  )
    return null;
  const merge = readonlyConst(node.callee, module);
  if (!merge?.initializer || requireSource(merge.initializer, module) !== "webpack-merge")
    return null;
  module.mergeSymbols.add(merge);
  const profiles: WebpackAliasProfile[] = [];
  for (const argument of node.arguments) {
    const profile = readProfileValue(
      argument,
      module,
      environment,
      depth + WEBPACK_ALIAS_SINGLE_VALUE_COUNT,
    );
    if (!profile) return null;
    profiles.push(profile);
  }
  return mergeProfiles(profiles);
};

const isMetadataComparison = (node: EsTreeNode): boolean => {
  let current = node;
  while (
    isNodeOfType(current.parent, "MemberExpression") &&
    current.parent.object === current &&
    memberName(current.parent)
  )
    current = current.parent;
  return (
    current !== node &&
    isNodeOfType(current.parent, "BinaryExpression") &&
    !isWithinAssignmentTarget(node)
  );
};

const hasClosedModuleSurface = (
  module: WebpackConfigModule,
  environment: WebpackConfigEnvironment,
): boolean => {
  let closed = true;
  walkAst(module.program, (node) => {
    if (!closed) return false;
    const required = requireSource(node, module);
    if (
      required &&
      !required.startsWith("./") &&
      !required.startsWith("../") &&
      !isBuiltin(required)
    ) {
      const packageName = required.match(/^(?<packageName>@[^/]+\/[^/]+|[^/]+)/)?.groups
        ?.packageName;
      if (
        !packageName ||
        !hasOrdinaryDependency(environment.manifest, packageName) ||
        required
          .split("/")
          .some(
            (segment) => segment === "." || segment === ".." || !/^[A-Za-z\d@._-]+$/.test(segment),
          )
      ) {
        closed = false;
        return false;
      }
    }
    if (required && (required.startsWith("./") || required.startsWith("../"))) {
      const declaration = node.parent;
      const symbol =
        isNodeOfType(declaration, "VariableDeclarator") &&
        declaration.init === node &&
        isNodeOfType(declaration.id, "Identifier")
          ? module.scopes.symbolFor(declaration.id)
          : null;
      if (!symbol || !module.selectedSymbols.has(symbol)) {
        closed = false;
        return false;
      }
    }
    if (
      (isNodeOfType(node, "AssignmentExpression") && node !== module.exportAssignment) ||
      isNodeOfType(node, "UpdateExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "CatchClause") ||
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") ||
      (isNodeOfType(node, "Property") &&
        (node.computed ||
          node.kind !== "init" ||
          node.method ||
          WEBPACK_ALIAS_FORBIDDEN_MEMBER_NAMES.has(getStaticPropertyKeyName(node) ?? ""))) ||
      (isNodeOfType(node, "MemberExpression") &&
        (node.computed || WEBPACK_ALIAS_FORBIDDEN_MEMBER_NAMES.has(memberName(node) ?? "")))
    ) {
      closed = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    const symbol = module.scopes.symbolFor(node);
    if (symbol && isErasedTypeScriptBinding(symbol)) {
      closed = false;
      return;
    }
    if (!module.scopes.isGlobalReference(node)) return;
    if (!WEBPACK_ALIAS_ALLOWED_GLOBAL_NAMES.has(node.name)) {
      closed = false;
      return;
    }
    const parent = node.parent;
    if (node.name === "module") {
      closed =
        isNodeOfType(module.exportAssignment, "AssignmentExpression") &&
        isNodeOfType(module.exportAssignment.left, "MemberExpression") &&
        module.exportAssignment.left.object === node;
      return;
    }
    if (node.name === "require") {
      closed = Boolean(
        (isNodeOfType(parent, "CallExpression") &&
          parent.callee === node &&
          requireSource(parent, module)) ||
        (isNodeOfType(parent, "MemberExpression") &&
          parent.object === node &&
          memberName(parent) === "resolve" &&
          isNodeOfType(parent.parent, "CallExpression") &&
          parent.parent.callee === parent &&
          !parent.parent.optional &&
          parent.parent.arguments.length === WEBPACK_ALIAS_SINGLE_VALUE_COUNT &&
          literalString(parent.parent.arguments.at(0))),
      );
      return;
    }
    if (node.name === "process") {
      closed = Boolean(
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === node &&
        memberName(parent) === "env" &&
        isNodeOfType(parent.parent, "MemberExpression") &&
        parent.parent.object === parent &&
        memberName(parent.parent) === "NODE_ENV" &&
        !isWithinAssignmentTarget(parent.parent),
      );
      return;
    }
    if (node.name === "__dirname") {
      closed = Boolean(
        isNodeOfType(parent, "CallExpression") &&
        parent.arguments.at(0) === node &&
        resolvePathValue(parent, module),
      );
    }
  });
  if (!closed) return false;
  for (const symbol of module.selectedSymbols) {
    if (
      symbol.references.some(
        (reference) =>
          !isNonReferenceIdentifier(reference.identifier) &&
          !module.consumedReferences.has(reference.identifier) &&
          !isMetadataComparison(reference.identifier),
      )
    )
      return false;
  }
  for (const symbol of module.mergeSymbols) {
    if (
      !symbol.references.every(
        (reference) =>
          isNonReferenceIdentifier(reference.identifier) ||
          (isNodeOfType(reference.identifier.parent, "CallExpression") &&
            reference.identifier.parent.callee === reference.identifier &&
            !reference.identifier.parent.optional),
      )
    )
      return false;
  }
  for (const symbol of module.pathSymbols) {
    if (
      !symbol.references.every((reference) => {
        const member = reference.identifier.parent;
        return (
          isNonReferenceIdentifier(reference.identifier) ||
          Boolean(
            isNodeOfType(member, "MemberExpression") &&
            member.object === reference.identifier &&
            memberName(member) === "resolve" &&
            isNodeOfType(member.parent, "CallExpression") &&
            member.parent.callee === member &&
            resolvePathValue(member.parent, module),
          )
        );
      })
    )
      return false;
  }
  return true;
};

const readConfigProfile = (
  filename: string,
  environment: WebpackConfigEnvironment,
  depth: number,
): WebpackAliasProfile | null => {
  if (
    !isPathInside(filename, environment.packageDirectory) ||
    environment.activeFiles.has(filename) ||
    environment.modules.size >= WEBPACK_ALIAS_CONFIG_MAX_FILE_COUNT ||
    depth >= WEBPACK_ALIAS_CONFIG_MAX_DEPTH_COUNT ||
    findNearestPackageDirectory(filename) !== environment.packageDirectory
  )
    return null;
  const module = readConfigModule(filename);
  if (!module || !isNodeOfType(module.exportAssignment, "AssignmentExpression")) return null;
  environment.modules.set(filename, module);
  environment.activeFiles.add(filename);
  const profile = readProfileValue(module.exportAssignment.right, module, environment, depth);
  environment.activeFiles.delete(filename);
  return profile && hasClosedModuleSurface(module, environment) ? profile : null;
};

const resolveAliasedFile = (target: string, extensions: readonly string[]): string | null => {
  if (existingFile(target)) return target;
  for (const extension of extensions)
    if (existingFile(`${target}${extension}`)) return `${target}${extension}`;
  const packageJson = path.join(target, "package.json");
  if (existingFile(packageJson)) return null;
  for (const extension of extensions) {
    const filename = path.join(target, `index${extension}`);
    if (existingFile(filename)) return filename;
  }
  return null;
};

export const resolveWebpackAliasPath = (
  fromFilename: string,
  source: string,
  options: WebpackAliasResolutionOptions = {},
): WebpackAliasResolution | null => {
  const packageDirectory = findNearestPackageDirectory(fromFilename);
  if (!packageDirectory || source.startsWith(".") || path.isAbsolute(source)) return null;
  const manifest = readPackageManifest(packageDirectory);
  if (
    !manifest ||
    Array.isArray(manifest) ||
    [
      manifest.scripts,
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].some(
      (group) =>
        group !== undefined &&
        (typeof group !== "object" || group === null || Array.isArray(group)),
    ) ||
    WEBPACK_ALIAS_UNSUPPORTED_MANIFEST_FIELDS.some((field) => field in manifest) ||
    ("type" in manifest && manifest.type !== "commonjs") ||
    !hasOrdinaryDependency(manifest, "webpack", WEBPACK_ALIAS_SUPPORTED_MAJOR_VERSION) ||
    !hasOrdinaryDependency(manifest, "webpack-merge", WEBPACK_ALIAS_MERGE_MAJOR_VERSION)
  )
    return null;
  const lifecycleNames =
    options.profile === "build-script"
      ? ["prebuild", "postbuild"]
      : ["prebuild", "postbuild", "prestart", "poststart"];
  if (lifecycleNames.some((name) => name in (manifest.scripts ?? {}))) return null;
  const commands = (
    options.profile === "build-script"
      ? [manifest.scripts?.build]
      : [manifest.scripts?.build, manifest.scripts?.start]
  ).filter((command) => command !== undefined);
  if (!commands.length || commands.some((command) => typeof command !== "string")) return null;
  const profiles: WebpackAliasProfile[] = [];
  for (const command of commands) {
    if (typeof command !== "string") return null;
    const relativeConfig = commandConfig(command, manifest);
    if (!relativeConfig) return null;
    const filename = resolveConfigFile(path.resolve(packageDirectory, relativeConfig));
    if (!filename) return null;
    const environment: WebpackConfigEnvironment = {
      packageDirectory,
      manifest,
      modules: new Map(),
      activeFiles: new Set(),
    };
    const profile = readConfigProfile(filename, environment, 0);
    if (!profile?.extensions) return null;
    profiles.push(profile);
  }
  const [profile] = profiles;
  if (
    !profile?.extensions ||
    profiles.some(
      (other) =>
        JSON.stringify([...other.aliases]) !== JSON.stringify([...profile.aliases]) ||
        JSON.stringify(other.extensions) !== JSON.stringify(profile.extensions),
    )
  )
    return null;
  for (const [name, target] of profile.aliases) {
    const exact = name.endsWith("$");
    const prefix = exact ? name.slice(0, -"$".length) : name;
    const unsupportedSuffix = ["!", "?", "#", "\\"].some((separator) =>
      source.startsWith(`${prefix}${separator}`),
    );
    if (source !== prefix && (exact || !source.startsWith(`${prefix}/`)) && !unsupportedSuffix)
      continue;
    if (/[!?#\\]/.test(source)) return { declared: true, filePath: null };
    const suffix = source.slice(prefix.length);
    if (suffix.split("/").some((segment) => segment === ".." || segment === "."))
      return { declared: true, filePath: null };
    const filePath = resolveAliasedFile(`${target}${suffix}`, profile.extensions);
    return {
      declared: true,
      filePath:
        filePath && findNearestPackageDirectory(filePath) === packageDirectory ? filePath : null,
    };
  }
  return { declared: false, filePath: null };
};
