import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasJsxPropIgnoreCase } from "./has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "./has-jsx-spread-attribute.js";
import { isFunctionLike } from "./is-function-like.js";
import { isPropertyNamePosition } from "./is-property-name-position.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveCrossFileFunctionExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveRelativeImportPath } from "./resolve-relative-import-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ClosedIframeSymbol {
  readonly symbol: SymbolDescriptor;
  readonly reads: ReadonlySet<EsTreeNode>;
}

interface IframeProgramInspection {
  readonly hasStableSyntax: boolean;
  readonly componentTagClosureBySymbol: WeakMap<SymbolDescriptor, boolean>;
}

interface IframeProviderInspection {
  scopes?: ScopeAnalysis;
  readonly certificatesByComponent: WeakMap<EsTreeNode, boolean>;
}

const programInspectionsByProgram = new WeakMap<
  EsTreeNode,
  WeakMap<ScopeAnalysis, IframeProgramInspection>
>();
const providerInspectionsByProgram = new WeakMap<EsTreeNode, IframeProviderInspection>();

const isRuntimeReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (node.type !== "Identifier" && node.type !== "JSXIdentifier") return false;
  if (scopes.referenceFor(node)) return true;
  if (scopes.symbolFor(node)?.bindingIdentifier === node) return false;
  const parent = node.parent;
  if (
    isPropertyNamePosition(node) &&
    !(
      parent?.type === "Property" &&
      parent.value === node &&
      parent.parent?.type === "ObjectExpression"
    )
  )
    return false;
  if (parent?.type === "LabeledStatement" && parent.label === node) return false;
  if (
    (parent?.type === "BreakStatement" || parent?.type === "ContinueStatement") &&
    parent.label === node
  )
    return false;
  if (
    (parent?.type === "MethodDefinition" ||
      parent?.type === "PropertyDefinition" ||
      parent?.type === "AccessorProperty") &&
    parent.key === node &&
    !parent.computed
  )
    return false;
  if (
    parent?.type === "ImportSpecifier" ||
    parent?.type === "ImportDefaultSpecifier" ||
    parent?.type === "ImportNamespaceSpecifier"
  )
    return false;
  if (parent?.type === "ExportSpecifier" && parent.exported === node && parent.local !== node)
    return false;
  return true;
};

const hasStableComponentSyntax = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let stable = true;
  walkAst(program, (node) => {
    if (!stable) return false;
    if (
      node.type === "WithStatement" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSExportAssignment" ||
      node.type === "TSParameterProperty" ||
      (node.type === "Identifier" && node.name === "arguments")
    ) {
      stable = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      node.type === "Identifier" &&
      (node.name === "eval" || node.name === "Function") &&
      isRuntimeReference(node, scopes)
    )
      stable = false;
    if (node.type === "MemberExpression") {
      const property = getStaticPropertyName(node);
      const receiver = stripParenExpression(node.object);
      if (
        property === "constructor" ||
        property === "__proto__" ||
        property === "__defineGetter__" ||
        property === "__defineSetter__" ||
        property === "eval" ||
        property === "Function"
      )
        stable = false;
      if (
        receiver.type === "Identifier" &&
        (receiver.name === "Object" || receiver.name === "Reflect")
      ) {
        if (
          property === null ||
          property === "assign" ||
          property === "defineProperty" ||
          property === "defineProperties" ||
          property === "setPrototypeOf" ||
          property === "set" ||
          property === "get" ||
          property === "deleteProperty" ||
          property === "prototype" ||
          property === "getPrototypeOf" ||
          property === "getOwnPropertyDescriptor" ||
          property === "getOwnPropertyDescriptors"
        )
          stable = false;
      }
    }
    if (
      node.type === "MemberExpression" &&
      (getStaticPropertyName(node) === "defaultProps" || getStaticPropertyName(node) === null) &&
      isWithinAssignmentTarget(node)
    )
      stable = false;
    if (
      node.type === "Identifier" &&
      (node.name === "window" ||
        node.name === "globalThis" ||
        node.name === "self" ||
        node.name === "Object" ||
        node.name === "Reflect") &&
      isRuntimeReference(node, scopes)
    ) {
      const root = findTransparentExpressionRoot(node);
      if (
        root.parent?.type !== "MemberExpression" ||
        root.parent.object !== root ||
        getStaticPropertyName(root.parent) === null
      )
        stable = false;
    }
    if (
      node.type === "MemberExpression" &&
      (getStaticPropertyName(node) === "window" ||
        getStaticPropertyName(node) === "globalThis" ||
        getStaticPropertyName(node) === "self")
    ) {
      const root = findTransparentExpressionRoot(node);
      if (
        root.parent?.type !== "MemberExpression" ||
        root.parent.object !== root ||
        getStaticPropertyName(root.parent) === null
      )
        stable = false;
    }
    if (
      node.type === "MemberExpression" &&
      (getStaticPropertyName(node) === "Object" || getStaticPropertyName(node) === "Reflect")
    )
      stable = false;
    if (node.type === "Property" && node.parent?.type === "ObjectPattern") {
      const property = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (
        property === "constructor" ||
        property === "__proto__" ||
        property === "__defineGetter__" ||
        property === "__defineSetter__" ||
        property === "prototype" ||
        property === "getPrototypeOf" ||
        property === "getOwnPropertyDescriptor" ||
        property === "getOwnPropertyDescriptors" ||
        property === "eval" ||
        property === "Function"
      )
        stable = false;
    }
  });
  return stable;
};

const isComponentTagReference = (node: EsTreeNode): boolean =>
  node.type === "JSXIdentifier" &&
  (node.parent?.type === "JSXOpeningElement" || node.parent?.type === "JSXClosingElement") &&
  node.parent.name === node;

const hasClosedSymbolUses = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  selected: ReadonlyArray<ClosedIframeSymbol>,
): boolean => {
  if (new Set(selected.map(({ symbol }) => symbol.name)).size !== selected.length) return false;
  if (
    selected.some(({ symbol }) => symbol.references.some((reference) => reference.flag !== "read"))
  )
    return false;
  let closed = true;
  walkAst(program, (node) => {
    if (!closed) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (node.type !== "Identifier" && node.type !== "JSXIdentifier") ||
      !isRuntimeReference(node, scopes)
    )
      return;
    const entry = selected.find(({ symbol }) => symbol.name === node.name);
    if (!entry) return;
    const reference = scopes.referenceFor(node);
    if (reference?.resolvedSymbol && reference.resolvedSymbol !== entry.symbol) return;
    if (
      !reference ||
      reference.flag !== "read" ||
      !entry.reads.has(node) ||
      isWithinAssignmentTarget(findTransparentExpressionRoot(node))
    )
      closed = false;
  });
  return closed;
};

const componentTagReads = (symbol: SymbolDescriptor): ReadonlySet<EsTreeNode> =>
  new Set(
    symbol.references.map((reference) => reference.identifier).filter(isComponentTagReference),
  );

const hasNativeReturnAncestry = (iframe: EsTreeNode, returned: EsTreeNode): boolean => {
  let current = iframe;
  while (current !== returned) {
    const parent = current.parent;
    if (!parent) return false;
    if (parent.type === "JSXFragment" && parent.children.some((child) => child === current)) {
      current = parent;
      continue;
    }
    if (
      parent.type !== "JSXElement" ||
      !parent.children.some((child) => child === current) ||
      parent.openingElement.name.type !== "JSXIdentifier" ||
      !/^[a-z]/.test(parent.openingElement.name.name)
    )
      return false;
    current = parent;
  }
  return true;
};

const getProgramInspection = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): IframeProgramInspection => {
  let inspections = programInspectionsByProgram.get(program);
  if (!inspections) {
    inspections = new WeakMap();
    programInspectionsByProgram.set(program, inspections);
  }
  let inspection = inspections.get(scopes);
  if (!inspection) {
    inspection = {
      hasStableSyntax: hasStableComponentSyntax(program, scopes),
      componentTagClosureBySymbol: new WeakMap(),
    };
    inspections.set(scopes, inspection);
  }
  return inspection;
};

const inspectIframeProviderComponent = (
  component: EsTreeNode,
  providerProgram: EsTreeNode,
  inspection: IframeProviderInspection,
): boolean => {
  if (
    !isFunctionLike(component) ||
    component.async ||
    (component.type !== "ArrowFunctionExpression" && component.generator) ||
    component.params.length !== 1 ||
    component.params[0]?.type !== "Identifier" ||
    component.body.type !== "BlockStatement"
  )
    return false;
  const componentParent = component.parent;
  let binding: EsTreeNode | null = null;
  if (
    component.type === "FunctionDeclaration" &&
    componentParent?.type === "ExportNamedDeclaration" &&
    componentParent.declaration === component
  )
    binding = component.id;
  if (
    component.type === "ArrowFunctionExpression" &&
    componentParent?.type === "VariableDeclarator" &&
    componentParent.id.type === "Identifier" &&
    componentParent.init === component &&
    componentParent.parent?.type === "VariableDeclaration" &&
    componentParent.parent.kind === "const" &&
    componentParent.parent.parent?.type === "ExportNamedDeclaration" &&
    componentParent.parent.parent.declaration === componentParent.parent
  )
    binding = componentParent.id;
  if (!binding) return false;
  const scopes = (inspection.scopes ??= analyzeScopes(providerProgram));
  const componentSymbol = scopes.symbolFor(binding);
  const propsSymbol = scopes.symbolFor(component.params[0]);
  if (
    !componentSymbol ||
    !propsSymbol ||
    !getProgramInspection(providerProgram, scopes).hasStableSyntax
  )
    return false;
  if (
    component.body.body.some(
      (statement) =>
        statement.type !== "VariableDeclaration" &&
        statement.type !== "FunctionDeclaration" &&
        statement.type !== "ExpressionStatement" &&
        statement.type !== "ReturnStatement" &&
        statement.type !== "EmptyStatement",
    )
  )
    return false;
  const destructures = component.body.body.flatMap((statement) =>
    statement.type === "VariableDeclaration" && statement.kind === "const"
      ? statement.declarations.filter(
          (candidate) =>
            candidate.id.type === "ObjectPattern" &&
            candidate.init?.type === "Identifier" &&
            scopes.symbolFor(candidate.init) === propsSymbol,
        )
      : [],
  );
  const destructure = destructures.length === 1 ? destructures[0] : null;
  if (!destructure || destructure.id.type !== "ObjectPattern" || !destructure.init) return false;
  let rest: EsTreeNode | null = null;
  for (const property of destructure.id.properties) {
    if (property.type === "RestElement") {
      if (
        rest ||
        property !== destructure.id.properties.at(-1) ||
        property.argument.type !== "Identifier"
      )
        return false;
      rest = property.argument;
      continue;
    }
    if (
      property.type !== "Property" ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    )
      return false;
    if (property.value.type === "Identifier") continue;
    if (
      property.value.type !== "AssignmentPattern" ||
      property.value.left.type !== "Identifier" ||
      property.value.right.type !== "Literal" ||
      (property.value.right.value !== null && typeof property.value.right.value === "object")
    )
      return false;
  }
  const restSymbol = rest ? scopes.symbolFor(rest) : null;
  if (!restSymbol) return false;
  const returns: EsTreeNodeOfType<"ReturnStatement">[] = [];
  walkAst(component.body, (node) => {
    if (isFunctionLike(node) || node.type === "ClassDeclaration" || node.type === "ClassExpression")
      return false;
    if (node.type === "ReturnStatement") returns.push(node);
  });
  const returnedArgument =
    returns.length === 1 && returns[0]?.parent === component.body ? returns[0].argument : null;
  const returned = returnedArgument ? stripParenExpression(returnedArgument) : null;
  if (
    !returned ||
    (returned.type !== "JSXElement" && returned.type !== "JSXFragment") ||
    getNodeEndIndex(destructure) >= getNodeStartIndex(returned)
  )
    return false;
  const iframes: EsTreeNodeOfType<"JSXElement">[] = [];
  walkAst(returned, (node) => {
    if (
      node.type === "JSXElement" &&
      node.openingElement.name.type === "JSXIdentifier" &&
      node.openingElement.name.name === "iframe"
    )
      iframes.push(node);
  });
  const iframe = iframes.length === 1 ? iframes[0] : null;
  if (!iframe || !hasNativeReturnAncestry(iframe, returned)) return false;
  const opening = iframe.openingElement;
  if (
    !hasJsxPropIgnoreCase(opening.attributes, "srcDoc") ||
    hasJsxPropIgnoreCase(opening.attributes, "src") ||
    hasJsxPropIgnoreCase(opening.attributes, "sandbox") ||
    hasJsxPropIgnoreCase(opening.attributes, "allow")
  )
    return false;
  const spreads = opening.attributes.filter((attribute) => attribute.type === "JSXSpreadAttribute");
  const spread = spreads.length === 1 ? spreads[0] : null;
  if (
    !spread ||
    spread.argument.type !== "Identifier" ||
    scopes.symbolFor(spread.argument) !== restSymbol
  )
    return false;
  return hasClosedSymbolUses(providerProgram, scopes, [
    { symbol: componentSymbol, reads: componentTagReads(componentSymbol) },
    { symbol: propsSymbol, reads: new Set([destructure.init]) },
    { symbol: restSymbol, reads: new Set([spread.argument]) },
  ]);
};

export const hasKnownUnsandboxedIframeCaller = (
  caller: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (
    !context.filename ||
    caller.name.type !== "JSXIdentifier" ||
    hasJsxSpreadAttribute(caller.attributes) ||
    hasJsxPropIgnoreCase(caller.attributes, "sandbox") ||
    hasJsxPropIgnoreCase(caller.attributes, "allow")
  )
    return false;
  const imported = context.scopes.symbolFor(caller.name);
  if (
    !imported ||
    imported.kind !== "import" ||
    imported.declarationNode.type !== "ImportSpecifier"
  )
    return false;
  const declaration = getImportDeclarationForSymbol(imported);
  const exportedName = getImportedName(imported.declarationNode);
  const source = declaration?.source.value;
  if (
    !declaration ||
    declaration.importKind === "type" ||
    imported.declarationNode.importKind === "type" ||
    !exportedName ||
    typeof source !== "string" ||
    !source.startsWith(".")
  )
    return false;
  const callerProgram = findProgramRoot(caller);
  if (!callerProgram) return false;
  const callerInspection = getProgramInspection(callerProgram, context.scopes);
  if (!callerInspection.hasStableSyntax) return false;
  let hasClosedImportUses = callerInspection.componentTagClosureBySymbol.get(imported);
  if (hasClosedImportUses === undefined) {
    hasClosedImportUses = hasClosedSymbolUses(callerProgram, context.scopes, [
      { symbol: imported, reads: componentTagReads(imported) },
    ]);
    callerInspection.componentTagClosureBySymbol.set(imported, hasClosedImportUses);
  }
  if (!hasClosedImportUses) return false;
  const directPath = resolveRelativeImportPath(context.filename, source);
  const resolved = resolveCrossFileFunctionExportWithFilePath(
    context.filename,
    source,
    exportedName,
  );
  if (!directPath || !resolved || resolved.filePath !== directPath) return false;
  const component = resolved.functionNode;
  const providerProgram = resolved.programNode;
  let providerInspection = providerInspectionsByProgram.get(providerProgram);
  if (!providerInspection) {
    providerInspection = { certificatesByComponent: new WeakMap() };
    providerInspectionsByProgram.set(providerProgram, providerInspection);
  }
  const cachedCertificate = providerInspection.certificatesByComponent.get(component);
  if (cachedCertificate !== undefined) return cachedCertificate;
  const hasCertifiedComponent = inspectIframeProviderComponent(
    component,
    providerProgram,
    providerInspection,
  );
  providerInspection.certificatesByComponent.set(component, hasCertifiedComponent);
  return hasCertifiedComponent;
};
