import { REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY } from "./constants/host.js";
import { ruleRegistry } from "./rule-registry.js";
import { RULE_REQUIRED_IMPORTS } from "./rule-required-imports.js";
import { EMPTY_RULE_VISITORS } from "./utils/empty-rule-visitors.js";
import type { EsTreeNode } from "./utils/es-tree-node.js";
import { isNodeOfType } from "./utils/is-node-of-type.js";
import type { Rule } from "./utils/rule.js";
import type { BaseRuleContext } from "./utils/rule-context.js";
import type { HostRule, RulePlugin } from "./utils/rule-plugin.js";
import type { RuleVisitors } from "./utils/rule-visitors.js";
import { resetFilesystemCaches } from "./utils/reset-filesystem-caches.js";
import { walkAst } from "./utils/walk-ast.js";
import { wrapInkRule } from "./utils/wrap-ink-rule.js";
import { wrapNextjsRule } from "./utils/wrap-nextjs-rule.js";
import { wrapReactNativeRule } from "./utils/wrap-react-native-rule.js";
import { wrapRuleWithPerformanceTiming } from "./utils/wrap-rule-with-performance-timing.js";
import { wrapWithSemanticContext } from "./utils/wrap-with-semantic-context.js";

// Wraps every `framework: "react-native"` rule with the shared package-
// boundary check (`isReactNativeFileActive`) and every
// `framework: "nextjs"` rule with the parallel check (`isNextFileActive`)
// so they short-circuit on files whose own package demonstrably targets
// another platform. Done at registry load rather than per-rule so adding
// a new `rn-*` / `nextjs-*` rule never needs to remember to repeat the
// same gate — it just lands in its bucket directory and the registry
// takes care of the rest. Other rules pass through unchanged.
//
// Every rule then gets the lazy scope-tree and CFG wrapper — the analyses
// build on first `context.scopes` / `context.cfg` access and are memoized
// per Program, so rules that never read them pay only the root capture.
const applyFrameworkGate = (rule: Rule): Rule => {
  if (rule.minimumInkVersion) return wrapInkRule(rule);
  if (rule.framework === "react-native") return wrapReactNativeRule(rule);
  if (rule.framework === "nextjs") return wrapNextjsRule(rule);
  return rule;
};

const NON_STATIC_MODULE_LOAD_PATTERN = /\b(?:require|import)\s*\(/;

const importSourcesByProgram = new WeakMap<EsTreeNode, ReadonlySet<string>>();

const getModuleSource = (node: EsTreeNode): string | null => {
  if (
    isNodeOfType(node, "ImportDeclaration") ||
    isNodeOfType(node, "ExportAllDeclaration") ||
    isNodeOfType(node, "ImportExpression")
  ) {
    return isNodeOfType(node.source, "Literal") && typeof node.source.value === "string"
      ? node.source.value
      : null;
  }
  if (isNodeOfType(node, "ExportNamedDeclaration")) {
    return node.source && typeof node.source.value === "string" ? node.source.value : null;
  }
  if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "require"
  ) {
    const moduleArgument = node.arguments[0];
    return isNodeOfType(moduleArgument, "Literal") && typeof moduleArgument.value === "string"
      ? moduleArgument.value
      : null;
  }
  return null;
};

// `require()` / dynamic `import()` need a full walk, only done when the
// source text (if the host exposes it) contains such a call.
const collectImportSources = (
  programRoot: EsTreeNode,
  sourceText: string | undefined,
): ReadonlySet<string> => {
  const sources = new Set<string>();
  if (sourceText === undefined || NON_STATIC_MODULE_LOAD_PATTERN.test(sourceText)) {
    walkAst(programRoot, (node) => {
      const source = getModuleSource(node);
      if (source !== null) sources.add(source);
    });
    return sources;
  }
  if (isNodeOfType(programRoot, "Program")) {
    for (const statement of programRoot.body) {
      const source = getModuleSource(statement);
      if (source !== null) sources.add(source);
    }
  }
  return sources;
};

const getImportSources = (
  context: BaseRuleContext,
  programRoot: EsTreeNode,
): ReadonlySet<string> => {
  let sources = importSourcesByProgram.get(programRoot);
  if (!sources) {
    sources = collectImportSources(programRoot, context.sourceCode?.getText?.());
    importSourcesByProgram.set(programRoot, sources);
  }
  return sources;
};

const hasRequiredImport = (
  sources: ReadonlySet<string>,
  requiredImports: ReadonlyArray<string>,
): boolean => {
  for (const source of sources) {
    for (const packageName of requiredImports) {
      if (source === packageName || source.startsWith(`${packageName}/`)) return true;
    }
  }
  return false;
};

// Skips `create` (and the semantic context behind it) on files that import
// none of the rule's required packages.
const applyRequiredImportsGate = (ruleId: string, rule: HostRule): HostRule => {
  const requiredImports = RULE_REQUIRED_IMPORTS[ruleId];
  if (!requiredImports) return rule;
  return {
    ...rule,
    create: (context: BaseRuleContext): RuleVisitors => {
      const programRoot = context.sourceCode?.ast;
      if (!programRoot) return rule.create(context);
      return hasRequiredImport(getImportSources(context, programRoot), requiredImports)
        ? rule.create(context)
        : EMPTY_RULE_VISITORS;
    },
  };
};

const applyFrameworkRuleWrappers = (registry: Record<string, Rule>): Record<string, HostRule> => {
  const wrapped: Record<string, HostRule> = {};
  for (const [ruleId, rule] of Object.entries(registry)) {
    wrapped[ruleId] = wrapRuleWithPerformanceTiming(
      ruleId,
      applyRequiredImportsGate(ruleId, wrapWithSemanticContext(applyFrameworkGate(rule))),
    );
  }
  return wrapped;
};

// The plugin object loaded by oxlint (via `dist/react-doctor-plugin.js`)
// and by `eslint-plugin.ts`. Rules are sourced from the codegen-built
// `rule-registry.ts`, which scans every `defineRule({ id: "...", ... })`
// declaration under `src/plugin/rules/<bucket>/<rule>.ts`. Adding a new
// rule is a single-file operation: create the rule, set its `id`, run
// `pnpm gen`.
const plugin: RulePlugin = {
  meta: { name: "react-doctor" },
  rules: applyFrameworkRuleWrappers(ruleRegistry),
};

// HACK: oxlint owns the plugin's module instance, so a host that reuses one
// oxlint process for many jobs (`@react-doctor/core`'s worker) has no import
// path to our caches; the reset is published on a well-known global instead.
Object.defineProperty(globalThis, REACT_DOCTOR_PLUGIN_RESET_HOOK_KEY, {
  value: resetFilesystemCaches,
  configurable: true,
});

export default plugin;
