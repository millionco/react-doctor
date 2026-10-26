import * as fs from "node:fs";
import * as path from "node:path";
import {
  JSX_BABEL_CONFIG_FILE_NAMES,
  JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
} from "../constants/react.js";
import {
  OBJECT_PROTOTYPE_PROPERTY_NAMES,
  TRACK_PLAYER_REPEAT_MODULE_SOURCE,
  TRACK_PLAYER_REPEAT_METHOD_NAME,
  TRACK_PLAYER_REPEAT_SUPPORTED_VERSION,
  TRACK_PLAYER_REPEAT_DECLARED_VERSION_PATTERN,
  TRACK_PLAYER_REPEAT_SINGLE_COUNT,
  TRACK_PLAYER_REPEAT_EMPTY_COUNT,
  TRACK_PLAYER_REPEAT_NO_WILDCARD_INDEX,
  TRACK_PLAYER_REPEAT_FIRST_INDEX,
  TRACK_PLAYER_REPEAT_SECOND_INDEX,
  TRACK_PLAYER_REPEAT_BABEL_STATEMENT_COUNT,
  TRACK_PLAYER_REPEAT_REFUSED_MANIFEST_FIELDS,
  TRACK_PLAYER_REPEAT_CONFIG_NAMES,
  TRACK_PLAYER_REPEAT_SUPPORTED_SCRIPT_RECIPES,
  TRACK_PLAYER_REPEAT_COMPILER_PROVIDER_SOURCES,
  TRACK_PLAYER_REPEAT_INSTALLED_REFUSED_FIELDS,
  TRACK_PLAYER_REPEAT_GLOBAL_CAPABILITIES,
} from "./constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isErasedTypeScriptNamespace } from "./is-erased-typescript-namespace.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { classifyReactNativeFileTarget } from "./is-react-native-file.js";
import { parsePackageVersion } from "./parse-package-version.js";
import { parseSourceFile } from "./parse-source-file.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolvePackageVersion } from "./resolve-package-version.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import { isTsconfigObjectRecord, parseTsconfigFile } from "./resolve-tsconfig-alias.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const hasOrdinaryTrackPlayerSource = (program: EsTreeNode): boolean => {
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSParameterProperty") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      (isNodeOfType(node, "TSModuleDeclaration") && !isErasedTypeScriptNamespace(node))
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (node.importKind === "type") return;
      if (node.source.value !== "react" && node.source.value !== TRACK_PLAYER_REPEAT_MODULE_SOURCE)
        supported = false;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
      node.source &&
      node.exportKind !== "type"
    )
      supported = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (
        (node.computed && name === null) ||
        name === "prototype" ||
        (name !== null && OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name))
      )
        supported = false;
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const name = getStaticPropertyKeyName(node);
      if (name === null || name === "prototype" || OBJECT_PROTOTYPE_PROPERTY_NAMES.has(name))
        supported = false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      TRACK_PLAYER_REPEAT_GLOBAL_CAPABILITIES.has(node.name)
    )
      supported = false;
  });
  return supported;
};

const isLiteralString = (node: EsTreeNode | null | undefined, value: string): boolean =>
  isNodeOfType(node, "Literal") && node.value === value;

const isOrdinaryExpoBabelConfiguration = (filename: string): boolean => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.body.length !== TRACK_PLAYER_REPEAT_SINGLE_COUNT)
    return false;
  const statement = program.body[TRACK_PLAYER_REPEAT_FIRST_INDEX];
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "AssignmentExpression") ||
    statement.expression.operator !== "="
  )
    return false;
  const assignment = statement.expression;
  const target = stripParenExpression(assignment.left);
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    target.optional ||
    !isNodeOfType(target.object, "Identifier") ||
    target.object.name !== "module" ||
    getStaticPropertyName(target) !== "exports"
  )
    return false;
  const factory = stripParenExpression(assignment.right);
  if (
    !isNodeOfType(factory, "FunctionExpression") ||
    factory.async ||
    factory.generator ||
    factory.params.length !== TRACK_PLAYER_REPEAT_SINGLE_COUNT ||
    !isNodeOfType(factory.params[TRACK_PLAYER_REPEAT_FIRST_INDEX], "Identifier") ||
    !isNodeOfType(factory.body, "BlockStatement") ||
    factory.body.body.length !== TRACK_PLAYER_REPEAT_BABEL_STATEMENT_COUNT
  )
    return false;
  const cacheStatement = factory.body.body[TRACK_PLAYER_REPEAT_FIRST_INDEX];
  const returned = factory.body.body[TRACK_PLAYER_REPEAT_SECOND_INDEX];
  if (
    !isNodeOfType(cacheStatement, "ExpressionStatement") ||
    !isNodeOfType(cacheStatement.expression, "CallExpression") ||
    cacheStatement.expression.optional ||
    cacheStatement.expression.arguments.length !== TRACK_PLAYER_REPEAT_SINGLE_COUNT
  )
    return false;
  const cache = cacheStatement.expression;
  const member = stripParenExpression(cache.callee);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    member.computed ||
    getStaticPropertyName(member) !== "cache" ||
    !isNodeOfType(member.object, "Identifier") ||
    member.object.name !== factory.params[TRACK_PLAYER_REPEAT_FIRST_INDEX].name ||
    !isNodeOfType(cache.arguments[TRACK_PLAYER_REPEAT_FIRST_INDEX], "Literal") ||
    cache.arguments[TRACK_PLAYER_REPEAT_FIRST_INDEX].value !== true
  )
    return false;
  if (!isNodeOfType(returned, "ReturnStatement") || !returned.argument) return false;
  const options = getOwnDataObjectProperties(stripParenExpression(returned.argument));
  const presets = options?.get("presets");
  return Boolean(
    options?.size === TRACK_PLAYER_REPEAT_SINGLE_COUNT &&
    isNodeOfType(presets, "ArrayExpression") &&
    presets.elements.length === TRACK_PLAYER_REPEAT_SINGLE_COUNT &&
    isLiteralString(presets.elements[TRACK_PLAYER_REPEAT_FIRST_INDEX], "babel-preset-expo"),
  );
};

const isOrdinaryTrackPlayerTypescriptConfiguration = (
  filename: string,
  hasExpo: boolean,
): boolean => {
  const configuration = parseTsconfigFile(filename, [], true);
  if (!configuration || Array.isArray(configuration)) return false;
  if (
    Object.hasOwn(configuration, "extends") &&
    (!hasExpo || configuration.extends !== "expo/tsconfig.base")
  )
    return false;
  const options = configuration.compilerOptions ?? {};
  if (!isTsconfigObjectRecord(options) || Array.isArray(options)) return false;
  if (
    [
      "plugins",
      "jsxFactory",
      "jsxFragmentFactory",
      "jsxImportSource",
      "customConditions",
      "moduleSuffixes",
      "rootDirs",
    ].some((name) => Object.hasOwn(options, name))
  )
    return false;
  if (Object.hasOwn(options, "baseUrl") && options.baseUrl !== ".") return false;
  if (Object.hasOwn(options, "paths")) {
    if (!isTsconfigObjectRecord(options.paths) || Array.isArray(options.paths)) return false;
    for (const [pattern, targets] of Object.entries(options.paths)) {
      if (!Array.isArray(targets) || targets.some((target) => typeof target !== "string"))
        return false;
      for (const source of [
        "react",
        "react-native",
        TRACK_PLAYER_REPEAT_MODULE_SOURCE,
        ...TRACK_PLAYER_REPEAT_COMPILER_PROVIDER_SOURCES,
      ]) {
        const wildcard = pattern.indexOf("*");
        if (
          pattern === source ||
          (wildcard !== TRACK_PLAYER_REPEAT_NO_WILDCARD_INDEX &&
            source.startsWith(pattern.slice(TRACK_PLAYER_REPEAT_FIRST_INDEX, wildcard)) &&
            source.endsWith(pattern.slice(wildcard + TRACK_PLAYER_REPEAT_SINGLE_COUNT)))
        )
          return false;
      }
    }
  }
  return true;
};

const hasOrdinaryTrackPlayerEnvironment = (context: RuleContext): boolean => {
  if (!context.filename || classifyReactNativeFileTarget(context) !== "react-native") return false;
  const manifest = readNearestPackageManifest(context.filename);
  const directory = findNearestPackageDirectory(context.filename);
  const dependencies = {
    ...manifest?.optionalDependencies,
    ...manifest?.peerDependencies,
    ...manifest?.devDependencies,
    ...manifest?.dependencies,
  };
  const declared = dependencies[TRACK_PLAYER_REPEAT_MODULE_SOURCE];
  if (
    !directory ||
    !manifest ||
    typeof declared !== "string" ||
    !TRACK_PLAYER_REPEAT_DECLARED_VERSION_PATTERN.test(declared.trim())
  )
    return false;
  for (const provider of ["react", "react-native"]) {
    const version = dependencies[provider];
    if (typeof version !== "string" || !parsePackageVersion(version.trim().replace(/^[~^]/u, "")))
      return false;
  }
  const resolved = resolvePackageVersion(context.filename, TRACK_PLAYER_REPEAT_MODULE_SOURCE);
  if (
    !resolved ||
    `${resolved.version.major}.${resolved.version.minor}.${resolved.version.patch}` !==
      TRACK_PLAYER_REPEAT_SUPPORTED_VERSION ||
    resolved.version.isPrerelease
  )
    return false;
  const hasExpo =
    typeof dependencies.expo === "string" &&
    Boolean(parsePackageVersion(dependencies.expo.trim().replace(/^[~^]/u, "")));
  for (const source of [
    "react",
    "react-native",
    TRACK_PLAYER_REPEAT_MODULE_SOURCE,
    ...TRACK_PLAYER_REPEAT_COMPILER_PROVIDER_SOURCES,
  ]) {
    if (
      resolveWebpackAliasPath(context.filename, source)?.declared ||
      resolveModulePath(context.filename, source) !== null
    )
      return false;
  }
  let currentDirectory = path.dirname(context.filename);
  while (true) {
    const ancestorManifest = readPackageManifest(currentDirectory);
    if (
      ancestorManifest &&
      (TRACK_PLAYER_REPEAT_REFUSED_MANIFEST_FIELDS.some((field) =>
        Object.hasOwn(ancestorManifest, field),
      ) ||
        [
          "react",
          "react-native",
          TRACK_PLAYER_REPEAT_MODULE_SOURCE,
          ...TRACK_PLAYER_REPEAT_COMPILER_PROVIDER_SOURCES,
        ].includes(typeof ancestorManifest.name === "string" ? ancestorManifest.name : ""))
    )
      return false;
    if (ancestorManifest) {
      if (ancestorManifest.scripts !== undefined) {
        if (
          typeof ancestorManifest.scripts !== "object" ||
          ancestorManifest.scripts === null ||
          Array.isArray(ancestorManifest.scripts)
        )
          return false;
        for (const [name, command] of Object.entries(ancestorManifest.scripts)) {
          if (
            typeof command !== "string" ||
            !Object.hasOwn(TRACK_PLAYER_REPEAT_SUPPORTED_SCRIPT_RECIPES, name) ||
            !TRACK_PLAYER_REPEAT_SUPPORTED_SCRIPT_RECIPES[name]?.has(command)
          )
            return false;
        }
      }
      for (const section of [
        ancestorManifest.dependencies,
        ancestorManifest.devDependencies,
        ancestorManifest.peerDependencies,
        ancestorManifest.optionalDependencies,
      ]) {
        for (const provider of ["babel-preset-expo", "expo"]) {
          const declaredProvider = section?.[provider];
          if (
            declaredProvider !== undefined &&
            (typeof declaredProvider !== "string" ||
              !parsePackageVersion(declaredProvider.trim().replace(/^[~^]/u, "")))
          )
            return false;
        }
      }
    }
    const installedDirectory = path.join(
      currentDirectory,
      "node_modules",
      TRACK_PLAYER_REPEAT_MODULE_SOURCE,
    );
    const installedManifest = readPackageManifest(installedDirectory);
    if (
      installedManifest &&
      (installedManifest.name !== TRACK_PLAYER_REPEAT_MODULE_SOURCE ||
        installedManifest.version !== TRACK_PLAYER_REPEAT_SUPPORTED_VERSION ||
        installedManifest.main !== "lib/src/index.js" ||
        installedManifest.source !== "src/index" ||
        installedManifest["react-native"] !== "src/index" ||
        TRACK_PLAYER_REPEAT_INSTALLED_REFUSED_FIELDS.some((field) =>
          Object.hasOwn(installedManifest, field),
        ))
    )
      return false;
    for (const name of [
      ...TRACK_PLAYER_REPEAT_CONFIG_NAMES,
      ...JSX_BABEL_CONFIG_FILE_NAMES,
      ...JSX_ADDITIONAL_BABEL_CONFIG_FILE_NAMES,
    ]) {
      if (name === "babel.config.js") continue;
      const filename = path.join(currentDirectory, name);
      recordExistenceProbe(filename);
      if (fs.existsSync(filename)) return false;
    }
    for (const name of ["babel.config.js", "tsconfig.json", "jsconfig.json"]) {
      const filename = path.join(currentDirectory, name);
      recordExistenceProbe(filename);
      if (!fs.existsSync(filename)) continue;
      recordContentProbe(filename);
      if (!fs.lstatSync(filename).isFile() || fs.realpathSync(filename) !== filename) return false;
      if (
        name === "babel.config.js"
          ? !hasExpo || !isOrdinaryExpoBabelConfiguration(filename)
          : !isOrdinaryTrackPlayerTypescriptConfiguration(filename, hasExpo)
      )
        return false;
    }
    const parent = path.dirname(currentDirectory);
    if (parent === currentDirectory) break;
    currentDirectory = parent;
  }
  return true;
};

export const isRejectableTrackPlayerRepeatModeCall = (
  expression: EsTreeNode,
  context: RuleContext,
): boolean => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== TRACK_PLAYER_REPEAT_EMPTY_COUNT
  )
    return false;
  const member = stripParenExpression(call.callee);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.optional ||
    member.computed ||
    getStaticPropertyName(member) !== TRACK_PLAYER_REPEAT_METHOD_NAME
  )
    return false;
  const receiver = stripParenExpression(member.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(receiver);
  const program = findProgramRoot(call);
  if (
    !symbol ||
    !program ||
    !getValueImportDeclaration(symbol) ||
    !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
    !hasCompleteSymbolReferences(symbol, program, context.scopes) ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  )
    return false;
  for (const importedSymbol of context.scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(importedSymbol);
    if (
      importedSymbol === symbol ||
      declaration?.source.value !== TRACK_PLAYER_REPEAT_MODULE_SOURCE
    )
      continue;
    if (
      !hasCompleteSymbolReferences(importedSymbol, program, context.scopes) ||
      importedSymbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
    )
      return false;
  }
  const imported = resolveImportedApiReference(receiver, context.scopes);
  if (imported?.source !== TRACK_PLAYER_REPEAT_MODULE_SOURCE || imported.importedName !== "default")
    return false;
  if (
    !symbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const root = findTransparentExpressionRoot(reference.identifier);
      const property = root.parent;
      if (
        !isNodeOfType(property, "MemberExpression") ||
        property.object !== root ||
        property.optional ||
        property.computed ||
        !getStaticPropertyName(property)
      )
        return false;
      const callee = findTransparentExpressionRoot(property);
      const invocation = callee.parent;
      return (
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === callee &&
        !invocation.optional
      );
    }) ||
    !hasOrdinaryTrackPlayerSource(program)
  )
    return false;
  try {
    return hasOrdinaryTrackPlayerEnvironment(context);
  } catch {
    return false;
  }
};
