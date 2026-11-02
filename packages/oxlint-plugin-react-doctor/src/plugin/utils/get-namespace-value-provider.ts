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
  readonly hasNamespaceGroups: boolean;
  readonly globalNames: Set<string>;
  readonly localNamesByScope: Map<ScopeDescriptor, Set<string>>;
  readonly namespaceGroupsByScope: Map<ScopeDescriptor, NamespaceValueGroup>;
  readonly providersByScope: Map<ScopeDescriptor, Map<string, NamespaceValueProvider>>;
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
  if (
    declaration.type === "ExportNamedDeclaration" ||
    declaration.type === "ExportDefaultDeclaration"
  ) {
    if (declaration.declaration) collectValueDeclarationNames(declaration.declaration, names);
    return;
  }
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
  includeNamespaceGroups: boolean,
): NamespaceValueProviderIndex => {
  const index: NamespaceValueProviderIndex = {
    rootScope,
    hasNamespaceGroups: includeNamespaceGroups,
    globalNames: new Set(),
    localNamesByScope: new Map(),
    namespaceGroupsByScope: new Map(),
    providersByScope: new Map(),
  };
  if (!includeNamespaceGroups) {
    const pendingGlobalScopes = [rootScope];
    while (pendingGlobalScopes.length > 0) {
      const scope = pendingGlobalScopes.pop();
      if (!scope) break;
      if (scope.node.type === "TSModuleDeclaration" && scope.node.global) {
        for (const statement of getScopeStatements(scope)) {
          collectValueDeclarationNames(statement, index.globalNames);
        }
      }
      for (const childScope of scope.children) pendingGlobalScopes.push(childScope);
    }
    return index;
  }
  const namespaceGroupsByOwner = new Map<
    ScopeDescriptor | NamespaceValueGroup,
    Map<string | null, NamespaceValueGroup>
  >();
  const pendingScopes: NamespaceScopeFrame[] = [
    { scope: rootScope, isAmbient: false, hasImplicitExports: false },
  ];
  const exportAliases: NamespaceExportAlias[] = [];
  const declarationNames = new Set<string>();
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
      let namespaceSegments: EsTreeNode[] | undefined;
      let namespaceIdentifier: EsTreeNode = owner.id;
      while (namespaceIdentifier.type === "TSQualifiedName") {
        (namespaceSegments ??= []).push(namespaceIdentifier.right);
        namespaceIdentifier = namespaceIdentifier.left;
      }
      let namespaceSegment: EsTreeNode | undefined = namespaceIdentifier;
      let isExportedMember = isExported;
      while (namespaceSegment) {
        const segment = namespaceSegment;
        namespaceSegment = namespaceSegments?.pop();
        let namespaceName: string | null;
        let namespaceKey: string | null;
        if (segment.type === "Identifier") {
          namespaceName = owner.global && segment === namespaceIdentifier ? null : segment.name;
          namespaceKey = namespaceName;
        } else if (segment.type === "Literal") {
          namespaceName = null;
          namespaceKey = JSON.stringify(["Literal", segment.value]);
        } else {
          continue;
        }
        if (namespaceName !== null) {
          localNames.add(namespaceName);
          if (parentGroup && isExportedMember) parentGroup.exportedNames.add(namespaceName);
        }
        let groupsByName = namespaceGroupsByOwner.get(groupOwner);
        if (!groupsByName) {
          groupsByName = new Map();
          namespaceGroupsByOwner.set(groupOwner, groupsByName);
        }
        namespaceGroup = groupsByName.get(namespaceKey);
        if (!namespaceGroup) {
          namespaceGroup = { exportedNames: new Set(), parent: parentGroup };
          groupsByName.set(namespaceKey, namespaceGroup);
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
      if (!namespaceGroup && !(isNamespace && owner.global)) {
        collectValueDeclarationNames(declaration, localNames);
        continue;
      }
      declarationNames.clear();
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
    let hasNamespaceScope = rootScope.node.type === "TSModuleDeclaration";
    while (rootScope.parent) {
      rootScope = rootScope.parent;
      if (rootScope.node.type === "TSModuleDeclaration") hasNamespaceScope = true;
    }
    index = indexesByScope.get(rootScope);
    if (!index || (hasNamespaceScope && !index.hasNamespaceGroups)) {
      index = buildNamespaceValueProviderIndex(rootScope, hasNamespaceScope);
      for (const indexedScope of index.localNamesByScope.keys()) {
        indexesByScope.set(indexedScope, index);
      }
      indexesByScope.set(rootScope, index);
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
    let localNames = index.localNamesByScope.get(scope);
    if (!localNames && !index.hasNamespaceGroups) {
      localNames = new Set();
      for (const statement of getScopeStatements(scope)) {
        collectValueDeclarationNames(statement, localNames);
      }
      index.localNamesByScope.set(scope, localNames);
      indexesByScope.set(scope, index);
    }
    if (localNames?.has(name)) {
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
