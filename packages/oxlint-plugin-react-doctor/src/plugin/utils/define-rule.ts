import type { FileScan } from "./file-scan.js";
import { EMPTY_RULE_VISITORS } from "./empty-rule-visitors.js";
import {
  collectJsxRuntimeImports,
  jsxAttributeIsNonReactDialectMarker,
} from "./non-react-jsx-dialect.js";
import { skipNonProductionFiles } from "./skip-non-production-files.js";
import type { Rule } from "./rule.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";

// A rule definition has exactly one execution mode. An AST rule provides
// `create` (per-file visitors, hosted by oxlint/ESLint); a scan rule
// provides `scan` (a project-level file scan, executed by
// @react-doctor/core's check-security-scan environment check) and gets an
// inert visitor factory injected for host compatibility. Metadata,
// registration, tags, and severity flow identically either way.
export type RuleDefinition = Rule | (Omit<Rule, "create"> & { scan: FileScan });

// Rules tagged `"react-jsx-only"` apply React-flavoured semantics
// (a11y semantics tuned for React's synthetic-event listener naming,
// React-cased prop names, etc.) and should pass through for files
// authored in non-React JSX dialects: Solid.js, Qwik, Voby, Vidode.
// Detection happens lazily — we snapshot the dialect status from the
// program's import declarations on the Program visit, then short-
// circuit every other visitor when the file is Solid/Qwik. A late
// `classList=` / `class:` / `bind:` marker upgrades the dialect mid-
// file (some files import Solid via re-export and don't have an
// obvious `solid-js` import).
type GenericVisitors = Record<string, unknown>;

const wrapCreateForReactJsxOnly = <
  CreateFn extends (context: { filename?: string }) => GenericVisitors,
>(
  create: CreateFn,
): CreateFn =>
  ((context: Parameters<CreateFn>[0]) => {
    const innerVisitors = create(context);
    let fileIsNonReactJsx = false;
    let fileImportsReactRuntime = false;
    // We need a Program visitor to seed the dialect status BEFORE any
    // JSX visitor fires. If the original rule already declared one,
    // wrap it; otherwise inject a fresh one.
    const wrappedVisitors: GenericVisitors = {};
    for (const key in innerVisitors) {
      if (!Object.hasOwn(innerVisitors, key)) continue;
      const visitor = innerVisitors[key];
      if (typeof visitor !== "function") {
        wrappedVisitors[key] = visitor;
        continue;
      }
      const firstCharacter = key.charAt(0);
      if (firstCharacter < "A" || firstCharacter > "Z") {
        // Lifecycle hooks etc. — pass through unwrapped.
        wrappedVisitors[key] = visitor;
        continue;
      }
      if (key === "Program") {
        wrappedVisitors.Program = (node: EsTreeNodeOfType<"Program">) => {
          const runtimeImports = collectJsxRuntimeImports(node);
          fileImportsReactRuntime = runtimeImports.hasReactRuntime;
          fileIsNonReactJsx = runtimeImports.hasNonReactRuntime && !runtimeImports.hasReactRuntime;
          (visitor as (n: EsTreeNodeOfType<"Program">) => void)(node);
        };
        continue;
      }
      if (key === "JSXOpeningElement") {
        wrappedVisitors.JSXOpeningElement = (node: EsTreeNodeOfType<"JSXOpeningElement">) => {
          if (
            !fileImportsReactRuntime &&
            !fileIsNonReactJsx &&
            jsxAttributeIsNonReactDialectMarker(node)
          ) {
            fileIsNonReactJsx = true;
          }
          if (fileIsNonReactJsx) return;
          (visitor as (n: EsTreeNodeOfType<"JSXOpeningElement">) => void)(node);
        };
        continue;
      }
      wrappedVisitors[key] = (...args: unknown[]) => {
        if (fileIsNonReactJsx) return;
        (visitor as (...a: unknown[]) => unknown)(...args);
      };
    }
    if (!("Program" in wrappedVisitors)) {
      wrappedVisitors.Program = (node: EsTreeNodeOfType<"Program">) => {
        const runtimeImports = collectJsxRuntimeImports(node);
        fileImportsReactRuntime = runtimeImports.hasReactRuntime;
        fileIsNonReactJsx = runtimeImports.hasNonReactRuntime && !runtimeImports.hasReactRuntime;
      };
    }
    return wrappedVisitors;
  }) as CreateFn;

export const defineRule = (rule: RuleDefinition): Rule => {
  if (!("create" in rule)) {
    return { ...rule, create: () => EMPTY_RULE_VISITORS };
  }
  const tags = rule.tags;
  let wrappedCreate = rule.create;
  // Rules tagged `"test-noise"` are by-design noisy in non-production files
  // (design-system style preferences, deprecated-API hints, auto-parallelizable
  // awaits, …), so we auto-skip testlike files for them. `migration-hint` wins:
  // deprecated API usage in test code is the very surface that needs migration
  // (`react-dom/test-utils` imports, legacy lifecycle methods in test fixtures),
  // so a rule carrying both tags keeps firing there.
  const honorsTestNoise = tags?.includes("test-noise") && !tags?.includes("migration-hint");
  if (tags?.includes("react-jsx-only")) {
    wrappedCreate = wrapCreateForReactJsxOnly(wrappedCreate as never) as never;
  }
  if (honorsTestNoise) {
    wrappedCreate = skipNonProductionFiles(wrappedCreate);
  }
  if (wrappedCreate === rule.create) return rule;
  return {
    ...rule,
    create: wrappedCreate,
  };
};
