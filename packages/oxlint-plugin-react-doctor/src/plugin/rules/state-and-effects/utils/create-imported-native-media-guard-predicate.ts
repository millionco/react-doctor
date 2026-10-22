import { getManifestCacheGeneration } from "../../../utils/read-nearest-package-manifest.js";
import { getTsconfigAliasCacheGeneration } from "../../../utils/resolve-tsconfig-alias.js";
import { getModuleResolutionCacheGeneration } from "../../../utils/resolve-relative-import-path.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import {
  captureCrossFileProbes,
  replayCrossFileProbes,
  type CapturedCrossFileProbes,
} from "../../../utils/cross-file-probe-recorder.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isErasedTypeScriptNamespace } from "../../../utils/is-erased-typescript-namespace.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import {
  getCrossFileExportCacheGeneration,
  resolveCrossFileFunctionExportWithFilePath,
} from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  FIRST_ARGUMENT_INDEX,
  NATIVE_MEDIA_CALL_ARGUMENT_COUNT,
  NATIVE_MEDIA_ELEMENT_NAMES,
  NATIVE_MEDIA_PROVIDER_NAMES,
  IMPORTED_MEDIA_SSR_BODY_STATEMENT_COUNT,
  IMPORTED_MEDIA_SINGLE_RETURN_STATEMENT_COUNT,
  IMPORTED_MEDIA_PROVIDER_NAMES,
  IMPORTED_MEDIA_PROTOTYPE_KEYS,
  IMPORTED_MEDIA_REACT_API_NAMES,
} from "./effect/constants.js";

interface ImportedNativeMediaGuardInput {
  context: RuleContext;
  effectFunction: EsTreeNode;
  executionNode: EsTreeNode;
}

interface ImportedMediaProgramFacts {
  readonly generation: number;
  readonly aliasGeneration: number;
  readonly resolutionGeneration: number;
  readonly exportGeneration: number;
  readonly program: EsTreeNode;
  supported: boolean;
  providersByFilePath: Map<string, SymbolDescriptor[]>;
  providerProofsByFunction: WeakMap<EsTreeNode, boolean>;
  nativeCallsByEffect: WeakMap<EsTreeNode, CapturedCrossFileProbes<ReadonlySet<EsTreeNode>>>;
}

interface ImportedMediaProviderImport {
  provider: SymbolDescriptor;
  source: string;
}

interface ImportedMediaImporterSyntaxFacts {
  supported: boolean;
  providerImports: ReadonlyArray<ImportedMediaProviderImport>;
}

const importedMediaImporterSyntaxFacts = new WeakMap<
  ScopeAnalysis,
  ImportedMediaImporterSyntaxFacts
>();
const importedMediaBindingUsageProofs = new WeakMap<SymbolDescriptor, boolean>();
const readonlyImportedMediaBindings = new WeakMap<SymbolDescriptor, boolean>();
const importedMediaProgramFacts = new WeakMap<
  ScopeAnalysis,
  Map<string, CapturedCrossFileProbes<ImportedMediaProgramFacts>>
>();
const importedMediaExporterScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();
const importedMediaFunctionProofs = new WeakMap<EsTreeNode, WeakMap<EsTreeNode, boolean>>();

export const createImportedNativeMediaGuardPredicate = ({
  context,
  effectFunction,
  executionNode,
}: ImportedNativeMediaGuardInput): ((expression: EsTreeNode) => boolean) | null => {
  const filename = context.filename;
  if (!filename) return null;
  const isReadonly = (symbol: SymbolDescriptor): boolean => {
    const cached = readonlyImportedMediaBindings.get(symbol);
    if (cached !== undefined) return cached;
    const readonly = symbol.references.every(
      (reference) =>
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier)),
    );
    readonlyImportedMediaBindings.set(symbol, readonly);
    return readonly;
  };
  const isPrimitive = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "Literal") &&
    !("regex" in node && node.regex) &&
    (node.value === null || ["string", "boolean", "number"].includes(typeof node.value));
  const isDirectCallReference = (identifier: EsTreeNode): boolean => {
    const root = findTransparentExpressionRoot(identifier);
    const call = root.parent;
    return (
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.callee === root &&
      call.arguments.length === NATIVE_MEDIA_CALL_ARGUMENT_COUNT &&
      !isNodeOfType(call.arguments[FIRST_ARGUMENT_INDEX], "SpreadElement")
    );
  };
  const isSupportedProgram = (
    program: EsTreeNode,
    scopes: ScopeAnalysis,
    allowedGlobals: ReadonlySet<EsTreeNode>,
  ): boolean => {
    let invalid = false;
    walkAst(program, (node) => {
      if (invalid) return false;
      if (
        ("declare" in node && node.declare === true) ||
        isNodeOfType(node, "WithStatement") ||
        isNodeOfType(node, "ImportExpression") ||
        isNodeOfType(node, "ThisExpression") ||
        isNodeOfType(node, "Super") ||
        isNodeOfType(node, "TSEnumDeclaration") ||
        isNodeOfType(node, "TSImportEqualsDeclaration") ||
        isNodeOfType(node, "TSExportAssignment") ||
        isNodeOfType(node, "TSParameterProperty") ||
        (isNodeOfType(node, "TSModuleDeclaration") && !isErasedTypeScriptNamespace(node))
      ) {
        invalid = true;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (isNodeOfType(node, "Identifier") && scopes.referenceFor(node)) {
        const binding = scopes.symbolFor(node);
        if (
          (binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding)) ||
          node.name === "arguments" ||
          (!allowedGlobals.has(node) &&
            ([...IMPORTED_MEDIA_PROVIDER_NAMES, ...NATIVE_MEDIA_PROVIDER_NAMES].some((name) =>
              isProvenGlobalNamespaceReference(node, name, scopes),
            ) ||
              isProvenGlobalObjectReference(node, scopes)))
        ) {
          invalid = true;
          return false;
        }
      }
      if (
        isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
      ) {
        const key = getResolvedStaticPropertyName(node, scopes, {
          allowConstNumericLiteral: true,
          allowConstTemplateLiteral: true,
          stringifyNonStringLiterals: true,
        });
        if (
          (node.computed && key === null) ||
          (key !== null && IMPORTED_MEDIA_PROTOTYPE_KEYS.has(key)) ||
          (isNodeOfType(node, "MemberExpression") && isMemberMutationTarget(node))
        )
          invalid = true;
      }
    });
    return !invalid;
  };
  let programs = importedMediaProgramFacts.get(context.scopes);
  if (!programs) {
    programs = new Map();
    importedMediaProgramFacts.set(context.scopes, programs);
  }
  const generation = getManifestCacheGeneration();
  const aliasGeneration = getTsconfigAliasCacheGeneration();
  const resolutionGeneration = getModuleResolutionCacheGeneration();
  const exportGeneration = getCrossFileExportCacheGeneration();
  const program = context.scopes.rootScope.node;
  let capturedProgram = programs.get(filename);
  let programFacts = capturedProgram?.value;
  if (
    programFacts &&
    (programFacts.generation !== generation ||
      programFacts.aliasGeneration !== aliasGeneration ||
      programFacts.resolutionGeneration !== resolutionGeneration ||
      programFacts.exportGeneration !== exportGeneration ||
      programFacts.program !== program)
  )
    capturedProgram = undefined;
  if (!capturedProgram) {
    capturedProgram = captureCrossFileProbes(() => {
      const programFacts: ImportedMediaProgramFacts = {
        generation,
        aliasGeneration,
        resolutionGeneration,
        exportGeneration,
        program,
        supported: false,
        providersByFilePath: new Map(),
        providerProofsByFunction: new WeakMap(),
        nativeCallsByEffect: new WeakMap(),
      };
      let importerFacts = importedMediaImporterSyntaxFacts.get(context.scopes);
      if (!importerFacts) {
        const providerImports: ImportedMediaProviderImport[] = [];
        for (const provider of context.scopes.rootScope.symbols) {
          const declaration = getImportDeclarationForSymbol(provider);
          if (
            !declaration ||
            declaration.importKind === "type" ||
            (isNodeOfType(provider.declarationNode, "ImportSpecifier") &&
              provider.declarationNode.importKind === "type") ||
            typeof declaration.source.value !== "string"
          )
            continue;
          providerImports.push({ provider, source: declaration.source.value });
        }
        const hasEligibleImport = providerImports.some(
          ({ provider, source }) =>
            isNodeOfType(provider.declarationNode, "ImportSpecifier") &&
            source.startsWith(".") &&
            getImportedName(provider.declarationNode) !== "default",
        );
        let supported = false;
        if (hasEligibleImport) {
          const proveImporter = (): boolean => {
            if (!isSupportedProgram(context.scopes.rootScope.node, context.scopes, new Set()))
              return false;
            const providerApiProofs = new WeakMap<SymbolDescriptor, Map<string, boolean>>();
            const isClosedProviderCall = (
              call: EsTreeNode,
              api: string,
              symbol: SymbolDescriptor,
            ): boolean => {
              if (!isReactApiCall(call, api, context.scopes)) return false;
              let proofs = providerApiProofs.get(symbol);
              if (!proofs) {
                proofs = new Map();
                providerApiProofs.set(symbol, proofs);
              }
              const cached = proofs.get(api);
              if (cached !== undefined) return cached;
              const closed = isProvenUnmodifiedReactApiCall(call, api, context.scopes);
              proofs.set(api, closed);
              return closed;
            };
            for (const symbol of context.scopes.rootScope.symbols) {
              const declaration = getImportDeclarationForSymbol(symbol);
              if (
                !declaration ||
                declaration.importKind === "type" ||
                (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
                  symbol.declarationNode.importKind === "type")
              )
                continue;
              if (isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) return false;
              if (declaration.source.value !== "react") continue;
              if (
                !isReadonly(symbol) ||
                !symbol.references.every((reference) => {
                  if (isTypeScriptTypePosition(reference.identifier)) return true;
                  const root = findTransparentExpressionRoot(reference.identifier);
                  const parent = root.parent;
                  const isDefault =
                    isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
                    getImportedName(symbol.declarationNode) === "default";
                  const api =
                    isDefault && isNodeOfType(parent, "MemberExpression")
                      ? getStaticPropertyName(parent)
                      : getImportedName(symbol.declarationNode);
                  const call =
                    isDefault && parent ? findTransparentExpressionRoot(parent).parent : parent;
                  return Boolean(
                    api &&
                    IMPORTED_MEDIA_REACT_API_NAMES.has(api) &&
                    isNodeOfType(call, "CallExpression") &&
                    !call.optional &&
                    stripParenExpression(call.callee) === (isDefault ? parent : root) &&
                    isClosedProviderCall(call, api, symbol),
                  );
                })
              )
                return false;
            }

            return true;
          };
          supported = proveImporter();
        }
        importerFacts = { supported, providerImports };
        importedMediaImporterSyntaxFacts.set(context.scopes, importerFacts);
      }
      programFacts.supported = importerFacts.supported;
      if (programFacts.supported) {
        for (const { provider, source } of importerFacts.providerImports) {
          const filePath = resolveModulePath(filename, source);
          if (!filePath) continue;
          const providers = programFacts.providersByFilePath.get(filePath) ?? [];
          providers.push(provider);
          programFacts.providersByFilePath.set(filePath, providers);
        }
      }
      return programFacts;
    });
    programs.set(filename, capturedProgram);
  }
  replayCrossFileProbes(capturedProgram.trace);
  programFacts = capturedProgram.value;
  if (!programFacts.supported) return null;
  const currentProgramFacts = programFacts;
  const importProofs = new WeakMap<SymbolDescriptor, boolean>();

  const proveCall = (call: EsTreeNode): boolean => {
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
      !isNodeOfType(stripParenExpression(call.callee), "Identifier") ||
      isNodeOfType(call.arguments[FIRST_ARGUMENT_INDEX], "SpreadElement")
    )
      return false;
    const callee = stripParenExpression(call.callee);
    const imported = context.scopes.symbolFor(callee);
    const declaration = imported ? getImportDeclarationForSymbol(imported) : null;
    const exportedName = imported ? getImportedName(imported.declarationNode) : undefined;
    if (
      !imported ||
      !isNodeOfType(imported.declarationNode, "ImportSpecifier") ||
      imported.declarationNode.importKind === "type" ||
      !declaration ||
      declaration.importKind === "type" ||
      typeof declaration.source.value !== "string" ||
      !declaration.source.value.startsWith(".") ||
      !exportedName ||
      exportedName === "default" ||
      !isReadonly(imported)
    )
      return false;
    const cachedImport = importProofs.get(imported);
    if (cachedImport !== undefined) return cachedImport;
    const proveImport = (): boolean => {
      const resolvedPath = resolveModulePath(filename, declaration.source.value);
      const resolved = resolveCrossFileFunctionExportWithFilePath(
        filename,
        declaration.source.value,
        exportedName,
      );
      if (!resolved || resolved.filePath !== resolvedPath) return false;
      const functionNode = resolved.functionNode;
      if (
        !isFunctionLike(functionNode) ||
        functionNode.async ||
        functionNode.generator ||
        functionNode.params.length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
        !isNodeOfType(functionNode.params[FIRST_ARGUMENT_INDEX], "Identifier") ||
        !isNodeOfType(resolved.programNode, "Program")
      )
        return false;
      const exporterProgram = resolved.programNode;
      let scopes = importedMediaExporterScopes.get(exporterProgram);
      if (!scopes) {
        scopes = analyzeScopes(exporterProgram);
        importedMediaExporterScopes.set(exporterProgram, scopes);
      }
      let functionProofs = importedMediaFunctionProofs.get(exporterProgram);
      if (!functionProofs) {
        functionProofs = new WeakMap();
        importedMediaFunctionProofs.set(exporterProgram, functionProofs);
      }
      let functionProof = functionProofs.get(functionNode);
      if (functionProof === undefined) {
        const proveFunction = (): boolean => {
          const parameter = scopes.symbolFor(functionNode.params[FIRST_ARGUMENT_INDEX]);
          const bindings = getFunctionBindingSymbols(functionNode, scopes);
          if (
            !parameter ||
            !isReadonly(parameter) ||
            bindings.length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT
          )
            return false;
          const binding = bindings[FIRST_ARGUMENT_INDEX];
          if (
            !binding ||
            binding.name !== exportedName ||
            !isReadonly(binding) ||
            scopes.rootScope.symbols.filter(
              (symbol) => symbol.name === binding.name && !isErasedTypeScriptBinding(symbol),
            ).length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
            !binding.references.every(
              (reference) =>
                isTypeScriptTypePosition(reference.identifier) ||
                isDirectCallReference(reference.identifier),
            )
          )
            return false;
          const carrier = functionNode.parent;
          const exported = isNodeOfType(carrier, "VariableDeclarator")
            ? carrier.parent?.parent
            : carrier;
          if (
            !isNodeOfType(exported, "ExportNamedDeclaration") ||
            exported.source ||
            exported.specifiers.length !== 0 ||
            !(
              exported.declaration === functionNode ||
              (isNodeOfType(carrier, "VariableDeclarator") &&
                carrier.id === binding.bindingIdentifier &&
                isNodeOfType(carrier.parent, "VariableDeclaration") &&
                carrier.parent.kind === "const" &&
                exported.declaration === carrier.parent)
            )
          )
            return false;

          const allowedGlobals = new Set<EsTreeNode>();
          const isStaticData = (expression: EsTreeNode): boolean => {
            const node = stripParenExpression(expression);
            if (isPrimitive(node) || isFunctionLike(node)) return true;
            if (isNodeOfType(node, "ArrayExpression"))
              return node.elements.every((element) => element !== null && isPrimitive(element));
            if (
              !isNodeOfType(node, "NewExpression") ||
              !isNodeOfType(node.callee, "Identifier") ||
              node.callee.name !== "Set" ||
              !scopes.isGlobalReference(node.callee) ||
              node.arguments.length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
              !isNodeOfType(node.arguments[FIRST_ARGUMENT_INDEX], "ArrayExpression") ||
              !node.arguments[FIRST_ARGUMENT_INDEX].elements.every(
                (element) => element !== null && isPrimitive(element),
              )
            )
              return false;
            allowedGlobals.add(node.callee);
            return true;
          };
          for (const statement of exporterProgram.body) {
            if (isNodeOfType(statement, "ImportDeclaration")) {
              if (statement.importKind !== "type") return false;
              continue;
            }
            if (
              isNodeOfType(statement, "ExportDefaultDeclaration") ||
              isNodeOfType(statement, "ExportAllDeclaration")
            )
              return false;
            const node = isNodeOfType(statement, "ExportNamedDeclaration")
              ? statement.declaration
              : statement;
            if (
              isNodeOfType(statement, "ExportNamedDeclaration") &&
              (statement.source || statement.specifiers.length !== 0)
            )
              return false;
            if (
              isNodeOfType(node, "FunctionDeclaration") ||
              isNodeOfType(node, "TSInterfaceDeclaration") ||
              isNodeOfType(node, "TSTypeAliasDeclaration") ||
              isNodeOfType(node, "EmptyStatement")
            )
              continue;
            if (isNodeOfType(node, "ExpressionStatement") && isPrimitive(node.expression)) continue;
            if (
              !isNodeOfType(node, "VariableDeclaration") ||
              node.kind !== "const" ||
              !node.declarations.every(
                (item) =>
                  isNodeOfType(item.id, "Identifier") && item.init && isStaticData(item.init),
              )
            )
              return false;
          }
          let returnExpression: EsTreeNode | null = null;
          if (isNodeOfType(functionNode.body, "BlockStatement")) {
            const statements = functionNode.body.body;
            const returned = statements[statements.length - 1];
            if (
              !isNodeOfType(returned, "ReturnStatement") ||
              !returned.argument ||
              (statements.length !== IMPORTED_MEDIA_SINGLE_RETURN_STATEMENT_COUNT &&
                statements.length !== IMPORTED_MEDIA_SSR_BODY_STATEMENT_COUNT)
            )
              return false;
            returnExpression = returned.argument;
            if (statements.length === IMPORTED_MEDIA_SSR_BODY_STATEMENT_COUNT) {
              const prefix = statements[FIRST_ARGUMENT_INDEX];
              if (!isNodeOfType(prefix, "IfStatement") || prefix.alternate) return false;
              const test = stripParenExpression(prefix.test);
              if (!isNodeOfType(test, "BinaryExpression") || test.operator !== "===") return false;
              const typeOf = isNodeOfType(test.left, "UnaryExpression") ? test.left : test.right;
              const missing = typeOf === test.left ? test.right : test.left;
              if (
                !isNodeOfType(typeOf, "UnaryExpression") ||
                typeOf.operator !== "typeof" ||
                !isNodeOfType(typeOf.argument, "Identifier") ||
                typeOf.argument.name !== "document" ||
                !scopes.isGlobalReference(typeOf.argument) ||
                !isNodeOfType(missing, "Literal") ||
                missing.value !== "undefined"
              )
                return false;
              const exit =
                isNodeOfType(prefix.consequent, "BlockStatement") &&
                prefix.consequent.body.length === IMPORTED_MEDIA_SINGLE_RETURN_STATEMENT_COUNT
                  ? prefix.consequent.body[FIRST_ARGUMENT_INDEX]
                  : prefix.consequent;
              if (
                !isNodeOfType(exit, "ReturnStatement") ||
                !isNodeOfType(exit.argument, "Literal") ||
                exit.argument.value !== false
              )
                return false;
              allowedGlobals.add(typeOf.argument);
            }
          } else returnExpression = functionNode.body;
          const comparison = returnExpression ? stripParenExpression(returnExpression) : null;
          if (
            !isNodeOfType(comparison, "BinaryExpression") ||
            !["===", "!=="].includes(comparison.operator)
          )
            return false;
          const empty = isNodeOfType(comparison.right, "Literal")
            ? comparison.right
            : comparison.left;
          const capability = stripParenExpression(
            empty === comparison.right ? comparison.left : comparison.right,
          );
          if (
            !isNodeOfType(empty, "Literal") ||
            empty.value !== "" ||
            !isNodeOfType(capability, "CallExpression") ||
            capability.optional ||
            capability.arguments.length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
            !isNodeOfType(capability.callee, "MemberExpression") ||
            capability.callee.optional ||
            capability.callee.computed ||
            getStaticPropertyName(capability.callee) !== "canPlayType"
          )
            return false;
          const argument = stripParenExpression(capability.arguments[FIRST_ARGUMENT_INDEX]);
          const created = stripParenExpression(capability.callee.object);
          if (
            !isNodeOfType(argument, "Identifier") ||
            scopes.symbolFor(argument) !== parameter ||
            !isNodeOfType(created, "CallExpression") ||
            created.optional ||
            created.arguments.length !== NATIVE_MEDIA_CALL_ARGUMENT_COUNT ||
            !isNodeOfType(created.callee, "MemberExpression") ||
            created.callee.optional ||
            created.callee.computed ||
            getStaticPropertyName(created.callee) !== "createElement"
          )
            return false;
          const document = stripParenExpression(created.callee.object);
          const tag = created.arguments[FIRST_ARGUMENT_INDEX];
          if (
            !isNodeOfType(document, "Identifier") ||
            document.name !== "document" ||
            !scopes.isGlobalReference(document) ||
            !isNodeOfType(tag, "Literal") ||
            typeof tag.value !== "string" ||
            !NATIVE_MEDIA_ELEMENT_NAMES.has(tag.value)
          )
            return false;
          allowedGlobals.add(document);
          return isSupportedProgram(exporterProgram, scopes, allowedGlobals);
        };
        functionProof = proveFunction();
        functionProofs.set(functionNode, functionProof);
      }
      if (!functionProof) return false;
      const cachedProviders = currentProgramFacts.providerProofsByFunction.get(functionNode);
      if (cachedProviders !== undefined) return cachedProviders;
      const proveProviders = (): boolean => {
        for (const provider of currentProgramFacts.providersByFilePath.get(resolved.filePath) ??
          []) {
          const providerImport = getImportDeclarationForSymbol(provider);
          if (
            !providerImport ||
            providerImport.importKind === "type" ||
            (isNodeOfType(provider.declarationNode, "ImportSpecifier") &&
              provider.declarationNode.importKind === "type") ||
            typeof providerImport.source.value !== "string"
          )
            continue;
          const name = getImportedName(provider.declarationNode);
          if (
            isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier") ||
            name === "default"
          )
            return false;
          if (!name) return false;
          const other = resolveCrossFileFunctionExportWithFilePath(
            filename,
            providerImport.source.value,
            name,
          );
          if (other?.functionNode !== functionNode) continue;
          let hasClosedReferences = importedMediaBindingUsageProofs.get(provider);
          if (hasClosedReferences === undefined) {
            hasClosedReferences =
              isReadonly(provider) &&
              provider.references.every(
                (reference) =>
                  isTypeScriptTypePosition(reference.identifier) ||
                  isDirectCallReference(reference.identifier),
              );
            importedMediaBindingUsageProofs.set(provider, hasClosedReferences);
          }
          if (!hasClosedReferences) return false;
        }
        return true;
      };
      const provenProviders = proveProviders();
      currentProgramFacts.providerProofsByFunction.set(functionNode, provenProviders);
      return provenProviders;
    };
    const proof = proveImport();
    importProofs.set(imported, proof);
    return proof;
  };
  const effects = currentProgramFacts.nativeCallsByEffect;
  let capturedCalls = effects.get(effectFunction);
  if (!capturedCalls) {
    capturedCalls = captureCrossFileProbes(() => {
      const calls = new Set<EsTreeNode>();
      walkAst(effectFunction, (node) => {
        if (node !== effectFunction && isFunctionLike(node)) return false;
        if (isNodeOfType(node, "CallExpression") && proveCall(node)) calls.add(node);
      });
      return calls;
    });
    effects.set(effectFunction, capturedCalls);
  }
  replayCrossFileProbes(capturedCalls.trace);
  const nativeCalls = capturedCalls.value;
  if (nativeCalls.size === 0) return null;
  const isReadonlyLocal = (expression: EsTreeNode): boolean => {
    const node = stripParenExpression(expression);
    if (!isNodeOfType(node, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(node);
    return Boolean(
      symbol &&
      symbol.kind === "const" &&
      isReadonly(symbol) &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.declarationNode.id === symbol.bindingIdentifier &&
      symbol.declarationNode.range[1] <= node.range[0],
    );
  };
  const isAtom = (expression: EsTreeNode): boolean => {
    const node = stripParenExpression(expression);
    if (isPrimitive(node) || isReadonlyLocal(node)) return true;
    if (isNodeOfType(node, "UnaryExpression") && node.operator === "typeof")
      return isReadonlyLocal(node.argument);
    if (isNodeOfType(node, "BinaryExpression") && ["===", "!=="].includes(node.operator))
      return (
        (isPrimitive(stripParenExpression(node.left)) || isReadonlyLocal(node.left)) &&
        (isPrimitive(stripParenExpression(node.right)) || isReadonlyLocal(node.right))
      );
    return false;
  };
  return (expression) => {
    const root = findTransparentExpressionRoot(expression);
    const parent = root.parent;
    if (
      !isNodeOfType(parent, "IfStatement") ||
      parent.test !== root ||
      !isAstDescendant(executionNode, parent.consequent)
    )
      return false;
    let nativeLeaves = 0;
    const matches = (expression: EsTreeNode): boolean => {
      const node = stripParenExpression(expression);
      if (isNodeOfType(node, "LogicalExpression") && node.operator === "&&")
        return matches(node.left) && matches(node.right);
      const call =
        isNodeOfType(node, "UnaryExpression") && node.operator === "!"
          ? stripParenExpression(node.argument)
          : node;
      if (nativeCalls.has(call)) {
        nativeLeaves += 1;
        return true;
      }
      return isAtom(node);
    };
    return matches(expression) && nativeLeaves === NATIVE_MEDIA_CALL_ARGUMENT_COUNT;
  };
};
