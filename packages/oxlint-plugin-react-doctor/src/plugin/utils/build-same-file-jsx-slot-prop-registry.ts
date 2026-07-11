import type { MemoStatus } from "./build-same-file-memo-registry.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ReactSlotTypeEnvironment {
  reactSlotTypeBindings: ReadonlySet<string>;
  reactNamespaceBindings: ReadonlySet<string>;
  reactJsxNamespaceBindings: ReadonlySet<string>;
  nonReactJsxNamespaceBindings: ReadonlySet<string>;
  sameFileTypeDeclarations: ReadonlyMap<string, EsTreeNode>;
  hasLocalJsxNamespace: boolean;
}

const REACT_SLOT_TYPE_NAMES: ReadonlySet<string> = new Set(["ReactNode", "ReactElement"]);

const unwrapTopLevelDeclaration = (statement: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(statement, "ExportNamedDeclaration")) return statement.declaration;
  if (isNodeOfType(statement, "ExportDefaultDeclaration")) return statement.declaration;
  return statement;
};

const buildReactSlotTypeEnvironment = (program: EsTreeNode): ReactSlotTypeEnvironment => {
  const reactSlotTypeBindings = new Set<string>();
  const reactNamespaceBindings = new Set<string>();
  const reactJsxNamespaceBindings = new Set<string>();
  const nonReactJsxNamespaceBindings = new Set<string>();
  const sameFileTypeDeclarations = new Map<string, EsTreeNode>();
  let hasLocalJsxNamespace = false;

  if (!isNodeOfType(program, "Program")) {
    return {
      reactSlotTypeBindings,
      reactNamespaceBindings,
      reactJsxNamespaceBindings,
      nonReactJsxNamespaceBindings,
      sameFileTypeDeclarations,
      hasLocalJsxNamespace,
    };
  }

  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      const isReactImport = statement.source.value === "react";
      for (const specifier of statement.specifiers) {
        if (
          isReactImport &&
          (isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            isNodeOfType(specifier, "ImportNamespaceSpecifier"))
        ) {
          reactNamespaceBindings.add(specifier.local.name);
          continue;
        }
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const importedName = getImportedName(specifier);
        if (!importedName) continue;
        if (isReactImport && REACT_SLOT_TYPE_NAMES.has(importedName)) {
          reactSlotTypeBindings.add(specifier.local.name);
        }
        if (importedName === "JSX") {
          if (isReactImport) reactJsxNamespaceBindings.add(specifier.local.name);
          else nonReactJsxNamespaceBindings.add(specifier.local.name);
        }
      }
      continue;
    }

    const declaration = unwrapTopLevelDeclaration(statement);
    if (!declaration) continue;
    if (
      (isNodeOfType(declaration, "TSInterfaceDeclaration") ||
        isNodeOfType(declaration, "TSTypeAliasDeclaration")) &&
      isNodeOfType(declaration.id, "Identifier")
    ) {
      sameFileTypeDeclarations.set(declaration.id.name, declaration);
    }
    if (
      isNodeOfType(declaration, "TSModuleDeclaration") &&
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id.name === "JSX"
    ) {
      hasLocalJsxNamespace = true;
    }
  }

  return {
    reactSlotTypeBindings,
    reactNamespaceBindings,
    reactJsxNamespaceBindings,
    nonReactJsxNamespaceBindings,
    sameFileTypeDeclarations,
    hasLocalJsxNamespace,
  };
};

const isJsxElementTypeName = (
  typeName: EsTreeNode,
  environment: ReactSlotTypeEnvironment,
): boolean => {
  if (!isNodeOfType(typeName, "TSQualifiedName")) return false;
  if (!isNodeOfType(typeName.right, "Identifier") || typeName.right.name !== "Element") {
    return false;
  }
  if (isNodeOfType(typeName.left, "Identifier")) {
    const namespaceName = typeName.left.name;
    if (environment.reactNamespaceBindings.has(namespaceName)) return true;
    if (environment.reactJsxNamespaceBindings.has(namespaceName)) return true;
    if (environment.nonReactJsxNamespaceBindings.has(namespaceName)) return false;
    return namespaceName === "JSX" && !environment.hasLocalJsxNamespace;
  }
  return (
    isNodeOfType(typeName.left, "TSQualifiedName") &&
    isNodeOfType(typeName.left.left, "Identifier") &&
    environment.reactNamespaceBindings.has(typeName.left.left.name) &&
    isNodeOfType(typeName.left.right, "Identifier") &&
    typeName.left.right.name === "JSX"
  );
};

const isReactSlotType = (
  typeNode: EsTreeNode,
  environment: ReactSlotTypeEnvironment,
  activeDeclarations: Set<EsTreeNode>,
): boolean => {
  if (isNodeOfType(typeNode, "TSUnionType")) {
    return typeNode.types.some((unionMember) =>
      isReactSlotType(unionMember, environment, activeDeclarations),
    );
  }
  if (!isNodeOfType(typeNode, "TSTypeReference")) return false;
  if (isJsxElementTypeName(typeNode.typeName, environment)) return true;
  if (
    isNodeOfType(typeNode.typeName, "TSQualifiedName") &&
    isNodeOfType(typeNode.typeName.left, "Identifier") &&
    environment.reactNamespaceBindings.has(typeNode.typeName.left.name) &&
    isNodeOfType(typeNode.typeName.right, "Identifier") &&
    REACT_SLOT_TYPE_NAMES.has(typeNode.typeName.right.name)
  ) {
    return true;
  }
  if (!isNodeOfType(typeNode.typeName, "Identifier")) return false;
  const typeName = typeNode.typeName.name;
  const sameFileDeclaration = environment.sameFileTypeDeclarations.get(typeName);
  if (sameFileDeclaration) {
    if (
      !isNodeOfType(sameFileDeclaration, "TSTypeAliasDeclaration") ||
      activeDeclarations.has(sameFileDeclaration)
    ) {
      return false;
    }
    activeDeclarations.add(sameFileDeclaration);
    const isSlot = isReactSlotType(
      sameFileDeclaration.typeAnnotation,
      environment,
      activeDeclarations,
    );
    activeDeclarations.delete(sameFileDeclaration);
    return isSlot;
  }
  return environment.reactSlotTypeBindings.has(typeName);
};

const getPropertyName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "TSPropertySignature") || property.computed) return null;
  if (isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

const collectSlotPropertyNames = (
  propsType: EsTreeNode,
  environment: ReactSlotTypeEnvironment,
  slotPropertyNames: Set<string>,
  activeDeclarations: Set<EsTreeNode>,
): void => {
  let members: ReadonlyArray<EsTreeNode> | null = null;
  if (isNodeOfType(propsType, "TSTypeLiteral")) members = propsType.members;
  if (isNodeOfType(propsType, "TSInterfaceDeclaration")) members = propsType.body.body;
  if (members) {
    for (const member of members) {
      const propertyName = getPropertyName(member);
      if (!propertyName || !isNodeOfType(member, "TSPropertySignature")) continue;
      const annotation = member.typeAnnotation;
      if (
        annotation &&
        isNodeOfType(annotation, "TSTypeAnnotation") &&
        isReactSlotType(annotation.typeAnnotation, environment, new Set())
      ) {
        slotPropertyNames.add(propertyName);
      }
    }
    return;
  }
  if (isNodeOfType(propsType, "TSIntersectionType")) {
    for (const intersectionMember of propsType.types) {
      collectSlotPropertyNames(
        intersectionMember,
        environment,
        slotPropertyNames,
        activeDeclarations,
      );
    }
    return;
  }
  if (isNodeOfType(propsType, "TSTypeAliasDeclaration")) {
    collectSlotPropertyNames(
      propsType.typeAnnotation,
      environment,
      slotPropertyNames,
      activeDeclarations,
    );
    return;
  }
  if (
    !isNodeOfType(propsType, "TSTypeReference") ||
    !isNodeOfType(propsType.typeName, "Identifier")
  ) {
    return;
  }
  const declaration = environment.sameFileTypeDeclarations.get(propsType.typeName.name);
  if (!declaration || activeDeclarations.has(declaration)) return;
  activeDeclarations.add(declaration);
  collectSlotPropertyNames(declaration, environment, slotPropertyNames, activeDeclarations);
  activeDeclarations.delete(declaration);
};

const findWrappedComponentFunction = (node: EsTreeNode): EsTreeNode | null => {
  const candidate = stripParenExpression(node);
  if (
    isNodeOfType(candidate, "ArrowFunctionExpression") ||
    isNodeOfType(candidate, "FunctionExpression")
  ) {
    return candidate;
  }
  if (!isNodeOfType(candidate, "CallExpression")) return null;
  const firstArgument = candidate.arguments[0];
  if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return null;
  return findWrappedComponentFunction(firstArgument);
};

const getMemoizedComponentPropsType = (initializer: EsTreeNode): EsTreeNode | null => {
  const componentFunction = findWrappedComponentFunction(initializer);
  if (
    componentFunction &&
    (isNodeOfType(componentFunction, "ArrowFunctionExpression") ||
      isNodeOfType(componentFunction, "FunctionExpression"))
  ) {
    const firstParameter = componentFunction.params[0];
    const annotation =
      firstParameter && "typeAnnotation" in firstParameter ? firstParameter.typeAnnotation : null;
    if (annotation && isNodeOfType(annotation, "TSTypeAnnotation")) {
      return annotation.typeAnnotation;
    }
  }
  if (!isNodeOfType(initializer, "CallExpression")) return null;
  return initializer.typeArguments?.params[0] ?? null;
};

export const buildSameFileJsxSlotPropRegistry = (
  program: EsTreeNode,
  memoRegistry: Map<string, MemoStatus>,
): Map<string, ReadonlySet<string>> => {
  const registry = new Map<string, ReadonlySet<string>>();
  if (!isNodeOfType(program, "Program")) return registry;
  const environment = buildReactSlotTypeEnvironment(program);
  for (const statement of program.body) {
    const declaration = unwrapTopLevelDeclaration(statement);
    if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) continue;
    for (const declarator of declaration.declarations) {
      if (
        !isNodeOfType(declarator.id, "Identifier") ||
        memoRegistry.get(declarator.id.name) !== "memoised" ||
        !declarator.init
      ) {
        continue;
      }
      const propsType = getMemoizedComponentPropsType(declarator.init);
      if (!propsType) continue;
      const slotPropertyNames = new Set<string>();
      collectSlotPropertyNames(propsType, environment, slotPropertyNames, new Set());
      if (slotPropertyNames.size > 0) {
        registry.set(declarator.id.name, slotPropertyNames);
      }
    }
  }
  return registry;
};
