import * as path from "node:path";
import { MUTATING_ARRAY_METHODS } from "../../constants/js.js";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { collectConstAliasSymbols } from "../../utils/collect-const-alias-symbols.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getExecutionReferenceOffset } from "../../utils/get-execution-reference-offset.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasPossibleStaticPropertyWriteBefore } from "../../utils/has-static-property-write-before.js";
import { isSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isProvenGlobalNamespaceReference } from "../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../utils/is-node-reachable-within-function.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveImportedExportName } from "../../utils/find-exported-function-body.js";
import type { ResolvedCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { resolveCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import type { RuleContext } from "../../utils/rule-context.js";

const NAVIGATING_TARGETS = new Set(["_self", "_top", "_parent"]);
const GLOBAL_OPEN_RECEIVER_NAMES = ["frames", "globalThis", "parent", "self", "top", "window"];
const OPAQUE_FEATURE_TEXT = "\u0000";
const OPENER_PROTECTION_FEATURE_NAMES = new Set(["noopener", "noreferrer"]);
const ENABLED_FEATURE_VALUES = new Set(["1", "true", "yes"]);
let currentScopes: ScopeAnalysis | undefined;
let currentRuleContext: RuleContext | undefined;
let currentWindowOpenCall: EsTreeNode | undefined;
let currentDestinationCoercionReference: EsTreeNode | undefined;
let currentDestinationCoercionBoundaryReference: EsTreeNode | undefined;
let currentLocalFunctionInvocationReference: EsTreeNode | undefined;
let currentLocalFunctionSerializationReference: EsTreeNode | undefined;
let currentImmediateLocalFunctionSerializationReference: EsTreeNode | undefined;
let currentAnalyzedLocalFunction: EsTreeNode | undefined;
let currentOpaqueLocalFunctionSerializationReference: EsTreeNode | undefined;
let currentDeferredLocalFunctions: EsTreeNode[] = [];
let trustedTopLevelDestinationMemo = new WeakMap<EsTreeNode, boolean>();
let symbolHasPossibleWriteReferenceMemo = new WeakMap<SymbolDescriptor, boolean>();
let localFunctionCallArgumentsMemo = new WeakMap<
  EsTreeNode,
  Map<number, Array<EsTreeNode | null> | null>
>();
let routerCallsByFunctionMemo = new WeakMap<
  EsTreeNode,
  Array<EsTreeNodeOfType<"CallExpression">>
>();
let globalNamespaceMutationNodesMemo = new WeakMap<ScopeAnalysis, Map<string, EsTreeNode[]>>();
let objectMutationCallsBySymbolMemo = new WeakMap<SymbolDescriptor, EsTreeNode[]>();

interface LocalFunctionExecutionContext {
  functions: EsTreeNode[];
  immediateReferences: Array<EsTreeNodeOfType<"CallExpression">> | null;
  references: Array<EsTreeNodeOfType<"CallExpression">> | null;
}

const writeExecutesBeforeDestinationReference = (
  writeNode: EsTreeNode,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isSymbolWriteBefore(writeNode, referenceNode, scopes)) return true;
  const program = isAnalyzingDeferredForeignExport ? findProgramRoot(referenceNode) : null;
  return Boolean(program && isSymbolWriteBefore(writeNode, program, scopes));
};

const isPatternAssignmentTarget = (identifier: EsTreeNode): boolean => {
  let targetChild = identifier;
  let targetParent = targetChild.parent;
  let isInsidePattern = false;
  while (targetParent) {
    if (isNodeOfType(targetParent, "ArrayPattern") || isNodeOfType(targetParent, "ObjectPattern")) {
      isInsidePattern = true;
    } else if (isNodeOfType(targetParent, "AssignmentPattern")) {
      if (targetParent.left !== targetChild) return false;
    } else if (isNodeOfType(targetParent, "Property")) {
      if (targetParent.value !== targetChild) return false;
    } else if (isNodeOfType(targetParent, "RestElement")) {
      if (targetParent.argument !== targetChild) return false;
    } else if (isNodeOfType(targetParent, "AssignmentExpression")) {
      return isInsidePattern && targetParent.left === targetChild;
    } else if (
      isNodeOfType(targetParent, "ForInStatement") ||
      isNodeOfType(targetParent, "ForOfStatement")
    ) {
      return isInsidePattern && targetParent.left === targetChild;
    } else {
      return false;
    }
    targetChild = targetParent;
    targetParent = targetParent.parent;
  }
  return false;
};

const bindingIsUnmodifiedBefore = (identifier: EsTreeNode, referenceNode: EsTreeNode): boolean => {
  const scopes = currentScopes;
  const symbol = scopes?.symbolFor(identifier);
  let symbolHasPossibleWriteReference = symbol
    ? symbolHasPossibleWriteReferenceMemo.get(symbol)
    : undefined;
  if (symbol && symbolHasPossibleWriteReference === undefined) {
    symbolHasPossibleWriteReference = symbol.references.some(
      (reference) => reference.flag !== "read" || isPatternAssignmentTarget(reference.identifier),
    );
    symbolHasPossibleWriteReferenceMemo.set(symbol, symbolHasPossibleWriteReference);
  }
  return Boolean(
    scopes &&
    symbol &&
    (!symbolHasPossibleWriteReference ||
      (referenceNode.range != null &&
        !symbol.references.some(
          (reference) =>
            (reference.flag !== "read" || isPatternAssignmentTarget(reference.identifier)) &&
            reference.identifier.range == null,
        ) &&
        !symbol.references.some(
          (reference) =>
            (reference.flag !== "read" || isPatternAssignmentTarget(reference.identifier)) &&
            (writeExecutesBeforeDestinationReference(reference.identifier, referenceNode, scopes) ||
              (!isAnalyzingForeignExport &&
                reference.identifier.range[0] < getExecutionReferenceOffset(referenceNode))),
        ))),
  );
};

const bindingIsUnmodifiedBeforeCurrentOpen = (identifier: EsTreeNode): boolean =>
  Boolean(
    currentWindowOpenCall &&
    bindingIsUnmodifiedBefore(
      identifier,
      isAnalyzingForeignExport ? identifier : currentWindowOpenCall,
    ),
  );

// Matches the browser-global open method through bare/global references
// and the top, parent, and frames WindowProxy namespaces.
const isWindowOpenCallee = (callee: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const isGlobalOpenReference = (candidate: EsTreeNode, depth: number): boolean => {
    if (depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
    const unwrappedCandidate = stripParenExpression(candidate);
    if (isNodeOfType(unwrappedCandidate, "Identifier")) {
      if (isProvenGlobalNamespaceReference(unwrappedCandidate, "open", scopes)) return true;
      const initializer = resolveConstInitializer(unwrappedCandidate);
      if (initializer && isGlobalOpenReference(initializer, depth + 1)) return true;
      return GLOBAL_OPEN_RECEIVER_NAMES.some(
        (receiverName) =>
          destructuredGlobalNamespacePropertyName(unwrappedCandidate, receiverName, scopes) ===
          "open",
      );
    }
    return (
      isNodeOfType(unwrappedCandidate, "MemberExpression") &&
      getStaticPropertyName(unwrappedCandidate) === "open" &&
      GLOBAL_OPEN_RECEIVER_NAMES.some((receiverName) =>
        isProvenGlobalNamespaceReference(unwrappedCandidate.object, receiverName, scopes),
      )
    );
  };
  return isGlobalOpenReference(callee, 0);
};

const isStringLiteral = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"Literal"> & { value: string } =>
  node != null && isNodeOfType(node, "Literal") && typeof node.value === "string";

// `mailto:`/`tel:`/`sms:` hand the URL to an OS protocol handler and never
// open a navigable browsing context, so no `window.opener` is exposed and
// there is nothing to reverse-tabnab. `file:` is likewise inert: browsers
// refuse to navigate from a web origin to `file:`, and in desktop shells
// (Tauri/Electron dev tooling) it opens a local file the app itself wrote.
const NON_BROWSING_URL_SCHEMES = ["mailto:", "tel:", "sms:", "file:"];

// A fixed `https://host/` prefix pins the origin: the `[/?#]` terminator
// after the host guarantees any interpolation lands in the path/query,
// not the host (`` `https://github.com${x}` `` without it could become
// `https://github.com.evil.com`).
const COMPLETE_ORIGIN_PATTERN = /^https?:\/\/[^/?#]+[/?#]/i;

const SAME_ORIGIN_URL_PREFIXES = ["./", "../", "?", "#"];

// A bare relative prefix (`chat/`) pins the URL to the current origin the
// same way a leading `/` does: a scheme must precede the first `/`, `?`,
// or `#`, and the colon-free segment before that terminator rules one out
// no matter what an interpolation appends.
const BARE_RELATIVE_PATH_PREFIX_PATTERN = /^[\w.~%-]+[/?#]/;

const startsSameOriginPath = (urlText: string): boolean => {
  if (urlText.startsWith("/")) return urlText[1] !== "/" && urlText[1] !== "\\";
  if (SAME_ORIGIN_URL_PREFIXES.some((prefix) => urlText.startsWith(prefix))) return true;
  return BARE_RELATIVE_PATH_PREFIX_PATTERN.test(urlText);
};

const startsUnambiguouslySameOriginTemplatePath = (urlText: string): boolean =>
  urlText !== "/" && startsSameOriginPath(urlText);

// While a FOREIGN module's export is under trusted-destination analysis
// (see `isTrustedForeignExportExpression`), static text is only trusted
// when it stays same-origin or hands off to an OS protocol handler. The
// blanket literal exemption below exists for destinations the developer
// typed at the call site; extending it across files would erase the
// rule's current true positives on unverified imported constants, and a
// VERIFIED external origin behind a URL-named import is exactly the
// recall the name heuristic was giving away.
const isTrustedForeignStaticText = (urlText: string): boolean => {
  const trimmedText = urlText.trimStart();
  if (trimmedText.length === 0) return false;
  const loweredText = trimmedText.toLowerCase();
  if (NON_BROWSING_URL_SCHEMES.some((scheme) => loweredText.startsWith(scheme))) return true;
  return startsSameOriginPath(trimmedText);
};

// Reverse tabnabbing needs an attacker-controlled opened page. A
// developer-hardcoded string literal, a template whose origin is fixed
// (interpolations confined to the path/query), or a statically
// same-origin URL is a trusted-by-construction destination — the
// dominant real-world idiom ("Star on GitHub" buttons, `/preview?…`
// export routes) and not worth a warning. Dynamic URLs (identifiers,
// call results, member accesses, templates interpolating the
// scheme/host) keep firing.
const isTrustedStaticDestination = (urlArgument: EsTreeNode | null | undefined): boolean => {
  if (isStringLiteral(urlArgument)) {
    return isAnalyzingForeignExport ? isTrustedForeignStaticText(urlArgument.value) : true;
  }
  if (urlArgument == null || !isNodeOfType(urlArgument, "TemplateLiteral")) return false;
  if ((urlArgument.expressions?.length ?? 0) === 0) {
    return isAnalyzingForeignExport
      ? isTrustedForeignStaticText(urlArgument.quasis?.[0]?.value?.raw ?? "")
      : true;
  }
  const firstQuasiText = (urlArgument.quasis?.[0]?.value?.raw ?? "").trimStart();
  if (firstQuasiText.length === 0) return false;
  const loweredQuasiText = firstQuasiText.toLowerCase();
  if (NON_BROWSING_URL_SCHEMES.some((scheme) => loweredQuasiText.startsWith(scheme))) return true;
  if (!isAnalyzingForeignExport && COMPLETE_ORIGIN_PATTERN.test(firstQuasiText)) return true;
  return startsUnambiguouslySameOriginTemplatePath(firstQuasiText);
};

// Deep enough to resolve state-setter dataflow chains (logical fallback →
// useState binding → setter argument → const array index → local helper
// return → const element → path-builder call) while still bounding
// recursion.
const MAX_BINDING_RESOLUTION_DEPTH = 8;

// `.origin`/`.href` are only same-origin when read off a location-shaped
// receiver (`location`, `window.location`, `getLocation()`). Bare `.pathname`
// stays opaque because a value beginning with `//` becomes protocol-relative
// when passed back to `window.open`.
const isLocationShapedReceiver = (
  receiver: EsTreeNode,
  visitedFunctionNodes = new Set<EsTreeNode>(),
): boolean => {
  if (currentScopes && isProvenGlobalNamespaceReference(receiver, "location", currentScopes)) {
    return true;
  }
  if (isNodeOfType(receiver, "CallExpression")) {
    const callee = receiver.callee as EsTreeNode;
    if (!isNodeOfType(callee, "Identifier")) return false;
    const localFunction = resolveLocalFunctionNode(callee);
    if (!localFunction || visitedFunctionNodes.has(localFunction)) return false;
    const nextVisitedFunctionNodes = new Set(visitedFunctionNodes);
    nextVisitedFunctionNodes.add(localFunction);
    const returnedExpressions = collectLocalFunctionReturnExpressions(localFunction);
    return Boolean(
      returnedExpressions &&
      returnedExpressions.length > 0 &&
      returnedExpressions.every((returnedExpression) =>
        isLocationShapedReceiver(
          stripParenExpression(returnedExpression),
          nextVisitedFunctionNodes,
        ),
      ),
    );
  }
  return false;
};

// `window.origin` (and `globalThis.window.origin`) is the same value as
// `window.location.origin` — same-origin by construction.
const isWindowGlobalReceiver = (receiver: EsTreeNode): boolean => {
  return Boolean(
    currentScopes && isProvenGlobalNamespaceReference(receiver, "window", currentScopes),
  );
};

const isSameOriginLocationRead = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return false;
  if (!isNodeOfType(node.property, "Identifier")) return false;
  if (node.property.name === "origin" && isWindowGlobalReceiver(node.object as EsTreeNode)) {
    return true;
  }
  if (node.property.name !== "origin" && node.property.name !== "href") return false;
  return isLocationShapedReceiver(node.object as EsTreeNode);
};

// A nullish URL (`window.open(null)`, `cond ? url : null`) is harmless:
// it opens about:blank, which the opener fully controls.
const isNullishExpression = (node: EsTreeNode | null | undefined): boolean => {
  if (node == null) return true;
  if (isNodeOfType(node, "Literal")) return node.value === null;
  if (isNodeOfType(node, "UnaryExpression")) return node.operator === "void";
  return (
    isNodeOfType(node, "Identifier") &&
    node.name === "undefined" &&
    (!currentScopes || currentScopes.isGlobalReference(node))
  );
};

// Only a direct `const name = <init>` declarator is safe to resolve —
// `let`/`var` can be reassigned to attacker-controlled input after the
// trusted initializer, and destructured/parameter bindings carry a
// default expression here, not the actual runtime value.
const resolveConstInitializer = (identifier: EsTreeNodeOfType<"Identifier">): EsTreeNode | null => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (binding?.initializer == null) return null;
  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.init !== binding.initializer) return null;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  if (declaration.kind !== "const") return null;
  return binding.initializer;
};

const objectLiteralSuppliesTrustedProperty = (
  objectLiteral: EsTreeNode,
  propertyName: string,
  depth: number,
): boolean => {
  if (!isNodeOfType(objectLiteral, "ObjectExpression")) return false;
  let propertyTrust: boolean | null | undefined;
  for (const property of objectLiteral.properties ?? []) {
    if (isNodeOfType(property, "SpreadElement")) {
      propertyTrust = null;
      continue;
    }
    if (!isNodeOfType(property, "Property")) {
      propertyTrust = null;
      continue;
    }
    const staticPropertyName = getStaticPropertyKeyName(property, {
      allowComputedString: true,
    });
    if (staticPropertyName === propertyName) {
      propertyTrust = isTrustedDestination(property.value as EsTreeNode, depth + 1);
    } else if (staticPropertyName === null && property.computed) {
      propertyTrust = null;
    }
  }
  return propertyTrust === true;
};

const everyArrayElementSuppliesTrustedProperty = (
  arrayLiteral: EsTreeNodeOfType<"ArrayExpression">,
  propertyName: string,
  depth: number,
): boolean => {
  const elements = arrayLiteral.elements ?? [];
  return (
    elements.length > 0 &&
    elements.every(
      (element) =>
        element != null &&
        objectLiteralSuppliesTrustedProperty(
          stripParenExpression(element as EsTreeNode),
          propertyName,
          depth,
        ),
    )
  );
};

// `<CONST_ARRAY>.map((item) => ...)` / `[{...}].map(({ href }) => ...)` —
// resolves the iterated literal array of a map/forEach callback.
const resolveIteratedConstArrayLiteral = (
  callbackFunction: EsTreeNode,
): EsTreeNodeOfType<"ArrayExpression"> | null => {
  const iterationCall = callbackFunction.parent;
  if (
    !iterationCall ||
    !isNodeOfType(iterationCall, "CallExpression") ||
    !isNodeOfType(iterationCall.callee, "MemberExpression") ||
    iterationCall.arguments?.[0] !== callbackFunction
  ) {
    return null;
  }
  const iterationMethodName = getStaticPropertyName(iterationCall.callee);
  if (iterationMethodName !== "map" && iterationMethodName !== "forEach") return null;
  const iterated = stripParenExpression(iterationCall.callee.object as EsTreeNode);
  if (isNodeOfType(iterated, "ArrayExpression")) return iterated;
  if (isNodeOfType(iterated, "Identifier")) {
    const arrayInitializer = resolveConstInitializer(iterated);
    if (arrayInitializer && isNodeOfType(arrayInitializer, "ArrayExpression")) {
      return arrayInitializer;
    }
  }
  return null;
};

const isRepeatedArrayIterationCallback = (functionNode: EsTreeNode): boolean => {
  const callExpression = functionNode.parent;
  if (
    !callExpression ||
    !isNodeOfType(callExpression, "CallExpression") ||
    !(callExpression.arguments ?? []).includes(functionNode as never) ||
    !isNodeOfType(callExpression.callee, "MemberExpression")
  ) {
    return false;
  }
  const methodName = getStaticPropertyName(callExpression.callee);
  return methodName === "map" || methodName === "forEach";
};

const collectDirectLocalFunctionCalls = (
  functionNode: EsTreeNode,
): Array<EsTreeNodeOfType<"CallExpression">> | null => {
  const nameIdentifier = resolveLocalFunctionNameIdentifier(functionNode);
  const scopes = currentScopes;
  const symbol = nameIdentifier ? scopes?.symbolFor(nameIdentifier) : null;
  if (!scopes || !symbol) return null;
  const calls: Array<EsTreeNodeOfType<"CallExpression">> = [];
  for (const aliasSymbol of collectConstAliasSymbols(symbol, scopes)) {
    for (const reference of aliasSymbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const parent = referenceRoot.parent;
      if (
        parent &&
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier") &&
        scopes.symbolFor(parent.id)?.kind === "const"
      ) {
        continue;
      }
      if (!parent || !isNodeOfType(parent, "CallExpression") || parent.callee !== referenceRoot) {
        return [];
      }
      calls.push(parent);
    }
  }
  return calls.length > 0 ? calls : null;
};

const resolveLocalFunctionExecutionContext = (
  functionNode: EsTreeNode,
  depth: number,
): LocalFunctionExecutionContext => {
  if (depth > MAX_BINDING_RESOLUTION_DEPTH) {
    return { functions: [functionNode], immediateReferences: null, references: null };
  }
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const parent = functionRoot.parent;
  let directCalls: Array<EsTreeNodeOfType<"CallExpression">> | null;
  const isInlineSynchronousCallback = Boolean(
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    (parent.arguments ?? []).includes(functionRoot as never) &&
    isRepeatedArrayIterationCallback(functionNode) &&
    callDiscardsCallbackReturn(parent),
  );
  if (
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    (parent.callee === functionRoot || isInlineSynchronousCallback)
  ) {
    directCalls = [parent];
  } else {
    directCalls = collectDirectLocalFunctionCalls(functionNode);
  }
  if (!directCalls || directCalls.length === 0) {
    return { functions: [functionNode], immediateReferences: null, references: null };
  }
  const functions = [functionNode];
  const references: Array<EsTreeNodeOfType<"CallExpression">> = [];
  for (const directCall of directCalls) {
    const enclosingFunction = findEnclosingFunction(directCall);
    if (!enclosingFunction) {
      references.push(directCall);
      continue;
    }
    const enclosingContext = resolveLocalFunctionExecutionContext(enclosingFunction, depth + 1);
    functions.push(...enclosingContext.functions);
    if (!enclosingContext.references) {
      return {
        functions,
        immediateReferences: isInlineSynchronousCallback ? null : directCalls,
        references: null,
      };
    }
    references.push(...enclosingContext.references);
  }
  return {
    functions,
    immediateReferences: isInlineSynchronousCallback ? null : directCalls,
    references,
  };
};

const mutationMayAffectConfigRead = (
  mutationNode: EsTreeNode,
  referenceNode: EsTreeNode,
  isCurrentIterationElement = false,
  visitedFunctions: ReadonlySet<EsTreeNode> = new Set(),
): boolean => {
  const referenceFunction = findEnclosingFunction(referenceNode);
  const mutationFunction = findEnclosingFunction(mutationNode);
  if (
    referenceFunction &&
    mutationFunction !== referenceFunction &&
    resolveLocalFunctionNameIdentifier(referenceFunction)
  ) {
    if (visitedFunctions.has(referenceFunction)) return true;
    const invocationReferences = collectDirectLocalFunctionCalls(referenceFunction);
    if (!invocationReferences || invocationReferences.length === 0) return true;
    const nextVisitedFunctions = new Set(visitedFunctions);
    nextVisitedFunctions.add(referenceFunction);
    return invocationReferences.some((invocationReference) =>
      mutationMayAffectConfigRead(
        mutationNode,
        invocationReference,
        isCurrentIterationElement,
        nextVisitedFunctions,
      ),
    );
  }
  if (mutationNode.range == null || referenceNode.range == null) return true;
  if (mutationNode.range[0] < getExecutionReferenceOffset(referenceNode)) return true;
  return Boolean(
    !isCurrentIterationElement &&
    referenceFunction &&
    mutationFunction === referenceFunction &&
    isRepeatedArrayIterationCallback(referenceFunction),
  );
};

const isCurrentIterationIndex = (indexNode: EsTreeNode, referenceNode: EsTreeNode): boolean => {
  const lexicalReferenceFunction = findEnclosingFunction(referenceNode);
  const directCalls = lexicalReferenceFunction
    ? collectDirectLocalFunctionCalls(lexicalReferenceFunction)
    : null;
  const referenceFunction = findEnclosingFunction(
    currentLocalFunctionInvocationReference ?? directCalls?.[0] ?? referenceNode,
  );
  if (!referenceFunction || !isRepeatedArrayIterationCallback(referenceFunction)) return false;
  const indexParameter =
    isNodeOfType(referenceFunction, "FunctionDeclaration") ||
    isNodeOfType(referenceFunction, "FunctionExpression") ||
    isNodeOfType(referenceFunction, "ArrowFunctionExpression")
      ? referenceFunction.params?.[1]
      : null;
  const indexIdentifier = stripParenExpression(indexNode);
  return Boolean(
    indexParameter &&
    isNodeOfType(indexParameter, "Identifier") &&
    isNodeOfType(indexIdentifier, "Identifier") &&
    currentScopes?.symbolFor(indexParameter) === currentScopes?.symbolFor(indexIdentifier),
  );
};

const isMutationTarget = (targetNode: EsTreeNode): boolean => {
  const targetRoot = findTransparentExpressionRoot(targetNode);
  const parent = targetRoot.parent;
  return Boolean(
    parent &&
    ((isNodeOfType(parent, "AssignmentExpression") && parent.left === targetRoot) ||
      (isNodeOfType(parent, "UpdateExpression") && parent.argument === targetRoot) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "delete" &&
        parent.argument === targetRoot)),
  );
};

const collectPatternSymbols = (
  pattern: EsTreeNode,
  scopes: ScopeAnalysis,
  symbols: Set<SymbolDescriptor>,
): void => {
  if (isNodeOfType(pattern, "Identifier")) {
    const symbol = scopes.symbolFor(pattern);
    if (symbol?.kind === "const") symbols.add(symbol);
    return;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    collectPatternSymbols(pattern.left as EsTreeNode, scopes, symbols);
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements ?? []) {
      if (element) collectPatternSymbols(element as EsTreeNode, scopes, symbols);
    }
  }
};

const expressionHasPropertyMutationBefore = (
  expression: EsTreeNode,
  propertyName: string,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  isCurrentIterationElement: boolean,
): boolean => {
  const expressionRoot = findTransparentExpressionRoot(expression);
  const parent = expressionRoot.parent;
  if (
    parent &&
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === expressionRoot &&
    getStaticPropertyName(parent) === propertyName &&
    isMutationTarget(parent) &&
    mutationMayAffectConfigRead(parent, referenceNode, isCurrentIterationElement)
  ) {
    return true;
  }
  return Boolean(
    parent &&
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments?.[0] === expressionRoot &&
    globalObjectMutationMayWriteProperty(parent, propertyName, scopes) &&
    mutationMayAffectConfigRead(parent, referenceNode, isCurrentIterationElement),
  );
};

const symbolHasPropertyMutationBefore = (
  symbol: SymbolDescriptor,
  propertyName: string,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
  isCurrentIterationElement: boolean,
): boolean =>
  collectConstAliasSymbols(symbol, scopes).some((aliasSymbol) =>
    aliasSymbol.references.some((reference) =>
      expressionHasPropertyMutationBefore(
        reference.identifier,
        propertyName,
        referenceNode,
        scopes,
        isCurrentIterationElement,
      ),
    ),
  );

const hasNestedIndexedPropertyWriteBefore = (
  arrayIdentifier: EsTreeNodeOfType<"Identifier">,
  propertyName: string,
  referenceNode: EsTreeNode,
): boolean => {
  const scopes = currentScopes;
  const arraySymbol = scopes?.symbolFor(arrayIdentifier);
  if (!scopes || !arraySymbol) return false;
  const elementSymbols = new Map<SymbolDescriptor, boolean>();
  const arraySymbols = new Set(collectConstAliasSymbols(arraySymbol, scopes));

  for (const aliasSymbol of arraySymbols) {
    for (const reference of aliasSymbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const declarator = referenceRoot.parent;
      if (
        declarator &&
        isNodeOfType(declarator, "VariableDeclarator") &&
        declarator.init === referenceRoot &&
        isNodeOfType(declarator.id, "ArrayPattern")
      ) {
        for (const element of declarator.id.elements ?? []) {
          if (!element) continue;
          if (isNodeOfType(element, "RestElement")) {
            const restArgument = element.argument as EsTreeNode;
            if (isNodeOfType(restArgument, "Identifier")) {
              const restSymbol = scopes.symbolFor(restArgument);
              if (restSymbol?.kind === "const") {
                for (const restAliasSymbol of collectConstAliasSymbols(restSymbol, scopes)) {
                  arraySymbols.add(restAliasSymbol);
                }
              }
            }
            continue;
          }
          const destructuredSymbols = new Set<SymbolDescriptor>();
          collectPatternSymbols(element as EsTreeNode, scopes, destructuredSymbols);
          for (const destructuredSymbol of destructuredSymbols) {
            elementSymbols.set(destructuredSymbol, false);
          }
        }
      }
      const indexedMember = referenceRoot.parent;
      if (
        !indexedMember ||
        !isNodeOfType(indexedMember, "MemberExpression") ||
        indexedMember.object !== referenceRoot ||
        !indexedMember.computed
      ) {
        continue;
      }
      const indexedRoot = findTransparentExpressionRoot(indexedMember);
      const isCurrentIterationElement = isCurrentIterationIndex(
        indexedMember.property as EsTreeNode,
        referenceNode,
      );
      const indexedParent = indexedRoot.parent;
      if (
        indexedParent &&
        isNodeOfType(indexedParent, "VariableDeclarator") &&
        indexedParent.init === indexedRoot &&
        isNodeOfType(indexedParent.id, "Identifier")
      ) {
        const elementSymbol = scopes.symbolFor(indexedParent.id);
        if (elementSymbol?.kind === "const") {
          elementSymbols.set(elementSymbol, isCurrentIterationElement);
        }
      }
      if (
        isMutationTarget(indexedMember) &&
        mutationMayAffectConfigRead(indexedMember, referenceNode, isCurrentIterationElement)
      ) {
        return true;
      }
      if (
        expressionHasPropertyMutationBefore(
          indexedMember,
          propertyName,
          referenceNode,
          scopes,
          isCurrentIterationElement,
        )
      ) {
        return true;
      }
    }
  }

  return [...elementSymbols].some(([elementSymbol, isCurrentIterationElement]) =>
    symbolHasPropertyMutationBefore(
      elementSymbol,
      propertyName,
      referenceNode,
      scopes,
      isCurrentIterationElement,
    ),
  );
};

const hasArrayMutationBefore = (
  arrayIdentifier: EsTreeNodeOfType<"Identifier">,
  referenceNode: EsTreeNode,
): boolean => {
  const scopes = currentScopes;
  const arraySymbol = scopes?.symbolFor(arrayIdentifier);
  if (!scopes || !arraySymbol) return false;
  return collectConstAliasSymbols(arraySymbol, scopes).some((aliasSymbol) =>
    aliasSymbol.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const memberExpression = referenceRoot.parent;
      if (
        !memberExpression ||
        !isNodeOfType(memberExpression, "MemberExpression") ||
        memberExpression.object !== referenceRoot
      ) {
        return false;
      }
      const memberRoot = findTransparentExpressionRoot(memberExpression);
      const memberParent = memberRoot.parent;
      const isCurrentIterationElement = Boolean(
        memberExpression.computed &&
        isCurrentIterationIndex(memberExpression.property as EsTreeNode, referenceNode),
      );
      if (
        !memberParent ||
        !mutationMayAffectConfigRead(memberParent, referenceNode, isCurrentIterationElement)
      ) {
        return false;
      }
      const methodName = getStaticPropertyName(memberExpression);
      if (
        methodName &&
        MUTATING_ARRAY_METHODS.has(methodName) &&
        isNodeOfType(memberParent, "CallExpression") &&
        memberParent.callee === memberRoot
      ) {
        return true;
      }
      return isMutationTarget(memberExpression);
    }),
  );
};

const hasArrayMethodWriteBefore = (
  arrayIdentifier: EsTreeNodeOfType<"Identifier">,
  methodName: string,
  referenceNode: EsTreeNode,
): boolean => {
  const scopes = currentScopes;
  const arraySymbol = scopes?.symbolFor(arrayIdentifier);
  if (!scopes || !arraySymbol) return true;
  return collectConstAliasSymbols(arraySymbol, scopes).some((aliasSymbol) =>
    aliasSymbol.references.some((reference) => {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const memberExpression = referenceRoot.parent;
      return Boolean(
        memberExpression &&
        isNodeOfType(memberExpression, "MemberExpression") &&
        memberExpression.object === referenceRoot &&
        getStaticPropertyName(memberExpression) === methodName &&
        isMutationTarget(memberExpression) &&
        mutationMayAffectConfigRead(memberExpression, referenceNode),
      );
    }),
  );
};

// `EXTERNAL_LINKS.docs` — property read off a same-file const object of
// trusted literals; `item.href` — property of an element of a const config
// array iterated by the enclosing map callback. Both are developer-typed
// destinations behind one level of data structure.
const isTrustedConstConfigMember = (
  memberNode: EsTreeNodeOfType<"MemberExpression">,
  depth: number,
): boolean => {
  if (!isNodeOfType(memberNode.property, "Identifier")) return false;
  const propertyName = memberNode.property.name;
  const receiver = stripParenExpression(memberNode.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (!bindingIsUnmodifiedBeforeCurrentOpen(receiver)) return false;

  const constInitializer = resolveConstInitializer(receiver);
  const scopes = currentScopes;
  const elementSymbol = scopes ? resolveConstIdentifierAlias(receiver, scopes) : null;
  const elementInitializer = elementSymbol?.initializer
    ? stripParenExpression(elementSymbol.initializer)
    : null;
  if (
    scopes &&
    elementInitializer &&
    isNodeOfType(elementInitializer, "MemberExpression") &&
    elementInitializer.computed &&
    isNodeOfType(elementInitializer.object, "Identifier") &&
    isCurrentIterationIndex(elementInitializer.property as EsTreeNode, memberNode)
  ) {
    const arraySymbol = resolveConstIdentifierAlias(elementInitializer.object, scopes);
    const arrayIdentifier = arraySymbol?.bindingIdentifier;
    const arrayInitializer = arraySymbol?.initializer
      ? stripParenExpression(arraySymbol.initializer)
      : null;
    if (
      arrayIdentifier &&
      isNodeOfType(arrayIdentifier, "Identifier") &&
      arrayInitializer &&
      isNodeOfType(arrayInitializer, "ArrayExpression") &&
      bindingIsUnmodifiedBeforeCurrentOpen(arrayIdentifier) &&
      !hasNestedIndexedPropertyWriteBefore(arrayIdentifier, propertyName, memberNode) &&
      !hasArrayMutationBefore(arrayIdentifier, memberNode)
    ) {
      return everyArrayElementSuppliesTrustedProperty(arrayInitializer, propertyName, depth);
    }
  }

  if (hasArrayMutationBefore(receiver, memberNode)) return false;
  if (scopes && hasPossibleStaticPropertyWriteBefore(receiver, propertyName, memberNode, scopes)) {
    return false;
  }
  if (constInitializer && isNodeOfType(constInitializer, "ObjectExpression")) {
    return objectLiteralSuppliesTrustedProperty(constInitializer, propertyName, depth);
  }

  // Callback param of `<CONST_ARRAY>.map((item) => ...)`.
  const binding = findVariableInitializer(receiver, receiver.name);
  const paramParent = binding?.bindingIdentifier.parent;
  if (!paramParent) return false;
  if (
    !isFunctionLike(paramParent) ||
    !(paramParent.params ?? []).includes(binding.bindingIdentifier as never)
  ) {
    return false;
  }
  const arrayLiteral = resolveIteratedConstArrayLiteral(paramParent);
  if (!arrayLiteral) return false;
  const iterationCall = paramParent.parent;
  const iterationCallee =
    iterationCall && isNodeOfType(iterationCall, "CallExpression") ? iterationCall.callee : null;
  const iteratedReceiver =
    iterationCallee && isNodeOfType(iterationCallee, "MemberExpression")
      ? stripParenExpression(iterationCallee.object)
      : null;
  if (
    iteratedReceiver &&
    isNodeOfType(iteratedReceiver, "Identifier") &&
    (hasNestedIndexedPropertyWriteBefore(iteratedReceiver, propertyName, memberNode) ||
      hasArrayMutationBefore(iteratedReceiver, memberNode))
  ) {
    return false;
  }
  return everyArrayElementSuppliesTrustedProperty(arrayLiteral, propertyName, depth);
};

// `[{ href: 'https://…' }, …].map(({ href }) => window.open(href))` — the
// destructured twin of the const-config member exemption: the identifier is
// bound by an ObjectPattern in a map-callback param over a literal array
// whose every element supplies the property as a trusted destination
// (pwa-kit social-icons idiom). A dynamic iterated value (a prop, server
// data) resolves to no array literal and stays opaque.
const isTrustedDestructuredIterationMember = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean | null => {
  if (!bindingIsUnmodifiedBeforeCurrentOpen(identifier)) return null;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return null;
  let propertyNode = binding.bindingIdentifier.parent;
  if (propertyNode && isNodeOfType(propertyNode, "AssignmentPattern")) {
    propertyNode = propertyNode.parent;
  }
  if (!propertyNode || !isNodeOfType(propertyNode, "Property") || propertyNode.computed) {
    return null;
  }
  if (!isNodeOfType(propertyNode.key, "Identifier")) return null;
  const propertyName = propertyNode.key.name;
  const objectPattern = propertyNode.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return null;
  const callbackFunction = objectPattern.parent;
  if (
    !callbackFunction ||
    !isFunctionLike(callbackFunction) ||
    !(callbackFunction.params ?? []).includes(objectPattern as never)
  ) {
    return null;
  }
  const arrayLiteral = resolveIteratedConstArrayLiteral(callbackFunction);
  if (!arrayLiteral) return null;
  const iterationCall = callbackFunction.parent;
  const iterationCallee =
    iterationCall && isNodeOfType(iterationCall, "CallExpression") ? iterationCall.callee : null;
  const iteratedReceiver =
    iterationCallee && isNodeOfType(iterationCallee, "MemberExpression")
      ? stripParenExpression(iterationCallee.object)
      : null;
  if (
    iteratedReceiver &&
    isNodeOfType(iteratedReceiver, "Identifier") &&
    (hasNestedIndexedPropertyWriteBefore(iteratedReceiver, propertyName, identifier) ||
      hasArrayMutationBefore(iteratedReceiver, identifier))
  ) {
    return false;
  }
  return everyArrayElementSuppliesTrustedProperty(arrayLiteral, propertyName, depth);
};

// A `let url;` whose every assignment that can execute before the read is a
// trusted static literal (switch/case link pickers) cannot carry attacker data.
const isLetAssignedOnlyTrustedLiterals = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (declarator.init && !isTrustedDestination(declarator.init as EsTreeNode, depth + 1)) {
    return false;
  }
  const scopes = currentScopes;
  const bindingSymbol = scopes?.symbolFor(binding.bindingIdentifier);
  if (!scopes || !bindingSymbol || identifier.range == null) return false;
  if (!isAnalyzingForeignExport) {
    let sawAssignment = false;
    for (const reference of bindingSymbol.references) {
      let writeTargetChild = reference.identifier;
      let writeTargetParent = writeTargetChild.parent;
      let isNestedWriteTarget = false;
      while (writeTargetParent) {
        if (isNodeOfType(writeTargetParent, "AssignmentExpression")) {
          isNestedWriteTarget =
            writeTargetParent.left === writeTargetChild &&
            writeTargetChild !== reference.identifier;
          break;
        }
        if (
          (isNodeOfType(writeTargetParent, "ForInStatement") ||
            isNodeOfType(writeTargetParent, "ForOfStatement")) &&
          writeTargetParent.left === writeTargetChild
        ) {
          isNestedWriteTarget = true;
          break;
        }
        if (isFunctionLike(writeTargetParent)) break;
        writeTargetChild = writeTargetParent;
        writeTargetParent = writeTargetParent.parent;
      }
      if (isNestedWriteTarget) return false;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const referenceParent = referenceRoot.parent;
      if (
        referenceParent &&
        isNodeOfType(referenceParent, "AssignmentExpression") &&
        referenceParent.operator === "=" &&
        referenceParent.left === referenceRoot
      ) {
        sawAssignment = true;
        if (!isTrustedDestination(referenceParent.right as EsTreeNode, depth + 1)) {
          return false;
        }
        continue;
      }
      if (reference.flag !== "read") return false;
    }
    return sawAssignment;
  }
  let sawTrustedValue = declarator.init != null;
  for (const reference of bindingSymbol.references) {
    if (reference.identifier.range == null) return false;
    let writeTargetChild = reference.identifier;
    let writeTargetParent = writeTargetChild.parent;
    let isNestedWriteTarget = false;
    while (writeTargetParent) {
      if (isNodeOfType(writeTargetParent, "AssignmentExpression")) {
        isNestedWriteTarget =
          writeTargetParent.left === writeTargetChild && writeTargetChild !== reference.identifier;
        break;
      }
      if (
        (isNodeOfType(writeTargetParent, "ForInStatement") ||
          isNodeOfType(writeTargetParent, "ForOfStatement")) &&
        writeTargetParent.left === writeTargetChild
      ) {
        isNestedWriteTarget = true;
        break;
      }
      if (isFunctionLike(writeTargetParent)) break;
      writeTargetChild = writeTargetParent;
      writeTargetParent = writeTargetParent.parent;
    }
    if (isNestedWriteTarget) {
      if (writeExecutesBeforeDestinationReference(reference.identifier, identifier, scopes)) {
        return false;
      }
      continue;
    }
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const referenceParent = referenceRoot.parent;
    if (
      referenceParent &&
      isNodeOfType(referenceParent, "AssignmentExpression") &&
      referenceParent.operator === "=" &&
      referenceParent.left === referenceRoot
    ) {
      if (!writeExecutesBeforeDestinationReference(reference.identifier, identifier, scopes)) {
        continue;
      }
      sawTrustedValue = true;
      if (!isTrustedDestination(referenceParent.right as EsTreeNode, depth + 1)) {
        return false;
      }
      continue;
    }
    if (
      reference.flag !== "read" &&
      writeExecutesBeforeDestinationReference(reference.identifier, identifier, scopes)
    ) {
      return false;
    }
  }
  return sawTrustedValue;
};

// `ctaLink` destructured from the props of a module-local, non-exported
// component whose every same-file JSX usage supplies the prop as a
// trusted literal (`<IntegrationCard ctaLink="/docs/installation" />`)
// is a developer-typed destination one indirection away. An exported
// component (unknowable external call sites), a spread-props usage, any
// non-JSX reference to the component, or a single dynamic prop value
// keeps the identifier opaque.
const isTrustedLocalComponentPropLiteral = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
  if (!bindingIsUnmodifiedBeforeCurrentOpen(identifier)) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  let propertyNode = binding.bindingIdentifier.parent;
  if (propertyNode && isNodeOfType(propertyNode, "AssignmentPattern")) {
    propertyNode = propertyNode.parent;
  }
  if (!propertyNode || !isNodeOfType(propertyNode, "Property") || propertyNode.computed) {
    return false;
  }
  if (!isNodeOfType(propertyNode.key, "Identifier")) return false;
  const propName = propertyNode.key.name;
  const objectPattern = propertyNode.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return false;
  const componentFunction = objectPattern.parent;
  if (
    !componentFunction ||
    !isFunctionLike(componentFunction) ||
    !(componentFunction.params ?? []).includes(objectPattern as never)
  ) {
    return false;
  }

  let componentNameNode: EsTreeNodeOfType<"Identifier"> | null = null;
  let enclosingDeclarationParent: EsTreeNode | null = null;
  if (isNodeOfType(componentFunction, "FunctionDeclaration") && componentFunction.id) {
    componentNameNode = componentFunction.id;
    enclosingDeclarationParent = componentFunction.parent ?? null;
  } else {
    const declarator = componentFunction.parent;
    if (
      declarator &&
      isNodeOfType(declarator, "VariableDeclarator") &&
      isNodeOfType(declarator.id, "Identifier")
    ) {
      const declaration = declarator.parent;
      if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
        componentNameNode = declarator.id;
        enclosingDeclarationParent = declaration.parent ?? null;
      }
    }
  }
  if (!componentNameNode || !/^[A-Z]/.test(componentNameNode.name)) return false;
  if (
    enclosingDeclarationParent != null &&
    (isNodeOfType(enclosingDeclarationParent, "ExportNamedDeclaration") ||
      isNodeOfType(enclosingDeclarationParent, "ExportDefaultDeclaration"))
  ) {
    return false;
  }

  const programRoot = findProgramRoot(identifier);
  if (!programRoot) return false;
  const componentName = componentNameNode.name;
  let usageCount = 0;
  let sawUntrustedUsage = false;
  let sawNonJsxReference = false;
  walkAst(programRoot, (node: EsTreeNode) => {
    if (sawUntrustedUsage || sawNonJsxReference) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === componentName &&
      node !== componentNameNode
    ) {
      sawNonJsxReference = true;
      return false;
    }
    if (!isNodeOfType(node, "JSXOpeningElement")) return;
    const elementName = node.name;
    if (
      !elementName ||
      elementName.type !== "JSXIdentifier" ||
      (elementName as { name?: string }).name !== componentName
    ) {
      return;
    }
    usageCount += 1;
    let propValue: EsTreeNode | null = null;
    let sawPropAttribute = false;
    for (const attribute of node.attributes ?? []) {
      if (!isNodeOfType(attribute, "JSXAttribute")) {
        sawUntrustedUsage = true;
        return false;
      }
      const attributeName = attribute.name;
      if (
        attributeName &&
        attributeName.type === "JSXIdentifier" &&
        (attributeName as { name?: string }).name === propName
      ) {
        sawPropAttribute = true;
        propValue = (attribute.value as EsTreeNode | null) ?? null;
      }
    }
    // An omitted prop leaves the binding undefined — window.open(undefined)
    // opens about:blank, which the opener controls.
    if (!sawPropAttribute) return;
    if (propValue == null) {
      sawUntrustedUsage = true;
      return false;
    }
    const suppliedExpression = isNodeOfType(propValue, "JSXExpressionContainer")
      ? (propValue.expression as EsTreeNode)
      : propValue;
    if (!isTrustedOrNullishDestination(suppliedExpression, depth + 1)) {
      sawUntrustedUsage = true;
      return false;
    }
  });
  return usageCount > 0 && !sawUntrustedUsage && !sawNonJsxReference;
};

interface DirectFunctionParamBinding {
  functionNode: EsTreeNode;
  parameterIndex: number;
}

const resolveDirectFunctionParam = (
  identifier: EsTreeNodeOfType<"Identifier">,
): DirectFunctionParamBinding | null => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return null;
  const functionNode = binding.bindingIdentifier.parent;
  if (!functionNode || !isFunctionLike(functionNode)) return null;
  const parameterIndex = (functionNode.params ?? []).indexOf(binding.bindingIdentifier as never);
  if (parameterIndex < 0) return null;
  return { functionNode, parameterIndex };
};

// The module-visible name a local function is callable under, refusing
// exported functions (unknowable external call sites). A `useCallback`
// wrapper is transparent — the declarator name refers to the same function.
const resolveLocalFunctionNameIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    const declarationParent = functionNode.parent;
    if (
      declarationParent &&
      (isNodeOfType(declarationParent, "ExportNamedDeclaration") ||
        isNodeOfType(declarationParent, "ExportDefaultDeclaration"))
    ) {
      return null;
    }
    return functionNode.id && isNodeOfType(functionNode.id, "Identifier") ? functionNode.id : null;
  }
  let declaratorCandidate: EsTreeNode | null | undefined = functionNode.parent;
  if (
    declaratorCandidate &&
    isNodeOfType(declaratorCandidate, "CallExpression") &&
    (declaratorCandidate.arguments ?? [])[0] === functionNode &&
    terminalCalleeName(declaratorCandidate.callee as EsTreeNode) === "useCallback"
  ) {
    declaratorCandidate = declaratorCandidate.parent;
  }
  if (!declaratorCandidate || !isNodeOfType(declaratorCandidate, "VariableDeclarator")) return null;
  if (!isNodeOfType(declaratorCandidate.id, "Identifier")) return null;
  const declaration = declaratorCandidate.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  if (declaration.kind !== "const") return null;
  const declarationParent = declaration.parent;
  if (
    declarationParent &&
    (isNodeOfType(declarationParent, "ExportNamedDeclaration") ||
      isNodeOfType(declarationParent, "ExportDefaultDeclaration"))
  ) {
    return null;
  }
  return declaratorCandidate.id;
};

// The argument supplied at `parameterIndex` by every same-file call of a
// local function. Returns null when the function is exported, anonymous, or
// escapes by reference (any non-call use of its name keeps it opaque), or
// when it is never called.
const collectLocalFunctionCallArguments = (
  functionNode: EsTreeNode,
  parameterIndex: number,
): Array<EsTreeNode | null> | null => {
  let argumentsByParameter = localFunctionCallArgumentsMemo.get(functionNode);
  if (!argumentsByParameter) {
    argumentsByParameter = new Map();
    localFunctionCallArgumentsMemo.set(functionNode, argumentsByParameter);
  }
  if (argumentsByParameter.has(parameterIndex)) {
    return argumentsByParameter.get(parameterIndex) ?? null;
  }
  const nameIdentifier = resolveLocalFunctionNameIdentifier(functionNode);
  if (!nameIdentifier) {
    argumentsByParameter.set(parameterIndex, null);
    return null;
  }
  const programRoot = findProgramRoot(functionNode);
  if (!programRoot) {
    argumentsByParameter.set(parameterIndex, null);
    return null;
  }
  const callArguments: Array<EsTreeNode | null> = [];
  let sawNonCallReference = false;
  walkAst(programRoot, (node: EsTreeNode) => {
    if (sawNonCallReference) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== nameIdentifier.name ||
      node === nameIdentifier ||
      findVariableInitializer(node, node.name)?.bindingIdentifier !== nameIdentifier
    ) {
      return;
    }
    const referenceParent = node.parent;
    if (
      referenceParent &&
      isNodeOfType(referenceParent, "CallExpression") &&
      referenceParent.callee === node
    ) {
      callArguments.push(
        ((referenceParent.arguments ?? [])[parameterIndex] as EsTreeNode | undefined) ?? null,
      );
      return;
    }
    sawNonCallReference = true;
    return false;
  });
  if (sawNonCallReference || callArguments.length === 0) {
    argumentsByParameter.set(parameterIndex, null);
    return null;
  }
  argumentsByParameter.set(parameterIndex, callArguments);
  return callArguments;
};

// `openLink('https://discord.gg/…')` — a URL that is a parameter of a local
// wrapper is trusted when every same-file call of the wrapper passes a
// trusted destination (rad-ui "Star on GitHub" idiom, one indirection away).
const isTrustedLocalWrapperParam = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
  if (!bindingIsUnmodifiedBeforeCurrentOpen(identifier)) return false;
  const paramBinding = resolveDirectFunctionParam(identifier);
  if (!paramBinding) return false;
  const callArguments = collectLocalFunctionCallArguments(
    paramBinding.functionNode,
    paramBinding.parameterIndex,
  );
  if (!callArguments) return false;
  return callArguments.every((argument) => isTrustedOrNullishDestination(argument, depth + 1));
};

const JSX_EVENT_HANDLER_ATTRIBUTE_PATTERN = /^on[A-Z]/;

const jsxAttributeName = (attribute: EsTreeNodeOfType<"JSXAttribute">): string | null => {
  const nameNode = attribute.name;
  return nameNode && nameNode.type === "JSXIdentifier"
    ? ((nameNode as { name?: string }).name ?? null)
    : null;
};

const resolveHandlerAttributeElement = (
  expressionContainer: EsTreeNode,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  const attribute = expressionContainer.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return null;
  const attributeName = jsxAttributeName(attribute);
  if (!attributeName || !JSX_EVENT_HANDLER_ATTRIBUTE_PATTERN.test(attributeName)) return null;
  const openingElement = attribute.parent;
  return openingElement && isNodeOfType(openingElement, "JSXOpeningElement")
    ? openingElement
    : null;
};

const elementSuppliesTrustedHref = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  depth: number,
): boolean => {
  const elementName = openingElement.name;
  if (!elementName || elementName.type !== "JSXIdentifier" || elementName.name !== "a") {
    return false;
  }
  const hrefAttribute = getAuthoritativeJsxAttribute(openingElement.attributes ?? [], "href");
  if (!hrefAttribute) return false;
  const attributeValue = hrefAttribute.value as EsTreeNode | null;
  if (attributeValue == null) return false;
  if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
    return isTrustedDestination(attributeValue.expression as EsTreeNode, depth + 1);
  }
  return isTrustedStaticDestination(attributeValue);
};

// The handler function receiving the event is wired — inline or by name —
// exclusively to JSX event-handler attributes of elements whose `href` is a
// trusted destination.
const handlerFunctionOnlyServesTrustedHrefElements = (
  handlerFunction: EsTreeNode,
  depth: number,
): boolean => {
  const handlerParent = handlerFunction.parent;
  if (handlerParent && isNodeOfType(handlerParent, "JSXExpressionContainer")) {
    const openingElement = resolveHandlerAttributeElement(handlerParent);
    return openingElement != null && elementSuppliesTrustedHref(openingElement, depth);
  }
  const nameIdentifier = resolveLocalFunctionNameIdentifier(handlerFunction);
  if (!nameIdentifier) return false;
  const programRoot = findProgramRoot(handlerFunction);
  if (!programRoot) return false;
  let handlerUsageCount = 0;
  let sawUntrustedHandlerUsage = false;
  walkAst(programRoot, (node: EsTreeNode) => {
    if (sawUntrustedHandlerUsage) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== nameIdentifier.name ||
      node === nameIdentifier ||
      findVariableInitializer(node, node.name)?.bindingIdentifier !== nameIdentifier
    ) {
      return;
    }
    const referenceParent = node.parent;
    const openingElement =
      referenceParent && isNodeOfType(referenceParent, "JSXExpressionContainer")
        ? resolveHandlerAttributeElement(referenceParent)
        : null;
    if (!openingElement || !elementSuppliesTrustedHref(openingElement, depth)) {
      sawUntrustedHandlerUsage = true;
      return false;
    }
    handlerUsageCount += 1;
  });
  return handlerUsageCount > 0 && !sawUntrustedHandlerUsage;
};

// `window.open(anchorEl.href)` inside a local helper whose every call site
// passes `event.currentTarget` from a click handler wired to a JSX element
// whose `href` attribute is itself trusted — the DOM merely round-trips an
// already-trusted destination (react-cosmos cmd+click-fixture idiom).
const isTrustedAnchorParamHrefRead = (
  memberNode: EsTreeNodeOfType<"MemberExpression">,
  depth: number,
): boolean => {
  if (!isNodeOfType(memberNode.property, "Identifier") || memberNode.property.name !== "href") {
    return false;
  }
  const receiver = stripParenExpression(memberNode.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (!bindingIsUnmodifiedBeforeCurrentOpen(receiver)) return false;
  if (
    currentScopes &&
    hasPossibleStaticPropertyWriteBefore(receiver, "href", memberNode, currentScopes)
  ) {
    return false;
  }
  const paramBinding = resolveDirectFunctionParam(receiver);
  if (!paramBinding) return false;
  const callArguments = collectLocalFunctionCallArguments(
    paramBinding.functionNode,
    paramBinding.parameterIndex,
  );
  if (!callArguments) return false;
  return callArguments.every((argument) => {
    if (argument == null) return false;
    const anchorSource = stripParenExpression(argument);
    if (!isNodeOfType(anchorSource, "MemberExpression") || anchorSource.computed) return false;
    if (
      !isNodeOfType(anchorSource.property, "Identifier") ||
      anchorSource.property.name !== "currentTarget"
    ) {
      return false;
    }
    const eventReceiver = stripParenExpression(anchorSource.object as EsTreeNode);
    if (!isNodeOfType(eventReceiver, "Identifier")) return false;
    const eventParamBinding = resolveDirectFunctionParam(eventReceiver);
    if (!eventParamBinding) return false;
    return handlerFunctionOnlyServesTrustedHrefElements(eventParamBinding.functionNode, depth);
  });
};

// `const [imageUrl, setImageUrl] = useState()` where the initializer and
// every same-scope setter call carry a trusted destination — the state can
// only ever hold trusted URLs (dtale MissingNoCharts idiom). A setter that
// escapes by reference or receives an updater function keeps the binding
// opaque.
const isTrustedUseStateUrlBinding = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  const arrayPattern = binding.bindingIdentifier.parent;
  if (!arrayPattern || !isNodeOfType(arrayPattern, "ArrayPattern")) return false;
  const patternElements = arrayPattern.elements ?? [];
  if (patternElements[0] !== binding.bindingIdentifier) return false;
  const setterIdentifier = patternElements[1] as EsTreeNode | null | undefined;
  if (!setterIdentifier || !isNodeOfType(setterIdentifier, "Identifier")) return false;
  const declarator = arrayPattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return false;
  if (declarator.id !== arrayPattern) return false;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return false;
  if (declaration.kind !== "const") return false;
  const useStateCall = declarator.init as EsTreeNode | null;
  if (!useStateCall || !isNodeOfType(useStateCall, "CallExpression")) return false;
  if (terminalCalleeName(useStateCall.callee as EsTreeNode) !== "useState") return false;
  if (
    !isTrustedOrNullishDestination(
      ((useStateCall.arguments ?? [])[0] as EsTreeNode | undefined) ?? null,
      depth + 1,
    )
  ) {
    return false;
  }
  let sawUntrustedSetterUse = false;
  const setterSymbol = currentScopes?.symbolFor(setterIdentifier);
  walkAst(binding.scopeOwner, (node: EsTreeNode) => {
    if (sawUntrustedSetterUse) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== setterIdentifier.name ||
      node === setterIdentifier ||
      (setterSymbol && currentScopes?.symbolFor(node) !== setterSymbol)
    ) {
      return;
    }
    const referenceParent = node.parent;
    if (
      referenceParent &&
      isNodeOfType(referenceParent, "CallExpression") &&
      referenceParent.callee === node
    ) {
      const setterArgument =
        ((referenceParent.arguments ?? [])[0] as EsTreeNode | undefined) ?? null;
      if (setterArgument != null && isFunctionLike(setterArgument)) {
        sawUntrustedSetterUse = true;
        return false;
      }
      if (!isTrustedOrNullishDestination(setterArgument, depth + 1)) {
        sawUntrustedSetterUse = true;
        return false;
      }
      return;
    }
    sawUntrustedSetterUse = true;
    return false;
  });
  return !sawUntrustedSetterUse;
};

// All expressions a local function can return; null when any return is bare
// (the resulting undefined makes an index read meaningless) or the body is
// missing.
const collectLocalFunctionReturnExpressions = (functionNode: EsTreeNode): EsTreeNode[] | null => {
  if (!isFunctionLike(functionNode)) return null;
  const body = functionNode.body as EsTreeNode | null | undefined;
  if (!body) return null;
  if (!isNodeOfType(body, "BlockStatement")) return [body];
  const returnedExpressions: EsTreeNode[] = [];
  let sawBareReturn = false;
  walkAst(body, (node: EsTreeNode) => {
    if (node !== body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement")) {
      if (node.argument == null) sawBareReturn = true;
      else returnedExpressions.push(node.argument as EsTreeNode);
    }
  });
  if (sawBareReturn) return null;
  return returnedExpressions;
};

const resolveLocalFunctionNode = (
  calleeIdentifier: EsTreeNodeOfType<"Identifier">,
): EsTreeNode | null => {
  if (!bindingIsUnmodifiedBeforeCurrentOpen(calleeIdentifier)) return null;
  const binding = findVariableInitializer(calleeIdentifier, calleeIdentifier.name);
  if (!binding?.initializer || !isFunctionLike(binding.initializer)) return null;
  if (isNodeOfType(binding.initializer, "FunctionDeclaration")) return binding.initializer;
  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.init !== binding.initializer) return null;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  if (declaration.kind !== "const") return null;
  return binding.initializer;
};

// `urls[0]` — an index read off a const binding holding either a literal
// array of trusted destinations or the result of a same-file helper whose
// every return is such an array (dtale buildUrls idiom).
const isTrustedConstArrayIndexRead = (
  memberNode: EsTreeNodeOfType<"MemberExpression">,
  depth: number,
): boolean => {
  const indexNode = memberNode.property as EsTreeNode;
  if (!isNodeOfType(indexNode, "Literal") || typeof indexNode.value !== "number") return false;
  const elementIndex = indexNode.value;
  const receiver = stripParenExpression(memberNode.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  if (!bindingIsUnmodifiedBeforeCurrentOpen(receiver)) return false;
  if (hasArrayMutationBefore(receiver, memberNode)) return false;
  const constInitializer = resolveConstInitializer(receiver);
  if (constInitializer == null) return false;

  const arrayElementIsTrusted = (arrayCandidate: EsTreeNode): boolean => {
    if (!isNodeOfType(arrayCandidate, "ArrayExpression")) return false;
    const element = (arrayCandidate.elements ?? [])[elementIndex] as EsTreeNode | null | undefined;
    return element != null && isTrustedDestination(stripParenExpression(element), depth + 1);
  };

  if (isNodeOfType(constInitializer, "ArrayExpression")) {
    return arrayElementIsTrusted(constInitializer);
  }
  if (
    isNodeOfType(constInitializer, "CallExpression") &&
    isNodeOfType(constInitializer.callee, "Identifier")
  ) {
    const helperFunction = resolveLocalFunctionNode(constInitializer.callee);
    if (!helperFunction) return false;
    const returnedExpressions = collectLocalFunctionReturnExpressions(helperFunction);
    if (!returnedExpressions || returnedExpressions.length === 0) return false;
    return returnedExpressions.every((returned) =>
      arrayElementIsTrusted(stripParenExpression(returned)),
    );
  }
  return false;
};

const NEXT_ROUTER_MODULES = new Set(["next/router", "next/navigation"]);

const isProvenRouterReceiver = (receiver: EsTreeNodeOfType<"Identifier">): boolean => {
  const directImport = resolveImportedExportReference(receiver);
  if (directImport?.moduleSpecifier === "next/router" && directImport.exportedName === "default") {
    return true;
  }
  const initializer = resolveConstInitializer(receiver);
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  const initializerCallee = stripParenExpression(initializer.callee as EsTreeNode);
  if (!isNodeOfType(initializerCallee, "Identifier")) return false;
  const hookImport = resolveImportedExportReference(initializerCallee);
  return Boolean(
    hookImport &&
    hookImport.exportedName === "useRouter" &&
    NEXT_ROUTER_MODULES.has(hookImport.moduleSpecifier),
  );
};

const conditionalBranchContaining = (
  node: EsTreeNode,
  conditional: EsTreeNode,
): "alternate" | "consequent" | null => {
  if (
    !isNodeOfType(conditional, "IfStatement") &&
    !isNodeOfType(conditional, "ConditionalExpression")
  ) {
    return null;
  }
  let cursor: EsTreeNode | null | undefined = node;
  while (cursor?.parent && cursor.parent !== conditional) cursor = cursor.parent;
  if (!cursor || cursor.parent !== conditional) return null;
  if (conditional.consequent === cursor) return "consequent";
  if (conditional.alternate === cursor) return "alternate";
  return null;
};

const callsExecuteInOppositeConditionalBranches = (
  windowOpenCall: EsTreeNode,
  routerCall: EsTreeNode,
): boolean => {
  let conditional: EsTreeNode | null | undefined = windowOpenCall.parent;
  while (conditional) {
    if (
      isNodeOfType(conditional, "IfStatement") ||
      isNodeOfType(conditional, "ConditionalExpression")
    ) {
      const windowOpenBranch = conditionalBranchContaining(windowOpenCall, conditional);
      const routerBranch = conditionalBranchContaining(routerCall, conditional);
      if (windowOpenBranch && routerBranch && windowOpenBranch !== routerBranch) return true;
    }
    if (isFunctionLike(conditional)) return false;
    conditional = conditional.parent ?? null;
  }
  return false;
};

const containingJsxOpeningElement = (
  node: EsTreeNode,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXOpeningElement")) return cursor;
    cursor = cursor.parent ?? null;
  }
  return null;
};

const elementHasBranchLocalRouterContract = (
  identifier: EsTreeNodeOfType<"Identifier">,
): boolean => {
  const scopes = currentScopes;
  const ruleContext = currentRuleContext;
  if (!currentWindowOpenCall || !scopes || !ruleContext) return false;
  const openingElement = containingJsxOpeningElement(currentWindowOpenCall);
  const identifierSymbol = scopes.symbolFor(identifier);
  if (!openingElement || !identifierSymbol) return false;
  const routerCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  const matchingWindowOpenCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(openingElement, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "CallExpression")) return;
    const firstArgument = node.arguments?.[0] as EsTreeNode | undefined;
    const destination = firstArgument ? stripParenExpression(firstArgument) : null;
    if (
      !destination ||
      !isNodeOfType(destination, "Identifier") ||
      scopes.symbolFor(destination) !== identifierSymbol
    ) {
      return;
    }
    if (isWindowOpenCallee(node.callee, scopes)) {
      matchingWindowOpenCalls.push(node);
      return;
    }
    const callee = stripParenExpression(node.callee as EsTreeNode);
    if (!isNodeOfType(callee, "MemberExpression")) return;
    const methodName = getStaticPropertyName(callee);
    const receiver = stripParenExpression(callee.object);
    if (
      (methodName === "push" || methodName === "replace") &&
      isNodeOfType(receiver, "Identifier") &&
      isProvenRouterReceiver(receiver) &&
      isNodeReachableWithinFunction(node, ruleContext)
    ) {
      routerCalls.push(node);
    }
  });
  return matchingWindowOpenCalls.some((windowOpenCall) =>
    routerCalls.some((routerCall) =>
      callsExecuteInOppositeConditionalBranches(windowOpenCall, routerCall),
    ),
  );
};

// `e.metaKey ? window.open(href) : Router.push(href)` — feeding the same
// binding to a client-side router push/replace declares it an app-internal
// SPA route, which resolves same-origin (hyperdx cmd+click-row idiom). Bare
// `navigate(href)` does NOT qualify: any local helper can be named navigate
// and such wrappers commonly forward external URLs.
const isRouterCoNavigatedIdentifier = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  if (!currentWindowOpenCall) return false;
  if (!bindingIsUnmodifiedBeforeCurrentOpen(identifier)) return false;
  const windowOpenCall = currentWindowOpenCall;
  let scopeCursor: EsTreeNode | null | undefined = identifier.parent;
  while (scopeCursor && !isFunctionLike(scopeCursor)) scopeCursor = scopeCursor.parent ?? null;
  if (!scopeCursor) return false;
  const enclosingFunction = scopeCursor;
  const identifierSymbol = currentScopes?.symbolFor(identifier);
  let routerCalls = routerCallsByFunctionMemo.get(enclosingFunction);
  if (!routerCalls) {
    routerCalls = [];
    walkAst(enclosingFunction, (node: EsTreeNode) => {
      if (node !== enclosingFunction && isFunctionLike(node)) return false;
      if (!isNodeOfType(node, "CallExpression")) return;
      if (!currentRuleContext || !isNodeReachableWithinFunction(node, currentRuleContext)) return;
      const callee = node.callee;
      if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
      if (
        !isNodeOfType(callee.property, "Identifier") ||
        (callee.property.name !== "push" && callee.property.name !== "replace")
      ) {
        return;
      }
      const routerReceiver = stripParenExpression(callee.object as EsTreeNode);
      if (!isNodeOfType(routerReceiver, "Identifier") || !isProvenRouterReceiver(routerReceiver)) {
        return;
      }
      routerCalls?.push(node);
    });
    routerCallsByFunctionMemo.set(enclosingFunction, routerCalls);
  }
  const sawRouterCoNavigation = routerCalls.some((node) => {
    if (!callsExecuteInOppositeConditionalBranches(windowOpenCall, node)) return false;
    const callee = node.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    const routeArgument = (node.arguments ?? [])[0] as EsTreeNode | undefined;
    const routeIdentifier = routeArgument ? stripParenExpression(routeArgument) : null;
    return Boolean(
      routeIdentifier &&
      isNodeOfType(routeIdentifier, "Identifier") &&
      routeIdentifier.name === identifier.name &&
      (!identifierSymbol || currentScopes?.symbolFor(routeIdentifier) === identifierSymbol),
    );
  });
  return sawRouterCoNavigation || elementHasBranchLocalRouterContract(identifier);
};

// The trusted-by-construction check, extended one binding hop: a local
// const holding a ternary over origin-pinned templates
// (releaseUrl = version ? `https://github.com/…/tag/v${version}` : null)
// is the same trusted destination as an inline one, just behind a name
// ("open release page" dialogs). Every non-nullish branch of the
// initializer must itself be trusted; opaque initializers (call results,
// awaited API responses, hook-destructured values) resolve to nothing
// and keep firing.
// `'https://github.com/' + owner + '/' + repo` — concatenation whose
// LEFTMOST operand pins the origin (or a same-origin path) is the semantic
// twin of the exempt template.
const leftmostConcatOperand = (node: EsTreeNode): EsTreeNode => {
  let cursor = node;
  while (isNodeOfType(cursor, "BinaryExpression") && cursor.operator === "+") {
    cursor = stripParenExpression(cursor.left as EsTreeNode);
  }
  return cursor;
};

const flattenConcatOperands = (node: EsTreeNode, operands: EsTreeNode[] = []): EsTreeNode[] => {
  const unwrappedNode = stripParenExpression(node);
  if (isNodeOfType(unwrappedNode, "BinaryExpression") && unwrappedNode.operator === "+") {
    flattenConcatOperands(unwrappedNode.left as EsTreeNode, operands);
    flattenConcatOperands(unwrappedNode.right as EsTreeNode, operands);
  } else {
    operands.push(unwrappedNode);
  }
  return operands;
};

const staticTextPinsConcatDestination = (urlText: string): boolean => {
  const trimmedText = urlText.trimStart();
  if (trimmedText.length === 0) return false;
  const loweredText = trimmedText.toLowerCase();
  if (NON_BROWSING_URL_SCHEMES.some((scheme) => loweredText.startsWith(scheme))) return true;
  if (!isAnalyzingForeignExport && COMPLETE_ORIGIN_PATTERN.test(trimmedText)) return true;
  return startsUnambiguouslySameOriginTemplatePath(trimmedText);
};

const isTrustedConcatPrefix = (node: EsTreeNode, depth = 0): boolean => {
  if (depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
  const unwrappedNode = stripParenExpression(node);
  if (isStringLiteral(unwrappedNode)) {
    return staticTextPinsConcatDestination(unwrappedNode.value);
  }
  if (isNodeOfType(unwrappedNode, "TemplateLiteral")) {
    if ((unwrappedNode.expressions?.length ?? 0) > 0) {
      return isTrustedStaticDestination(unwrappedNode);
    }
    return staticTextPinsConcatDestination(unwrappedNode.quasis?.[0]?.value?.raw ?? "");
  }
  if (
    !isNodeOfType(unwrappedNode, "Identifier") ||
    !bindingIsUnmodifiedBeforeCurrentOpen(unwrappedNode)
  ) {
    return false;
  }
  const initializer = resolveConstInitializer(unwrappedNode);
  return Boolean(initializer && isTrustedConcatPrefix(initializer, depth + 1));
};

// Cross-file resolutions per linted file are capped: oxc-resolver +
// re-parsing foreign modules is filesystem work, and a file rarely opens
// more than a couple of imported destinations.
const CROSS_FILE_RESOLUTION_BUDGET_PER_FILE = 3;

// Per-file cross-file analysis state, reset in `create` before each lint.
// The absolute filename anchors import resolution (an undefined / relative
// filename makes every cross-file lookup a no-op, so hosts without
// filenames keep the pure name-heuristic behavior); the memo keeps
// repeated reads of the same import from re-consuming the budget.
let currentLintedFilename: string | undefined;
let crossFileResolutionsRemaining = 0;
const crossFileResolutionMemo = new Map<string, ResolvedCrossFileExport | null>();

// Foreign exports must be self-contained proofs: while a foreign
// initializer / return is being analyzed, further cross-file hops are
// disabled, so a foreign helper delegating to its OWN imports stays
// opaque (no transitive resolution chains).
let isAnalyzingForeignExport = false;
let isAnalyzingDeferredForeignExport = false;

interface ForeignExportAnalysisOptions {
  foreignExpression: EsTreeNode;
  isDeferred: boolean;
}

interface ImportedExportReference {
  moduleSpecifier: string;
  exportedName: string;
}

// The import declaration a destination identifier is bound to, resolved
// scope-aware (a local shadowing the import wins), with the SOURCE-side
// export name so renamed imports resolve to the right foreign binding.
const resolveImportedExportReference = (
  identifier: EsTreeNodeOfType<"Identifier">,
): ImportedExportReference | null => {
  const binding = findVariableInitializer(identifier, identifier.name);
  const importSpecifier = binding?.bindingIdentifier.parent;
  if (
    !importSpecifier ||
    (!isNodeOfType(importSpecifier, "ImportSpecifier") &&
      !isNodeOfType(importSpecifier, "ImportDefaultSpecifier"))
  ) {
    return null;
  }
  const exportedName = resolveImportedExportName(importSpecifier);
  if (!exportedName) return null;
  const importDeclaration = importSpecifier.parent;
  if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return null;
  const sourceNode = importDeclaration.source;
  if (!sourceNode || !isNodeOfType(sourceNode, "Literal")) return null;
  if (typeof sourceNode.value !== "string") return null;
  return { moduleSpecifier: sourceNode.value, exportedName };
};

const resolveCrossFileExportWithinBudget = (
  identifier: EsTreeNodeOfType<"Identifier">,
): ResolvedCrossFileExport | null => {
  if (isAnalyzingForeignExport || currentLintedFilename == null) return null;
  const importReference = resolveImportedExportReference(identifier);
  if (!importReference) return null;
  const memoKey = `${importReference.moduleSpecifier}\u0000${importReference.exportedName}`;
  const memoized = crossFileResolutionMemo.get(memoKey);
  if (memoized !== undefined) return memoized;
  if (crossFileResolutionsRemaining <= 0) return null;
  crossFileResolutionsRemaining -= 1;
  const resolved = resolveCrossFileExport(
    currentLintedFilename,
    importReference.moduleSpecifier,
    importReference.exportedName,
  );
  crossFileResolutionMemo.set(memoKey, resolved);
  return resolved;
};

// Runs the trusted-destination machinery against an expression that lives
// in a FOREIGN module. Bindings inside the foreign file resolve within it
// (the foreign AST carries parent references); literal trust tightens to
// same-origin (`isTrustedForeignStaticText`) and further cross-file hops
// are off.
const isTrustedForeignExportExpression = ({
  foreignExpression,
  isDeferred,
}: ForeignExportAnalysisOptions): boolean => {
  const previousScopes = currentScopes;
  const previousWindowOpenCall = currentWindowOpenCall;
  const foreignProgramRoot = findProgramRoot(foreignExpression);
  currentScopes = foreignProgramRoot ? analyzeScopes(foreignProgramRoot) : undefined;
  currentWindowOpenCall = foreignExpression;
  isAnalyzingForeignExport = true;
  isAnalyzingDeferredForeignExport = isDeferred;
  try {
    const strippedExpression = stripParenExpression(foreignExpression);
    return isTrustedDestination(strippedExpression, 0);
  } finally {
    isAnalyzingForeignExport = false;
    isAnalyzingDeferredForeignExport = false;
    currentScopes = previousScopes;
    currentWindowOpenCall = previousWindowOpenCall;
  }
};

// Content-verified verdict for an imported destination identifier: when
// the foreign export RESOLVES, the initializer's own analysis decides —
// in both directions, overriding the name heuristic (a URL-named import
// verified to hold an external origin flags; an unnamed-pattern import
// verified same-origin goes quiet). `null` (node_modules, missing file,
// no filename, budget spent, or a function-kind export) leaves the
// decision to the existing heuristics.
const crossFileImportedDestinationVerdict = (
  identifier: EsTreeNodeOfType<"Identifier">,
): boolean | null => {
  const resolvedExport = resolveCrossFileExportWithinBudget(identifier);
  if (!resolvedExport) return null;
  if (resolvedExport.kind !== "initializer") return null;
  return isTrustedForeignExportExpression({
    foreignExpression: resolvedExport.node,
    isDeferred: false,
  });
};

// `get…Url` / `create…Url` / `build…Url` imported helpers: the sync
// URL-builder naming family worth a cross-file look. `build…` helpers are
// otherwise opaque (they can compose arbitrary origins from arguments),
// so verifying that EVERY return is a same-origin-built URL is what turns
// the dtale `buildCorrelationsUrl` idiom quiet.
const CROSS_FILE_URL_HELPER_CALLEE_NAME_PATTERN = /^(?:get|create|build)[A-Za-z0-9]*(?:Url|URL)$/;

const crossFileUrlHelperDestinationVerdict = (
  calleeIdentifier: EsTreeNodeOfType<"Identifier">,
): boolean | null => {
  if (!CROSS_FILE_URL_HELPER_CALLEE_NAME_PATTERN.test(calleeIdentifier.name)) return null;
  const resolvedExport = resolveCrossFileExportWithinBudget(calleeIdentifier);
  if (!resolvedExport || resolvedExport.kind !== "function") return null;
  const returnedExpressions = collectLocalFunctionReturnExpressions(resolvedExport.node);
  if (!returnedExpressions || returnedExpressions.length === 0) return false;
  return returnedExpressions.every((returnedExpression) =>
    isTrustedForeignExportExpression({ foreignExpression: returnedExpression, isDeferred: true }),
  );
};

// `getViewUrl`, `getSearchUrl`, `createRelativePlaygroundUrl` — sync
// getter/factory helpers building the app's own route URLs. `build…`
// helpers stay opaque: `buildUrl(externalHost, path)` composes arbitrary
// origins from its arguments.
const URL_GETTER_CALLEE_NAME_PATTERN = /^(?:get|create)[A-Za-z0-9]*(?:Url|URL)$/;
const ORIGIN_PRESERVING_STRING_METHOD_NAMES = new Set(["toString", "trim", "trimEnd", "trimStart"]);

const terminalCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name;
  }
  return null;
};

const localFunctionParameterArgument = (
  identifier: EsTreeNodeOfType<"Identifier">,
  functionNode: EsTreeNode,
  callExpression: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (!bindingIsUnmodifiedBeforeCurrentOpen(identifier)) return null;
  const symbol = currentScopes?.symbolFor(identifier);
  const parameterIndex = (functionNode.params ?? []).findIndex(
    (parameter) =>
      isNodeOfType(parameter, "Identifier") && currentScopes?.symbolFor(parameter) === symbol,
  );
  return parameterIndex >= 0
    ? ((callExpression.arguments?.[parameterIndex] as EsTreeNode | undefined) ?? null)
    : null;
};

const isTrustedLocalFunctionReturn = (
  returnedExpression: EsTreeNode,
  functionNode: EsTreeNode,
  callExpression: EsTreeNodeOfType<"CallExpression">,
  depth: number,
): boolean => {
  const returned = stripParenExpression(returnedExpression);
  if (isNodeOfType(returned, "Identifier")) {
    const argument = localFunctionParameterArgument(returned, functionNode, callExpression);
    if (argument) return isTrustedOrNullishDestination(argument, depth + 1);
  }
  if (isNodeOfType(returned, "BinaryExpression") && returned.operator === "+") {
    const operands = flattenConcatOperands(returned);
    const firstOperand = operands[0];
    if (firstOperand && isNodeOfType(firstOperand, "Identifier")) {
      const argument = localFunctionParameterArgument(firstOperand, functionNode, callExpression);
      let followingStaticText = "";
      let operandIndex = 1;
      while (operandIndex < operands.length) {
        const operandStaticText = staticStringLiteralText(operands[operandIndex]);
        if (operandStaticText == null) break;
        followingStaticText += operandStaticText;
        operandIndex += 1;
      }
      if (
        argument &&
        isSafeInterpolatedDestinationSuffix(followingStaticText, operandIndex < operands.length) &&
        (!followingStaticText.startsWith("/") || isProvenSafeSlashJoinedBase(argument, depth + 1))
      ) {
        return isTrustedDestination(argument, depth + 1);
      }
    }
  }
  if (isNodeOfType(returned, "TemplateLiteral")) {
    const firstQuasiText = returned.quasis?.[0]?.value?.raw ?? "";
    const firstExpression = returned.expressions?.[0];
    if (
      firstQuasiText.length === 0 &&
      firstExpression &&
      isNodeOfType(firstExpression, "Identifier")
    ) {
      const argument = localFunctionParameterArgument(
        firstExpression,
        functionNode,
        callExpression,
      );
      const followingQuasiText = returned.quasis?.[1]?.value?.raw ?? "";
      if (
        argument &&
        isSafeInterpolatedDestinationSuffix(
          followingQuasiText,
          (returned.expressions?.length ?? 0) > 1,
        ) &&
        (!followingQuasiText.startsWith("/") || isProvenSafeSlashJoinedBase(argument, depth + 1))
      ) {
        return isTrustedDestination(argument, depth + 1);
      }
    }
  }
  return isTrustedOrNullishDestination(returned, depth);
};

const isTrustedLocalFunctionCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  depth: number,
): boolean => {
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const localFunction = resolveLocalFunctionNode(callee);
  const returnedExpressions = localFunction
    ? collectLocalFunctionReturnExpressions(localFunction)
    : null;
  if (!localFunction || !returnedExpressions || returnedExpressions.length === 0) return false;
  const previousInvocationReference = currentLocalFunctionInvocationReference;
  const previousSerializationReference = currentLocalFunctionSerializationReference;
  const previousImmediateSerializationReference =
    currentImmediateLocalFunctionSerializationReference;
  const previousAnalyzedLocalFunction = currentAnalyzedLocalFunction;
  currentLocalFunctionInvocationReference ??= callExpression;
  currentLocalFunctionSerializationReference ??= callExpression;
  currentImmediateLocalFunctionSerializationReference = callExpression;
  currentAnalyzedLocalFunction = localFunction;
  try {
    return returnedExpressions.every((returnedExpression) =>
      isTrustedLocalFunctionReturn(returnedExpression, localFunction, callExpression, depth),
    );
  } finally {
    currentLocalFunctionInvocationReference = previousInvocationReference;
    currentLocalFunctionSerializationReference = previousSerializationReference;
    currentImmediateLocalFunctionSerializationReference = previousImmediateSerializationReference;
    currentAnalyzedLocalFunction = previousAnalyzedLocalFunction;
  }
};

const OBJECT_MUTATION_METHOD_NAMES = new Set([
  "assign",
  "defineProperties",
  "defineProperty",
  "setPrototypeOf",
]);

const REFLECT_MUTATION_METHOD_NAMES = new Set(["defineProperty", "set", "setPrototypeOf"]);

const destructuredGlobalNamespacePropertyName = (
  identifier: EsTreeNodeOfType<"Identifier">,
  namespaceName: string,
  scopes: ScopeAnalysis,
): string | null => {
  const binding = findVariableInitializer(identifier, identifier.name);
  let propertyNode = binding?.bindingIdentifier.parent;
  if (propertyNode && isNodeOfType(propertyNode, "AssignmentPattern")) {
    propertyNode = propertyNode.parent;
  }
  if (!propertyNode || !isNodeOfType(propertyNode, "Property")) return null;
  const objectPattern = propertyNode.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return null;
  const declarator = objectPattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  const declaration = declarator.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    !declarator.init ||
    !isProvenGlobalNamespaceReference(declarator.init, namespaceName, scopes)
  ) {
    return null;
  }
  return getStaticPropertyKeyName(propertyNode, { allowComputedString: true });
};

const calleeResolvesToGlobalMutationMethod = (
  calleeNode: EsTreeNode,
  namespaceName: string,
  methodNames: Set<string>,
  scopes: ScopeAnalysis,
  depth: number,
): boolean => {
  if (depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
  const callee = stripParenExpression(calleeNode);
  if (isNodeOfType(callee, "MemberExpression")) {
    const methodName = getStaticPropertyName(callee);
    return Boolean(
      methodName &&
      methodNames.has(methodName) &&
      isProvenGlobalNamespaceReference(callee.object, namespaceName, scopes),
    );
  }
  if (!isNodeOfType(callee, "Identifier")) return false;
  const initializer = resolveConstInitializer(callee);
  if (initializer) {
    return calleeResolvesToGlobalMutationMethod(
      initializer,
      namespaceName,
      methodNames,
      scopes,
      depth + 1,
    );
  }
  const propertyName = destructuredGlobalNamespacePropertyName(callee, namespaceName, scopes);
  return Boolean(propertyName && methodNames.has(propertyName));
};

const isGlobalObjectMutationCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  return (
    calleeResolvesToGlobalMutationMethod(
      callExpression.callee as EsTreeNode,
      "Object",
      OBJECT_MUTATION_METHOD_NAMES,
      scopes,
      0,
    ) ||
    calleeResolvesToGlobalMutationMethod(
      callExpression.callee as EsTreeNode,
      "Reflect",
      REFLECT_MUTATION_METHOD_NAMES,
      scopes,
      0,
    )
  );
};

const staticStringLiteralText = (node: EsTreeNode | undefined): string | null => {
  if (!node) return null;
  const unwrappedNode = stripParenExpression(node);
  if (isStringLiteral(unwrappedNode)) return unwrappedNode.value;
  if (
    isNodeOfType(unwrappedNode, "TemplateLiteral") &&
    (unwrappedNode.expressions?.length ?? 0) === 0
  ) {
    return unwrappedNode.quasis?.[0]?.value?.cooked ?? null;
  }
  return null;
};

const objectExpressionMayWriteProperty = (
  node: EsTreeNode | undefined,
  propertyName: string,
): boolean => {
  if (!node) return true;
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "ObjectExpression")) return true;
  return (unwrappedNode.properties ?? []).some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const staticPropertyName = getStaticPropertyKeyName(property, {
      allowComputedString: true,
    });
    return staticPropertyName === null || staticPropertyName === propertyName;
  });
};

const globalObjectMutationMayWriteProperty = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  propertyName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const resolvesObjectMethod = (methodName: string): boolean =>
    calleeResolvesToGlobalMutationMethod(
      callExpression.callee as EsTreeNode,
      "Object",
      new Set([methodName]),
      scopes,
      0,
    );
  const resolvesReflectMethod = (methodName: string): boolean =>
    calleeResolvesToGlobalMutationMethod(
      callExpression.callee as EsTreeNode,
      "Reflect",
      new Set([methodName]),
      scopes,
      0,
    );
  if (resolvesObjectMethod("assign")) {
    return (callExpression.arguments ?? [])
      .slice(1)
      .some((argument) => objectExpressionMayWriteProperty(argument as EsTreeNode, propertyName));
  }
  if (resolvesObjectMethod("defineProperties")) {
    return objectExpressionMayWriteProperty(
      callExpression.arguments?.[1] as EsTreeNode | undefined,
      propertyName,
    );
  }
  if (
    resolvesObjectMethod("defineProperty") ||
    resolvesReflectMethod("defineProperty") ||
    resolvesReflectMethod("set")
  ) {
    const mutationPropertyName = staticStringLiteralText(
      callExpression.arguments?.[1] as EsTreeNode | undefined,
    );
    return mutationPropertyName === null || mutationPropertyName === propertyName;
  }
  return resolvesObjectMethod("setPrototypeOf") || resolvesReflectMethod("setPrototypeOf");
};

const globalNamespaceBindingIsUnmodifiedBefore = (
  namespaceName: string,
  referenceNode: EsTreeNode,
  lexicalBoundaryNode: EsTreeNode = referenceNode,
): boolean => {
  const scopes = currentScopes;
  const program = findProgramRoot(referenceNode);
  if (!scopes || !program) return false;
  const mutationExecutesBeforeReference = (mutationNode: EsTreeNode): boolean => {
    if (mutationNode.range == null || referenceNode.range == null) return true;
    if (!isAnalyzingForeignExport) {
      const lexicalBoundaryFunction = findEnclosingFunction(lexicalBoundaryNode);
      const comparisonReference =
        lexicalBoundaryFunction && findEnclosingFunction(mutationNode) === lexicalBoundaryFunction
          ? lexicalBoundaryNode
          : referenceNode;
      return mutationNode.range[0] < getExecutionReferenceOffset(comparisonReference);
    }
    return (
      isSymbolWriteBefore(mutationNode, referenceNode, scopes) ||
      (isAnalyzingDeferredForeignExport && isSymbolWriteBefore(mutationNode, program, scopes))
    );
  };
  let nodesByNamespace = globalNamespaceMutationNodesMemo.get(scopes);
  if (!nodesByNamespace) {
    nodesByNamespace = new Map();
    globalNamespaceMutationNodesMemo.set(scopes, nodesByNamespace);
  }
  const memoizedMutationNodes = nodesByNamespace.get(namespaceName);
  if (memoizedMutationNodes) {
    if (memoizedMutationNodes.length === 0) return true;
    if (referenceNode.range == null) return false;
    return !memoizedMutationNodes.some(mutationExecutesBeforeReference);
  }
  const mutationNodes: EsTreeNode[] = [];
  const mutationTargetsNamespace = (mutationTarget: EsTreeNode, depth = 0): boolean => {
    if (depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
    const namespaceCandidate = stripParenExpression(mutationTarget);
    if (isProvenGlobalNamespaceReference(namespaceCandidate, namespaceName, scopes)) return true;
    if (isNodeOfType(namespaceCandidate, "MemberExpression")) {
      return mutationTargetsNamespace(namespaceCandidate.object, depth + 1);
    }
    if (!isNodeOfType(namespaceCandidate, "Identifier")) return false;
    const initializer = resolveConstInitializer(namespaceCandidate);
    if (initializer && mutationTargetsNamespace(initializer, depth + 1)) return true;
    return (
      destructuredGlobalNamespacePropertyName(namespaceCandidate, namespaceName, scopes) ===
      "prototype"
    );
  };
  walkAst(program, (node: EsTreeNode) => {
    let mutationTarget: EsTreeNode | null = null;
    if (isNodeOfType(node, "AssignmentExpression")) mutationTarget = node.left;
    if (isNodeOfType(node, "UpdateExpression")) mutationTarget = node.argument;
    if (isNodeOfType(node, "UnaryExpression") && node.operator === "delete") {
      mutationTarget = node.argument;
    }
    if (isNodeOfType(node, "CallExpression") && isGlobalObjectMutationCall(node, scopes)) {
      mutationTarget = (node.arguments?.[0] as EsTreeNode | undefined) ?? null;
    }
    if (mutationTarget && mutationTargetsNamespace(mutationTarget)) {
      mutationNodes.push(node);
    }
  });
  nodesByNamespace.set(namespaceName, mutationNodes);
  if (mutationNodes.length === 0) return true;
  if (referenceNode.range == null) return false;
  return !mutationNodes.some(mutationExecutesBeforeReference);
};

// `URL.createObjectURL(blob)` — a blob: URL of app-generated content; the
// opened document is same-process content, no opener hazard.
const isCreateObjectUrlCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  getStaticPropertyName(node.callee) === "createObjectURL" &&
  Boolean(
    currentScopes &&
    globalNamespaceBindingIsUnmodifiedBefore("URL", node) &&
    isProvenUnmodifiedGlobalNamespaceReference(
      node.callee.object,
      "URL",
      currentScopes,
      "createObjectURL",
    ),
  );

const URL_ORIGIN_PROPERTY_NAMES = [
  "href",
  "host",
  "hostname",
  "password",
  "port",
  "protocol",
  "toJSON",
  "toString",
  "username",
];

const hasUrlOriginMutationBefore = (
  identifier: EsTreeNodeOfType<"Identifier">,
  referenceNode: EsTreeNode,
): boolean => {
  const scopes = currentScopes;
  if (!scopes) return false;
  const hasPropertyMutation = URL_ORIGIN_PROPERTY_NAMES.some((propertyName) =>
    hasPossibleStaticPropertyWriteBefore(identifier, propertyName, referenceNode, scopes),
  );
  if (hasPropertyMutation) return true;
  const identifierSymbol = scopes.symbolFor(identifier);
  if (!identifierSymbol) return false;
  let mutationCalls = objectMutationCallsBySymbolMemo.get(identifierSymbol);
  if (!mutationCalls) {
    mutationCalls = [];
    const program = findProgramRoot(identifier);
    const targetResolvesToIdentifier = (targetNode: EsTreeNode, depth: number): boolean => {
      if (depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
      const unwrappedTarget = stripParenExpression(targetNode);
      if (!isNodeOfType(unwrappedTarget, "Identifier")) return false;
      if (scopes.symbolFor(unwrappedTarget) === identifierSymbol) return true;
      const initializer = resolveConstInitializer(unwrappedTarget);
      return Boolean(initializer && targetResolvesToIdentifier(initializer, depth + 1));
    };
    if (program) {
      walkAst(program, (node: EsTreeNode) => {
        if (!isNodeOfType(node, "CallExpression") || !isGlobalObjectMutationCall(node, scopes)) {
          return;
        }
        const mutationTarget = node.arguments?.[0] as EsTreeNode | undefined;
        if (mutationTarget && targetResolvesToIdentifier(mutationTarget, 0)) {
          mutationCalls?.push(node);
        }
      });
    }
    objectMutationCallsBySymbolMemo.set(identifierSymbol, mutationCalls);
  }
  return mutationCalls.some((mutationCall) =>
    writeExecutesBeforeDestinationReference(mutationCall, referenceNode, scopes),
  );
};

const isGlobalUrlConstruction = (node: EsTreeNode): boolean => {
  const unwrappedNode = stripParenExpression(node);
  return Boolean(
    currentScopes &&
    isNodeOfType(unwrappedNode, "NewExpression") &&
    isProvenGlobalNamespaceReference(unwrappedNode.callee as EsTreeNode, "URL", currentScopes),
  );
};

const isGlobalUrlInstanceExpression = (node: EsTreeNode): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (isGlobalUrlConstruction(unwrappedNode)) return true;
  if (!isNodeOfType(unwrappedNode, "Identifier")) return false;
  const initializer = resolveConstInitializer(unwrappedNode);
  return Boolean(initializer && isGlobalUrlConstruction(initializer));
};

const withDestinationCoercionReference = <Value>(
  referenceNode: EsTreeNode,
  boundaryNode: EsTreeNode,
  operation: () => Value,
): Value => {
  const previousReference = currentDestinationCoercionReference;
  const previousBoundaryReference = currentDestinationCoercionBoundaryReference;
  currentDestinationCoercionReference = referenceNode;
  currentDestinationCoercionBoundaryReference = boundaryNode;
  try {
    return operation();
  } finally {
    currentDestinationCoercionReference = previousReference;
    currentDestinationCoercionBoundaryReference = previousBoundaryReference;
  }
};

const destinationSerializationReference = (boundaryNode: EsTreeNode): EsTreeNode => {
  const boundaryFunction = findEnclosingFunction(boundaryNode);
  const currentOpenFunction = currentWindowOpenCall
    ? findEnclosingFunction(currentWindowOpenCall)
    : null;
  const localInvocationReference =
    boundaryFunction &&
    (boundaryFunction === currentOpenFunction ||
      boundaryFunction === currentAnalyzedLocalFunction ||
      currentDeferredLocalFunctions.includes(boundaryFunction))
      ? (currentLocalFunctionSerializationReference ??
        currentOpaqueLocalFunctionSerializationReference)
      : undefined;
  return (
    localInvocationReference ??
    (isAnalyzingDeferredForeignExport ? currentDestinationCoercionReference : undefined) ??
    boundaryNode
  );
};

const isTrustedUrlInstanceHrefRead = (
  memberNode: EsTreeNodeOfType<"MemberExpression">,
  depth: number,
): boolean => {
  if (memberNode.computed || getStaticPropertyName(memberNode) !== "href") return false;
  const receiver = stripParenExpression(memberNode.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const initializer = resolveConstInitializer(receiver);
  if (!initializer || !isNodeOfType(stripParenExpression(initializer), "NewExpression")) {
    return false;
  }
  const serializationReference = destinationSerializationReference(memberNode);
  if (!globalNamespaceBindingIsUnmodifiedBefore("URL", serializationReference, memberNode)) {
    return false;
  }
  if (
    hasUrlOriginMutationBefore(receiver, serializationReference) ||
    Boolean(
      currentImmediateLocalFunctionSerializationReference &&
      hasUrlOriginMutationBefore(receiver, currentImmediateLocalFunctionSerializationReference),
    )
  ) {
    return false;
  }
  return withDestinationCoercionReference(serializationReference, memberNode, () =>
    isTrustedDestination(initializer, depth + 1),
  );
};

const isSafeInterpolatedDestinationSuffix = (
  suffixText: string,
  hasFollowingExpression = false,
): boolean => {
  if (suffixText.length === 0) return !hasFollowingExpression;
  if (suffixText.startsWith("?") || suffixText.startsWith("#")) {
    return true;
  }
  return suffixText.startsWith("/") && suffixText[1] !== "/" && suffixText[1] !== "\\";
};

const INCOMPLETE_BROWSING_SCHEME_BASE_PATTERN = /^(?:https?|ftp|wss?):\/*$/iu;

const stripUrlLeadingAndTrailingC0ControlOrSpace = (urlText: string): string => {
  let startIndex = 0;
  while (startIndex < urlText.length && urlText.charAt(startIndex) <= " ") {
    startIndex += 1;
  }
  let endIndex = urlText.length;
  while (endIndex > startIndex && urlText.charAt(endIndex - 1) <= " ") {
    endIndex -= 1;
  }
  return urlText.slice(startIndex, endIndex);
};

const staticPrimitiveTruthiness = (node: EsTreeNode): boolean | null => {
  const unwrappedNode = stripParenExpression(node);
  if (isNullishExpression(unwrappedNode)) return false;
  if (!isNodeOfType(unwrappedNode, "Literal")) return null;
  if (typeof unwrappedNode.value === "boolean") return unwrappedNode.value;
  if (typeof unwrappedNode.value === "string") return unwrappedNode.value.length > 0;
  if (typeof unwrappedNode.value === "number") {
    return unwrappedNode.value !== 0 && !Number.isNaN(unwrappedNode.value);
  }
  if (typeof unwrappedNode.value === "bigint") return unwrappedNode.value !== 0n;
  return null;
};

const isProvenSafeSlashJoinedBase = (destination: EsTreeNode, depth: number): boolean => {
  if (depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
  const unwrappedDestination = stripParenExpression(destination);
  if (isNodeOfType(unwrappedDestination, "Literal")) {
    if (typeof unwrappedDestination.value !== "string") {
      return staticPrimitiveTruthiness(unwrappedDestination) !== null;
    }
    const normalizedValue = stripUrlLeadingAndTrailingC0ControlOrSpace(
      unwrappedDestination.value.replaceAll(/[\t\n\r]/gu, ""),
    ).replaceAll("\\", "/");
    return (
      normalizedValue.length > 0 &&
      !/^\/+$/u.test(normalizedValue) &&
      !INCOMPLETE_BROWSING_SCHEME_BASE_PATTERN.test(normalizedValue)
    );
  }
  if (isSameOriginLocationRead(unwrappedDestination)) return true;
  if (isNodeOfType(unwrappedDestination, "ConditionalExpression")) {
    const testTruthiness = staticPrimitiveTruthiness(unwrappedDestination.test);
    if (testTruthiness !== null) {
      return isProvenSafeSlashJoinedBase(
        testTruthiness ? unwrappedDestination.consequent : unwrappedDestination.alternate,
        depth + 1,
      );
    }
    return (
      isProvenSafeSlashJoinedBase(unwrappedDestination.consequent, depth + 1) &&
      isProvenSafeSlashJoinedBase(unwrappedDestination.alternate, depth + 1)
    );
  }
  if (isNodeOfType(unwrappedDestination, "LogicalExpression")) {
    const leftTruthiness = staticPrimitiveTruthiness(unwrappedDestination.left);
    if (unwrappedDestination.operator === "&&") {
      return (
        leftTruthiness === false ||
        isProvenSafeSlashJoinedBase(unwrappedDestination.right, depth + 1)
      );
    }
    if (unwrappedDestination.operator === "??") {
      if (isNullishExpression(unwrappedDestination.left)) {
        return isProvenSafeSlashJoinedBase(unwrappedDestination.right, depth + 1);
      }
      if (leftTruthiness !== null) {
        return isProvenSafeSlashJoinedBase(unwrappedDestination.left, depth + 1);
      }
    }
    if (unwrappedDestination.operator === "||" && leftTruthiness !== null) {
      return isProvenSafeSlashJoinedBase(
        leftTruthiness ? unwrappedDestination.left : unwrappedDestination.right,
        depth + 1,
      );
    }
    return (
      isProvenSafeSlashJoinedBase(unwrappedDestination.left, depth + 1) &&
      isProvenSafeSlashJoinedBase(unwrappedDestination.right, depth + 1)
    );
  }
  if (isNodeOfType(unwrappedDestination, "Identifier")) {
    const resolvedSymbol = currentScopes
      ? resolveConstIdentifierAlias(unwrappedDestination, currentScopes)
      : null;
    const initializer = resolvedSymbol?.kind === "const" ? resolvedSymbol.initializer : null;
    return Boolean(initializer && isProvenSafeSlashJoinedBase(initializer, depth + 1));
  }
  if (
    isNodeOfType(unwrappedDestination, "CallExpression") &&
    isNodeOfType(unwrappedDestination.callee, "Identifier")
  ) {
    const localFunction = resolveLocalFunctionNode(unwrappedDestination.callee);
    const returnedExpressions = localFunction
      ? collectLocalFunctionReturnExpressions(localFunction)
      : null;
    return Boolean(
      returnedExpressions &&
      returnedExpressions.length > 0 &&
      returnedExpressions.every((returnedExpression) =>
        isProvenSafeSlashJoinedBase(returnedExpression, depth + 1),
      ),
    );
  }
  return false;
};

const isTrustedInterpolatedDestinationBase = (destination: EsTreeNode, depth: number): boolean => {
  const unwrappedDestination = stripParenExpression(destination);
  if (
    isNodeOfType(unwrappedDestination, "Literal") &&
    typeof unwrappedDestination.value !== "string"
  ) {
    return staticPrimitiveTruthiness(unwrappedDestination) !== null;
  }
  if (isNodeOfType(unwrappedDestination, "ConditionalExpression")) {
    const testTruthiness = staticPrimitiveTruthiness(unwrappedDestination.test);
    if (testTruthiness !== null) {
      return isTrustedInterpolatedDestinationBase(
        testTruthiness ? unwrappedDestination.consequent : unwrappedDestination.alternate,
        depth + 1,
      );
    }
    return (
      isTrustedInterpolatedDestinationBase(unwrappedDestination.consequent, depth + 1) &&
      isTrustedInterpolatedDestinationBase(unwrappedDestination.alternate, depth + 1)
    );
  }
  if (isNodeOfType(unwrappedDestination, "LogicalExpression")) {
    const leftTruthiness = staticPrimitiveTruthiness(unwrappedDestination.left);
    if (unwrappedDestination.operator === "&&") {
      return (
        leftTruthiness === false ||
        isTrustedInterpolatedDestinationBase(unwrappedDestination.right, depth + 1)
      );
    }
    if (unwrappedDestination.operator === "??" && isNullishExpression(unwrappedDestination.left)) {
      return isTrustedInterpolatedDestinationBase(unwrappedDestination.right, depth + 1);
    }
    if (leftTruthiness !== null) {
      return isTrustedInterpolatedDestinationBase(
        unwrappedDestination.operator === "||" && !leftTruthiness
          ? unwrappedDestination.right
          : unwrappedDestination.left,
        depth + 1,
      );
    }
    return (
      isTrustedInterpolatedDestinationBase(unwrappedDestination.left, depth + 1) &&
      isTrustedInterpolatedDestinationBase(unwrappedDestination.right, depth + 1)
    );
  }
  return isTrustedDestination(unwrappedDestination, depth + 1);
};

const isTrustedDestination = (
  urlArgument: EsTreeNode | null | undefined,
  depth: number,
): boolean => {
  if (isTrustedStaticDestination(urlArgument)) return true;
  if (urlArgument == null || depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
  if (isNodeOfType(urlArgument, "ConditionalExpression")) {
    return (
      isTrustedOrNullishDestination(urlArgument.consequent, depth + 1) &&
      isTrustedOrNullishDestination(urlArgument.alternate, depth + 1)
    );
  }
  if (isNodeOfType(urlArgument, "LogicalExpression")) {
    if (urlArgument.operator === "&&") {
      return (
        isNullishExpression(urlArgument.left) ||
        isTrustedOrNullishDestination(urlArgument.right, depth + 1)
      );
    }
    if (isStaticallyTruthyTrustedDestination(urlArgument.left, depth + 1)) return true;
    return (
      isTrustedOrNullishDestination(urlArgument.left, depth + 1) &&
      isTrustedOrNullishDestination(urlArgument.right, depth + 1)
    );
  }
  // TS assertions (`'https://…' as const`) are transparent.
  if (
    urlArgument.type === "TSAsExpression" ||
    urlArgument.type === "TSSatisfiesExpression" ||
    urlArgument.type === "TSNonNullExpression"
  ) {
    return isTrustedDestination(
      (urlArgument as { expression?: EsTreeNode }).expression ?? null,
      depth + 1,
    );
  }
  if (isNodeOfType(urlArgument, "BinaryExpression") && urlArgument.operator === "+") {
    return isTrustedConcatPrefix(leftmostConcatOperand(urlArgument));
  }
  if (isCreateObjectUrlCall(urlArgument)) return true;
  // `shareUrl.toString()` / `shareUrl.href` where shareUrl is a const
  // `new URL('<trusted>')` builder — searchParams mutation cannot change
  // the origin.
  if (
    isNodeOfType(urlArgument, "CallExpression") &&
    isNodeOfType(urlArgument.callee, "MemberExpression") &&
    !urlArgument.callee.computed &&
    isNodeOfType(urlArgument.callee.property, "Identifier") &&
    (urlArgument.callee.property.name === "toString" ||
      urlArgument.callee.property.name === "toJSON")
  ) {
    const urlReceiver = urlArgument.callee.object as EsTreeNode;
    const serializationReference = destinationSerializationReference(urlArgument);
    if (
      isGlobalUrlInstanceExpression(urlReceiver) &&
      !globalNamespaceBindingIsUnmodifiedBefore("URL", serializationReference, urlArgument)
    ) {
      return false;
    }
    return withDestinationCoercionReference(serializationReference, urlArgument, () =>
      isTrustedDestination(stripParenExpression(urlReceiver), depth + 1),
    );
  }
  if (isNodeOfType(urlArgument, "NewExpression")) {
    const coercionReference = currentDestinationCoercionReference ?? urlArgument;
    const constructionProgram = findProgramRoot(urlArgument);
    const coercionProgram = findProgramRoot(coercionReference);
    if (
      !currentScopes ||
      !constructionProgram ||
      constructionProgram !== coercionProgram ||
      !isProvenGlobalNamespaceReference(urlArgument.callee as EsTreeNode, "URL", currentScopes) ||
      !globalNamespaceBindingIsUnmodifiedBefore("URL", urlArgument) ||
      !globalNamespaceBindingIsUnmodifiedBefore(
        "URL",
        coercionReference,
        currentDestinationCoercionBoundaryReference ?? urlArgument,
      )
    ) {
      return false;
    }
    if (!isTrustedDestination((urlArgument.arguments?.[0] as EsTreeNode) ?? null, depth + 1)) {
      return false;
    }
    // WHATWG URL resolves a relative first argument against the BASE, so
    // `new URL('/store', externalBase)` navigates to the base's origin —
    // the base must be as trusted as the path.
    const baseArgument = urlArgument.arguments?.[1];
    return baseArgument === undefined
      ? true
      : isTrustedDestination(baseArgument as EsTreeNode, depth + 1);
  }
  // `EXTERNAL_LINKS.docs` / `item.href` — a member read off a const
  // object/array config whose relevant values are all trusted literals;
  // `anchorEl.href` — a DOM round-trip of a trusted JSX href; `urls[0]` —
  // an index read off a const array of trusted destinations.
  // Non-terminal: location-shaped member reads are handled below.
  if (isNodeOfType(urlArgument, "MemberExpression")) {
    if (!urlArgument.computed && isTrustedUrlInstanceHrefRead(urlArgument, depth + 1)) return true;
    if (!urlArgument.computed && isTrustedConstConfigMember(urlArgument, depth + 1)) return true;
    if (!urlArgument.computed && isTrustedAnchorParamHrefRead(urlArgument, depth + 1)) return true;
    if (urlArgument.computed && isTrustedConstArrayIndexRead(urlArgument, depth + 1)) return true;
  }
  if (isNodeOfType(urlArgument, "Identifier")) {
    const crossFileVerdict = crossFileImportedDestinationVerdict(urlArgument);
    if (crossFileVerdict != null) return crossFileVerdict;
    const constInitializer = resolveConstInitializer(urlArgument);
    if (constInitializer != null) {
      const coercionBoundaryReference = currentDestinationCoercionBoundaryReference ?? urlArgument;
      const coercionExecutionReference = currentDestinationCoercionReference ?? urlArgument;
      if (
        isNodeOfType(stripParenExpression(constInitializer), "NewExpression") &&
        (hasUrlOriginMutationBefore(urlArgument, coercionExecutionReference) ||
          Boolean(
            currentImmediateLocalFunctionSerializationReference &&
            hasUrlOriginMutationBefore(
              urlArgument,
              currentImmediateLocalFunctionSerializationReference,
            ),
          ) ||
          !globalNamespaceBindingIsUnmodifiedBefore(
            "URL",
            coercionExecutionReference,
            coercionBoundaryReference,
          ))
      ) {
        return false;
      }
      return isTrustedOrNullishDestination(constInitializer, depth + 1);
    }
    if (isLetAssignedOnlyTrustedLiterals(urlArgument, depth + 1)) return true;
    if (isTrustedLocalComponentPropLiteral(urlArgument, depth + 1)) return true;
    if (isTrustedUseStateUrlBinding(urlArgument, depth + 1)) return true;
    const destructuredIterationVerdict = isTrustedDestructuredIterationMember(
      urlArgument,
      depth + 1,
    );
    if (destructuredIterationVerdict != null) return destructuredIterationVerdict;
    if (isTrustedLocalWrapperParam(urlArgument, depth + 1)) return true;
    return isRouterCoNavigatedIdentifier(urlArgument);
  }
  if (isNodeOfType(urlArgument, "ChainExpression")) {
    return isTrustedDestination(urlArgument.expression as EsTreeNode, depth + 1);
  }
  // A template that LEADS with an interpolation is trusted when that
  // interpolation itself is (`` `${fullPath('/export', id)}?type=csv` `` —
  // the rest of the template lands in the path/query of the same URL).
  if (isNodeOfType(urlArgument, "TemplateLiteral")) {
    const firstQuasiText = (urlArgument.quasis?.[0]?.value?.raw ?? "").trimStart();
    const firstExpression = urlArgument.expressions?.[0];
    if (firstQuasiText.length === 0 && firstExpression) {
      const firstExpressionNode = firstExpression as EsTreeNode;
      const resolvedFirstExpressionSymbol =
        currentScopes && isNodeOfType(stripParenExpression(firstExpressionNode), "Identifier")
          ? resolveConstIdentifierAlias(stripParenExpression(firstExpressionNode), currentScopes)
          : null;
      const trustedFirstExpression =
        resolvedFirstExpressionSymbol?.kind === "const" && resolvedFirstExpressionSymbol.initializer
          ? resolvedFirstExpressionSymbol.initializer
          : firstExpressionNode;
      const followingQuasiText = urlArgument.quasis?.[1]?.value?.raw ?? "";
      return withDestinationCoercionReference(
        destinationSerializationReference(urlArgument),
        urlArgument,
        () =>
          Boolean(
            isSafeInterpolatedDestinationSuffix(
              followingQuasiText,
              (urlArgument.expressions?.length ?? 0) > 1,
            ) &&
            (!followingQuasiText.startsWith("/") ||
              isProvenSafeSlashJoinedBase(trustedFirstExpression, depth + 1)) &&
            isTrustedInterpolatedDestinationBase(trustedFirstExpression, depth + 1),
          ),
      );
    }
    return false;
  }
  // `location.origin` / `getLocation().href` reads are same-origin values by
  // construction. Bare pathname reads stay opaque because `//host` is a valid
  // pathname shape and becomes a protocol-relative destination when reopened.
  if (isSameOriginLocationRead(urlArgument)) return true;
  if (isNodeOfType(urlArgument, "CallExpression")) {
    if (isTrustedLocalFunctionCall(urlArgument, depth + 1)) return true;
    // A helper NAMED as a path builder (`fullPath(path, dataId)`,
    // `menuFuncs.fullPath(...)`) returns a same-origin path by its own
    // contract — a "path" has no origin. A synchronous `get…Url` /
    // `create…Url` getter called with local data (`getViewUrl(view, id)`,
    // `getSearchUrl({ service })`) is the app's own route builder;
    // server-fetched external URLs arrive through `await`ed calls, which
    // stay opaque (the AwaitExpression is never trusted).
    const calleeName = terminalCalleeName(urlArgument.callee as EsTreeNode);
    if (calleeName != null) {
      if (
        isNodeOfType(urlArgument.callee, "Identifier") &&
        URL_GETTER_CALLEE_NAME_PATTERN.test(calleeName)
      ) {
        const crossFileVerdict = crossFileUrlHelperDestinationVerdict(urlArgument.callee);
        if (crossFileVerdict !== null) return crossFileVerdict;
        return false;
      }
    }
    // `buildCorrelationsUrl(dataId, …)` — an imported URL-builder helper
    // is opaque by name, but when its module resolves, the call is
    // trusted if EVERY return the foreign function can produce is a
    // same-origin-built URL (dtale CorrelationsGrid idiom).
    if (isNodeOfType(urlArgument.callee, "Identifier")) {
      const crossFileVerdict = crossFileUrlHelperDestinationVerdict(urlArgument.callee);
      if (crossFileVerdict !== null) return crossFileVerdict;
    }
    const callee = urlArgument.callee as EsTreeNode;
    if (isNodeOfType(callee, "MemberExpression")) {
      const methodName = getStaticPropertyName(callee);
      return (
        methodName !== null &&
        ORIGIN_PRESERVING_STRING_METHOD_NAMES.has(methodName) &&
        isTrustedDestination(callee.object, depth + 1)
      );
    }
    return false;
  }
  return false;
};

const isTrustedOrNullishDestination = (
  urlExpression: EsTreeNode | null | undefined,
  depth: number,
): boolean => isNullishExpression(urlExpression) || isTrustedDestination(urlExpression, depth);

const isTrustedTopLevelDestination = (urlExpression: EsTreeNode | null | undefined): boolean => {
  if (urlExpression == null) return true;
  const strippedExpression = stripParenExpression(urlExpression);
  const memoKey = strippedExpression;
  const memoizedVerdict = trustedTopLevelDestinationMemo.get(memoKey);
  if (memoizedVerdict !== undefined) return memoizedVerdict;
  const verdict = withDestinationCoercionReference(strippedExpression, strippedExpression, () =>
    isTrustedOrNullishDestination(urlExpression, 0),
  );
  trustedTopLevelDestinationMemo.set(memoKey, verdict);
  return verdict;
};

// A statically truthy trusted left operand of `||`/`??` short-circuits, so
// `trustedUrl || dynamicFallback` always opens the trusted destination and
// the right side never evaluates. Only trusted destinations with nonempty
// static text qualify — `''` is falsy under `||` and a nullish binding
// falls through to the right operand under both operators.
const isStaticallyTruthyTrustedDestination = (
  urlExpression: EsTreeNode | null | undefined,
  depth: number,
): boolean => {
  if (urlExpression == null || depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
  if (isStringLiteral(urlExpression)) {
    return urlExpression.value.length > 0 && isTrustedStaticDestination(urlExpression);
  }
  if (isNodeOfType(urlExpression, "TemplateLiteral")) {
    const hasStaticText =
      urlExpression.quasis?.some((quasi) => (quasi.value?.raw ?? "").length > 0) ?? false;
    return hasStaticText && isTrustedStaticDestination(urlExpression);
  }
  if (isNodeOfType(urlExpression, "Identifier")) {
    const constInitializer = resolveConstInitializer(urlExpression);
    return (
      constInitializer != null && isStaticallyTruthyTrustedDestination(constInitializer, depth + 1)
    );
  }
  return false;
};

// Best-effort static text of the features argument: string literals,
// template literals (interpolations resolved when they are local const
// strings, marked opaque otherwise so entry boundaries stay visible), and
// identifiers bound to a local const initializer (`let`/`var` can be
// reassigned after the initializer, so they stay opaque). Returns
// null when the value is opaque (imported constant, call result), in
// which case the caller must not assume noopener is absent.
const resolveStaticStringText = (
  node: EsTreeNode | null | undefined,
  depth: number,
): string | null => {
  if (node == null || depth > MAX_BINDING_RESOLUTION_DEPTH) return null;
  if (isStringLiteral(node)) return node.value;
  if (isNodeOfType(node, "TemplateLiteral")) {
    const quasiTexts = node.quasis?.map((quasi) => quasi.value?.raw ?? "") ?? [];
    const expressionTexts =
      node.expressions?.map(
        (expression) => resolveStaticStringText(expression, depth + 1) ?? OPAQUE_FEATURE_TEXT,
      ) ?? [];
    return quasiTexts
      .map((quasiText, quasiIndex) => quasiText + (expressionTexts[quasiIndex] ?? ""))
      .join("");
  }
  if (isNodeOfType(node, "Identifier")) {
    const constInitializer = resolveConstInitializer(node);
    if (constInitializer == null) return null;
    return resolveStaticStringText(constInitializer, depth + 1);
  }
  return null;
};

const isEntirelyOpaqueFeatureText = (featureText: string | undefined): boolean =>
  featureText != null &&
  featureText.length > 0 &&
  [...featureText].every((featureCharacter) => featureCharacter === OPAQUE_FEATURE_TEXT);

const featureEntryMayProtectOpener = (featureEntry: string): boolean => {
  const [featureName, featureValue] = featureEntry.toLowerCase().split("=");
  const valueMayEnableFeature =
    featureValue === undefined ||
    ENABLED_FEATURE_VALUES.has(featureValue) ||
    isEntirelyOpaqueFeatureText(featureValue);
  if (OPENER_PROTECTION_FEATURE_NAMES.has(featureName)) return valueMayEnableFeature;
  return isEntirelyOpaqueFeatureText(featureName) && valueMayEnableFeature;
};

const featuresMayProtectOpener = (featuresText: string): boolean =>
  featuresText.split(/[\s,]+/).some(featureEntryMayProtectOpener);

// The opened handle is captured/used when the arrow that returns it is
// stored or returned (its eventual return value may be consumed via
// `getPopup().focus()`), so a concise `() => window.open(...)` is only
// fire-and-forget when the arrow itself is an event handler (JSX prop or
// an `onX` property in a props object, whose return React/DOM ignores),
// a callback argument (forEach/map/addEventListener), or a bare
// statement.
const EVENT_HANDLER_KEY_PATTERN = /^on[A-Z]/;
const RETURN_DISCARDING_GLOBAL_CALLBACK_NAMES = new Set([
  "queueMicrotask",
  "requestAnimationFrame",
  "setInterval",
  "setTimeout",
]);

const hasBuiltInArrayTypeAnnotation = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const annotation = identifier.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return false;
  const typeNode = annotation.typeAnnotation;
  if (isNodeOfType(typeNode, "TSArrayType") || isNodeOfType(typeNode, "TSTupleType")) return true;
  return Boolean(
    isNodeOfType(typeNode, "TSTypeReference") &&
    isNodeOfType(typeNode.typeName, "Identifier") &&
    (typeNode.typeName.name === "Array" || typeNode.typeName.name === "ReadonlyArray"),
  );
};

const isProvenBuiltInArrayReceiver = (
  receiver: EsTreeNodeOfType<"Identifier">,
  referenceNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!bindingIsUnmodifiedBefore(receiver, referenceNode)) return false;
  if (hasArrayMethodWriteBefore(receiver, "forEach", referenceNode)) return false;
  const receiverBinding = scopes.symbolFor(receiver)?.bindingIdentifier;
  if (
    receiverBinding &&
    isNodeOfType(receiverBinding, "Identifier") &&
    hasBuiltInArrayTypeAnnotation(receiverBinding)
  ) {
    return true;
  }
  const initializer = resolveConstInitializer(receiver);
  if (!initializer) return false;
  const unwrappedInitializer = stripParenExpression(initializer);
  if (isNodeOfType(unwrappedInitializer, "ArrayExpression")) return true;
  if (
    isNodeOfType(unwrappedInitializer, "NewExpression") &&
    isProvenGlobalNamespaceReference(unwrappedInitializer.callee, "Array", scopes) &&
    globalNamespaceBindingIsUnmodifiedBefore("Array", referenceNode)
  ) {
    return true;
  }
  if (
    isNodeOfType(unwrappedInitializer, "CallExpression") &&
    isNodeOfType(unwrappedInitializer.callee, "MemberExpression") &&
    (getStaticPropertyName(unwrappedInitializer.callee) === "from" ||
      getStaticPropertyName(unwrappedInitializer.callee) === "of") &&
    isProvenUnmodifiedGlobalNamespaceReference(
      unwrappedInitializer.callee.object,
      "Array",
      scopes,
      getStaticPropertyName(unwrappedInitializer.callee) ?? "",
    ) &&
    globalNamespaceBindingIsUnmodifiedBefore("Array", referenceNode)
  ) {
    return true;
  }
  return false;
};

const callDiscardsCallbackReturn = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const scopes = currentScopes;
  if (!scopes) return false;
  const callee = stripParenExpression(callExpression.callee as EsTreeNode);
  if (isNodeOfType(callee, "Identifier")) {
    return (
      (RETURN_DISCARDING_GLOBAL_CALLBACK_NAMES.has(callee.name) ||
        callee.name === "addEventListener") &&
      isProvenGlobalNamespaceReference(callee, callee.name, scopes)
    );
  }
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (
    methodName === "addEventListener" &&
    isProvenGlobalNamespaceReference(callee.object, "window", scopes)
  ) {
    return true;
  }
  if (methodName !== "forEach") return false;
  const receiver = stripParenExpression(callee.object);
  if (isNodeOfType(receiver, "ArrayExpression")) return true;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  return isProvenBuiltInArrayReceiver(receiver, callExpression, scopes);
};

const isArrowReturnDiscarded = (arrow: EsTreeNode): boolean => {
  const parent = arrow.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "JSXExpressionContainer")) {
    const attribute = parent.parent;
    const openingElement = attribute?.parent;
    const elementName =
      openingElement && isNodeOfType(openingElement, "JSXOpeningElement")
        ? openingElement.name
        : null;
    return Boolean(
      attribute &&
      isNodeOfType(attribute, "JSXAttribute") &&
      EVENT_HANDLER_KEY_PATTERN.test(jsxAttributeName(attribute) ?? "") &&
      elementName &&
      elementName.type === "JSXIdentifier" &&
      /^[a-z]/.test(elementName.name),
    );
  }
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "CallExpression")) {
    if (parent.callee === arrow) {
      currentLocalFunctionInvocationReference = parent;
      return isDiscardedWindowHandle(parent);
    }
    if (!(parent.arguments?.some((argument) => argument === arrow) ?? false)) return false;
    return callDiscardsCallbackReturn(parent);
  }
  if (isNodeOfType(parent, "Property") && parent.value === arrow && !parent.computed) {
    const handlerKeyName = getStaticPropertyKeyName(parent);
    const propsObject = parent.parent;
    const createElementCall = propsObject?.parent;
    const createElementCallee =
      createElementCall && isNodeOfType(createElementCall, "CallExpression")
        ? stripParenExpression(createElementCall.callee as EsTreeNode)
        : null;
    const elementType =
      createElementCall && isNodeOfType(createElementCall, "CallExpression")
        ? createElementCall.arguments?.[0]
        : null;
    const isProvenIntrinsicCreateElementCall = Boolean(
      createElementCall &&
      isNodeOfType(createElementCall, "CallExpression") &&
      elementType &&
      isNodeOfType(elementType, "Literal") &&
      typeof elementType.value === "string" &&
      currentScopes &&
      (isReactApiCall(createElementCall, "createElement", currentScopes) ||
        (createElementCallee &&
          isNodeOfType(createElementCallee, "MemberExpression") &&
          getStaticPropertyName(createElementCallee) === "createElement" &&
          isProvenGlobalNamespaceReference(createElementCallee.object, "React", currentScopes))),
    );
    return Boolean(
      handlerKeyName &&
      EVENT_HANDLER_KEY_PATTERN.test(handlerKeyName) &&
      propsObject &&
      isNodeOfType(propsObject, "ObjectExpression") &&
      createElementCall &&
      isNodeOfType(createElementCall, "CallExpression") &&
      createElementCall.arguments?.[1] === propsObject &&
      isProvenIntrinsicCreateElementCall,
    );
  }
  const directCalls = collectDirectLocalFunctionCalls(arrow);
  if (directCalls?.length === 0) return true;
  if (directCalls?.every((call) => isDiscardedWindowHandle(call))) {
    currentLocalFunctionInvocationReference = directCalls.length === 1 ? directCalls[0] : undefined;
    return true;
  }
  return false;
};

const isReturnedHandleDiscarded = (returnStatement: EsTreeNode): boolean => {
  let functionNode = returnStatement.parent ?? null;
  while (functionNode && !isFunctionLike(functionNode)) functionNode = functionNode.parent ?? null;
  return functionNode !== null && isArrowReturnDiscarded(functionNode);
};

// The window handle is discarded (so `noopener`'s null return breaks
// nothing) when the call is a bare statement, a `void` operand, the
// branch of a guard-shaped logical/ternary that is itself discarded, a
// non-final position in a comma sequence, an `await` whose own result
// is discarded, or the concise
// body of a discarded arrow. Any capturing parent — VariableDeclarator
// init, AssignmentExpression right, ReturnStatement arg, a member access
// on the result, or being passed as a call argument — means the caller
// wants the handle, so we stay quiet.
const isDiscardedWindowHandle = (callNode: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(callNode);
  const parent = expressionRoot.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void") return true;
  if (isNodeOfType(parent, "AwaitExpression")) return isDiscardedWindowHandle(parent);
  if (isNodeOfType(parent, "ReturnStatement") && parent.argument === expressionRoot) {
    return isReturnedHandleDiscarded(parent);
  }
  if (isNodeOfType(parent, "LogicalExpression") && parent.right === expressionRoot) {
    return isDiscardedWindowHandle(parent);
  }
  if (
    isNodeOfType(parent, "ConditionalExpression") &&
    (parent.consequent === expressionRoot || parent.alternate === expressionRoot)
  ) {
    return isDiscardedWindowHandle(parent);
  }
  if (isNodeOfType(parent, "SequenceExpression")) {
    const finalExpression = parent.expressions?.[parent.expressions.length - 1];
    return finalExpression !== expressionRoot || isDiscardedWindowHandle(parent);
  }
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === expressionRoot) {
    return isArrowReturnDiscarded(parent);
  }
  return false;
};

export const windowOpenWithoutNoopener = defineRule({
  id: "window-open-without-noopener",
  title: "window.open without noopener",
  severity: "warn",
  recommendation:
    "Pass `'noopener'` in the third features argument of `window.open` so the opened page can't control your tab through `window.opener` or leak the referrer.",
  create: (context) => {
    currentRuleContext = context;
    currentWindowOpenCall = undefined;
    currentDestinationCoercionReference = undefined;
    currentDestinationCoercionBoundaryReference = undefined;
    currentLocalFunctionInvocationReference = undefined;
    currentLocalFunctionSerializationReference = undefined;
    currentAnalyzedLocalFunction = undefined;
    currentOpaqueLocalFunctionSerializationReference = undefined;
    currentDeferredLocalFunctions = [];
    trustedTopLevelDestinationMemo = new WeakMap();
    symbolHasPossibleWriteReferenceMemo = new WeakMap();
    localFunctionCallArgumentsMemo = new WeakMap();
    routerCallsByFunctionMemo = new WeakMap();
    globalNamespaceMutationNodesMemo = new WeakMap();
    objectMutationCallsBySymbolMemo = new WeakMap();
    currentLintedFilename =
      typeof context.filename === "string" && path.isAbsolute(context.filename)
        ? context.filename
        : undefined;
    crossFileResolutionsRemaining = CROSS_FILE_RESOLUTION_BUDGET_PER_FILE;
    crossFileResolutionMemo.clear();
    isAnalyzingForeignExport = false;
    isAnalyzingDeferredForeignExport = false;
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        currentScopes = context.scopes;
        if (!isWindowOpenCallee(node.callee, context.scopes)) return;
        const previousWindowOpenCall = currentWindowOpenCall;
        const previousDestinationCoercionReference = currentDestinationCoercionReference;
        const previousDestinationCoercionBoundaryReference =
          currentDestinationCoercionBoundaryReference;
        const previousLocalFunctionInvocationReference = currentLocalFunctionInvocationReference;
        const previousLocalFunctionSerializationReference =
          currentLocalFunctionSerializationReference;
        const previousAnalyzedLocalFunction = currentAnalyzedLocalFunction;
        const previousOpaqueLocalFunctionSerializationReference =
          currentOpaqueLocalFunctionSerializationReference;
        const previousDeferredLocalFunctions = currentDeferredLocalFunctions;
        currentWindowOpenCall = undefined;
        currentDestinationCoercionReference = undefined;
        currentDestinationCoercionBoundaryReference = undefined;
        currentLocalFunctionInvocationReference = undefined;
        currentLocalFunctionSerializationReference = undefined;
        currentAnalyzedLocalFunction = undefined;
        currentOpaqueLocalFunctionSerializationReference = undefined;
        currentDeferredLocalFunctions = [];
        try {
          if (!isDiscardedWindowHandle(node)) return;
          const enclosingFunction = findEnclosingFunction(node);
          const executionContext = enclosingFunction
            ? resolveLocalFunctionExecutionContext(enclosingFunction, 0)
            : null;
          currentDeferredLocalFunctions = executionContext?.functions ?? [];
          currentLocalFunctionInvocationReference = executionContext?.immediateReferences?.length
            ? executionContext.immediateReferences.reduce((latestReference, executionReference) =>
                executionReference.range[0] > latestReference.range[0]
                  ? executionReference
                  : latestReference,
              )
            : undefined;
          currentLocalFunctionSerializationReference = executionContext?.references?.length
            ? executionContext.references.reduce((latestReference, executionReference) =>
                executionReference.range[0] > latestReference.range[0]
                  ? executionReference
                  : latestReference,
              )
            : undefined;
          currentOpaqueLocalFunctionSerializationReference =
            !currentLocalFunctionSerializationReference && enclosingFunction
              ? (findProgramRoot(node) ?? undefined)
              : undefined;
          currentWindowOpenCall = node;

          const urlArgument = node.arguments?.[0];
          if (isTrustedTopLevelDestination(urlArgument)) return;

          const targetArgument = node.arguments?.[1];
          if (isStringLiteral(targetArgument) && NAVIGATING_TARGETS.has(targetArgument.value)) {
            return;
          }

          const featuresArgument = node.arguments?.[2];
          if (featuresArgument != null && !isNullishExpression(featuresArgument)) {
            const featuresText = resolveStaticStringText(featuresArgument, 0);
            if (featuresText == null) return;
            if (featuresMayProtectOpener(featuresText)) return;
          }

          context.report({
            node,
            message:
              "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
          });
        } finally {
          currentWindowOpenCall = previousWindowOpenCall;
          currentDestinationCoercionReference = previousDestinationCoercionReference;
          currentDestinationCoercionBoundaryReference =
            previousDestinationCoercionBoundaryReference;
          currentLocalFunctionInvocationReference = previousLocalFunctionInvocationReference;
          currentLocalFunctionSerializationReference = previousLocalFunctionSerializationReference;
          currentAnalyzedLocalFunction = previousAnalyzedLocalFunction;
          currentOpaqueLocalFunctionSerializationReference =
            previousOpaqueLocalFunctionSerializationReference;
          currentDeferredLocalFunctions = previousDeferredLocalFunctions;
        }
      },
    };
  },
});
