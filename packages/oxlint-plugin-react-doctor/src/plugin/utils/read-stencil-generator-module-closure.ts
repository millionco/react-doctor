import { analyzeScopes } from "../semantic/scope-analysis.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import {
  readDeclaredGeneratedStencilConfig,
  type DeclaredGeneratedStencilConfig,
} from "./read-declared-stencil-config.js";
import {
  hasInertStencilHookModuleInitialization,
  hasLiteralSassExtensionGuard,
  hasOnlyStencilConfigRootDirectoryReads,
  hasReadOnlyStencilConfigGuardValidator,
  readStencilCssDelegateContextEffects,
  readStencilCssTransformContextEffects,
  readStencilCssTransformEntry,
  readStencilPreEmitOutputValidator,
  type StencilCssContextEffects,
} from "./read-stencil-pre-emit-hooks.js";
import { walkAst } from "./walk-ast.js";

export type StockStencilGeneratorProvider =
  | "rollup-node-externals"
  | "stencil-react-output-generator"
  | "stencil-react-output-validator"
  | "stencil-react-output-utils"
  | "stencil-vue-output-generator"
  | "stencil-vue-output-validator"
  | "sass"
  | "lightningcss";

export type StencilGeneratorImport =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "builtin"; readonly name: "node:path" }
  | {
      readonly kind: "stock";
      readonly path: string;
      readonly provider: StockStencilGeneratorProvider;
    };

export interface StencilGeneratorImportEdge {
  readonly issuer: string;
  readonly request: string;
  readonly imported: string;
  readonly target: StencilGeneratorImport;
}

export interface StencilGeneratorModuleClosure {
  readonly config: DeclaredGeneratedStencilConfig;
  readonly localModules: readonly string[];
  readonly edges: readonly StencilGeneratorImportEdge[];
  readonly styleContextEffects: StencilCssContextEffects;
  readonly styleDelegateEffects: readonly StencilCssContextEffects[];
  readonly requiresTypeScriptImportElision: boolean;
}

interface RuntimeModuleImport {
  readonly request: string;
  readonly imported: string;
}

interface RuntimeModuleImports {
  readonly imports: readonly RuntimeModuleImport[];
  readonly requiresTypeScriptImportElision: boolean;
}

const MAX_SOURCE_LENGTH = 128 * 1024;
const MAX_LOCAL_MODULES = 16;
const MAX_IMPORTS = 48;

const stockProvider = (request: string, imported: string): StockStencilGeneratorProvider | null => {
  switch (request) {
    case "rollup-plugin-node-externals":
      return imported === "default" ? "rollup-node-externals" : null;
    case "@stencil/react-output-target/dist/output-react":
      return imported === "generateProxies" ? "stencil-react-output-generator" : null;
    case "@stencil/react-output-target/dist/plugin":
      return imported === "normalizeOutputTarget" ? "stencil-react-output-validator" : null;
    case "@stencil/react-output-target/dist/utils":
      return ["dashToPascalCase", "normalizePath", "relativeImport", "sortBy"].includes(imported)
        ? "stencil-react-output-utils"
        : null;
    case "@stencil/vue-output-target/dist/output-vue":
      return imported === "generateProxies" ? "stencil-vue-output-generator" : null;
    case "@stencil/vue-output-target/dist/plugin":
      return imported === "normalizeOutputTarget" ? "stencil-vue-output-validator" : null;
    case "sass":
      return imported === "render" ? "sass" : null;
    case "lightningcss":
      return imported === "Features" || imported === "transform" ? "lightningcss" : null;
    default:
      return null;
  }
};

const readRuntimeModuleImports = (sourceText: string): RuntimeModuleImports | null => {
  if (sourceText.length > MAX_SOURCE_LENGTH) return null;
  const program = parseSourceText({ filename: "stencil-config-member.ts", sourceText });
  if (!isNodeOfType(program, "Program")) return null;
  const scopes = analyzeScopes(program);
  // Keep the language used for config-generation modules within ordinary ESM
  // and erasable TypeScript. Runtime loaders can add untracked eager imports.
  let unsupportedRuntime = false;
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      (isNodeOfType(node, "Identifier") &&
        ["require", "module", "exports", "eval"].includes(node.name) &&
        scopes.isGlobalReference(node))
    ) {
      unsupportedRuntime = true;
    }
    if (unsupportedRuntime) return false;
  });
  if (unsupportedRuntime) return null;
  const imports: RuntimeModuleImport[] = [];
  let requiresTypeScriptImportElision = false;
  for (const statement of program.body) {
    if (
      isNodeOfType(statement, "ExportAllDeclaration") ||
      (isNodeOfType(statement, "ExportNamedDeclaration") && statement.source)
    )
      return null;
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    const request = statement.source.value;
    if (typeof request !== "string" || statement.attributes?.length || !statement.specifiers.length)
      return null;
    for (const specifier of statement.specifiers) {
      const symbol = scopes.symbolFor(specifier.local);
      if (!symbol) return null;
      const explicitType =
        statement.importKind === "type" ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type");
      // The first-party scope analyzer tracks value references and skips
      // ordinary annotations and type arguments.
      if (explicitType && symbol.references.length) return null;
      if (!symbol.references.length) {
        if (statement.importKind !== "type") requiresTypeScriptImportElision = true;
        continue;
      }
      if (!symbol.references.every((reference) => reference.flag === "read")) return null;
      const imported = isNodeOfType(specifier, "ImportDefaultSpecifier")
        ? "default"
        : isNodeOfType(specifier, "ImportNamespaceSpecifier")
          ? "*"
          : getImportedName(specifier);
      if (!imported) return null;
      imports.push({ request, imported });
    }
  }
  return { imports, requiresTypeScriptImportElision };
};

const isExpectedResolution = (
  request: string,
  imported: string,
  target: StencilGeneratorImport,
): boolean => {
  if (/^\.\/[\w-]+(?:\/[\w-]+)*$/u.test(request)) return target.kind === "local";
  if (request === "path" || request === "node:path") {
    return target.kind === "builtin" && target.name === "node:path" && imported === "*";
  }
  return target.kind === "stock" && target.provider === stockProvider(request, imported);
};

type ReadModule = (path: string) => string | null;
type ResolveImport = (
  issuerPath: string,
  request: string,
  imported: string,
) => StencilGeneratorImport | null;

// The caller supplies physically resolved identities, including exact stock
// member bytes, and checks the generator's TypeScript import-elision policy.
export const readStencilGeneratorModuleClosure = (
  entryPath: string,
  readModule: ReadModule,
  resolveImport: ResolveImport,
): StencilGeneratorModuleClosure | null => {
  const configSource = readModule(entryPath);
  const config = configSource === null ? null : readDeclaredGeneratedStencilConfig(configSource);
  if (!config || configSource === null) return null;
  const localModules = new Map([[entryPath, configSource]]);
  const edges: StencilGeneratorImportEdge[] = [];
  const finished = new Set<string>();
  const active = new Set<string>();
  let requiresTypeScriptImportElision = false;

  const visit = (issuer: string, text: string): boolean => {
    if (finished.has(issuer)) return true;
    if (active.has(issuer)) return false;
    active.add(issuer);
    const recorded = readRuntimeModuleImports(text);
    if (!recorded) return false;
    requiresTypeScriptImportElision ||= recorded.requiresTypeScriptImportElision;
    const moduleTargets = new Map<string, StencilGeneratorImport>();
    for (const { request, imported } of recorded.imports) {
      if (edges.length >= MAX_IMPORTS) return false;
      const target = resolveImport(issuer, request, imported);
      if (!target || !isExpectedResolution(request, imported, target)) return false;
      const previous = moduleTargets.get(request);
      if (
        previous &&
        (previous.kind !== target.kind ||
          ("path" in previous && "path" in target && previous.path !== target.path))
      )
        return false;
      moduleTargets.set(request, target);
      edges.push({ issuer, request, imported, target });
      if (target.kind !== "local") continue;
      let targetText = localModules.get(target.path);
      if (targetText === undefined) {
        if (localModules.size >= MAX_LOCAL_MODULES) return false;
        const loaded = readModule(target.path);
        if (loaded === null || !hasInertStencilHookModuleInitialization(loaded)) return false;
        targetText = loaded;
        localModules.set(target.path, loaded);
      }
      if (!visit(target.path, targetText)) return false;
    }
    active.delete(issuer);
    finished.add(issuer);
    return true;
  };
  if (!visit(entryPath, configSource)) return null;
  const edgeFor = (
    issuer: string,
    request: string,
    imported: string,
  ): StencilGeneratorImport | null =>
    edges.find(
      (edge) => edge.issuer === issuer && edge.request === request && edge.imported === imported,
    )?.target ?? null;
  const coveredModules = new Set([entryPath]);
  const localFor = (issuer: string, request: string, imported: string) => {
    const edge = edgeFor(issuer, request, imported);
    if (edge?.kind !== "local") return null;
    const source = localModules.get(edge.path);
    return source === undefined ? null : { path: edge.path, source };
  };
  for (const factory of config.localOutputFactories) {
    const module = localFor(entryPath, factory.module, factory.exportedName);
    if (!module) return null;
    const output = readStencilPreEmitOutputValidator(module.source, factory.exportedName);
    if (!output) return null;
    coveredModules.add(module.path);
    if ("local" in output.validator) continue;
    const { module: request, imported } = output.validator;
    const target = edgeFor(module.path, request, imported);
    if (target?.kind === "local") {
      const source = localModules.get(target.path);
      if (source === undefined || !hasReadOnlyStencilConfigGuardValidator(source, imported))
        return null;
      coveredModules.add(target.path);
    } else {
      if (
        target?.kind !== "stock" ||
        (target.provider !== "stencil-react-output-validator" &&
          target.provider !== "stencil-vue-output-validator")
      )
        return null;
      const source = readModule(target.path);
      if (source === null || !hasOnlyStencilConfigRootDirectoryReads(source, imported)) return null;
    }
  }
  const style = localFor(
    entryPath,
    config.localStyleFactory.module,
    config.localStyleFactory.exportedName,
  );
  if (!style) return null;
  const styleEntry = readStencilCssTransformEntry(style.source);
  const styleContextEffects = readStencilCssTransformContextEffects(style.source);
  if (!styleEntry || !styleContextEffects) return null;
  const extension = localFor(style.path, styleEntry.module, styleEntry.imported);
  if (!extension || !hasLiteralSassExtensionGuard(extension.source, styleEntry.imported))
    return null;
  coveredModules.add(style.path);
  coveredModules.add(extension.path);
  const styleDelegateEffects: StencilCssContextEffects[] = [];
  for (const delegate of styleContextEffects.delegates) {
    const member = localFor(style.path, delegate.module, delegate.imported);
    if (!member) return null;
    const effects = readStencilCssDelegateContextEffects(
      member.source,
      delegate.imported,
      delegate.parameterIndex,
    );
    if (!effects) return null;
    coveredModules.add(member.path);
    styleDelegateEffects.push(effects);
  }
  if (coveredModules.size !== localModules.size) return null;
  return {
    config,
    edges,
    localModules: [...localModules.keys()],
    styleContextEffects,
    styleDelegateEffects,
    requiresTypeScriptImportElision,
  };
};
