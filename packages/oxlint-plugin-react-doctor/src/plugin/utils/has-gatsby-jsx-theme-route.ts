import * as fs from "node:fs";
import * as path from "node:path";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findExportedValue } from "./find-exported-value.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getStaticKeyName } from "./get-static-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { normalizeFilename } from "./normalize-filename.js";
import { isProvenStyledComponentExpression } from "./is-proven-styled-component-expression.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

type Opening = EsTreeNodeOfType<"JSXOpeningElement">;
type LocalFunction =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">;

interface GatsbyJsxThemeRouteInput {
  readonly project: SourceProjectIndex;
  readonly packageDirectory: string;
  readonly currentFilePath: string;
  readonly currentImage: Opening;
  readonly providerModule: SourceProjectModule;
  readonly providerOpening: Opening;
}

const GEOMETRY_PARENT_TAGS = new Set([
  "article",
  "aside",
  "div",
  "footer",
  "header",
  "main",
  "section",
]);

interface RenderPathOptions {
  readonly knownWrapper?: Opening;
  readonly permitRest?: SymbolDescriptor;
}

const hasUniqueSourceResolution = (from: string, source: string, selected: string): boolean => {
  const base = path.resolve(path.dirname(from), source);
  const candidateNames = [
    base,
    ...[".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".mts", ".cts", ".css", ".json"].flatMap(
      (extension) => [`${base}${extension}`, path.join(base, `index${extension}`)],
    ),
  ];
  const packageManifest = path.join(base, "package.json");
  recordExistenceProbe(packageManifest);
  if (fs.existsSync(packageManifest)) return false;
  const existing = candidateNames.filter((candidate) => {
    recordExistenceProbe(candidate);
    try {
      return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false;
    } catch {
      return false;
    }
  });
  return existing.length === 1 && normalizeFilename(existing[0]!) === selected;
};

const hasOnlyMetadataReferences = (
  component: LocalFunction,
  binding: SymbolDescriptor,
  module: SourceProjectModule,
): boolean =>
  hasCompleteSymbolReferences(binding, module.programNode, module.scopes) &&
  binding.references.every(({ identifier, flag }) => {
    if (flag !== "read") return false;
    const parent = identifier.parent;
    if (isNodeOfType(parent, "ExportDefaultDeclaration")) return parent.declaration === identifier;
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== identifier ||
      parent.computed
    ) {
      return false;
    }
    const assignment = parent.parent;
    if (
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== parent ||
      !isNodeOfType(assignment.right, "ObjectExpression") ||
      !isNodeOfType(assignment.parent, "ExpressionStatement") ||
      assignment.parent.parent !== module.programNode ||
      assignment.range[0] < component.range[1]
    )
      return false;
    const name = getStaticPropertyName(parent);
    if (name === "propTypes") return true;
    return (
      name === "defaultProps" &&
      assignment.right.properties.every(
        (property) =>
          isNodeOfType(property, "Property") &&
          !property.computed &&
          property.kind === "init" &&
          ["style", "innerStyle", "size"].includes(getStaticKeyName(property.key) ?? "") &&
          (isNodeOfType(property.value, "Literal") ||
            (isNodeOfType(property.value, "ObjectExpression") &&
              property.value.properties.length === 0)),
      )
    );
  });

const readDefaultComponent = (module: SourceProjectModule): LocalFunction | null => {
  const resolved = findExportedValue(module.programNode, "default");
  if (
    !isFunctionLike(resolved) ||
    resolved.async ||
    ("generator" in resolved && resolved.generator)
  )
    return null;
  const [binding, nextBinding] = getFunctionBindingSymbols(resolved, module.scopes);
  if (!binding || nextBinding || (binding.kind !== "const" && binding.kind !== "function"))
    return null;
  return hasOnlyMetadataReferences(resolved, binding, module) ? resolved : null;
};

const isRelativeRuntimeDefaultImport = (
  declaration: EsTreeNode | null | undefined,
): declaration is EsTreeNodeOfType<"ImportDeclaration"> =>
  isNodeOfType(declaration, "ImportDeclaration") &&
  declaration.importKind !== "type" &&
  typeof declaration.source.value === "string" &&
  /^\.\.?\//.test(declaration.source.value) &&
  declaration.specifiers.length === 1 &&
  isNodeOfType(declaration.specifiers[0], "ImportDefaultSpecifier");

const resolveDefaultImport = (
  project: SourceProjectIndex,
  module: SourceProjectModule,
  reference: EsTreeNode,
): SourceProjectModule | null => {
  const symbol = module.scopes.symbolFor(reference);
  const declaration = symbol?.declarationNode.parent;
  if (!isRelativeRuntimeDefaultImport(declaration) || typeof declaration.source.value !== "string")
    return null;
  const filePath = project.resolvedSourcePathByNode.get(declaration);
  if (!filePath || !hasUniqueSourceResolution(module.filePath, declaration.source.value, filePath))
    return null;
  return project.modulesByFilePath.get(filePath) ?? null;
};

const hasOrdinaryAttributes = (
  opening: Opening,
  module: SourceProjectModule,
  options: RenderPathOptions,
): boolean =>
  opening.attributes.every((attribute) => {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      return Boolean(
        options.permitRest &&
        isNodeOfType(attribute.argument, "Identifier") &&
        module.scopes.symbolFor(attribute.argument) === options.permitRest,
      );
    }
    return (
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      !["as", "forwardedAs", "theme", "ref", "dangerouslySetInnerHTML", "children"].includes(
        attribute.name.name,
      )
    );
  });

const pathThroughReturnMarkup = (
  start: EsTreeNode,
  owner: LocalFunction,
  checkOpening: (opening: Opening) => boolean,
): boolean => {
  let cursor = start;
  if (isNodeOfType(cursor, "JSXOpeningElement")) {
    if (!isNodeOfType(cursor.parent, "JSXElement")) return false;
    cursor = cursor.parent;
  }
  while (cursor !== owner.body) {
    const parent: EsTreeNode | null | undefined = cursor.parent;
    if (isNodeOfType(parent, "JSXElement")) {
      if (
        !parent.children.some((child) => Object.is(child, cursor)) ||
        !checkOpening(parent.openingElement)
      )
        return false;
    } else if (isNodeOfType(parent, "JSXFragment")) {
      if (!parent.children.some((child) => Object.is(child, cursor))) return false;
    } else if (isNodeOfType(parent, "JSXExpressionContainer")) {
      if (parent.expression !== cursor) return false;
    } else if (parent && String(parent.type) === "ParenthesizedExpression") {
      if (stripParenExpression(parent) !== stripParenExpression(cursor)) return false;
    } else if (isNodeOfType(parent, "ReturnStatement")) {
      if (parent.argument !== cursor || parent.parent !== owner.body) return false;
    } else if (!isNodeOfType(parent, "BlockStatement") || parent !== owner.body) {
      return false;
    }
    cursor = parent;
  }
  return true;
};

const readChildBinding = (component: LocalFunction, module: SourceProjectModule) => {
  const [parameter] = component.params;
  if (component.params.length !== 1 || !isNodeOfType(parameter, "ObjectPattern")) return null;
  let child: SymbolDescriptor | null = null;
  let rest: SymbolDescriptor | null = null;
  for (const property of parameter.properties) {
    if (isNodeOfType(property, "RestElement")) {
      if (rest || !isNodeOfType(property.argument, "Identifier")) return null;
      rest = module.scopes.symbolFor(property.argument) ?? null;
      if (
        !rest ||
        !hasCompleteSymbolReferences(rest, module.programNode, module.scopes) ||
        rest.references.length !== 1 ||
        rest.references[0]?.flag !== "read" ||
        !isNodeOfType(rest.references[0].identifier.parent, "JSXSpreadAttribute")
      )
        return null;
    } else {
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.kind !== "init" ||
        !isNodeOfType(property.value, "Identifier")
      )
        return null;
      if (getStaticKeyName(property.key) !== "children") continue;
      if (child) return null;
      child = module.scopes.symbolFor(property.value) ?? null;
    }
  }
  if (
    !child ||
    !hasCompleteSymbolReferences(child, module.programNode, module.scopes) ||
    child.references.length !== 1 ||
    child.references[0]?.flag !== "read"
  )
    return null;
  return { reference: child.references[0].identifier, rest };
};

const isStyledIntrinsicTag = (
  initializer: EsTreeNodeOfType<"TaggedTemplateExpression">,
  module: SourceProjectModule,
): boolean => {
  const tag = initializer.tag;
  return (
    isProvenStyledComponentExpression(initializer, module.scopes) &&
    isNodeOfType(tag, "MemberExpression") &&
    !tag.computed &&
    !tag.optional &&
    isNodeOfType(tag.property, "Identifier") &&
    GEOMETRY_PARENT_TAGS.has(tag.property.name)
  );
};

const createRenderPathChecker = (project: SourceProjectIndex) => {
  const checkOpening = (
    opening: Opening,
    module: SourceProjectModule,
    options: RenderPathOptions,
  ): boolean => {
    if (opening === options.knownWrapper) return true;
    if (
      !hasOrdinaryAttributes(opening, module, options) ||
      !isNodeOfType(opening.name, "JSXIdentifier")
    )
      return false;
    if (GEOMETRY_PARENT_TAGS.has(opening.name.name)) return true;
    const symbol = module.scopes.symbolFor(opening.name);
    const initializer = symbol ? getDirectConstInitializer(symbol) : null;
    if (!isNodeOfType(initializer, "TaggedTemplateExpression")) return false;
    if (isStyledIntrinsicTag(initializer, module)) return true;
    const factory = initializer.tag;
    if (
      !isProvenStyledComponentExpression(initializer, module.scopes) ||
      !isNodeOfType(factory, "CallExpression") ||
      factory.optional ||
      factory.arguments.length !== 1 ||
      !isNodeOfType(factory.arguments[0], "Identifier")
    )
      return false;
    const forwardingModule = resolveDefaultImport(project, module, factory.arguments[0]);
    const forwarder = forwardingModule && readDefaultComponent(forwardingModule);
    if (
      !forwardingModule ||
      !forwarder ||
      !isNodeOfType(stripParenExpression(forwarder.body), "JSXElement")
    )
      return false;
    const child = readChildBinding(forwarder, forwardingModule);
    if (!child || !isNodeOfType(child.reference.parent, "JSXExpressionContainer")) return false;
    const passesMarkedChild = pathThroughReturnMarkup(child.reference, forwarder, (ancestor) => {
      if (
        !hasOrdinaryAttributes(
          ancestor,
          forwardingModule,
          child.rest ? { permitRest: child.rest } : {},
        ) ||
        !isNodeOfType(ancestor.name, "JSXIdentifier")
      )
        return false;
      if (GEOMETRY_PARENT_TAGS.has(ancestor.name.name)) return true;
      const binding = forwardingModule.scopes.symbolFor(ancestor.name);
      const local = binding ? getDirectConstInitializer(binding) : null;
      return (
        isNodeOfType(local, "TaggedTemplateExpression") &&
        isStyledIntrinsicTag(local, forwardingModule)
      );
    });
    return passesMarkedChild;
  };
  return checkOpening;
};

const readOnlyImportedJsxOpenings = (
  used: SourceProjectModule,
  consumer: SourceProjectModule,
  project: SourceProjectIndex,
): ReadonlyArray<Opening> | null => {
  let declarations = 0;
  let invalid = false;
  const openings: Opening[] = [];
  walkAst(consumer.programNode, (node) => {
    if (invalid) return false;
    if (project.resolvedSourcePathByNode.get(node) !== used.filePath) return;
    declarations += 1;
    if (
      !isRelativeRuntimeDefaultImport(node) ||
      typeof node.source.value !== "string" ||
      !hasUniqueSourceResolution(consumer.filePath, node.source.value, used.filePath)
    ) {
      invalid = true;
      return false;
    }
    const binding = consumer.scopes.symbolFor(node.specifiers[0]!.local);
    if (!binding || !hasCompleteSymbolReferences(binding, consumer.programNode, consumer.scopes)) {
      invalid = true;
      return false;
    }
    for (const { identifier, flag } of binding.references) {
      const parent = identifier.parent;
      if (
        flag !== "read" ||
        !isNodeOfType(identifier, "JSXIdentifier") ||
        (!isNodeOfType(parent, "JSXOpeningElement") &&
          !isNodeOfType(parent, "JSXClosingElement")) ||
        parent.name !== identifier
      ) {
        invalid = true;
        break;
      }
      if (isNodeOfType(parent, "JSXOpeningElement")) openings.push(parent);
    }
  });
  return !invalid && declarations === 1 && openings.length > 0 ? openings : null;
};

const readExactIndexModule = (
  project: SourceProjectIndex,
  packageDirectory: string,
  subdirectory: "pages" | "layouts",
): SourceProjectModule | null => {
  const base = path.join(packageDirectory, "src", subdirectory, "index");
  const matches = [...project.modulesByFilePath.entries()].filter(
    ([filePath]) => filePath.startsWith(base + ".") || filePath.startsWith(base + path.sep),
  );
  const [match] = matches;
  return matches.length === 1 && match && (match[0] === base + ".js" || match[0] === base + ".jsx")
    ? match[1]
    : null;
};

export const hasGatsbyJsxThemeRoute = ({
  project,
  packageDirectory,
  currentFilePath,
  currentImage,
  providerModule,
  providerOpening,
}: GatsbyJsxThemeRouteInput): boolean => {
  if (project.hasOpaqueMdxConsumerSurface || project.htmlFilePaths.length) return false;
  const page = readExactIndexModule(project, packageDirectory, "pages");
  const layout = readExactIndexModule(project, packageDirectory, "layouts");
  let componentModule = project.modulesByFilePath.get(currentFilePath);
  if (!page || !layout || !componentModule) return false;
  const checkOpening = createRenderPathChecker(project);
  const target = readDefaultComponent(componentModule);
  if (!target) return false;
  if (findEnclosingFunction(currentImage) !== target) return false;
  if (
    !pathThroughReturnMarkup(currentImage, target, (opening) =>
      checkOpening(opening, componentModule!, {}),
    )
  )
    return false;
  const visited = new Set<string>();
  while (componentModule !== page) {
    if (visited.has(componentModule.filePath)) return false;
    visited.add(componentModule.filePath);
    const consumers = project.consumerModulesByFilePath.get(componentModule.filePath);
    if (consumers?.size !== 1) return false;
    const [consumer] = consumers;
    if (!consumer) return false;
    const renderingComponent = readDefaultComponent(consumer);
    const instances = readOnlyImportedJsxOpenings(componentModule, consumer, project);
    if (
      !renderingComponent ||
      !instances ||
      !instances.every(
        (opening) =>
          hasOrdinaryAttributes(opening, consumer, {}) &&
          findEnclosingFunction(opening) === renderingComponent &&
          pathThroughReturnMarkup(opening, renderingComponent, (ancestor) =>
            checkOpening(ancestor, consumer, {}),
          ),
      )
    )
      return false;
    componentModule = consumer;
  }
  if (project.consumerModulesByFilePath.get(page.filePath)?.size) return false;
  const layoutComponent = readDefaultComponent(layout);
  const wrapper = readDefaultComponent(providerModule);
  if (!layoutComponent || !wrapper) return false;
  const layoutRoot = stripParenExpression(layoutComponent.body);
  const providerRoot = stripParenExpression(wrapper.body);
  if (
    !isNodeOfType(layoutRoot, "JSXElement") ||
    !isNodeOfType(providerRoot, "JSXElement") ||
    providerRoot.openingElement !== providerOpening ||
    resolveDefaultImport(project, layout, layoutRoot.openingElement.name) !== providerModule ||
    !hasOrdinaryAttributes(layoutRoot.openingElement, layout, {})
  )
    return false;
  const layoutChild = readChildBinding(layoutComponent, layout);
  const wrapperChild = readChildBinding(wrapper, providerModule);
  if (!layoutChild || !wrapperChild || layoutChild.rest || wrapperChild.rest) return false;
  const invocation = layoutChild.reference.parent;
  if (
    !isNodeOfType(invocation, "CallExpression") ||
    invocation.optional ||
    invocation.callee !== layoutChild.reference ||
    invocation.arguments.length !== 0 ||
    !isNodeOfType(invocation.parent, "JSXExpressionContainer") ||
    !isNodeOfType(wrapperChild.reference.parent, "JSXExpressionContainer") ||
    !pathThroughReturnMarkup(invocation, layoutComponent, (opening) =>
      checkOpening(opening, layout, { knownWrapper: layoutRoot.openingElement }),
    ) ||
    !pathThroughReturnMarkup(wrapperChild.reference, wrapper, (opening) =>
      checkOpening(opening, providerModule, { knownWrapper: providerOpening }),
    )
  )
    return false;
  return true;
};
