import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import type { ResolvedStaticPropertyNameOptions } from "./get-resolved-static-property-name.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isKeyedDraftTypeReference } from "./is-keyed-draft-type-reference.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isEverySpecifierInlineType, isTypeOnlyImport } from "./is-type-only-import.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { walkAst } from "./walk-ast.js";

export interface SplideModuleProof {
  readonly valid: boolean;
  readonly splideDeclarations: ReadonlySet<EsTreeNode>;
  readonly runtimeImports: ReadonlyArray<EsTreeNodeOfType<"ImportDeclaration">>;
  readonly providerClosures: WeakMap<SymbolDescriptor, boolean>;
  readonly iteratorClosures: WeakMap<SymbolDescriptor, boolean>;
}

const proofsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, SplideModuleProof>>();
const PROPERTY_NAME_OPTIONS: ResolvedStaticPropertyNameOptions = {
  allowConstNumericLiteral: true,
  allowConstTemplateLiteral: true,
  stringifyNonStringLiterals: true,
};
const RUNTIME_TYPESCRIPT_CONTAINERS = new Set([
  "TSModuleDeclaration",
  "TSEnumDeclaration",
  "TSParameterProperty",
  "TSExportAssignment",
  "TSImportEqualsDeclaration",
  "Decorator",
]);
const DYNAMIC_CAPABILITY_NAMES = new Set([
  "eval",
  "Function",
  "Reflect",
  "require",
  "module",
  "exports",
  "globalThis",
  "global",
  "self",
  "window",
  "process",
]);
const LIFECYCLE_NAMES = new Set(["componentDidMount", "componentWillUnmount"]);
const DESCRIPTOR_METHODS = new Set([
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
  "getPrototypeOf",
  "__defineGetter__",
  "__defineSetter__",
]);

export const getSplideModuleProof = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): SplideModuleProof => {
  let proofsByProgram = proofsByScopes.get(scopes);
  if (!proofsByProgram) {
    proofsByProgram = new WeakMap();
    proofsByScopes.set(scopes, proofsByProgram);
  }
  const cached = proofsByProgram.get(program);
  if (cached) return cached;
  let valid = true;
  const splideDeclarations = new Set<EsTreeNode>();
  const runtimeImports: EsTreeNodeOfType<"ImportDeclaration">[] = [];
  walkAst(program, (candidate) => {
    if (!valid) return false;
    if (RUNTIME_TYPESCRIPT_CONTAINERS.has(candidate.type)) {
      valid = false;
      return false;
    }
    if (isKeyedDraftTypeReference(candidate)) return false;
    if (isNodeOfType(candidate, "ImportExpression")) valid = false;
    if (isNodeOfType(candidate, "ImportDeclaration") && !isTypeOnlyImport(candidate)) {
      runtimeImports.push(candidate);
      if (["node:module", "module"].includes(candidate.source.value)) valid = false;
      if (candidate.source.value === "@splidejs/splide") {
        for (const specifier of candidate.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          if (
            !isNodeOfType(specifier, "ImportSpecifier") ||
            getImportedName(specifier) === "default"
          )
            valid = false;
          if (getImportedName(specifier) === "Splide") splideDeclarations.add(specifier);
        }
      }
    }
    if (
      ((isNodeOfType(candidate, "ExportNamedDeclaration") &&
        !isEverySpecifierInlineType(candidate.specifiers, "ExportSpecifier", "exportKind")) ||
        isNodeOfType(candidate, "ExportAllDeclaration")) &&
      candidate.source &&
      !["react", "@splidejs/splide"].includes(candidate.source.value)
    )
      valid = false;
    if (
      isNodeOfType(candidate, "Property") &&
      isNodeOfType(candidate.parent, "ObjectPattern") &&
      ["constructor", "__proto__"].includes(
        getResolvedStaticPropertyName(candidate, scopes, PROPERTY_NAME_OPTIONS) ?? "",
      )
    )
      valid = false;
    if (
      isNodeOfType(candidate, "Property") &&
      isNodeOfType(candidate.parent, "ObjectPattern") &&
      candidate.computed &&
      getResolvedStaticPropertyName(candidate, scopes, PROPERTY_NAME_OPTIONS) === null
    )
      valid = false;
    if (isNodeOfType(candidate, "MemberExpression")) {
      const property = getResolvedStaticPropertyName(candidate, scopes, PROPERTY_NAME_OPTIONS);
      if (
        candidate.computed &&
        property === null &&
        !(
          isNodeOfType(candidate.object, "MemberExpression") &&
          !candidate.object.computed &&
          !candidate.object.optional &&
          isNodeOfType(candidate.object.object, "ThisExpression") &&
          getStaticPropertyName(candidate.object) === "props"
        )
      )
        valid = false;
      if (
        ["constructor", "__proto__"].includes(property ?? "") ||
        (property && LIFECYCLE_NAMES.has(property))
      )
        valid = false;
      if (
        isNodeOfType(candidate.object, "Identifier") &&
        ((candidate.object.name === "Object" && property && DESCRIPTOR_METHODS.has(property)) ||
          candidate.object.name === "Reflect")
      )
        valid = false;
    }
    if (!isNodeOfType(candidate, "Identifier")) return;
    const parent = candidate.parent;
    if (
      (isNodeOfType(parent, "MemberExpression") &&
        parent.property === candidate &&
        !parent.computed) ||
      (isNodeOfType(parent, "Property") &&
        parent.key === candidate &&
        !parent.computed &&
        !parent.shorthand) ||
      ((isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition")) &&
        parent.key === candidate &&
        !parent.computed) ||
      (isNodeOfType(parent, "ImportSpecifier") && parent.imported === candidate) ||
      (isNodeOfType(parent, "ExportSpecifier") &&
        parent.exported === candidate &&
        parent.local !== candidate) ||
      ((isNodeOfType(parent, "LabeledStatement") ||
        isNodeOfType(parent, "BreakStatement") ||
        isNodeOfType(parent, "ContinueStatement")) &&
        parent.label === candidate)
    )
      return;
    const symbol = scopes.symbolFor(candidate);
    if (symbol?.bindingIdentifier === candidate) return;
    if (DYNAMIC_CAPABILITY_NAMES.has(candidate.name)) valid = false;
    if (
      candidate.name === "Object" &&
      (!isNodeOfType(parent, "MemberExpression") || parent.object !== candidate)
    )
      valid = false;
    if (candidate.name === "Array") {
      const prototype = parent;
      const slice = prototype?.parent;
      const callMember = slice?.parent;
      if (
        !isNodeOfType(prototype, "MemberExpression") ||
        prototype.object !== candidate ||
        getStaticPropertyName(prototype) !== "prototype" ||
        !isNodeOfType(slice, "MemberExpression") ||
        slice.object !== prototype ||
        getStaticPropertyName(slice) !== "slice" ||
        !isNodeOfType(callMember, "MemberExpression") ||
        callMember.object !== slice ||
        getStaticPropertyName(callMember) !== "call" ||
        !isNodeOfType(callMember.parent, "CallExpression") ||
        callMember.parent.callee !== callMember
      )
        valid = false;
    }
    if (
      symbol &&
      getValueImportSource(symbol) === "react" &&
      candidate !== symbol.bindingIdentifier &&
      (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
        isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"))
    ) {
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== candidate ||
        parent.computed ||
        !["Component", "PureComponent", "createRef"].includes(
          getStaticPropertyName(parent) ?? "",
        ) ||
        isWithinAssignmentTarget(parent)
      )
        valid = false;
    }
  });
  const proof: SplideModuleProof = {
    valid,
    splideDeclarations,
    runtimeImports,
    providerClosures: new WeakMap(),
    iteratorClosures: new WeakMap(),
  };
  proofsByProgram.set(program, proof);
  return proof;
};
