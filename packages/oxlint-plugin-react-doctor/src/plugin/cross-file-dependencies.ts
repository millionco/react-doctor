import { parseSync } from "oxc-parser";
import type { StaticImport } from "oxc-parser";
import { analyzeScopes } from "./semantic/scope-analysis.js";
import {
  INTERNAL_PAGE_PATH_PATTERN,
  PAGE_FILE_PATTERN,
  PAGE_OR_LAYOUT_FILE_PATTERN,
} from "./constants/nextjs.js";
import { CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH } from "./constants/thresholds.js";
import { classifyPackagePlatform } from "./utils/classify-package-platform.js";
import { collectCrossFileProbes } from "./utils/cross-file-probe-recorder.js";
import type { CrossFileProbeTrace } from "./utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "./utils/es-tree-node.js";
import { attachParentReferences } from "./utils/attach-parent-references.js";
import { hasAncestorMetadataLayout } from "./utils/find-ancestor-metadata-layout.js";
import { hasAncestorSuspenseLayout } from "./utils/find-ancestor-suspense-layout.js";
import { isBarrelIndexModule } from "./utils/is-barrel-index-module.js";
import { isLegacyArchReactNativeFile } from "./utils/is-legacy-arch-react-native-file.js";
import { isNodeOfType } from "./utils/is-node-of-type.js";
import { isReactApiCall } from "./utils/is-react-api-call.js";
import { normalizeFilename } from "./utils/normalize-filename.js";
import { resolveLang } from "./utils/parse-source-file.js";
import { resolveBarrelExportFilePath } from "./utils/resolve-barrel-export-file-path.js";
import {
  resolveCrossFileFunctionExport,
  resolveCrossFileValueExportWithFilePath,
} from "./utils/resolve-cross-file-function-export.js";
import { resolveRelativeImportPath } from "./utils/resolve-relative-import-path.js";
import { stripParenExpression } from "./utils/strip-paren-expression.js";
import { walkAst } from "./utils/walk-ast.js";
import { isCreateRefResultWriteOnly } from "./rules/react-builtins/is-create-ref-result-write-only.js";

/**
 * Per-rule cross-file dependency collectors — the foundation of the sidecar
 * lint cache's dependency fingerprints (`@react-doctor/core`,
 * `runners/oxlint/sidecar-lint-cache.ts`).
 *
 * A collector re-runs the SAME resolver helpers its rule calls at lint time
 * (import resolution, barrel following, ancestor-layout walks, package.json
 * classification) under the probe recorder
 * (`utils/cross-file-probe-recorder.ts`), so the recorded probe set is the
 * exact set of filesystem facts the rule's execution consulted — including
 * the negative probes (extension candidates that did NOT exist) that make
 * resolution shadowing detectable when a new file appears.
 *
 * SOUNDNESS INVARIANT — each collector's probe set must be a SUPERSET of
 * every filesystem read its rule can make while linting the file, for any
 * file content and any filesystem state:
 *
 *   - Over-approximation is always safe (extra probes only cause a spurious
 *     re-lint); under-approximation is forbidden (a missed probe could
 *     replay a stale verdict).
 *   - Where a rule gates its cross-file reads on in-file conditions, a
 *     collector may skip the gate (probe more) or must mirror it EXACTLY
 *     (probe the same). Each collector documents which it does per gate.
 *   - The replay argument: the stored probe set is the complete read set of
 *     the collector's execution at store time. If every stored probe has
 *     the same answer on a later scan, re-executing the collector — and
 *     therefore the rule, whose reads are a subset — reproduces the same
 *     execution step by step (the file's own content is pinned separately
 *     by the cache key's content hash), so the stored diagnostics are
 *     exactly what a fresh sidecar lint would produce.
 *
 * A cross-file rule WITHOUT a collector here must be listed in
 * `UNBOUNDED_CROSS_FILE_RULE_IDS` — it then re-lints every file on every
 * scan (the sound fallback). `cross-file-rule-ids.test.ts` in
 * `@react-doctor/core` forces every `CROSS_FILE_RULE_IDS` entry into
 * exactly one of the two classifications.
 */

interface CrossFileDependencyCollectorInput {
  /** Absolute, forward-slash-normalized path of the file being fingerprinted. */
  readonly absoluteFilePath: string;
  readonly sourceText: string;
  /** oxc module record — the file's static import declarations. */
  readonly staticImports: ReadonlyArray<StaticImport>;
  /** Parsed program (no parent references attached). */
  readonly program: EsTreeNode;
}

type CrossFileDependencyCollector = (input: CrossFileDependencyCollectorInput) => void;

interface ImportEntryName {
  readonly source: string;
  readonly exportedName: string;
}

// Flattens the module record into (source, exportedName) pairs the resolver
// helpers accept: named entries keep their pre-rename name, default entries
// map to "default", namespace entries are dropped (every consumer rule's
// binding lookup returns null / no export name for a namespace import, so no
// rule follows them into another file). Type-only entries are kept as a safe
// dependency over-approximation even when a consuming rule rejects them.
const flattenImportEntries = (staticImports: ReadonlyArray<StaticImport>): ImportEntryName[] => {
  const flattened: ImportEntryName[] = [];
  for (const staticImport of staticImports) {
    for (const entry of staticImport.entries) {
      if (entry.importName.kind === "NamespaceObject") continue;
      const exportedName =
        entry.importName.kind === "Default" ? "default" : (entry.importName.name ?? null);
      if (exportedName === null) continue;
      flattened.push({ source: staticImport.moduleRequest.value, exportedName });
    }
  }
  return flattened;
};

// no-barrel-import reads, per relative runtime import: the resolution probe
// chain (`resolveRelativeImportPath` — extension candidates, package.json
// entries, index fallbacks), the resolved file's barrel classification, the
// nearest package.json (for the report's RN wording), and — when building the
// report message — the transitive barrel/re-export chain for each imported
// name. The rule stops probing after its first report (`didReportForFile`)
// and only follows the chain for the reported import; tracing EVERY relative
// import is the superset. Type-only entries are skipped exactly like the
// rule's `getRuntimeImportRequests`; a bare `import "./x"` has no entries and
// is skipped before any resolution, also mirroring the rule.
const collectNoBarrelImportDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
  staticImports,
}) => {
  let didProbePackagePlatform = false;
  for (const staticImport of staticImports) {
    const source = staticImport.moduleRequest.value;
    if (!source.startsWith(".")) continue;
    const runtimeEntries = staticImport.entries.filter((entry) => !entry.isType);
    if (runtimeEntries.length === 0) continue;

    const resolvedImportPath = resolveRelativeImportPath(absoluteFilePath, source);
    if (!resolvedImportPath || !isBarrelIndexModule(resolvedImportPath)) continue;

    if (!didProbePackagePlatform) {
      didProbePackagePlatform = true;
      classifyPackagePlatform(absoluteFilePath);
    }
    for (const entry of runtimeEntries) {
      const importedName = entry.importName.kind === "Default" ? "default" : entry.importName.name;
      if (importedName) resolveBarrelExportFilePath(resolvedImportPath, importedName);
    }
  }
};

// nextjs-missing-metadata reads other files only through the ancestor
// `layout.*` walk (`hasAncestorMetadataLayout`), and only for page files.
// The rule's in-file early-outs ("use client", an own metadata export) are
// deliberately NOT mirrored — always walking is the cheap superset (page
// files are few), at the cost of a spurious re-lint when a layout changes
// above a page that carries its own metadata.
const collectNextjsMissingMetadataDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
}) => {
  if (!PAGE_FILE_PATTERN.test(absoluteFilePath)) return;
  if (INTERNAL_PAGE_PATH_PATTERN.test(absoluteFilePath)) return;
  hasAncestorMetadataLayout(absoluteFilePath);
};

// nextjs-no-use-search-params-without-suspense, for page/layout files, first
// probes the ancestor layouts for a Suspense boundary and — exactly like the
// rule — stops there when one is found. Otherwise it resolves imported
// components rendered as JSX through `resolveCrossFileFunctionExport`;
// tracing EVERY import entry (the rule's `collectImportedComponents` does not
// filter type-only specifiers, so neither does this) is the superset of the
// rendered-and-unwrapped subset the rule follows.
const collectNextjsSearchParamsDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
  staticImports,
}) => {
  if (!PAGE_OR_LAYOUT_FILE_PATTERN.test(absoluteFilePath)) return;
  if (hasAncestorSuspenseLayout(absoluteFilePath)) return;
  for (const entry of flattenImportEntries(staticImports)) {
    resolveCrossFileFunctionExport(absoluteFilePath, entry.source, entry.exportedName);
  }
};

const collectEffectValueHelperDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
  staticImports,
}) => {
  for (const entry of flattenImportEntries(staticImports)) {
    resolveCrossFileFunctionExport(absoluteFilePath, entry.source, entry.exportedName);
  }
};

const flattenProgramImportEntries = (program: EsTreeNode): ImportEntryName[] => {
  const entries: ImportEntryName[] = [];
  for (const statement of (program as { body?: ReadonlyArray<EsTreeNode> }).body ?? []) {
    if (statement.type !== "ImportDeclaration") continue;
    const source = (statement as { source?: { value?: unknown } }).source?.value;
    if (typeof source !== "string") continue;
    for (const specifier of (statement as { specifiers?: ReadonlyArray<EsTreeNode> }).specifiers ??
      []) {
      if (specifier.type === "ImportDefaultSpecifier") {
        entries.push({ source, exportedName: "default" });
      } else if (specifier.type === "ImportSpecifier") {
        const imported = (specifier as { imported?: { name?: unknown; value?: unknown } }).imported;
        let exportedName: string | null = null;
        if (typeof imported?.name === "string") {
          exportedName = imported.name;
        } else if (typeof imported?.value === "string") {
          exportedName = imported.value;
        }
        if (exportedName) entries.push({ source, exportedName });
      }
    }
  }
  return entries;
};

const collectForwardedHookDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
  staticImports,
}) => {
  const greatestTraversedDepthByFilePath = new Map<string, number>();

  const collectProgramDependencies = (
    filePath: string,
    program: EsTreeNode,
    remainingDepth: number,
  ): void => {
    const previousDepth = greatestTraversedDepthByFilePath.get(filePath) ?? -1;
    if (previousDepth >= remainingDepth) return;
    greatestTraversedDepthByFilePath.set(filePath, remainingDepth);

    for (const entry of flattenProgramImportEntries(program)) {
      const resolved = resolveCrossFileValueExportWithFilePath(
        filePath,
        entry.source,
        entry.exportedName,
      );
      if (!resolved || remainingDepth === 0) continue;
      collectProgramDependencies(resolved.filePath, resolved.programNode, remainingDepth - 1);
    }
  };

  for (const entry of flattenImportEntries(staticImports)) {
    const resolved = resolveCrossFileValueExportWithFilePath(
      absoluteFilePath,
      entry.source,
      entry.exportedName,
    );
    if (!resolved) continue;
    collectProgramDependencies(
      resolved.filePath,
      resolved.programNode,
      CUSTOM_HOOK_DEPENDENCY_FORWARD_DEPTH,
    );
  }
};

const collectCreateRefDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
  program,
}) => {
  attachParentReferences(program);
  const scopes = analyzeScopes(program);
  walkAst(program, (node) => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isReactApiCall(node, "createRef", scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
        resolveNamedAliases: true,
      })
    ) {
      return;
    }
    isCreateRefResultWriteOnly(node, absoluteFilePath, scopes);
  });
};

// no-mutating-reducer-state only reads another file when a `useReducer`
// call's reducer argument resolves to an imported binding, and the call must
// be wired to a react import: either a named `useReducer` import (any alias —
// the module record's cooked names see through every escape) or a member call
// on a react default/namespace import. The member form's `useReducer`
// property can only hide behind a `\u` identifier escape, so the lexical
// gate below is a sound superset for it. Gated-in files walk the AST for the
// statically matchable call shapes and trace the resolution of every import
// entry used as a reducer argument — a superset of what the rule follows
// (the rule additionally abstains when a local binding shadows the import).
const collectMutatingReducerDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
  sourceText,
  staticImports,
  program,
}) => {
  const namedUseReducerLocals = new Set<string>();
  const reactObjectLocals = new Set<string>();
  for (const staticImport of staticImports) {
    if (staticImport.moduleRequest.value !== "react") continue;
    for (const entry of staticImport.entries) {
      if (entry.importName.kind === "Name" && entry.importName.name === "useReducer") {
        namedUseReducerLocals.add(entry.localName.value);
      } else if (
        entry.importName.kind === "Default" ||
        entry.importName.kind === "NamespaceObject"
      ) {
        reactObjectLocals.add(entry.localName.value);
      }
    }
  }
  const mayCallUseReducer =
    namedUseReducerLocals.size > 0 ||
    (reactObjectLocals.size > 0 &&
      (sourceText.includes("useReducer") || sourceText.includes("\\u")));
  if (!mayCallUseReducer) return;

  const identifierName = (node: EsTreeNode | null | undefined): string | null => {
    if (node?.type !== "Identifier") return null;
    const { name } = node as { name?: unknown };
    return typeof name === "string" ? name : null;
  };
  // Mirrors the rule's `isCallToImportedReactUseReducer` shapes: a named
  // useReducer local, or `<reactObject>.useReducer` (computed members with an
  // Identifier property match the rule too, so no `computed` check here).
  const isUseReducerCallee = (callee: EsTreeNode): boolean => {
    const calleeName = identifierName(callee);
    if (calleeName !== null) return namedUseReducerLocals.has(calleeName);
    if (callee.type !== "MemberExpression") return false;
    const member = callee as { object?: EsTreeNode; property?: EsTreeNode };
    const objectName = identifierName(member.object);
    return (
      objectName !== null &&
      reactObjectLocals.has(objectName) &&
      identifierName(member.property) === "useReducer"
    );
  };

  const reducerArgumentNames = new Set<string>();
  walkAst(program, (node) => {
    if (node.type !== "CallExpression") return;
    const call = node as { callee?: EsTreeNode; arguments?: ReadonlyArray<EsTreeNode> };
    if (!call.callee || !isUseReducerCallee(call.callee)) return;
    const reducerArgument = call.arguments?.[0];
    if (!reducerArgument) return;
    const argumentName = identifierName(stripParenExpression(reducerArgument));
    if (argumentName !== null) reducerArgumentNames.add(argumentName);
  });
  if (reducerArgumentNames.size === 0) return;

  for (const staticImport of staticImports) {
    for (const entry of staticImport.entries) {
      if (entry.importName.kind === "NamespaceObject") continue;
      if (!reducerArgumentNames.has(entry.localName.value)) continue;
      const exportedName = entry.importName.kind === "Default" ? "default" : entry.importName.name;
      if (exportedName) {
        resolveCrossFileFunctionExport(
          absoluteFilePath,
          staticImport.moduleRequest.value,
          exportedName,
        );
      }
    }
  }
};

// The JSX names rn-no-raw-text's boundary checks consult
// (`resolveTextBoundaryName`): plain identifiers, the property of a member
// tag, and the namespace of a namespaced tag.
const collectJsxBoundaryNames = (program: EsTreeNode): Set<string> => {
  const jsxNames = new Set<string>();
  walkAst(program, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const nameNode = (node as { name?: EsTreeNode }).name;
    if (!nameNode) return;
    if (nameNode.type === "JSXIdentifier") {
      const name = (nameNode as { name?: unknown }).name;
      if (typeof name === "string") jsxNames.add(name);
    } else if (nameNode.type === "JSXMemberExpression") {
      const property = (nameNode as { property?: { type?: string; name?: unknown } }).property;
      if (property?.type === "JSXIdentifier" && typeof property.name === "string") {
        jsxNames.add(property.name);
      }
    } else if (nameNode.type === "JSXNamespacedName") {
      const namespace = (nameNode as { namespace?: { name?: unknown } }).namespace;
      if (typeof namespace?.name === "string") jsxNames.add(namespace.name);
    }
  });
  return jsxNames;
};

// rn-no-raw-text reads other files two ways: the package-platform gate
// (`wrapReactNativeRule` + the rule's own RN checks — probed on EVERY file
// the rule is enabled for) and `resolveImportedComponentForwarding` for JSX
// element names bound to non-namespace imports. Resolving every imported
// name that appears as a JSX boundary name — without the rule's raw-text /
// text-component-name gates — is the superset of the elements the rule
// actually resolves.
const collectRnNoRawTextDependencies: CrossFileDependencyCollector = ({
  absoluteFilePath,
  staticImports,
  program,
}) => {
  classifyPackagePlatform(absoluteFilePath);
  const jsxNames = collectJsxBoundaryNames(program);
  if (jsxNames.size === 0) return;
  for (const staticImport of staticImports) {
    for (const entry of staticImport.entries) {
      if (entry.importName.kind === "NamespaceObject") continue;
      if (!jsxNames.has(entry.localName.value)) continue;
      const exportedName = entry.importName.kind === "Default" ? "default" : entry.importName.name;
      if (exportedName) {
        resolveCrossFileFunctionExport(
          absoluteFilePath,
          staticImport.moduleRequest.value,
          exportedName,
        );
      }
    }
  }
};

// no-dynamic-import-path / no-full-lodash-import (`is-inside-node-cli-package`),
// prefer-dynamic-import (`is-published-library-package`),
// no-indeterminate-attribute / rendering-hydration-mismatch-time /
// no-locale-format-in-render / no-match-media-in-state-initializer
// (`classifyReactNativeFileTarget`), and
// rn-prefer-expo-image (`isExpoManagedFileActive` + the `wrapReactNativeRule`
// gate) all read only the nearest manifest: the same ancestor package.json
// existence walk plus that one manifest's content. `classifyPackagePlatform`
// records exactly that probe set, and the rules gate the read on in-file
// conditions the collector deliberately skips (probing more is always safe).
const collectNearestManifestDependencies: CrossFileDependencyCollector = ({ absoluteFilePath }) => {
  classifyPackagePlatform(absoluteFilePath);
};

// rn-no-legacy-shadow-styles / rn-style-prefer-boxshadow gate on
// `isLegacyArchReactNativeFile`, which reads the nearest manifest plus
// `android/gradle.properties` and the Expo app-config files. The helper
// records its own probe set (`recordFilesystemProbes`), so re-running it is
// the exact dependency collection.
const collectLegacyArchDependencies: CrossFileDependencyCollector = ({ absoluteFilePath }) => {
  isLegacyArchReactNativeFile(absoluteFilePath);
};

export const CROSS_FILE_DEPENDENCY_COLLECTORS: ReadonlyMap<string, CrossFileDependencyCollector> =
  new Map([
    ["client-passive-event-listeners", collectEffectValueHelperDependencies],
    ["exhaustive-deps", collectForwardedHookDependencies],
    ["no-barrel-import", collectNoBarrelImportDependencies],
    ["nextjs-missing-metadata", collectNextjsMissingMetadataDependencies],
    ["nextjs-no-use-search-params-without-suspense", collectNextjsSearchParamsDependencies],
    ["no-dynamic-import-path", collectNearestManifestDependencies],
    ["no-full-lodash-import", collectNearestManifestDependencies],
    ["no-hydration-branch-on-browser-global", collectNearestManifestDependencies],
    ["no-indeterminate-attribute", collectNearestManifestDependencies],
    ["no-locale-format-in-render", collectNearestManifestDependencies],
    ["no-match-media-in-state-initializer", collectNearestManifestDependencies],
    ["no-create-ref-in-function-component", collectCreateRefDependencies],
    ["no-adjust-state-on-prop-change", collectEffectValueHelperDependencies],
    ["no-derived-state", collectEffectValueHelperDependencies],
    ["no-derived-state-effect", collectEffectValueHelperDependencies],
    ["no-event-handler", collectEffectValueHelperDependencies],
    ["no-effect-with-fresh-deps", collectForwardedHookDependencies],
    ["no-initialize-state", collectEffectValueHelperDependencies],
    ["no-mutating-reducer-state", collectMutatingReducerDependencies],
    ["no-unguarded-browser-global-in-render-or-hook-init", collectNearestManifestDependencies],
    ["prefer-dynamic-import", collectNearestManifestDependencies],
    ["rendering-hydration-mismatch-time", collectNearestManifestDependencies],
    ["rerender-memo-with-default-value", collectForwardedHookDependencies],
    ["rn-no-legacy-shadow-styles", collectLegacyArchDependencies],
    ["rn-no-raw-text", collectRnNoRawTextDependencies],
    ["rn-prefer-expo-image", collectNearestManifestDependencies],
    ["rn-style-prefer-boxshadow", collectLegacyArchDependencies],
  ]);

/**
 * Cross-file rules whose dependency set CANNOT be soundly bounded — they are
 * excluded from fingerprinting and re-lint every file on every scan. Empty
 * today; a new cross-file rule must be added either here or to
 * `CROSS_FILE_DEPENDENCY_COLLECTORS` (the core guard test enforces the
 * partition), forcing a conscious classification.
 */
export const UNBOUNDED_CROSS_FILE_RULE_IDS: ReadonlySet<string> = new Set([
  "only-export-components",
]);

/**
 * Runs the collectors for `ruleIds` over one file and returns every
 * filesystem probe they made — the file's cross-file dependency set.
 *
 * Returns `null` (caller must treat the file as unfingerprintable and always
 * re-lint it) when the file has a fatal parse error — an execution the
 * collectors cannot mirror — or when a requested rule has no collector.
 */
export const collectCrossFileDependencyProbes = (input: {
  absoluteFilePath: string;
  sourceText: string;
  ruleIds: ReadonlyArray<string>;
}): CrossFileProbeTrace | null => {
  const collectors: CrossFileDependencyCollector[] = [];
  for (const ruleId of input.ruleIds) {
    const collector = CROSS_FILE_DEPENDENCY_COLLECTORS.get(ruleId);
    if (!collector) return null;
    collectors.push(collector);
  }

  const absoluteFilePath = normalizeFilename(input.absoluteFilePath);
  let staticImports: ReadonlyArray<StaticImport>;
  let program: EsTreeNode;
  try {
    const parseResult = parseSync(absoluteFilePath, input.sourceText, {
      astType: "ts",
      lang: resolveLang(absoluteFilePath),
    });
    if (parseResult.errors.some((parseError) => parseError.severity === "Error")) return null;
    staticImports = parseResult.module.staticImports;
    program = parseResult.program as unknown as EsTreeNode;
  } catch {
    return null;
  }

  const collectorInput: CrossFileDependencyCollectorInput = {
    absoluteFilePath,
    sourceText: input.sourceText,
    staticImports,
    program,
  };
  return collectCrossFileProbes(() => {
    for (const collector of collectors) collector(collectorInput);
  });
};
