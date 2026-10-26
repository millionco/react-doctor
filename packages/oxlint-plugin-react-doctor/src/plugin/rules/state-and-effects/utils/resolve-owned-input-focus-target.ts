import { isEventHandlerName } from "./event-handler-reference.js";
import { isOwnedObjectCallbackDataConsumer } from "./is-owned-object-callback-data-consumer.js";
import { collectOwnedForeignContainsUses } from "./collect-owned-foreign-contains-uses.js";
import * as fs from "node:fs";
import { isReadonlyCssCallableRecordUse } from "./is-readonly-css-callable-record-use.js";
import * as path from "node:path";
import { collectOwnedDomLifecycleUses } from "./collect-owned-dom-lifecycle-uses.js";
import { isReadonlyNativeSnapshot } from "./is-readonly-native-snapshot.js";
import { collectOwnedNativeRefUses } from "./collect-owned-native-ref-uses.js";
import type { OwnedNativeRefUses } from "./collect-owned-native-ref-uses.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type {
  SourceProjectIndex,
  SourceProjectModule,
} from "../../../utils/build-source-project-index.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import { OBJECT_PROTOTYPE_PROPERTY_NAMES } from "../../../utils/constants.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getFiniteStaticStringValues } from "../../../utils/get-finite-static-string-values.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../../utils/has-static-property-write-before.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasUnindexedRuntimeSource } from "../../../utils/has-unindexed-runtime-source.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isProvenStyledComponentExpression } from "../../../utils/is-proven-styled-component-expression.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import { findNearestPackageDirectory } from "../../../utils/read-nearest-package-manifest.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import {
  hasStandardReactJsxConfiguration,
  isTsconfigObjectRecord,
} from "../../../utils/resolve-tsconfig-alias.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  JSX_BABEL_CONFIG_FILE_NAMES,
  JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
} from "../../../constants/react.js";
import {
  OWNED_INPUT_HOST_NAMES,
  OWNED_INPUT_RESERVED_ATTRIBUTES,
  OWNED_INPUT_PROVIDER_SOURCES,
  OWNED_INPUT_REFUSED_MANIFEST_FIELDS,
  OWNED_INPUT_REFUSED_GLOBALS,
  OWNED_INPUT_RUNTIME_TYPES,
  OWNED_INPUT_PROTECTED_NATIVE_MEMBERS,
  OWNED_INPUT_METADATA_NAMES,
  OWNED_INPUT_REACT_API_NAMES,
  OWNED_INPUT_PASSIVE_PROTOTYPE_NAMES,
  OWNED_INPUT_OBJECT_METHOD_NAMES,
  OWNED_INPUT_WINDOW_READ_NAMES,
  OWNED_INPUT_DOCUMENT_READ_NAMES,
  OWNED_INPUT_NATIVE_RESULT_METHOD_NAMES,
  OWNED_INPUT_NATIVE_CALL_NAMES,
  OWNED_INPUT_NATIVE_CONTAINER_METHOD_NAMES,
  OWNED_INPUT_DATA_GLOBAL_NAMES,
  OWNED_INPUT_TIMER_NAMES,
  OWNED_INPUT_INPUT_SCALAR_NAMES,
  OWNED_INPUT_EVENT_SCALAR_NAMES,
  OWNED_INPUT_EVENT_METHOD_NAMES,
  OWNED_INPUT_ADD_LISTENER_NAMES,
  OWNED_INPUT_LISTENER_NAMES,
  OWNED_INPUT_NATIVE_EVENT_METHOD_NAMES,
  OWNED_INPUT_CALLABLE_TRANSPORT_NAMES,
  OWNED_INPUT_CALLABLE_ARGUMENT_NAMES,
  OWNED_INPUT_NATIVE_ARRAY_METHOD_NAMES,
  OWNED_INPUT_NATIVE_STRING_METHOD_NAMES,
  OWNED_INPUT_CALLABLE_STYLED_NAMES,
  OWNED_INPUT_CALLABLE_GLOBAL_NAMES,
  OWNED_INPUT_EMPTY_COUNT,
  OWNED_INPUT_SINGLE_COUNT,
  OWNED_INPUT_PAIR_COUNT,
  OWNED_INPUT_FIRST_INDEX,
  OWNED_INPUT_MAX_RESOLUTION_DEPTH,
  OWNED_INPUT_BUILD_RECIPE_PATTERN,
  OWNED_INPUT_CUSTOM_COMPILER_PATTERN,
  OWNED_INPUT_DECLARED_REACT_PATTERN,
  OWNED_INPUT_DECLARED_STYLED_PATTERN,
} from "./constants.js";

interface OwnedInputHost {
  readonly anonymousOrigin?: EsTreeNode;
  readonly name: string;
  readonly module: SourceProjectModule;
  readonly binding: SymbolDescriptor | null;
}

interface OwnedInputTarget {
  readonly ref: SymbolDescriptor;
  readonly childIndex: number | null;
}

const isRuntimeReference = (node: EsTreeNode): boolean =>
  !isNonReferenceIdentifier(node) && !isTypeScriptTypePosition(node);

const hasReadonlyCompleteReferences = (
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
): boolean =>
  hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) &&
  symbol.references.every(
    (reference) =>
      !isRuntimeReference(reference.identifier) ||
      (reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier)),
  );

const getOwnJson = (filename: string): Record<string, unknown> | null => {
  recordExistenceProbe(filename);
  recordContentProbe(filename);
  if (!fs.existsSync(filename)) return null;
  const metadata = fs.lstatSync(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
  const parsed: unknown = JSON.parse(fs.readFileSync(filename, "utf8"));
  return isTsconfigObjectRecord(parsed) && !Array.isArray(parsed) ? parsed : null;
};

const hasSupportedBabelData = (configuration: Record<string, unknown>): boolean => {
  if (Object.keys(configuration).some((key) => !["presets", "plugins", "env"].includes(key)))
    return false;
  if (configuration.presets !== undefined && !Array.isArray(configuration.presets)) return false;
  if (configuration.plugins !== undefined && !Array.isArray(configuration.plugins)) return false;
  for (const preset of configuration.presets ?? []) {
    if (preset === "@babel/preset-env" || preset === "@babel/preset-react") continue;
    if (
      !Array.isArray(preset) ||
      preset.length !== OWNED_INPUT_PAIR_COUNT ||
      preset[OWNED_INPUT_FIRST_INDEX] !== "@babel/preset-react"
    )
      return false;
    const options = preset[OWNED_INPUT_SINGLE_COUNT];
    if (
      !isTsconfigObjectRecord(options) ||
      Array.isArray(options) ||
      Object.keys(options).some((key) => key !== "runtime") ||
      !["automatic", "classic"].includes(String(options.runtime))
    )
      return false;
  }
  if ((configuration.plugins ?? []).some((plugin) => plugin !== "babel-plugin-styled-components"))
    return false;
  if (configuration.env !== undefined) {
    if (!isTsconfigObjectRecord(configuration.env) || Array.isArray(configuration.env))
      return false;
    for (const environment of Object.values(configuration.env)) {
      if (
        !isTsconfigObjectRecord(environment) ||
        Array.isArray(environment) ||
        Object.keys(environment).some((key) => key !== "ignore") ||
        !Array.isArray(environment.ignore) ||
        environment.ignore.some((pattern) => typeof pattern !== "string")
      )
        return false;
    }
  }
  return true;
};

const hasOwnedInputConfiguration = (
  module: SourceProjectModule,
  rootDirectory: string,
): boolean => {
  if (!hasStandardReactJsxConfiguration(module.filePath, { requireUnaliasedReact: true }))
    return false;
  let directory = path.dirname(module.filePath);
  while (true) {
    const manifestPath = path.join(directory, "package.json");
    recordExistenceProbe(manifestPath);
    if (fs.existsSync(manifestPath)) {
      const manifest = getOwnJson(manifestPath);
      if (
        !manifest ||
        OWNED_INPUT_REFUSED_MANIFEST_FIELDS.some((name) => Object.hasOwn(manifest, name))
      )
        return false;
      if (manifest.scripts !== undefined) {
        if (!isTsconfigObjectRecord(manifest.scripts) || Array.isArray(manifest.scripts))
          return false;
        for (const [name, recipe] of Object.entries(manifest.scripts)) {
          if (
            typeof recipe !== "string" ||
            OWNED_INPUT_CUSTOM_COMPILER_PATTERN.test(recipe) ||
            (name === "build" && !OWNED_INPUT_BUILD_RECIPE_PATTERN.test(recipe))
          )
            return false;
        }
      }
      const dependencies = {
        ...(isTsconfigObjectRecord(manifest.peerDependencies) ? manifest.peerDependencies : {}),
        ...(isTsconfigObjectRecord(manifest.dependencies) ? manifest.dependencies : {}),
        ...(isTsconfigObjectRecord(manifest.devDependencies) ? manifest.devDependencies : {}),
      };
      for (const source of OWNED_INPUT_PROVIDER_SOURCES) {
        const declaration = dependencies[source];
        if (
          declaration !== undefined &&
          (typeof declaration !== "string" ||
            !/^[~^]?\d+(?:\.\d+){0,2}(?:\s*\|\|\s*[~^]?\d+(?:\.\d+){0,2})*$/u.test(declaration))
        )
          return false;
        if (resolveModulePath(module.filePath, source)) return false;
      }
      if (
        directory === rootDirectory &&
        (typeof dependencies.react !== "string" ||
          !OWNED_INPUT_DECLARED_REACT_PATTERN.test(dependencies.react) ||
          (dependencies["styled-components"] !== undefined &&
            (typeof dependencies["styled-components"] !== "string" ||
              !OWNED_INPUT_DECLARED_STYLED_PATTERN.test(dependencies["styled-components"]))))
      )
        return false;
      if (
        Object.hasOwn(manifest, "babel") &&
        (!isTsconfigObjectRecord(manifest.babel) ||
          Array.isArray(manifest.babel) ||
          !hasSupportedBabelData(manifest.babel))
      )
        return false;
    }
    for (const filename of [
      ...JSX_BABEL_CONFIG_FILE_NAMES,
      ...JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
    ]) {
      const configurationPath = path.join(directory, filename);
      recordExistenceProbe(configurationPath);
      if (!fs.existsSync(configurationPath)) continue;
      if (
        filename !== ".babelrc" &&
        filename !== ".babelrc.json" &&
        filename !== "babel.config.json"
      )
        return false;
      const parsed = getOwnJson(configurationPath);
      if (!parsed || !hasSupportedBabelData(parsed)) return false;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return true;
    directory = parent;
  }
};

const hasVisibleOwnedInputPoison = (
  module: SourceProjectModule,
  sourceText: string,
  nativeRefs: ReadonlySet<SymbolDescriptor>,
  isDataNamespace: (declaration: EsTreeNode) => boolean,
  eventObjects: ReadonlySet<SymbolDescriptor>,
  eventTargets: ReadonlySet<SymbolDescriptor>,
  approvedNativeUseNodes: ReadonlySet<EsTreeNode>,
  index: SourceProjectIndex,
): boolean => {
  if (
    hasJsxRuntimePragma({ program: module.programNode, filename: module.filePath, sourceText }) ||
    [...OWNED_INPUT_REACT_API_NAMES].some((name) =>
      hasReactDefaultProviderMutation(name, module.scopes),
    )
  )
    return true;
  if (module.programNode.body.length === OWNED_INPUT_SINGLE_COUNT) {
    const statement = module.programNode.body[OWNED_INPUT_FIRST_INDEX];
    const expression = isNodeOfType(statement, "ExpressionStatement")
      ? stripParenExpression(statement.expression)
      : null;
    if (
      isNodeOfType(expression, "AssignmentExpression") &&
      expression.operator === "=" &&
      isNodeOfType(expression.left, "MemberExpression") &&
      !expression.left.optional &&
      getResolvedStaticPropertyName(expression.left, module.scopes) === "exports"
    ) {
      const receiver = stripParenExpression(expression.left.object);
      const value = stripParenExpression(expression.right);
      if (
        isNodeOfType(receiver, "Identifier") &&
        receiver.name === "module" &&
        module.scopes.isGlobalReference(receiver) &&
        ((isNodeOfType(value, "Literal") &&
          (value.value === null || ["string", "number", "boolean"].includes(typeof value.value))) ||
          (isNodeOfType(value, "ObjectExpression") &&
            value.properties.length === OWNED_INPUT_EMPTY_COUNT))
      )
        return false;
    }
  }
  const allEventObjects = new Set(eventObjects);
  const allEventTargets = new Set(eventTargets);
  let unsupportedListener = false;
  const isOwnGlobalListenerCall = (node: EsTreeNode, names: ReadonlySet<string>): boolean => {
    if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
    const callee = stripParenExpression(node.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.optional ||
      !names.has(getResolvedStaticPropertyName(callee, module.scopes) ?? "")
    )
      return false;
    const receiver = stripParenExpression(callee.object);
    return (
      isNodeOfType(receiver, "Identifier") &&
      (receiver.name === "window" || receiver.name === "document") &&
      module.scopes.isGlobalReference(receiver)
    );
  };
  const isEventObject = (
    rawValue: EsTreeNode,
    origins: ReadonlySet<SymbolDescriptor> = allEventObjects,
    visited = new Set<SymbolDescriptor>(),
  ): boolean => {
    const value = stripParenExpression(rawValue);
    if (!isNodeOfType(value, "Identifier")) return false;
    const symbol = module.scopes.symbolFor(value);
    if (!symbol || visited.has(symbol)) return false;
    if (origins.has(symbol)) return true;
    visited.add(symbol);
    const initializer = getDirectUnreassignedInitializer(symbol);
    return Boolean(
      initializer &&
      hasReadonlyCompleteReferences(symbol, module) &&
      isEventObject(initializer, origins, visited),
    );
  };
  const isInputEventObject = (value: EsTreeNode): boolean => isEventObject(value, eventObjects);
  const isInputEventTarget = (
    rawValue: EsTreeNode,
    visited = new Set<SymbolDescriptor>(),
  ): boolean => {
    const value = stripParenExpression(rawValue);
    if (
      isNodeOfType(value, "MemberExpression") &&
      ["target", "currentTarget"].includes(
        getResolvedStaticPropertyName(value, module.scopes) ?? "",
      )
    )
      return isInputEventObject(value.object);
    if (!isNodeOfType(value, "Identifier")) return false;
    const symbol = module.scopes.symbolFor(value);
    if (!symbol || visited.has(symbol)) return false;
    if (eventTargets.has(symbol)) return true;
    visited.add(symbol);
    const initializer = getDirectUnreassignedInitializer(symbol);
    return Boolean(
      initializer &&
      hasReadonlyCompleteReferences(symbol, module) &&
      isInputEventTarget(initializer, visited),
    );
  };
  const isNativeResult = (rawValue: EsTreeNode, visited = new Set<SymbolDescriptor>()): boolean => {
    const value = stripParenExpression(rawValue);
    if (isNodeOfType(value, "Identifier")) {
      if (
        (value.name === "document" || value.name === "window") &&
        module.scopes.isGlobalReference(value)
      )
        return true;
      const symbol = module.scopes.symbolFor(value);
      if (!symbol || visited.has(symbol)) return false;
      if (allEventObjects.has(symbol) || allEventTargets.has(symbol)) return true;
      visited.add(symbol);
      const initializer = getDirectUnreassignedInitializer(symbol);
      if (initializer && hasReadonlyCompleteReferences(symbol, module))
        return isNativeResult(initializer, visited);
      if (
        isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
        symbol.declarationNode.id === symbol.bindingIdentifier &&
        symbol.declarationNode.init &&
        isNativeResult(symbol.declarationNode.init, new Set(visited))
      )
        return true;
      for (const reference of symbol.references) {
        if (reference.flag === "read") continue;
        const written = findTransparentExpressionRoot(reference.identifier);
        const assignment = written.parent;
        if (
          isNodeOfType(assignment, "AssignmentExpression") &&
          assignment.left === written &&
          isNativeResult(assignment.right, new Set(visited))
        )
          return true;
      }
      const declaration = symbol.declarationNode;
      if (
        isNodeOfType(declaration, "VariableDeclarator") &&
        declaration.init &&
        isNodeOfType(declaration.id, "ObjectPattern") &&
        declaration.id.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            property.value === symbol.bindingIdentifier &&
            getStaticPropertyKeyName(property) === "body",
        )
      )
        return isNativeResult(declaration.init, visited);
      return false;
    }
    if (isNodeOfType(value, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(value, module.scopes);
      if (
        (OWNED_INPUT_INPUT_SCALAR_NAMES.has(name ?? "") && isInputEventTarget(value.object)) ||
        (OWNED_INPUT_EVENT_SCALAR_NAMES.has(name ?? "") && isEventObject(value.object))
      )
        return false;
      if (isInputEventTarget(value)) return true;
      const receiver = stripParenExpression(value.object);
      if (
        getResolvedStaticPropertyName(value, module.scopes) === "current" &&
        isNodeOfType(receiver, "Identifier")
      ) {
        const symbol = module.scopes.symbolFor(receiver);
        if (symbol && nativeRefs.has(symbol)) return true;
      }
      return isNativeResult(value.object, visited);
    }
    if (!isNodeOfType(value, "CallExpression") || value.optional) return false;
    const callee = stripParenExpression(value.callee);
    return (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.optional &&
      OWNED_INPUT_NATIVE_RESULT_METHOD_NAMES.has(
        getResolvedStaticPropertyName(callee, module.scopes) ?? "",
      ) &&
      isNativeResult(callee.object, visited)
    );
  };
  const isCanonicalPortalContainer = (call: EsTreeNode, value: EsTreeNode): boolean => {
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments[OWNED_INPUT_SINGLE_COUNT] !== value ||
      (call.arguments.length !== OWNED_INPUT_PAIR_COUNT &&
        call.arguments.length !== OWNED_INPUT_PAIR_COUNT + OWNED_INPUT_SINGLE_COUNT)
    )
      return false;
    const packageDirectory = findNearestPackageDirectory(module.filePath);
    const manifest = packageDirectory
      ? getOwnJson(path.join(packageDirectory, "package.json"))
      : null;
    const dependencies = manifest
      ? {
          ...(isTsconfigObjectRecord(manifest.peerDependencies) ? manifest.peerDependencies : {}),
          ...(isTsconfigObjectRecord(manifest.dependencies) ? manifest.dependencies : {}),
          ...(isTsconfigObjectRecord(manifest.devDependencies) ? manifest.devDependencies : {}),
        }
      : {};
    const declaration = dependencies["react-dom"];
    if (typeof declaration !== "string" || !OWNED_INPUT_DECLARED_REACT_PATTERN.test(declaration))
      return false;
    const callee = stripParenExpression(call.callee);
    const imported = resolveImportedApiReference(callee, module.scopes);
    if (imported?.source !== "react-dom" || imported.importedName !== "createPortal") return false;
    const receiver = isNodeOfType(callee, "MemberExpression")
      ? stripParenExpression(callee.object)
      : callee;
    const provider = isNodeOfType(receiver, "Identifier")
      ? module.scopes.symbolFor(receiver)
      : null;
    if (
      !provider ||
      !getImportDeclarationForSymbol(provider) ||
      !hasReadonlyCompleteReferences(provider, module)
    )
      return false;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      (callee.optional ||
        hasPossibleStaticPropertyMutationOrEscape(receiver, "createPortal", module.scopes))
    )
      return false;
    return (
      isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(provider.declarationNode, "ImportNamespaceSpecifier") ||
      getImportedName(provider.declarationNode) === "createPortal" ||
      getImportedName(provider.declarationNode) === "default"
    );
  };
  const lifecycleUses = collectOwnedDomLifecycleUses({
    module,
    index,
    isNativeValue: isNativeResult,
    isPortalContainer: isCanonicalPortalContainer,
    isReadonlyNativeSnapshot,
  });
  walkAst(module.programNode, (node) => {
    if (isNodeOfType(node, "CallExpression") && lifecycleUses.approvedListenerCalls.has(node))
      return;
    if (
      !isOwnGlobalListenerCall(node, OWNED_INPUT_ADD_LISTENER_NAMES) ||
      !isNodeOfType(node, "CallExpression")
    )
      return;
    const argument = node.arguments[OWNED_INPUT_SINGLE_COUNT];
    const value = argument ? stripParenExpression(argument) : null;
    const callback =
      value &&
      (isFunctionLike(value)
        ? value
        : isNodeOfType(value, "Identifier")
          ? resolveExactLocalFunction(value, module.scopes)
          : null);
    if (
      !callback ||
      !isFunctionLike(callback) ||
      findProgramRoot(callback) !== module.programNode ||
      callback.params.length > OWNED_INPUT_SINGLE_COUNT
    ) {
      unsupportedListener = true;
      return;
    }
    if (isNodeOfType(value, "Identifier")) {
      const root = findTransparentExpressionRoot(callback);
      const declaration = root.parent;
      const origin =
        isNodeOfType(callback, "FunctionDeclaration") && callback.id
          ? module.scopes.symbolFor(callback.id)
          : isNodeOfType(declaration, "VariableDeclarator") &&
              declaration.init === root &&
              isNodeOfType(declaration.id, "Identifier")
            ? module.scopes.symbolFor(declaration.id)
            : null;
      if (!origin) {
        unsupportedListener = true;
        return;
      }
      const aliases = new Set<SymbolDescriptor>([origin]);
      for (const alias of aliases) {
        if (!hasReadonlyCompleteReferences(alias, module)) {
          unsupportedListener = true;
          break;
        }
        for (const reference of alias.references) {
          if (!isRuntimeReference(reference.identifier)) continue;
          const use = findTransparentExpressionRoot(reference.identifier);
          const parent = use.parent;
          if (
            parent &&
            isOwnGlobalListenerCall(parent, OWNED_INPUT_LISTENER_NAMES) &&
            isNodeOfType(parent, "CallExpression") &&
            parent.arguments[OWNED_INPUT_SINGLE_COUNT] === use
          )
            continue;
          if (
            isNodeOfType(parent, "VariableDeclarator") &&
            parent.init === use &&
            isNodeOfType(parent.id, "Identifier")
          ) {
            const nextAlias = module.scopes.symbolFor(parent.id);
            if (nextAlias && getDirectUnreassignedInitializer(nextAlias) === use) {
              aliases.add(nextAlias);
              continue;
            }
          }
          unsupportedListener = true;
        }
      }
    }
    walkAst(callback, (child) => {
      if (
        isNodeOfType(child, "Identifier") &&
        isRuntimeReference(child) &&
        ((child.name === "arguments" && module.scopes.referenceFor(child)) ||
          (child.name === "event" && module.scopes.isGlobalReference(child)))
      )
        unsupportedListener = true;
    });
    const parameter = callback.params[OWNED_INPUT_FIRST_INDEX];
    if (!parameter) return;
    if (isNodeOfType(parameter, "Identifier")) {
      const symbol = module.scopes.symbolFor(parameter);
      if (symbol) allEventObjects.add(symbol);
      else unsupportedListener = true;
    } else if (isNodeOfType(parameter, "ObjectPattern")) {
      for (const property of parameter.properties) {
        if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier")) {
          unsupportedListener = true;
          break;
        }
        const name = getStaticPropertyKeyName(property, { allowComputedString: true });
        if (
          !name ||
          (!["target", "currentTarget"].includes(name) && !OWNED_INPUT_EVENT_SCALAR_NAMES.has(name))
        ) {
          unsupportedListener = true;
          break;
        }
        if (["target", "currentTarget"].includes(name)) {
          const symbol = module.scopes.symbolFor(property.value);
          if (symbol) allEventTargets.add(symbol);
          else unsupportedListener = true;
        }
      }
    } else unsupportedListener = true;
  });
  if (unsupportedListener) return true;
  const hasClosedNativeUse = (rawValue: EsTreeNode): boolean => {
    if (
      approvedNativeUseNodes.has(rawValue) ||
      approvedNativeUseNodes.has(findTransparentExpressionRoot(rawValue))
    )
      return true;
    if (
      lifecycleUses.approvedNativeUseNodes.has(rawValue) ||
      lifecycleUses.approvedNativeUseNodes.has(findTransparentExpressionRoot(rawValue))
    )
      return true;
    const value = findTransparentExpressionRoot(rawValue);
    const parent = value.parent;
    if (!parent) return false;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === value &&
      isNodeOfType(parent.id, "Identifier")
    )
      return true;
    if (isNodeOfType(parent, "AssignmentExpression")) {
      if (parent.right === value && isNodeOfType(parent.left, "Identifier")) return true;
      if (parent.left === value && isNodeOfType(value, "Identifier")) return true;
      if (
        parent.left === value &&
        isNodeOfType(value, "MemberExpression") &&
        getResolvedStaticPropertyName(value, module.scopes) !== null
      ) {
        let receiver = stripParenExpression(value.object);
        while (isNodeOfType(receiver, "MemberExpression")) {
          if (getResolvedStaticPropertyName(receiver, module.scopes) === "style") return true;
          receiver = stripParenExpression(receiver.object);
        }
      }
      return false;
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === value) {
      const name = getResolvedStaticPropertyName(parent, module.scopes);
      return (
        name !== null ||
        (parent.computed &&
          isNodeOfType(parent.property, "Literal") &&
          typeof parent.property.value === "number" &&
          Number.isSafeInteger(parent.property.value) &&
          parent.property.value >= OWNED_INPUT_EMPTY_COUNT &&
          !isMemberMutationTarget(parent))
      );
    }
    if (isNodeOfType(parent, "CallExpression")) {
      const callee = stripParenExpression(parent.callee);
      if (callee === stripParenExpression(value) && isNodeOfType(callee, "MemberExpression"))
        return (
          !parent.optional &&
          (OWNED_INPUT_NATIVE_CALL_NAMES.has(
            getResolvedStaticPropertyName(callee, module.scopes) ?? "",
          ) ||
            (OWNED_INPUT_EVENT_METHOD_NAMES.has(
              getResolvedStaticPropertyName(callee, module.scopes) ?? "",
            ) &&
              isInputEventObject(callee.object)) ||
            (OWNED_INPUT_NATIVE_EVENT_METHOD_NAMES.has(
              getResolvedStaticPropertyName(callee, module.scopes) ?? "",
            ) &&
              isEventObject(callee.object)))
        );
      if (isCanonicalPortalContainer(parent, value)) return true;
      return (
        !parent.optional &&
        isNodeOfType(callee, "MemberExpression") &&
        isNativeResult(callee.object) &&
        OWNED_INPUT_NATIVE_CONTAINER_METHOD_NAMES.has(
          getResolvedStaticPropertyName(callee, module.scopes) ?? "",
        )
      );
    }
    return (
      (isNodeOfType(parent, "BinaryExpression") && ["===", "!=="].includes(parent.operator)) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        (parent.operator === "!" || parent.operator === "typeof")) ||
      (isNodeOfType(parent, "IfStatement") && parent.test === value) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "&&" &&
        parent.left === value)
    );
  };
  const isKnownCallableReceiver = (
    rawValue: EsTreeNode,
    visited = new Set<SymbolDescriptor>(),
  ): boolean => {
    const value = stripParenExpression(rawValue);
    if (resolveExactLocalFunction(value, module.scopes)) return true;
    if (isNodeOfType(value, "Identifier")) {
      if (
        module.scopes.isGlobalReference(value) &&
        OWNED_INPUT_CALLABLE_GLOBAL_NAMES.has(value.name)
      )
        return true;
      const symbol = module.scopes.symbolFor(value);
      if (!symbol || visited.has(symbol) || !hasReadonlyCompleteReferences(symbol, module))
        return false;
      visited.add(symbol);
      const imported = resolveImportedApiReference(value, module.scopes);
      if (
        imported?.source === "styled-components" &&
        OWNED_INPUT_CALLABLE_STYLED_NAMES.has(imported.importedName ?? "")
      )
        return true;
      if (
        imported?.source === "react" &&
        OWNED_INPUT_REACT_API_NAMES.has(imported.importedName ?? "")
      )
        return true;
      const initializer = getDirectUnreassignedInitializer(symbol);
      return Boolean(initializer && isKnownCallableReceiver(initializer, visited));
    }
    if (isNodeOfType(value, "MemberExpression")) {
      let receiver = stripParenExpression(value.object);
      const receiverBindings = new Set(visited);
      while (isNodeOfType(receiver, "Identifier")) {
        const receiverSymbol = module.scopes.symbolFor(receiver);
        if (
          !receiverSymbol ||
          receiverBindings.has(receiverSymbol) ||
          !hasReadonlyCompleteReferences(receiverSymbol, module)
        )
          break;
        receiverBindings.add(receiverSymbol);
        const initializer = getDirectUnreassignedInitializer(receiverSymbol);
        if (!initializer) break;
        receiver = stripParenExpression(initializer);
      }
      if (isNodeOfType(receiver, "UnaryExpression") && ["+", "-"].includes(receiver.operator)) {
        const argument = stripParenExpression(receiver.argument);
        if (
          isNodeOfType(argument, "Literal") &&
          ["number", "bigint"].includes(typeof argument.value)
        )
          receiver = argument;
      }
      const name = getResolvedStaticPropertyName(value, module.scopes);
      if (
        !value.optional &&
        name &&
        isNodeOfType(receiver, "ArrayExpression") &&
        OWNED_INPUT_NATIVE_ARRAY_METHOD_NAMES.has(name)
      )
        return true;
      if (
        !value.optional &&
        name &&
        ((isNodeOfType(receiver, "Literal") && typeof receiver.value === "string") ||
          isNodeOfType(receiver, "TemplateLiteral")) &&
        OWNED_INPUT_NATIVE_STRING_METHOD_NAMES.has(name)
      )
        return true;
      if (
        !value.optional &&
        name &&
        isNodeOfType(receiver, "Literal") &&
        typeof receiver.value !== "string" &&
        (receiver.value !== null || "regex" in receiver)
      )
        return true;
      if (
        !value.optional &&
        name &&
        isNodeOfType(receiver, "Identifier") &&
        module.scopes.isGlobalReference(receiver)
      )
        return true;
      return name === "bind" && isKnownCallableReceiver(receiver, visited);
    }
    if (isNodeOfType(value, "CallExpression") && !value.optional) {
      const callee = stripParenExpression(value.callee);
      return (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.optional &&
        getResolvedStaticPropertyName(callee, module.scopes) === "bind" &&
        isKnownCallableReceiver(callee.object, visited)
      );
    }
    return false;
  };
  const hasCallableAcquisitionUse = (
    rawValue: EsTreeNode,
    visited = new Set<SymbolDescriptor>(),
  ): boolean => {
    const value = findTransparentExpressionRoot(rawValue);
    const parent = value.parent;
    if (!parent) return true;
    if (
      (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")) &&
      parent.callee === value
    )
      return true;
    if (isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === value) return true;
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === value &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const symbol = module.scopes.symbolFor(parent.id);
      if (!symbol || !hasReadonlyCompleteReferences(symbol, module)) return true;
      if (visited.has(symbol)) return false;
      visited.add(symbol);
      return symbol.references.some(
        (reference) =>
          isRuntimeReference(reference.identifier) &&
          hasCallableAcquisitionUse(reference.identifier, new Set(visited)),
      );
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === value) {
      const name = getResolvedStaticPropertyName(parent, module.scopes);
      return (
        OWNED_INPUT_CALLABLE_TRANSPORT_NAMES.has(name ?? "") ||
        (isMemberMutationTarget(parent) &&
          (name === null ||
            OWNED_INPUT_PROTECTED_NATIVE_MEMBERS.has(name) ||
            OWNED_INPUT_RESERVED_ATTRIBUTES.has(name) ||
            name === "defaultProps" ||
            name === "target" ||
            isEventHandlerName(name)))
      );
    }
    if (
      isNodeOfType(parent, "LogicalExpression") ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === value || parent.alternate === value)) ||
      (isNodeOfType(parent, "SequenceExpression") &&
        parent.expressions.at(-OWNED_INPUT_SINGLE_COUNT) === value)
    )
      return hasCallableAcquisitionUse(parent, visited);
    if (isNodeOfType(parent, "CallExpression")) {
      const callee = stripParenExpression(parent.callee);
      if (isNodeOfType(callee, "Identifier")) {
        const binding = module.scopes.symbolFor(callee);
        const ownFunction =
          binding && hasReadonlyCompleteReferences(binding, module)
            ? resolveExactLocalFunction(callee, module.scopes)
            : null;
        if (
          ownFunction &&
          isFunctionLike(ownFunction) &&
          findProgramRoot(ownFunction) === module.programNode
        ) {
          if (
            isOwnedObjectCallbackDataConsumer({
              call: parent,
              argument: value,
              module,
              isNativeValue: isNativeResult,
              isKnownCallableReceiver,
            })
          )
            return false;
          const argumentIndex = parent.arguments.findIndex((argument) => argument === value);
          const parameter = ownFunction.params[argumentIndex];
          const symbol = isNodeOfType(parameter, "Identifier")
            ? module.scopes.symbolFor(parameter)
            : null;
          if (!symbol || !hasReadonlyCompleteReferences(symbol, module)) return true;
          if (visited.has(symbol)) return false;
          visited.add(symbol);
          return symbol.references.some(
            (reference) =>
              isRuntimeReference(reference.identifier) &&
              hasCallableAcquisitionUse(reference.identifier, new Set(visited)),
          );
        }
      }
      return (
        isNodeOfType(callee, "MemberExpression") &&
        (OWNED_INPUT_CALLABLE_ARGUMENT_NAMES.has(
          getResolvedStaticPropertyName(callee, module.scopes) ?? "",
        ) ||
          OWNED_INPUT_CALLABLE_TRANSPORT_NAMES.has(
            getResolvedStaticPropertyName(callee, module.scopes) ?? "",
          ))
      );
    }
    return false;
  };
  let poisoned = false;
  walkAst(module.programNode, (node) => {
    if (poisoned) return false;
    if (OWNED_INPUT_RUNTIME_TYPES.has(node.type)) {
      poisoned = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "ExportAllDeclaration") ||
        isNodeOfType(node, "ExportNamedDeclaration")) &&
      node.exportKind !== "type"
    ) {
      if (
        (isNodeOfType(node, "ExportAllDeclaration") && node.exported && !isDataNamespace(node)) ||
        (node.source && OWNED_INPUT_PROVIDER_SOURCES.includes(node.source.value))
      )
        poisoned = true;
    }
    if (isNodeOfType(node, "ImportDeclaration") && node.importKind !== "type") {
      if (
        node.source.value.startsWith(".") &&
        node.specifiers.some((specifier) => isNodeOfType(specifier, "ImportNamespaceSpecifier")) &&
        !isDataNamespace(node)
      )
        poisoned = true;
      if (node.source.value.startsWith("node:") || ["vm", "module"].includes(node.source.value))
        poisoned = true;
      if (node.source.value === "react-dom") {
        for (const specifier of node.specifiers) {
          const symbol = module.scopes.symbolFor(specifier.local);
          if (!symbol || !hasReadonlyCompleteReferences(symbol, module)) {
            poisoned = true;
            break;
          }
          if (
            isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
            getImportedName(specifier) === "default"
          ) {
            if (
              hasPossibleStaticPropertyMutationOrEscape(
                specifier.local,
                "createPortal",
                module.scopes,
              )
            )
              poisoned = true;
          } else if (
            getImportedName(specifier) === "createPortal" &&
            symbol.references.some((reference) => {
              if (!isRuntimeReference(reference.identifier)) return false;
              const value = findTransparentExpressionRoot(reference.identifier);
              return (
                !isNodeOfType(value.parent, "CallExpression") ||
                value.parent.callee !== value ||
                value.parent.optional
              );
            })
          )
            poisoned = true;
        }
      }
      if (node.source.value === "prop-types") {
        for (const specifier of node.specifiers) {
          if (
            !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
            !isNodeOfType(specifier, "ImportNamespaceSpecifier") &&
            getImportedName(specifier) !== "default"
          )
            continue;
          const symbol = module.scopes.symbolFor(specifier.local);
          if (
            !symbol ||
            !hasReadonlyCompleteReferences(symbol, module) ||
            hasPossibleStaticPropertyMutationOrEscape(specifier.local, "instanceOf", module.scopes)
          )
            poisoned = true;
        }
      }
      if (node.source.value === "styled-components") {
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            poisoned = true;
            break;
          }
          if (
            !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
            !["styled", "default"].includes(getImportedName(specifier) ?? "")
          )
            continue;
          const symbol = module.scopes.symbolFor(specifier.local);
          if (!symbol || !hasReadonlyCompleteReferences(symbol, module)) {
            poisoned = true;
            break;
          }
          for (const reference of symbol.references) {
            if (!isRuntimeReference(reference.identifier)) continue;
            let factoryUse = findTransparentExpressionRoot(reference.identifier);
            while (
              isNodeOfType(factoryUse.parent, "MemberExpression") &&
              factoryUse.parent.object === factoryUse &&
              !factoryUse.parent.optional &&
              getResolvedStaticPropertyName(factoryUse.parent, module.scopes) !== null &&
              !isMemberMutationTarget(factoryUse.parent)
            )
              factoryUse = findTransparentExpressionRoot(factoryUse.parent);
            while (
              isNodeOfType(factoryUse.parent, "CallExpression") &&
              factoryUse.parent.callee === factoryUse &&
              !factoryUse.parent.optional
            ) {
              factoryUse = findTransparentExpressionRoot(factoryUse.parent);
              while (
                isNodeOfType(factoryUse.parent, "MemberExpression") &&
                factoryUse.parent.object === factoryUse &&
                !factoryUse.parent.optional &&
                getResolvedStaticPropertyName(factoryUse.parent, module.scopes) !== null &&
                !isMemberMutationTarget(factoryUse.parent)
              )
                factoryUse = findTransparentExpressionRoot(factoryUse.parent);
            }
            if (
              !isNodeOfType(factoryUse.parent, "TaggedTemplateExpression") ||
              factoryUse.parent.tag !== factoryUse
            )
              poisoned = true;
          }
        }
      }
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getResolvedStaticPropertyName(node, module.scopes);
      if (node.computed) {
        const possibleNames = getFiniteStaticStringValues(node.property, { scopes: module.scopes });
        if (
          [...possibleNames].some(
            (possibleName) =>
              possibleName === "prototype" ||
              (OBJECT_PROTOTYPE_PROPERTY_NAMES.has(possibleName) &&
                !OWNED_INPUT_PASSIVE_PROTOTYPE_NAMES.has(possibleName)),
          )
        )
          poisoned = true;
        if (
          name === null &&
          (isKnownCallableReceiver(node.object) ||
            (hasCallableAcquisitionUse(node) &&
              !isReadonlyCssCallableRecordUse({ lookup: node, module, index })))
        )
          poisoned = true;
      }
      if (
        (node.computed &&
          name === null &&
          isMemberMutationTarget(node) &&
          isNativeResult(node.object)) ||
        name === "prototype" ||
        (name !== null &&
          OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name) &&
          !OWNED_INPUT_PASSIVE_PROTOTYPE_NAMES.has(name)) ||
        (isMemberMutationTarget(node) &&
          name !== null &&
          OWNED_INPUT_PROTECTED_NATIVE_MEMBERS.has(name))
      )
        poisoned = true;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (
        node.computed &&
        [...getFiniteStaticStringValues(node.key, { scopes: module.scopes })].some(
          (possibleName) =>
            possibleName === "prototype" ||
            (OBJECT_PROTOTYPE_PROPERTY_NAMES.has(possibleName) &&
              !OWNED_INPUT_PASSIVE_PROTOTYPE_NAMES.has(possibleName)),
        )
      )
        poisoned = true;
      const patternOwner = node.parent.parent;
      const source =
        isNodeOfType(patternOwner, "VariableDeclarator") && patternOwner.id === node.parent
          ? patternOwner.init
          : isNodeOfType(patternOwner, "AssignmentExpression") && patternOwner.left === node.parent
            ? patternOwner.right
            : null;
      if (
        (name === null && source && isNativeResult(source)) ||
        name === "prototype" ||
        (name !== null && OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name))
      )
        poisoned = true;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "MemberExpression")) {
        const receiver = stripParenExpression(callee.object);
        const name = getResolvedStaticPropertyName(callee, module.scopes);
        if (
          isNodeOfType(receiver, "Identifier") &&
          !module.scopes.symbolFor(receiver) &&
          receiver.name === "Object" &&
          (name === "defineProperty" ||
            name === "defineProperties" ||
            name === "assign" ||
            name === "setPrototypeOf")
        ) {
          const target = node.arguments[OWNED_INPUT_FIRST_INDEX];
          if (name === "assign") {
            if (
              !isNodeOfType(target, "ObjectExpression") ||
              target.properties.length !== OWNED_INPUT_EMPTY_COUNT
            )
              poisoned = true;
          } else if (name === "defineProperty") {
            const key = node.arguments[OWNED_INPUT_SINGLE_COUNT];
            if (
              !isNodeOfType(key, "Literal") ||
              typeof key.value !== "string" ||
              OWNED_INPUT_PROTECTED_NATIVE_MEMBERS.has(key.value) ||
              key.value === "prototype" ||
              OBJECT_PROTOTYPE_PROPERTY_NAMES.has(key.value)
            )
              poisoned = true;
          } else poisoned = true;
        }
      }
    }
    if (
      ((isNodeOfType(node, "Identifier") &&
        isRuntimeReference(node) &&
        module.scopes.referenceFor(node) &&
        module.scopes.symbolFor(node)?.bindingIdentifier !== node &&
        node.name !== "document" &&
        node.name !== "window") ||
        isNodeOfType(node, "MemberExpression") ||
        isNodeOfType(node, "CallExpression")) &&
      isNativeResult(node) &&
      !hasClosedNativeUse(node)
    )
      poisoned = true;
    if (isNodeOfType(node, "Identifier") && isRuntimeReference(node)) {
      if (OWNED_INPUT_LISTENER_NAMES.has(node.name)) poisoned = true;
      if (OWNED_INPUT_TIMER_NAMES.has(node.name)) {
        const value = findTransparentExpressionRoot(node);
        const call = value.parent;
        const callback = isNodeOfType(call, "CallExpression")
          ? call.arguments[OWNED_INPUT_FIRST_INDEX]
          : undefined;
        const callbackSymbol = isNodeOfType(callback, "Identifier")
          ? module.scopes.symbolFor(callback)
          : null;
        const resolvedCallback = callback
          ? resolveExactLocalFunction(callback, module.scopes)
          : null;
        if (
          !module.scopes.isGlobalReference(node) ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== value ||
          call.optional ||
          !callback ||
          !resolvedCallback ||
          (callbackSymbol && !hasReadonlyCompleteReferences(callbackSymbol, module))
        )
          poisoned = true;
      }
      if (
        (node.name === "event" && module.scopes.isGlobalReference(node)) ||
        OWNED_INPUT_REFUSED_GLOBALS.has(node.name) ||
        (node.name === "React" && module.scopes.symbolFor(node)?.kind !== "import")
      )
        poisoned = true;
      if (["Object", "window", "document"].includes(node.name)) {
        const value = findTransparentExpressionRoot(node);
        const parent = value.parent;
        if (
          isNodeOfType(parent, "UnaryExpression") &&
          parent.operator === "typeof" &&
          !module.scopes.symbolFor(node)
        )
          return;
        if (module.scopes.symbolFor(node)) {
          poisoned = true;
          return;
        }
        if (
          node.name === "window" &&
          isNodeOfType(parent, "CallExpression") &&
          parent.arguments[OWNED_INPUT_FIRST_INDEX] === value &&
          isNodeOfType(parent.callee, "MemberExpression") &&
          getResolvedStaticPropertyName(parent.callee, module.scopes) === "defineProperty"
        ) {
          const key = parent.arguments[OWNED_INPUT_SINGLE_COUNT];
          const receiver = stripParenExpression(parent.callee.object);
          if (
            !parent.optional &&
            !parent.callee.optional &&
            isNodeOfType(receiver, "Identifier") &&
            receiver.name === "Object" &&
            module.scopes.isGlobalReference(receiver) &&
            isNodeOfType(key, "Literal") &&
            typeof key.value === "string" &&
            !OWNED_INPUT_PROTECTED_NATIVE_MEMBERS.has(key.value) &&
            !OBJECT_PROTOTYPE_PROPERTY_NAMES.has(key.value)
          )
            return;
        }
        if (
          node.name === "document" &&
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "ObjectPattern") &&
          parent.id.properties.every(
            (property) =>
              isNodeOfType(property, "Property") &&
              !property.computed &&
              getStaticPropertyKeyName(property) === "body",
          )
        )
          return;
        if (
          node.name === "Object" &&
          isNodeOfType(parent, "CallExpression") &&
          parent.arguments.some((argument) => argument === node) &&
          isNodeOfType(parent.callee, "MemberExpression") &&
          getResolvedStaticPropertyName(parent.callee, module.scopes) === "instanceOf"
        ) {
          const receiver = stripParenExpression(parent.callee.object);
          const provider = isNodeOfType(receiver, "Identifier")
            ? module.scopes.symbolFor(receiver)
            : null;
          const declaration = provider ? getImportDeclarationForSymbol(provider) : null;
          if (
            provider &&
            declaration?.source.value === "prop-types" &&
            (isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier") ||
              isNodeOfType(provider.declarationNode, "ImportNamespaceSpecifier") ||
              getImportedName(provider.declarationNode) === "default") &&
            hasReadonlyCompleteReferences(provider, module) &&
            !hasPossibleStaticPropertyMutationOrEscape(receiver, "instanceOf", module.scopes)
          )
            return;
        }
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== value ||
          isMemberMutationTarget(parent)
        ) {
          poisoned = true;
          return;
        }
        const name = getResolvedStaticPropertyName(parent, module.scopes);
        if (
          !name ||
          (node.name === "window" && !OWNED_INPUT_WINDOW_READ_NAMES.has(name)) ||
          (node.name === "document" && !OWNED_INPUT_DOCUMENT_READ_NAMES.has(name))
        ) {
          poisoned = true;
          return;
        }
        if (node.name === "Object") {
          const call = findTransparentExpressionRoot(parent).parent;
          if (
            !OWNED_INPUT_OBJECT_METHOD_NAMES.has(name) ||
            !isNodeOfType(call, "CallExpression") ||
            stripParenExpression(call.callee) !== parent ||
            call.optional
          )
            poisoned = true;
        }
      }
    }
  });
  return poisoned;
};

const hasOwnDataAttrs = (rawCallback: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const callback = stripParenExpression(rawCallback);
  const isOwnDataValue = (rawValue: EsTreeNode, visited = new Set<SymbolDescriptor>()): boolean => {
    const value = stripParenExpression(rawValue);
    if (isNodeOfType(value, "Literal")) return !Object.hasOwn(value, "regex");
    if (isNodeOfType(value, "Identifier")) {
      const symbol = scopes.symbolFor(value);
      if (
        !symbol ||
        visited.has(symbol) ||
        symbol.references.some(
          (reference) =>
            reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
        )
      )
        return false;
      if (symbol.kind === "parameter" || symbol.kind === "import") return true;
      const initializer = getDirectUnreassignedInitializer(symbol);
      if (!initializer) return false;
      visited.add(symbol);
      return isOwnDataValue(initializer, visited);
    }
    if (!isNodeOfType(value, "ObjectExpression")) return false;
    return value.properties.every((property) => {
      if (isNodeOfType(property, "SpreadElement"))
        return (
          isNodeOfType(stripParenExpression(property.argument), "Identifier") &&
          isOwnDataValue(property.argument, new Set(visited))
        );
      return (
        isNodeOfType(property, "Property") &&
        !property.computed &&
        !property.method &&
        property.kind === "init" &&
        getStaticPropertyKeyName(property) !== "__proto__" &&
        isOwnDataValue(property.value, new Set(visited))
      );
    });
  };
  if (isNodeOfType(callback, "ObjectExpression"))
    return callback.properties.every((property) => {
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      )
        return false;
      const name = getStaticPropertyKeyName(property);
      return (
        name !== null &&
        name !== "__proto__" &&
        name !== "value" &&
        !isEventHandlerName(name) &&
        !OWNED_INPUT_RESERVED_ATTRIBUTES.has(name) &&
        isOwnDataValue(property.value)
      );
    });
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== OWNED_INPUT_SINGLE_COUNT
  )
    return false;
  const parameter = callback.params[OWNED_INPUT_FIRST_INDEX];
  if (!isNodeOfType(parameter, "ObjectPattern")) return false;
  const rest = parameter.properties.at(-OWNED_INPUT_SINGLE_COUNT);
  if (!isNodeOfType(rest, "RestElement") || !isNodeOfType(rest.argument, "Identifier"))
    return false;
  for (const property of parameter.properties.slice(
    OWNED_INPUT_FIRST_INDEX,
    -OWNED_INPUT_SINGLE_COUNT,
  )) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    )
      return false;
    const name = getStaticPropertyKeyName(property);
    if (
      name === null ||
      name === "__proto__" ||
      name === "value" ||
      isEventHandlerName(name) ||
      OWNED_INPUT_RESERVED_ATTRIBUTES.has(name) ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
  }
  const returned = getSingleReturnExpression(callback);
  if (!returned || !isNodeOfType(stripParenExpression(returned), "ObjectExpression")) return false;
  const object = stripParenExpression(returned);
  if (!isNodeOfType(object, "ObjectExpression")) return false;
  const spread = object.properties.at(-OWNED_INPUT_SINGLE_COUNT);
  if (
    !isNodeOfType(spread, "SpreadElement") ||
    !isNodeOfType(stripParenExpression(spread.argument), "Identifier") ||
    scopes.symbolFor(stripParenExpression(spread.argument)) !== scopes.symbolFor(rest.argument)
  )
    return false;
  for (const property of object.properties.slice(
    OWNED_INPUT_FIRST_INDEX,
    -OWNED_INPUT_SINGLE_COUNT,
  )) {
    if (!isNodeOfType(property, "Property")) return false;
    const name = getStaticPropertyKeyName(property);
    if (
      name === null ||
      name === "__proto__" ||
      name === "value" ||
      isEventHandlerName(name) ||
      OWNED_INPUT_RESERVED_ATTRIBUTES.has(name) ||
      !isOwnDataValue(property.value)
    )
      return false;
  }
  const symbol = scopes.symbolFor(rest.argument);
  return Boolean(
    symbol &&
    symbol.references.length === OWNED_INPUT_SINGLE_COUNT &&
    symbol.references[OWNED_INPUT_FIRST_INDEX]?.identifier === spread.argument,
  );
};

export const resolveOwnedInputFocusTarget = (
  rawInitializer: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  try {
    const program = findProgramRoot(rawInitializer);
    const filename = context.filename ? path.resolve(context.filename) : undefined;
    if (!program || !filename) return null;
    const rootDirectory = findNearestPackageDirectory(filename);
    if (!rootDirectory) return null;
    const index = buildSourceProjectIndex({
      rootDirectory,
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
    });
    if (!index || index.hasOpaqueMdxConsumerSurface || hasUnindexedRuntimeSource(index))
      return null;
    const currentModule = index.modulesByFilePath.get(path.resolve(filename));
    if (!currentModule) return null;
    const dataNamespaceModules = new Map<SourceProjectModule, boolean>();
    const resolvingDataModules = new Set<SourceProjectModule>();
    const hasDataNamespaceModule = (module: SourceProjectModule): boolean => {
      const cached = dataNamespaceModules.get(module);
      if (cached !== undefined) return cached;
      if (resolvingDataModules.has(module)) return false;
      resolvingDataModules.add(module);
      let supported = true;
      walkAst(module.programNode, (node) => {
        if (!supported) return false;
        if (
          OWNED_INPUT_RUNTIME_TYPES.has(node.type) ||
          isNodeOfType(node, "JSXElement") ||
          isNodeOfType(node, "JSXFragment") ||
          isNodeOfType(node, "NewExpression") ||
          isNodeOfType(node, "ClassDeclaration") ||
          isNodeOfType(node, "ClassExpression") ||
          isNodeOfType(node, "ThisExpression") ||
          isNodeOfType(node, "AssignmentExpression") ||
          isNodeOfType(node, "UpdateExpression")
        ) {
          supported = false;
          return false;
        }
        if (isTypeScriptTypePosition(node)) return false;
        if (isNodeOfType(node, "ImportDeclaration") && node.importKind !== "type") {
          if (node.source.value === "styled-components") {
            for (const specifier of node.specifiers) {
              if (
                !isNodeOfType(specifier, "ImportSpecifier") ||
                getImportedName(specifier) !== "css"
              ) {
                supported = false;
                break;
              }
              const symbol = module.scopes.symbolFor(specifier.local);
              if (
                !symbol ||
                !hasReadonlyCompleteReferences(symbol, module) ||
                symbol.references.some((reference) => {
                  if (!isRuntimeReference(reference.identifier)) return false;
                  const value = findTransparentExpressionRoot(reference.identifier);
                  return (
                    !isNodeOfType(value.parent, "TaggedTemplateExpression") ||
                    value.parent.tag !== value
                  );
                })
              )
                supported = false;
            }
          } else {
            const resolvedPath = index.resolvedSourcePathByNode.get(node);
            const dependency = resolvedPath ? index.modulesByFilePath.get(resolvedPath) : undefined;
            if (
              !node.source.value.startsWith(".") ||
              !dependency ||
              !hasDataNamespaceModule(dependency)
            )
              supported = false;
          }
        }
        if (
          (isNodeOfType(node, "ExportAllDeclaration") ||
            isNodeOfType(node, "ExportNamedDeclaration")) &&
          node.source &&
          node.exportKind !== "type"
        ) {
          const resolvedPath = index.resolvedSourcePathByNode.get(node);
          const dependency = resolvedPath ? index.modulesByFilePath.get(resolvedPath) : undefined;
          if (
            !node.source.value.startsWith(".") ||
            !dependency ||
            !hasDataNamespaceModule(dependency)
          )
            supported = false;
        }
        if (
          isNodeOfType(node, "Identifier") &&
          module.scopes.referenceFor(node) &&
          isRuntimeReference(node) &&
          module.scopes.isGlobalReference(node) &&
          !OWNED_INPUT_DATA_GLOBAL_NAMES.has(node.name)
        )
          supported = false;
        if (
          isNodeOfType(node, "MemberExpression") &&
          node.computed &&
          getResolvedStaticPropertyName(node, module.scopes) === null &&
          (!isNodeOfType(node.property, "Literal") || typeof node.property.value !== "number")
        )
          supported = false;
        if (
          isNodeOfType(node, "Property") &&
          isNodeOfType(node.parent, "ObjectPattern") &&
          getStaticPropertyKeyName(node, { allowComputedString: true }) === null
        )
          supported = false;
      });
      resolvingDataModules.delete(module);
      dataNamespaceModules.set(module, supported);
      return supported;
    };
    const isDataNamespace = (declaration: EsTreeNode): boolean => {
      const resolvedPath = index.resolvedSourcePathByNode.get(declaration);
      const dependency = resolvedPath ? index.modulesByFilePath.get(resolvedPath) : undefined;
      return Boolean(dependency && hasDataNamespaceModule(dependency));
    };
    const sourceTexts = new Map<SourceProjectModule, string>();
    for (const module of index.modulesByFilePath.values()) {
      const sourceText =
        module.programNode === program
          ? context.sourceCode?.getText?.()
          : fs.readFileSync(module.filePath, "utf8");
      if (sourceText === undefined || !hasOwnedInputConfiguration(module, rootDirectory))
        return null;
      sourceTexts.set(module, sourceText);
    }
    const rootManifest = getOwnJson(path.join(rootDirectory, "package.json"));
    if (!rootManifest) return null;
    const rootDependencies = {
      ...(isTsconfigObjectRecord(rootManifest.peerDependencies)
        ? rootManifest.peerDependencies
        : {}),
      ...(isTsconfigObjectRecord(rootManifest.dependencies) ? rootManifest.dependencies : {}),
      ...(isTsconfigObjectRecord(rootManifest.devDependencies) ? rootManifest.devDependencies : {}),
    };
    const styledDeclaration = rootDependencies["styled-components"];
    const hasDeclaredStyledSource =
      typeof styledDeclaration === "string" &&
      OWNED_INPUT_DECLARED_STYLED_PATTERN.test(styledDeclaration);
    const resolvedBindings = new Map<SymbolDescriptor, OwnedInputHost>();
    const resolving = new Set<SymbolDescriptor>();
    const resolveHost = (
      rawValue: EsTreeNode,
      module: SourceProjectModule,
      depth = OWNED_INPUT_EMPTY_COUNT,
    ): OwnedInputHost | null => {
      if (depth > OWNED_INPUT_MAX_RESOLUTION_DEPTH) return null;
      const value = stripParenExpression(rawValue);
      if (isNodeOfType(value, "JSXIdentifier") && /^[a-z]/u.test(value.name))
        return OWNED_INPUT_HOST_NAMES.has(value.name)
          ? { name: value.name, module, binding: null }
          : null;
      if (isNodeOfType(value, "Identifier") || isNodeOfType(value, "JSXIdentifier")) {
        const symbol = module.scopes.symbolFor(value);
        if (!symbol || resolving.has(symbol) || !hasReadonlyCompleteReferences(symbol, module))
          return null;
        const cached = resolvedBindings.get(symbol);
        if (cached) return cached;
        resolving.add(symbol);
        let result: OwnedInputHost | null = null;
        const declaration = getImportDeclarationForSymbol(symbol);
        if (
          declaration &&
          declaration.importKind !== "type" &&
          declaration.source.value.startsWith(".")
        ) {
          const name = isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
            ? "default"
            : getImportedName(symbol.declarationNode);
          const exported = name
            ? resolveCrossFileValueExportWithFilePath(
                module.filePath,
                declaration.source.value,
                name,
                { requireCompleteReexports: true },
              )
            : null;
          const owner = exported ? index.modulesByFilePath.get(exported.filePath) : undefined;
          if (exported && owner && owner.programNode === exported.programNode) {
            const exportedRoot = findTransparentExpressionRoot(exported.exportedNode);
            const exportedParent = exportedRoot.parent;
            const exportedValue =
              isNodeOfType(exportedParent, "VariableDeclarator") &&
              exportedParent.init === exportedRoot &&
              isNodeOfType(exportedParent.id, "Identifier")
                ? exportedParent.id
                : exported.exportedNode;
            if (isNodeOfType(stripParenExpression(exportedValue), "Identifier"))
              result = resolveHost(exportedValue, owner, depth + OWNED_INPUT_SINGLE_COUNT);
            else if (
              isNodeOfType(stripParenExpression(exportedValue), "TaggedTemplateExpression") &&
              isNodeOfType(exportedParent, "ExportDefaultDeclaration") &&
              exportedParent.declaration === exportedRoot
            ) {
              const anonymousValue = stripParenExpression(exportedValue);
              const resolvedAnonymous = resolveHost(
                anonymousValue,
                owner,
                depth + OWNED_INPUT_SINGLE_COUNT,
              );
              if (resolvedAnonymous)
                result = { ...resolvedAnonymous, anonymousOrigin: anonymousValue };
            }
          }
        } else {
          const initializer = getDirectUnreassignedInitializer(symbol);
          if (initializer)
            result = resolveHost(initializer, module, depth + OWNED_INPUT_SINGLE_COUNT);
        }
        resolving.delete(symbol);
        if (result) {
          const bindingResult = { ...result, binding: result.binding ?? symbol };
          resolvedBindings.set(symbol, bindingResult);
          return bindingResult;
        }
        return null;
      }
      if (
        !hasDeclaredStyledSource ||
        !isNodeOfType(value, "TaggedTemplateExpression") ||
        !isProvenStyledComponentExpression(value, module.scopes)
      )
        return null;
      let factory = stripParenExpression(value.tag);
      while (isNodeOfType(factory, "CallExpression")) {
        const attrs = stripParenExpression(factory.callee);
        if (
          !isNodeOfType(attrs, "MemberExpression") ||
          getResolvedStaticPropertyName(attrs, module.scopes) !== "attrs"
        )
          break;
        if (
          factory.optional ||
          attrs.optional ||
          factory.arguments.length !== OWNED_INPUT_SINGLE_COUNT ||
          !hasOwnDataAttrs(factory.arguments[OWNED_INPUT_FIRST_INDEX], module.scopes)
        )
          return null;
        factory = stripParenExpression(attrs.object);
      }
      if (isNodeOfType(factory, "MemberExpression") && !factory.optional && !factory.computed) {
        const receiver = stripParenExpression(factory.object);
        const name = getResolvedStaticPropertyName(factory, module.scopes);
        if (!isNodeOfType(receiver, "Identifier") || !name || !OWNED_INPUT_HOST_NAMES.has(name))
          return null;
        const provider = module.scopes.symbolFor(receiver);
        const declaration = provider ? getImportDeclarationForSymbol(provider) : null;
        return declaration?.source.value === "styled-components" &&
          (isNodeOfType(provider?.declarationNode, "ImportDefaultSpecifier") ||
            getImportedName(provider?.declarationNode ?? receiver) === "styled")
          ? { name, module, binding: null }
          : null;
      }
      if (
        isNodeOfType(factory, "CallExpression") &&
        !factory.optional &&
        factory.arguments.length === OWNED_INPUT_SINGLE_COUNT
      ) {
        const callee = stripParenExpression(factory.callee);
        const provider = isNodeOfType(callee, "Identifier")
          ? module.scopes.symbolFor(callee)
          : null;
        const declaration = provider ? getImportDeclarationForSymbol(provider) : null;
        if (
          declaration?.source.value !== "styled-components" ||
          (!isNodeOfType(provider?.declarationNode, "ImportDefaultSpecifier") &&
            getImportedName(provider?.declarationNode ?? callee) !== "styled")
        )
          return null;
        return resolveHost(
          factory.arguments[OWNED_INPUT_FIRST_INDEX],
          module,
          depth + OWNED_INPUT_SINGLE_COUNT,
        );
      }
      return null;
    };
    const targetOf = (rawValue: EsTreeNode): OwnedInputTarget | null => {
      const value = stripParenExpression(rawValue);
      if (!isNodeOfType(value, "MemberExpression")) return null;
      let current = value;
      let childIndex: number | null = null;
      if (value.computed) {
        const property = stripParenExpression(value.property);
        if (
          !isNodeOfType(property, "Literal") ||
          typeof property.value !== "number" ||
          !Number.isSafeInteger(property.value) ||
          property.value < OWNED_INPUT_EMPTY_COUNT
        )
          return null;
        childIndex = property.value;
        const children = stripParenExpression(value.object);
        if (
          !isNodeOfType(children, "MemberExpression") ||
          getResolvedStaticPropertyName(children, context.scopes) !== "children"
        )
          return null;
        const receiver = stripParenExpression(children.object);
        if (!isNodeOfType(receiver, "MemberExpression")) return null;
        current = receiver;
      }
      if (getResolvedStaticPropertyName(current, context.scopes) !== "current") return null;
      const receiver = stripParenExpression(current.object);
      const ref = isNodeOfType(receiver, "Identifier") ? context.scopes.symbolFor(receiver) : null;
      return ref ? { ref, childIndex } : null;
    };
    const selected = targetOf(rawInitializer);
    if (!selected) return null;
    const refOwner = findEnclosingFunction(selected.ref.bindingIdentifier);
    if (!refOwner || (isFunctionLike(refOwner) && (refOwner.async || refOwner.generator)))
      return null;
    const isGenuineRef = (symbol: SymbolDescriptor): boolean => {
      const initializer = getDirectUnreassignedInitializer(symbol);
      if (!initializer || !hasReadonlyCompleteReferences(symbol, currentModule)) return false;
      const call = stripParenExpression(initializer);
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        !isProvenUnmodifiedReactApiCall(call, "useRef", context.scopes) ||
        call.arguments.length > OWNED_INPUT_SINGLE_COUNT
      )
        return false;
      const argument = call.arguments[OWNED_INPUT_FIRST_INDEX];
      return (
        !argument ||
        (isNodeOfType(argument, "Literal") && argument.value === null) ||
        (isNodeOfType(argument, "Identifier") &&
          argument.name === "undefined" &&
          !context.scopes.symbolFor(argument))
      );
    };
    if (!isGenuineRef(selected.ref)) return null;
    const publications = new Map<SymbolDescriptor, EsTreeNodeOfType<"JSXOpeningElement">[]>();
    walkAst(program, (node) => {
      if (!isNodeOfType(node, "JSXOpeningElement") || findEnclosingFunction(node) !== refOwner)
        return;
      const attribute = getAuthoritativeJsxAttribute(node.attributes, "ref");
      if (!attribute || !isNodeOfType(attribute.value, "JSXExpressionContainer")) return;
      const value = stripParenExpression(attribute.value.expression);
      if (!isNodeOfType(value, "Identifier")) return;
      const symbol = context.scopes.symbolFor(value);
      if (symbol) publications.set(symbol, [...(publications.get(symbol) ?? []), node]);
    });
    const selectedPublications = publications.get(selected.ref);
    if (selectedPublications?.length !== OWNED_INPUT_SINGLE_COUNT) return null;
    const selectedHost = selectedPublications[OWNED_INPUT_FIRST_INDEX];
    const hasClosedAttributes = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
      const names = new Set<string>();
      for (const attribute of opening.attributes) {
        if (
          !isNodeOfType(attribute, "JSXAttribute") ||
          !isNodeOfType(attribute.name, "JSXIdentifier") ||
          names.has(attribute.name.name)
        )
          return false;
        names.add(attribute.name.name);
        if (
          OWNED_INPUT_RESERVED_ATTRIBUTES.has(attribute.name.name) &&
          attribute.name.name !== "ref"
        )
          return false;
      }
      return true;
    };
    const proveOpening = (opening: EsTreeNodeOfType<"JSXOpeningElement">): OwnedInputHost | null =>
      hasClosedAttributes(opening) ? resolveHost(opening.name, currentModule) : null;
    const publishedHost = proveOpening(selectedHost);
    if (!publishedHost) return null;
    let input = selectedHost;
    if (selected.childIndex !== null) {
      if (publishedHost.name !== "div" || !isNodeOfType(selectedHost.parent, "JSXElement"))
        return null;
      let elementIndex = OWNED_INPUT_EMPTY_COUNT;
      let found: EsTreeNodeOfType<"JSXOpeningElement"> | null = null;
      for (const child of selectedHost.parent.children) {
        if (
          isNodeOfType(child, "JSXText") ||
          (isNodeOfType(child, "JSXExpressionContainer") &&
            (isNodeOfType(child.expression, "JSXEmptyExpression") ||
              (isNodeOfType(child.expression, "Literal") &&
                (typeof child.expression.value === "string" ||
                  typeof child.expression.value === "number"))))
        )
          continue;
        if (!isNodeOfType(child, "JSXElement") || !proveOpening(child.openingElement)) return null;
        if (elementIndex === selected.childIndex) {
          found = child.openingElement;
          break;
        }
        elementIndex += OWNED_INPUT_SINGLE_COUNT;
      }
      if (!found) return null;
      input = found;
    }
    if (proveOpening(input)?.name !== "input") return null;
    if (
      isNodeOfType(input.parent, "JSXElement") &&
      input.parent.children.some(
        (child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "",
      )
    )
      return null;
    let returned: EsTreeNode = input.parent ?? input;
    const ancestorRefs = new Set<SymbolDescriptor>([selected.ref]);
    const ownRef = getAuthoritativeJsxAttribute(input.attributes, "ref");
    if (ownRef) {
      if (!isNodeOfType(ownRef.value, "JSXExpressionContainer")) return null;
      const receiver = stripParenExpression(ownRef.value.expression);
      const symbol = isNodeOfType(receiver, "Identifier")
        ? context.scopes.symbolFor(receiver)
        : null;
      if (
        !symbol ||
        !isGenuineRef(symbol) ||
        publications.get(symbol)?.length !== OWNED_INPUT_SINGLE_COUNT
      )
        return null;
      ancestorRefs.add(symbol);
    }
    while (isNodeOfType(returned.parent, "JSXElement")) {
      const opening = returned.parent.openingElement;
      if (!proveOpening(opening)) return null;
      const attribute = getAuthoritativeJsxAttribute(opening.attributes, "ref");
      if (attribute) {
        if (
          !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
          !isNodeOfType(stripParenExpression(attribute.value.expression), "Identifier")
        )
          return null;
        const symbol = context.scopes.symbolFor(stripParenExpression(attribute.value.expression));
        if (
          !symbol ||
          !isGenuineRef(symbol) ||
          publications.get(symbol)?.length !== OWNED_INPUT_SINGLE_COUNT
        )
          return null;
        ancestorRefs.add(symbol);
      }
      returned = returned.parent;
    }
    const returnedExpression = findTransparentExpressionRoot(returned);
    const returnStatement = returnedExpression.parent;
    if (
      !isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument !== returnedExpression ||
      !isNodeOfType(returnStatement.parent, "BlockStatement") ||
      returnStatement.parent.parent !== refOwner ||
      returnStatement.parent.body.at(-OWNED_INPUT_SINGLE_COUNT) !== returnStatement
    )
      return null;
    let hasEarlierAbrupt = false;
    walkAst(refOwner, (node) => {
      if (node !== refOwner && isFunctionLike(node)) return false;
      if (
        (isNodeOfType(node, "ReturnStatement") && node !== returnStatement) ||
        isNodeOfType(node, "ThrowStatement")
      )
        hasEarlierAbrupt = true;
    });
    if (hasEarlierAbrupt) return null;
    const checkedAliases = new Set<SymbolDescriptor>();
    const hasClosedTargetReads = (rawValue: EsTreeNode): boolean => {
      const value = findTransparentExpressionRoot(rawValue);
      const parent = value.parent;
      if (!parent) return false;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === value &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const symbol = context.scopes.symbolFor(parent.id);
        if (
          !symbol ||
          getDirectUnreassignedInitializer(symbol) !== value ||
          !hasReadonlyCompleteReferences(symbol, currentModule)
        )
          return false;
        if (checkedAliases.has(symbol)) return true;
        checkedAliases.add(symbol);
        return symbol.references.every(
          (reference) =>
            !isRuntimeReference(reference.identifier) || hasClosedTargetReads(reference.identifier),
        );
      }
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === value &&
        !isMemberMutationTarget(parent)
      ) {
        const name = getResolvedStaticPropertyName(parent, context.scopes);
        const call = findTransparentExpressionRoot(parent).parent;
        if (name === "focus" || name === "contains")
          return (
            isNodeOfType(call, "CallExpression") &&
            stripParenExpression(call.callee) === parent &&
            !call.optional &&
            call.arguments.length ===
              (name === "focus" ? OWNED_INPUT_EMPTY_COUNT : OWNED_INPUT_SINGLE_COUNT)
          );
        if (name === "children") {
          const indexed = findTransparentExpressionRoot(parent).parent;
          if (
            !isNodeOfType(indexed, "MemberExpression") ||
            !indexed.computed ||
            indexed.object !== findTransparentExpressionRoot(parent)
          )
            return false;
          const property = stripParenExpression(indexed.property);
          return (
            isNodeOfType(property, "Literal") &&
            typeof property.value === "number" &&
            Number.isSafeInteger(property.value) &&
            property.value >= OWNED_INPUT_EMPTY_COUNT &&
            hasClosedTargetReads(indexed)
          );
        }
        return false;
      }
      return (
        (isNodeOfType(parent, "BinaryExpression") && ["===", "!=="].includes(parent.operator)) ||
        (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
        (isNodeOfType(parent, "IfStatement") && parent.test === value) ||
        (isNodeOfType(parent, "LogicalExpression") &&
          parent.operator === "&&" &&
          parent.left === value)
      );
    };
    for (const ref of ancestorRefs) {
      for (const reference of ref.references) {
        if (!isRuntimeReference(reference.identifier)) continue;
        const value = findTransparentExpressionRoot(reference.identifier);
        const parent = value.parent;
        if (
          isNodeOfType(parent, "JSXExpressionContainer") &&
          isNodeOfType(parent.parent, "JSXAttribute") &&
          parent.parent.name.type === "JSXIdentifier" &&
          parent.parent.name.name === "ref" &&
          parent.parent.parent === publications.get(ref)?.[OWNED_INPUT_FIRST_INDEX]
        )
          continue;
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== value ||
          getResolvedStaticPropertyName(parent, context.scopes) !== "current" ||
          isMemberMutationTarget(parent) ||
          !hasClosedTargetReads(parent)
        )
          return null;
      }
    }
    const nativeUsesByModule = new Map<SourceProjectModule, OwnedNativeRefUses>();
    for (const module of index.modulesByFilePath.values()) {
      const nativeUses = collectOwnedNativeRefUses({
        module,
        resolveHostName: (opening, owner) =>
          hasClosedAttributes(opening) ? (resolveHost(opening.name, owner)?.name ?? null) : null,
      });
      const borrowedContainsArguments = collectOwnedForeignContainsUses({
        module,
        index,
        resolveHostName: (opening, owner) => resolveHost(opening.name, owner)?.name ?? null,
      });
      nativeUsesByModule.set(module, {
        nativeRefs: nativeUses.nativeRefs,
        approvedNativeUseNodes: new Set([
          ...nativeUses.approvedNativeUseNodes,
          ...borrowedContainsArguments,
        ]),
      });
    }
    const selectedBindings = new Set(resolvedBindings.keys());
    const selectedOrigins = new Set(
      [...resolvedBindings.values()]
        .map((host) => host.anonymousOrigin ?? host.binding)
        .filter((origin) => origin !== null),
    );
    for (const module of index.modulesByFilePath.values()) {
      walkAst(module.programNode, (node) => {
        if (
          !isNodeOfType(node, "ImportDeclaration") ||
          node.importKind === "type" ||
          !node.source.value.startsWith(".")
        )
          return;
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) continue;
          const result = resolveHost(specifier.local, module);
          if (result?.binding && selectedOrigins.has(result.anonymousOrigin ?? result.binding)) {
            const binding = module.scopes.symbolFor(specifier.local);
            if (binding) selectedBindings.add(binding);
          }
        }
      });
    }
    for (const symbol of selectedBindings) {
      const module = [...index.modulesByFilePath.values()].find(
        (candidate) => candidate.scopes.symbolFor(symbol.bindingIdentifier) === symbol,
      );
      if (!module || !hasReadonlyCompleteReferences(symbol, module)) return null;
      for (const reference of symbol.references) {
        if (!isRuntimeReference(reference.identifier)) continue;
        const value = findTransparentExpressionRoot(reference.identifier);
        const parent = value.parent;
        if (
          (isNodeOfType(parent, "JSXOpeningElement") ||
            isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === value
        )
          continue;
        if (
          isNodeOfType(parent, "ExportSpecifier") ||
          isNodeOfType(parent, "ExportDefaultDeclaration")
        )
          continue;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const result = resolveHost(parent.id, module);
          const binding = module.scopes.symbolFor(parent.id);
          if (
            result?.binding &&
            selectedOrigins.has(result.anonymousOrigin ?? result.binding) &&
            binding
          ) {
            selectedBindings.add(binding);
            continue;
          }
        }
        if (
          isNodeOfType(parent, "CallExpression") &&
          parent.arguments.length === OWNED_INPUT_SINGLE_COUNT &&
          parent.arguments[OWNED_INPUT_FIRST_INDEX] === value
        ) {
          let factoryUse = findTransparentExpressionRoot(parent);
          while (
            isNodeOfType(factoryUse.parent, "MemberExpression") &&
            factoryUse.parent.object === factoryUse &&
            !factoryUse.parent.optional &&
            getResolvedStaticPropertyName(factoryUse.parent, module.scopes) === "attrs"
          ) {
            const attrs = findTransparentExpressionRoot(factoryUse.parent);
            const call = attrs.parent;
            if (
              !isNodeOfType(call, "CallExpression") ||
              call.optional ||
              call.callee !== attrs ||
              call.arguments.length !== OWNED_INPUT_SINGLE_COUNT ||
              !hasOwnDataAttrs(call.arguments[OWNED_INPUT_FIRST_INDEX], module.scopes)
            )
              return null;
            factoryUse = findTransparentExpressionRoot(call);
          }
          const tagged = factoryUse.parent;
          if (
            isNodeOfType(tagged, "TaggedTemplateExpression") &&
            tagged.tag === factoryUse &&
            resolveHost(tagged, module)
          ) {
            const declaration = tagged.parent;
            if (
              isNodeOfType(declaration, "VariableDeclarator") &&
              isNodeOfType(declaration.id, "Identifier")
            ) {
              const binding = module.scopes.symbolFor(declaration.id);
              if (binding && resolveHost(declaration.id, module)) selectedBindings.add(binding);
              continue;
            }
          }
        }
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === value &&
          OWNED_INPUT_METADATA_NAMES.has(
            getResolvedStaticPropertyName(parent, module.scopes) ?? "",
          ) &&
          isNodeOfType(parent.parent, "AssignmentExpression") &&
          parent.parent.left === parent &&
          parent.parent.operator === "="
        )
          continue;
        return null;
      }
    }
    const eventObjects = new Set<SymbolDescriptor>();
    const eventTargets = new Set<SymbolDescriptor>();
    for (const attribute of input.attributes) {
      if (
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        !isEventHandlerName(attribute.name.name)
      )
        continue;
      if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
      const value = stripParenExpression(attribute.value.expression);
      const binding = isNodeOfType(value, "Identifier") ? context.scopes.symbolFor(value) : null;
      if (
        binding &&
        binding.kind !== "import" &&
        !hasReadonlyCompleteReferences(binding, currentModule)
      )
        return null;
      const callback = isFunctionLike(value)
        ? value
        : isNodeOfType(value, "Identifier") && binding?.kind !== "import"
          ? resolveExactLocalFunction(value, context.scopes)
          : null;
      if (!callback || !isFunctionLike(callback) || findProgramRoot(callback) !== program)
        return null;
      if (isNodeOfType(value, "Identifier")) {
        const callbackRoot = findTransparentExpressionRoot(callback);
        const declaration = callbackRoot.parent;
        const origin =
          isNodeOfType(callback, "FunctionDeclaration") && callback.id
            ? context.scopes.symbolFor(callback.id)
            : isNodeOfType(declaration, "VariableDeclarator") &&
                declaration.init === callbackRoot &&
                isNodeOfType(declaration.id, "Identifier")
              ? context.scopes.symbolFor(declaration.id)
              : null;
        if (!origin) return null;
        const callbackAliases = new Set<SymbolDescriptor>([origin]);
        for (const alias of callbackAliases) {
          if (!hasReadonlyCompleteReferences(alias, currentModule)) return null;
          for (const reference of alias.references) {
            if (!isRuntimeReference(reference.identifier)) continue;
            const use = findTransparentExpressionRoot(reference.identifier);
            const parent = use.parent;
            if (
              isNodeOfType(parent, "JSXExpressionContainer") &&
              isNodeOfType(parent.parent, "JSXAttribute") &&
              isNodeOfType(parent.parent.name, "JSXIdentifier") &&
              isEventHandlerName(parent.parent.name.name) &&
              parent.parent.parent === input
            )
              continue;
            if (
              isNodeOfType(parent, "VariableDeclarator") &&
              parent.init === use &&
              isNodeOfType(parent.id, "Identifier")
            ) {
              const nextAlias = context.scopes.symbolFor(parent.id);
              if (nextAlias && getDirectUnreassignedInitializer(nextAlias) === use) {
                callbackAliases.add(nextAlias);
                continue;
              }
            }
            return null;
          }
        }
      }
      if (callback.params.length > OWNED_INPUT_SINGLE_COUNT) return null;
      let readsArguments = false;
      walkAst(callback, (node) => {
        if (
          isNodeOfType(node, "Identifier") &&
          isRuntimeReference(node) &&
          ((node.name === "arguments" && context.scopes.referenceFor(node)) ||
            (node.name === "event" && context.scopes.isGlobalReference(node)))
        )
          readsArguments = true;
      });
      if (readsArguments) return null;
      const parameter = callback.params[OWNED_INPUT_FIRST_INDEX];
      if (!parameter) continue;
      if (isNodeOfType(parameter, "Identifier")) {
        const symbol = context.scopes.symbolFor(parameter);
        if (!symbol) return null;
        eventObjects.add(symbol);
      } else if (isNodeOfType(parameter, "ObjectPattern")) {
        for (const property of parameter.properties) {
          if (!isNodeOfType(property, "Property") || !isNodeOfType(property.value, "Identifier"))
            return null;
          const name = getStaticPropertyKeyName(property, { allowComputedString: true });
          if (
            !name ||
            (!["target", "currentTarget"].includes(name) &&
              !OWNED_INPUT_EVENT_SCALAR_NAMES.has(name))
          )
            return null;
          if (["target", "currentTarget"].includes(name)) {
            const symbol = context.scopes.symbolFor(property.value);
            if (!symbol) return null;
            eventTargets.add(symbol);
          }
        }
      } else return null;
    }
    for (const [module, sourceText] of sourceTexts) {
      const nativeUses = nativeUsesByModule.get(module);
      if (!nativeUses) return null;
      const nativeRefs =
        module === currentModule
          ? new Set([...ancestorRefs, ...nativeUses.nativeRefs])
          : nativeUses.nativeRefs;
      if (
        hasVisibleOwnedInputPoison(
          module,
          sourceText,
          nativeRefs,
          isDataNamespace,
          module === currentModule ? eventObjects : new Set(),
          module === currentModule ? eventTargets : new Set(),
          nativeUses.approvedNativeUseNodes,
          index,
        )
      )
        return null;
    }
    return input;
  } catch {
    return null;
  }
};
