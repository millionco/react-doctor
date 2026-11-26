import { walkAst } from "../../../utils/walk-ast.js";
import { attachParentReferences } from "../../../utils/attach-parent-references.js";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getRuntimeSymbolReferences } from "../../../utils/get-runtime-symbol-references.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { parseSourceFile } from "../../../utils/parse-source-file.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import {
  NATIVE_EVENT_WRITER_INACTIVE_ATTRIBUTE_NAMES,
  NATIVE_EVENT_WRITER_INACTIVE_ANCESTOR_TAG_NAMES,
  NATIVE_EVENT_WRITER_UNSUPPORTED_ANCESTOR_TAG_NAMES,
} from "./constants.js";

const hasUnmodifiedComponentDefaults = (component: EsTreeNode, context: RuleContext): boolean => {
  const identifier = getFunctionBindingIdentifier(component);
  const binding = identifier && context.scopes.symbolFor(identifier);
  const program = findProgramRoot(component);
  if (!binding || !program || !hasCompleteSymbolReferences(binding, program, context.scopes))
    return false;
  return getRuntimeSymbolReferences(binding).every((reference) => {
    if (reference.flag !== "read") return false;
    const value = findTransparentExpressionRoot(reference.identifier);
    const member = value.parent;
    if (isNodeOfType(value, "JSXIdentifier")) {
      return (
        (isNodeOfType(member, "JSXOpeningElement") || isNodeOfType(member, "JSXClosingElement")) &&
        member.name === value
      );
    }
    return (
      isNodeOfType(member, "MemberExpression") &&
      member.object === value &&
      !member.computed &&
      isNodeOfType(member.property, "Identifier") &&
      (member.property.name === "displayName" || member.property.name === "propTypes")
    );
  });
};

const readNativeDefaultHost = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  component: EsTreeNode,
  context: RuleContext,
): string | null => {
  if (!isFunctionLike(component) || !isNodeOfType(component.params[0], "ObjectPattern"))
    return null;
  const binding = context.scopes.symbolFor(opening.name);
  const program = findProgramRoot(component);
  if (
    !binding ||
    binding.kind !== "parameter" ||
    !program ||
    !hasCompleteSymbolReferences(binding, program, context.scopes)
  )
    return null;
  for (const property of component.params[0].properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      property.key.name !== "as" ||
      !isNodeOfType(property.value, "AssignmentPattern") ||
      property.value.left !== binding.bindingIdentifier ||
      !isNodeOfType(property.value.right, "Literal") ||
      typeof property.value.right.value !== "string" ||
      !getRuntimeSymbolReferences(binding).every((reference) => reference.flag === "read")
    )
      continue;
    return hasUnmodifiedComponentDefaults(component, context) ? property.value.right.value : null;
  }
  return null;
};

const isUnmodifiedRestParameterSpread = (
  spread: EsTreeNodeOfType<"JSXSpreadAttribute">,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(component) || !isNodeOfType(component.params[0], "ObjectPattern"))
    return false;
  const binding = context.scopes.symbolFor(spread.argument);
  const rest = component.params[0].properties.at(-1);
  if (!binding || !isNodeOfType(rest, "RestElement") || rest.argument !== binding.bindingIdentifier)
    return false;
  const program = findProgramRoot(component);
  if (!program || !hasCompleteSymbolReferences(binding, program, context.scopes)) return false;
  const references = getRuntimeSymbolReferences(binding);
  return (
    references.length === 1 &&
    references[0].identifier === spread.argument &&
    references[0].flag === "read"
  );
};

const isDeclarativeTypeModule = (
  fromFilename: string,
  specifier: string,
  visited: ReadonlySet<string>,
): boolean => {
  const filename = resolveModulePath(fromFilename, specifier);
  if (
    !filename ||
    !filename.endsWith(".ts") ||
    filename.endsWith(".d.ts") ||
    visited.has(filename) ||
    visited.size >= 4
  )
    return false;
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program")) return false;
  const next = new Set(visited).add(filename);
  return program.body.every((statement) => {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      const source = statement.source.value;
      if (statement.importKind === "type" || source === "react") return true;
      return (
        typeof source === "string" &&
        source.startsWith(".") &&
        isDeclarativeTypeModule(filename, source, next)
      );
    }
    if (
      isNodeOfType(statement, "TSInterfaceDeclaration") ||
      isNodeOfType(statement, "TSTypeAliasDeclaration")
    )
      return true;
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) return false;
    if (statement.exportKind === "type") return true;
    return (
      !statement.source &&
      (!statement.declaration ||
        isNodeOfType(statement.declaration, "TSInterfaceDeclaration") ||
        isNodeOfType(statement.declaration, "TSTypeAliasDeclaration"))
    );
  });
};

const hasClosedRelativeContextImports = (
  node: EsTreeNode,
  filename: string,
  providerSpecifier: string,
): boolean => {
  const program = findProgramRoot(node);
  return Boolean(
    program &&
    program.body.every((statement) => {
      if (
        isNodeOfType(statement, "ExportAllDeclaration") ||
        isNodeOfType(statement, "ExportNamedDeclaration")
      ) {
        return !statement.source || statement.exportKind === "type";
      }
      if (!isNodeOfType(statement, "ImportDeclaration") || statement.importKind === "type")
        return true;
      const source = statement.source.value;
      if (typeof source !== "string") return false;
      if (source === providerSpecifier) return true;
      if (source.startsWith(".") || resolveModulePath(filename, source)) {
        return isDeclarativeTypeModule(filename, source, new Set());
      }
      return /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+$/u.test(source) && statement.specifiers.length > 0;
    }),
  );
};

const isTransparentReactContextAncestor = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: Pick<RuleContext, "filename" | "scopes">,
): boolean => {
  if (
    !context.filename ||
    !isNodeOfType(opening.name, "JSXMemberExpression") ||
    !isNodeOfType(opening.name.object, "JSXIdentifier") ||
    opening.name.property.name !== "Provider" ||
    opening.attributes.length !== 1 ||
    !isNodeOfType(opening.attributes[0], "JSXAttribute") ||
    getJsxAttributeName(opening.attributes[0].name) !== "value"
  )
    return false;
  const element = opening.parent;
  const closingName = isNodeOfType(element, "JSXElement") && element.closingElement?.name;
  const closingObject =
    closingName && isNodeOfType(closingName, "JSXMemberExpression") ? closingName.object : null;
  const openingObject = opening.name.object;
  const binding = context.scopes.symbolFor(openingObject);
  const source = binding && getValueImportSource(binding);
  const name = binding && getImportedName(binding.declarationNode);
  const program = findProgramRoot(opening);
  if (
    !binding ||
    !source?.startsWith("./") ||
    !name ||
    !program ||
    !hasCompleteSymbolReferences(binding, program, context.scopes) ||
    resolveModulePath(context.filename, "react") ||
    getRuntimeSymbolReferences(binding).some(
      ({ flag, identifier }) =>
        flag !== "read" ||
        (identifier !== openingObject &&
          identifier !== closingObject &&
          !(
            isNodeOfType(identifier.parent, "CallExpression") &&
            identifier.parent.arguments[0] === identifier &&
            isNodeOfType(identifier.parent.callee, "Identifier") &&
            isReactHookCall(identifier.parent, "useContext", context.scopes)
          )),
    )
  )
    return false;
  if (!hasClosedRelativeContextImports(opening, context.filename, source)) return false;
  const provider = resolveCrossFileValueExportWithFilePath(context.filename, source, name);
  if (
    !provider ||
    provider.filePath !== resolveModulePath(context.filename, source) ||
    resolveModulePath(provider.filePath, "react") ||
    !isNodeOfType(provider.programNode, "Program")
  )
    return false;
  const call = provider.exportedNode;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.length !== 1 ||
    !isNodeOfType(call.arguments[0], "Literal") ||
    call.arguments[0].value !== null ||
    !isNodeOfType(call.parent, "VariableDeclarator") ||
    call.parent.init !== call ||
    !isNodeOfType(call.parent.parent, "VariableDeclaration") ||
    call.parent.parent.kind !== "const" ||
    call.parent.parent.declarations.length !== 1 ||
    !isNodeOfType(call.parent.parent.parent, "ExportNamedDeclaration")
  )
    return false;
  const body = provider.programNode.body;
  const owner = call.parent.parent.parent;
  if (
    !body.every(
      (statement) =>
        statement === owner ||
        (isNodeOfType(statement, "ImportDeclaration") && statement.source.value === "react") ||
        (isNodeOfType(statement, "ExportNamedDeclaration") &&
          (isNodeOfType(statement.declaration, "TSInterfaceDeclaration") ||
            isNodeOfType(statement.declaration, "TSTypeAliasDeclaration"))),
    )
  )
    return false;
  const scopes = analyzeScopes(provider.programNode);
  const factory = scopes.symbolFor(call.callee);
  return Boolean(
    factory &&
    getValueImportSource(factory) === "react" &&
    getImportedName(factory.declarationNode) === "createContext" &&
    getRuntimeSymbolReferences(factory).every(({ flag }) => flag === "read"),
  );
};

// One reachable default native branch suffices to show that the event can
// supply independent state. Unknown wrappers still need a host proof.
export const readNativeEventWriterHost = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  eventHost: EsTreeNodeOfType<"JSXOpeningElement">,
  component: EsTreeNode,
  context: RuleContext,
): "native" | "extended" | null => {
  const isEventHost = openingElement === eventHost;
  if (!isEventHost && isTransparentReactContextAncestor(openingElement, context)) return "extended";
  const native = isProvenIntrinsicJsxElement(openingElement, context.scopes);
  const defaultTag =
    !isEventHost && !native ? readNativeDefaultHost(openingElement, component, context) : null;
  const tag = native ? resolveJsxElementType(openingElement) : defaultTag;
  if (
    !tag ||
    !HTML_TAGS.has(tag) ||
    NATIVE_EVENT_WRITER_INACTIVE_ANCESTOR_TAG_NAMES.has(tag) ||
    (!isEventHost && NATIVE_EVENT_WRITER_UNSUPPORTED_ANCESTOR_TAG_NAMES.has(tag))
  )
    return null;
  const supported = openingElement.attributes.every((attribute) => {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      return defaultTag !== null && isUnmodifiedRestParameterSpread(attribute, component, context);
    }
    return !NATIVE_EVENT_WRITER_INACTIVE_ATTRIBUTE_NAMES.has(
      getJsxAttributeName(attribute.name) ?? "",
    );
  });
  if (!supported) return null;
  return native ? "native" : "extended";
};

// Fingerprint every possible provider ancestor using the same resolver as
// linting. Linting also requires a reachable writer and a viable host path.
export const collectNativeEventWriterHostDependencies = (
  program: EsTreeNode,
  filename: string,
): void => {
  const providers: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "JSXOpeningElement") &&
      isNodeOfType(node.name, "JSXMemberExpression") &&
      node.name.property.name === "Provider"
    )
      providers.push(node);
  });
  if (providers.length === 0) return;
  attachParentReferences(program);
  const scopes = analyzeScopes(program);
  for (const provider of providers) {
    isTransparentReactContextAncestor(provider, { filename, scopes });
  }
};
