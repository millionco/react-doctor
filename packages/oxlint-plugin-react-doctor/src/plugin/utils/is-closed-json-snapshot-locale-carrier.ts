import { hasClosedJsonSnapshotJsxReferences } from "./has-closed-json-snapshot-jsx-references.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  CLOSED_JSON_SNAPSHOT_LOCALE_MAX_NODES,
  CLOSED_JSON_SNAPSHOT_LOCALE_MAX_REFERENCES,
  CLOSED_JSON_SNAPSHOT_LOCALE_PROVIDER_SOURCES,
  CLOSED_JSON_SNAPSHOT_LOCALE_DATA_SOURCES,
  CLOSED_JSON_SNAPSHOT_LOCALE_STYLE_SOURCES,
  CLOSED_JSON_SNAPSHOT_LOCALE_FUNCTION_SCOPE_KINDS,
} from "./closed-json-snapshot-locale/constants.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type {
  ClosedJsonSnapshotModule,
  ClosedJsonSnapshotProject,
} from "./get-closed-json-snapshot-project.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isClosedJsonSnapshotInactiveBranch } from "./is-closed-json-snapshot-inactive-branch.js";
import { isClosedJsonSnapshotSideEffectRequire } from "./is-closed-json-snapshot-side-effect-require.js";
import { walkAst } from "./walk-ast.js";

export interface ClosedJsonSnapshotLocaleCarrierInput {
  readonly opening: EsTreeNodeOfType<"JSXOpeningElement">;
  readonly module: ClosedJsonSnapshotModule;
  readonly project: ClosedJsonSnapshotProject;
  readonly hasAntdLocaleProvider: boolean;
}

interface SnapshotLocaleModuleBindings {
  readonly providers: ReadonlySet<SymbolDescriptor>;
  readonly locales: ReadonlySet<SymbolDescriptor>;
}

const isAntdSource = (source: string | null): boolean =>
  source === "antd" || source?.startsWith("antd/") === true;

const hasFixedLocaleCarrierShape = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  module: ClosedJsonSnapshotModule,
  bindings: SnapshotLocaleModuleBindings,
): boolean => {
  if (!isNodeOfType(opening.name, "JSXIdentifier") || opening.attributes.length !== 1) return false;
  const providerSymbol = module.scopes.symbolFor(opening.name);
  if (!providerSymbol || !bindings.providers.has(providerSymbol)) return false;
  const attribute = opening.attributes[0];
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "locale" ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(attribute.value.expression, "Identifier")
  )
    return false;
  const localeSymbol = module.scopes.symbolFor(attribute.value.expression);
  if (!localeSymbol || !bindings.locales.has(localeSymbol)) return false;
  const element = opening.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  const children = element.children.filter(
    (child) =>
      !(
        (isNodeOfType(child, "JSXText") && child.value.trim() === "") ||
        (isNodeOfType(child, "JSXExpressionContainer") &&
          isNodeOfType(child.expression, "JSXEmptyExpression"))
      ),
  );
  return (
    children.length === 1 &&
    (isNodeOfType(children[0], "JSXElement") || isNodeOfType(children[0], "JSXFragment"))
  );
};

export const isClosedJsonSnapshotLocaleCarrier = ({
  opening,
  module,
  project,
  hasAntdLocaleProvider,
}: ClosedJsonSnapshotLocaleCarrierInput): boolean => {
  if (!hasAntdLocaleProvider || project.modules.get(module.filePath) !== module) return false;
  const bindingsByModule = new Map<ClosedJsonSnapshotModule, SnapshotLocaleModuleBindings>();
  let visitedNodes = 0;
  for (const candidateModule of project.modules.values()) {
    const providers = new Set<SymbolDescriptor>();
    const locales = new Set<SymbolDescriptor>();
    let isClosed = true;
    walkAst(candidateModule.program, (node) => {
      visitedNodes += 1;
      if (!isClosed || visitedNodes > CLOSED_JSON_SNAPSHOT_LOCALE_MAX_NODES) {
        isClosed = false;
        return false;
      }
      if (
        isNodeOfType(node, "FunctionDeclaration") &&
        !CLOSED_JSON_SNAPSHOT_LOCALE_FUNCTION_SCOPE_KINDS.has(
          candidateModule.scopes.scopeFor(node).kind,
        )
      ) {
        isClosed = false;
        return false;
      }
      if (isNodeOfType(node, "TSImportEqualsDeclaration")) {
        isClosed = false;
        return false;
      }
      if (!isNodeOfType(node, "ImportDeclaration") && isClosedJsonSnapshotInactiveBranch(node))
        return;
      if (
        (isNodeOfType(node, "Identifier") &&
          node.name === "require" &&
          candidateModule.scopes.isGlobalReference(node) &&
          !isClosedJsonSnapshotSideEffectRequire({
            node: node.parent ?? node,
            module: candidateModule,
            project,
          })) ||
        (isNodeOfType(node, "MemberExpression") && getStaticPropertyName(node) === "require")
      ) {
        isClosed = false;
        return false;
      }
      if (isNodeOfType(node, "ImportExpression")) {
        isClosed = false;
        return false;
      }
      if (
        isNodeOfType(node, "CallExpression") &&
        !isClosedJsonSnapshotSideEffectRequire({ node, module: candidateModule, project }) &&
        ((isNodeOfType(node.callee, "Identifier") && node.callee.name === "require") ||
          (isNodeOfType(node.callee, "MemberExpression") &&
            getStaticPropertyName(node.callee) === "require"))
      ) {
        isClosed = false;
        return false;
      }
      if (
        (isNodeOfType(node, "ExportAllDeclaration") ||
          isNodeOfType(node, "ExportNamedDeclaration")) &&
        isAntdSource(getStaticStringExpression(node.source))
      ) {
        isClosed = false;
        return false;
      }
      if (!isNodeOfType(node, "ImportDeclaration")) return;
      const source = getStaticStringExpression(node.source);
      if (!isAntdSource(source)) return;
      if (source && CLOSED_JSON_SNAPSHOT_LOCALE_STYLE_SOURCES.has(source)) {
        isClosed = node.specifiers.length === 0;
        return false;
      }
      for (const specifier of node.specifiers) {
        const symbol = candidateModule.scopes.symbolFor(specifier.local);
        if (!symbol) {
          isClosed = false;
          return false;
        }
        if (source === "antd") {
          if (!isNodeOfType(specifier, "ImportSpecifier")) {
            isClosed = false;
            return false;
          }
          if (getImportedName(specifier) === "LocaleProvider") providers.add(symbol);
          else if (getImportedName(specifier) === "Carousel") {
            if (!hasClosedJsonSnapshotJsxReferences(symbol)) {
              isClosed = false;
              return false;
            }
          } else if (
            symbol.references.some(
              (reference) => !isClosedJsonSnapshotInactiveBranch(reference.identifier),
            )
          ) {
            isClosed = false;
            return false;
          }
        } else if (source && CLOSED_JSON_SNAPSHOT_LOCALE_PROVIDER_SOURCES.has(source)) {
          if (!isNodeOfType(specifier, "ImportDefaultSpecifier")) {
            isClosed = false;
            return false;
          }
          providers.add(symbol);
        } else if (source && CLOSED_JSON_SNAPSHOT_LOCALE_DATA_SOURCES.has(source)) {
          if (!isNodeOfType(specifier, "ImportDefaultSpecifier")) {
            isClosed = false;
            return false;
          }
          locales.add(symbol);
        } else {
          isClosed = false;
          return false;
        }
      }
      if (
        source !== "antd" &&
        source &&
        !CLOSED_JSON_SNAPSHOT_LOCALE_PROVIDER_SOURCES.has(source) &&
        !CLOSED_JSON_SNAPSHOT_LOCALE_DATA_SOURCES.has(source)
      )
        isClosed = false;
      return false;
    });
    if (!isClosed) return false;
    bindingsByModule.set(candidateModule, { providers, locales });
  }
  const selectedBindings = bindingsByModule.get(module);
  if (!selectedBindings || !hasFixedLocaleCarrierShape(opening, module, selectedBindings))
    return false;
  let referenceCount = 0;
  for (const [candidateModule, bindings] of bindingsByModule) {
    for (const symbol of bindings.providers) {
      for (const reference of symbol.references) {
        if (isClosedJsonSnapshotInactiveBranch(reference.identifier)) continue;
        referenceCount += 1;
        if (
          referenceCount > CLOSED_JSON_SNAPSHOT_LOCALE_MAX_REFERENCES ||
          reference.flag !== "read"
        )
          return false;
        const parent = reference.identifier.parent;
        const referenceOpening =
          isNodeOfType(parent, "JSXOpeningElement") && parent.name === reference.identifier
            ? parent
            : isNodeOfType(parent, "JSXClosingElement") &&
                parent.name === reference.identifier &&
                isNodeOfType(parent.parent, "JSXElement")
              ? parent.parent.openingElement
              : null;
        if (
          !referenceOpening ||
          !hasFixedLocaleCarrierShape(referenceOpening, candidateModule, bindings)
        )
          return false;
      }
    }
    for (const symbol of bindings.locales) {
      for (const reference of symbol.references) {
        if (isClosedJsonSnapshotInactiveBranch(reference.identifier)) continue;
        referenceCount += 1;
        if (
          referenceCount > CLOSED_JSON_SNAPSHOT_LOCALE_MAX_REFERENCES ||
          reference.flag !== "read"
        )
          return false;
        const container = reference.identifier.parent;
        const attribute = container?.parent;
        const referenceOpening = attribute?.parent;
        if (
          !isNodeOfType(container, "JSXExpressionContainer") ||
          container.expression !== reference.identifier ||
          !isNodeOfType(attribute, "JSXAttribute") ||
          !isNodeOfType(referenceOpening, "JSXOpeningElement") ||
          !hasFixedLocaleCarrierShape(referenceOpening, candidateModule, bindings)
        )
          return false;
      }
    }
  }
  return true;
};
