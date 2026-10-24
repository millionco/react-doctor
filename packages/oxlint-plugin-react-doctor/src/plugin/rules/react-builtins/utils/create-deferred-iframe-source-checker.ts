import * as fs from "node:fs";
import { analyzeControlFlow } from "../../../semantic/control-flow-graph.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import type {
  SourceProjectIndex,
  SourceProjectModule,
} from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectFunctionBindingIdentifier } from "../../../utils/get-direct-function-binding-identifier.js";
import { getEquivalentSymbols } from "../../../utils/get-equivalent-symbols.js";
import { collectDeferredIframeFunctionExports } from "./collect-deferred-iframe-function-exports.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxPropStringValue } from "../../../utils/get-jsx-prop-string-value.js";
import { getReactDoctorStringSetting } from "../../../utils/get-react-doctor-setting.js";
import { getStaticArrayExpressionLength } from "../../../utils/get-static-array-expression-length.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getValueImportDeclaration } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import { hasClosedDeferredIframeNativeSurface } from "./has-closed-deferred-iframe-native-surface.js";
import { isDescendantWithoutFunctionBoundary } from "../../../utils/is-descendant-without-function-boundary.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { normalizeFilename } from "../../../utils/normalize-filename.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isRefNotificationNativeEvent } from "../../state-and-effects/utils/is-ref-notification-native-event.js";
import { hasSupportedDeferredIframeRenderUse } from "./has-supported-deferred-iframe-render-use.js";
import { hasPassiveDeferredIframeCapture } from "./has-passive-deferred-iframe-capture.js";
import { hasClosedDeferredIframeNativeRef } from "./has-closed-deferred-iframe-native-ref.js";
import {
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "../../../utils/constants.js";
import {
  DEFERRED_IFRAME_MAX_EVENT_FORWARDING_DEPTH,
  DEFERRED_IFRAME_CLASS_MATCH_INDEX,
  DEFERRED_IFRAME_EXTERNAL_PREFIX_PATTERN,
  DEFERRED_IFRAME_ID_PATTERN,
  DEFERRED_IFRAME_HTML_ID_PATTERN,
  DEFERRED_IFRAME_HTML_ID_START_PATTERN,
  DEFERRED_IFRAME_HTML_ACTIVE_PATTERN,
  DEFERRED_IFRAME_PROP_TYPE_NAMES,
  DEFERRED_IFRAME_SELECTOR_PATTERN,
  DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT,
  DEFERRED_IFRAME_SINGLE_CARRIER_COUNT,
  DEFERRED_IFRAME_SINGLE_SOURCE_QUERY_COUNT,
  DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT,
} from "./constants.js";

interface DeferredIframeModule extends SourceProjectModule {
  readonly sourceText: string;
  readonly cfg: RuleContext["cfg"];
}
interface DeferredIframeCarrierChildren {
  readonly hasNonNativeChildren: boolean;
  readonly directIframeCount: number;
}

interface DeferredIframeComponent {
  readonly module: DeferredIframeModule;
  readonly functionNode: EsTreeNode;
  readonly root: EsTreeNodeOfType<"JSXElement">;
  readonly parameter: EsTreeNodeOfType<"Identifier">;
  readonly uses: ReadonlyArray<EsTreeNodeOfType<"JSXElement">>;
}
interface DeferredIframeItem {
  readonly component: EsTreeNode;
  readonly propName: string;
  readonly memberName: string;
}
interface DeferredIframeIdShape {
  readonly prefix: string;
  readonly suffix: string;
  readonly literal: boolean;
}
interface DeferredIframeProjection {
  readonly collection: SymbolDescriptor;
  readonly owner: EsTreeNode;
}

const directMemberName = (node: EsTreeNode | null | undefined): string | null =>
  node && isNodeOfType(node, "MemberExpression") && !node.computed && !node.optional
    ? getStaticPropertyName(node)
    : null;
const directCall = (node: EsTreeNode | null | undefined, name: string) =>
  node &&
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  directMemberName(node.callee) === name &&
  node.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? node
    : null;
const readonlySymbol = (node: EsTreeNode, module: SourceProjectModule): SymbolDescriptor | null => {
  const symbol = module.scopes.symbolFor(node);
  return symbol &&
    !isErasedTypeScriptBinding(symbol) &&
    hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) &&
    symbol.references.every(
      (reference) =>
        isNonReferenceIdentifier(reference.identifier) ||
        (reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier)),
    )
    ? symbol
    : null;
};
const readonlyInitializer = (node: EsTreeNode, module: SourceProjectModule): EsTreeNode | null => {
  const symbol = readonlySymbol(node, module);
  const declaration = symbol?.declarationNode;
  return symbol?.kind === "const" &&
    declaration &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.id === symbol.bindingIdentifier &&
    declaration.init
    ? stripParenExpression(declaration.init)
    : null;
};
const attributeValue = (opening: EsTreeNodeOfType<"JSXOpeningElement">, name: string) => {
  if (opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
    return null;
  const attribute = getAuthoritativeJsxAttribute(opening.attributes, name);
  const value = attribute?.value;
  return value && isNodeOfType(value, "JSXExpressionContainer")
    ? value.expression
    : (value ?? null);
};
const isPlainJsxUse = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"JSXElement"> =>
  isNodeOfType(node, "JSXElement") &&
  !node.openingElement.attributes.some((attribute) =>
    isNodeOfType(attribute, "JSXSpreadAttribute"),
  ) &&
  !getAuthoritativeJsxAttribute(node.openingElement.attributes, "children") &&
  !getAuthoritativeJsxAttribute(node.openingElement.attributes, "is");
const nativeName = (opening: EsTreeNodeOfType<"JSXOpeningElement">): string | null => {
  const name = resolveJsxElementType(opening);
  return HTML_TAGS.has(name) && !getAuthoritativeJsxAttribute(opening.attributes, "is")
    ? name
    : null;
};
const returnedRoot = (functionNode: EsTreeNode): EsTreeNodeOfType<"JSXElement"> | null => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    ("generator" in functionNode && functionNode.generator)
  )
    return null;
  if (!isNodeOfType(functionNode.body, "BlockStatement"))
    return isPlainJsxUse(functionNode.body) ? functionNode.body : null;
  const statement = functionNode.body.body.at(-1);
  if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) return null;
  let unsupported = false;
  walkAst(functionNode.body, (node) => {
    if (isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node !== statement) unsupported = true;
  });
  const value = stripParenExpression(statement.argument);
  return !unsupported && isPlainJsxUse(value) ? value : null;
};
const staticMetadata = (reference: EsTreeNode, module: DeferredIframeModule): boolean => {
  const member = reference.parent;
  const assignment = member?.parent;
  if (
    directMemberName(member) !== "propTypes" ||
    !member ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== member ||
    !isNodeOfType(assignment.right, "ObjectExpression")
  )
    return false;
  return assignment.right.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      !DEFERRED_IFRAME_PROP_TYPE_NAMES.has(directMemberName(property.value) ?? "") ||
      !isNodeOfType(property.value, "MemberExpression") ||
      !isNodeOfType(property.value.object, "Identifier")
    )
      return false;
    const symbol = readonlySymbol(property.value.object, module);
    const imported = symbol && getValueImportDeclaration(symbol);
    return Boolean(
      symbol &&
      imported &&
      isNodeOfType(imported, "ImportDeclaration") &&
      imported.source.value === "prop-types" &&
      isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      !resolveModulePath(module.filePath, "prop-types") &&
      symbol.references.every((candidate) =>
        DEFERRED_IFRAME_PROP_TYPE_NAMES.has(directMemberName(candidate.identifier.parent) ?? ""),
      ),
    );
  });
};

export const createDeferredIframeSourceChecker = (context: RuleContext) => {
  let modules: ReadonlyArray<DeferredIframeModule> | null | undefined;
  const modulesByProgram = new Map<EsTreeNode | null, DeferredIframeModule>();
  const modulesByFilePath = new Map<string, DeferredIframeModule>();
  let index: SourceProjectIndex | null = null;
  let documentLookups: ReadonlyArray<EsTreeNode> | undefined;
  let sourceQueryClass: string | null = null;
  let nativeCarrierCounts: ReadonlyMap<string, number> | undefined;
  const mapProofsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();
  const metadataMapCallsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();
  const exportsByScopes = new WeakMap<
    ScopeAnalysis,
    WeakMap<EsTreeNode, ReadonlyMap<EsTreeNode, ReadonlySet<string>>>
  >();
  const noRuntimeExports: ReadonlySet<string> = new Set();
  const runtimeFunctionExports = (functionNode: EsTreeNode, module: SourceProjectModule) => {
    let exportsByProgram = exportsByScopes.get(module.scopes);
    if (!exportsByProgram) {
      exportsByProgram = new WeakMap();
      exportsByScopes.set(module.scopes, exportsByProgram);
    }
    let exports = exportsByProgram.get(module.programNode);
    if (!exports) {
      exports = collectDeferredIframeFunctionExports(module);
      exportsByProgram.set(module.programNode, exports);
    }
    return exports.get(functionNode) ?? noRuntimeExports;
  };
  const htmlSources: string[] = [];
  const components = new Map<EsTreeNode, DeferredIframeComponent | null>();
  const carrierChildrenByComponent = new WeakMap<
    DeferredIframeComponent,
    DeferredIframeCarrierChildren
  >();
  const nativeRefUses = new Map<SymbolDescriptor, boolean>();
  const moduleFor = (filePath: string) => modulesByFilePath.get(filePath);
  const reachable = (node: EsTreeNode, module: DeferredIframeModule) =>
    isNodeReachableWithinFunction(node, { ...context, scopes: module.scopes, cfg: module.cfg });
  const resolveComponent = (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    module: DeferredIframeModule,
  ): Pick<DeferredIframeComponent, "module" | "functionNode"> | null => {
    if (!isNodeOfType(opening.name, "JSXIdentifier")) return null;
    const symbol = module.scopes.symbolFor(opening.name);
    if (!symbol || isErasedTypeScriptBinding(symbol)) return null;
    if (symbol.kind !== "import") {
      const initializer = symbol.initializer;
      return initializer && isFunctionLike(initializer)
        ? { module, functionNode: initializer }
        : null;
    }
    const imported = readonlySymbol(opening.name, module) && getValueImportDeclaration(symbol);
    if (
      !imported ||
      !isNodeOfType(imported, "ImportDeclaration") ||
      typeof imported.source.value !== "string" ||
      !/^\.\.?\//u.test(imported.source.value)
    )
      return null;
    const exportedName = isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
      ? "default"
      : getImportedName(symbol.declarationNode);
    if (!exportedName) return null;
    const resolved = resolveCrossFileFunctionExportWithFilePath(
      module.filePath,
      imported.source.value,
      exportedName,
    );
    const owner = resolved && moduleFor(normalizeFilename(resolved.filePath));
    return resolved && owner && resolved.programNode === owner.programNode
      ? { module: owner, functionNode: resolved.functionNode }
      : null;
  };
  const componentUses = (functionNode: EsTreeNode, owner: DeferredIframeModule) => {
    const uses = new Set<EsTreeNodeOfType<"JSXElement">>();
    const binding = getDirectFunctionBindingIdentifier(functionNode);
    if (!binding) return null;
    const symbols = getEquivalentSymbols(binding, owner.scopes);
    if (
      symbols.length === 0 ||
      symbols.some(
        (symbol) =>
          isErasedTypeScriptBinding(symbol) ||
          !hasCompleteSymbolReferences(symbol, owner.programNode, owner.scopes) ||
          symbol.references.some(
            (reference) =>
              reference.flag !== "read" ||
              (isWithinAssignmentTarget(reference.identifier) &&
                !staticMetadata(reference.identifier, owner)),
          ),
      )
    )
      return null;
    const classify = (
      reference: EsTreeNode,
      module: DeferredIframeModule,
      allowExport: boolean,
    ) => {
      if (isNonReferenceIdentifier(reference)) return true;
      const parent = reference.parent;
      if (
        parent &&
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === reference &&
        isPlainJsxUse(parent.parent)
      ) {
        uses.add(parent.parent);
        return true;
      }
      return (
        allowExport &&
        (staticMetadata(reference, module) ||
          isNodeOfType(parent, "ExportDefaultDeclaration") ||
          isNodeOfType(parent, "ExportSpecifier"))
      );
    };
    for (const symbol of symbols)
      for (const reference of symbol.references)
        if (!classify(reference.identifier, owner, true)) return null;
    const exports = runtimeFunctionExports(functionNode, owner);
    if (exports.size === 0) return [...uses];
    for (const consumer of index?.consumerModulesByFilePath.get(owner.filePath) ?? []) {
      const module = moduleFor(consumer.filePath);
      if (!module) return null;
      for (const statement of module.programNode.body) {
        if (
          (isNodeOfType(statement, "ExportNamedDeclaration") ||
            isNodeOfType(statement, "ExportAllDeclaration")) &&
          statement.source &&
          index?.resolvedSourcePathByNode.get(statement) === owner.filePath
        )
          return null;
        if (
          !isNodeOfType(statement, "ImportDeclaration") ||
          index?.resolvedSourcePathByNode.get(statement) !== owner.filePath
        )
          continue;
        for (const specifier of statement.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) return null;
          const name = isNodeOfType(specifier, "ImportDefaultSpecifier")
            ? "default"
            : getImportedName(specifier);
          if (!name || !exports.has(name)) continue;
          const symbol = readonlySymbol(specifier.local, module);
          if (!symbol || !getValueImportDeclaration(symbol)) return null;
          for (const reference of symbol.references)
            if (!classify(reference.identifier, module, false)) return null;
        }
      }
    }
    return [...uses];
  };
  const component = (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    module: DeferredIframeModule,
  ) => {
    if (getAuthoritativeJsxAttribute(opening.attributes, "ref")) return null;
    const resolved = resolveComponent(opening, module);
    if (!resolved) return null;
    const cached = components.get(resolved.functionNode);
    if (cached !== undefined) return cached;
    components.set(resolved.functionNode, null);
    const functionNode = resolved.functionNode;
    const root = returnedRoot(functionNode);
    const parameter = isFunctionLike(functionNode) ? functionNode.params[0] : null;
    const uses = componentUses(functionNode, resolved.module);
    if (
      !root ||
      nativeName(root.openingElement) !== "div" ||
      !parameter ||
      !isNodeOfType(parameter, "Identifier") ||
      !readonlySymbol(parameter, resolved.module) ||
      !uses ||
      !reachable(root, resolved.module)
    )
      return null;
    const forwards = root.children.filter(
      (child) =>
        isNodeOfType(child, "JSXExpressionContainer") &&
        directMemberName(child.expression) === "children" &&
        isNodeOfType(child.expression, "MemberExpression") &&
        resolved.module.scopes.symbolFor(child.expression.object) ===
          resolved.module.scopes.symbolFor(parameter),
    );
    if (forwards.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT) return null;
    const parameterSymbol = readonlySymbol(parameter, resolved.module);
    if (
      !parameterSymbol ||
      !parameterSymbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const member = reference.identifier.parent;
        if (
          !member ||
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== reference.identifier ||
          !directMemberName(member)
        )
          return false;
        return (
          directMemberName(member) !== "children" ||
          forwards.some(
            (forward) =>
              isNodeOfType(forward, "JSXExpressionContainer") && forward.expression === member,
          )
        );
      })
    )
      return null;
    let invalid = false;
    walkAst(root, (node) => {
      if (
        isNodeOfType(node, "JSXExpressionContainer") &&
        !forwards.some((forward) => forward === node) &&
        !isNodeOfType(node.parent, "JSXAttribute")
      )
        invalid = true;
      if (isNodeOfType(node, "JSXOpeningElement") && !nativeName(node)) invalid = true;
    });
    if (invalid) return null;
    const result = { ...resolved, root, parameter, uses };
    components.set(functionNode, result);
    return result;
  };
  const supportedMap = (
    invocation: EsTreeNodeOfType<"CallExpression">,
    owner: SourceProjectModule,
  ): boolean => {
    if (
      invocation.arguments.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
      !isNodeOfType(invocation.callee, "MemberExpression")
    )
      return false;
    const receiver = stripParenExpression(invocation.callee.object);
    const literalLength = getStaticArrayExpressionLength(receiver);
    if (literalLength !== null) return literalLength > 0;
    if (!isNodeOfType(receiver, "Identifier")) return false;
    const symbol = readonlySymbol(receiver, owner);
    if (
      !symbol ||
      !symbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const member = reference.identifier.parent;
        const call = member && directCall(member.parent, "map");
        return Boolean(
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference.identifier &&
          call &&
          call.callee === member,
        );
      })
    )
      return false;
    if (symbol.kind !== "parameter") {
      const initializer = readonlyInitializer(receiver, owner);
      const length = getStaticArrayExpressionLength(initializer);
      if (length !== null) return length > 0;
    }
    const originModule = moduleFor(owner.filePath);
    if (!originModule) return false;
    const origin = itemOrigin(invocation.callee, originModule);
    if (!origin) return false;
    const uses = componentUses(origin.component, originModule);
    if (!uses) return false;
    if (uses.length === 0) return runtimeFunctionExports(origin.component, owner).size > 0;
    const values = new Map<EsTreeNode, DeferredIframeModule>();
    for (const use of uses) {
      const useModule = modulesByProgram.get(findProgramRoot(use));
      const value = attributeValue(use.openingElement, origin.propName);
      if (!useModule || !value) return false;
      values.set(value, useModule);
    }
    return [...values].every(([value, module]) => {
      const directLength = getStaticArrayExpressionLength(value);
      if (directLength !== null) return directLength > 0;
      if (!isNodeOfType(value, "Identifier")) return false;
      const arraySymbol = readonlySymbol(value, module);
      if (
        !arraySymbol ||
        !arraySymbol.references.every((reference) => {
          if (isNonReferenceIdentifier(reference.identifier) || values.has(reference.identifier))
            return true;
          const member = reference.identifier.parent;
          return (
            isNodeOfType(member, "MemberExpression") &&
            member.object === reference.identifier &&
            !member.optional &&
            !member.computed &&
            directMemberName(member) === "length"
          );
        })
      )
        return false;
      const length = getStaticArrayExpressionLength(readonlyInitializer(value, module));
      return length !== null && length > 0;
    });
  };
  const supportedRenderUse = (node: EsTreeNode, module: DeferredIframeModule) =>
    hasSupportedDeferredIframeRenderUse(node, module, {
      moduleForNode: (use) => {
        const program = findProgramRoot(use);
        return modulesByProgram.get(program) ?? null;
      },
      isExportedFunction: (functionNode, owner) =>
        runtimeFunctionExports(functionNode, owner).size > 0,
      componentUses: (functionNode, owner) => {
        const source = moduleFor(owner.filePath);
        return source ? componentUses(functionNode, source) : null;
      },
      forwardedRoot: (opening, owner) => {
        const source = moduleFor(owner.filePath);
        return source ? component(opening, source) : null;
      },
      supportedMap: (invocation, owner) => {
        let proofs = mapProofsByScopes.get(owner.scopes);
        if (!proofs) {
          proofs = new WeakMap();
          mapProofsByScopes.set(owner.scopes, proofs);
        }
        const cached = proofs.get(invocation);
        if (cached !== undefined) return cached;
        let metadataCalls = metadataMapCallsByScopes.get(owner.scopes);
        if (!metadataCalls) {
          metadataCalls = new WeakMap();
          metadataMapCallsByScopes.set(owner.scopes, metadataCalls);
        }
        let hasMetadata = metadataCalls.get(invocation);
        if (hasMetadata === undefined) {
          const originModule = moduleFor(owner.filePath);
          const origin =
            originModule && isNodeOfType(invocation.callee, "MemberExpression")
              ? itemOrigin(invocation.callee, originModule)
              : null;
          const binding = origin && getDirectFunctionBindingIdentifier(origin.component);
          hasMetadata = Boolean(
            binding &&
            getEquivalentSymbols(binding, owner.scopes).some((symbol) =>
              symbol.references.some(
                (reference) => directMemberName(reference.identifier.parent) === "propTypes",
              ),
            ),
          );
          metadataCalls.set(invocation, hasMetadata);
        }
        const supported = supportedMap(invocation, owner);
        if (!hasMetadata) proofs.set(invocation, supported);
        return supported;
      },
      passiveCapture: (opening, owner) =>
        hasPassiveDeferredIframeCapture(opening, {
          module: owner,
          getReadonlySymbol: (identifier) => readonlySymbol(identifier, owner),
          getReadonlyInitializer: (identifier) => readonlyInitializer(identifier, owner),
        }),
    });
  const carrierClass = (
    iframe: EsTreeNodeOfType<"JSXOpeningElement">,
    module: DeferredIframeModule,
  ) => {
    const frame = iframe.parent;
    const parent = frame?.parent;
    if (!isNodeOfType(parent, "JSXElement") || !isPlainJsxUse(parent)) return null;
    const wrapper = nativeName(parent.openingElement)
      ? null
      : component(parent.openingElement, module);
    if (!nativeName(parent.openingElement) && !wrapper) return null;
    const root = wrapper?.root ?? parent;
    if (nativeName(root.openingElement) !== "div") return null;
    const attribute = getAuthoritativeJsxAttribute(root.openingElement.attributes, "className");
    const className = attribute ? getJsxPropStringValue(attribute) : "";
    if (className === null) return null;
    let wrapperIframeCount = 0;
    if (wrapper) {
      let children = carrierChildrenByComponent.get(wrapper);
      if (!children) {
        const hasNonNativeChildren = wrapper.uses.some((use) =>
          use.children.some(
            (child) =>
              !isNodeOfType(child, "JSXText") &&
              (!isNodeOfType(child, "JSXElement") || !nativeName(child.openingElement)),
          ),
        );
        let directIframeCount = 0;
        if (!hasNonNativeChildren)
          for (const use of wrapper.uses)
            for (const child of use.children)
              if (
                isNodeOfType(child, "JSXElement") &&
                nativeName(child.openingElement) === "iframe"
              )
                directIframeCount += DEFERRED_IFRAME_SINGLE_CARRIER_COUNT;
        children = { hasNonNativeChildren, directIframeCount };
        carrierChildrenByComponent.set(wrapper, children);
      }
      if (children.hasNonNativeChildren) return null;
      wrapperIframeCount = children.directIframeCount;
    }
    return { classes: className.split(/\s+/u), parent, wrapperIframeCount };
  };
  const itemOrigin = (
    expression: EsTreeNode,
    module: DeferredIframeModule,
  ): DeferredIframeItem | null => {
    if (
      !isNodeOfType(expression, "MemberExpression") ||
      !directMemberName(expression) ||
      !isNodeOfType(expression.object, "Identifier")
    )
      return null;
    const symbol = readonlySymbol(expression.object, module);
    if (
      !symbol ||
      !symbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const member = reference.identifier.parent;
        return (
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference.identifier &&
          directMemberName(member) !== null
        );
      })
    )
      return null;
    const owner = findEnclosingFunction(symbol.bindingIdentifier);
    if (!owner || !isFunctionLike(owner)) return null;
    const parameter = owner.params[0];
    if (symbol.kind === "parameter" && isNodeOfType(parameter, "ObjectPattern")) {
      const property = parameter.properties.find(
        (candidate) =>
          isNodeOfType(candidate, "Property") &&
          !candidate.computed &&
          candidate.kind === "init" &&
          candidate.value === symbol.bindingIdentifier,
      );
      const propName =
        property && isNodeOfType(property, "Property") ? getStaticPropertyKeyName(property) : null;
      return propName
        ? { component: owner, propName, memberName: directMemberName(expression) ?? "" }
        : null;
    }
    const initializer = readonlyInitializer(expression.object, module);
    return initializer &&
      isNodeOfType(initializer, "MemberExpression") &&
      directMemberName(initializer) &&
      isNodeOfType(parameter, "Identifier") &&
      readonlySymbol(parameter, module) &&
      module.scopes.symbolFor(initializer.object) === module.scopes.symbolFor(parameter)
      ? {
          component: owner,
          propName: directMemberName(initializer) ?? "",
          memberName: directMemberName(expression) ?? "",
        }
      : null;
  };
  const projection = (
    use: EsTreeNodeOfType<"JSXElement">,
    propName: string,
    module: DeferredIframeModule,
  ): DeferredIframeProjection | null => {
    const value = attributeValue(use.openingElement, propName);
    if (!value || !isNodeOfType(value, "Identifier")) return null;
    const item = readonlySymbol(value, module);
    if (
      !item ||
      !item.references.every(
        (reference) =>
          isNonReferenceIdentifier(reference.identifier) || reference.identifier === value,
      )
    )
      return null;
    let callback = findEnclosingFunction(use);
    if (callback && isNodeOfType(callback.parent, "JSXExpressionContainer"))
      callback = findEnclosingFunction(callback);
    if (
      !callback ||
      !isFunctionLike(callback) ||
      callback.async ||
      ("generator" in callback && callback.generator) ||
      callback.params[0] !== item.bindingIdentifier ||
      !isNodeOfType(callback.body, "JSXElement")
    )
      return null;
    const call = directCall(callback.parent, "map");
    if (
      !call ||
      call.arguments[0] !== callback ||
      call.arguments.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
      !isNodeOfType(call.callee, "MemberExpression") ||
      !isNodeOfType(call.callee.object, "Identifier")
    )
      return null;
    const collection = readonlySymbol(call.callee.object, module);
    const owner = findEnclosingFunction(call);
    let projectionParent = call.parent;
    while (projectionParent && projectionParent !== owner) {
      if (
        isNodeOfType(projectionParent, "ConditionalExpression") ||
        isNodeOfType(projectionParent, "LogicalExpression")
      )
        return null;
      projectionParent = projectionParent.parent;
    }
    const closedCollection =
      collection &&
      collection.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const member = reference.identifier.parent;
        return (
          member &&
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference.identifier &&
          Boolean(directCall(member.parent, "map"))
        );
      });
    return collection && closedCollection && owner && reachable(use, module)
      ? { collection, owner }
      : null;
  };
  const linkedIds = (
    selector: EsTreeNode,
    id: EsTreeNode,
    module: DeferredIframeModule,
  ): boolean => {
    if (
      isNodeOfType(selector, "Literal") &&
      typeof selector.value === "string" &&
      isNodeOfType(id, "Literal") &&
      typeof id.value === "string"
    )
      return DEFERRED_IFRAME_ID_PATTERN.test(selector.value) && selector.value === `#${id.value}`;
    if (
      !isNodeOfType(selector, "TemplateLiteral") ||
      !isNodeOfType(id, "TemplateLiteral") ||
      selector.expressions.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
      id.expressions.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
      selector.quasis[0]?.value.cooked !== `#${id.quasis[0]?.value.cooked}` ||
      selector.quasis.at(-1)?.value.cooked !== "" ||
      id.quasis.at(-1)?.value.cooked !== "" ||
      !DEFERRED_IFRAME_ID_PATTERN.test(`${selector.quasis[0]?.value.cooked}x`)
    )
      return false;
    const sourceValue = selector.expressions[0];
    const targetValue = id.expressions[0];
    if (!sourceValue || !targetValue) return false;
    const source = itemOrigin(sourceValue, module);
    const target = itemOrigin(targetValue, module);
    if (!source || !target || source.memberName !== target.memberName) return false;
    const sourceUses = componentUses(source.component, module);
    const targetUses = componentUses(target.component, module);
    if (!sourceUses?.length || !targetUses?.length) return false;
    const routes = sourceUses.map((use) => projection(use, source.propName, module));
    const targets = targetUses.map((use) => projection(use, target.propName, module));
    const first = routes[0];
    return Boolean(
      first &&
      [...routes, ...targets].every(
        (route) => route && route.collection === first.collection && route.owner === first.owner,
      ),
    );
  };
  const outerId = (parent: EsTreeNodeOfType<"JSXElement">, module: DeferredIframeModule) => {
    const outer = parent.parent;
    if (!isNodeOfType(outer, "JSXElement") || !isPlainJsxUse(outer)) return null;
    if (nativeName(outer.openingElement))
      return nativeName(outer.openingElement) === "div"
        ? attributeValue(outer.openingElement, "id")
        : null;
    const wrapper = component(outer.openingElement, module);
    if (!wrapper) return null;
    const id = attributeValue(wrapper.root.openingElement, "id");
    if (
      !id ||
      directMemberName(id) !== "id" ||
      !isNodeOfType(id, "MemberExpression") ||
      wrapper.module.scopes.symbolFor(id.object) !==
        wrapper.module.scopes.symbolFor(wrapper.parameter)
    )
      return null;
    return attributeValue(outer.openingElement, "id");
  };
  const externalValue = (node: EsTreeNode, module: DeferredIframeModule): boolean => {
    const value = isNodeOfType(node, "Identifier") ? readonlyInitializer(node, module) : node;
    if (!value) return false;
    if (isNodeOfType(value, "Literal") && typeof value.value === "string")
      return DEFERRED_IFRAME_EXTERNAL_PREFIX_PATTERN.test(value.value);
    return (
      isNodeOfType(value, "BinaryExpression") &&
      value.operator === "+" &&
      isNodeOfType(value.left, "Literal") &&
      typeof value.left.value === "string" &&
      DEFERRED_IFRAME_EXTERNAL_PREFIX_PATTERN.test(value.left.value) &&
      isNodeOfType(value.right, "MemberExpression")
    );
  };
  const closedNativeRef = (
    identifier: EsTreeNode,
    module: DeferredIframeModule,
    className: string,
  ): boolean => {
    const symbol = readonlySymbol(identifier, module);
    if (!symbol) return false;
    const cached = nativeRefUses.get(symbol);
    if (cached !== undefined) return cached;
    const result = hasClosedDeferredIframeNativeRef(symbol, module, className);
    nativeRefUses.set(symbol, result);
    return result;
  };
  const forwardsNativeClick = (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
    module: DeferredIframeModule,
    depth: number,
  ): boolean => {
    if (nativeName(opening)) {
      const owner = findEnclosingFunction(opening);
      const event = getAuthoritativeJsxAttribute(opening.attributes, "onClick");
      return Boolean(
        nativeName(opening) === "button" &&
        hasPassiveDeferredIframeCapture(opening, {
          module,
          getReadonlySymbol: (identifier) => readonlySymbol(identifier, module),
          getReadonlyInitializer: (identifier) => readonlyInitializer(identifier, module),
        }) &&
        owner &&
        event &&
        isRefNotificationNativeEvent(event, owner, {
          ...context,
          filename: module.filePath,
          scopes: module.scopes,
          cfg: module.cfg,
        }),
      );
    }
    if (depth >= DEFERRED_IFRAME_MAX_EVENT_FORWARDING_DEPTH) return false;
    const resolved = resolveComponent(opening, module);
    if (!resolved || !isFunctionLike(resolved.functionNode)) return false;
    const root = returnedRoot(resolved.functionNode);
    const parameter = resolved.functionNode.params[0];
    if (
      !root ||
      !isNodeOfType(parameter, "Identifier") ||
      !reachable(root, resolved.module) ||
      !componentUses(resolved.functionNode, resolved.module)
    )
      return false;
    const parameterSymbol = readonlySymbol(parameter, resolved.module);
    const value = attributeValue(root.openingElement, "onClick");
    if (
      !parameterSymbol ||
      !isNodeOfType(value, "ConditionalExpression") ||
      !isNodeOfType(value.alternate, "Literal") ||
      value.alternate.value !== null ||
      !isNodeOfType(value.consequent, "ArrowFunctionExpression") ||
      value.consequent.async ||
      value.consequent.params.length !== 0 ||
      !isNodeOfType(value.consequent.body, "CallExpression") ||
      value.consequent.body.optional ||
      value.consequent.body.arguments.length !== 0
    )
      return false;
    const invocation = value.consequent.body;
    const isCallbackMember = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "MemberExpression") &&
      directMemberName(node) === "onClick" &&
      resolved.module.scopes.symbolFor(node.object) === parameterSymbol;
    if (
      !isCallbackMember(value.test) ||
      !isCallbackMember(invocation.callee) ||
      !parameterSymbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const member = reference.identifier.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== reference.identifier ||
          !directMemberName(member)
        )
          return false;
        if (directMemberName(member) === "onClick")
          return member === value.test || member === invocation.callee;
        return (
          (directMemberName(member) === "className" &&
            isNodeOfType(member.parent, "TemplateLiteral")) ||
          (directMemberName(member) === "children" &&
            isNodeOfType(member.parent, "JSXExpressionContainer") &&
            member.parent.parent === root)
        );
      })
    )
      return false;
    return forwardsNativeClick(
      root.openingElement,
      resolved.module,
      depth + DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT,
    );
  };
  const hasExecutableWriterUse = (write: EsTreeNode, module: DeferredIframeModule): boolean => {
    const owner = findEnclosingFunction(write);
    const binding = owner && getDirectFunctionBindingIdentifier(owner);
    const symbol = binding && readonlySymbol(binding, module);
    if (!owner || !binding || !symbol || !readonlyInitializer(binding, module)) return false;
    let executable = false;
    return (
      symbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const parent = reference.identifier.parent;
        if (
          !isNodeOfType(parent, "JSXExpressionContainer") ||
          parent.expression !== reference.identifier ||
          !isNodeOfType(parent.parent, "JSXAttribute") ||
          !isNodeOfType(parent.parent.name, "JSXIdentifier") ||
          parent.parent.name.name !== "onClick" ||
          !isNodeOfType(parent.parent.parent, "JSXOpeningElement") ||
          !reachable(reference.identifier, module) ||
          !isPlainJsxUse(parent.parent.parent.parent) ||
          !forwardsNativeClick(parent.parent.parent, module, 0) ||
          !supportedRenderUse(parent.parent.parent.parent, module)
        )
          return false;
        const componentOwner = findEnclosingFunction(reference.identifier);
        const componentRoot = componentOwner && returnedRoot(componentOwner);
        if (
          !componentRoot ||
          !isDescendantWithoutFunctionBoundary(reference.identifier, componentRoot)
        )
          return false;
        executable = true;
        return true;
      }) && executable
    );
  };
  return (iframe: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
    const program = findProgramRoot(iframe);
    const filename = context.filename && normalizeFilename(context.filename);
    const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
    if (
      !program ||
      !isNodeOfType(program, "Program") ||
      !filename ||
      !rootDirectory ||
      !filename.startsWith(`${normalizeFilename(rootDirectory)}/`) ||
      !isNodeOfType(iframe.name, "JSXIdentifier") ||
      iframe.name.name !== "iframe"
    )
      return false;
    if (modules === undefined) {
      index = buildSourceProjectIndex({
        rootDirectory,
        currentFilePath: filename,
        currentProgramNode: program,
        currentScopes: context.scopes,
        sourceFileLimits: {
          maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
          maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
          maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
          maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
        },
      });
      modules = null;
      if (
        !index ||
        index.hasOpaqueMdxConsumerSurface ||
        [...index.unresolvedRuntimeSources].some((source) => /^\.\.?\//u.test(source)) ||
        index.htmlFilePaths.length > SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT
      )
        return false;
      try {
        let htmlBytes = 0;
        for (const filePath of index.htmlFilePaths) {
          const stat = fs.statSync(filePath);
          htmlBytes += stat.size;
          const htmlSource = fs.readFileSync(filePath, "utf8");
          htmlSources.push(htmlSource);
          if (
            stat.size > SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES ||
            htmlBytes > SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES ||
            /<\s*iframe\b/iu.test(htmlSource)
          )
            return false;
        }
        modules = [...index.modulesByFilePath.values()].map((module) => ({
          ...module,
          sourceText:
            module.filePath === filename
              ? (context.sourceCode?.getText?.() ?? "")
              : fs.readFileSync(module.filePath, "utf8"),
          cfg: module.filePath === filename ? context.cfg : analyzeControlFlow(module.programNode),
        }));
        for (const module of modules) {
          if (!modulesByProgram.has(module.programNode)) {
            modulesByProgram.set(module.programNode, module);
          }
          if (!modulesByFilePath.has(module.filePath)) {
            modulesByFilePath.set(module.filePath, module);
          }
        }
      } catch {
        return false;
      }
    }
    const current = moduleFor(filename);
    if (!current || !modules) return false;
    if (documentLookups === undefined) {
      const lookups: EsTreeNode[] = [];
      for (const module of modules)
        walkAst(module.programNode, (node) => {
          const call = directCall(node, "querySelector");
          if (
            call &&
            isNodeOfType(call.callee, "MemberExpression") &&
            isNodeOfType(call.callee.object, "Identifier") &&
            call.callee.object.name === "document" &&
            module.scopes.isGlobalReference(call.callee.object)
          )
            lookups.push(call);
        });
      documentLookups = lookups;
      if (lookups.length === DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT) {
        const lookup = lookups[0];
        const declaration = lookup && findTransparentExpressionRoot(lookup).parent;
        const lookupModule = lookup && modulesByProgram.get(findProgramRoot(lookup));
        if (
          lookup &&
          lookupModule &&
          isNodeOfType(declaration, "VariableDeclarator") &&
          isNodeOfType(declaration.id, "Identifier") &&
          declaration.init &&
          stripParenExpression(declaration.init) === lookup
        ) {
          const receiver = lookupModule.scopes.symbolFor(declaration.id);
          if (receiver?.declarationNode === declaration) {
            const queries = new Set<EsTreeNode>();
            let queryClass: string | null = null;
            for (const reference of receiver.references) {
              const member = reference.identifier.parent;
              const query = directCall(member?.parent, "querySelector");
              if (
                isNodeOfType(member, "MemberExpression") &&
                member.object === reference.identifier &&
                query?.callee === member &&
                query.arguments.length === DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT &&
                isNodeOfType(query.arguments[0], "Literal") &&
                typeof query.arguments[0].value === "string"
              ) {
                const selectedClass = DEFERRED_IFRAME_SELECTOR_PATTERN.exec(
                  query.arguments[0].value,
                )?.[DEFERRED_IFRAME_CLASS_MATCH_INDEX];
                if (selectedClass) {
                  queries.add(query);
                  queryClass = selectedClass;
                }
              }
            }
            if (queries.size === DEFERRED_IFRAME_SINGLE_SOURCE_QUERY_COUNT)
              sourceQueryClass = queryClass;
          }
        }
      }
    }
    if (documentLookups.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT) return false;
    const documentLookup = documentLookups[0];
    nativeRefUses.clear();
    const parent = carrierClass(iframe, current);
    if (
      !parent ||
      parent.classes.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
      !parent.classes[0]
    )
      return false;
    const className = parent.classes[0];
    if (className !== sourceQueryClass) return false;
    if (nativeCarrierCounts === undefined) {
      const counts = new Map<string, number>();
      for (const module of modules)
        walkAst(module.programNode, (node) => {
          if (!isNodeOfType(node, "JSXOpeningElement") || resolveJsxElementType(node) !== "iframe")
            return;
          const element = node.parent;
          const container = element?.parent;
          if (
            !isNodeOfType(container, "JSXElement") ||
            nativeName(container.openingElement) !== "div" ||
            !isPlainJsxUse(container)
          )
            return;
          const carrier = carrierClass(node, module);
          for (const name of new Set(carrier?.classes ?? []))
            counts.set(name, (counts.get(name) ?? 0) + DEFERRED_IFRAME_SINGLE_CARRIER_COUNT);
        });
      nativeCarrierCounts = counts;
    }
    if (
      (nativeCarrierCounts.get(className) ?? 0) + parent.wrapperIframeCount >
      DEFERRED_IFRAME_SINGLE_CARRIER_COUNT
    )
      return false;
    if (
      !modules.every((module) =>
        hasClosedDeferredIframeNativeSurface(
          module,
          className,
          (identifier) => closedNativeRef(identifier, module, className),
          (identifier) => readonlySymbol(identifier, module),
        ),
      )
    )
      return false;
    const ref = attributeValue(iframe, "ref");
    if (!ref || !isNodeOfType(ref, "Identifier") || !closedNativeRef(ref, current, className))
      return false;
    const owner = findEnclosingFunction(iframe);
    const outer = parent.parent.parent;
    if (!owner || !isNodeOfType(outer, "JSXElement") || returnedRoot(owner) !== outer) return false;
    const uses = componentUses(owner, current);
    if (!uses || (uses.length === 0 && runtimeFunctionExports(owner, current).size === 0))
      return false;
    if (
      !uses.every((use) => {
        const useModule = modulesByProgram.get(findProgramRoot(use));
        return Boolean(useModule && supportedRenderUse(use, useModule));
      })
    )
      return false;
    const id = outerId(parent.parent, current);
    if (!id) return false;
    const idShape = (value: EsTreeNode): DeferredIframeIdShape | null => {
      if (
        isNodeOfType(value, "Literal") &&
        typeof value.value === "string" &&
        DEFERRED_IFRAME_ID_PATTERN.test(`#${value.value}`)
      )
        return { prefix: value.value, suffix: "", literal: true };
      if (
        isNodeOfType(value, "TemplateLiteral") &&
        value.expressions.length === DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT
      ) {
        const prefix = value.quasis[0]?.value.cooked;
        const suffix = value.quasis.at(-1)?.value.cooked;
        if (typeof prefix === "string" && typeof suffix === "string")
          return { prefix, suffix, literal: false };
      }
      return null;
    };
    const selectedId = idShape(id);
    if (!selectedId) return false;
    const canMatchId = (candidate: DeferredIframeIdShape): boolean => {
      if (selectedId.literal)
        return candidate.literal
          ? candidate.prefix === selectedId.prefix
          : selectedId.prefix.startsWith(candidate.prefix) &&
              selectedId.prefix.endsWith(candidate.suffix);
      if (candidate.literal)
        return (
          candidate.prefix.startsWith(selectedId.prefix) &&
          candidate.prefix.endsWith(selectedId.suffix)
        );
      return (
        selectedId.prefix.startsWith(candidate.prefix) ||
        candidate.prefix.startsWith(selectedId.prefix)
      );
    };
    const selectedContainer = parent.parent.parent;
    if (!isNodeOfType(selectedContainer, "JSXElement")) return false;
    const selectedWrapper = nativeName(selectedContainer.openingElement)
      ? null
      : component(selectedContainer.openingElement, current);
    if (selectedWrapper && !selectedWrapper.uses.every((use) => use === selectedContainer))
      return false;
    const nativeIdOpening =
      selectedWrapper?.root.openingElement ?? selectedContainer.openingElement;
    let unsupportedId = false;
    for (const module of modules)
      walkAst(module.programNode, (node) => {
        if (!isNodeOfType(node, "JSXOpeningElement") || node === nativeIdOpening) return;
        const attribute = getAuthoritativeJsxAttribute(node.attributes, "id");
        if (!attribute) return;
        if (!nativeName(node)) {
          if (!resolveComponent(node, module)) unsupportedId = true;
          return;
        }
        const value = attributeValue(node, "id");
        const candidate = value && idShape(value);
        if (!candidate || canMatchId(candidate)) unsupportedId = true;
      });
    if (unsupportedId) return false;
    for (const htmlSource of htmlSources) {
      if (DEFERRED_IFRAME_HTML_ACTIVE_PATTERN.test(htmlSource)) return false;
      const starts = [...htmlSource.matchAll(DEFERRED_IFRAME_HTML_ID_START_PATTERN)];
      const matches = [...htmlSource.matchAll(DEFERRED_IFRAME_HTML_ID_PATTERN)];
      if (
        starts.length !== matches.length ||
        matches.some((match) => {
          const literalId = match[DEFERRED_IFRAME_CLASS_MATCH_INDEX];
          return (
            !literalId ||
            !DEFERRED_IFRAME_ID_PATTERN.test(`#${literalId}`) ||
            canMatchId({ prefix: literalId, suffix: "", literal: true })
          );
        })
      )
        return false;
    }
    let rival = false;
    for (const module of modules)
      walkAst(module.programNode, (node) => {
        if (!isNodeOfType(node, "JSXOpeningElement") || resolveJsxElementType(node) !== "iframe")
          return;
        if (node === iframe) return;
        const carrier = carrierClass(node, module);
        if (!carrier || carrier.classes.includes(className)) rival = true;
      });
    if (rival) return false;
    let found = false;
    walkAst(program, (node) => {
      const write = directCall(node, "setAttribute");
      if (
        !write ||
        !isNodeOfType(write.callee, "MemberExpression") ||
        write.arguments.length !== DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT ||
        !isNodeOfType(write.arguments[0], "Literal") ||
        write.arguments[0].value !== "src" ||
        !write.arguments[1] ||
        !externalValue(write.arguments[1], current) ||
        !reachable(write, current)
      )
        return;
      const query = directCall(write.callee.object, "querySelector");
      if (
        !query ||
        !isNodeOfType(query.callee, "MemberExpression") ||
        query.arguments.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
        !isNodeOfType(query.arguments[0], "Literal") ||
        typeof query.arguments[0].value !== "string" ||
        DEFERRED_IFRAME_SELECTOR_PATTERN.exec(query.arguments[0].value)?.[
          DEFERRED_IFRAME_CLASS_MATCH_INDEX
        ] !== className ||
        !isNodeOfType(query.callee.object, "Identifier")
      )
        return;
      const receiver = current.scopes.symbolFor(query.callee.object);
      const receiverDeclaration = receiver?.declarationNode;
      if (
        !receiver ||
        receiver.kind !== "const" ||
        isErasedTypeScriptBinding(receiver) ||
        !isNodeOfType(receiverDeclaration, "VariableDeclarator") ||
        receiverDeclaration.id !== receiver.bindingIdentifier ||
        !receiverDeclaration.init ||
        !hasCompleteSymbolReferences(receiver, current.programNode, current.scopes) ||
        !receiver.references.every(
          (reference) =>
            isNonReferenceIdentifier(reference.identifier) ||
            (reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier)),
        )
      )
        return;
      const root = stripParenExpression(receiverDeclaration.init);
      const lookup = root && directCall(root, "querySelector");
      if (
        !receiver ||
        !lookup ||
        !isNodeOfType(lookup.callee, "MemberExpression") ||
        !isNodeOfType(lookup.callee.object, "Identifier") ||
        lookup.callee.object.name !== "document" ||
        !current.scopes.isGlobalReference(lookup.callee.object) ||
        lookup !== documentLookup ||
        lookup.arguments.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
        !lookup.arguments[0] ||
        !linkedIds(lookup.arguments[0], id, current)
      )
        return;
      const receiverClosed = receiver.references.every((reference) => {
        const member = reference.identifier.parent;
        if (directMemberName(member) === "classList") return true;
        if (directMemberName(member) !== "querySelector" || !member) return false;
        const call = directCall(member.parent, "querySelector");
        if (
          !call ||
          call.arguments.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
          !isNodeOfType(call.arguments[0], "Literal")
        )
          return false;
        if (call.arguments[0].value === `.${className} > iframe`) return call === query;
        const target = call.parent;
        const assignment = target?.parent;
        if (
          call.arguments[0].value !== `.${className}` ||
          directMemberName(target) !== "innerHTML" ||
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.left !== target
        )
          return false;
        let branch: EsTreeNode | null | undefined = assignment.parent;
        while (branch && !isFunctionLike(branch)) {
          if (
            isNodeOfType(branch, "IfStatement") &&
            branch.alternate &&
            isDescendantWithoutFunctionBoundary(assignment, branch.alternate) &&
            isDescendantWithoutFunctionBoundary(write, branch.consequent)
          )
            return true;
          branch = branch.parent;
        }
        return false;
      });
      if (receiverClosed && hasExecutableWriterUse(write, current)) found = true;
    });
    return found;
  };
};
