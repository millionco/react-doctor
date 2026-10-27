import * as path from "node:path";
import * as fs from "node:fs";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getOwnDataObjectProperties } from "../../../utils/get-own-data-object-properties.js";
import { getStringLiteralAttributeValue } from "../../../utils/get-string-literal-attribute-value.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { hasStandardReactJsxConfiguration } from "../../../utils/resolve-tsconfig-alias.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isReadonlyReactNamespaceJsxReference } from "../../../utils/is-readonly-react-namespace-jsx-reference.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasUnindexedRuntimeSource } from "../../../utils/has-unindexed-runtime-source.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { findNearestPackageDirectory } from "../../../utils/read-nearest-package-manifest.js";
import { resolveCrossFileFunctionExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isReactHookDependencyRead } from "./is-react-hook-dependency-read.js";
import { isEventHandlerName } from "./event-handler-reference.js";
import { hasCanonicalControlPackageProfile } from "./has-canonical-control-package-profile.js";
import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";
import {
  OWN_HOOK_FIRST_INDEX,
  OWN_HOOK_SINGLE_COUNT,
  OWN_HOOK_RUNTIME_TS_NODES,
  STREAM_CHANNEL_MUTATION_METHODS,
  STREAM_CHANNEL_MUTATION_ARGUMENT_LIMIT,
  STREAM_CHANNEL_ALLOWED_API_NAMES,
  STREAM_CHANNEL_SCALAR_PROPERTIES,
  STREAM_CHANNEL_CHANNEL_LIST_PROP_NAMES,
} from "./constants.js";

interface CanonicalStreamChannelMutationInput {
  readonly expression: EsTreeNode;
  readonly context: RuleContext;
}

interface StreamChannelSourceInput {
  readonly expression: EsTreeNode;
  readonly module: AsyncEventSourceModule;
  readonly publication?: EsTreeNode;
}

interface StreamProjectionUseConstraint {
  readonly symbol: SymbolDescriptor;
  readonly literal: string;
  readonly matches: boolean;
  readonly actual: string | null;
}

interface StreamChannelOrigin {
  readonly kind:
    | "client"
    | "channel"
    | "channels"
    | "channels-promise"
    | "activate"
    | "context"
    | "borrowed-context"
    | "borrowed-channel"
    | "stream"
    | "chat"
    | "list"
    | "hook"
    | "state-hook"
    | "function"
    | "preview";
  readonly node: EsTreeNode;
  readonly module: AsyncEventSourceModule;
}

export const isCanonicalStreamChannelMutationCall = ({
  expression,
  context,
}: CanonicalStreamChannelMutationInput): boolean => {
  try {
    const call = stripParenExpression(expression);
    if (!context.filename || !isNodeOfType(call, "CallExpression") || call.optional) return false;
    const callee = stripParenExpression(call.callee);
    if (!isNodeOfType(callee, "MemberExpression") || callee.optional) return false;
    const method = getStaticPropertyName(callee);
    const receiver = stripParenExpression(callee.object);
    if (
      !method ||
      !STREAM_CHANNEL_MUTATION_METHODS.has(method) ||
      !isNodeOfType(receiver, "Identifier") ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) ||
      call.arguments.length > STREAM_CHANNEL_MUTATION_ARGUMENT_LIMIT[method] ||
      (method === "addMembers" && call.arguments.length < OWN_HOOK_SINGLE_COUNT)
    )
      return false;
    const program = context.scopes.rootScope.node;
    if (!isNodeOfType(program, "Program")) return false;
    const caller = { filename: path.resolve(context.filename), program, scopes: context.scopes };
    const readStreamImport = (raw: EsTreeNode, module: AsyncEventSourceModule): string | null => {
      const value = stripParenExpression(raw);
      if (!isNodeOfType(value, "Identifier") && !isNodeOfType(value, "JSXIdentifier")) return null;
      const symbol = module.scopes.symbolFor(value);
      const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
      const imported = getImportBindingForName(module.program, value.name);
      return symbol?.kind === "import" &&
        isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind !== "type" &&
        declaration?.importKind !== "type" &&
        imported &&
        !imported.isNamespace &&
        ((imported.source === "stream-chat" && imported.exportedName === "StreamChat") ||
          (imported.source === "stream-chat-react" &&
            imported.exportedName !== null &&
            STREAM_CHANNEL_ALLOWED_API_NAMES.has(imported.exportedName))) &&
        hasReadonlyAsyncEventBinding(symbol, module)
        ? imported.exportedName
        : null;
    };
    let cheapSymbol = caller.scopes.symbolFor(receiver);
    const cheapSeen = new Set<SymbolDescriptor>();
    while (
      cheapSymbol &&
      !cheapSeen.has(cheapSymbol) &&
      isNodeOfType(cheapSymbol.declarationNode, "VariableDeclarator") &&
      isNodeOfType(cheapSymbol.declarationNode.id, "Identifier") &&
      cheapSymbol.declarationNode.init &&
      isNodeOfType(stripParenExpression(cheapSymbol.declarationNode.init), "Identifier")
    ) {
      cheapSeen.add(cheapSymbol);
      cheapSymbol = caller.scopes.symbolFor(stripParenExpression(cheapSymbol.declarationNode.init));
    }
    const cheapDeclaration = cheapSymbol?.declarationNode;
    if (
      !cheapSymbol ||
      !isNodeOfType(cheapDeclaration, "VariableDeclarator") ||
      !isNodeOfType(cheapDeclaration.id, "ObjectPattern") ||
      !cheapDeclaration.init ||
      getDestructuredBindingPropertyName(cheapSymbol.bindingIdentifier) !== "channel"
    )
      return false;
    const cheapHook = stripParenExpression(cheapDeclaration.init);
    if (
      !isNodeOfType(cheapHook, "CallExpression") ||
      cheapHook.optional ||
      cheapHook.arguments.length !== OWN_HOOK_FIRST_INDEX ||
      readStreamImport(cheapHook.callee, caller) !== "useChatContext"
    )
      return false;
    if (
      !hasCanonicalControlPackageProfile({
        filename: caller.filename,
        packageName: "stream-chat",
      }) ||
      !hasCanonicalControlPackageProfile({
        filename: caller.filename,
        packageName: "stream-chat-react",
      })
    )
      return false;
    const root = findNearestPackageDirectory(caller.filename);
    if (!root) return false;
    const index = buildSourceProjectIndex({
      rootDirectory: root,
      currentFilePath: caller.filename,
      currentProgramNode: program,
      currentScopes: caller.scopes,
      requiredModuleSources: ["stream-chat-react"],
    });
    if (!index || index.hasOpaqueMdxConsumerSurface || hasUnindexedRuntimeSource(index))
      return false;
    const modules = [...index.modulesByFilePath.values()].map((module) => ({
      filename: module.filePath,
      program: module.programNode,
      scopes: module.scopes,
    }));
    const streamCallSites: StreamChannelSourceInput[] = [];
    const streamJsxSites: StreamChannelSourceInput[] = [];
    for (const module of modules)
      walkAst(module.program, (node) => {
        if (isNodeOfType(node, "CallExpression"))
          streamCallSites.push({ expression: node, module });
        if (isNodeOfType(node, "JSXOpeningElement"))
          streamJsxSites.push({ expression: node, module });
      });
    const hasCanonicalStreamSource = (module: AsyncEventSourceModule): boolean => {
      if (
        !hasStandardReactJsxConfiguration(module.filename, { requireUnaliasedReact: true }) ||
        hasJsxRuntimePragma({
          program: module.program,
          filename: module.filename,
          sourceText: fs.readFileSync(module.filename, "utf8"),
        })
      )
        return false;
      if (
        ["useState", "useContext", "createContext", "createElement"].some((name) =>
          hasReactDefaultProviderMutation(name, module.scopes),
        )
      )
        return false;
      let supported = true;
      walkAst(module.program, (node) => {
        if (!supported) return false;
        if (OWN_HOOK_RUNTIME_TS_NODES.has(node.type)) {
          supported = false;
          return false;
        }
        if (isTypeScriptTypePosition(node)) return false;
        if (isNodeOfType(node, "WithStatement")) supported = false;
        if (
          isNodeOfType(node, "Identifier") &&
          !isNonReferenceIdentifier(node) &&
          isProvenGlobalObjectReference(node, module.scopes)
        ) {
          const location = findTransparentExpressionRoot(node).parent;
          const reload = isNodeOfType(location, "MemberExpression")
            ? findTransparentExpressionRoot(location).parent
            : null;
          const invocation = isNodeOfType(reload, "MemberExpression")
            ? findTransparentExpressionRoot(reload).parent
            : null;
          if (
            !isNodeOfType(location, "MemberExpression") ||
            location.optional ||
            location.object !== findTransparentExpressionRoot(node) ||
            getStaticPropertyName(location) !== "location" ||
            !isNodeOfType(reload, "MemberExpression") ||
            reload.optional ||
            reload.object !== findTransparentExpressionRoot(location) ||
            getStaticPropertyName(reload) !== "reload" ||
            !isNodeOfType(invocation, "CallExpression") ||
            invocation.optional ||
            stripParenExpression(invocation.callee) !== reload ||
            invocation.arguments.length !== OWN_HOOK_FIRST_INDEX
          )
            supported = false;
        }
        if (
          isNodeOfType(node, "Identifier") &&
          !isNonReferenceIdentifier(node) &&
          isProvenGlobalNamespaceReference(node, "Promise", module.scopes)
        ) {
          const parent = findTransparentExpressionRoot(node).parent;
          const invocation = isNodeOfType(parent, "MemberExpression")
            ? findTransparentExpressionRoot(parent).parent
            : null;
          if (
            !module.scopes.isGlobalReference(node) ||
            node.name !== "Promise" ||
            !isNodeOfType(parent, "MemberExpression") ||
            parent.object !== findTransparentExpressionRoot(node) ||
            parent.optional ||
            getStaticPropertyName(parent) !== "all" ||
            !isNodeOfType(invocation, "CallExpression") ||
            invocation.optional ||
            stripParenExpression(invocation.callee) !== parent ||
            invocation.arguments.length !== OWN_HOOK_SINGLE_COUNT ||
            !isNodeOfType(
              stripParenExpression(invocation.arguments[OWN_HOOK_FIRST_INDEX]),
              "ArrayExpression",
            )
          )
            supported = false;
        }
        if (
          isNodeOfType(node, "MemberExpression") &&
          isProvenGlobalNamespaceReference(node, "Promise", module.scopes)
        )
          supported = false;
        if (
          (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) &&
          node.name === "React" &&
          !isNonReferenceIdentifier(node)
        ) {
          const symbol = module.scopes.symbolFor(node);
          const binding = getImportBindingForName(module.program, node.name);
          if (
            !symbol ||
            binding?.source !== "react" ||
            (!binding.isNamespace && binding.exportedName !== "default") ||
            !hasReadonlyAsyncEventBinding(symbol, module)
          )
            supported = false;
        }
        if (
          isNodeOfType(node, "ImportDeclaration") &&
          node.importKind !== "type" &&
          node.source.value === "react"
        )
          for (const specifier of node.specifiers) {
            if (
              !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
              !isNodeOfType(specifier, "ImportNamespaceSpecifier")
            )
              continue;
            const symbol = module.scopes.symbolFor(specifier.local);
            if (!symbol || !hasReadonlyAsyncEventBinding(symbol, module)) {
              supported = false;
              continue;
            }
            for (const reference of symbol.references) {
              if (
                reference.identifier === symbol.bindingIdentifier ||
                isNonReferenceIdentifier(reference.identifier) ||
                isTypeScriptTypePosition(reference.identifier)
              )
                continue;
              if (isReadonlyReactNamespaceJsxReference(reference.identifier, module.scopes))
                continue;
              const parent = findTransparentExpressionRoot(reference.identifier).parent;
              const invocation = isNodeOfType(parent, "MemberExpression")
                ? findTransparentExpressionRoot(parent).parent
                : null;
              if (
                !isNodeOfType(parent, "MemberExpression") ||
                parent.optional ||
                getStaticPropertyName(parent) === null ||
                isMemberMutationTarget(parent) ||
                !isNodeOfType(invocation, "CallExpression") ||
                invocation.optional ||
                stripParenExpression(invocation.callee) !== parent
              )
                supported = false;
            }
          }
        if (
          isNodeOfType(node, "CallExpression") &&
          isReactApiCall(node, "useState", module.scopes) &&
          !isProvenUnmodifiedReactApiCall(node, "useState", module.scopes)
        )
          supported = false;
        if (isNodeOfType(node, "MemberExpression")) {
          const name = getResolvedStaticPropertyName(node, module.scopes, {
            allowConstNumericLiteral: true,
            allowConstTemplateLiteral: true,
            stringifyNonStringLiterals: true,
          });
          if (["prototype", "constructor", "__proto__"].includes(name ?? "")) supported = false;
          const parent = findTransparentExpressionRoot(node).parent;
          if (
            node.computed &&
            name === null &&
            (isNodeOfType(parent, "CallExpression") ||
              isNodeOfType(parent, "NewExpression") ||
              isNodeOfType(parent, "TaggedTemplateExpression") ||
              isNodeOfType(parent, "VariableDeclarator") ||
              isNodeOfType(parent, "ReturnStatement"))
          )
            supported = false;
        }
        if (
          isNodeOfType(node, "Identifier") &&
          module.scopes.isGlobalReference(node) &&
          ["eval", "Function", "Reflect", "globalThis", "global", "require", "jest", "vi"].includes(
            node.name,
          )
        )
          supported = false;
        if (
          (isNodeOfType(node, "ExportNamedDeclaration") ||
            isNodeOfType(node, "ExportAllDeclaration")) &&
          node.source &&
          typeof node.source.value === "string" &&
          node.source.value.startsWith("stream-chat")
        )
          supported = false;
        if (
          isNodeOfType(node, "ImportExpression") &&
          (!isNodeOfType(node.source, "Literal") ||
            typeof node.source.value !== "string" ||
            node.source.value.startsWith("stream-chat"))
        )
          supported = false;
        if (
          !isNodeOfType(node, "ImportDeclaration") ||
          node.importKind === "type" ||
          typeof node.source.value !== "string" ||
          !node.source.value.startsWith("stream-chat")
        )
          return;
        if (
          node.source.value === "stream-chat-react/dist/css/index.css" &&
          node.specifiers.length === OWN_HOOK_FIRST_INDEX
        )
          return;
        if (!["stream-chat", "stream-chat-react"].includes(node.source.value)) {
          supported = false;
          return false;
        }
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          if (!readStreamImport(specifier.local, module)) supported = false;
        }
      });
      return supported;
    };
    if (!modules.every(hasCanonicalStreamSource)) return false;
    const getStreamProjectionUseConstraint = (
      reference: EsTreeNode,
      module: AsyncEventSourceModule,
      owner: EsTreeNode,
      incoming: StreamChannelSourceInput | null = null,
    ): ReadonlyArray<StreamProjectionUseConstraint> | null => {
      const guards = new Map<EsTreeNode, boolean>();
      let child = reference;
      let cursor = reference.parent;
      while (cursor && cursor !== owner) {
        if (isFunctionLike(cursor)) {
          const container = cursor.parent;
          if (
            !isNodeOfType(cursor, "ArrowFunctionExpression") ||
            !isNodeOfType(container, "JSXExpressionContainer") ||
            container.expression !== cursor ||
            !isNodeOfType(container.parent, "JSXAttribute") ||
            !isEventHandlerName(getJsxAttributeName(container.parent.name) ?? "")
          )
            return null;
        }
        if (
          isNodeOfType(cursor, "IfStatement") &&
          (cursor.consequent === child || cursor.alternate === child)
        )
          guards.set(cursor.test, cursor.consequent === child);
        if (isNodeOfType(cursor, "BlockStatement") && findEnclosingFunction(cursor) === owner) {
          const position = cursor.body.findIndex((statement) => statement === child);
          for (const preceding of cursor.body.slice(
            OWN_HOOK_FIRST_INDEX,
            Math.max(position, OWN_HOOK_FIRST_INDEX),
          )) {
            if (!isNodeOfType(preceding, "IfStatement") || preceding.alternate) continue;
            const returned =
              isNodeOfType(preceding.consequent, "BlockStatement") &&
              preceding.consequent.body.length === OWN_HOOK_SINGLE_COUNT
                ? preceding.consequent.body[OWN_HOOK_FIRST_INDEX]
                : preceding.consequent;
            if (isNodeOfType(returned, "ReturnStatement")) guards.set(preceding.test, false);
          }
        }
        child = cursor;
        cursor = cursor.parent;
      }
      if (cursor !== owner) return null;
      const constraints: StreamProjectionUseConstraint[] = [];
      for (const [rawTest, positive] of guards) {
        const test = stripParenExpression(rawTest);
        if (!isNodeOfType(test, "BinaryExpression") || !["===", "!=="].includes(test.operator))
          continue;
        const left = stripParenExpression(test.left);
        const right = stripParenExpression(test.right);
        const identifier = isNodeOfType(left, "Identifier") ? left : right;
        const literal = isNodeOfType(left, "Identifier") ? right : left;
        if (
          !isNodeOfType(identifier, "Identifier") ||
          !isNodeOfType(literal, "Literal") ||
          typeof literal.value !== "string"
        )
          continue;
        const symbol = module.scopes.symbolFor(identifier);
        const property = symbol?.bindingIdentifier.parent;
        if (
          !symbol ||
          symbol.kind !== "parameter" ||
          !hasReadonlyAsyncEventBinding(symbol, module) ||
          findEnclosingFunction(symbol.bindingIdentifier) !== owner ||
          !isNodeOfType(property, "Property") ||
          !isNodeOfType(property.parent, "ObjectPattern") ||
          !isFunctionLike(owner) ||
          !owner.params.some((parameter) => parameter === property.parent)
        )
          continue;
        const field = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
        if (!field) continue;
        let actual: string | null = null;
        if (incoming) {
          const publication = incoming.publication;
          if (isNodeOfType(publication, "JSXOpeningElement")) {
            if (
              publication.attributes.some((attribute) =>
                isNodeOfType(attribute, "JSXSpreadAttribute"),
              )
            )
              return null;
            const attributes = publication.attributes.filter(
              (attribute) =>
                isNodeOfType(attribute, "JSXAttribute") &&
                getJsxAttributeName(attribute.name) === field,
            );
            if (attributes.length !== OWN_HOOK_SINGLE_COUNT) return null;
            actual = getStringLiteralAttributeValue(attributes[OWN_HOOK_FIRST_INDEX]);
          } else if (isNodeOfType(publication, "CallExpression")) {
            const position = owner.params.findIndex((parameter) => parameter === property.parent);
            const argument = publication.arguments[position];
            const properties = argument
              ? getOwnDataObjectProperties(stripParenExpression(argument))
              : null;
            const value = properties?.get(field);
            const selected = value ? stripParenExpression(value) : null;
            if (isNodeOfType(selected, "Literal") && typeof selected.value === "string")
              actual = selected.value;
          }
          if (actual === null) return null;
        }
        constraints.push({
          symbol,
          literal: literal.value,
          matches: positive === (test.operator === "==="),
          actual,
        });
      }
      return constraints;
    };
    const getStreamProjectionSource = (
      identifier: EsTreeNode,
      module: AsyncEventSourceModule,
      seen: ReadonlySet<EsTreeNode>,
    ): ReadonlyArray<StreamChannelSourceInput> | null => {
      const symbol = module.scopes.symbolFor(identifier);
      if (!symbol || symbol.kind !== "parameter") return null;
      const owner = findEnclosingFunction(symbol.bindingIdentifier);
      if (
        !owner ||
        !isFunctionLike(owner) ||
        (owner.async && !isNodeOfType(owner.body, "BlockStatement"))
      )
        return null;
      let parameter = symbol.bindingIdentifier;
      let field: string | null = null;
      if (
        isNodeOfType(parameter.parent, "Property") &&
        parameter.parent.value === parameter &&
        isNodeOfType(parameter.parent.parent, "ObjectPattern")
      ) {
        const pattern = parameter.parent.parent;
        if (
          !pattern.properties.every(
            (property) =>
              isNodeOfType(property, "Property") &&
              !property.computed &&
              !property.method &&
              property.kind === "init" &&
              isNodeOfType(property.value, "Identifier"),
          )
        )
          return null;
        field = getDestructuredBindingPropertyName(parameter);
        parameter = pattern;
      }
      const position = owner.params.findIndex((candidate) => candidate === parameter);
      if (position < OWN_HOOK_FIRST_INDEX) return null;
      for (const binding of getFunctionBindingSymbols(owner, module.scopes)) {
        if (!hasReadonlyAsyncEventBinding(binding, module)) return null;
        for (const reference of binding.references) {
          const value = findTransparentExpressionRoot(reference.identifier);
          const parent = value.parent;
          if (
            (isNodeOfType(parent, "CallExpression") &&
              stripParenExpression(parent.callee) === reference.identifier) ||
            ((isNodeOfType(parent, "JSXOpeningElement") ||
              isNodeOfType(parent, "JSXClosingElement")) &&
              parent.name === value) ||
            (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === value) ||
            (isNodeOfType(parent, "ExportSpecifier") && parent.local === value)
          )
            continue;
          if (
            (isNodeOfType(parent, "JSXExpressionContainer") &&
              isNodeOfType(parent.parent, "JSXAttribute")) ||
            (isNodeOfType(parent, "Property") && parent.value === value)
          ) {
            if (
              hasClosedStreamValueReads(binding, module, { kind: "function", node: owner, module })
            )
              continue;
          }
          return null;
        }
      }
      const sources: StreamChannelSourceInput[] = [];
      const useConstraints = getStreamProjectionUseConstraint(identifier, module, owner);
      let complete = true;
      for (const site of streamCallSites) {
        const node = site.expression;
        const candidateModule = site.module;
        if (!isNodeOfType(node, "CallExpression") || node.optional) continue;
        const target = resolveStreamValueOrigin(node.callee, candidateModule, seen);
        if (
          target?.kind !== "function" ||
          target.module.filename !== module.filename ||
          target.node !== owner
        )
          continue;
        const raw = node.arguments[position];
        if (!raw || isNodeOfType(raw, "SpreadElement")) {
          complete = false;
          continue;
        }
        if (useConstraints?.length) {
          const constraints = getStreamProjectionUseConstraint(identifier, module, owner, {
            expression: raw,
            module: candidateModule,
            publication: node,
          });
          if (!constraints) {
            complete = false;
            continue;
          }
          if (
            constraints.some(
              (constraint) => (constraint.actual === constraint.literal) !== constraint.matches,
            )
          )
            continue;
        }
        if (!field) sources.push({ expression: raw, module: candidateModule, publication: node });
        else {
          const props = getOwnDataObjectProperties(stripParenExpression(raw));
          const selected = props?.get(field);
          if (selected)
            sources.push({ expression: selected, module: candidateModule, publication: node });
          else complete = false;
        }
      }
      if (field)
        for (const site of streamJsxSites) {
          const node = site.expression;
          const candidateModule = site.module;
          if (!isNodeOfType(node, "JSXOpeningElement") || !isNodeOfType(node.name, "JSXIdentifier"))
            continue;
          const target = resolveStreamValueOrigin(node.name, candidateModule, seen);
          if (
            target?.kind !== "function" ||
            target.module.filename !== module.filename ||
            target.node !== owner
          )
            continue;
          if (useConstraints?.length) {
            const constraints = getStreamProjectionUseConstraint(identifier, module, owner, {
              expression: node,
              module: candidateModule,
              publication: node,
            });
            if (!constraints) {
              complete = false;
              continue;
            }
            if (
              constraints.some(
                (constraint) => (constraint.actual === constraint.literal) !== constraint.matches,
              )
            )
              continue;
          }
          let selected: StreamChannelSourceInput | null = null;
          for (const attribute of node.attributes) {
            if (
              isNodeOfType(attribute, "JSXAttribute") &&
              getJsxAttributeName(attribute.name) === field
            )
              selected =
                attribute.value && isNodeOfType(attribute.value, "JSXExpressionContainer")
                  ? {
                      expression: attribute.value.expression,
                      module: candidateModule,
                      publication: node,
                    }
                  : null;
            if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
              const origin = resolveStreamValueOrigin(attribute.argument, candidateModule, seen);
              if (origin?.kind === "preview" && ["channel", "setActiveChannel"].includes(field))
                selected = {
                  expression: attribute.argument,
                  module: candidateModule,
                  publication: node,
                };
              else {
                const props = getOwnDataObjectProperties(stripParenExpression(attribute.argument));
                if (!props) selected = null;
                else if (props.has(field))
                  selected = {
                    expression: props.get(field)!,
                    module: candidateModule,
                    publication: node,
                  };
              }
            }
          }
          if (selected) sources.push(selected);
          else complete = false;
        }
      return complete && sources.length ? sources : null;
    };
    const streamOriginCache = new WeakMap<EsTreeNode, StreamChannelOrigin | null>();
    const resolveStreamValueOrigin = (
      raw: EsTreeNode,
      module: AsyncEventSourceModule,
      seen: ReadonlySet<EsTreeNode> = new Set(),
    ): StreamChannelOrigin | null => {
      const value = stripParenExpression(raw);
      if (seen.has(value)) return null;
      if (streamOriginCache.has(value)) return streamOriginCache.get(value) ?? null;
      streamOriginCache.set(value, null);
      const result = computeStreamValueOrigin(value, module, seen);
      streamOriginCache.set(value, result);
      return result;
    };
    const computeStreamValueOrigin = (
      raw: EsTreeNode,
      module: AsyncEventSourceModule,
      seen: ReadonlySet<EsTreeNode> = new Set(),
    ): StreamChannelOrigin | null => {
      const value = stripParenExpression(raw);
      if (seen.has(value)) return null;
      const next = new Set(seen);
      next.add(value);
      if (isNodeOfType(value, "AwaitExpression")) {
        const result = resolveStreamValueOrigin(value.argument, module, next);
        return result?.kind === "channels-promise" ? { ...result, kind: "channels" } : result;
      }
      if (isFunctionLike(value)) return { kind: "function", node: value, module };
      if (isNodeOfType(value, "Identifier") || isNodeOfType(value, "JSXIdentifier")) {
        const imported = readStreamImport(value, module);
        if (imported) {
          const kinds: Readonly<Record<string, StreamChannelOrigin["kind"]>> = {
            StreamChat: "stream",
            Chat: "chat",
            ChannelList: "list",
            useChatContext: "hook",
            useChannelStateContext: "state-hook",
          };
          return kinds[imported] ? { kind: kinds[imported], node: value, module } : null;
        }
        const symbol = module.scopes.symbolFor(value);
        if (!symbol || !hasReadonlyAsyncEventBinding(symbol, module)) return null;
        if (symbol.kind === "import") {
          const binding = getImportBindingForName(module.program, value.name);
          if (!binding || binding.isNamespace || binding.exportedName === null) return null;
          const resolved = resolveCrossFileFunctionExportWithFilePath(
            module.filename,
            binding.source,
            binding.exportedName,
            { requireCompleteReexports: true },
          );
          const target = resolved
            ? modules.find((candidate) => candidate.filename === resolved.filePath)
            : null;
          if (!resolved?.contexts?.length || !target) return null;
          let actual: EsTreeNode | null = null;
          walkAst(target.program, (node) => {
            if (
              isFunctionLike(node) &&
              node.range[OWN_HOOK_FIRST_INDEX] ===
                resolved.functionNode.range[OWN_HOOK_FIRST_INDEX] &&
              node.range[OWN_HOOK_SINGLE_COUNT] ===
                resolved.functionNode.range[OWN_HOOK_SINGLE_COUNT]
            )
              actual = node;
          });
          return actual ? { kind: "function", node: actual, module: target } : null;
        }
        if (symbol.kind === "parameter") {
          const owner = findEnclosingFunction(symbol.bindingIdentifier);
          const parent = owner?.parent;
          if (
            owner &&
            isFunctionLike(owner) &&
            owner.params[OWN_HOOK_FIRST_INDEX] === symbol.bindingIdentifier
          ) {
            if (
              isNodeOfType(parent, "CallExpression") &&
              parent.arguments[OWN_HOOK_FIRST_INDEX] === owner &&
              isNodeOfType(parent.callee, "MemberExpression") &&
              getStaticPropertyName(parent.callee) === "map" &&
              resolveStreamValueOrigin(parent.callee.object, module, next)?.kind === "channels"
            )
              return { kind: "channel", node: value, module };
            if (
              isNodeOfType(parent, "JSXExpressionContainer") &&
              isNodeOfType(parent.parent, "JSXAttribute") &&
              getJsxAttributeName(parent.parent.name) === "Preview" &&
              isNodeOfType(parent.parent.parent, "JSXOpeningElement") &&
              resolveStreamValueOrigin(parent.parent.parent.name, module, next)?.kind === "list"
            )
              return { kind: "preview", node: value, module };
          }
          const sources = getStreamProjectionSource(value, module, next);
          if (!sources) return null;
          const field = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
          const origins = sources.map((source): StreamChannelOrigin | null => {
            const result = resolveStreamValueOrigin(source.expression, source.module, next);
            return result?.kind === "preview" && field
              ? {
                  ...result,
                  kind:
                    field === "channel"
                      ? "channel"
                      : field === "setActiveChannel"
                        ? "activate"
                        : result.kind,
                }
              : result;
          });
          const first = origins[OWN_HOOK_FIRST_INDEX];
          return first &&
            origins.every(
              (result) =>
                result?.kind === first.kind &&
                (first.kind !== "function" || result.node === first.node),
            )
            ? first
            : null;
        }
        if (symbol.kind === "function" && isFunctionLike(symbol.declarationNode))
          return { kind: "function", node: symbol.declarationNode, module };
        const declaration = symbol.declarationNode;
        if (
          symbol.kind !== "const" ||
          !isNodeOfType(declaration, "VariableDeclarator") ||
          !declaration.init
        )
          return null;
        if (declaration.id === symbol.bindingIdentifier)
          return resolveStreamValueOrigin(declaration.init, module, next);
        const field = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
        if (field && isNodeOfType(declaration.id, "ObjectPattern")) {
          const source = resolveStreamValueOrigin(declaration.init, module, next);
          if (source?.kind === "context")
            return ["channel", "client", "setActiveChannel"].includes(field)
              ? {
                  kind:
                    field === "setActiveChannel"
                      ? "activate"
                      : field === "client"
                        ? "client"
                        : "channel",
                  node: value,
                  module,
                }
              : null;
          if (source?.kind === "borrowed-context" && field === "channel")
            return { kind: "borrowed-channel", node: value, module };
          const props = getOwnDataObjectProperties(stripParenExpression(declaration.init));
          return props?.get(field)
            ? resolveStreamValueOrigin(props.get(field)!, module, next)
            : null;
        }
        if (!isNodeOfType(declaration.id, "ArrayPattern")) return null;
        const position = declaration.id.elements.findIndex(
          (candidate) => candidate === symbol.bindingIdentifier,
        );
        const initial = stripParenExpression(declaration.init);
        if (
          isNodeOfType(initial, "CallExpression") &&
          isProvenUnmodifiedReactApiCall(initial, "useState", module.scopes) &&
          position === OWN_HOOK_FIRST_INDEX
        ) {
          const empty = initial.arguments[OWN_HOOK_FIRST_INDEX];
          const setter = declaration.id.elements[OWN_HOOK_SINGLE_COUNT];
          if (
            !isNodeOfType(empty, "ArrayExpression") ||
            empty.elements.length !== OWN_HOOK_FIRST_INDEX ||
            !isNodeOfType(setter, "Identifier")
          )
            return null;
          const dispatcher = module.scopes.symbolFor(setter);
          let hasChannels = false;
          if (!dispatcher || !hasReadonlyAsyncEventBinding(dispatcher, module)) return null;
          for (const reference of dispatcher.references) {
            if (
              reference.identifier === dispatcher.bindingIdentifier ||
              isNonReferenceIdentifier(reference.identifier) ||
              isTypeScriptTypePosition(reference.identifier)
            )
              continue;
            const invocation = findTransparentExpressionRoot(reference.identifier).parent;
            if (
              !isNodeOfType(invocation, "CallExpression") ||
              stripParenExpression(invocation.callee) !== reference.identifier ||
              invocation.arguments.length !== OWN_HOOK_SINGLE_COUNT
            )
              return null;
            const argument = stripParenExpression(invocation.arguments[OWN_HOOK_FIRST_INDEX]);
            if (
              isNodeOfType(argument, "ArrayExpression") &&
              argument.elements.length === OWN_HOOK_FIRST_INDEX
            )
              continue;
            if (resolveStreamValueOrigin(argument, module, next)?.kind !== "channels") return null;
            hasChannels = true;
          }
          return hasChannels ? { kind: "channels", node: value, module } : null;
        }
        if (isNodeOfType(initial, "AwaitExpression")) {
          const argument = stripParenExpression(initial.argument);
          if (
            isNodeOfType(argument, "CallExpression") &&
            isNodeOfType(argument.callee, "MemberExpression") &&
            getStaticPropertyName(argument.callee) === "all" &&
            isNodeOfType(stripParenExpression(argument.callee.object), "Identifier")
          ) {
            const promise = stripParenExpression(argument.callee.object);
            if (
              isNodeOfType(promise, "Identifier") &&
              promise.name === "Promise" &&
              module.scopes.isGlobalReference(promise) &&
              argument.arguments.length === OWN_HOOK_SINGLE_COUNT &&
              isNodeOfType(argument.arguments[OWN_HOOK_FIRST_INDEX], "ArrayExpression")
            ) {
              const selected = argument.arguments[OWN_HOOK_FIRST_INDEX].elements[position];
              const result = selected ? resolveStreamValueOrigin(selected, module, next) : null;
              return result?.kind === "channels-promise" ? { ...result, kind: "channels" } : null;
            }
          }
        }
        return resolveStreamValueOrigin(declaration.init, module, next)?.kind === "channels"
          ? { kind: "channel", node: value, module }
          : null;
      }
      if (
        !isNodeOfType(value, "CallExpression") ||
        value.optional ||
        value.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      )
        return null;
      const target = resolveStreamValueOrigin(value.callee, module, next);
      if (target?.kind === "hook" && value.arguments.length === OWN_HOOK_FIRST_INDEX)
        return { kind: "context", node: value, module };
      if (target?.kind === "state-hook" && value.arguments.length === OWN_HOOK_FIRST_INDEX)
        return { kind: "borrowed-context", node: value, module };
      const callee = stripParenExpression(value.callee);
      if (!isNodeOfType(callee, "MemberExpression") || callee.optional) return null;
      const origin = resolveStreamValueOrigin(callee.object, module, next);
      const name = getStaticPropertyName(callee);
      if (
        origin?.kind === "stream" &&
        name === "getInstance" &&
        value.arguments.length === OWN_HOOK_SINGLE_COUNT
      )
        return { kind: "client", node: value, module };
      if (origin?.kind === "client" && name === "channel")
        return { kind: "channel", node: value, module };
      if (origin?.kind === "client" && name === "queryChannels")
        return { kind: "channels-promise", node: value, module };
      return null;
    };
    const hasClosedStreamValueReads = (
      symbol: SymbolDescriptor,
      module: AsyncEventSourceModule,
      protectedFunction: StreamChannelOrigin | null = null,
      visited: ReadonlySet<SymbolDescriptor> = new Set(),
      channelInput: StreamChannelSourceInput | null = null,
    ): boolean => {
      if (visited.has(symbol)) return false;
      const next = new Set(visited);
      next.add(symbol);
      const origin: StreamChannelOrigin | null = channelInput
        ? { kind: "channel", node: symbol.bindingIdentifier, module }
        : (protectedFunction ?? resolveStreamValueOrigin(symbol.bindingIdentifier, module));
      if (
        !origin ||
        (![
          "channel",
          "borrowed-channel",
          "client",
          "activate",
          "stream",
          "context",
          "preview",
          "hook",
          "state-hook",
          "chat",
          "list",
          "channels",
          "channels-promise",
        ].includes(origin.kind) &&
          !protectedFunction)
      )
        return true;
      if (!hasReadonlyAsyncEventBinding(symbol, module)) return false;
      const allowed = new Set<EsTreeNode>();
      for (const reference of symbol.references) {
        if (
          isNonReferenceIdentifier(reference.identifier) ||
          isTypeScriptTypePosition(reference.identifier)
        )
          continue;
        const value = findTransparentExpressionRoot(reference.identifier);
        const parent = value.parent;
        if (channelInput) {
          const owner = findEnclosingFunction(symbol.bindingIdentifier);
          const constraints = owner
            ? getStreamProjectionUseConstraint(reference.identifier, module, owner, channelInput)
            : null;
          if (!constraints) return false;
          if (
            constraints.some(
              (constraint) => (constraint.actual === constraint.literal) !== constraint.matches,
            )
          ) {
            allowed.add(reference.identifier);
            continue;
          }
        }
        if (isReactHookDependencyRead(value, module.scopes)) {
          allowed.add(reference.identifier);
          continue;
        }
        if (
          ["client", "channel", "borrowed-channel"].includes(origin.kind) &&
          (((isNodeOfType(parent, "IfStatement") ||
            isNodeOfType(parent, "ConditionalExpression")) &&
            parent.test === value) ||
            (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!"))
        ) {
          allowed.add(reference.identifier);
          continue;
        }
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "Identifier") &&
          isNodeOfType(parent.parent, "VariableDeclaration") &&
          parent.parent.kind === "const"
        ) {
          const alias = module.scopes.symbolFor(parent.id);
          if (
            (protectedFunction || channelInput) &&
            (!alias ||
              !hasClosedStreamValueReads(alias, module, protectedFunction, next, channelInput))
          )
            return false;
          allowed.add(reference.identifier);
          continue;
        }
        if (origin.kind === "channels-promise") {
          if (isNodeOfType(parent, "AwaitExpression") && parent.argument === value) {
            allowed.add(reference.identifier);
            continue;
          }
          const invocation = isNodeOfType(parent, "ArrayExpression")
            ? findTransparentExpressionRoot(parent).parent
            : null;
          const callee = isNodeOfType(invocation, "CallExpression")
            ? stripParenExpression(invocation.callee)
            : null;
          if (
            isNodeOfType(parent, "ArrayExpression") &&
            isNodeOfType(invocation, "CallExpression") &&
            !invocation.optional &&
            invocation.arguments.length === OWN_HOOK_SINGLE_COUNT &&
            stripParenExpression(invocation.arguments[OWN_HOOK_FIRST_INDEX]) === parent &&
            isNodeOfType(callee, "MemberExpression") &&
            !callee.optional &&
            getStaticPropertyName(callee) === "all" &&
            isNodeOfType(stripParenExpression(callee.object), "Identifier") &&
            isProvenGlobalNamespaceReference(callee.object, "Promise", module.scopes)
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          return false;
        }
        if (
          isNodeOfType(parent, "CallExpression") &&
          !parent.optional &&
          parent.arguments.length === OWN_HOOK_SINGLE_COUNT &&
          stripParenExpression(parent.arguments[OWN_HOOK_FIRST_INDEX]) === reference.identifier
        ) {
          if (
            origin.kind === "channel" &&
            resolveStreamValueOrigin(parent.callee, module)?.kind === "activate"
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          const target = resolveStreamValueOrigin(parent.callee, module);
          const parameter =
            target?.kind === "function" &&
            isFunctionLike(target.node) &&
            target.node.params.length === OWN_HOOK_SINGLE_COUNT
              ? target.node.params[OWN_HOOK_FIRST_INDEX]
              : null;
          if (
            target &&
            isNodeOfType(parameter, "Identifier") &&
            resolveStreamValueOrigin(parameter, target.module)?.kind === origin.kind
          ) {
            const binding = target.module.scopes.symbolFor(parameter);
            if (
              !protectedFunction ||
              (binding &&
                hasClosedStreamValueReads(binding, target.module, protectedFunction, next))
            ) {
              allowed.add(reference.identifier);
              continue;
            }
          }
          if (
            origin.kind === "channels" &&
            isNodeOfType(stripParenExpression(parent.callee), "Identifier")
          ) {
            const dispatcher = module.scopes.symbolFor(stripParenExpression(parent.callee));
            const declaration = dispatcher?.declarationNode;
            const initializer =
              isNodeOfType(declaration, "VariableDeclarator") && declaration.init
                ? stripParenExpression(declaration.init)
                : null;
            if (
              dispatcher &&
              hasReadonlyAsyncEventBinding(dispatcher, module) &&
              isNodeOfType(declaration, "VariableDeclarator") &&
              isNodeOfType(declaration.id, "ArrayPattern") &&
              declaration.id.elements[OWN_HOOK_SINGLE_COUNT] === dispatcher.bindingIdentifier &&
              isNodeOfType(initializer, "CallExpression") &&
              isProvenUnmodifiedReactApiCall(initializer, "useState", module.scopes)
            ) {
              const state = declaration.id.elements[OWN_HOOK_FIRST_INDEX];
              if (state && resolveStreamValueOrigin(state, module)?.kind === "channels") {
                allowed.add(reference.identifier);
                continue;
              }
            }
          }
        }
        if (
          isNodeOfType(parent, "CallExpression") &&
          !parent.optional &&
          stripParenExpression(parent.callee) === reference.identifier
        ) {
          if (
            protectedFunction &&
            origin.kind === "function" &&
            !parent.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          if (
            origin.kind === "activate" &&
            parent.arguments.length === OWN_HOOK_SINGLE_COUNT &&
            resolveStreamValueOrigin(parent.arguments[OWN_HOOK_FIRST_INDEX], module)?.kind ===
              "channel"
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          if (
            ["hook", "state-hook"].includes(origin.kind) &&
            parent.arguments.length === OWN_HOOK_FIRST_INDEX
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          return false;
        }
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === value &&
          !isMemberMutationTarget(parent)
        ) {
          const name = getStaticPropertyName(parent);
          const invocation = findTransparentExpressionRoot(parent).parent;
          if (!name) return false;
          if (
            origin.kind === "stream" &&
            name === "getInstance" &&
            isNodeOfType(invocation, "CallExpression") &&
            !invocation.optional &&
            invocation.arguments.length === OWN_HOOK_SINGLE_COUNT &&
            !invocation.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) &&
            stripParenExpression(invocation.callee) === parent
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          if (
            ["channel", "borrowed-channel"].includes(origin.kind) &&
            ["data", "id", "cid", "type", "state"].includes(name)
          ) {
            let outer: EsTreeNode = parent;
            while (
              isNodeOfType(outer.parent, "MemberExpression") &&
              outer.parent.object === outer
            ) {
              const key = getStaticPropertyName(outer.parent);
              if (!key || key.startsWith("_")) return false;
              outer = outer.parent;
            }
            if (
              isMemberMutationTarget(outer) ||
              (outer === parent && ["data", "state"].includes(name))
            )
              return false;
            allowed.add(reference.identifier);
            continue;
          }
          if (
            origin.kind === "channels" &&
            (name === "length" ||
              (name === "map" &&
                isNodeOfType(invocation, "CallExpression") &&
                stripParenExpression(invocation.callee) === parent))
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          if (
            (origin.kind === "client" && STREAM_CHANNEL_SCALAR_PROPERTIES.has(name)) ||
            (["channel", "borrowed-channel"].includes(origin.kind) &&
              (STREAM_CHANNEL_MUTATION_METHODS.has(name) ||
                ["watch", "getConfig", "countUnread"].includes(name)))
          ) {
            if (
              (isNodeOfType(invocation, "CallExpression") &&
                stripParenExpression(invocation.callee) === parent) ||
              (origin.kind === "client" && ["userID", "user"].includes(name))
            ) {
              allowed.add(reference.identifier);
              continue;
            }
          }
          return false;
        }
        if (isNodeOfType(parent, "JSXAttribute") && ["chat", "list"].includes(origin.kind))
          return false;
        if (
          isNodeOfType(parent, "JSXOpeningElement") ||
          isNodeOfType(parent, "JSXClosingElement")
        ) {
          if (["chat", "list"].includes(origin.kind) && parent.name === value) {
            allowed.add(reference.identifier);
            continue;
          }
          return false;
        }
        if (
          isNodeOfType(parent, "JSXExpressionContainer") &&
          isNodeOfType(parent.parent, "JSXAttribute") &&
          isNodeOfType(parent.parent.parent, "JSXOpeningElement")
        ) {
          const opening = parent.parent.parent;
          const target = resolveStreamValueOrigin(opening.name, module);
          if (
            origin.kind === "client" &&
            target?.kind === "chat" &&
            getJsxAttributeName(parent.parent.name) === "client"
          ) {
            allowed.add(reference.identifier);
            continue;
          }
          if (
            target?.kind === "function" &&
            isFunctionLike(target.node) &&
            target.node.params.length === OWN_HOOK_SINGLE_COUNT &&
            isNodeOfType(target.node.params[OWN_HOOK_FIRST_INDEX], "ObjectPattern")
          ) {
            const key = getJsxAttributeName(parent.parent.name);
            const property = target.node.params[OWN_HOOK_FIRST_INDEX].properties.find(
              (property) =>
                isNodeOfType(property, "Property") &&
                !property.computed &&
                !property.method &&
                property.kind === "init" &&
                isNodeOfType(property.value, "Identifier") &&
                getDestructuredBindingPropertyName(property.value) === key,
            );
            if (origin.kind === "channel" && isNodeOfType(property, "Property")) {
              const parameter = target.module.scopes.symbolFor(property.value);
              if (
                parameter &&
                hasClosedStreamValueReads(parameter, target.module, null, next, {
                  expression: reference.identifier,
                  module,
                  publication: opening,
                })
              ) {
                allowed.add(reference.identifier);
                continue;
              }
            }
            if (
              isNodeOfType(property, "Property") &&
              resolveStreamValueOrigin(property.value, target.module)?.kind === origin.kind
            ) {
              const parameter = target.module.scopes.symbolFor(property.value);
              if (
                protectedFunction &&
                (!parameter ||
                  !hasClosedStreamValueReads(parameter, target.module, protectedFunction, next))
              )
                return false;
              allowed.add(reference.identifier);
              continue;
            }
          }
        }
        if (
          isNodeOfType(parent, "Property") &&
          parent.value === value &&
          isNodeOfType(parent.parent, "ObjectExpression") &&
          isNodeOfType(parent.parent.parent, "CallExpression")
        ) {
          const invocation = parent.parent.parent;
          const target = resolveStreamValueOrigin(invocation.callee, module);
          const position = invocation.arguments.findIndex(
            (candidate) => candidate === parent.parent,
          );
          const key = isNodeOfType(parent.key, "Identifier")
            ? parent.key.name
            : isNodeOfType(parent.key, "Literal")
              ? String(parent.key.value)
              : null;
          const parameter =
            target?.kind === "function" && isFunctionLike(target.node)
              ? target.node.params[position]
              : null;
          if (target && isNodeOfType(parameter, "ObjectPattern")) {
            const property = parameter.properties.find(
              (property) =>
                isNodeOfType(property, "Property") &&
                !property.computed &&
                !property.method &&
                property.kind === "init" &&
                isNodeOfType(property.value, "Identifier") &&
                getDestructuredBindingPropertyName(property.value) === key,
            );
            if (origin.kind === "channel" && isNodeOfType(property, "Property")) {
              const parameter = target.module.scopes.symbolFor(property.value);
              if (
                parameter &&
                hasClosedStreamValueReads(parameter, target.module, null, next, {
                  expression: reference.identifier,
                  module,
                  publication: invocation,
                })
              ) {
                allowed.add(reference.identifier);
                continue;
              }
            }
            if (
              isNodeOfType(property, "Property") &&
              resolveStreamValueOrigin(property.value, target.module)?.kind === origin.kind
            ) {
              const parameter = target.module.scopes.symbolFor(property.value);
              if (
                protectedFunction &&
                (!parameter ||
                  !hasClosedStreamValueReads(parameter, target.module, protectedFunction, next))
              )
                return false;
              allowed.add(reference.identifier);
              continue;
            }
          }
        }
        if (
          isNodeOfType(parent, "JSXSpreadAttribute") &&
          origin.kind === "preview" &&
          isNodeOfType(parent.parent, "JSXOpeningElement")
        ) {
          const target = resolveStreamValueOrigin(parent.parent.name, module);
          const parameter =
            target?.kind === "function" && isFunctionLike(target.node)
              ? target.node.params[OWN_HOOK_FIRST_INDEX]
              : null;
          if (
            isNodeOfType(parameter, "ObjectPattern") &&
            parameter.properties.every(
              (property) =>
                isNodeOfType(property, "Property") &&
                !property.computed &&
                !property.method &&
                property.kind === "init" &&
                isNodeOfType(property.value, "Identifier"),
            )
          ) {
            allowed.add(reference.identifier);
            continue;
          }
        }
        return false;
      }
      return hasOnlyAllowedSymbolReads({
        symbol,
        allowedIdentifiers: allowed,
        program: module.program,
        scopes: module.scopes,
      });
    };
    const hasOwnedStreamProviderPath = (
      component: EsTreeNode,
      module: AsyncEventSourceModule,
      visited: ReadonlySet<EsTreeNode> = new Set(),
    ): boolean => {
      if (visited.has(component)) return false;
      const next = new Set(visited);
      next.add(component);
      let hasPublication = false;
      let complete = true;
      for (const candidateModule of modules)
        walkAst(candidateModule.program, (node) => {
          if (!isNodeOfType(node, "JSXOpeningElement")) return;
          const target = resolveStreamValueOrigin(node.name, candidateModule);
          if (
            target?.kind !== "function" ||
            target.node !== component ||
            target.module.filename !== module.filename
          )
            return;
          hasPublication = true;
          const owner = findEnclosingFunction(node);
          let cursor: EsTreeNode | null | undefined = node.parent;
          let hasProvider = false;
          let returned = false;
          let child: EsTreeNode = node;
          while (cursor && cursor !== owner) {
            if (isFunctionLike(cursor)) break;
            if (!returned) {
              if (isNodeOfType(cursor, "ReturnStatement")) {
                if (
                  !cursor.argument ||
                  stripParenExpression(cursor.argument) !== stripParenExpression(child)
                )
                  break;
                returned = true;
              } else if (isNodeOfType(cursor, "JSXElement")) {
                if (
                  cursor.openingElement !== child &&
                  !cursor.children.some((candidate) => candidate === child)
                )
                  break;
              } else if (isNodeOfType(cursor, "JSXFragment")) {
                if (!cursor.children.some((candidate) => candidate === child)) break;
              } else if (isNodeOfType(cursor, "JSXExpressionContainer")) {
                if (cursor.expression !== child) break;
              } else if (isNodeOfType(cursor, "SequenceExpression")) {
                if (cursor.expressions[cursor.expressions.length - OWN_HOOK_SINGLE_COUNT] !== child)
                  break;
              } else if (isNodeOfType(cursor, "LogicalExpression")) {
                if (cursor.right !== child) break;
              } else if (isNodeOfType(cursor, "ConditionalExpression")) {
                if (cursor.consequent !== child && cursor.alternate !== child) break;
              } else if (stripParenExpression(cursor) !== stripParenExpression(child)) break;
            }
            if (
              isNodeOfType(cursor, "JSXElement") &&
              resolveStreamValueOrigin(cursor.openingElement.name, candidateModule)?.kind === "chat"
            )
              hasProvider = true;
            if (
              owner &&
              isNodeOfType(owner, "ArrowFunctionExpression") &&
              owner.body === cursor &&
              !isNodeOfType(cursor, "BlockStatement")
            )
              returned = true;
            child = cursor;
            cursor = cursor.parent;
          }
          if (
            cursor !== owner ||
            !returned ||
            (!hasProvider && (!owner || !hasOwnedStreamProviderPath(owner, candidateModule, next)))
          )
            complete = false;
        });
      return hasPublication && complete;
    };
    let providers = OWN_HOOK_FIRST_INDEX;
    let supported = true;
    for (const module of modules) {
      const symbols = new Set<SymbolDescriptor>();
      walkAst(module.program, (node) => {
        if (isNodeOfType(node, "Identifier")) {
          const symbol = module.scopes.symbolFor(node);
          if (symbol) symbols.add(symbol);
        }
        if (!isNodeOfType(node, "JSXOpeningElement")) return;
        const origin = resolveStreamValueOrigin(node.name, module);
        if (origin?.kind === "chat") {
          providers += OWN_HOOK_SINGLE_COUNT;
          const client = getAuthoritativeJsxAttribute(node.attributes, "client");
          if (
            node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")) ||
            !client ||
            !isNodeOfType(client.value, "JSXExpressionContainer") ||
            resolveStreamValueOrigin(client.value.expression, module)?.kind !== "client"
          )
            supported = false;
        }
        if (origin?.kind === "list") {
          for (const attribute of node.attributes) {
            if (
              !isNodeOfType(attribute, "JSXAttribute") ||
              !STREAM_CHANNEL_CHANNEL_LIST_PROP_NAMES.has(getJsxAttributeName(attribute.name) ?? "")
            ) {
              supported = false;
              continue;
            }
            if (getJsxAttributeName(attribute.name) !== "channelRenderFilterFn") continue;
            if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) {
              supported = false;
              continue;
            }
            const filter = resolveStreamValueOrigin(attribute.value.expression, module);
            const returned =
              filter?.kind === "function" ? getSingleReturnExpression(filter.node) : null;
            if (
              !filter ||
              !isFunctionLike(filter.node) ||
              filter.node.async ||
              filter.node.params.length !== OWN_HOOK_SINGLE_COUNT ||
              !isNodeOfType(filter.node.params[OWN_HOOK_FIRST_INDEX], "Identifier") ||
              !isNodeOfType(returned, "CallExpression") ||
              !isNodeOfType(returned.callee, "MemberExpression") ||
              getStaticPropertyName(returned.callee) !== "filter" ||
              !isNodeOfType(returned.callee.object, "Identifier") ||
              filter.module.scopes.symbolFor(returned.callee.object) !==
                filter.module.scopes.symbolFor(filter.node.params[OWN_HOOK_FIRST_INDEX]) ||
              returned.arguments.length !== OWN_HOOK_SINGLE_COUNT
            ) {
              supported = false;
              continue;
            }
            const predicate = stripParenExpression(returned.arguments[OWN_HOOK_FIRST_INDEX]);
            const body = isFunctionLike(predicate) ? getSingleReturnExpression(predicate) : null;
            if (
              !isNodeOfType(predicate, "ArrowFunctionExpression") ||
              predicate.async ||
              predicate.params.length !== OWN_HOOK_SINGLE_COUNT ||
              !isNodeOfType(predicate.params[OWN_HOOK_FIRST_INDEX], "Identifier") ||
              !isNodeOfType(body, "BinaryExpression") ||
              body.operator !== "===" ||
              !isNodeOfType(body.left, "MemberExpression") ||
              getStaticPropertyName(body.left) !== "type" ||
              !isNodeOfType(body.left.object, "Identifier") ||
              filter.module.scopes.symbolFor(body.left.object) !==
                filter.module.scopes.symbolFor(predicate.params[OWN_HOOK_FIRST_INDEX]) ||
              !isNodeOfType(body.right, "Literal") ||
              typeof body.right.value !== "string"
            )
              supported = false;
          }
        }
      });
      for (const symbol of symbols)
        if (!hasClosedStreamValueReads(symbol, module)) supported = false;
    }
    const owner = findEnclosingFunction(cheapDeclaration);
    return (
      supported &&
      providers === OWN_HOOK_SINGLE_COUNT &&
      resolveStreamValueOrigin(receiver, caller)?.kind === "channel" &&
      Boolean(owner && hasOwnedStreamProviderPath(owner, caller))
    );
  } catch {
    return false;
  }
};
