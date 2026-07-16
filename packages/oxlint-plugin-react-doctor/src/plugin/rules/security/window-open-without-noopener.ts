import * as path from "node:path";
import { walkAst } from "../../utils/walk-ast.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
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

const NAVIGATING_TARGETS = new Set(["_self", "_top", "_parent"]);

// Matches `window.open` and `globalThis.window.open` — a non-computed
// `.open` member off the `window` global. Bare `open(...)` (an
// `Identifier` callee) and `foo.postMessage`/`webview.open` are not the
// window global and never match.
const isWindowOpenCallee = (callee: EsTreeNode): boolean => {
  const unwrappedCallee = stripParenExpression(callee);
  if (!isNodeOfType(unwrappedCallee, "MemberExpression") || unwrappedCallee.computed) return false;
  if (
    !isNodeOfType(unwrappedCallee.property, "Identifier") ||
    unwrappedCallee.property.name !== "open"
  ) {
    return false;
  }
  const object = stripParenExpression(unwrappedCallee.object);
  if (isNodeOfType(object, "Identifier")) return object.name === "window";
  if (isNodeOfType(object, "MemberExpression") && !object.computed) {
    const receiver = stripParenExpression(object.object);
    return (
      isNodeOfType(receiver, "Identifier") &&
      receiver.name === "globalThis" &&
      isNodeOfType(object.property, "Identifier") &&
      object.property.name === "window"
    );
  }
  return false;
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
  if (urlText.startsWith("/")) return !urlText.startsWith("//");
  if (SAME_ORIGIN_URL_PREFIXES.some((prefix) => urlText.startsWith(prefix))) return true;
  return BARE_RELATIVE_PATH_PREFIX_PATTERN.test(urlText);
};

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
  return startsSameOriginPath(firstQuasiText);
};

// Deep enough to resolve state-setter dataflow chains (logical fallback →
// useState binding → setter argument → const array index → local helper
// return → const element → path-builder call) while still bounding
// recursion.
const MAX_BINDING_RESOLUTION_DEPTH = 8;

// `.pathname` values are path strings, which `window.open` resolves against
// the current origin. `.origin`/`.href` are only same-origin when read off a
// location-shaped receiver (`location`, `window.location`, `getLocation()`)
// — an arbitrary `.origin` (e.g. a postMessage event's) is attacker data.
const isLocationShapedReceiver = (receiver: EsTreeNode): boolean => {
  if (isNodeOfType(receiver, "Identifier")) return receiver.name === "location";
  if (isNodeOfType(receiver, "MemberExpression") && !receiver.computed) {
    return isNodeOfType(receiver.property, "Identifier") && receiver.property.name === "location";
  }
  if (isNodeOfType(receiver, "CallExpression")) {
    const callee = receiver.callee as EsTreeNode;
    if (isNodeOfType(callee, "Identifier")) return /location/i.test(callee.name);
    if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
      return /location/i.test(callee.property.name);
    }
  }
  return false;
};

// `window.origin` (and `globalThis.window.origin`) is the same value as
// `window.location.origin` — same-origin by construction.
const isWindowGlobalReceiver = (receiver: EsTreeNode): boolean => {
  if (isNodeOfType(receiver, "Identifier")) return receiver.name === "window";
  return (
    isNodeOfType(receiver, "MemberExpression") &&
    !receiver.computed &&
    isNodeOfType(receiver.object, "Identifier") &&
    receiver.object.name === "globalThis" &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "window"
  );
};

const isSameOriginLocationRead = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return false;
  if (!isNodeOfType(node.property, "Identifier")) return false;
  if (node.property.name === "pathname") return true;
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
  return isNodeOfType(node, "Identifier") && node.name === "undefined";
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
  for (const property of objectLiteral.properties ?? []) {
    if (
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === propertyName
    ) {
      return isTrustedDestination(property.value as EsTreeNode, depth + 1);
    }
  }
  return false;
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
    !isNodeOfType(iterationCall.callee, "MemberExpression")
  ) {
    return null;
  }
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

  const constInitializer = resolveConstInitializer(receiver);
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
): boolean => {
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
  const propertyName = propertyNode.key.name;
  const objectPattern = propertyNode.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return false;
  const callbackFunction = objectPattern.parent;
  if (
    !callbackFunction ||
    !isFunctionLike(callbackFunction) ||
    !(callbackFunction.params ?? []).includes(objectPattern as never)
  ) {
    return false;
  }
  const arrayLiteral = resolveIteratedConstArrayLiteral(callbackFunction);
  if (!arrayLiteral) return false;
  return everyArrayElementSuppliesTrustedProperty(arrayLiteral, propertyName, depth);
};

// A `let url;` whose EVERY assignment in the enclosing scope is a trusted
// static literal (switch/case link pickers) cannot carry attacker data.
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
  const scopeOwner = binding.scopeOwner;
  let sawAssignment = false;
  let sawUntrustedAssignment = false;
  walkAst(scopeOwner, (child: EsTreeNode) => {
    if (sawUntrustedAssignment) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === identifier.name
    ) {
      sawAssignment = true;
      if (!isTrustedDestination(child.right as EsTreeNode, depth + 1)) {
        sawUntrustedAssignment = true;
        return false;
      }
    }
  });
  return sawAssignment && !sawUntrustedAssignment;
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
  const nameIdentifier = resolveLocalFunctionNameIdentifier(functionNode);
  if (!nameIdentifier) return null;
  const programRoot = findProgramRoot(functionNode);
  if (!programRoot) return null;
  const callArguments: Array<EsTreeNode | null> = [];
  let sawNonCallReference = false;
  walkAst(programRoot, (node: EsTreeNode) => {
    if (sawNonCallReference) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== nameIdentifier.name ||
      node === nameIdentifier
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
  if (sawNonCallReference || callArguments.length === 0) return null;
  return callArguments;
};

// `openLink('https://discord.gg/…')` — a URL that is a parameter of a local
// wrapper is trusted when every same-file call of the wrapper passes a
// trusted destination (rad-ui "Star on GitHub" idiom, one indirection away).
const isTrustedLocalWrapperParam = (
  identifier: EsTreeNodeOfType<"Identifier">,
  depth: number,
): boolean => {
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
  for (const attribute of openingElement.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (jsxAttributeName(attribute) !== "href") continue;
    const attributeValue = attribute.value as EsTreeNode | null;
    if (attributeValue == null) return false;
    if (isNodeOfType(attributeValue, "JSXExpressionContainer")) {
      return isTrustedDestination(attributeValue.expression as EsTreeNode, depth + 1);
    }
    return isTrustedStaticDestination(attributeValue);
  }
  return false;
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
      node === nameIdentifier
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
  walkAst(binding.scopeOwner, (node: EsTreeNode) => {
    if (sawUntrustedSetterUse) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== setterIdentifier.name ||
      node === setterIdentifier
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

const ROUTER_RECEIVER_NAMES = new Set(["Router", "router", "history"]);

// `e.metaKey ? window.open(href) : Router.push(href)` — feeding the same
// binding to a client-side router push/replace declares it an app-internal
// SPA route, which resolves same-origin (hyperdx cmd+click-row idiom). Bare
// `navigate(href)` does NOT qualify: any local helper can be named navigate
// and such wrappers commonly forward external URLs.
const isRouterCoNavigatedIdentifier = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  let scopeCursor: EsTreeNode | null | undefined = identifier.parent;
  let outermostFunction: EsTreeNode | null = null;
  while (scopeCursor) {
    if (isFunctionLike(scopeCursor)) outermostFunction = scopeCursor;
    scopeCursor = scopeCursor.parent ?? null;
  }
  if (!outermostFunction) return false;
  let sawRouterCoNavigation = false;
  walkAst(outermostFunction, (node: EsTreeNode) => {
    if (sawRouterCoNavigation) return false;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = node.callee;
    if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return;
    if (
      !isNodeOfType(callee.property, "Identifier") ||
      (callee.property.name !== "push" && callee.property.name !== "replace")
    ) {
      return;
    }
    const routerReceiver = stripParenExpression(callee.object as EsTreeNode);
    if (
      !isNodeOfType(routerReceiver, "Identifier") ||
      !ROUTER_RECEIVER_NAMES.has(routerReceiver.name)
    ) {
      return;
    }
    const routeArgument = (node.arguments ?? [])[0] as EsTreeNode | undefined;
    if (
      routeArgument &&
      isNodeOfType(stripParenExpression(routeArgument), "Identifier") &&
      (stripParenExpression(routeArgument) as EsTreeNodeOfType<"Identifier">).name ===
        identifier.name
    ) {
      sawRouterCoNavigation = true;
      return false;
    }
  });
  return sawRouterCoNavigation;
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

// URL constants imported from the app's own modules — SCREAMING_SNAKE
// (`CHANGELOG_URL`) or camelCase (`downloadPage`) with a URL-shaped name
// suffix — are developer-controlled configuration evaluated at module
// init, same trust class as a same-file const. Only consulted when
// cross-file verification could NOT see the actual value (see
// `crossFileImportedDestinationVerdict`); inside a foreign module an
// import stays opaque — trusting it by name would launder a value this
// analysis refused to follow.
const IMPORTED_URL_CONSTANT_NAME_PATTERN =
  /^(?:[A-Z][A-Z0-9_]*(?:URL|LINK|HREF|PAGE)|[a-z$_][A-Za-z0-9$_]*(?:Url|Link|Href|Page))$/;

const isImportedUrlConstant = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  if (isAnalyzingForeignExport) return false;
  if (!IMPORTED_URL_CONSTANT_NAME_PATTERN.test(identifier.name)) return false;
  return resolveImportedExportReference(identifier) != null;
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
const isTrustedForeignExportExpression = (foreignExpression: EsTreeNode): boolean => {
  isAnalyzingForeignExport = true;
  try {
    return isTrustedDestination(stripParenExpression(foreignExpression), 0);
  } finally {
    isAnalyzingForeignExport = false;
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
  return isTrustedForeignExportExpression(resolvedExport.node);
};

// `get…Url` / `create…Url` / `build…Url` imported helpers: the sync
// URL-builder naming family worth a cross-file look. `build…` helpers are
// otherwise opaque (they can compose arbitrary origins from arguments),
// so verifying that EVERY return is a same-origin-built URL is what turns
// the dtale `buildCorrelationsUrl` idiom quiet.
const CROSS_FILE_URL_HELPER_CALLEE_NAME_PATTERN = /^(?:get|create|build)[A-Za-z0-9]*(?:Url|URL)$/;

const isCrossFileVerifiedUrlHelperCall = (
  calleeIdentifier: EsTreeNodeOfType<"Identifier">,
): boolean => {
  if (!CROSS_FILE_URL_HELPER_CALLEE_NAME_PATTERN.test(calleeIdentifier.name)) return false;
  const resolvedExport = resolveCrossFileExportWithinBudget(calleeIdentifier);
  if (!resolvedExport || resolvedExport.kind !== "function") return false;
  const returnedExpressions = collectLocalFunctionReturnExpressions(resolvedExport.node);
  if (!returnedExpressions || returnedExpressions.length === 0) return false;
  return returnedExpressions.every((returnedExpression) =>
    isTrustedForeignExportExpression(returnedExpression),
  );
};

// `fullPath`, `menuFuncs.fullPath`, `getRelativePath` — helpers named as
// path builders return origin-less paths, which `window.open` resolves
// against the current origin.
const PATH_BUILDER_CALLEE_NAME_PATTERN = /path$/i;

// `getViewUrl`, `getSearchUrl`, `createRelativePlaygroundUrl` — sync
// getter/factory helpers building the app's own route URLs. `build…`
// helpers stay opaque: `buildUrl(externalHost, path)` composes arbitrary
// origins from its arguments.
const URL_GETTER_CALLEE_NAME_PATTERN = /^(?:get|create)[A-Za-z0-9]*(?:Url|URL)$/;

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

// `URL.createObjectURL(blob)` — a blob: URL of app-generated content; the
// opened document is same-process content, no opener hazard.
const isCreateObjectUrlCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.object, "Identifier") &&
  node.callee.object.name === "URL" &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "createObjectURL";

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
    return isTrustedStaticDestination(leftmostConcatOperand(urlArgument));
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
    return isTrustedDestination(urlArgument.callee.object as EsTreeNode, depth + 1);
  }
  if (isNodeOfType(urlArgument, "NewExpression")) {
    if (!isNodeOfType(urlArgument.callee, "Identifier") || urlArgument.callee.name !== "URL") {
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
    if (!urlArgument.computed && isTrustedConstConfigMember(urlArgument, depth + 1)) return true;
    if (!urlArgument.computed && isTrustedAnchorParamHrefRead(urlArgument, depth + 1)) return true;
    if (urlArgument.computed && isTrustedConstArrayIndexRead(urlArgument, depth + 1)) return true;
  }
  if (isNodeOfType(urlArgument, "Identifier")) {
    const crossFileVerdict = crossFileImportedDestinationVerdict(urlArgument);
    if (crossFileVerdict != null) return crossFileVerdict;
    if (isImportedUrlConstant(urlArgument)) return true;
    const constInitializer = resolveConstInitializer(urlArgument);
    if (constInitializer != null) {
      return isTrustedOrNullishDestination(constInitializer, depth + 1);
    }
    if (isLetAssignedOnlyTrustedLiterals(urlArgument, depth + 1)) return true;
    if (isTrustedLocalComponentPropLiteral(urlArgument, depth + 1)) return true;
    if (isTrustedUseStateUrlBinding(urlArgument, depth + 1)) return true;
    if (isTrustedLocalWrapperParam(urlArgument, depth + 1)) return true;
    if (isTrustedDestructuredIterationMember(urlArgument, depth + 1)) return true;
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
      return isTrustedDestination(firstExpression as EsTreeNode, depth + 1);
    }
    return false;
  }
  // `location.pathname` / `location.origin` / `getLocation().href` reads
  // are same-origin values by construction (the dtale "open in new tab"
  // idiom re-opens the current page under a different route).
  if (isSameOriginLocationRead(urlArgument)) return true;
  if (isNodeOfType(urlArgument, "CallExpression")) {
    // A helper NAMED as a path builder (`fullPath(path, dataId)`,
    // `menuFuncs.fullPath(...)`) returns a same-origin path by its own
    // contract — a "path" has no origin. A synchronous `get…Url` /
    // `create…Url` getter called with local data (`getViewUrl(view, id)`,
    // `getSearchUrl({ service })`) is the app's own route builder;
    // server-fetched external URLs arrive through `await`ed calls, which
    // stay opaque (the AwaitExpression is never trusted).
    const calleeName = terminalCalleeName(urlArgument.callee as EsTreeNode);
    if (calleeName != null) {
      if (PATH_BUILDER_CALLEE_NAME_PATTERN.test(calleeName)) return true;
      if (
        isNodeOfType(urlArgument.callee, "Identifier") &&
        URL_GETTER_CALLEE_NAME_PATTERN.test(calleeName)
      ) {
        return true;
      }
    }
    // A path-builder helper whose first argument is itself a trusted
    // same-origin destination (`fullPath('/dtale/data-export', dataId)`,
    // `buildURL(fullPath('/data', id), params)`,
    // `menuFuncs.fullPath('/dtale/popup/describe', dataId)`) returns a URL
    // for that app route.
    const firstArgument = urlArgument.arguments?.[0];
    if (firstArgument) {
      if (isStringLiteral(firstArgument as EsTreeNode)) {
        if (
          startsSameOriginPath(
            (firstArgument as EsTreeNodeOfType<"Literal"> & { value: string }).value,
          )
        ) {
          return true;
        }
      } else if (isTrustedDestination(firstArgument as EsTreeNode, depth + 1)) {
        return true;
      }
    }
    // `buildCorrelationsUrl(dataId, …)` — an imported URL-builder helper
    // is opaque by name, but when its module resolves, the call is
    // trusted if EVERY return the foreign function can produce is a
    // same-origin-built URL (dtale CorrelationsGrid idiom).
    if (
      isNodeOfType(urlArgument.callee, "Identifier") &&
      isCrossFileVerifiedUrlHelperCall(urlArgument.callee)
    ) {
      return true;
    }
    // A string method on a trusted same-origin base keeps the leading `/`
    // (`getLocation().pathname.replace('/iframe/', '/main/')`).
    const callee = urlArgument.callee as EsTreeNode;
    if (isNodeOfType(callee, "MemberExpression")) {
      return isTrustedDestination(callee.object as EsTreeNode, depth + 1);
    }
    return false;
  }
  return false;
};

const isTrustedOrNullishDestination = (
  urlExpression: EsTreeNode | null | undefined,
  depth: number,
): boolean => isNullishExpression(urlExpression) || isTrustedDestination(urlExpression, depth);

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
// strings, empty otherwise so `noopener,width=${w}` still resolves), and
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
      node.expressions?.map((expression) => resolveStaticStringText(expression, depth + 1) ?? "") ??
      [];
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

// The opened handle is captured/used when the arrow that returns it is
// stored or returned (its eventual return value may be consumed via
// `getPopup().focus()`), so a concise `() => window.open(...)` is only
// fire-and-forget when the arrow itself is an event handler (JSX prop or
// an `onX` property in a props object, whose return React/DOM ignores),
// a callback argument (forEach/map/addEventListener), or a bare
// statement.
const EVENT_HANDLER_KEY_PATTERN = /^on[A-Z]/;

const isArrowReturnDiscarded = (arrow: EsTreeNode): boolean => {
  const parent = arrow.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "JSXExpressionContainer")) return true;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "CallExpression")) {
    return parent.arguments?.some((argument) => argument === arrow) ?? false;
  }
  if (isNodeOfType(parent, "Property") && parent.value === arrow && !parent.computed) {
    const handlerKeyName = isNodeOfType(parent.key, "Identifier")
      ? parent.key.name
      : isStringLiteral(parent.key)
        ? parent.key.value
        : null;
    return handlerKeyName != null && EVENT_HANDLER_KEY_PATTERN.test(handlerKeyName);
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
  const parent = callNode.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void") return true;
  if (isNodeOfType(parent, "AwaitExpression")) return isDiscardedWindowHandle(parent);
  if (isNodeOfType(parent, "ReturnStatement") && parent.argument === callNode) {
    return isReturnedHandleDiscarded(parent);
  }
  if (isNodeOfType(parent, "LogicalExpression") && parent.right === callNode) {
    return isDiscardedWindowHandle(parent);
  }
  if (
    isNodeOfType(parent, "ConditionalExpression") &&
    (parent.consequent === callNode || parent.alternate === callNode)
  ) {
    return isDiscardedWindowHandle(parent);
  }
  if (isNodeOfType(parent, "SequenceExpression")) {
    const finalExpression = parent.expressions?.[parent.expressions.length - 1];
    return finalExpression !== callNode || isDiscardedWindowHandle(parent);
  }
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === callNode) {
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
    currentLintedFilename =
      typeof context.filename === "string" && path.isAbsolute(context.filename)
        ? context.filename
        : undefined;
    crossFileResolutionsRemaining = CROSS_FILE_RESOLUTION_BUDGET_PER_FILE;
    crossFileResolutionMemo.clear();
    isAnalyzingForeignExport = false;
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isWindowOpenCallee(node.callee)) return;
        if (!isDiscardedWindowHandle(node)) return;

        const urlArgument = node.arguments?.[0];
        if (isTrustedOrNullishDestination(urlArgument, 0)) return;

        const targetArgument = node.arguments?.[1];
        if (isStringLiteral(targetArgument) && NAVIGATING_TARGETS.has(targetArgument.value)) {
          return;
        }

        const featuresArgument = node.arguments?.[2];
        if (featuresArgument != null && !isNullishExpression(featuresArgument)) {
          const featuresText = resolveStaticStringText(featuresArgument, 0);
          if (featuresText == null) return;
          const featureNames = featuresText
            .toLowerCase()
            .split(/[\s,]+/)
            .map((featureEntry) => featureEntry.split("=")[0]);
          if (featureNames.some((name) => name === "noopener" || name === "noreferrer")) return;
        }

        context.report({
          node,
          message:
            "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
        });
      },
    };
  },
});
