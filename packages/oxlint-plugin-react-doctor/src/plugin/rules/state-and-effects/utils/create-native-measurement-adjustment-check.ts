import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import { recordExistenceProbe } from "../../../utils/cross-file-probe-recorder.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../../utils/find-exported-value.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getExecutableValueReferences } from "../../../utils/get-executable-value-references.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { mayReadNativeMeasurementGraph } from "../../../utils/may-read-native-measurement-graph.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import { createDeclaredWebpackModuleResolver } from "../../../utils/read-declared-webpack-module-routes.js";
import { readClosedHookRefAttachmentPath } from "../../../utils/read-closed-hook-ref-attachment-path.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
  type PackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { getIntrinsicChildForwardingWrapperHook } from "../get-intrinsic-child-forwarding-wrapper-hook.js";
import { isDeferredCallbackForwardingProvider } from "../is-deferred-callback-forwarding-provider.js";
import { hasExclusiveNativeMeasurementWriters } from "./has-exclusive-native-measurement-writers.js";
import { hasLexicallyClosedResizeObserverConstruction } from "./has-lexically-closed-resize-observer-construction.js";
import { readClosedListenerRefCallback } from "./read-closed-listener-ref-callback.js";
import { readClosedNativeJsxPropAttachments } from "./read-closed-native-jsx-prop-attachments.js";
import { createSwipeRelayPrimitiveKind } from "./create-closed-swipe-scalar-proof.js";
import { readClosedNativeEventConfigRelays } from "./read-closed-native-event-config-relays.js";
import { readSwipeEventConsumerRoute } from "./read-swipe-event-consumer-route.js";
import { readMeasuredDimensionSnapshotGate } from "./read-measured-dimension-snapshot-gate.js";

const readRelativeEntry = (value: unknown): string | null => {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/"))
    return null;
  const relativePath = value.replace(/^\.\//, "");
  return relativePath.split("/").every((part) => part.length > 0 && !part.startsWith("."))
    ? relativePath
    : null;
};

const isManifestRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasCompatibleExposedEntries = (manifest: PackageManifest): boolean => {
  if (manifest.source !== undefined || ("browser" in manifest && manifest.browser !== undefined))
    return false;
  const commonJs = readRelativeEntry(manifest.main);
  const ecmaScript = readRelativeEntry(manifest.module);
  if (!commonJs || !ecmaScript) return false;
  if (manifest.exports === undefined) return true;
  if (!isManifestRecord(manifest.exports)) return false;
  const root = manifest.exports["."];
  if (
    !isManifestRecord(root) ||
    readRelativeEntry(root.require) !== commonJs ||
    readRelativeEntry(root.import) !== ecmaScript
  )
    return false;
  if (
    Object.entries(root).some(
      ([condition, target]) =>
        condition !== "import" &&
        condition !== "require" &&
        (condition !== "types" || !readRelativeEntry(target)?.endsWith(".d.ts")),
    )
  )
    return false;
  return Object.entries(manifest.exports).every(([key, target]) => {
    if (key === ".") return true;
    if (key === "./package.json") return target === "./package.json";
    return (
      key.startsWith("./") &&
      key.endsWith(".css") &&
      typeof target === "string" &&
      target.startsWith("./") &&
      Boolean(readRelativeEntry(target)?.endsWith(".css"))
    );
  });
};

const DECLARATION_CLEANUP = "build/types/components";

const hasPlainBuildPath = (root: string, relative: string): boolean => {
  let absolute = root;
  try {
    for (const part of relative.split("/")) {
      absolute = path.join(absolute, part);
      recordExistenceProbe(absolute);
      const existing = lstatSync(absolute, { throwIfNoEntry: false });
      if (!existing) return true;
      if (existing.isSymbolicLink()) return false;
    }
    return true;
  } catch {
    return false;
  }
};

const readWebpackBuildConfig = (root: string, manifest: PackageManifest): string | null => {
  const scripts = manifest.scripts;
  if (
    !scripts ||
    scripts.prebuild !== undefined ||
    scripts.postbuild !== undefined ||
    typeof scripts.build !== "string"
  )
    return null;
  const build = /^webpack --config ([\w.-]+\.cjs)( && rm -rf build\/types\/components)?$/.exec(
    scripts.build,
  );
  if (!build) return null;
  if (build[2]) {
    const outputs = [readRelativeEntry(manifest.main), readRelativeEntry(manifest.module)];
    if (
      !hasPlainBuildPath(root, DECLARATION_CLEANUP) ||
      outputs.some(
        (file) =>
          !file ||
          file === DECLARATION_CLEANUP ||
          file.startsWith(DECLARATION_CLEANUP + "/") ||
          !hasPlainBuildPath(root, file),
      )
    )
      return null;
  }
  const configFilename = build[1];
  if (!configFilename) return null;
  const config = path.join(root, configFilename);
  recordExistenceProbe(config);
  try {
    return lstatSync(config, { throwIfNoEntry: false })?.isFile() &&
      path.normalize(realpathSync(config)) === config
      ? config
      : null;
  } catch {
    return null;
  }
};

interface DeclaredHostModule {
  readonly program: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
}

const importedBinding = (name: EsTreeNode, scopes: ScopeAnalysis) => {
  const binding = scopes.symbolFor(name);
  return binding?.kind === "import"
    ? resolveImportedApiReference(binding.bindingIdentifier, scopes)
    : null;
};

const readDefaultFunction = (mod: DeclaredHostModule): EsTreeNode | null => {
  const exported = findExportedValue(mod.program, "default");
  if (!exported) return null;
  if (isFunctionLike(exported)) return exported;
  if (
    !isNodeOfType(exported, "CallExpression") ||
    exported.optional ||
    exported.arguments.length !== 1
  )
    return null;
  const carrier = importedBinding(exported.callee, mod.scopes);
  const callback = exported.arguments[0];
  return carrier?.source === "react" && carrier.importedName === "memo" && isFunctionLike(callback)
    ? callback
    : null;
};

const readReturnedFields = (owner: EsTreeNode): string[] => {
  if (!isFunctionLike(owner) || !isNodeOfType(owner.body, "BlockStatement")) return [];
  const returned = owner.body.body.at(-1);
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ObjectExpression")
  )
    return [];
  const fields: string[] = [];
  for (const property of returned.argument.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) return [];
    const field = getStaticPropertyKeyName(property);
    if (field === null) return [];
    fields.push(field);
  }
  return fields;
};

const observerSlotMatches = (
  node: EsTreeNodeOfType<"NewExpression">,
  linkedSlot: EsTreeNodeOfType<"MemberExpression">,
  mod: DeclaredHostModule,
): boolean => {
  const assigned = node.parent;
  if (
    !isNodeOfType(assigned, "AssignmentExpression") ||
    assigned.operator !== "=" ||
    assigned.right !== node ||
    !isNodeOfType(assigned.left, "MemberExpression") ||
    getStaticPropertyName(assigned.left) !== "current"
  )
    return false;
  const slot = mod.scopes.symbolFor(linkedSlot.object);
  if (
    !slot ||
    mod.scopes.symbolFor(assigned.left.object) !== slot ||
    !hasCompleteSymbolReferences(slot, mod.program, mod.scopes)
  )
    return false;
  return getExecutableValueReferences(slot).every(({ identifier, flag }) => {
    const member = identifier.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      getStaticPropertyName(member) !== "current"
    )
      return false;
    const use = member.parent;
    if (member === assigned.left) return true;
    if (isNodeOfType(use, "AssignmentExpression")) {
      return (
        use.left === member &&
        use.operator === "=" &&
        isNodeOfType(use.right, "Literal") &&
        use.right.value === null
      );
    }
    if (isNodeOfType(use, "IfStatement") && use.test === member) return true;
    if (
      isNodeOfType(use, "LogicalExpression") &&
      isNodeOfType(use.parent, "IfStatement") &&
      use.parent.test === use
    )
      return true;
    if (
      !isNodeOfType(use, "MemberExpression") ||
      use.object !== member ||
      !["observe", "unobserve", "disconnect"].includes(getStaticPropertyName(use) ?? "")
    )
      return false;
    return isNodeOfType(use.parent, "CallExpression") && use.parent.callee === use;
  });
};

export const createNativeMeasurementAdjustmentCheck = (context: RuleContext) => {
  const byEffect = new WeakMap<EsTreeNode, boolean>();
  return (effect: EsTreeNode, writeCall: EsTreeNode): boolean => {
    if (
      !context.filename ||
      !isNodeOfType(effect, "CallExpression") ||
      !isNodeOfType(writeCall, "CallExpression")
    )
      return false;
    const callback = effect.arguments[0];
    const snapshot =
      callback && readMeasuredDimensionSnapshotGate(callback, writeCall, context.scopes);
    if (!snapshot) return false;
    const owner = snapshot.owner;
    const remembered = byEffect.get(effect);
    if (remembered !== undefined) return remembered;
    const accepted = checkOwner(
      owner,
      snapshot.dimensions,
      effect,
      context,
      path.resolve(context.filename),
    );
    byEffect.set(effect, accepted);
    return accepted;
  };
};

const checkOwner = (
  owner: EsTreeNode,
  dimensions: NonNullable<ReturnType<typeof readMeasuredDimensionSnapshotGate>>["dimensions"],
  effect: EsTreeNode,
  context: RuleContext,
  filename: string,
): boolean => {
  const subject = findProgramRoot(effect);
  if (!subject || !mayReadNativeMeasurementGraph(subject)) return false;
  const root = findNearestPackageDirectory(filename);
  const manifest = root && readPackageManifest(root);
  if (
    !root ||
    !manifest ||
    !hasCompatibleExposedEntries(manifest) ||
    !isNodeOfType(owner, "FunctionDeclaration") ||
    !owner.id ||
    findExportedValue(subject, owner.id.name) !== owner ||
    typeof manifest.main !== "string" ||
    typeof manifest.module !== "string"
  )
    return false;
  const configPath = readWebpackBuildConfig(root, manifest);
  if (!configPath) return false;
  const scopesByProgram = new WeakMap<EsTreeNode, ScopeAnalysis>();
  const readModule = (filePath: string): DeclaredHostModule | null => {
    const program = parseSourceFile(filePath);
    if (!isNodeOfType(program, "Program")) return null;
    let scopes = scopesByProgram.get(program);
    if (!scopes) {
      scopes = analyzeScopes(program);
      scopesByProgram.set(program, scopes);
    }
    return { program, scopes };
  };
  const config = readModule(configPath);
  if (!config) return false;
  const resolveModule = createDeclaredWebpackModuleResolver(config.program, config.scopes, root, [
    manifest.main,
    manifest.module,
  ]);
  if (!resolveModule) return false;
  const selectedFile = (specifier: string): string | null =>
    resolveModule(specifier)?.filePath ?? null;
  const selfSpecifier = path
    .relative(root, filename)
    .split(path.sep)
    .join("/")
    .replace(/\.[cm]?tsx?$/, "");
  const self = resolveModule(selfSpecifier);
  if (self?.filePath !== filename) return false;
  const [entryPath] = self.entryPaths;
  if (!entryPath || !self.entryPaths.every((candidate) => candidate === entryPath)) return false;
  const callerModule = readModule(entryPath);
  if (!callerModule || !isNodeOfType(callerModule.program, "Program")) return false;
  const hookModule = { program: subject, scopes: context.scopes };

  // Require a closed attachment path from the hook to the native observer target.
  const linkedSlots = new Set<EsTreeNodeOfType<"MemberExpression">>();
  const attachmentResults = new WeakMap<EsTreeNode, boolean>();
  const isNativeElement = (receiver: EsTreeNode): boolean => {
    const remembered = attachmentResults.get(receiver);
    if (remembered !== undefined) return remembered;
    for (const statement of callerModule.program.body) {
      if (
        !isNodeOfType(statement, "ImportDeclaration") ||
        typeof statement.source.value !== "string" ||
        !statement.specifiers.some((part) => isNodeOfType(part, "ImportDefaultSpecifier"))
      )
        continue;
      const childSource = statement.source.value;
      for (const observerField of readReturnedFields(owner)) {
        const attachment = readClosedHookRefAttachmentPath({
          hookModule,
          hook: owner,
          receiver,
          callerModule,
          hookSource: selfSpecifier,
          hookExport: owner.id!.name,
          childSource,
          childExport: "default",
          observerField,
        });
        if (!attachment) continue;
        const leafPath = selectedFile(childSource);
        const leaf = leafPath && readModule(leafPath);
        const component = leaf && readDefaultFunction(leaf);
        if (!leaf || !component) continue;
        const terminal = readClosedNativeJsxPropAttachments(
          leaf.program,
          component,
          [attachment.receivingProp],
          leaf.scopes,
          {
            isTransparentChildrenWrapper(opening) {
              const binding = importedBinding(opening.name, leaf.scopes);
              if (binding?.importedName !== "default") return false;
              const wrapperPath = selectedFile(binding.source);
              const wrapper = wrapperPath && readModule(wrapperPath);
              const wrapperBody = wrapper && readDefaultFunction(wrapper);
              const forwarding =
                wrapper &&
                wrapperBody &&
                getIntrinsicChildForwardingWrapperHook(wrapperBody, wrapper.scopes);
              if (!wrapper || !forwarding) return false;
              const wrapperHook = importedBinding(forwarding.callee, wrapper.scopes);
              if (!wrapperHook?.importedName) return false;
              const hookPath = selectedFile(wrapperHook.source);
              const provider = hookPath && readModule(hookPath);
              const hook =
                provider && findExportedValue(provider.program, wrapperHook.importedName);
              if (!provider || !hook) return false;
              const listeners = readClosedListenerRefCallback(hook, provider.scopes);
              if (
                !listeners ||
                listeners.handlerEventNames.join(",") !== "touchstart,touchmove,touchend"
              )
                return false;
              const consumers = readSwipeEventConsumerRoute({
                callerOpening: attachment.receivingChild,
                callerScopes: callerModule.scopes,
                leafComponent: component,
                wrapperOpening: opening,
                leafScopes: leaf.scopes,
                forwardingHook: forwarding,
              });
              const primitiveKind = createSwipeRelayPrimitiveKind(
                hook,
                listeners.handlerCallbacks,
                provider.scopes,
              );
              if (!consumers || !primitiveKind) return false;
              const channels = readClosedNativeEventConfigRelays(
                hook,
                listeners.handlerCallbacks,
                provider.scopes,
                { primitiveKind },
              );
              return Boolean(
                channels &&
                channels.every(
                  ({ configField, eventField, handler }) =>
                    handler === listeners.handlerCallbacks[configField === "onSwiping" ? 1 : 2] &&
                    consumers[configField].eventField === eventField &&
                    consumers[configField].otherFields.every(({ field }) =>
                      ["absX", "absY", "dir", "velocity"].includes(field),
                    ),
                ),
              );
            },
          },
        );
        if (terminal?.length === 1 && attachment.observerSlots.length === 1) {
          linkedSlots.add(attachment.observerSlots[0]);
          attachmentResults.set(receiver, true);
          return true;
        }
      }
    }
    attachmentResults.set(receiver, false);
    return false;
  };
  walkAst(owner, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      getStaticPropertyName(node.callee) === "getBoundingClientRect"
    )
      isNativeElement(node.callee.object);
  });
  if (linkedSlots.size !== 1) return false;
  const [linkedSlot] = linkedSlots;
  return dimensions.every((dimension) =>
    hasExclusiveNativeMeasurementWriters(dimension, owner, context.scopes, {
      isNativeElement,
      isNativeResizeObserver(construction) {
        return Boolean(
          linkedSlot &&
          hasLexicallyClosedResizeObserverConstruction(construction, owner, context.scopes) &&
          observerSlotMatches(construction, linkedSlot, hookModule),
        );
      },
      resolveDeferredObserverCallback(argument) {
        if (
          !isNodeOfType(argument, "CallExpression") ||
          argument.optional ||
          argument.arguments.length !== 2
        )
          return null;
        const callee = importedBinding(argument.callee, context.scopes);
        const [callback, wait] = argument.arguments;
        if (
          !callee?.importedName ||
          !isFunctionLike(callback) ||
          !isNodeOfType(wait, "Literal") ||
          typeof wait.value !== "number" ||
          !Number.isFinite(wait.value) ||
          wait.value < 0
        )
          return null;
        const providerPath = selectedFile(callee.source);
        const provider = providerPath && readModule(providerPath);
        const exported = provider && findExportedValue(provider.program, callee.importedName);
        return provider &&
          exported &&
          isDeferredCallbackForwardingProvider(exported, provider.scopes)
          ? callback
          : null;
      },
    }),
  );
};
