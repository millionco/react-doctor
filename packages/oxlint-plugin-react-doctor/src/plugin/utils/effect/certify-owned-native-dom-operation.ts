import { DOM_PROPERTY_NAMES } from "../../constants/dom-property-names.js";
import { HTML_TAGS } from "../../constants/html-tags.js";
import { SVG_TAGS } from "../../constants/svg-tags.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { findEnclosingFunction } from "../find-enclosing-function.js";
import { findExportedValue } from "../find-exported-value.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { findProgramRoot } from "../find-program-root.js";
import { getImportDeclarationForSymbol } from "../get-import-declaration-for-symbol.js";
import { getImportedName } from "../get-imported-name.js";
import { getStaticPropertyKeyName } from "../get-static-property-key-name.js";
import { getStaticPropertyName } from "../get-static-property-name.js";
import { isFunctionLike } from "../is-function-like.js";
import { isProvenGlobalNamespaceReference } from "../is-proven-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../is-within-assignment-target.js";
import { isLiteralVoidExpression } from "../is-literal-void-expression.js";
import { isTypeOnlyImport } from "../is-type-only-import.js";
import { resolveConstIdentifierAlias } from "../resolve-const-identifier-alias.js";
import { resolveImportedApiReference } from "../resolve-imported-api-reference.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { hasSupportedNativeUiSdkRole } from "./has-modern-source-scheduling-role.js";
import { isClosedReactHookCall } from "./is-closed-react-hook-call.js";
import type { RuleContext } from "../rule-context.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { walkAst } from "../walk-ast.js";
import {
  OWNED_NATIVE_DOM_CONSTRUCTORS,
  OWNED_NATIVE_DOM_EVENT_METHODS,
  OWNED_NATIVE_DOM_EVENT_DATA_PROPERTIES,
  OWNED_NATIVE_DOM_NODE_DATA_PROPERTIES,
  OWNED_NATIVE_DOM_URL_PROPERTIES,
  OWNED_NATIVE_DOM_PROTECTED_PROPERTIES,
  OWNED_NATIVE_DOM_REFLECTION_WRITERS,
  OWNED_NATIVE_DOM_LUCIDE_NAMES,
  OWNED_NATIVE_DOM_BASE_UI_OPTIONS,
  OWNED_NATIVE_DOM_ELEMENT_NUMBER_PROPERTIES,
  OWNED_NATIVE_DOM_GEOMETRY_METHODS,
  OWNED_NATIVE_DOM_GEOMETRY_PROPERTIES,
  OWNED_NATIVE_DOM_GRAPH_BUDGET,
  OWNED_NATIVE_DOM_PROJECT_NODE_BUDGET,
  OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT,
  OWNED_NATIVE_DOM_GLOBAL_ROOT_NAMES,
  OWNED_NATIVE_DOM_SAFE_GLOBAL_PROPERTIES,
  OWNED_NATIVE_DOM_DOCUMENT_METHODS,
  OWNED_NATIVE_DOM_INHERITED_DATASET_PROPERTIES,
  OWNED_NATIVE_DOM_QUERY_METHODS,
  OWNED_NATIVE_DOM_STYLE_METHODS,
  OWNED_NATIVE_DOM_STYLE_PROPERTIES,
  OWNED_NATIVE_DOM_UNSAFE_TAGS,
} from "./owned-native-dom/constants.js";

interface NativeDomFrame {
  readonly module: SourceProjectModule;
  readonly bindings: ReadonlyMap<SymbolDescriptor, NativeDomValue>;
}

interface NativeDomValue {
  readonly node: EsTreeNode | null;
  readonly frame: NativeDomFrame;
  readonly properties?: ReadonlyMap<string, NativeDomValue>;
  readonly children?: ReadonlyArray<NativeDomValue>;
  readonly forwardsRef?: boolean;
  readonly alternatives?: ReadonlyArray<NativeDomValue>;
  readonly callbacks?: ReadonlyArray<NativeDomValue>;
  readonly booleanValue?: boolean;
}

interface NativeDomEventCapability {
  readonly kind: "event" | "node" | "dataset" | "style" | "arguments";
}

interface NativeDomSdkReference {
  readonly source: string;
  readonly exportName: string;
  readonly memberName: string | null;
}

interface NativeDomCertificate {
  readonly operation: (call: EsTreeNodeOfType<"CallExpression">, frame: NativeDomFrame) => boolean;
  readonly primitive: (value: NativeDomValue) => boolean;
  readonly mutation: (node: EsTreeNode, frame: NativeDomFrame) => boolean;
  readonly collection: (value: NativeDomValue) => boolean;
  readonly refValue: (value: NativeDomValue) => boolean;
  readonly eventDispatch: (
    call: EsTreeNodeOfType<"CallExpression">,
    frame: NativeDomFrame,
  ) => boolean;
  readonly frame: NativeDomFrame;
}

const isStableNativeBinding = (symbol: SymbolDescriptor): boolean =>
  (symbol.kind === "const" || symbol.kind === "function" || symbol.kind === "import") &&
  symbol.references.every((reference) => reference.flag === "read");

const nativeContradictionByProject = new WeakMap<SourceProjectIndex, boolean>();

const projectHasNativeContradiction = (projectIndex: SourceProjectIndex): boolean => {
  const cached = nativeContradictionByProject.get(projectIndex);
  if (cached !== undefined) return cached;
  let hasNativeContradiction = false;
  let projectBudget = OWNED_NATIVE_DOM_PROJECT_NODE_BUDGET;
  const plainTarget = (node: EsTreeNode, module: SourceProjectModule): boolean => {
    const current = stripParenExpression(node);
    if (isNodeOfType(current, "ObjectExpression") || isNodeOfType(current, "ArrayExpression"))
      return true;
    if (!isNodeOfType(current, "Identifier")) return false;
    const symbol = resolveConstIdentifierAlias(current, module.scopes);
    if (!symbol || !isStableNativeBinding(symbol) || !symbol.initializer) return false;
    const initializer = stripParenExpression(symbol.initializer);
    return (
      isNodeOfType(initializer, "ObjectExpression") || isNodeOfType(initializer, "ArrayExpression")
    );
  };
  const inertGlobalUse = (
    node: EsTreeNode,
    module: SourceProjectModule,
    visited: Set<SymbolDescriptor>,
  ): boolean => {
    if (--projectBudget < 0 || visited.size >= OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT) return false;
    const receiver = findTransparentExpressionRoot(node);
    const usage = receiver.parent;
    if (!usage) return false;
    if (
      ((isNodeOfType(usage, "CallExpression") || isNodeOfType(usage, "NewExpression")) &&
        usage.callee === receiver) ||
      (isNodeOfType(usage, "UnaryExpression") &&
        ["typeof", "!", "void"].includes(usage.operator)) ||
      (isNodeOfType(usage, "ConditionalExpression") && usage.test === receiver) ||
      (isNodeOfType(usage, "IfStatement") && usage.test === receiver) ||
      (isNodeOfType(usage, "LogicalExpression") &&
        usage.operator === "&&" &&
        usage.left === receiver) ||
      (isNodeOfType(usage, "BinaryExpression") && ["===", "!=="].includes(usage.operator))
    )
      return true;
    if (
      !isNodeOfType(usage, "VariableDeclarator") ||
      usage.init !== receiver ||
      !isNodeOfType(usage.id, "Identifier") ||
      usage.parent?.parent?.type === "ExportNamedDeclaration"
    )
      return false;
    const symbol = module.scopes.symbolFor(usage.id);
    if (!symbol || !isStableNativeBinding(symbol) || visited.has(symbol)) return false;
    visited.add(symbol);
    return symbol.references.every((reference) =>
      inertGlobalUse(reference.identifier, module, visited),
    );
  };
  for (const module of projectIndex.modulesByFilePath.values()) {
    walkAst(module.programNode, (candidate) => {
      if (--projectBudget < 0) hasNativeContradiction = true;
      if (hasNativeContradiction) return false;
      if (isNodeOfType(candidate, "MemberExpression") && isWithinAssignmentTarget(candidate)) {
        const usage = findTransparentExpressionRoot(candidate).parent;
        if (usage && isNodeOfType(usage, "MemberExpression")) return;
        const property = getStaticPropertyName(candidate);
        if (
          (!property || OWNED_NATIVE_DOM_PROTECTED_PROPERTIES.has(property)) &&
          !plainTarget(candidate.object, module)
        )
          hasNativeContradiction = true;
      }
      if (
        isNodeOfType(candidate, "CallExpression") &&
        isNodeOfType(candidate.callee, "MemberExpression") &&
        OWNED_NATIVE_DOM_REFLECTION_WRITERS.has(getStaticPropertyName(candidate.callee) ?? "") &&
        (isProvenGlobalNamespaceReference(candidate.callee.object, "Object", module.scopes) ||
          isProvenGlobalNamespaceReference(candidate.callee.object, "Reflect", module.scopes))
      ) {
        const target = candidate.arguments[0];
        if (!target || !plainTarget(target, module)) hasNativeContradiction = true;
      }
      if (!isNodeOfType(candidate, "Identifier") || !module.scopes.isGlobalReference(candidate))
        return;
      let globalName = candidate.name;
      let receiver: EsTreeNode = findTransparentExpressionRoot(candidate);
      let cameFromGlobalRoot = false;
      while (OWNED_NATIVE_DOM_GLOBAL_ROOT_NAMES.has(globalName)) {
        cameFromGlobalRoot = true;
        const member: EsTreeNode | null | undefined = receiver.parent;
        if (!member || !isNodeOfType(member, "MemberExpression") || member.object !== receiver) {
          if (!member || !isNodeOfType(member, "UnaryExpression") || member.operator !== "typeof")
            hasNativeContradiction = true;
          return;
        }
        const propertyName = getStaticPropertyName(member);
        if (!propertyName || --projectBudget < 0) {
          hasNativeContradiction = true;
          return;
        }
        globalName = propertyName;
        receiver = findTransparentExpressionRoot(member);
      }
      if (
        ["eval", "Function", "addEventListener", "event", "getSelection", "frameElement"].includes(
          globalName,
        )
      ) {
        hasNativeContradiction = true;
        return;
      }
      if (
        globalName !== "document" &&
        globalName !== "customElements" &&
        !OWNED_NATIVE_DOM_CONSTRUCTORS.has(globalName)
      ) {
        if (
          !OWNED_NATIVE_DOM_SAFE_GLOBAL_PROPERTIES.has(globalName) &&
          (cameFromGlobalRoot || !inertGlobalUse(receiver, module, new Set()))
        )
          hasNativeContradiction = true;
        return;
      }
      const parent = receiver.parent;
      if (!parent || !isNodeOfType(parent, "MemberExpression") || parent.object !== receiver) {
        if (!parent || !isNodeOfType(parent, "NewExpression") || parent.callee !== receiver)
          hasNativeContradiction = true;
        return;
      }
      const propertyName = getStaticPropertyName(parent);
      const usage = parent.parent;
      if (
        !propertyName ||
        propertyName === "prototype" ||
        (globalName === "document" && !OWNED_NATIVE_DOM_DOCUMENT_METHODS.has(propertyName)) ||
        (globalName === "customElements" && ["define", "upgrade"].includes(propertyName)) ||
        usage?.type === "AssignmentExpression" ||
        usage?.type === "UpdateExpression" ||
        (usage && isNodeOfType(usage, "UnaryExpression") && usage.operator === "delete")
      )
        hasNativeContradiction = true;
    });
    if (hasNativeContradiction) break;
  }
  nativeContradictionByProject.set(projectIndex, hasNativeContradiction);
  return hasNativeContradiction;
};

const readonlySdkBindingsByProject = new WeakMap<SourceProjectIndex, Map<string, boolean>>();

const projectHasReadonlySdkBindings = (
  projectIndex: SourceProjectIndex,
  packageName: string,
): boolean => {
  const cached = readonlySdkBindingsByProject.get(projectIndex)?.get(packageName);
  if (cached !== undefined) return cached;
  let remaining = OWNED_NATIVE_DOM_PROJECT_NODE_BUDGET;
  let depth = 0;
  const visited = new Set<SymbolDescriptor>();
  let hasUnsafeUse = false;
  const matchesSource = (source: string): boolean =>
    source === packageName || source.startsWith(`${packageName}/`);
  const inspectSymbol = (symbol: SymbolDescriptor, module: SourceProjectModule): boolean => {
    if (depth >= OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT) return false;
    depth += 1;
    try {
      if (!isStableNativeBinding(symbol)) return false;
      if (visited.has(symbol)) return true;
      visited.add(symbol);
      const declaration = symbol.declarationNode.parent;
      if (symbol.kind !== "import" && declaration?.parent?.type === "ExportNamedDeclaration")
        return false;
      return symbol.references.every((reference) => inspectUse(reference.identifier, module));
    } finally {
      depth -= 1;
    }
  };
  const inspectUse = (usageNode: EsTreeNode, module: SourceProjectModule): boolean => {
    if (depth >= OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT) return false;
    depth += 1;
    try {
      if (--remaining < 0) return false;
      const usage = findTransparentExpressionRoot(usageNode);
      const parent = usage.parent;
      if (!parent) return false;
      if (
        (isNodeOfType(parent, "MemberExpression") || isNodeOfType(parent, "JSXMemberExpression")) &&
        parent.object === usage
      )
        return inspectUse(parent, module);
      if (
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === usage
      )
        return true;
      if (isNodeOfType(parent, "VariableDeclarator") && parent.init === usage) {
        const symbols: SymbolDescriptor[] = [];
        walkAst(parent.id, (binding) => {
          const symbol = module.scopes.symbolFor(binding);
          if (symbol && symbol.bindingIdentifier === binding) symbols.push(symbol);
        });
        return symbols.length > 0 && symbols.every((symbol) => inspectSymbol(symbol, module));
      }
      if (
        isNodeOfType(parent, "Property") ||
        isNodeOfType(parent, "ObjectExpression") ||
        isNodeOfType(parent, "ArrayExpression") ||
        isNodeOfType(parent, "SpreadElement") ||
        isNodeOfType(parent, "ConditionalExpression") ||
        isNodeOfType(parent, "LogicalExpression")
      )
        return inspectUse(parent, module);
      if (isNodeOfType(parent, "UnaryExpression"))
        return ["typeof", "!", "void"].includes(parent.operator);
      if (isNodeOfType(parent, "BinaryExpression")) return ["===", "!=="].includes(parent.operator);
      if (isNodeOfType(parent, "CallExpression") && parent.callee === usage) {
        const reference = resolveImportedApiReference(usage, module.scopes);
        return Boolean(
          reference &&
          ((reference.source === "@base-ui/react/use-render" &&
            reference.importedName === "useRender") ||
            (reference.source === "@base-ui/react/merge-props" &&
              reference.importedName === "mergeProps")),
        );
      }
      return false;
    } finally {
      depth -= 1;
    }
  };
  for (const module of projectIndex.modulesByFilePath.values()) {
    walkAst(module.programNode, (candidate) => {
      if (--remaining < 0) hasUnsafeUse = true;
      if (hasUnsafeUse) return false;
      if (
        isNodeOfType(candidate, "ImportDeclaration") &&
        !isTypeOnlyImport(candidate) &&
        typeof candidate.source.value === "string" &&
        matchesSource(candidate.source.value)
      ) {
        for (const specifier of candidate.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          const symbol = module.scopes.symbolFor(specifier.local);
          if (!symbol || !inspectSymbol(symbol, module)) hasUnsafeUse = true;
        }
      }
      if (
        (isNodeOfType(candidate, "ExportNamedDeclaration") ||
          isNodeOfType(candidate, "ExportAllDeclaration")) &&
        candidate.exportKind !== "type" &&
        candidate.source &&
        typeof candidate.source.value === "string" &&
        matchesSource(candidate.source.value)
      )
        hasUnsafeUse = true;
      if (
        candidate.type === "TSImportEqualsDeclaration" ||
        candidate.type === "TSExternalModuleReference"
      )
        hasUnsafeUse = true;
      if (
        isNodeOfType(candidate, "ImportExpression") &&
        (!isNodeOfType(candidate.source, "Literal") ||
          typeof candidate.source.value !== "string" ||
          matchesSource(candidate.source.value))
      )
        hasUnsafeUse = true;
      if (
        isNodeOfType(candidate, "Identifier") &&
        candidate.name === "require" &&
        module.scopes.isGlobalReference(candidate)
      ) {
        const usage = findTransparentExpressionRoot(candidate);
        const call = usage.parent;
        const source =
          call && isNodeOfType(call, "CallExpression") && call.callee === usage
            ? call.arguments[0]
            : null;
        if (
          !source ||
          !isNodeOfType(source, "Literal") ||
          typeof source.value !== "string" ||
          matchesSource(source.value)
        )
          hasUnsafeUse = true;
      }
    });
    if (hasUnsafeUse) break;
  }
  const results = readonlySdkBindingsByProject.get(projectIndex) ?? new Map<string, boolean>();
  results.set(packageName, !hasUnsafeUse);
  readonlySdkBindingsByProject.set(projectIndex, results);
  return !hasUnsafeUse;
};

const createNativeDomCertificate = (
  node: EsTreeNode,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): NativeDomCertificate | null => {
  const program = findProgramRoot(node);
  const currentModule = [...projectIndex.modulesByFilePath.values()].find(
    (module) => module.programNode === program,
  );
  if (
    !currentModule ||
    projectIndex.hasOpaqueMdxConsumerSurface ||
    projectHasNativeContradiction(projectIndex)
  )
    return null;
  const frame: NativeDomFrame = { module: currentModule, bindings: new Map() };
  let remainingBudget = OWNED_NATIVE_DOM_GRAPH_BUDGET;
  let proofDepth = 0;
  const activeNodes = new Set<EsTreeNode>();
  const certifiedRefSymbols = new Set<SymbolDescriptor>();
  const inspectedValueSymbols = new Set<SymbolDescriptor>();
  const certifiedNativeNodes = new Set<EsTreeNode>();
  const inspectingDataSymbols = new Set<SymbolDescriptor>();
  const spend = (): boolean => --remainingBudget >= 0;
  const valueOf = (valueNode: EsTreeNode | null, valueFrame = frame): NativeDomValue => ({
    node: valueNode,
    frame: valueFrame,
  });
  const descend = <Result>(value: NativeDomValue, fallback: Result, run: () => Result): Result => {
    if (!spend() || (value.node && activeNodes.has(value.node))) return fallback;
    if (value.node) activeNodes.add(value.node);
    const result = run();
    if (value.node) activeNodes.delete(value.node);
    return result;
  };
  const enterProof = (): boolean => {
    if (proofDepth >= OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT || !spend()) return false;
    proofDepth += 1;
    return true;
  };
  const hasStructuredInitializer = (node: EsTreeNode, templateOnly = false): boolean => {
    if (!enterProof()) return true;
    try {
      if (!spend()) return true;
      const current = stripParenExpression(node);
      if (isNodeOfType(current, "JSXElement") || isNodeOfType(current, "JSXFragment")) return true;
      if (
        !templateOnly &&
        (isNodeOfType(current, "ObjectExpression") || isNodeOfType(current, "ArrayExpression"))
      )
        return true;
      if (isNodeOfType(current, "ConditionalExpression"))
        return (
          hasStructuredInitializer(current.consequent, templateOnly) ||
          hasStructuredInitializer(current.alternate, templateOnly)
        );
      if (isNodeOfType(current, "LogicalExpression"))
        return (
          hasStructuredInitializer(current.left, templateOnly) ||
          hasStructuredInitializer(current.right, templateOnly)
        );
      return false;
    } finally {
      proofDepth -= 1;
    }
  };
  const resolve = (value: NativeDomValue): NativeDomValue => {
    if (!enterProof()) return value;
    try {
      let current = value;
      const visited = new Set<EsTreeNode>();
      while (current.node && spend()) {
        const currentNode = stripParenExpression(current.node);
        current = { ...current, node: currentNode };
        if (visited.has(currentNode)) return current;
        visited.add(currentNode);
        if (isNodeOfType(currentNode, "Identifier") || isNodeOfType(currentNode, "JSXIdentifier")) {
          const symbol = current.frame.module.scopes.symbolFor(currentNode);
          const binding = symbol && current.frame.bindings.get(symbol);
          if (binding) {
            current = binding;
            continue;
          }
          if (
            symbol &&
            isStableNativeBinding(symbol) &&
            symbol.initializer &&
            symbol.kind !== "import"
          ) {
            const initializer = stripParenExpression(symbol.initializer);
            if (
              hasStructuredInitializer(initializer) &&
              !closedDataReferences(
                symbol,
                current.frame,
                hasStructuredInitializer(initializer, true),
              )
            )
              return current;
            current = valueOf(symbol.initializer, current.frame);
            continue;
          }
        }
        if (isNodeOfType(currentNode, "MemberExpression")) {
          const propertyName = getStaticPropertyName(currentNode);
          const receiver = properties(valueOf(currentNode.object, current.frame));
          if (receiver && propertyName) {
            current = receiver.get(propertyName) ?? valueOf(null, current.frame);
            continue;
          }
          if (receiver && currentNode.computed) {
            const propertyNames = stringChoices(valueOf(currentNode.property, current.frame));
            if (propertyNames && propertyNames.every((name) => receiver.has(name))) {
              const alternatives = propertyNames.flatMap((name) => {
                const property = receiver.get(name);
                return property ? [property] : [];
              });
              if (alternatives.length === 1 && alternatives[0]) {
                current = alternatives[0];
                continue;
              }
              return { node: null, frame: current.frame, alternatives };
            }
          }
        }
        return current;
      }
      return current;
    } finally {
      proofDepth -= 1;
    }
  };
  const properties = (value: NativeDomValue): ReadonlyMap<string, NativeDomValue> | null => {
    if (!enterProof()) return null;
    try {
      if (value.properties) return value.properties;
      const resolved = resolve(value);
      if (resolved.properties) return resolved.properties;
      if (
        resolved.node &&
        isNodeOfType(resolved.node, "CallExpression") &&
        sdkCall(resolved.node, "mergeProps", resolved.frame)
      ) {
        const result = new Map<string, NativeDomValue>();
        for (const argument of resolved.node.arguments) {
          if (isNodeOfType(argument, "SpreadElement")) return null;
          const argumentValue = valueOf(argument, resolved.frame);
          if (isAbsent(argumentValue)) continue;
          const record = properties(argumentValue);
          if (!record) return null;
          for (const [name, propertyValue] of record) {
            if (name === "render" ? !isAbsent(propertyValue) : !safeAttribute(name, propertyValue))
              return null;
            const previous = result.get(name);
            if (previous && reactEventProperty(name))
              result.set(name, {
                node: null,
                frame: resolved.frame,
                callbacks: [previous, propertyValue],
              });
            else if (previous && name === "style") {
              const previousStyle = properties(previous);
              const nextStyle = properties(propertyValue);
              if (!previousStyle || !nextStyle) return null;
              result.set(name, {
                node: null,
                frame: resolved.frame,
                properties: new Map([...previousStyle, ...nextStyle]),
              });
            } else result.set(name, propertyValue);
          }
        }
        return result;
      }
      if (!resolved.node || !isNodeOfType(resolved.node, "ObjectExpression")) return null;
      return descend(resolved, null, () => {
        const result = new Map<string, NativeDomValue>();
        for (const property of resolved.node && isNodeOfType(resolved.node, "ObjectExpression")
          ? resolved.node.properties
          : []) {
          if (isNodeOfType(property, "SpreadElement")) {
            const spread = properties(valueOf(property.argument, resolved.frame));
            if (!spread) return null;
            for (const [name, propertyValue] of spread) result.set(name, propertyValue);
            continue;
          }
          if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
            return null;
          const name = getStaticPropertyKeyName(property, { allowComputedString: true });
          if (!name || name === "__proto__") return null;
          result.set(name, valueOf(property.value, resolved.frame));
        }
        return result;
      });
    } finally {
      proofDepth -= 1;
    }
  };
  const unreachableRenderUse = (usage: EsTreeNode, valueFrame: NativeDomFrame): boolean => {
    if (!enterProof()) return false;
    try {
      let child = usage;
      let parent = child.parent;
      while (parent && spend()) {
        if (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) {
          const test = staticTruth(valueOf(parent.test, valueFrame));
          if (
            test !== null &&
            (child === parent.consequent || child === parent.alternate) &&
            child !== (test ? parent.consequent : parent.alternate)
          )
            return true;
        }
        if (isFunctionLike(parent)) return false;
        child = parent;
        parent = child.parent;
      }
      return false;
    } finally {
      proofDepth -= 1;
    }
  };
  const closedDataReferences = (
    symbol: SymbolDescriptor,
    valueFrame: NativeDomFrame,
    isTemplateValue = false,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      if (inspectingDataSymbols.has(symbol)) return true;
      inspectingDataSymbols.add(symbol);
      const inspectUse = (usage: EsTreeNode): boolean => {
        if (!spend()) return false;
        if (
          symbol.kind !== "import" &&
          symbol.scope !== valueFrame.module.scopes.rootScope &&
          unreachableRenderUse(usage, valueFrame)
        )
          return true;
        const parent = usage.parent;
        if (!parent) return false;
        if (isNodeOfType(parent, "MemberExpression") && parent.object === usage)
          return (
            Boolean(
              getStaticPropertyName(parent) ||
              (parent.computed && stringChoices(valueOf(parent.property, valueFrame))),
            ) && inspectUse(parent)
          );
        if (isNodeOfType(parent, "JSXMemberExpression") && parent.object === usage)
          return inspectUse(parent);
        if (
          (isNodeOfType(parent, "JSXOpeningElement") ||
            isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === usage
        )
          return true;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === usage &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = valueFrame.module.scopes.symbolFor(parent.id);
          return Boolean(
            alias &&
            isStableNativeBinding(alias) &&
            closedDataReferences(alias, valueFrame, isTemplateValue),
          );
        }
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === usage &&
          isNodeOfType(parent.id, "ObjectPattern")
        ) {
          return parent.id.properties.every((property) => {
            if (
              !isNodeOfType(property, "Property") ||
              !getStaticPropertyKeyName(property, { allowComputedString: true })
            )
              return false;
            const binding = isNodeOfType(property.value, "AssignmentPattern")
              ? property.value.left
              : property.value;
            const alias = valueFrame.module.scopes.symbolFor(binding);
            return Boolean(
              alias &&
              isStableNativeBinding(alias) &&
              closedDataReferences(alias, valueFrame, isTemplateValue),
            );
          });
        }
        if (isNodeOfType(parent, "CallExpression"))
          return (
            sdkCall(parent, "mergeProps", valueFrame) ||
            sdkCall(parent, "useRender", valueFrame) ||
            (isNodeOfType(parent.callee, "MemberExpression") &&
              getStaticPropertyName(parent.callee) === "animate" &&
              native(valueOf(parent.callee.object, valueFrame)))
          );
        if (
          isNodeOfType(parent, "Property") ||
          isNodeOfType(parent, "ArrayExpression") ||
          isNodeOfType(parent, "ObjectExpression") ||
          isNodeOfType(parent, "SpreadElement")
        )
          return inspectUse(parent);
        if (isNodeOfType(parent, "JSXExpressionContainer")) {
          const attribute = parent.parent;
          const isLocalTemplate =
            isTemplateValue ||
            Boolean(symbol.initializer && hasStructuredInitializer(symbol.initializer, true));
          if (
            isLocalTemplate &&
            findEnclosingFunction(parent) === findEnclosingFunction(symbol.bindingIdentifier) &&
            attribute &&
            (isNodeOfType(attribute, "JSXElement") || isNodeOfType(attribute, "JSXFragment"))
          ) {
            if (isNodeOfType(attribute, "JSXFragment")) return true;
            const name = attribute.openingElement.name;
            if (isNodeOfType(name, "JSXIdentifier") && nativeTag(name.name)) return true;
            return subtree(valueOf(attribute, valueFrame));
          }
          return Boolean(
            attribute &&
            isNodeOfType(attribute, "JSXAttribute") &&
            isNodeOfType(attribute.name, "JSXIdentifier") &&
            (attribute.name.name === "style" || reactEventProperty(attribute.name.name)) &&
            attribute.parent &&
            isNodeOfType(attribute.parent, "JSXOpeningElement") &&
            isNodeOfType(attribute.parent.name, "JSXIdentifier") &&
            nativeTag(attribute.parent.name.name),
          );
        }
        if (isNodeOfType(parent, "JSXSpreadAttribute")) {
          const element = parent.parent?.parent;
          if (!element || !isNodeOfType(element, "JSXElement")) return false;
          const name = element.openingElement.name;
          return isNodeOfType(name, "JSXIdentifier") && nativeTag(name.name)
            ? true
            : subtree(valueOf(element, valueFrame));
        }
        if (isNodeOfType(parent, "ReturnStatement"))
          return Boolean(
            findEnclosingFunction(parent) === findEnclosingFunction(symbol.bindingIdentifier) &&
            (isTemplateValue ||
              (symbol.initializer && hasStructuredInitializer(symbol.initializer, true))),
          );
        if (
          isNodeOfType(parent, "ConditionalExpression") ||
          isNodeOfType(parent, "LogicalExpression")
        )
          return inspectUse(parent);
        if (isNodeOfType(parent, "BinaryExpression"))
          return ["===", "!=="].includes(parent.operator);
        return false;
      };
      const isClosed = symbol.references.every((reference) => inspectUse(reference.identifier));
      inspectingDataSymbols.delete(symbol);
      return isClosed;
    } finally {
      proofDepth -= 1;
    }
  };
  const choiceCondition = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      if (!value.node) return true;
      const current = stripParenExpression(value.node);
      if (isNodeOfType(current, "Identifier")) {
        const symbol = value.frame.module.scopes.symbolFor(current);
        return Boolean(symbol && symbol.kind !== "import" && symbol.kind !== "ts-import-equals");
      }
      if (
        isNodeOfType(current, "UnaryExpression") &&
        ["!", "typeof", "void"].includes(current.operator)
      )
        return choiceCondition(valueOf(current.argument, value.frame));
      return primitive(value);
    } finally {
      proofDepth -= 1;
    }
  };
  const primitive = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      const resolved = resolve(value);
      if (resolved.alternatives)
        return resolved.alternatives.length > 0 && resolved.alternatives.every(primitive);
      if (resolved.properties || resolved.children || resolved.callbacks) return false;
      if (!resolved.node) return true;
      const current = resolved.node;
      return descend(resolved, false, () => {
        if (isNodeOfType(current, "Literal"))
          return (
            !("regex" in current) &&
            (current.value === null ||
              ["string", "number", "boolean"].includes(typeof current.value))
          );
        if (isNodeOfType(current, "Identifier"))
          return (
            current.name === "undefined" && resolved.frame.module.scopes.isGlobalReference(current)
          );
        if (isNodeOfType(current, "TemplateLiteral"))
          return current.expressions.every((expression) =>
            primitive(valueOf(expression, resolved.frame)),
          );
        if (isNodeOfType(current, "UnaryExpression"))
          return (
            current.operator !== "delete" && primitive(valueOf(current.argument, resolved.frame))
          );
        if (
          isNodeOfType(current, "BinaryExpression") ||
          isNodeOfType(current, "LogicalExpression")
        ) {
          return (
            !["in", "instanceof"].includes(current.operator) &&
            primitive(valueOf(current.left, resolved.frame)) &&
            primitive(valueOf(current.right, resolved.frame))
          );
        }
        if (isNodeOfType(current, "ConditionalExpression"))
          return (
            choiceCondition(valueOf(current.test, resolved.frame)) &&
            primitive(valueOf(current.consequent, resolved.frame)) &&
            primitive(valueOf(current.alternate, resolved.frame))
          );
        if (!isNodeOfType(current, "MemberExpression")) return false;
        const propertyName = getStaticPropertyName(current);
        if (!propertyName) return false;
        const receiver = stripParenExpression(current.object);
        if (
          isNodeOfType(receiver, "MemberExpression") &&
          getStaticPropertyName(receiver) === "dataset"
        ) {
          return (
            !OWNED_NATIVE_DOM_INHERITED_DATASET_PROPERTIES.has(propertyName) &&
            native(valueOf(receiver.object, resolved.frame))
          );
        }
        if (!OWNED_NATIVE_DOM_GEOMETRY_PROPERTIES.has(propertyName)) return false;
        if (
          isNodeOfType(receiver, "CallExpression") &&
          isNodeOfType(receiver.callee, "MemberExpression") &&
          OWNED_NATIVE_DOM_GEOMETRY_METHODS.has(getStaticPropertyName(receiver.callee) ?? "")
        ) {
          return operation(receiver, resolved.frame);
        }
        return (
          OWNED_NATIVE_DOM_ELEMENT_NUMBER_PROPERTIES.has(propertyName) &&
          native(valueOf(receiver, resolved.frame))
        );
      });
    } finally {
      proofDepth -= 1;
    }
  };
  const data = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      const resolved = resolve(value);
      if (resolved.callbacks || resolved.children) return false;
      if (resolved.alternatives)
        return resolved.alternatives.length > 0 && resolved.alternatives.every(data);
      if (resolved.properties) return [...resolved.properties.values()].every(data);
      if (!resolved.node) return true;
      if (isNodeOfType(resolved.node, "ArrayExpression"))
        return resolved.node.elements.every(
          (element) =>
            element === null ||
            (!isNodeOfType(element, "SpreadElement") && data(valueOf(element, resolved.frame))),
        );
      const record = properties(resolved);
      if (record) return [...record.values()].every(data);
      return primitive(resolved);
    } finally {
      proofDepth -= 1;
    }
  };
  const staticString = (value: NativeDomValue): string | null => {
    if (!enterProof()) return null;
    try {
      const resolved = resolve(value);
      return resolved.node &&
        isNodeOfType(resolved.node, "Literal") &&
        typeof resolved.node.value === "string"
        ? resolved.node.value
        : null;
    } finally {
      proofDepth -= 1;
    }
  };
  const undefinedValue = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      const resolved = resolve(value);
      if (!resolved.node)
        return (
          !resolved.properties &&
          !resolved.children &&
          !resolved.alternatives &&
          !resolved.callbacks &&
          resolved.booleanValue === undefined
        );
      return (
        (isNodeOfType(resolved.node, "Identifier") &&
          resolved.node.name === "undefined" &&
          resolved.frame.module.scopes.isGlobalReference(resolved.node)) ||
        isLiteralVoidExpression(resolved.node)
      );
    } finally {
      proofDepth -= 1;
    }
  };
  const isAbsent = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      const resolved = resolve(value);
      return Boolean(
        undefinedValue(resolved) ||
        resolved.booleanValue === false ||
        (resolved.node &&
          isNodeOfType(resolved.node, "Literal") &&
          (resolved.node.value === null || resolved.node.value === false)),
      );
    } finally {
      proofDepth -= 1;
    }
  };
  const nativeTag = (name: string): boolean =>
    (HTML_TAGS.has(name) || SVG_TAGS.has(name)) && !OWNED_NATIVE_DOM_UNSAFE_TAGS.has(name);
  const reactEventProperty = (name: string): boolean =>
    name.startsWith("on") && DOM_PROPERTY_NAMES.has(name) && name[2] !== name[2]?.toLowerCase();
  const callbackDataNodes = new Set<EsTreeNode>();
  const callbackDataSymbols = new Set<SymbolDescriptor>();
  const callbackCapabilityNodes = new Set<EsTreeNode>();
  const callbackFunction = (
    call: EsTreeNodeOfType<"CallExpression">,
    valueFrame: NativeDomFrame,
  ): NativeDomValue | null => {
    if (!enterProof()) return null;
    try {
      let callable = resolveComponent(call.callee, valueFrame);
      const callee = stripParenExpression(call.callee);
      if (
        !callable &&
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier")
      ) {
        const symbol = valueFrame.module.scopes.symbolFor(callee.object);
        const declaration =
          symbol && isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
            ? getImportDeclarationForSymbol(symbol)
            : null;
        const sourcePath = declaration && projectIndex.resolvedSourcePathByNode.get(declaration);
        const target = sourcePath && projectIndex.modulesByFilePath.get(sourcePath);
        const name = getStaticPropertyName(callee);
        const exported = target && name && findExportedValue(target.programNode, name);
        if (exported && target)
          callable = resolveComponent(exported, { module: target, bindings: new Map() });
      }
      if (!callable?.node || !isFunctionLike(callable.node)) return null;
      if (
        !call.arguments.every(
          (argument) =>
            !isNodeOfType(argument, "SpreadElement") && callbackData(valueOf(argument, valueFrame)),
        )
      )
        return null;
      const bindings = new Map(callable.frame.bindings);
      const callableFrame = { ...callable.frame, bindings };
      if (
        !callable.node.params.every((parameter, index) =>
          bindPattern(
            parameter,
            valueOf(call.arguments[index] ?? null, valueFrame),
            callableFrame,
            bindings,
          ),
        )
      )
        return null;
      return { ...callable, frame: callableFrame };
    } finally {
      proofDepth -= 1;
    }
  };
  const callbackData = (value: NativeDomValue, primitiveOnly = false): boolean => {
    if (!enterProof()) return false;
    try {
      if (value.node && callbackDataNodes.has(stripParenExpression(value.node))) return true;
      if (value.node && isNodeOfType(stripParenExpression(value.node), "Identifier")) {
        const symbol = value.frame.module.scopes.symbolFor(stripParenExpression(value.node));
        if (symbol && callbackDataSymbols.has(symbol)) return true;
      }
      if (primitiveOnly ? primitive(value) : data(value)) return true;
      const resolved = resolve(value);
      if (!resolved.node) return false;
      if (callbackDataNodes.has(resolved.node)) return true;
      if (
        isNodeOfType(resolved.node, "UnaryExpression") &&
        ["typeof", "!", "void"].includes(resolved.node.operator)
      )
        return true;
      if (
        isNodeOfType(resolved.node, "BinaryExpression") &&
        ["===", "!=="].includes(resolved.node.operator)
      )
        return true;
      if (isNodeOfType(resolved.node, "ConditionalExpression"))
        return (
          callbackData(valueOf(resolved.node.consequent, resolved.frame), primitiveOnly) &&
          callbackData(valueOf(resolved.node.alternate, resolved.frame), primitiveOnly)
        );
      if (!isNodeOfType(resolved.node, "CallExpression")) return false;
      const callable = callbackFunction(resolved.node, resolved.frame);
      if (
        !callable?.node ||
        !isFunctionLike(callable.node) ||
        callable.node.async ||
        callable.node.generator ||
        !callbackHasClosedCapabilities(callable, false)
      )
        return false;
      if (!isNodeOfType(callable.node.body, "BlockStatement"))
        return callbackData(valueOf(callable.node.body, callable.frame), primitiveOnly);
      let hasClosedReturns = true;
      walkAst(callable.node.body, (candidate) => {
        if (!spend()) {
          hasClosedReturns = false;
          return false;
        }
        if (isFunctionLike(candidate)) return false;
        if (
          isNodeOfType(candidate, "ReturnStatement") &&
          !callbackData(valueOf(candidate.argument, callable.frame), primitiveOnly)
        )
          hasClosedReturns = false;
      });
      return hasClosedReturns;
    } finally {
      proofDepth -= 1;
    }
  };
  const callbackPrimitiveUpdateTarget = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      if (callbackData(value, true)) return true;
      if (!value.node || !isNodeOfType(stripParenExpression(value.node), "Identifier"))
        return false;
      const symbol = value.frame.module.scopes.symbolFor(stripParenExpression(value.node));
      if (
        !symbol ||
        !["let", "var"].includes(symbol.kind) ||
        !symbol.initializer ||
        !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
        symbol.declarationNode.id !== symbol.bindingIdentifier ||
        !callbackData(valueOf(symbol.initializer, value.frame), true)
      )
        return false;
      return symbol.references.every((reference) => {
        if (!spend()) return false;
        if (reference.flag === "read") return true;
        const target = findTransparentExpressionRoot(reference.identifier);
        const usage = target.parent;
        return Boolean(
          usage &&
          ((isNodeOfType(usage, "UpdateExpression") && usage.argument === target) ||
            (isNodeOfType(usage, "AssignmentExpression") &&
              usage.left === target &&
              callbackData(valueOf(usage.right, value.frame), true))),
        );
      });
    } finally {
      proofDepth -= 1;
    }
  };
  const callbackHasClosedCapabilities = (value: NativeDomValue, isReactHandler = true): boolean => {
    if (!enterProof()) return false;
    try {
      if (!value.node || !isFunctionLike(value.node)) return false;
      const inspected = new Map<SymbolDescriptor, NativeDomEventCapability["kind"]>();
      const inspectSymbol = (
        symbol: SymbolDescriptor,
        kind: NativeDomEventCapability["kind"],
      ): boolean => {
        if (!enterProof()) return false;
        try {
          if (symbol.references.some((reference) => reference.flag !== "read")) return false;
          if (inspected.get(symbol) === kind) return true;
          inspected.set(symbol, kind);
          return symbol.references.every((reference) => inspectUse(reference.identifier, kind));
        } finally {
          proofDepth -= 1;
        }
      };
      const memberKind = (
        name: string,
        kind: NativeDomEventCapability["kind"],
      ): NativeDomEventCapability["kind"] | "data" | null => {
        if (kind === "event") {
          if (name === "target" || name === "currentTarget") return "node";
          if (name === "nativeEvent") return "event";
          return OWNED_NATIVE_DOM_EVENT_DATA_PROPERTIES.has(name) ? "data" : null;
        }
        if (kind === "node") {
          if (name === "dataset") return "dataset";
          if (name === "style") return "style";
          return OWNED_NATIVE_DOM_NODE_DATA_PROPERTIES.has(name) ? "data" : null;
        }
        if (kind === "dataset")
          return OWNED_NATIVE_DOM_INHERITED_DATASET_PROPERTIES.has(name) ? null : "data";
        if (kind === "style") return OWNED_NATIVE_DOM_STYLE_PROPERTIES.has(name) ? "data" : null;
        if (kind === "arguments") return name === "0" ? "event" : name === "length" ? "data" : null;
        return null;
      };
      const bindCapability = (
        pattern: EsTreeNode,
        kind: NativeDomEventCapability["kind"] | "data",
      ): boolean => {
        if (!enterProof()) return false;
        try {
          if (kind === "data") {
            if (isNodeOfType(pattern, "AssignmentPattern"))
              return (
                callbackData(valueOf(pattern.right, value.frame)) &&
                bindCapability(pattern.left, kind)
              );
            if (!isNodeOfType(pattern, "Identifier")) return false;
            const symbol = value.frame.module.scopes.symbolFor(pattern);
            if (!symbol || symbol.references.some((reference) => reference.flag !== "read"))
              return false;
            callbackDataSymbols.add(symbol);
            return true;
          }
          if (isNodeOfType(pattern, "AssignmentPattern")) return bindCapability(pattern.left, kind);
          if (isNodeOfType(pattern, "Identifier")) {
            const symbol = value.frame.module.scopes.symbolFor(pattern);
            return Boolean(symbol && inspectSymbol(symbol, kind));
          }
          if (isNodeOfType(pattern, "RestElement")) {
            const symbol = value.frame.module.scopes.symbolFor(pattern.argument);
            return Boolean(symbol && symbol.references.length === 0);
          }
          if (!isNodeOfType(pattern, "ObjectPattern")) return false;
          return pattern.properties.every((property) => {
            if (!isNodeOfType(property, "Property")) return false;
            const name = getStaticPropertyKeyName(property, { allowComputedString: true });
            const propertyKind = name && memberKind(name, kind);
            return Boolean(propertyKind && bindCapability(property.value, propertyKind));
          });
        } finally {
          proofDepth -= 1;
        }
      };
      const inspectUse = (node: EsTreeNode, kind: NativeDomEventCapability["kind"]): boolean => {
        if (!enterProof()) return false;
        try {
          const usage = findTransparentExpressionRoot(node);
          callbackCapabilityNodes.add(usage);
          if (isWithinAssignmentTarget(usage)) return false;
          const parent = usage.parent;
          if (!parent) return false;
          if (isNodeOfType(parent, "VariableDeclarator") && parent.init === usage)
            return bindCapability(parent.id, kind);
          if (isNodeOfType(parent, "MemberExpression") && parent.object === usage) {
            const name =
              getStaticPropertyName(parent) ??
              (kind === "arguments" &&
              parent.computed &&
              isNodeOfType(parent.property, "Literal") &&
              parent.property.value === 0
                ? "0"
                : null);
            if (!name || isWithinAssignmentTarget(parent)) return false;
            const call = parent.parent;
            if (kind === "event" && OWNED_NATIVE_DOM_EVENT_METHODS.has(name)) {
              if (call && isNodeOfType(call, "CallExpression")) callbackDataNodes.add(call);
              return Boolean(
                call &&
                isNodeOfType(call, "CallExpression") &&
                call.callee === parent &&
                call.arguments.length === 0,
              );
            }
            if (
              kind === "node" &&
              ["getAttribute", "hasAttribute", "getBoundingClientRect", "getClientRects"].includes(
                name,
              )
            ) {
              if (
                call &&
                isNodeOfType(call, "CallExpression") &&
                ["getAttribute", "hasAttribute"].includes(name)
              )
                callbackDataNodes.add(call);
              return Boolean(
                call &&
                isNodeOfType(call, "CallExpression") &&
                call.callee === parent &&
                call.arguments.length ===
                  (name === "getAttribute" || name === "hasAttribute" ? 1 : 0),
              );
            }
            const propertyKind = memberKind(name, kind);
            if (propertyKind === "data") callbackDataNodes.add(parent);
            return propertyKind === "data"
              ? true
              : propertyKind
                ? inspectUse(parent, propertyKind)
                : false;
          }
          if (isNodeOfType(parent, "UnaryExpression"))
            return ["!", "typeof", "void"].includes(parent.operator);
          if (isNodeOfType(parent, "BinaryExpression"))
            return ["===", "!==", "==", "!="].includes(parent.operator);
          if (isNodeOfType(parent, "IfStatement") && parent.test === usage) return true;
          if (isNodeOfType(parent, "ConditionalExpression") && parent.test === usage) return true;
          if (isNodeOfType(parent, "LogicalExpression") && parent.left === usage) return true;
          return false;
        } finally {
          proofDepth -= 1;
        }
      };
      const parameter = value.node.params[0];
      if (isReactHandler && parameter && !bindCapability(parameter, "event")) return false;
      let hasOpenArguments = false;
      walkAst(value.node.body, (candidate) => {
        if (isFunctionLike(candidate)) return false;
        if (!spend()) {
          hasOpenArguments = true;
          return false;
        }
        if (isNodeOfType(candidate, "CallExpression")) {
          if (
            !candidate.arguments.every(
              (argument) =>
                !isNodeOfType(argument, "SpreadElement") &&
                callbackData(valueOf(argument, value.frame)),
            )
          )
            hasOpenArguments = true;
          const callable = callbackFunction(candidate, value.frame);
          if (callable && !callbackHasClosedCapabilities(callable, false)) hasOpenArguments = true;
          if (!callable) {
            const callee = resolve(valueOf(candidate.callee, value.frame)).node;
            const base =
              callee && isNodeOfType(callee, "MemberExpression")
                ? stripParenExpression(callee.object)
                : callee;
            const symbol =
              base && isNodeOfType(base, "Identifier")
                ? value.frame.module.scopes.symbolFor(base)
                : null;
            const declaration =
              symbol?.kind === "import" ? getImportDeclarationForSymbol(symbol) : null;
            if (
              (symbol?.initializer && ["let", "var"].includes(symbol.kind)) ||
              (declaration && projectIndex.resolvedSourcePathByNode.has(declaration)) ||
              (callee &&
                !isNodeOfType(callee, "Identifier") &&
                !isNodeOfType(callee, "MemberExpression"))
            )
              hasOpenArguments = true;
          }
        }
        if (isNodeOfType(candidate, "MemberExpression")) {
          const receiver = stripParenExpression(candidate.object);
          const usage = candidate.parent;
          const isKnownCall =
            usage &&
            isNodeOfType(usage, "CallExpression") &&
            usage.callee === candidate &&
            callbackFunction(usage, value.frame);
          const symbol = isNodeOfType(receiver, "Identifier")
            ? value.frame.module.scopes.symbolFor(receiver)
            : null;
          const isModuleNamespace =
            symbol && isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier");
          const isBuiltin =
            isNodeOfType(receiver, "Identifier") &&
            value.frame.module.scopes.isGlobalReference(receiver) &&
            OWNED_NATIVE_DOM_SAFE_GLOBAL_PROPERTIES.has(receiver.name);
          if (
            !callbackCapabilityNodes.has(receiver) &&
            !isKnownCall &&
            !isModuleNamespace &&
            !isBuiltin &&
            !callbackData(valueOf(receiver, value.frame))
          )
            hasOpenArguments = true;
          if (candidate.computed && !callbackData(valueOf(candidate.property, value.frame)))
            hasOpenArguments = true;
        }
        if (
          isNodeOfType(candidate, "NewExpression") &&
          !candidate.arguments.every(
            (argument) =>
              !isNodeOfType(argument, "SpreadElement") &&
              callbackData(valueOf(argument, value.frame)),
          )
        )
          hasOpenArguments = true;
        if (
          isNodeOfType(candidate, "VariableDeclarator") &&
          !isNodeOfType(candidate.id, "Identifier") &&
          !(candidate.init && callbackCapabilityNodes.has(stripParenExpression(candidate.init))) &&
          !callbackData(valueOf(candidate.init, value.frame))
        )
          hasOpenArguments = true;
        if (
          isNodeOfType(candidate, "SpreadElement") &&
          !callbackData(valueOf(candidate.argument, value.frame))
        )
          hasOpenArguments = true;
        if (
          (isNodeOfType(candidate, "ForOfStatement") ||
            isNodeOfType(candidate, "ForInStatement")) &&
          !callbackData(valueOf(candidate.right, value.frame))
        )
          hasOpenArguments = true;
        if (
          isNodeOfType(candidate, "Property") &&
          candidate.computed &&
          !callbackData(valueOf(candidate.key, value.frame))
        )
          hasOpenArguments = true;
        if (
          (isNodeOfType(candidate, "AssignmentExpression") ||
            isNodeOfType(candidate, "AssignmentPattern")) &&
          !callbackData(valueOf(candidate.right, value.frame))
        )
          hasOpenArguments = true;
        if (
          (isNodeOfType(candidate, "UpdateExpression") &&
            !callbackPrimitiveUpdateTarget(valueOf(candidate.argument, value.frame))) ||
          (isNodeOfType(candidate, "AssignmentExpression") &&
            candidate.operator !== "=" &&
            !callbackPrimitiveUpdateTarget(valueOf(candidate.left, value.frame)))
        )
          hasOpenArguments = true;
        if (
          isNodeOfType(candidate, "BinaryExpression") &&
          !["===", "!=="].includes(candidate.operator) &&
          (!callbackData(valueOf(candidate.left, value.frame)) ||
            !callbackData(valueOf(candidate.right, value.frame)))
        )
          hasOpenArguments = true;
        if (
          isNodeOfType(candidate, "UnaryExpression") &&
          !["typeof", "!", "void"].includes(candidate.operator) &&
          !callbackData(valueOf(candidate.argument, value.frame))
        )
          hasOpenArguments = true;
        if (
          isNodeOfType(candidate, "TemplateLiteral") &&
          !candidate.expressions.every((expression) =>
            callbackData(valueOf(expression, value.frame)),
          )
        )
          hasOpenArguments = true;
      });
      if (!isNodeOfType(value.node, "ArrowFunctionExpression"))
        walkAst(value.node.body, (candidate) => {
          if (isFunctionLike(candidate) && !isNodeOfType(candidate, "ArrowFunctionExpression"))
            return false;
          if (
            isNodeOfType(candidate, "Identifier") &&
            candidate.name === "arguments" &&
            !value.frame.module.scopes.symbolFor(candidate) &&
            !inspectUse(candidate, "arguments")
          )
            hasOpenArguments = true;
        });
      return !hasOpenArguments;
    } finally {
      proofDepth -= 1;
    }
  };
  const callbackValue = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      const resolved = resolve(value);
      if (resolved.callbacks) return resolved.callbacks.every(callbackValue);
      if (resolved.alternatives) return resolved.alternatives.every(callbackValue);
      if (isAbsent(resolved)) return true;
      if (!resolved.node) return false;
      if (isFunctionLike(resolved.node)) return callbackHasClosedCapabilities(resolved);
      if (isNodeOfType(resolved.node, "ConditionalExpression"))
        return (
          choiceCondition(valueOf(resolved.node.test, resolved.frame)) &&
          callbackValue(valueOf(resolved.node.consequent, resolved.frame)) &&
          callbackValue(valueOf(resolved.node.alternate, resolved.frame))
        );
      return false;
    } finally {
      proofDepth -= 1;
    }
  };
  const safeAttribute = (name: string, value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      if (name === "children") return subtree(value);
      if (name === "ref") {
        const resolved = resolveRefIdentifier(value);
        return isAbsent(value) || Boolean(resolved && certifiedRefSymbols.has(resolved));
      }
      if (reactEventProperty(name)) return callbackValue(value);
      const lowerName = name.toLowerCase();
      if (lowerName === "srcdoc") return isAbsent(value);
      if (OWNED_NATIVE_DOM_URL_PROPERTIES.has(lowerName) && !isAbsent(value)) {
        const choices = stringChoices(value);
        if (
          !choices ||
          choices.some((url) =>
            /^(?:javascript|vbscript|data):/i.test(url.replace(/[\p{Cc}\s]/gu, "")),
          )
        )
          return false;
      }
      if (
        lowerName === "is" ||
        lowerName === "autofocus" ||
        lowerName === "dangerouslysetinnerhtml" ||
        lowerName === "innerhtml" ||
        lowerName.startsWith("on")
      )
        return isAbsent(value);
      if (name === "style") return data(value);
      return primitive(value);
    } finally {
      proofDepth -= 1;
    }
  };
  const staticTruth = (value: NativeDomValue): boolean | null => {
    if (!enterProof()) return null;
    try {
      const resolved = resolve(value);
      if (resolved.booleanValue !== undefined) return resolved.booleanValue;
      if (isAbsent(resolved)) return false;
      if (!resolved.node) return null;
      if (isNodeOfType(resolved.node, "Literal")) return Boolean(resolved.node.value);
      if (isNodeOfType(resolved.node, "UnaryExpression") && resolved.node.operator === "!") {
        const argument = staticTruth(valueOf(resolved.node.argument, resolved.frame));
        return argument === null ? null : !argument;
      }
      return null;
    } finally {
      proofDepth -= 1;
    }
  };
  const stringChoices = (value: NativeDomValue): ReadonlyArray<string> | null => {
    if (!enterProof()) return null;
    try {
      if (!spend()) return null;
      const resolved = resolve(value);
      if (resolved.alternatives) {
        const result: string[] = [];
        for (const alternative of resolved.alternatives) {
          const strings = stringChoices(alternative);
          if (!strings) return null;
          result.push(...strings);
        }
        return result;
      }
      if (!resolved.node) return null;
      if (isNodeOfType(resolved.node, "Literal") && typeof resolved.node.value === "string")
        return [resolved.node.value];
      if (isNodeOfType(resolved.node, "ConditionalExpression")) {
        const test = staticTruth(valueOf(resolved.node.test, resolved.frame));
        if (test !== null)
          return stringChoices(
            valueOf(test ? resolved.node.consequent : resolved.node.alternate, resolved.frame),
          );
        if (!choiceCondition(valueOf(resolved.node.test, resolved.frame))) return null;
        const consequent = stringChoices(valueOf(resolved.node.consequent, resolved.frame));
        const alternate = stringChoices(valueOf(resolved.node.alternate, resolved.frame));
        return consequent && alternate ? [...consequent, ...alternate] : null;
      }
      return null;
    } finally {
      proofDepth -= 1;
    }
  };
  const sdkReference = (
    value: NativeDomValue,
    visited = new Set<SymbolDescriptor>(),
  ): NativeDomSdkReference | null => {
    if (!enterProof()) return null;
    try {
      if (!value.node || !spend()) return null;
      const current = stripParenExpression(value.node);
      if (
        isNodeOfType(current, "JSXMemberExpression") ||
        isNodeOfType(current, "MemberExpression")
      ) {
        const memberName = isNodeOfType(current, "JSXMemberExpression")
          ? current.property.name
          : getStaticPropertyName(current);
        const receiver = sdkReference(valueOf(current.object, value.frame), visited);
        return receiver && memberName && receiver.memberName === null
          ? { ...receiver, memberName }
          : null;
      }
      if (!isNodeOfType(current, "Identifier") && !isNodeOfType(current, "JSXIdentifier"))
        return null;
      const symbol = value.frame.module.scopes.symbolFor(current);
      if (!symbol || visited.has(symbol) || !isStableNativeBinding(symbol)) return null;
      visited.add(symbol);
      const binding = value.frame.bindings.get(symbol);
      if (binding) return sdkReference(binding, visited);
      if (symbol.kind === "const" && symbol.initializer) {
        const reference = sdkReference(valueOf(symbol.initializer, value.frame), visited);
        if (
          isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
          isNodeOfType(symbol.declarationNode.id, "ObjectPattern")
        ) {
          for (const property of symbol.declarationNode.id.properties) {
            if (!isNodeOfType(property, "Property")) continue;
            const binding = isNodeOfType(property.value, "AssignmentPattern")
              ? property.value.left
              : property.value;
            if (binding !== symbol.bindingIdentifier) continue;
            const memberName = getStaticPropertyKeyName(property, { allowComputedString: true });
            return reference && memberName && reference.memberName === null
              ? { ...reference, memberName }
              : null;
          }
          return null;
        }
        return reference;
      }
      if (symbol.kind !== "import" || !isNodeOfType(symbol.declarationNode, "ImportSpecifier"))
        return null;
      const declaration = getImportDeclarationForSymbol(symbol);
      const exportName = getImportedName(symbol.declarationNode);
      if (
        !declaration ||
        declaration.importKind === "type" ||
        symbol.declarationNode.importKind === "type" ||
        typeof declaration.source.value !== "string" ||
        !exportName
      )
        return null;
      if (
        !hasSupportedNativeUiSdkRole(value.frame.module.filePath, declaration.source.value) ||
        !projectHasReadonlySdkBindings(
          projectIndex,
          declaration.source.value === "lucide-react" ? "lucide-react" : "@base-ui/react",
        ) ||
        !closedDataReferences(symbol, value.frame)
      )
        return null;
      return { source: declaration.source.value, exportName, memberName: null };
    } finally {
      proofDepth -= 1;
    }
  };
  const sdkCall = (
    call: EsTreeNodeOfType<"CallExpression">,
    exportName: string,
    valueFrame: NativeDomFrame,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      const reference = sdkReference(valueOf(call.callee, valueFrame));
      const source =
        exportName === "mergeProps" ? "@base-ui/react/merge-props" : "@base-ui/react/use-render";
      return Boolean(
        reference &&
        reference.source === source &&
        reference.exportName === exportName &&
        reference.memberName === null,
      );
    } finally {
      proofDepth -= 1;
    }
  };
  const defaultSdkProperties = (
    props: ReadonlyMap<string, NativeDomValue>,
    omittedNames: ReadonlySet<string>,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      for (const [name, value] of props) {
        if (omittedNames.has(name)) continue;
        if (["render", "ref", "as", "asChild", "iconNode", "icon"].includes(name)) {
          if (!isAbsent(value)) return false;
          continue;
        }
        if (!safeAttribute(name, value)) return false;
      }
      return true;
    } finally {
      proofDepth -= 1;
    }
  };
  const sdkComponent = (
    value: NativeDomValue,
    props: ReadonlyMap<string, NativeDomValue>,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      if (!spend()) return false;
      const resolved = resolve(value);
      if (resolved.alternatives)
        return (
          resolved.alternatives.length > 0 &&
          resolved.alternatives.every((alternative) => sdkComponent(alternative, props))
        );
      if (resolved.node && isNodeOfType(resolved.node, "ConditionalExpression")) {
        const test = staticTruth(valueOf(resolved.node.test, resolved.frame));
        return test === null
          ? sdkComponent(valueOf(resolved.node.consequent, resolved.frame), props) &&
              sdkComponent(valueOf(resolved.node.alternate, resolved.frame), props)
          : sdkComponent(
              valueOf(test ? resolved.node.consequent : resolved.node.alternate, resolved.frame),
              props,
            );
      }
      const reference = sdkReference(value);
      if (!reference) return false;
      if (
        reference.source === "@base-ui/react/avatar" &&
        reference.exportName === "Avatar" &&
        ["Root", "Fallback"].includes(reference.memberName ?? "")
      ) {
        const delay = props.get("delay");
        if (delay && !isAbsent(delay)) {
          const resolvedDelay = resolve(delay);
          if (
            !resolvedDelay.node ||
            !isNodeOfType(resolvedDelay.node, "Literal") ||
            resolvedDelay.node.value !== 0
          )
            return false;
        }
        return defaultSdkProperties(props, new Set(["delay"]));
      }
      return (
        reference.source === "lucide-react" &&
        reference.memberName === null &&
        OWNED_NATIVE_DOM_LUCIDE_NAMES.has(reference.exportName) &&
        defaultSdkProperties(props, new Set())
      );
    } finally {
      proofDepth -= 1;
    }
  };
  const useRenderSubtree = (
    call: EsTreeNodeOfType<"CallExpression">,
    valueFrame: NativeDomFrame,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      if (call.arguments.length !== 1 || !sdkCall(call, "useRender", valueFrame)) return false;
      const argument = call.arguments[0];
      const options = argument && properties(valueOf(argument, valueFrame));
      if (
        !options ||
        [...options.keys()].some((name) => !OWNED_NATIVE_DOM_BASE_UI_OPTIONS.has(name))
      )
        return false;
      for (const name of ["render", "ref", "stateAttributesMapping"]) {
        const value = options.get(name);
        if (value && !isAbsent(value)) return false;
      }
      const enabled = options.get("enabled");
      if (enabled && !primitive(enabled)) return false;
      const tag = options.get("defaultTagName");
      if (tag && !isAbsent(tag)) {
        const names = stringChoices(tag);
        if (!names || names.some((name) => !nativeTag(name))) return false;
      }
      const state = options.get("state");
      if (state && !data(state)) return false;
      const props = options.get("props");
      const record =
        props && !isAbsent(props) ? properties(props) : new Map<string, NativeDomValue>();
      return Boolean(record && defaultSdkProperties(record, new Set()));
    } finally {
      proofDepth -= 1;
    }
  };
  const jsxProperties = (
    element: EsTreeNodeOfType<"JSXElement">,
    valueFrame: NativeDomFrame,
  ): Map<string, NativeDomValue> | null => {
    if (!enterProof()) return null;
    try {
      const result = new Map<string, NativeDomValue>();
      for (const attribute of element.openingElement.attributes) {
        if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
          const spread = properties(valueOf(attribute.argument, valueFrame));
          if (!spread) return null;
          for (const [name, value] of spread) result.set(name, value);
          continue;
        }
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) return null;
        const attributeValue = attribute.value;
        result.set(
          attribute.name.name,
          attributeValue
            ? valueOf(
                isNodeOfType(attributeValue, "JSXExpressionContainer")
                  ? attributeValue.expression
                  : attributeValue,
                valueFrame,
              )
            : { node: null, frame: valueFrame, booleanValue: true },
        );
        if (
          !attributeValue &&
          ["is", "autoFocus", "autofocus", "dangerouslySetInnerHTML"].includes(attribute.name.name)
        )
          return null;
      }
      if (element.children.length > 0)
        result.set("children", {
          node: null,
          frame: valueFrame,
          children: element.children.map((child) => valueOf(child, valueFrame)),
        });
      return result;
    } finally {
      proofDepth -= 1;
    }
  };
  const resolveComponent = (
    name: EsTreeNode,
    valueFrame: NativeDomFrame,
  ): NativeDomValue | null => {
    if (!enterProof()) return null;
    try {
      if (!spend()) return null;
      const resolved = resolve(valueOf(name, valueFrame));
      if (resolved.node && isFunctionLike(resolved.node)) {
        const parent = resolved.node.parent;
        const name = isNodeOfType(resolved.node, "FunctionDeclaration")
          ? resolved.node.id?.name
          : parent &&
              isNodeOfType(parent, "VariableDeclarator") &&
              isNodeOfType(parent.id, "Identifier")
            ? parent.id.name
            : null;
        const symbol = name && resolved.frame.module.scopes.rootScope.symbolsByName.get(name);
        return symbol && !isStableNativeBinding(symbol) ? null : resolved;
      }
      if (
        resolved.node &&
        isNodeOfType(resolved.node, "CallExpression") &&
        resolved.node.arguments.length === 1 &&
        (isClosedReactHookCall(resolved.node, "forwardRef", resolved.frame.module.scopes) ||
          isClosedReactHookCall(resolved.node, "memo", resolved.frame.module.scopes))
      ) {
        const argument = resolved.node.arguments[0];
        const target = argument && resolveComponent(argument, resolved.frame);
        return target
          ? {
              ...target,
              forwardsRef:
                isClosedReactHookCall(resolved.node, "forwardRef", resolved.frame.module.scopes) ||
                target.forwardsRef,
            }
          : null;
      }
      if (
        !resolved.node ||
        (!isNodeOfType(resolved.node, "JSXIdentifier") &&
          !isNodeOfType(resolved.node, "Identifier"))
      )
        return null;
      const symbol = resolved.frame.module.scopes.symbolFor(resolved.node);
      if (!symbol || !isStableNativeBinding(symbol) || symbol.kind !== "import") return null;
      const declaration = getImportDeclarationForSymbol(symbol);
      const sourcePath = declaration && projectIndex.resolvedSourcePathByNode.get(declaration);
      const target = sourcePath && projectIndex.modulesByFilePath.get(sourcePath);
      const exportedName = isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
        ? "default"
        : getImportedName(symbol.declarationNode);
      if (!target || !exportedName) return null;
      const exported = findExportedValue(target.programNode, exportedName);
      return exported ? resolveComponent(exported, { module: target, bindings: new Map() }) : null;
    } finally {
      proofDepth -= 1;
    }
  };
  const bindPattern = (
    pattern: EsTreeNode,
    value: NativeDomValue,
    componentFrame: NativeDomFrame,
    bindings: Map<SymbolDescriptor, NativeDomValue>,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      if (isNodeOfType(pattern, "Identifier")) {
        const symbol = componentFrame.module.scopes.symbolFor(pattern);
        if (!symbol || symbol.references.some((reference) => reference.flag !== "read"))
          return false;
        bindings.set(symbol, value);
        return true;
      }
      if (isNodeOfType(pattern, "AssignmentPattern"))
        return bindPattern(
          pattern.left,
          undefinedValue(value) ? valueOf(pattern.right, componentFrame) : value,
          componentFrame,
          bindings,
        );
      if (!isNodeOfType(pattern, "ObjectPattern")) return false;
      const record = properties(value);
      if (!record) return false;
      const remaining = new Map(record);
      for (const property of pattern.properties) {
        if (isNodeOfType(property, "RestElement")) {
          if (
            !bindPattern(
              property.argument,
              { node: null, frame: componentFrame, properties: remaining },
              componentFrame,
              bindings,
            )
          )
            return false;
          continue;
        }
        const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
        if (
          !propertyName ||
          !bindPattern(
            property.value,
            record.get(propertyName) ?? valueOf(null, componentFrame),
            componentFrame,
            bindings,
          )
        )
          return false;
        remaining.delete(propertyName);
      }
      return true;
    } finally {
      proofDepth -= 1;
    }
  };
  const closedHandleFactory = (
    call: EsTreeNodeOfType<"CallExpression">,
    valueFrame: NativeDomFrame,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      const refArgument = call.arguments[0];
      const factoryArgument = call.arguments[1];
      if (!refArgument || !factoryArgument) return false;
      let refValue = valueOf(refArgument, valueFrame);
      const visitedRefs = new Set<SymbolDescriptor>();
      let hasOwnedRef = false;
      while (
        refValue.node &&
        isNodeOfType(stripParenExpression(refValue.node), "Identifier") &&
        spend()
      ) {
        const symbol = refValue.frame.module.scopes.symbolFor(stripParenExpression(refValue.node));
        if (!symbol || visitedRefs.has(symbol)) return false;
        visitedRefs.add(symbol);
        const bound = refValue.frame.bindings.get(symbol);
        if (bound) {
          refValue = bound;
          continue;
        }
        if (
          !isStableNativeBinding(symbol) ||
          !symbol.initializer ||
          !isNodeOfType(symbol.initializer, "CallExpression") ||
          !isClosedReactHookCall(symbol.initializer, "useRef", refValue.frame.module.scopes)
        )
          return false;
        hasOwnedRef = true;
        break;
      }
      if (!hasOwnedRef) return false;
      const factory = resolve(valueOf(factoryArgument, valueFrame));
      if (
        !factory.node ||
        !isFunctionLike(factory.node) ||
        factory.node.async ||
        factory.node.generator ||
        factory.node.params.length > 0
      )
        return false;
      let result: EsTreeNode = factory.node.body;
      if (isNodeOfType(result, "BlockStatement")) {
        const statement = result.body[0];
        if (
          result.body.length !== 1 ||
          !statement ||
          !isNodeOfType(statement, "ReturnStatement") ||
          !statement.argument
        )
          return false;
        result = statement.argument;
      }
      result = stripParenExpression(result);
      if (!isNodeOfType(result, "ObjectExpression")) return false;
      const names = new Set<string>();
      return result.properties.every((property) => {
        if (!isNodeOfType(property, "Property") || property.kind !== "init") return false;
        const name = getStaticPropertyKeyName(property, { allowComputedString: true });
        if (!name || name === "__proto__" || names.has(name)) return false;
        names.add(name);
        return isFunctionLike(property.value) || primitive(valueOf(property.value, factory.frame));
      });
    } finally {
      proofDepth -= 1;
    }
  };
  const componentSubtree = (
    component: NativeDomValue,
    props: ReadonlyMap<string, NativeDomValue>,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      if (
        !component.node ||
        !isFunctionLike(component.node) ||
        component.node.async ||
        component.node.generator
      )
        return false;
      const bindings = new Map(component.frame.bindings);
      const componentFrame: NativeDomFrame = { module: component.frame.module, bindings };
      if (component.node.params.length > (component.forwardsRef ? 2 : 1)) return false;
      if (
        component.forwardsRef &&
        component.node.params[1] &&
        !bindPattern(
          component.node.params[1],
          props.get("ref") ?? valueOf(null, componentFrame),
          componentFrame,
          bindings,
        )
      )
        return false;
      if (
        component.node.params[0] &&
        !bindPattern(
          component.node.params[0],
          { node: null, frame: componentFrame, properties: props },
          componentFrame,
          bindings,
        )
      )
        return false;
      for (const [symbol, boundValue] of bindings) {
        const resolvedValue = resolve(boundValue);
        const isTemplate = Boolean(
          resolvedValue.children ||
          (resolvedValue.node &&
            (isNodeOfType(resolvedValue.node, "JSXElement") ||
              isNodeOfType(resolvedValue.node, "JSXFragment"))),
        );
        const isStructured = Boolean(
          isTemplate ||
          resolvedValue.properties ||
          (resolvedValue.node &&
            (isNodeOfType(resolvedValue.node, "ObjectExpression") ||
              isNodeOfType(resolvedValue.node, "ArrayExpression"))),
        );
        if (isStructured && !closedDataReferences(symbol, componentFrame, isTemplate)) return false;
      }
      const returns: NativeDomValue[] = [];
      let hasLifecycle = false;
      const visitRenderNode = (candidate: EsTreeNode): boolean | void => {
        if (!spend()) {
          hasLifecycle = true;
          return false;
        }
        if (isFunctionLike(candidate)) return false;
        if (isNodeOfType(candidate, "IfStatement")) {
          const test = staticTruth(valueOf(candidate.test, componentFrame));
          if (test !== null) {
            const selected = test ? candidate.consequent : candidate.alternate;
            if (selected) walkAst(selected, visitRenderNode);
            return false;
          }
        }
        if (
          isNodeOfType(candidate, "CallExpression") &&
          ["useEffect", "useLayoutEffect", "useInsertionEffect"].some((hookName) =>
            isClosedReactHookCall(candidate, hookName, componentFrame.module.scopes),
          )
        )
          hasLifecycle = true;
        if (
          isNodeOfType(candidate, "CallExpression") &&
          isClosedReactHookCall(candidate, "useImperativeHandle", componentFrame.module.scopes) &&
          !closedHandleFactory(candidate, componentFrame)
        )
          hasLifecycle = true;
        if (isNodeOfType(candidate, "ReturnStatement") && candidate.argument)
          returns.push(valueOf(candidate.argument, componentFrame));
      };
      walkAst(component.node.body, visitRenderNode);
      if (!isNodeOfType(component.node.body, "BlockStatement"))
        returns.push(valueOf(component.node.body, componentFrame));
      return !hasLifecycle && returns.length > 0 && returns.every(subtree);
    } finally {
      proofDepth -= 1;
    }
  };
  const subtree = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      if (value.children) return value.children.every(subtree);
      const resolved = resolve(value);
      if (resolved.children) return resolved.children.every(subtree);
      if (resolved.alternatives)
        return resolved.alternatives.length > 0 && resolved.alternatives.every(subtree);
      if (!resolved.node) return true;
      const current = resolved.node;
      return descend(resolved, false, () => {
        if (isNodeOfType(current, "JSXText") || isNodeOfType(current, "JSXEmptyExpression"))
          return true;
        if (isNodeOfType(current, "JSXExpressionContainer"))
          return subtree(valueOf(current.expression, resolved.frame));
        if (isNodeOfType(current, "JSXFragment"))
          return current.children.every((child) => subtree(valueOf(child, resolved.frame)));
        if (isNodeOfType(current, "ConditionalExpression")) {
          const test = staticTruth(valueOf(current.test, resolved.frame));
          return test === null
            ? subtree(valueOf(current.consequent, resolved.frame)) &&
                subtree(valueOf(current.alternate, resolved.frame))
            : subtree(valueOf(test ? current.consequent : current.alternate, resolved.frame));
        }
        if (isNodeOfType(current, "LogicalExpression")) {
          const left = valueOf(current.left, resolved.frame);
          const test = staticTruth(left);
          if (current.operator === "&&" && test !== null)
            return test ? subtree(valueOf(current.right, resolved.frame)) : true;
          if (current.operator === "||" && test !== null)
            return test ? subtree(left) : subtree(valueOf(current.right, resolved.frame));
          return isAbsent(left)
            ? subtree(valueOf(current.right, resolved.frame))
            : subtree(left) && subtree(valueOf(current.right, resolved.frame));
        }
        if (isNodeOfType(current, "ArrayExpression"))
          return current.elements.every(
            (element) => element === null || subtree(valueOf(element, resolved.frame)),
          );
        if (
          isNodeOfType(current, "CallExpression") &&
          sdkCall(current, "useRender", resolved.frame)
        )
          return useRenderSubtree(current, resolved.frame);
        if (!isNodeOfType(current, "JSXElement")) {
          activeNodes.delete(current);
          return primitive(resolved);
        }
        const props = jsxProperties(current, resolved.frame);
        if (!props) return false;
        const name = current.openingElement.name;
        if (isNodeOfType(name, "JSXIdentifier") && nativeTag(name.name))
          return [...props].every(([propertyName, propertyValue]) =>
            safeAttribute(propertyName, propertyValue),
          );
        const tag = staticString(valueOf(name, resolved.frame));
        if (tag)
          return (
            nativeTag(tag) &&
            [...props].every(([propertyName, propertyValue]) =>
              safeAttribute(propertyName, propertyValue),
            )
          );
        if (sdkComponent(valueOf(name, resolved.frame), props)) return true;
        const component = resolveComponent(name, resolved.frame);
        return Boolean(component && componentSubtree(component, props));
      });
    } finally {
      proofDepth -= 1;
    }
  };
  const resolveRefIdentifier = (value: NativeDomValue): SymbolDescriptor | null => {
    if (!enterProof()) return null;
    try {
      if (!value.node) return null;
      const current = stripParenExpression(value.node);
      if (!isNodeOfType(current, "Identifier")) return null;
      const symbol = value.frame.module.scopes.symbolFor(current);
      return symbol && isStableNativeBinding(symbol) ? symbol : null;
    } finally {
      proofDepth -= 1;
    }
  };
  const ownedRef = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      const symbol = resolveRefIdentifier(value);
      if (
        !symbol ||
        !symbol.initializer ||
        !(
          isNodeOfType(symbol.initializer, "CallExpression") &&
          isClosedReactHookCall(symbol.initializer, "useRef", value.frame.module.scopes)
        )
      )
        return false;
      if (
        !isNodeOfType(symbol.initializer, "CallExpression") ||
        symbol.initializer.arguments.length !== 1
      )
        return false;
      const initialValue = symbol.initializer.arguments[0];
      if (!initialValue || !isNodeOfType(initialValue, "Literal") || initialValue.value !== null)
        return false;
      if (certifiedRefSymbols.has(symbol)) return true;
      const hosts: EsTreeNodeOfType<"JSXElement">[] = [];
      for (const reference of symbol.references) {
        const parent = findTransparentExpressionRoot(reference.identifier).parent;
        if (
          parent &&
          isNodeOfType(parent, "JSXExpressionContainer") &&
          parent.parent &&
          isNodeOfType(parent.parent, "JSXAttribute") &&
          isNodeOfType(parent.parent.name, "JSXIdentifier") &&
          parent.parent.name.name === "ref"
        ) {
          const opening = parent.parent.parent;
          if (
            !opening ||
            !isNodeOfType(opening, "JSXOpeningElement") ||
            !opening.parent ||
            !isNodeOfType(opening.parent, "JSXElement") ||
            !isNodeOfType(opening.name, "JSXIdentifier") ||
            !nativeTag(opening.name.name)
          )
            return false;
          hosts.push(opening.parent);
          continue;
        }
        if (
          !parent ||
          !isNodeOfType(parent, "MemberExpression") ||
          stripParenExpression(parent.object) !== reference.identifier ||
          getStaticPropertyName(parent) !== "current"
        )
          return false;
      }
      if (hosts.length !== 1) return false;
      certifiedRefSymbols.add(symbol);
      const hasClosedUses = symbol.references.every((reference) => {
        const parent = findTransparentExpressionRoot(reference.identifier).parent;
        return Boolean(
          parent &&
          (!isNodeOfType(parent, "MemberExpression") || safeNativeUse(parent, value.frame)),
        );
      });
      let renderedRoot: EsTreeNode | null = hosts[0] ?? null;
      let ancestor = renderedRoot?.parent;
      while (ancestor && !isFunctionLike(ancestor)) {
        if (isNodeOfType(ancestor, "JSXElement") || isNodeOfType(ancestor, "JSXFragment"))
          renderedRoot = ancestor;
        ancestor = ancestor.parent;
      }
      if (hasClosedUses && subtree(valueOf(renderedRoot, value.frame))) return true;
      certifiedRefSymbols.delete(symbol);
      return false;
    } finally {
      proofDepth -= 1;
    }
  };
  const nativeOrigin = (value: NativeDomValue, visitedSymbols: Set<SymbolDescriptor>): boolean => {
    if (!enterProof()) return false;
    try {
      if (!value.node || !spend()) return false;
      const current = stripParenExpression(value.node);
      if (isNodeOfType(current, "Identifier")) {
        const symbol = value.frame.module.scopes.symbolFor(current);
        if (!symbol || !isStableNativeBinding(symbol) || visitedSymbols.has(symbol)) return false;
        visitedSymbols.add(symbol);
        if (symbol.initializer)
          return nativeOrigin(valueOf(symbol.initializer, value.frame), visitedSymbols);
        const loop = symbol.declarationNode.parent?.parent;
        return Boolean(
          loop &&
          isNodeOfType(loop, "ForOfStatement") &&
          nativeOrigin(valueOf(loop.right, value.frame), visitedSymbols),
        );
      }
      if (
        isNodeOfType(current, "MemberExpression") &&
        getStaticPropertyName(current) === "current"
      ) {
        const symbol = resolveRefIdentifier(valueOf(current.object, value.frame));
        return Boolean(symbol && certifiedRefSymbols.has(symbol));
      }
      if (
        !isNodeOfType(current, "CallExpression") ||
        !isNodeOfType(current.callee, "MemberExpression")
      )
        return false;
      const method = getStaticPropertyName(current.callee);
      if (!OWNED_NATIVE_DOM_QUERY_METHODS.has(method ?? "") && method !== "cloneNode") return false;
      return (
        nativeOrigin(valueOf(current.callee.object, value.frame), visitedSymbols) &&
        current.arguments.every((argument) => primitive(valueOf(argument, value.frame)))
      );
    } finally {
      proofDepth -= 1;
    }
  };
  const native = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      if (!value.node) return false;
      const current = stripParenExpression(value.node);
      if (certifiedNativeNodes.has(current)) return true;
      if (activeNodes.has(current)) return nativeOrigin(value, new Set());
      if (
        isNodeOfType(current, "MemberExpression") &&
        getStaticPropertyName(current) === "current"
      ) {
        const symbol = resolveRefIdentifier(valueOf(current.object, value.frame));
        if (symbol && certifiedRefSymbols.has(symbol)) return true;
      }
      return descend(value, false, () => {
        if (isNodeOfType(current, "Identifier")) {
          const symbol = value.frame.module.scopes.symbolFor(current);
          if (!symbol || !isStableNativeBinding(symbol)) return false;
          const loop = symbol.declarationNode.parent?.parent;
          const hasNativeLoopOrigin =
            !symbol.initializer &&
            loop &&
            isNodeOfType(loop, "ForOfStatement") &&
            collection(valueOf(loop.right, value.frame));
          if (
            !hasNativeLoopOrigin &&
            (!symbol.initializer || !native(valueOf(symbol.initializer, value.frame)))
          )
            return false;
          certifiedNativeNodes.add(current);
          if (inspectedValueSymbols.has(symbol)) return true;
          inspectedValueSymbols.add(symbol);
          return symbol.references.every((reference) =>
            safeNativeUse(reference.identifier, value.frame),
          );
        }
        if (
          isNodeOfType(current, "MemberExpression") &&
          getStaticPropertyName(current) === "current"
        )
          return ownedRef(valueOf(current.object, value.frame));
        if (
          isNodeOfType(current, "CallExpression") &&
          isNodeOfType(current.callee, "MemberExpression")
        ) {
          const method = getStaticPropertyName(current.callee);
          if (OWNED_NATIVE_DOM_QUERY_METHODS.has(method ?? "") || method === "cloneNode")
            return operation(current, value.frame);
          if (method === "createTextNode") {
            const receiver = stripParenExpression(current.callee.object);
            return (
              isNodeOfType(receiver, "Identifier") &&
              receiver.name === "document" &&
              value.frame.module.scopes.isGlobalReference(receiver) &&
              current.arguments.length === 1 &&
              current.arguments.every((argument) => primitive(valueOf(argument, value.frame)))
            );
          }
          if (method === "createElement" || method === "createElementNS") {
            const receiver = stripParenExpression(current.callee.object);
            const tagArgument = current.arguments.at(method === "createElement" ? 0 : 1);
            return (
              isNodeOfType(receiver, "Identifier") &&
              receiver.name === "document" &&
              value.frame.module.scopes.isGlobalReference(receiver) &&
              current.arguments.length === (method === "createElement" ? 1 : 2) &&
              Boolean(
                tagArgument && nativeTag(staticString(valueOf(tagArgument, value.frame)) ?? ""),
              ) &&
              (method === "createElement" ||
                ["http://www.w3.org/1999/xhtml", "http://www.w3.org/2000/svg"].includes(
                  staticString(valueOf(current.arguments[0] ?? null, value.frame)) ?? "",
                )) &&
              current.arguments.every((argument) => primitive(valueOf(argument, value.frame)))
            );
          }
        }
        return false;
      });
    } finally {
      proofDepth -= 1;
    }
  };
  const safeNativeUse = (usage: EsTreeNode, valueFrame: NativeDomFrame): boolean => {
    if (!enterProof()) return false;
    try {
      const parent = usage.parent;
      if (!parent) return false;
      if (
        isNodeOfType(parent, "TSNonNullExpression") ||
        isNodeOfType(parent, "TSAsExpression") ||
        isNodeOfType(parent, "TSSatisfiesExpression") ||
        isNodeOfType(parent, "ChainExpression")
      )
        return safeNativeUse(parent, valueFrame);
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === usage &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const symbol = valueFrame.module.scopes.symbolFor(parent.id);
        if (!symbol || !isStableNativeBinding(symbol)) return false;
        if (inspectedValueSymbols.has(symbol)) return true;
        inspectedValueSymbols.add(symbol);
        for (const reference of symbol.references) certifiedNativeNodes.add(reference.identifier);
        return symbol.references.every((reference) =>
          safeNativeUse(reference.identifier, valueFrame),
        );
      }
      if (isNodeOfType(parent, "IfStatement") && parent.test === usage) return true;
      if (isNodeOfType(parent, "UnaryExpression"))
        return ["!", "typeof", "void"].includes(parent.operator);
      if (isNodeOfType(parent, "LogicalExpression"))
        return (
          (parent.operator === "&&" && parent.left === usage) || safeNativeUse(parent, valueFrame)
        );
      if (isNodeOfType(parent, "BinaryExpression")) {
        if (["===", "!=="].includes(parent.operator)) return true;
        if (!["==", "!="].includes(parent.operator)) return false;
        const other = resolve(
          valueOf(parent.left === usage ? parent.right : parent.left, valueFrame),
        );
        return (
          undefinedValue(other) ||
          Boolean(other.node && isNodeOfType(other.node, "Literal") && other.node.value === null)
        );
      }
      if (isNodeOfType(parent, "ForOfStatement") && parent.right === usage)
        return collection(valueOf(usage, valueFrame));
      if (isNodeOfType(parent, "CallExpression")) {
        if (!isNodeOfType(parent.callee, "MemberExpression")) return false;
        const method = getStaticPropertyName(parent.callee);
        return (
          ["append", "appendChild", "removeChild", "replaceChildren"].includes(method ?? "") &&
          operation(parent, valueFrame)
        );
      }
      if (!isNodeOfType(parent, "MemberExpression") || parent.object !== usage) return false;
      const name = getStaticPropertyName(parent);
      if (!name) return false;
      if (name === "dataset") {
        const property = parent.parent;
        if (!property || !isNodeOfType(property, "MemberExpression") || property.object !== parent)
          return false;
        const dataName = getStaticPropertyName(property);
        if (!dataName || OWNED_NATIVE_DOM_INHERITED_DATASET_PROPERTIES.has(dataName)) return false;
        const assignment = property.parent;
        if (assignment && isNodeOfType(assignment, "AssignmentExpression"))
          return (
            assignment.left === property &&
            assignment.operator === "=" &&
            primitive(valueOf(assignment.right, valueFrame))
          );
        return (
          assignment?.type !== "UpdateExpression" &&
          !(
            assignment &&
            isNodeOfType(assignment, "UnaryExpression") &&
            assignment.operator === "delete"
          )
        );
      }
      if (OWNED_NATIVE_DOM_GEOMETRY_PROPERTIES.has(name))
        return (
          parent.parent?.type !== "AssignmentExpression" &&
          parent.parent?.type !== "UpdateExpression"
        );
      if (name === "style") {
        const property = parent.parent;
        if (!property || !isNodeOfType(property, "MemberExpression") || property.object !== parent)
          return false;
        const styleName = getStaticPropertyName(property);
        if (styleName && OWNED_NATIVE_DOM_STYLE_METHODS.has(styleName))
          return Boolean(
            property.parent &&
            isNodeOfType(property.parent, "CallExpression") &&
            property.parent.arguments.every((argument) => primitive(valueOf(argument, valueFrame))),
          );
        if (!styleName || !OWNED_NATIVE_DOM_STYLE_PROPERTIES.has(styleName)) return false;
        const assignment = property.parent;
        return (
          !assignment ||
          !isNodeOfType(assignment, "AssignmentExpression") ||
          (assignment.left === property && primitive(valueOf(assignment.right, valueFrame)))
        );
      }
      const call = parent.parent;
      if (
        call &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === parent &&
        ["click", "dispatchEvent"].includes(name)
      )
        return true;
      if (
        !call ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== parent ||
        !operation(call, valueFrame)
      )
        return false;
      return !OWNED_NATIVE_DOM_QUERY_METHODS.has(name) && name !== "cloneNode"
        ? true
        : safeNativeUse(call, valueFrame);
    } finally {
      proofDepth -= 1;
    }
  };
  const collection = (value: NativeDomValue): boolean => {
    if (!enterProof()) return false;
    try {
      const resolved = resolve(value);
      return Boolean(
        resolved.node &&
        isNodeOfType(resolved.node, "CallExpression") &&
        isNodeOfType(resolved.node.callee, "MemberExpression") &&
        getStaticPropertyName(resolved.node.callee) === "querySelectorAll" &&
        operation(resolved.node, resolved.frame),
      );
    } finally {
      proofDepth -= 1;
    }
  };
  const mutation = (mutationNode: EsTreeNode, valueFrame: NativeDomFrame): boolean => {
    if (!enterProof()) return false;
    try {
      if (
        !isNodeOfType(mutationNode, "AssignmentExpression") ||
        mutationNode.operator !== "=" ||
        !isNodeOfType(mutationNode.left, "MemberExpression")
      )
        return false;
      const propertyName = getStaticPropertyName(mutationNode.left);
      const receiver = stripParenExpression(mutationNode.left.object);
      if (!propertyName || !isNodeOfType(receiver, "MemberExpression")) return false;
      const receiverName = getStaticPropertyName(receiver);
      const isStyle =
        receiverName === "style" && OWNED_NATIVE_DOM_STYLE_PROPERTIES.has(propertyName);
      const isDataset =
        receiverName === "dataset" &&
        !OWNED_NATIVE_DOM_INHERITED_DATASET_PROPERTIES.has(propertyName);
      return (
        (isStyle || isDataset) &&
        native(valueOf(receiver.object, valueFrame)) &&
        primitive(valueOf(mutationNode.right, valueFrame))
      );
    } finally {
      proofDepth -= 1;
    }
  };
  const operation = (
    call: EsTreeNodeOfType<"CallExpression">,
    valueFrame: NativeDomFrame,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      const callee = stripParenExpression(call.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return false;
      const method = getStaticPropertyName(callee);
      if (!method) return false;
      const receiver = stripParenExpression(callee.object);
      if (
        OWNED_NATIVE_DOM_STYLE_METHODS.has(method) &&
        isNodeOfType(receiver, "MemberExpression") &&
        getStaticPropertyName(receiver) === "style"
      )
        return (
          native(valueOf(receiver.object, valueFrame)) &&
          call.arguments.every((argument) => primitive(valueOf(argument, valueFrame)))
        );
      if (method === "createElement" || method === "createElementNS" || method === "createTextNode")
        return native(valueOf(call, valueFrame));
      if (!native(valueOf(receiver, valueFrame))) return false;
      if (OWNED_NATIVE_DOM_QUERY_METHODS.has(method))
        return (
          call.arguments.length === 1 &&
          Boolean(staticString(valueOf(call.arguments[0] ?? null, valueFrame)))
        );
      if (OWNED_NATIVE_DOM_GEOMETRY_METHODS.has(method) || method === "remove")
        return call.arguments.length === 0;
      if (method === "cloneNode")
        return (
          call.arguments.length <= 1 &&
          call.arguments.every((argument) => primitive(valueOf(argument, valueFrame)))
        );
      if (["append", "appendChild", "removeChild", "replaceChildren"].includes(method))
        return call.arguments.every(
          (argument) =>
            native(valueOf(argument, valueFrame)) || primitive(valueOf(argument, valueFrame)),
        );
      if (method === "animate")
        return (
          call.arguments.length > 0 &&
          call.arguments.every((argument) => data(valueOf(argument, valueFrame)))
        );
      return false;
    } finally {
      proofDepth -= 1;
    }
  };
  const eventDispatch = (
    call: EsTreeNodeOfType<"CallExpression">,
    valueFrame: NativeDomFrame,
  ): boolean => {
    if (!enterProof()) return false;
    try {
      const callee = stripParenExpression(call.callee);
      if (!isNodeOfType(callee, "MemberExpression") || !native(valueOf(callee.object, valueFrame)))
        return false;
      const method = getStaticPropertyName(callee);
      if (method === "click") return call.arguments.length === 0;
      if (method !== "dispatchEvent" || call.arguments.length !== 1) return false;
      const argument = call.arguments[0];
      if (!argument || isNodeOfType(argument, "SpreadElement")) return false;
      const event = resolve(valueOf(argument, valueFrame));
      if (
        !event.node ||
        !isNodeOfType(event.node, "NewExpression") ||
        event.node.arguments.length < 1 ||
        event.node.arguments.length > 2
      )
        return false;
      const isCustom = isProvenGlobalNamespaceReference(
        event.node.callee,
        "CustomEvent",
        event.frame.module.scopes,
      );
      if (
        !isCustom &&
        !isProvenGlobalNamespaceReference(event.node.callee, "Event", event.frame.module.scopes)
      )
        return false;
      const type = event.node.arguments[0];
      if (!type || !primitive(valueOf(type, event.frame))) return false;
      const initializer = event.node.arguments[1];
      if (!initializer || undefinedValue(valueOf(initializer, event.frame))) return true;
      const fields = properties(valueOf(initializer, event.frame));
      if (!fields) return false;
      for (const [name, value] of fields) {
        if (name === "detail" && isCustom) {
          if (!data(value)) return false;
        } else if (!["bubbles", "cancelable", "composed"].includes(name) || !primitive(value))
          return false;
      }
      return true;
    } finally {
      proofDepth -= 1;
    }
  };
  if (context.scopes !== currentModule.scopes) return null;
  return { operation, primitive, mutation, collection, refValue: native, eventDispatch, frame };
};

export const certifyOwnedNativeDomOperation = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  const certificate = createNativeDomCertificate(call, context, projectIndex);
  return Boolean(certificate?.operation(call, certificate.frame));
};

export const isOwnedNativePrimitive = (
  node: EsTreeNode,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  const certificate = createNativeDomCertificate(node, context, projectIndex);
  return Boolean(certificate?.primitive({ node, frame: certificate.frame }));
};

export const certifyOwnedNativeDomMutation = (
  node: EsTreeNode,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  const certificate = createNativeDomCertificate(node, context, projectIndex);
  return Boolean(certificate?.mutation(node, certificate.frame));
};

export const isOwnedNativeCollection = (
  node: EsTreeNode,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  const certificate = createNativeDomCertificate(node, context, projectIndex);
  return Boolean(certificate?.collection({ node, frame: certificate.frame }));
};

export const isOwnedNativeRefValue = (
  node: EsTreeNode,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  const current = stripParenExpression(node);
  if (!isNodeOfType(current, "MemberExpression") || getStaticPropertyName(current) !== "current")
    return false;
  const certificate = createNativeDomCertificate(node, context, projectIndex);
  return Boolean(certificate?.refValue({ node: current, frame: certificate.frame }));
};

export const isClosedReactRefRead = (
  node: EsTreeNode,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  const current = stripParenExpression(node);
  if (!isNodeOfType(current, "MemberExpression") || getStaticPropertyName(current) !== "current")
    return false;
  const receiver = stripParenExpression(current.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const program = findProgramRoot(node);
  const module = [...projectIndex.modulesByFilePath.values()].find(
    (candidate) => candidate.programNode === program,
  );
  if (!module || context.scopes !== module.scopes || projectIndex.hasOpaqueMdxConsumerSurface)
    return false;
  const origin = resolveConstIdentifierAlias(receiver, module.scopes);
  if (
    !origin ||
    origin.kind !== "const" ||
    !origin.initializer ||
    !isNodeOfType(origin.initializer, "CallExpression") ||
    !isClosedReactHookCall(origin.initializer, "useRef", module.scopes) ||
    origin.initializer.arguments.length !== 1
  )
    return false;
  const initializer = origin.initializer.arguments[0];
  if (!initializer || !isNodeOfType(initializer, "Literal") || initializer.value !== null)
    return false;
  const ownerFunction = findEnclosingFunction(origin.bindingIdentifier);
  if (!ownerFunction) return false;
  const nativeOwner = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
    isNodeOfType(opening.name, "JSXIdentifier") &&
    (HTML_TAGS.has(opening.name.name) || SVG_TAGS.has(opening.name.name)) &&
    !OWNED_NATIVE_DOM_UNSAFE_TAGS.has(opening.name.name) &&
    !opening.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXSpreadAttribute") ||
        (isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name.toLowerCase() === "is"),
    );
  const pending = [origin];
  const inspected = new Set<SymbolDescriptor>();
  const hosts = new Set<EsTreeNodeOfType<"JSXElement">>();
  let remaining = OWNED_NATIVE_DOM_GRAPH_BUDGET;
  while (pending.length > 0) {
    if (--remaining < 0 || inspected.size >= OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT) return false;
    const symbol = pending.pop();
    if (!symbol || inspected.has(symbol)) continue;
    if (
      symbol.kind !== "const" ||
      !isStableNativeBinding(symbol) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      symbol.declarationNode.parent?.parent?.type === "ExportNamedDeclaration"
    )
      return false;
    inspected.add(symbol);
    for (const reference of symbol.references) {
      if (--remaining < 0) return false;
      const usage = findTransparentExpressionRoot(reference.identifier);
      const parent = usage.parent;
      if (!parent) return false;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === usage &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const alias = module.scopes.symbolFor(parent.id);
        if (!alias) return false;
        pending.push(alias);
        continue;
      }
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === usage &&
        getStaticPropertyName(parent) === "current"
      ) {
        const member = findTransparentExpressionRoot(parent);
        if (!isNodeOfType(member.parent, "MemberExpression") && isWithinAssignmentTarget(member))
          return false;
        continue;
      }
      const attribute = isNodeOfType(parent, "JSXExpressionContainer") ? parent.parent : null;
      const opening = attribute?.parent;
      if (
        !attribute ||
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        attribute.name.name !== "ref" ||
        !opening ||
        !isNodeOfType(opening, "JSXOpeningElement") ||
        !nativeOwner(opening) ||
        opening.attributes.filter(
          (candidate) =>
            isNodeOfType(candidate, "JSXAttribute") &&
            isNodeOfType(candidate.name, "JSXIdentifier") &&
            candidate.name.name === "ref",
        ).length !== 1 ||
        !isNodeOfType(opening.parent, "JSXElement") ||
        findEnclosingFunction(opening) !== ownerFunction
      )
        return false;
      hosts.add(opening.parent);
    }
  }
  if (hosts.size !== 1) return false;
  const closedFunctions = new Set<EsTreeNode>();
  const closedFunctionBindings = new Set<SymbolDescriptor>();
  const closeFunctionBinding = (
    symbol: SymbolDescriptor,
    sourceModule: SourceProjectModule,
  ): boolean => {
    if (--remaining < 0 || closedFunctionBindings.size >= OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT)
      return false;
    if (closedFunctionBindings.has(symbol)) return true;
    if (!isStableNativeBinding(symbol)) return false;
    closedFunctionBindings.add(symbol);
    return symbol.references.every((reference) => {
      if (--remaining < 0) return false;
      const usage = findTransparentExpressionRoot(reference.identifier);
      const parent = usage.parent;
      if (!parent) return false;
      if (
        (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
        parent.name === usage
      )
        return Boolean(
          parent.parent &&
          isNodeOfType(parent.parent, "JSXElement") &&
          closeRenderedElement(parent.parent, sourceModule),
        );
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === usage &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const alias = sourceModule.scopes.symbolFor(parent.id);
        return Boolean(
          alias && alias.kind === "const" && closeFunctionBinding(alias, sourceModule),
        );
      }
      return (
        (isNodeOfType(parent, "ExportSpecifier") && parent.local === usage) ||
        (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === usage)
      );
    });
  };
  const closeFunction = (
    sourceFunction: EsTreeNode,
    sourceModule: SourceProjectModule,
  ): boolean => {
    if (
      --remaining < 0 ||
      closedFunctions.size >= OWNED_NATIVE_DOM_PROOF_DEPTH_LIMIT ||
      !isFunctionLike(sourceFunction)
    )
      return false;
    if (closedFunctions.has(sourceFunction)) return true;
    closedFunctions.add(sourceFunction);
    let hasClosedOuterBinding = isNodeOfType(sourceFunction, "FunctionDeclaration");
    if (
      (isNodeOfType(sourceFunction, "FunctionDeclaration") ||
        isNodeOfType(sourceFunction, "FunctionExpression")) &&
      sourceFunction.id
    ) {
      const binding = sourceModule.scopes.symbolFor(sourceFunction.id);
      if (!binding || !closeFunctionBinding(binding, sourceModule)) return false;
      if (isNodeOfType(sourceFunction, "FunctionDeclaration")) {
        const outerBinding = sourceModule.scopes
          .scopeFor(sourceFunction)
          .symbolsByName.get(sourceFunction.id.name);
        if (!outerBinding || !closeFunctionBinding(outerBinding, sourceModule)) return false;
      }
    }
    const declaration = findTransparentExpressionRoot(sourceFunction).parent;
    if (
      declaration &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      isNodeOfType(declaration.id, "Identifier")
    ) {
      const binding = sourceModule.scopes.symbolFor(declaration.id);
      if (!binding || binding.kind !== "const" || !closeFunctionBinding(binding, sourceModule))
        return false;
      hasClosedOuterBinding = true;
    }
    if (
      !hasClosedOuterBinding &&
      (!declaration || !isNodeOfType(declaration, "ExportDefaultDeclaration"))
    )
      return false;
    for (const consumer of projectIndex.consumerModulesByFilePath.get(sourceModule.filePath) ??
      []) {
      let hasClosedConsumers = true;
      walkAst(consumer.programNode, (candidate) => {
        if (--remaining < 0) {
          hasClosedConsumers = false;
          return false;
        }
        if (projectIndex.resolvedSourcePathByNode.get(candidate) !== sourceModule.filePath) return;
        if (!isNodeOfType(candidate, "ImportDeclaration") || isTypeOnlyImport(candidate)) {
          hasClosedConsumers = false;
          return false;
        }
        for (const specifier of candidate.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            hasClosedConsumers = false;
            continue;
          }
          const name = isNodeOfType(specifier, "ImportDefaultSpecifier")
            ? "default"
            : getImportedName(specifier);
          const exported = name && findExportedValue(sourceModule.programNode, name);
          if (!exported) continue;
          const value = stripParenExpression(exported);
          const alias = isNodeOfType(value, "Identifier")
            ? resolveConstIdentifierAlias(value, sourceModule.scopes)
            : null;
          const aliasedFunction = alias?.initializer && stripParenExpression(alias.initializer);
          if (value !== sourceFunction && aliasedFunction !== sourceFunction) continue;
          const imported = consumer.scopes.symbolFor(specifier.local);
          if (!imported || !closeFunctionBinding(imported, consumer)) hasClosedConsumers = false;
        }
      });
      if (!hasClosedConsumers) return false;
    }
    return true;
  };
  const closeRenderedElement = (
    element: EsTreeNode,
    sourceModule: SourceProjectModule,
  ): boolean => {
    let rendered = element;
    while (--remaining >= 0) {
      const parent = findTransparentExpressionRoot(rendered).parent;
      if (!parent) return false;
      if (isFunctionLike(parent) && parent.body === rendered)
        return closeFunction(parent, sourceModule);
      if (isNodeOfType(parent, "ReturnStatement")) {
        const renderFunction = findEnclosingFunction(parent);
        return (
          parent.argument === rendered &&
          Boolean(renderFunction && closeFunction(renderFunction, sourceModule))
        );
      }
      if (isNodeOfType(parent, "JSXElement")) {
        if (!nativeOwner(parent.openingElement)) return false;
      } else if (isNodeOfType(parent, "JSXExpressionContainer")) {
        if (
          !isNodeOfType(parent.parent, "JSXElement") &&
          !isNodeOfType(parent.parent, "JSXFragment")
        )
          return false;
      } else if (!isNodeOfType(parent, "JSXFragment")) return false;
      rendered = parent;
    }
    return false;
  };
  const [host] = hosts;
  return Boolean(host && closeRenderedElement(host, module));
};

export const isOwnedNativeEventDispatch = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  const certificate = createNativeDomCertificate(call, context, projectIndex);
  return Boolean(certificate?.eventDispatch(call, certificate.frame));
};
