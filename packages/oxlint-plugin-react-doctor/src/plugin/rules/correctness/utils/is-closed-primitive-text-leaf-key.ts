import { parseSync } from "oxc-parser";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import {
  getReactDoctorNumberSetting,
  getReactDoctorStringSetting,
  getReactDoctorStringArraySetting,
} from "../../../utils/get-react-doctor-setting.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  TEXT_CHUNK_ARGUMENT_COUNT,
  TEXT_MAP_PARAMETER_COUNT,
  TEXT_LEAF_ATTRIBUTE_COUNT,
  TEXT_LEAF_CHILD_COUNT,
  TEXT_EMPTY_ARRAY_LENGTH,
  TEXT_REACT_MAJOR_VERSION,
  TEXT_STYLED_COMPONENTS_VERSION_PATTERN,
  TEXT_GLOBAL_CHUNK_PATTERN,
  TEXT_JSX_DIRECTIVE_PATTERN,
  TEXT_UNSUPPORTED_NODE_TYPES,
  TEXT_UNSUPPORTED_GLOBALS,
  TEXT_REFLECTION_PROPERTIES,
  TEXT_UNSUPPORTED_PROVIDER_MODULES,
} from "./primitive-text-leaf/constants.js";

interface TextMapCallback {
  readonly callback: EsTreeNodeOfType<"ArrowFunctionExpression">;
  readonly item: SymbolDescriptor;
  readonly index: SymbolDescriptor;
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly receiver: EsTreeNode;
}

interface PrimitiveTextLeafSourceProof {
  readonly source: string;
  readonly isSupported: boolean;
}

const programSupportByScopes = new WeakMap<ScopeAnalysis, boolean>();
const sourceProofByScopes = new WeakMap<ScopeAnalysis, PrimitiveTextLeafSourceProof>();

const hasOnlyReferencesAt = (symbol: SymbolDescriptor, allowed: ReadonlySet<EsTreeNode>): boolean =>
  symbol.references.filter((reference) => !isTypeScriptTypePosition(reference.identifier))
    .length === allowed.size &&
  symbol.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      (reference.flag === "read" && allowed.has(reference.identifier)),
  );

const readTextChunkMapCall = (
  node: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"CallExpression"> | null =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === TEXT_CHUNK_ARGUMENT_COUNT &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.optional &&
  !node.callee.computed &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === "map"
    ? node
    : null;

const readTextMapCallback = (
  node: EsTreeNode | null,
  context: RuleContext,
): TextMapCallback | null => {
  if (
    !isNodeOfType(node, "ArrowFunctionExpression") ||
    node.async ||
    node.generator ||
    node.params.length !== TEXT_MAP_PARAMETER_COUNT
  )
    return null;
  const [item, index] = node.params;
  if (!isNodeOfType(item, "Identifier") || !isNodeOfType(index, "Identifier")) return null;
  const call = readTextChunkMapCall(node.parent);
  const [argument] = call?.arguments ?? [];
  if (!call || argument !== node || !isNodeOfType(call.callee, "MemberExpression")) return null;
  const itemSymbol = context.scopes.symbolFor(item);
  const indexSymbol = context.scopes.symbolFor(index);
  if (
    !itemSymbol ||
    !indexSymbol ||
    itemSymbol.kind !== "parameter" ||
    indexSymbol.kind !== "parameter"
  )
    return null;
  return {
    callback: node,
    item: itemSymbol,
    index: indexSymbol,
    call,
    receiver: call.callee.object,
  };
};

const readReadonlyTextConstBinding = (
  node: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const symbol = context.scopes.symbolFor(node);
  const declaration = symbol?.declarationNode;
  return symbol &&
    getDirectConstInitializer(symbol) &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    isNodeOfType(declaration.parent, "VariableDeclaration") &&
    declaration.parent.declarations.length === TEXT_CHUNK_ARGUMENT_COUNT
    ? symbol
    : null;
};

const isDirectTagReference = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === node,
  );
};

const isStyledSpanReference = (node: EsTreeNode): boolean => {
  const member = node.parent;
  return (
    isNodeOfType(member, "MemberExpression") &&
    member.object === node &&
    !member.computed &&
    !member.optional &&
    isNodeOfType(member.property, "Identifier") &&
    member.property.name === "span" &&
    isNodeOfType(member.parent, "TaggedTemplateExpression") &&
    member.parent.tag === member
  );
};

const hasSupportedProgram = (program: EsTreeNode, context: RuleContext): boolean => {
  const cached = programSupportByScopes.get(context.scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  let hasReactValueProvider = false;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (TEXT_UNSUPPORTED_NODE_TYPES.has(node.type)) {
      supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      !isTypeScriptTypePosition(node) &&
      TEXT_UNSUPPORTED_GLOBALS.has(node.name)
    ) {
      const reference = context.scopes.referenceFor(node);
      if (
        reference &&
        (!reference.resolvedSymbol || !hasRuntimeValueBinding(reference.resolvedSymbol))
      ) {
        supported = false;
        return false;
      }
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(node, context.scopes);
      if (property === null || TEXT_REFLECTION_PROPERTIES.has(property)) {
        supported = false;
        return false;
      }
    }
    if (
      (isNodeOfType(node, "ImportSpecifier") ||
        isNodeOfType(node, "ImportDefaultSpecifier") ||
        isNodeOfType(node, "ImportNamespaceSpecifier")) &&
      isNodeOfType(node.local, "Identifier")
    ) {
      const symbol = context.scopes.symbolFor(node.local);
      const source = symbol && getValueImportSource(symbol);
      if (source && TEXT_UNSUPPORTED_PROVIDER_MODULES.has(source)) {
        supported = false;
        return false;
      }
      if (source === "react") hasReactValueProvider = true;
      if (symbol && (source === "react" || source === "styled-components")) {
        supported = symbol.references.every((reference) => {
          if (isTypeScriptTypePosition(reference.identifier)) return true;
          if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier))
            return false;
          return (
            source === "styled-components" &&
            isNodeOfType(node, "ImportDefaultSpecifier") &&
            isStyledSpanReference(reference.identifier)
          );
        });
      }
    }
    return undefined;
  });
  const isSupported = supported && hasReactValueProvider;
  programSupportByScopes.set(context.scopes, isSupported);
  return isSupported;
};

const hasSupportedTextSource = (source: string): boolean => {
  if (!TEXT_JSX_DIRECTIVE_PATTERN.test(source)) return true;
  try {
    const parsed = parseSync("primitive-text-leaf.tsx", source, { astType: "ts", lang: "tsx" });
    return (
      !parsed.errors.some((error) => error.severity === "Error") &&
      !parsed.comments.some((comment) => TEXT_JSX_DIRECTIVE_PATTERN.test(comment.value))
    );
  } catch {
    return false;
  }
};

const hasSupportedSourceAndProfile = (context: RuleContext): boolean => {
  const settings = context.settings;
  const capabilities = getReactDoctorStringArraySetting(settings, "capabilities");
  const profile = settings?.["react-doctor"];
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) return false;
  if (
    Object.getOwnPropertyDescriptor(profile, "hasReactNativeWorkspace")?.value === true ||
    Object.getOwnPropertyDescriptor(profile, "hasReactCompiler")?.value === true
  )
    return false;

  if (
    getReactDoctorNumberSetting(settings, "reactMajorVersion") !== TEXT_REACT_MAJOR_VERSION ||
    getReactDoctorStringSetting(settings, "preactVersion") ||
    getReactDoctorNumberSetting(settings, "preactMajorVersion") !== undefined ||
    TEXT_UNSUPPORTED_PROVIDER_MODULES.has(
      getReactDoctorStringSetting(settings, "framework") ?? "",
    ) ||
    capabilities.some((capability) => TEXT_UNSUPPORTED_PROVIDER_MODULES.has(capability))
  )
    return false;
  try {
    const text = context.sourceCode?.getText?.();
    if (typeof text !== "string") return false;
    const previous = sourceProofByScopes.get(context.scopes);
    if (previous?.source === text) return previous.isSupported;
    const isSupported = hasSupportedTextSource(text);
    sourceProofByScopes.set(context.scopes, { source: text, isSupported });
    return isSupported;
  } catch {
    return false;
  }
};

const isSelectedTextLeaf = (
  element: EsTreeNodeOfType<"JSXElement">,
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  const opening = element.openingElement;
  if (
    opening.attributes.length !== TEXT_LEAF_ATTRIBUTE_COUNT ||
    !opening.attributes.some((item) => item === attribute) ||
    !isNodeOfType(opening.name, "JSXIdentifier")
  )
    return false;
  if (opening.name.name === "span") return true;
  const symbol = readReadonlyTextConstBinding(opening.name, context);
  const template = symbol && getDirectConstInitializer(symbol);
  if (
    !symbol ||
    !isNodeOfType(template, "TaggedTemplateExpression") ||
    template.quasi.expressions.length !== TEXT_EMPTY_ARRAY_LENGTH ||
    template.quasi.quasis.some((quasi) => quasi.value.raw !== "") ||
    !isNodeOfType(template.tag, "MemberExpression") ||
    template.tag.computed ||
    template.tag.optional ||
    !isNodeOfType(template.tag.object, "Identifier") ||
    !isNodeOfType(template.tag.property, "Identifier") ||
    template.tag.property.name !== "span" ||
    !isNodeOfType(symbol.declarationNode.parent?.parent, "Program")
  )
    return false;
  const provider = context.scopes.symbolFor(template.tag.object);
  const styledVersion = getReactDoctorStringSetting(context.settings, "styledComponentsVersion");
  if (
    !provider ||
    getValueImportSource(provider) !== "styled-components" ||
    !isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier") ||
    !styledVersion ||
    !TEXT_STYLED_COMPONENTS_VERSION_PATTERN.test(styledVersion)
  )
    return false;
  return symbol.references.every(
    (reference) =>
      isTypeScriptTypePosition(reference.identifier) ||
      (reference.flag === "read" &&
        isDirectTagReference(reference.identifier) &&
        reference.identifier.parent?.parent === element),
  );
};

const isChunkHelper = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node);
  const declaration = symbol?.declarationNode;
  if (
    !symbol ||
    symbol.kind !== "function" ||
    !isNodeOfType(declaration, "FunctionDeclaration") ||
    declaration.async ||
    declaration.generator ||
    declaration.declare ||
    !isNodeOfType(declaration.parent, "Program") ||
    declaration.params.length !== TEXT_CHUNK_ARGUMENT_COUNT ||
    !declaration.body ||
    declaration.body.body.length !== TEXT_CHUNK_ARGUMENT_COUNT ||
    !hasOnlyReferencesAt(symbol, new Set([node]))
  )
    return false;
  const [parameter] = declaration.params;
  const [returned] = declaration.body.body;
  if (
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(parameter.typeAnnotation, "TSTypeAnnotation") ||
    !isNodeOfType(parameter.typeAnnotation.typeAnnotation, "TSStringKeyword") ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "LogicalExpression") ||
    returned.argument.operator !== "??" ||
    !isNodeOfType(returned.argument.right, "ArrayExpression") ||
    returned.argument.right.elements.length !== TEXT_EMPTY_ARRAY_LENGTH
  )
    return false;
  const match = returned.argument.left;
  if (
    !isNodeOfType(match, "CallExpression") ||
    match.optional ||
    match.arguments.length !== TEXT_CHUNK_ARGUMENT_COUNT ||
    !isNodeOfType(match.callee, "MemberExpression") ||
    match.callee.optional ||
    match.callee.computed ||
    !isNodeOfType(match.callee.object, "Identifier") ||
    !isNodeOfType(match.callee.property, "Identifier") ||
    match.callee.property.name !== "match"
  )
    return false;
  const [pattern] = match.arguments;
  const parameterSymbol = context.scopes.symbolFor(parameter);
  return Boolean(
    isNodeOfType(pattern, "Literal") &&
    "regex" in pattern &&
    pattern.regex?.flags === "g" &&
    TEXT_GLOBAL_CHUNK_PATTERN.test(pattern.regex.pattern) &&
    parameterSymbol &&
    context.scopes.symbolFor(match.callee.object) === parameterSymbol &&
    hasOnlyReferencesAt(parameterSymbol, new Set([match.callee.object])),
  );
};

export const isClosedPrimitiveTextLeafKey = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
  isStringInput: (node: EsTreeNode) => boolean,
): boolean => {
  if (
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(attribute.value.expression, "Identifier")
  )
    return false;
  const element = attribute.parent?.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const inner = readTextMapCallback(findEnclosingFunction(element), context);
  if (
    !inner ||
    stripParenExpression(inner.callback.body) !== element ||
    context.scopes.symbolFor(attribute.value.expression) !== inner.index ||
    !isNodeOfType(inner.receiver, "Identifier")
  )
    return false;
  const children = element.children.filter(
    (child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "",
  );
  const [child] = children;
  if (
    children.length !== TEXT_LEAF_CHILD_COUNT ||
    !isNodeOfType(child, "JSXExpressionContainer") ||
    !isNodeOfType(child.expression, "Identifier") ||
    context.scopes.symbolFor(child.expression) !== inner.item ||
    !hasOnlyReferencesAt(inner.item, new Set([child.expression])) ||
    !hasOnlyReferencesAt(inner.index, new Set([attribute.value.expression])) ||
    !isSelectedTextLeaf(element, attribute, context)
  )
    return false;
  const outer = readTextMapCallback(findEnclosingFunction(inner.call), context);
  if (
    !outer ||
    context.scopes.symbolFor(inner.receiver) !== outer.item ||
    !hasOnlyReferencesAt(outer.item, new Set([inner.receiver])) ||
    !isNodeOfType(outer.receiver, "Identifier")
  )
    return false;
  const groups = readReadonlyTextConstBinding(outer.receiver, context);
  const producer = groups && getDirectConstInitializer(groups);
  const producedMap = producer && readTextChunkMapCall(producer);
  if (
    !groups ||
    !producedMap ||
    !isNodeOfType(producedMap.callee, "MemberExpression") ||
    !hasOnlyReferencesAt(groups, new Set([outer.receiver])) ||
    getNodeStartIndex(groups.declarationNode) < TEXT_EMPTY_ARRAY_LENGTH ||
    getNodeStartIndex(groups.declarationNode) >= getNodeStartIndex(outer.call)
  )
    return false;
  const [pairHelper] = producedMap.arguments;
  const chunks = producedMap.callee.object;
  if (
    !pairHelper ||
    !isChunkHelper(pairHelper, context) ||
    !isNodeOfType(chunks, "CallExpression") ||
    chunks.optional ||
    !isNodeOfType(chunks.callee, "Identifier") ||
    chunks.arguments.length !== TEXT_CHUNK_ARGUMENT_COUNT ||
    !isChunkHelper(chunks.callee, context)
  )
    return false;
  const [input] = chunks.arguments;
  if (!input || !isStringInput(input)) return false;
  if (isNodeOfType(input, "Identifier")) {
    const symbol = context.scopes.symbolFor(input);
    const owner = findEnclosingFunction(groups.declarationNode);
    if (
      !symbol ||
      symbol.kind !== "parameter" ||
      !owner ||
      findEnclosingFunction(symbol.bindingIdentifier) !== owner ||
      symbol.references.some(
        (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
      )
    )
      return false;
  } else if (!isNodeOfType(input, "Literal") || typeof input.value !== "string") return false;
  const program = findProgramRoot(attribute);
  return Boolean(
    program && hasSupportedSourceAndProfile(context) && hasSupportedProgram(program, context),
  );
};
