import {
  readSelectedTypedSourceClosure,
  type SourceProjectModule,
} from "../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isEverySpecifierInlineType, isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import type { JestExplicitSourceSubstitution } from "../../utils/read-named-jest-caller.js";
import type { VerifiedStockViteBrowserProject } from "../../utils/read-verified-stock-vite-browser-project.js";
import { walkAst } from "../../utils/walk-ast.js";
import {
  isJestNullDefaultContext,
  readJestNoProviderContext,
  readPlainJestPreRenderHookSites,
} from "./read-plain-jest-prerender-stop.js";

type Module = SourceProjectModule;
type ResolvedModule =
  | { readonly kind: "local"; readonly filename: string; readonly mapped: boolean }
  | { readonly kind: "bare"; readonly specifier: string }
  | null;

export interface BareJestNullContextStopInput {
  readonly test: Module;
  readonly component: Module;
  readonly site: EsTreeNode;
  readonly project: VerifiedStockViteBrowserProject;
  readonly resolve: (issuer: string, specifier: string) => ResolvedModule;
  readonly substitutions: ReadonlyMap<string, JestExplicitSourceSubstitution>;
  readonly effectiveJestSources: ReadonlySet<string>;
  readonly hasStockReactEntry: (module: Module) => boolean;
}

const isUnmocked = (
  input: BareJestNullContextStopInput,
  issuer: string,
  specifier: string,
  filename: string,
): boolean => {
  const resolved = input.resolve(issuer, specifier);
  return Boolean(
    resolved?.kind === "local" &&
    resolved.filename === filename &&
    !input.substitutions.has(JSON.stringify([resolved.filename, resolved.mapped])),
  );
};

const isNamedReactUseContext = (module: Module, callee: EsTreeNode): boolean => {
  const symbol = module.scopes.symbolFor(callee);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  const specifier = symbol?.declarationNode;
  return Boolean(
    declaration &&
    !isTypeOnlyImport(declaration) &&
    declaration.source.value === "react" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(specifier.imported, "Identifier") &&
    specifier.imported.name === "useContext",
  );
};

const isReadOnlyContextReference = (module: Module, reference: EsTreeNode): boolean => {
  if (isWithinAssignmentTarget(reference)) return false;
  const parent = reference.parent;
  if (
    isNodeOfType(parent, "CallExpression") &&
    !parent.optional &&
    parent.arguments.length === 1 &&
    parent.arguments[0] === reference &&
    isNamedReactUseContext(module, parent.callee)
  ) {
    return true;
  }
  if (
    !isNodeOfType(parent, "JSXMemberExpression") ||
    parent.object !== reference ||
    !isNodeOfType(parent.property, "JSXIdentifier") ||
    parent.property.name !== "Provider"
  ) {
    return false;
  }
  const element = parent.parent;
  return Boolean(
    (isNodeOfType(element, "JSXOpeningElement") || isNodeOfType(element, "JSXClosingElement")) &&
    element.name === parent,
  );
};

const hasClosedContextConsumers = (
  input: BareJestNullContextStopInput,
  filename: string,
  exportedName: string,
): boolean => {
  if (input.project.closure.opaqueIssuers.size > 0) return false;
  const selected = readSelectedTypedSourceClosure(input.project.index, [input.test.filePath]);
  // Explicit owned Jest mock factories produce conservative module opacity at
  // the checked root. The outer guard closes those registrations; this helper
  // independently rejects root dynamic imports, require, and requireActual.
  if (!selected || [...selected.opaqueIssuers].some((issuer) => issuer !== input.test.filePath))
    return false;
  for (const [key] of input.substitutions) {
    const id: unknown = JSON.parse(key);
    if (Array.isArray(id) && id[0] === filename) return false;
  }
  // Other selected test files run in separate Jest runtimes. Include
  // this test's effective aliases, in addition to the browser typed edges.
  const sources = new Set([...selected.reachable, ...input.effectiveJestSources]);
  for (const issuer of sources) {
    const module = input.project.index.modulesByFilePath.get(issuer);
    if (!module) continue;
    let valid = true;
    walkAst(module.programNode, (node) => {
      if (!valid) return false;
      if (
        (isNodeOfType(node, "ImportDeclaration") && isTypeOnlyImport(node)) ||
        (isNodeOfType(node, "ExportAllDeclaration") && node.exportKind === "type") ||
        (isNodeOfType(node, "ExportNamedDeclaration") &&
          (node.exportKind === "type" ||
            isEverySpecifierInlineType(node.specifiers, "ExportSpecifier", "exportKind")))
      )
        return;
      if (
        !isNodeOfType(node, "ImportDeclaration") &&
        !isNodeOfType(node, "ExportNamedDeclaration") &&
        !isNodeOfType(node, "ExportAllDeclaration") &&
        !isNodeOfType(node, "ImportExpression")
      )
        return;
      if (!isNodeOfType(node.source, "Literal") || typeof node.source.value !== "string") return;
      const resolved = input.resolve(issuer, node.source.value);
      if (resolved?.kind !== "local" || resolved.filename !== filename) return;
      if (!isNodeOfType(node, "ImportDeclaration")) {
        valid = false;
        return;
      }
      for (const specifier of node.specifiers) {
        if (
          !isNodeOfType(specifier, "ImportSpecifier") ||
          !isNodeOfType(specifier.imported, "Identifier")
        ) {
          valid = false;
          return;
        }
        if (specifier.importKind === "type" || specifier.imported.name !== exportedName) continue;
        const symbol = module.scopes.symbolFor(specifier.local);
        if (
          !symbol ||
          !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) ||
          symbol.references.some(
            ({ identifier, flag }) =>
              flag !== "read" || !isReadOnlyContextReference(module, identifier),
          )
        ) {
          valid = false;
          return;
        }
      }
    });
    if (!valid) return false;
  }
  return true;
};

/**
 * The outer named-Jest guard must prove the stock renderer, React identity,
 * profile, setup, and protected bare mock exclusions. This cuts activation
 * only; it never removes dependency instantiation or import edges.
 */
export const provesBareJestNullContextStop = (input: BareJestNullContextStopInput): boolean => {
  try {
    const { test, component, site } = input;
    if (
      !isNodeOfType(site, "ImportDeclaration") ||
      isTypeOnlyImport(site) ||
      site.specifiers.length !== 1 ||
      typeof site.source.value !== "string"
    ) {
      return false;
    }
    const specifier = site.specifiers[0];
    if (
      !isNodeOfType(specifier, "ImportSpecifier") ||
      specifier.importKind === "type" ||
      !isNodeOfType(specifier.imported, "Identifier") ||
      !isUnmocked(input, test.filePath, site.source.value, component.filePath)
    ) {
      return false;
    }
    const componentSymbol = test.scopes.symbolFor(specifier.local);
    const declaration = findExportedValue(component.programNode, specifier.imported.name);
    if (
      !componentSymbol ||
      !hasCompleteSymbolReferences(componentSymbol, test.programNode, test.scopes) ||
      !isNodeOfType(declaration, "FunctionDeclaration") ||
      declaration.async ||
      declaration.generator ||
      declaration.params.length !== 0 ||
      !isNodeOfType(declaration.body, "BlockStatement")
    ) {
      return false;
    }
    const renderImports = test.programNode.body.filter(
      (node) =>
        isNodeOfType(node, "ImportDeclaration") &&
        !isTypeOnlyImport(node) &&
        node.source.value === "@testing-library/react",
    );
    if (renderImports.length !== 1) return false;
    const renderImport = renderImports[0];
    if (!isNodeOfType(renderImport, "ImportDeclaration")) return false;
    const renderSpecifier = renderImport.specifiers.find(
      (node) =>
        isNodeOfType(node, "ImportSpecifier") &&
        isNodeOfType(node.imported, "Identifier") &&
        node.imported.name === "render",
    );
    if (!renderSpecifier || !isNodeOfType(renderSpecifier, "ImportSpecifier")) return false;
    if (
      renderImport.specifiers.some(
        (node) =>
          !isNodeOfType(node, "ImportSpecifier") ||
          !isNodeOfType(node.imported, "Identifier") ||
          !["act", "render", "screen"].includes(node.imported.name),
      )
    ) {
      return false;
    }
    const renderSymbol = test.scopes.symbolFor(renderSpecifier.local);
    if (
      !renderSymbol ||
      !hasCompleteSymbolReferences(renderSymbol, test.programNode, test.scopes) ||
      renderSymbol.references.length === 0
    ) {
      return false;
    }
    const openings = new Set<EsTreeNode>();
    for (const reference of renderSymbol.references) {
      const call = reference.identifier.parent;
      if (
        reference.flag !== "read" ||
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.callee !== reference.identifier ||
        call.arguments.length !== 1 ||
        !isNodeOfType(call.arguments[0], "JSXElement")
      ) {
        return false;
      }
      const element = call.arguments[0];
      const opening = element.openingElement;
      if (
        !opening.selfClosing ||
        opening.attributes.length !== 0 ||
        element.children.length !== 0 ||
        !isNodeOfType(opening.name, "JSXIdentifier") ||
        test.scopes.symbolFor(opening.name) !== componentSymbol
      ) {
        return false;
      }
      openings.add(opening);
    }
    if (
      componentSymbol.references.length !== openings.size ||
      componentSymbol.references.some(
        ({ identifier, flag }) => flag !== "read" || !openings.has(identifier.parent!),
      )
    ) {
      return false;
    }
    let otherJsx = false;
    walkAst(test.programNode, (node) => {
      if (isNodeOfType(node, "JSXOpeningElement") && !openings.has(node)) otherJsx = true;
      if (isNodeOfType(node, "JSXFragment")) otherJsx = true;
    });
    let alternateRuntimeAccess = false;
    walkAst(test.programNode, (node) => {
      if (isNodeOfType(node, "ImportExpression")) alternateRuntimeAccess = true;
      if (
        isNodeOfType(node, "CallExpression") &&
        ((isNodeOfType(node.callee, "Identifier") &&
          ["require", "eval", "Function"].includes(node.callee.name)) ||
          (isNodeOfType(node.callee, "MemberExpression") &&
            isNodeOfType(node.callee.property, "Identifier") &&
            node.callee.property.name === "requireActual"))
      )
        alternateRuntimeAccess = true;
      if (
        isNodeOfType(node, "ImportDeclaration") &&
        !isTypeOnlyImport(node) &&
        node !== renderImport &&
        typeof node.source.value === "string" &&
        /^(?:react(?:-dom|-test-renderer)?(?:\/|$)|@testing-library\/)/u.test(node.source.value)
      )
        alternateRuntimeAccess = true;
    });
    if (otherJsx || alternateRuntimeAccess) return false;
    const first = declaration.body.body[0];
    if (
      !isNodeOfType(first, "VariableDeclaration") ||
      first.kind !== "const" ||
      first.declarations.length !== 1 ||
      !isNodeOfType(first.declarations[0], "VariableDeclarator")
    ) {
      return false;
    }
    const initializer = first.declarations[0].init;
    const hook = readPlainJestPreRenderHookSites(component, declaration).find(
      (candidate) => candidate.call === initializer,
    );
    if (!hook) return false;
    const hookId = input.resolve(component.filePath, hook.specifier);
    if (
      hookId?.kind !== "local" ||
      !isUnmocked(input, component.filePath, hook.specifier, hookId.filename)
    ) {
      return false;
    }
    const hookModule = input.project.index.modulesByFilePath.get(hookId.filename);
    const context = hookModule && readJestNoProviderContext(hookModule, hook);
    if (!hookModule || !context || !input.hasStockReactEntry(hookModule)) return false;
    const selectedHook = findExportedValue(hookModule.programNode, hook.name);
    if (!isNodeOfType(selectedHook, "FunctionDeclaration")) return false;
    const guard = selectedHook.body.body[1];
    const thrown =
      isNodeOfType(guard, "IfStatement") && isNodeOfType(guard.consequent, "BlockStatement")
        ? guard.consequent.body[0]
        : null;
    if (!isNodeOfType(thrown, "ThrowStatement")) return false;
    const argument = thrown.argument;
    if (
      !isNodeOfType(argument, "Literal") &&
      !(
        isNodeOfType(argument, "NewExpression") &&
        isNodeOfType(argument.callee, "Identifier") &&
        argument.callee.name === "Error" &&
        !hookModule.scopes.symbolFor(argument.callee) &&
        argument.arguments.length <= 1 &&
        argument.arguments.every((value) => isNodeOfType(value, "Literal"))
      )
    )
      return false;
    const contextId = input.resolve(hookModule.filePath, context.specifier);
    if (
      contextId?.kind !== "local" ||
      !isUnmocked(input, hookModule.filePath, context.specifier, contextId.filename)
    ) {
      return false;
    }
    const contextModule = input.project.index.modulesByFilePath.get(contextId.filename);
    return Boolean(
      contextModule &&
      input.hasStockReactEntry(contextModule) &&
      isJestNullDefaultContext(contextModule, context.name) &&
      hasClosedContextConsumers(input, contextId.filename, context.name),
    );
  } catch {
    return false;
  }
};
