import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { hasCssBuildStartWrapper } from "./read-vite-css-build-config.js";
export interface StaticCssWriterModule {
  readonly factory: SymbolDescriptor;
  readonly regenerate: SymbolDescriptor;
  readonly producer: SymbolDescriptor;
  readonly formatter: SymbolDescriptor;
  readonly moduleDirectoryParentSteps: 1;
  readonly inputRelativeFiles: readonly string[];
  readonly outputRelativeFile: string;
  readonly requiresProducerAndFormatterProof: true;
  readonly requiresCanonicalDisjointPhysicalOutput: true;
}
/** Only the startup/path/read-write algebra; never executes a source module. */
export function readStaticCssWriterModule(
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): StaticCssWriterModule | null {
  if (!isNodeOfType(program, "Program")) return null;
  const imports = new Map<string, SymbolDescriptor>();
  const variables: EsTreeNode[] = [];
  const functions: EsTreeNode[] = [];
  for (const statement of program.body) {
    let n: EsTreeNode = statement;
    if (isNodeOfType(n, "ImportDeclaration")) {
      if (typeof n.source.value !== "string") return null;
      for (const spec of n.specifiers) {
        const imported = isNodeOfType(spec, "ImportDefaultSpecifier")
          ? "default"
          : isNodeOfType(spec, "ImportSpecifier") && isNodeOfType(spec.imported, "Identifier")
            ? spec.imported.name
            : null;
        const symbol = scopes.symbolFor(spec.local);
        const key = n.source.value + ":" + imported;
        if (
          !symbol ||
          !imported ||
          imports.has(key) ||
          symbol.references.some((r) => r.flag !== "read")
        )
          return null;
        imports.set(key, symbol);
      }
      continue;
    }
    if (isNodeOfType(n, "ExportNamedDeclaration")) {
      if (n.source) return null;
      if (!n.declaration) {
        if (
          n.specifiers.some(
            (s) => !isNodeOfType(s, "ExportSpecifier") || !isNodeOfType(s.local, "Identifier"),
          )
        )
          return null;
        continue;
      }
      n = n.declaration;
    }
    if (isNodeOfType(n, "VariableDeclaration")) {
      if (n.kind !== "const" || n.declarations.length !== 1) return null;
      variables.push(n.declarations[0]);
    } else if (isNodeOfType(n, "FunctionDeclaration")) functions.push(n);
    else return null;
  }
  const fs = imports.get("node:fs:default"),
    path = imports.get("node:path:default"),
    fileUrl = imports.get("node:url:fileURLToPath");
  if (
    imports.size !== 3 ||
    !fs ||
    !path ||
    !fileUrl ||
    variables.length < 4 ||
    variables.length > 11
  )
    return null;
  const same = (n: EsTreeNode | undefined | null, s: SymbolDescriptor): boolean =>
    isNodeOfType(n, "Identifier") && scopes.symbolFor(n)?.id === s.id;
  const literal = (n: EsTreeNode | undefined | null, v: unknown): boolean =>
    isNodeOfType(n, "Literal") && n.value === v;
  const call = (
    n: EsTreeNode | undefined | null,
    s: SymbolDescriptor,
    args: number,
  ): n is EsTreeNode & { arguments: EsTreeNode[] } =>
    isNodeOfType(n, "CallExpression") &&
    !n.optional &&
    n.arguments.length === args &&
    same(n.callee, s);
  const member = (
    n: EsTreeNode | undefined | null,
    s: SymbolDescriptor,
    key: string,
    args: number,
  ): n is EsTreeNode & { arguments: EsTreeNode[] } =>
    isNodeOfType(n, "CallExpression") &&
    !n.optional &&
    n.arguments.length === args &&
    isNodeOfType(n.callee, "MemberExpression") &&
    !n.callee.computed &&
    !n.callee.optional &&
    same(n.callee.object, s) &&
    isNodeOfType(n.callee.property, "Identifier") &&
    n.callee.property.name === key;
  const declarator = (n: EsTreeNode): { symbol: SymbolDescriptor; init: EsTreeNode } | null => {
    if (!isNodeOfType(n, "VariableDeclarator") || !isNodeOfType(n.id, "Identifier") || !n.init)
      return null;
    const symbol = scopes.symbolFor(n.id);
    return symbol && !symbol.references.some((r) => r.flag !== "read")
      ? { symbol, init: n.init }
      : null;
  };
  const directory = declarator(variables[0]),
    root = declarator(variables[1]);
  if (!directory || !root || !member(directory.init, path, "dirname", 1)) return null;
  const url = directory.init.arguments[0];
  if (!call(url, fileUrl, 1)) return null;
  const meta = url.arguments[0];
  if (
    !isNodeOfType(meta, "MemberExpression") ||
    meta.computed ||
    meta.optional ||
    !isNodeOfType(meta.object, "MetaProperty") ||
    meta.object.meta.name !== "import" ||
    meta.object.property.name !== "meta" ||
    !isNodeOfType(meta.property, "Identifier") ||
    meta.property.name !== "url"
  )
    return null;
  if (
    !member(root.init, path, "resolve", 2) ||
    !same(root.init.arguments[0], directory.symbol) ||
    !literal(root.init.arguments[1], "..")
  )
    return null;
  const inputs: string[] = [];
  let output: { symbol: SymbolDescriptor; file: string } | null = null;
  for (const n of variables.slice(2)) {
    const d = declarator(n);
    if (
      !d ||
      !isNodeOfType(d.init, "CallExpression") ||
      !member(d.init, path, "join", d.init.arguments.length) ||
      d.init.arguments.length < 2 ||
      !same(d.init.arguments[0], root.symbol)
    )
      return null;
    const segments = d.init.arguments.slice(1);
    if (
      !segments.every(
        (s) =>
          isNodeOfType(s, "Literal") &&
          typeof s.value === "string" &&
          /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(s.value) &&
          s.value !== "." &&
          s.value !== "..",
      )
    )
      return null;
    const file = segments.map((s) => (isNodeOfType(s, "Literal") ? String(s.value) : "")).join("/");
    if (file.endsWith(".css")) {
      if (output) return null;
      output = { symbol: d.symbol, file };
    } else if (file.endsWith(".js")) inputs.push(file);
    else return null;
  }
  if (!output || !inputs.length || new Set(inputs).size !== inputs.length) return null;
  const local = (n: EsTreeNode | undefined | null): SymbolDescriptor | null => {
    if (!isNodeOfType(n, "Identifier")) return null;
    const symbol = scopes.symbolFor(n);
    return symbol &&
      functions.includes(symbol.declarationNode) &&
      !symbol.references.some((r) => r.flag !== "read")
      ? symbol
      : null;
  };
  for (const regenerateNode of functions) {
    if (
      !isNodeOfType(regenerateNode, "FunctionDeclaration") ||
      !regenerateNode.async ||
      regenerateNode.generator ||
      regenerateNode.params.length ||
      !regenerateNode.body ||
      regenerateNode.body.body.length !== 7
    )
      continue;
    const stmts = regenerateNode.body.body;
    const localConst = (n: EsTreeNode) =>
      isNodeOfType(n, "VariableDeclaration") && n.kind === "const" && n.declarations.length === 1
        ? declarator(n.declarations[0])
        : null;
    const modules = localConst(stmts[0]),
      css = localConst(stmts[1]),
      previous = localConst(stmts[2]);
    if (
      !modules ||
      !css ||
      !previous ||
      !isNodeOfType(modules.init, "AwaitExpression") ||
      !isNodeOfType(modules.init.argument, "CallExpression")
    )
      continue;
    const producer = local(modules.init.argument.callee);
    if (
      !producer ||
      !call(modules.init.argument, producer, 0) ||
      !isNodeOfType(css.init, "CallExpression")
    )
      continue;
    const formatter = local(css.init.callee);
    if (!formatter || !call(css.init, formatter, 1) || !same(css.init.arguments[0], modules.symbol))
      continue;
    const old = previous.init;
    if (
      !isNodeOfType(old, "ConditionalExpression") ||
      !member(old.test, fs, "existsSync", 1) ||
      !same(old.test.arguments[0], output.symbol) ||
      !member(old.consequent, fs, "readFileSync", 2) ||
      !same(old.consequent.arguments[0], output.symbol) ||
      !literal(old.consequent.arguments[1], "utf8") ||
      !literal(old.alternate, null)
    )
      continue;
    const skip = stmts[3];
    if (
      !isNodeOfType(skip, "IfStatement") ||
      skip.alternate ||
      !isNodeOfType(skip.test, "BinaryExpression") ||
      skip.test.operator !== "===" ||
      !same(skip.test.left, previous.symbol) ||
      !same(skip.test.right, css.symbol) ||
      !isNodeOfType(skip.consequent, "BlockStatement") ||
      skip.consequent.body.length !== 1 ||
      !isNodeOfType(skip.consequent.body[0], "ReturnStatement") ||
      !literal(skip.consequent.body[0].argument, false)
    )
      continue;
    const mkdir = isNodeOfType(stmts[4], "ExpressionStatement") ? stmts[4].expression : null,
      write = isNodeOfType(stmts[5], "ExpressionStatement") ? stmts[5].expression : null;
    if (
      !member(mkdir, fs, "mkdirSync", 2) ||
      !member(mkdir.arguments[0], path, "dirname", 1) ||
      !same(mkdir.arguments[0].arguments[0], output.symbol) ||
      !isNodeOfType(mkdir.arguments[1], "ObjectExpression") ||
      mkdir.arguments[1].properties.length !== 1
    )
      continue;
    const recursive = mkdir.arguments[1].properties[0];
    if (
      !isNodeOfType(recursive, "Property") ||
      recursive.computed ||
      recursive.kind !== "init" ||
      recursive.method ||
      !isNodeOfType(recursive.key, "Identifier") ||
      recursive.key.name !== "recursive" ||
      !literal(recursive.value, true)
    )
      continue;
    if (
      !member(write, fs, "writeFileSync", 3) ||
      !same(write.arguments[0], output.symbol) ||
      !same(write.arguments[1], css.symbol) ||
      !literal(write.arguments[2], "utf8") ||
      !isNodeOfType(stmts[6], "ReturnStatement") ||
      !literal(stmts[6].argument, true)
    )
      continue;
    const regenerate = [...scopes.rootScope.symbols.values()].find(
      (s) => s.declarationNode === regenerateNode,
    );
    if (!regenerate) continue;
    const factories = functions.filter((f) => hasCssBuildStartWrapper(f, regenerate, scopes));
    if (factories.length !== 1) continue;
    const factory = [...scopes.rootScope.symbols.values()].find(
      (s) => s.declarationNode === factories[0],
    );
    if (!factory) return null;
    return {
      factory,
      regenerate,
      producer,
      formatter,
      moduleDirectoryParentSteps: 1,
      inputRelativeFiles: inputs,
      outputRelativeFile: output.file,
      requiresProducerAndFormatterProof: true,
      requiresCanonicalDisjointPhysicalOutput: true,
    };
  }
  return null;
}
