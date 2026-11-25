import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parseSourceText } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

type Program = Extract<EsTreeNode, { type: "Program" }>;

export interface StencilHookImport {
  readonly module: string;
  readonly imported: string;
}

export interface StencilOutputValidation {
  readonly validator: StencilHookImport | { readonly local: string };
  readonly hasDeferredGenerator: true;
}

const MAX_CONFIG_BYTES = 128 * 1024;
const parse = (sourceText: string): Program | null => {
  if (sourceText.length > MAX_CONFIG_BYTES) return null;
  const program = parseSourceText({ filename: "stencil-hook.ts", sourceText });
  return isNodeOfType(program, "Program") ? program : null;
};

const fields = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  const value = stripParenExpression(node);
  if (!isNodeOfType(value, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const item of value.properties) {
    if (!isNodeOfType(item, "Property") || item.computed || item.kind !== "init") return null;
    const name = isNodeOfType(item.key, "Identifier")
      ? item.key.name
      : isNodeOfType(item.key, "Literal") && typeof item.key.value === "string"
        ? item.key.value
        : null;
    if (!name || name === "__proto__" || result.has(name)) return null;
    result.set(name, item.value);
  }
  return result;
};

const literal = (node: EsTreeNode | null | undefined, value: unknown): boolean =>
  isNodeOfType(node, "Literal") && node.value === value;

const member = (node: EsTreeNode | undefined, key: string): EsTreeNode | null => {
  const parent = node?.parent;
  return isNodeOfType(parent, "MemberExpression") &&
    parent.object === node &&
    !parent.computed &&
    !parent.optional &&
    isNodeOfType(parent.property, "Identifier") &&
    parent.property.name === key
    ? parent
    : null;
};

const isInertInitializer = (value: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(value, "ArrowFunctionExpression") ||
  isNodeOfType(value, "FunctionExpression") ||
  isNodeOfType(value, "Literal") ||
  (isNodeOfType(value, "ArrayExpression") &&
    value.elements.every((entry) => isNodeOfType(entry, "Literal")));

const inertModuleInitialization = (program: Program): boolean =>
  program.body.every((statement) => {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      return statement.specifiers.length > 0 && !statement.attributes?.length;
    }
    const node =
      isNodeOfType(statement, "ExportNamedDeclaration") ||
      isNodeOfType(statement, "ExportDefaultDeclaration")
        ? statement.declaration
        : statement;
    if (
      isNodeOfType(node, "FunctionDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration") ||
      isNodeOfType(node, "TSInterfaceDeclaration")
    )
      return true;
    return (
      isNodeOfType(node, "VariableDeclaration") &&
      node.kind === "const" &&
      node.declarations.every(
        ({ id, init }) => isNodeOfType(id, "Identifier") && isInertInitializer(init),
      )
    );
  });

export const hasInertStencilHookModuleInitialization = (sourceText: string): boolean => {
  const program = parse(sourceText);
  return program !== null && inertModuleInitialization(program);
};

const exportValue = (program: Program, name: string): EsTreeNode | null => {
  for (const statement of program.body) {
    if (name === "default" && isNodeOfType(statement, "ExportDefaultDeclaration")) {
      return statement.declaration;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    const declaration = statement.declaration;
    if (
      isNodeOfType(declaration, "FunctionDeclaration") &&
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id.name === name
    )
      return declaration;
    if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const") continue;
    for (const item of declaration.declarations) {
      if (isNodeOfType(item.id, "Identifier") && item.id.name === name) return item.init ?? null;
    }
  }
  return null;
};

const importFor = (node: EsTreeNode, scopes: ScopeAnalysis): StencilHookImport | null => {
  const symbol = scopes.symbolFor(node);
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  const imported = symbol ? getImportedName(symbol.declarationNode) : null;
  return declaration &&
    declaration.importKind !== "type" &&
    !(
      isNodeOfType(symbol?.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type"
    ) &&
    typeof declaration.source.value === "string" &&
    imported &&
    !declaration.attributes?.length
    ? { module: declaration.source.value, imported }
    : null;
};

const soleBody = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "BlockStatement") || node.body.length !== 1) return null;
  const [statement] = node.body;
  if (isNodeOfType(statement, "ReturnStatement")) return statement.argument ?? null;
  if (isNodeOfType(statement, "ExpressionStatement")) return statement.expression;
  return null;
};

const directCall = (node: EsTreeNode | null, arity: number) =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  isNodeOfType(node.callee, "Identifier") &&
  node.arguments.length === arity
    ? node
    : null;

// This checks only the Stencil validation phase. Provider initialization and
// deferred output-generator writes require their own evidence.
export const readStencilPreEmitOutputValidator = (
  sourceText: string,
  factoryExport: string,
): StencilOutputValidation | null => {
  const program = parse(sourceText);
  if (!program || !inertModuleInitialization(program)) return null;
  const factory = exportValue(program, factoryExport);
  if (
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params.length !== 1 ||
    !isNodeOfType(factory.params[0], "Identifier")
  )
    return null;
  const options = fields(factory.body);
  const validate = options?.get("validate");
  const generator = options?.get("generator");
  if (
    options?.size !== 4 ||
    !literal(options.get("type"), "custom") ||
    !isNodeOfType(options.get("name"), "Literal") ||
    !isNodeOfType(validate, "FunctionExpression") ||
    validate.async ||
    validate.generator ||
    validate.params.length !== 1 ||
    !isNodeOfType(validate.params[0], "Identifier") ||
    !isNodeOfType(generator, "FunctionExpression") ||
    !generator.async ||
    generator.generator ||
    generator.params.length !== 3 ||
    !generator.params.every((param) => isNodeOfType(param, "Identifier"))
  )
    return null;
  const delegate = directCall(soleBody(validate.body), 2);
  if (!delegate) return null;
  const scopes = analyzeScopes(program);
  const [config, output] = delegate.arguments;
  const configSymbol = scopes.symbolFor(validate.params[0]);
  const outputSymbol = scopes.symbolFor(factory.params[0]);
  if (
    !configSymbol ||
    !outputSymbol ||
    !isNodeOfType(config, "Identifier") ||
    !isNodeOfType(output, "Identifier") ||
    scopes.symbolFor(config) !== configSymbol ||
    scopes.symbolFor(output) !== outputSymbol ||
    configSymbol.references.length !== 1 ||
    !hasCompleteSymbolReferences(configSymbol, program, scopes)
  )
    return null;
  const imported = importFor(delegate.callee, scopes);
  if (imported) return { validator: imported, hasDeferredGenerator: true };
  const local = scopes.symbolFor(delegate.callee);
  if (
    !local ||
    !readConfigOnlyRootDirectory(local.declarationNode, program, scopes) ||
    !hasOnlyLocalGuardStatements(local.declarationNode, scopes)
  )
    return null;
  return { validator: { local: local.name }, hasDeferredGenerator: true };
};

const readConfigOnlyRootDirectory = (
  declared: EsTreeNode,
  program: Program,
  scopes: ScopeAnalysis,
): boolean => {
  const node = isNodeOfType(declared, "Identifier") ? declared.parent : declared;
  const candidate =
    isNodeOfType(node, "VariableDeclarator") &&
    isNodeOfType(node.parent, "VariableDeclaration") &&
    node.parent.kind === "const"
      ? node.init
      : node;
  if (
    (!isNodeOfType(candidate, "ArrowFunctionExpression") &&
      !isNodeOfType(candidate, "FunctionDeclaration")) ||
    candidate.async ||
    candidate.params.length !== 2 ||
    !candidate.params.every((param) => isNodeOfType(param, "Identifier"))
  )
    return false;
  const config = scopes.symbolFor(candidate.params[0]);
  return Boolean(
    config &&
    config.references.length > 0 &&
    hasCompleteSymbolReferences(config, program, scopes) &&
    config.references.every(({ identifier, flag }) => {
      const field = member(identifier, "rootDir");
      return (
        field &&
        flag === "read" &&
        !isWithinAssignmentTarget(field) &&
        !(isNodeOfType(field.parent, "CallExpression") && field.parent.callee === field)
      );
    }),
  );
};

const hasOnlyLocalGuardStatements = (declared: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const node = isNodeOfType(declared, "Identifier") ? declared.parent : declared;
  const fn = isNodeOfType(node, "VariableDeclarator") ? node.init : node;
  if (
    (!isNodeOfType(fn, "ArrowFunctionExpression") && !isNodeOfType(fn, "FunctionDeclaration")) ||
    !isNodeOfType(fn.body, "BlockStatement")
  )
    return false;
  const bindings = fn.params.map((param) => scopes.symbolFor(param));
  if (!bindings.every(Boolean)) return false;
  const pureTest = (expr: EsTreeNode): boolean => {
    if (isNodeOfType(expr, "Literal")) return expr.value === null;
    if (
      isNodeOfType(expr, "MemberExpression") &&
      !expr.computed &&
      !expr.optional &&
      isNodeOfType(expr.object, "Identifier") &&
      isNodeOfType(expr.property, "Identifier")
    ) {
      return bindings.includes(scopes.symbolFor(expr.object));
    }
    if (
      isNodeOfType(expr, "BinaryExpression") &&
      (expr.operator === "==" || expr.operator === "===")
    ) {
      return pureTest(expr.left) && pureTest(expr.right);
    }
    return (
      isNodeOfType(expr, "LogicalExpression") &&
      expr.operator === "&&" &&
      pureTest(expr.left) &&
      pureTest(expr.right)
    );
  };
  return (
    fn.body.body.length > 0 &&
    fn.body.body.every((statement) => {
      if (
        !isNodeOfType(statement, "IfStatement") ||
        statement.alternate ||
        !pureTest(statement.test) ||
        !isNodeOfType(statement.consequent, "BlockStatement") ||
        statement.consequent.body.length !== 1
      )
        return false;
      const [term] = statement.consequent.body;
      if (!isNodeOfType(term, "ThrowStatement") || !isNodeOfType(term.argument, "NewExpression"))
        return false;
      const { callee, arguments: args } = term.argument;
      return (
        isNodeOfType(callee, "Identifier") &&
        callee.name === "Error" &&
        scopes.isGlobalReference(callee) &&
        args.length === 1 &&
        isNodeOfType(args[0], "Literal") &&
        typeof args[0].value === "string"
      );
    })
  );
};

// A local validator may report invalid static arguments but must neither
// modify the compiler configuration nor run a delegated callback.
export const hasReadOnlyStencilConfigGuardValidator = (
  sourceText: string,
  validatorExport: string,
): boolean => {
  const program = parse(sourceText);
  if (!program || !inertModuleInitialization(program)) return false;
  const validator = exportValue(program, validatorExport);
  const scopes = analyzeScopes(program);
  return (
    validator !== null &&
    readConfigOnlyRootDirectory(validator, program, scopes) &&
    hasOnlyLocalGuardStatements(validator, scopes)
  );
};

// The imported function still needs an independently identified stock
// provider. This check is only its direct compiler config reference census.
export const hasOnlyStencilConfigRootDirectoryReads = (
  sourceText: string,
  validatorExport: string,
): boolean => {
  const program = parse(sourceText);
  if (!program || !inertModuleInitialization(program)) return false;
  const validator = exportValue(program, validatorExport);
  return (
    validator !== null && readConfigOnlyRootDirectory(validator, program, analyzeScopes(program))
  );
};

const typeCheck = (
  node: EsTreeNode,
  parameter: EsTreeNode,
  scopes: ScopeAnalysis,
  operator: "===" | "!==",
): boolean =>
  isNodeOfType(node, "BinaryExpression") &&
  node.operator === operator &&
  isNodeOfType(node.left, "UnaryExpression") &&
  node.left.operator === "typeof" &&
  isNodeOfType(node.left.argument, "Identifier") &&
  scopes.symbolFor(node.left.argument) === scopes.symbolFor(parameter) &&
  literal(node.right, "string");

const readStencilCssTransform = (sourceText: string) => {
  const program = parse(sourceText);
  if (!program || !inertModuleInitialization(program)) return null;
  const factory = exportValue(program, "default");
  if (
    !isNodeOfType(factory, "FunctionDeclaration") ||
    factory.async ||
    factory.generator ||
    factory.params.length !== 1 ||
    (!isNodeOfType(factory.params[0], "Identifier") &&
      (!isNodeOfType(factory.params[0], "AssignmentPattern") ||
        !isNodeOfType(factory.params[0].left, "Identifier") ||
        fields(factory.params[0].right)?.size !== 0))
  )
    return null;
  const result = soleBody(factory.body);
  const options = result ? fields(result) : null;
  const transform = options?.get("transform");
  if (
    options?.size !== 3 ||
    !isNodeOfType(options.get("name"), "Literal") ||
    !literal(options.get("pluginType"), "css") ||
    !isNodeOfType(transform, "FunctionExpression") ||
    transform.generator ||
    transform.params.length !== 3 ||
    !transform.params.every((param) => isNodeOfType(param, "Identifier"))
  )
    return null;
  const [first] = transform.body.body;
  if (
    !isNodeOfType(first, "IfStatement") ||
    first.alternate ||
    !literal(soleBody(first.consequent), null) ||
    !isNodeOfType(first.test, "LogicalExpression") ||
    first.test.operator !== "||" ||
    !isNodeOfType(first.test.left, "UnaryExpression") ||
    first.test.left.operator !== "!"
  )
    return null;
  const scopes = analyzeScopes(program);
  const check = directCall(first.test.left.argument, 1);
  const input = check?.arguments[0];
  if (
    !check ||
    !isNodeOfType(input, "Identifier") ||
    scopes.symbolFor(transform.params[1]) !== scopes.symbolFor(input) ||
    !typeCheck(first.test.right, transform.params[0], scopes, "!==")
  )
    return null;
  const imported = importFor(check.callee, scopes);
  // The importer still needs to close the exact relative guard provider.
  return imported?.module.startsWith("./") ? { program, scopes, transform, imported } : null;
};

export const readStencilCssTransformEntry = (sourceText: string): StencilHookImport | null =>
  readStencilCssTransform(sourceText)?.imported ?? null;

interface StencilCssContextDelegate extends StencilHookImport {
  readonly parameterIndex: number;
}

export interface StencilCssContextEffects {
  readonly reads: readonly string[];
  readonly calls: readonly string[];
  readonly delegates: readonly StencilCssContextDelegate[];
}

const readContextEffects = (
  program: Program,
  scopes: ScopeAnalysis,
  parameter: EsTreeNode,
  role: "transform" | "delegate",
): StencilCssContextEffects | null => {
  const symbol = scopes.symbolFor(parameter);
  if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return null;
  const reads = new Set<string>();
  const calls = new Set<string>();
  const delegates: StencilCssContextDelegate[] = [];
  for (const { identifier, flag } of symbol.references) {
    if (!identifier || flag !== "read") return null;
    let current: EsTreeNode = identifier;
    const parts: string[] = [];
    while (
      isNodeOfType(current.parent, "MemberExpression") &&
      current.parent.object === current &&
      !current.parent.computed &&
      isNodeOfType(current.parent.property, "Identifier")
    ) {
      parts.push(current.parent.property.name);
      current = current.parent;
    }
    const parent = current.parent;
    const path = parts.join(".");
    if (isWithinAssignmentTarget(current)) return null;
    if (isNodeOfType(parent, "CallExpression") && parent.callee === current) {
      const args = parent.arguments;
      if (path === "diagnostics.push" && args.length === 1) {
        calls.add(path);
        continue;
      }
      if (role === "transform" && path === "fs.writeFile" && args.length === 3) {
        const flags = fields(args[2]);
        if (flags?.size !== 1 || !literal(flags.get("inMemoryOnly"), true)) return null;
        calls.add(path);
        continue;
      }
      if (
        role === "delegate" &&
        (path === "fs.readFileSync" ||
          path === "sys.normalizePath" ||
          path === "sys.resolveModuleId") &&
        args.length === 1
      ) {
        calls.add(path);
        continue;
      }
      return null;
    }
    if (role === "delegate" && path === "config.rootDir") {
      reads.add(path);
      continue;
    }
    if (
      role === "delegate" &&
      (path === "sys.normalizePath" || path === "sys.resolveModuleId") &&
      isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "typeof"
    )
      continue;
    if (
      role === "delegate" &&
      path === "sys" &&
      ((isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "&&" &&
        parent.left === current &&
        isNodeOfType(parent.parent, "IfStatement") &&
        parent.parent.test === parent) ||
        (isNodeOfType(parent, "IfStatement") && parent.test === current))
    )
      continue;
    if (
      !path &&
      role === "delegate" &&
      isNodeOfType(parent, "BinaryExpression") &&
      (parent.operator === "==" || parent.operator === "===") &&
      literal(parent.left === current ? parent.right : parent.left, null)
    )
      continue;
    if (
      !path &&
      role === "transform" &&
      isNodeOfType(parent, "CallExpression") &&
      !parent.optional &&
      isNodeOfType(parent.callee, "Identifier")
    ) {
      const imported = importFor(parent.callee, scopes);
      const parameterIndex = parent.arguments.findIndex((argument) => argument === identifier);
      if (parameterIndex < 0 || !imported?.module.startsWith("./")) return null;
      delegates.push({ ...imported, parameterIndex });
      continue;
    }
    return null;
  }
  return { reads: [...reads].sort(), calls: [...calls].sort(), delegates };
};

// Records the direct context uses only. The returned delegate edges and
// filesystem-result paths still require their own checks.
export const readStencilCssTransformContextEffects = (
  sourceText: string,
): StencilCssContextEffects | null => {
  const result = readStencilCssTransform(sourceText);
  return result
    ? readContextEffects(result.program, result.scopes, result.transform.params[2], "transform")
    : null;
};

export const readStencilCssDelegateContextEffects = (
  sourceText: string,
  importedName: string,
  parameterIndex: number,
): StencilCssContextEffects | null => {
  const program = parse(sourceText);
  if (!program || !inertModuleInitialization(program)) return null;
  const target = exportValue(program, importedName);
  if (
    (!isNodeOfType(target, "FunctionDeclaration") &&
      !isNodeOfType(target, "ArrowFunctionExpression")) ||
    target.async ||
    target.params.length <= parameterIndex ||
    parameterIndex < 0 ||
    !target.params.every((param) => isNodeOfType(param, "Identifier"))
  )
    return null;
  return readContextEffects(
    program,
    analyzeScopes(program),
    target.params[parameterIndex],
    "delegate",
  );
};

export const hasLiteralSassExtensionGuard = (sourceText: string, name: string): boolean => {
  const program = parse(sourceText);
  if (!program || !inertModuleInitialization(program)) return false;
  const guard = exportValue(program, name);
  if (
    !isNodeOfType(guard, "FunctionDeclaration") ||
    guard.async ||
    guard.generator ||
    guard.params.length !== 1 ||
    !isNodeOfType(guard.params[0], "Identifier") ||
    guard.body.body.length !== 2
  )
    return false;
  const [branch, fallback] = guard.body.body;
  const scopes = analyzeScopes(program);
  if (
    !isNodeOfType(branch, "IfStatement") ||
    branch.alternate ||
    !typeCheck(branch.test, guard.params[0], scopes, "===") ||
    !isNodeOfType(fallback, "ReturnStatement") ||
    !literal(fallback.argument, false)
  )
    return false;
  const accepted = soleBody(branch.consequent);
  if (
    !isNodeOfType(accepted, "CallExpression") ||
    accepted.optional ||
    accepted.arguments.length !== 1 ||
    !isNodeOfType(accepted.callee, "MemberExpression") ||
    accepted.callee.computed ||
    accepted.callee.optional ||
    !isNodeOfType(accepted.callee.property, "Identifier") ||
    accepted.callee.property.name !== "test" ||
    !isNodeOfType(accepted.callee.object, "Literal") ||
    !("regex" in accepted.callee.object)
  )
    return false;
  const { pattern, flags } = accepted.callee.object.regex;
  const [arg] = accepted.arguments;
  return (
    (pattern === "(\\.scss|\\.sass)$" ||
      pattern === "(?:\\.scss|\\.sass)$" ||
      pattern === "\\.s[ac]ss$") &&
    (flags === "" || flags === "i") &&
    isNodeOfType(arg, "Identifier") &&
    scopes.symbolFor(arg) === scopes.symbolFor(guard.params[0])
  );
};
