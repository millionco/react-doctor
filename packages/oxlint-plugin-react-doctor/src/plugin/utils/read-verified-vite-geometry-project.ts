import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildSourceProjectIndex,
  readSelectedTypedSourceClosure,
} from "./build-source-project-index.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { isInferredTypeOnlyAssertionImport } from "./is-inferred-type-only-assertion-import.js";
import { hasReadonlyRendererImportBindings } from "./has-readonly-renderer-import-bindings.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parseSourceFile } from "./parse-source-file.js";
import { readStandaloneVitePlainCss } from "./read-standalone-vite-plain-css.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { normalizeFilename } from "./normalize-filename.js";
import type { RuleContext } from "./rule-context.js";
import { readStandaloneVite7TscSelection } from "./read-standalone-vite7-tsc-selection.js";
import { hasVerifiedViteGeometryPackages } from "./read-verified-vite-geometry-packages.js";
import { createViteTypedRuntimeEdgeReader } from "./vite-typed-runtime-edges.js";
import { walkAst } from "./walk-ast.js";

const JSX_PRAGMA = /@jsx(?:Runtime|ImportSource|Frag)?\b/u;
const UNKNOWN_GLOBAL_OBJECTS = new Set(["Reflect", "globalThis", "self", "global"]);
const REQUIRED_RENDERER_IMPORTS = new Set(["react", "react-dom/client", "@react-three/fiber"]);
const UNSUPPORTED_MEMBER_NAMES = new Set([
  "prototype",
  "__proto__",
  "constructor",
  "getPrototypeOf",
  "setPrototypeOf",
]);
const DIRECT_MATH_CALLS = new Set([
  "atan2",
  "cos",
  "exp",
  "floor",
  "min",
  "pow",
  "random",
  "round",
  "sin",
  "sqrt",
  "tan",
]);

const plainFile = (filename: string): boolean => {
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  const info = fs.lstatSync(filename, { throwIfNoEntry: false });
  return Boolean(info?.isFile() && fs.realpathSync(filename) === filename);
};

const hasSelectedTypeScriptConfiguration = (root: string, filename: string): boolean => {
  for (
    let directory = path.dirname(filename);
    directory !== root;
    directory = path.dirname(directory)
  ) {
    if (!isPathInside(directory, root)) return false;
    for (const name of ["tsconfig.json", "jsconfig.json", "package.json"]) {
      const candidate = path.join(directory, name);
      recordExistenceProbe(candidate);
      if (fs.lstatSync(candidate, { throwIfNoEntry: false })) return false;
    }
  }
  return true;
};

const hasStockSourceGeometryIntrinsics = (
  program: EsTreeNode,
  scope: RuleContext["scopes"],
): boolean => {
  let qualified = true;
  walkAst(program, (node) => {
    if (!qualified) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      qualified = !UNSUPPORTED_MEMBER_NAMES.has(getStaticPropertyName(node) ?? "");
    }
    if (!isNodeOfType(node, "Identifier") || !scope.isGlobalReference(node)) return qualified;
    if (UNKNOWN_GLOBAL_OBJECTS.has(node.name)) {
      qualified = false;
      return false;
    }
    if (node.name !== "Math" && node.name !== "Array" && node.name !== "window") {
      return qualified;
    }
    const member = node.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      member.optional ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier") ||
      isWithinAssignmentTarget(member)
    ) {
      qualified = false;
      return false;
    }
    const property = member.property.name;
    const invocation = member.parent;
    const direct =
      isNodeOfType(invocation, "CallExpression") &&
      invocation.callee === member &&
      !invocation.optional;
    if (node.name === "Math") {
      qualified = property === "PI" || (direct && DIRECT_MATH_CALLS.has(property));
    } else if (node.name === "Array") {
      qualified = property === "isArray" && direct && invocation.arguments.length === 1;
    } else if (property === "innerWidth" && !direct) {
      qualified = true;
    } else {
      qualified = Boolean(
        direct &&
        findEnclosingFunction(invocation) &&
        isNodeOfType(invocation.parent, "ExpressionStatement") &&
        (property === "open"
          ? invocation.arguments.length === 2 &&
            (isNodeOfType(invocation.arguments[0], "Identifier") ||
              isNodeOfType(invocation.arguments[0], "Literal")) &&
            isNodeOfType(invocation.arguments[1], "Literal")
          : property === "dispatchEvent" &&
            invocation.arguments.length === 1 &&
            isNodeOfType(invocation.arguments[0], "NewExpression") &&
            isNodeOfType(invocation.arguments[0].callee, "Identifier") &&
            invocation.arguments[0].callee.name === "KeyboardEvent" &&
            scope.isGlobalReference(invocation.arguments[0].callee)),
      );
    }
    return qualified;
  });
  return qualified;
};

export const hasVerifiedViteGeometryProject = (context: RuleContext): boolean => {
  try {
    const root = getReactDoctorStringSetting(context.settings, "rootDirectory");
    const filename = context.filename && normalizeFilename(context.filename);
    const program = context.scopes.rootScope.node;
    if (!root || !filename || !path.isAbsolute(root) || !isNodeOfType(program, "Program"))
      return false;
    const route = readStandaloneVite7TscSelection(filename);
    if (!route || route.selection.projectDirectory !== root || !route.typeScriptFirstPhase)
      return false;
    const entry = route.selection.moduleEntry;
    const configProgram = parseSourceFile(route.selection.configFile);
    if (!configProgram) return false;
    const stylesheets = new Set<string>();
    const readEdge = createViteTypedRuntimeEdgeReader({
      projectDirectory: root,
      aliases: route.callback.aliases,
      defaultJsonModuleEmitter: false,
    });
    const index = buildSourceProjectIndex({
      rootDirectory: root,
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
      includeTestlikeSources: true,
      readTypedRuntimeEdge: (module, node, source) => {
        if (
          isNodeOfType(node, "ImportDeclaration") &&
          isInferredTypeOnlyAssertionImport(node, module.programNode, module.scopes, {
            allowNamedTypeReferences: true,
          })
        )
          return { kind: "erased" };
        const edge = readEdge(module, node, source);
        if (edge?.kind !== "file" || !edge.filename.endsWith(".css")) return edge;
        if (
          !isNodeOfType(node, "ImportDeclaration") ||
          node.specifiers.length > 0 ||
          !readStandaloneVitePlainCss({ projectRoot: root, filename: edge.filename, configProgram })
        )
          return { kind: "opaque" };
        stylesheets.add(edge.filename);
        return edge;
      },
    });
    if (!index || index.hasOpaqueMdxConsumerSurface || !index.typedEdges) return false;
    const closure = readSelectedTypedSourceClosure(index, [entry]);
    if (!closure || closure.opaqueIssuers.size || !closure.reachable.has(filename)) return false;

    const providerRequests = [];
    const seenProviders = new Set<string>();
    for (const member of closure.reachable) {
      if (stylesheets.has(member)) continue;
      const source = index.modulesByFilePath.get(member);
      if (!source || !plainFile(member) || !hasSelectedTypeScriptConfiguration(root, member))
        return false;
      recordContentProbe(member);
      if (
        JSX_PRAGMA.test(fs.readFileSync(member, "utf8")) ||
        !hasStockSourceGeometryIntrinsics(source.programNode, source.scopes) ||
        !hasReadonlyRendererImportBindings(source.programNode, source.scopes)
      )
        return false;
      const specifiers = [...(index.typedEdges.externalByIssuer.get(member) ?? [])];
      for (const specifier of specifiers) seenProviders.add(specifier);
      if (specifiers.length) providerRequests.push({ filename: member, requests: specifiers });
    }
    if ([...REQUIRED_RENDERER_IMPORTS].some((source) => !seenProviders.has(source))) return false;
    return hasVerifiedViteGeometryPackages(root, providerRequests);
  } catch {
    return false;
  }
};
