import { readFileSync } from "node:fs";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isConstDeclaredBinding } from "../../utils/is-const-declared-binding.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isOutsideBrowserBundle } from "../../utils/is-outside-browser-bundle.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A relative template path with a static directory segment before the first
// hole (`./locales/${lang}.js`) resolves to a bundler context module that DOES
// code-split, so it must not be flagged — unlike a protocol/absolute prefix or a
// path that leads with the interpolation, which have no analyzable static prefix.
// We require a real static segment: a `/` after the leading `./`/`../` markers.
// Tsconfig-style alias markers (`@/`, `~/`) resolve through the same bundler
// context-module machinery, so they count as relative markers too. So does a
// bare or scoped package specifier with a static directory inside the package
// (`react-intl/locale-data/${locale}`, `@emoji-mart/data/i18n/${lang}.json`):
// webpack contexts the package directory the same way it contexts `./locales/`.
const RELATIVE_OR_ALIAS_PREFIX_PATTERN = /^(?:(?:\.\.?\/)+|[@~]\/)/;
const PACKAGE_SPECIFIER_PREFIX_PATTERN = /^(?:@[\w.-]+\/[\w.-]+\/|[A-Za-z][\w.-]*\/)/;
const hasStaticDirectoryPrefix = (template: EsTreeNodeOfType<"TemplateLiteral">): boolean => {
  const firstQuasiText = getFirstQuasiText(template);
  if (firstQuasiText === null) return false;
  const prefix =
    firstQuasiText.match(RELATIVE_OR_ALIAS_PREFIX_PATTERN) ??
    firstQuasiText.match(PACKAGE_SPECIFIER_PREFIX_PATTERN);
  if (!prefix) return false;
  return firstQuasiText.slice(prefix[0].length).includes("/");
};

const getFirstQuasiText = (template: EsTreeNodeOfType<"TemplateLiteral">): string | null => {
  const firstQuasi = template.quasis?.[0];
  if (!firstQuasi || !isNodeOfType(firstQuasi, "TemplateElement")) return null;
  const text = firstQuasi.value?.cooked ?? firstQuasi.value?.raw;
  return typeof text === "string" ? text : null;
};

// `import(`./module?v=${cacheBust}`)` interpolates only the query string —
// the module path itself is static, so the bundler resolves it normally.
const interpolatesOnlyQueryString = (template: EsTreeNodeOfType<"TemplateLiteral">): boolean => {
  const firstQuasiText = getFirstQuasiText(template);
  return firstQuasiText !== null && firstQuasiText.includes("?");
};

// `require(`${packageName}/package.json`).version` probes an installed
// package's manifest — a Node version-check idiom, never a bundling concern.
const targetsPackageManifest = (template: EsTreeNodeOfType<"TemplateLiteral">): boolean => {
  const lastQuasi = template.quasis?.[template.quasis.length - 1];
  if (!lastQuasi || !isNodeOfType(lastQuasi, "TemplateElement")) return false;
  const text = lastQuasi.value?.cooked ?? lastQuasi.value?.raw;
  return typeof text === "string" && text.endsWith("package.json");
};

// `import(/* webpackIgnore: true */ /* @vite-ignore */ path)` explicitly
// opts the import out of bundling — the module is resolved at runtime (a
// user-configured plugin script), so there is nothing the bundler could ever
// split and the "stays in the main bundle" premise is void. Comments aren't
// in the AST, so the annotation is read from the file text inside the
// expression's span (same disk-read precedent as exhaustive-deps
// suppression). Only files that actually carry an annotation cache their
// text; the common no-annotation file caches a flat `false`.
const BUNDLER_IGNORE_ANNOTATION_PATTERN = /webpackIgnore\s*:\s*true|@vite-ignore/;

const annotatedFileTextCache = new Map<string, string | false>();

const readAnnotatedFileText = (filename: string | undefined): string | null => {
  if (!filename) return null;
  const cached = annotatedFileTextCache.get(filename);
  if (cached !== undefined) return cached === false ? null : cached;
  let annotatedText: string | false = false;
  try {
    const text = readFileSync(filename, "utf8");
    if (BUNDLER_IGNORE_ANNOTATION_PATTERN.test(text)) annotatedText = text;
  } catch {
    annotatedText = false;
  }
  annotatedFileTextCache.set(filename, annotatedText);
  return annotatedText === false ? null : annotatedText;
};

const hasBundlerIgnoreAnnotation = (node: EsTreeNode, filename: string | undefined): boolean => {
  const fileText = readAnnotatedFileText(filename);
  if (fileText === null) return false;
  const range = node.range;
  if (!range) return false;
  return BUNDLER_IGNORE_ANNOTATION_PATTERN.test(fileText.slice(range[0], range[1]));
};

export const clearBundlerIgnoreAnnotationCache = (): void => {
  annotatedFileTextCache.clear();
};

const isUrlCreateObjectUrlCall = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  isNodeOfType(expression.callee, "MemberExpression") &&
  isNodeOfType(expression.callee.object, "Identifier") &&
  expression.callee.object.name === "URL" &&
  isNodeOfType(expression.callee.property, "Identifier") &&
  expression.callee.property.name === "createObjectURL";

// A const binding whose initializer is a plain string literal
// (`const moduleName = "sharp"; import(moduleName)`) is the deliberate
// keep-this-out-of-the-bundle indirection — the author could have inlined
// the literal and chose not to. A const blob URL
// (`const url = URL.createObjectURL(blob); import(url)`) has no module the
// bundler could ever split. Neither is a code-splitting miss.
const isDeliberateStaticIndirection = (argument: EsTreeNode): boolean => {
  if (!isNodeOfType(argument, "Identifier")) return false;
  const binding = findVariableInitializer(argument, argument.name);
  if (!binding || !isConstDeclaredBinding(binding) || !binding.initializer) return false;
  const initializer = binding.initializer;
  if (isNodeOfType(initializer, "Literal") && typeof initializer.value === "string") return true;
  if (
    isNodeOfType(initializer, "TemplateLiteral") &&
    getStaticTemplateLiteralValue(initializer) !== null
  ) {
    return true;
  }
  return isUrlCreateObjectUrlCall(initializer);
};

// HACK: bundlers can only tree-shake / split when the import target is a
// statically-analyzable string literal. `import(variable)` or
// `require(variable)` defeats trace targets and forces a fat bundle.
export const noDynamicImportPath = defineRule({
  id: "no-dynamic-import-path",
  title: "Non-static dynamic import path",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use a plain string path: `import('./feature/heavy.js')` so the bundler can split this into its own chunk.",
  create: (context: RuleContext) => ({
    ImportExpression(node: EsTreeNodeOfType<"ImportExpression">) {
      const source = node.source;
      if (source && !isNodeOfType(source, "Literal") && !isNodeOfType(source, "TemplateLiteral")) {
        if (isDeliberateStaticIndirection(source)) return;
        if (hasBundlerIgnoreAnnotation(node, context.filename)) return;
        if (isOutsideBrowserBundle(node, context.filename)) return;
        context.report({
          node,
          message:
            "This can stay in the main bundle because the bundler cannot code-split a dynamic import path. Use a plain string path instead.",
        });
        return;
      }
      if (
        isNodeOfType(source, "TemplateLiteral") &&
        (source.expressions?.length ?? 0) > 0 &&
        !hasStaticDirectoryPrefix(source) &&
        !interpolatesOnlyQueryString(source) &&
        !targetsPackageManifest(source)
      ) {
        if (hasBundlerIgnoreAnnotation(node, context.filename)) return;
        if (isOutsideBrowserBundle(node, context.filename)) return;
        context.report({
          node,
          message:
            "This can stay in the main bundle because the bundler cannot code-split a dynamic import path with `${dynamic_path}`. Use a plain string path instead.",
        });
      }
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "require") return;
      const arg = node.arguments?.[0];
      if (!arg) return;
      if (!isNodeOfType(arg, "Literal") && !isNodeOfType(arg, "TemplateLiteral")) {
        if (isDeliberateStaticIndirection(arg)) return;
        if (isOutsideBrowserBundle(node, context.filename)) return;
        context.report({
          node,
          message:
            "This ships in the main bundle & slows page load, since the bundler can't trace a dynamic require() path. Use a plain string path instead.",
        });
        return;
      }
      if (
        isNodeOfType(arg, "TemplateLiteral") &&
        (arg.expressions?.length ?? 0) > 0 &&
        !hasStaticDirectoryPrefix(arg) &&
        !interpolatesOnlyQueryString(arg) &&
        !targetsPackageManifest(arg)
      ) {
        if (isOutsideBrowserBundle(node, context.filename)) return;
        context.report({
          node,
          message:
            "This ships in the main bundle & slows page load, since the bundler can't trace a dynamic require() path. Use a plain string path instead of one with `${...}`.",
        });
      }
    },
  }),
});
