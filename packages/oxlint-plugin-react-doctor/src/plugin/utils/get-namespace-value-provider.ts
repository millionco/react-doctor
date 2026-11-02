import type { ScopeDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { collectPatternNames } from "./collect-pattern-names.js";
import { isFunctionLike } from "./is-function-like.js";

export interface NamespaceValueProvider {
  readonly scope: ScopeDescriptor | null;
  readonly hasGlobalProvider: boolean;
}

interface NamespaceValueGroup {
  readonly exportedNames: Set<string>;
  readonly parent: NamespaceValueGroup | null;
}

interface NamespaceValueProviderIndex {
  readonly rootScope: ScopeDescriptor;
  readonly globalNames: Set<string>;
  readonly localNamesByScope: Map<ScopeDescriptor, Set<string>>;
  readonly namespaceGroupsByScope: Map<ScopeDescriptor, NamespaceValueGroup>;
  readonly providersByScope: Map<ScopeDescriptor, Map<string, NamespaceValueProvider>>;
}

interface NamespacePathSegment {
  readonly key: string;
  readonly name: string | null;
}

interface NamespaceExportAlias {
  readonly scope: ScopeDescriptor;
  readonly group: NamespaceValueGroup;
  readonly localName: string;
  readonly exportedName: string;
  readonly hasExternalSource: boolean;
}

interface NamespaceScopeFrame {
  readonly scope: ScopeDescriptor;
  readonly isAmbient: boolean;
  readonly hasImplicitExports: boolean;
}

const indexesByScope = new WeakMap<ScopeDescriptor, NamespaceValueProviderIndex>();

const getScopeStatements = (scope: ScopeDescriptor): ReadonlyArray<EsTreeNode> => {
  const owner = scope.node;
  if (owner.type === "Program" || owner.type === "BlockStatement" || owner.type === "StaticBlock") {
    return owner.body;
  }
  if (isFunctionLike(owner) && owner.body.type === "BlockStatement") {
    return scope.children.some((childScope) => childScope.node === owner.body)
      ? []
      : owner.body.body;
  }
  if (owner.type === "TSModuleDeclaration" && owner.body?.type === "TSModuleBlock") {
    return owner.body.body;
  }
  if (owner.type === "CatchClause") return owner.body.body;
  if (owner.type === "SwitchStatement") return owner.cases.flatMap((branch) => branch.consequent);
  return [];
};

const collectValueDeclarationNames = (declaration: EsTreeNode, names: Set<string>): void => {
  if (declaration.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations) collectPatternNames(declarator.id, names);
    return;
  }
  if (declaration.type === "ImportDeclaration") {
    if (declaration.importKind === "type") return;
    for (const specifier of declaration.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind !== "type") {
        names.add(specifier.local.name);
      }
    }
    return;
  }
  if (declaration.type === "TSImportEqualsDeclaration" && declaration.importKind === "type") return;
  if (declaration.type === "TSModuleDeclaration" && declaration.global) return;
  if (
    declaration.type === "TSDeclareFunction" ||
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "ClassDeclaration" ||
    declaration.type === "TSEnumDeclaration" ||
    declaration.type === "TSModuleDeclaration" ||
    declaration.type === "TSImportEqualsDeclaration"
  ) {
    let declarationIdentifier: EsTreeNode | null | undefined = declaration.id;
    while (declarationIdentifier?.type === "TSQualifiedName") {
      declarationIdentifier = declarationIdentifier.left;
    }
    if (declarationIdentifier?.type === "Identifier") names.add(declarationIdentifier.name);
  }
};

const buildNamespaceValueProviderIndex = (
  rootScope: ScopeDescriptor,
): NamespaceValueProviderIndex => {
  const index: NamespaceValueProviderIndex = {
    rootScope,
    globalNames: new Set(),
    localNamesByScope: new Map(),
    namespaceGroupsByScope: new Map(),
    providersByScope: new Map(),
  };
  const namespaceGroupsByOwner = new Map<
    ScopeDescriptor | NamespaceValueGroup,
    Map<string, NamespaceValueGroup>
  >();
  const pendingScopes: NamespaceScopeFrame[] = [
    { scope: rootScope, isAmbient: false, hasImplicitExports: false },
  ];
  const exportAliases: NamespaceExportAlias[] = [];
  while (pendingScopes.length > 0) {
    const frame = pendingScopes.pop();
    if (!frame) break;
    const { scope } = frame;
    const owner = scope.node;
    const isNamespace = owner.type === "TSModuleDeclaration";
    const isAmbient = frame.isAmbient || (isNamespace && (owner.declare || owner.global));
    const localNames = new Set<string>();
    index.localNamesByScope.set(scope, localNames);
    let namespaceGroup: NamespaceValueGroup | undefined;
    if (isNamespace && scope.parent) {
      const isExported =
        frame.hasImplicitExports || owner.parent?.type === "ExportNamedDeclaration";
      let parentGroup = index.namespaceGroupsByScope.get(scope.parent) ?? null;
      let groupOwner: ScopeDescriptor | NamespaceValueGroup =
        isExported && parentGroup ? parentGroup : scope.parent;
      const namespaceSegments: NamespacePathSegment[] = [];
      let namespaceIdentifier: EsTreeNode = owner.id;
      while (namespaceIdentifier.type === "TSQualifiedName") {
        namespaceSegments.unshift({
          key: JSON.stringify(["Identifier", namespaceIdentifier.right.name]),
          name: namespaceIdentifier.right.name,
        });
        namespaceIdentifier = namespaceIdentifier.left;
      }
      if (namespaceIdentifier.type === "Identifier") {
        namespaceSegments.unshift({
          key: JSON.stringify([owner.global ? "global" : "Identifier", namespaceIdentifier.name]),
          name: owner.global ? null : namespaceIdentifier.name,
        });
      } else if (namespaceIdentifier.type === "Literal") {
        namespaceSegments.unshift({
          key: JSON.stringify(["Literal", namespaceIdentifier.value]),
          name: null,
        });
      }
      let isExportedMember = isExported;
      for (const segment of namespaceSegments) {
        if (segment.name !== null) {
          localNames.add(segment.name);
          if (parentGroup && isExportedMember) parentGroup.exportedNames.add(segment.name);
        }
        let groupsByName = namespaceGroupsByOwner.get(groupOwner);
        if (!groupsByName) {
          groupsByName = new Map();
          namespaceGroupsByOwner.set(groupOwner, groupsByName);
        }
        namespaceGroup = groupsByName.get(segment.key);
        if (!namespaceGroup) {
          namespaceGroup = { exportedNames: new Set(), parent: parentGroup };
          groupsByName.set(segment.key, namespaceGroup);
        }
        parentGroup = namespaceGroup;
        groupOwner = namespaceGroup;
        isExportedMember = true;
      }
      if (!namespaceGroup) continue;
      index.namespaceGroupsByScope.set(scope, namespaceGroup);
    }
    const statements = getScopeStatements(scope);
    const hasExplicitExports = statements.some(
      (statement) =>
        statement.type === "ExportAllDeclaration" ||
        (statement.type === "ExportNamedDeclaration" && statement.declaration === null),
    );
    const hasImplicitExports = isAmbient && !hasExplicitExports;
    for (const statement of statements) {
      const isExported = statement.type === "ExportNamedDeclaration";
      const declaration =
        isExported || statement.type === "ExportDefaultDeclaration"
          ? statement.declaration
          : statement;
      if (!declaration) continue;
      const declarationNames = new Set<string>();
      collectValueDeclarationNames(declaration, declarationNames);
      for (const name of declarationNames) {
        localNames.add(name);
        if (
          namespaceGroup &&
          (isExported ||
            (hasImplicitExports &&
              declaration.type !== "ImportDeclaration" &&
              declaration.type !== "TSImportEqualsDeclaration"))
        )
          namespaceGroup.exportedNames.add(name);
        if (isNamespace && owner.global) index.globalNames.add(name);
      }
    }
    if (namespaceGroup) {
      for (const statement of statements) {
        if (
          statement.type !== "ExportNamedDeclaration" ||
          statement.declaration ||
          statement.exportKind === "type"
        )
          continue;
        for (const specifier of statement.specifiers) {
          if (specifier.exportKind === "type" || specifier.local.type !== "Identifier") continue;
          const exportedName =
            specifier.exported.type === "Identifier"
              ? specifier.exported.name
              : specifier.exported.value;
          exportAliases.push({
            scope,
            group: namespaceGroup,
            localName: specifier.local.name,
            exportedName,
            hasExternalSource: statement.source !== null,
          });
        }
      }
    }
    for (const childScope of scope.children) {
      pendingScopes.push({ scope: childScope, isAmbient, hasImplicitExports });
    }
  }
  const aliasesByGroup = new Map<NamespaceValueGroup, Map<string, Set<string>>>();
  for (const alias of exportAliases) {
    if (alias.hasExternalSource || index.localNamesByScope.get(alias.scope)?.has(alias.localName)) {
      alias.group.exportedNames.add(alias.exportedName);
      continue;
    }
    let aliasesByName = aliasesByGroup.get(alias.group);
    if (!aliasesByName) {
      aliasesByName = new Map();
      aliasesByGroup.set(alias.group, aliasesByName);
    }
    let exportedNames = aliasesByName.get(alias.localName);
    if (!exportedNames) {
      exportedNames = new Set();
      aliasesByName.set(alias.localName, exportedNames);
    }
    exportedNames.add(alias.exportedName);
  }
  for (const [group, aliasesByName] of aliasesByGroup) {
    const pendingNames = [...group.exportedNames];
    while (pendingNames.length > 0) {
      const name = pendingNames.pop();
      if (name === undefined) break;
      for (const exportedName of aliasesByName.get(name) ?? []) {
        if (group.exportedNames.has(exportedName)) continue;
        group.exportedNames.add(exportedName);
        pendingNames.push(exportedName);
      }
    }
  }
  return index;
};

export const getNamespaceValueProvider = (
  initialScope: ScopeDescriptor,
  name: string,
): NamespaceValueProvider => {
  let index = indexesByScope.get(initialScope);
  if (!index) {
    let rootScope = initialScope;
    while (rootScope.parent) rootScope = rootScope.parent;
    index = indexesByScope.get(rootScope);
    if (!index) {
      index = buildNamespaceValueProviderIndex(rootScope);
      for (const indexedScope of index.localNamesByScope.keys()) {
        indexesByScope.set(indexedScope, index);
      }
    }
    indexesByScope.set(initialScope, index);
  }
  let providers = index.providersByScope.get(initialScope);
  if (!providers) {
    providers = new Map();
    index.providersByScope.set(initialScope, providers);
  }
  const cachedProvider = providers.get(name);
  if (cachedProvider) return cachedProvider;
  const hasGlobalProvider = index.globalNames.has(name);
  const failedNamespaceGroups = new Set<NamespaceValueGroup>();
  let providerScope: ScopeDescriptor | null = null;
  let scope: ScopeDescriptor | null = initialScope;
  while (scope) {
    if (index.localNamesByScope.get(scope)?.has(name)) {
      providerScope = scope;
      break;
    }
    let namespaceGroup = index.namespaceGroupsByScope.get(scope);
    while (namespaceGroup && !failedNamespaceGroups.has(namespaceGroup)) {
      if (namespaceGroup.exportedNames.has(name)) {
        providerScope = scope;
        break;
      }
      failedNamespaceGroups.add(namespaceGroup);
      namespaceGroup = namespaceGroup.parent ?? undefined;
    }
    if (providerScope) break;
    scope = scope.parent;
  }
  const provider: NamespaceValueProvider = {
    scope: providerScope ?? (hasGlobalProvider ? index.rootScope : null),
    hasGlobalProvider,
  };
  providers.set(name, provider);
  return provider;
};
