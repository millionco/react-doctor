import { isTestlikeFilename } from "./is-testlike-filename.js";
import {
  fileImportsNonReactJsxDialect,
  jsxAttributeIsNonReactDialectMarker,
} from "./non-react-jsx-dialect.js";
import type { Rule } from "./rule.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";

interface DefineRule {
  (rule: Rule): Rule;
  <RuleDefinition>(rule: RuleDefinition): RuleDefinition;
}

// Rules tagged `"test-noise"` are by-design noisy in tests / stories /
// playgrounds — design-system style preferences, deprecated-API hints,
// auto-parallelizable awaits, etc. None of these apply to files that
// don't ship to users. We wrap `create()` once here so every such rule
// auto-skips testlike files without each one re-implementing the check.
const wrapCreateForTestNoise = <
  CreateFn extends (context: { filename?: string }) => Record<string, unknown>,
>(
  create: CreateFn,
): CreateFn =>
  ((context) => {
    if (isTestlikeFilename(context.filename)) return {};
    return create(context);
  }) as CreateFn;

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
const VISITOR_NODE_NAME_PATTERN = /^[A-Z]/;
type GenericVisitors = Record<string, unknown>;

const wrapCreateForReactJsxOnly = <
  CreateFn extends (context: { filename?: string }) => GenericVisitors,
>(
  create: CreateFn,
): CreateFn =>
  ((context: Parameters<CreateFn>[0]) => {
    const innerVisitors = create(context);
    let fileIsNonReactJsx = false;
    // We need a Program visitor to seed the dialect status BEFORE any
    // JSX visitor fires. If the original rule already declared one,
    // wrap it; otherwise inject a fresh one.
    const wrappedVisitors: GenericVisitors = {};
    for (const [key, visitor] of Object.entries(innerVisitors)) {
      if (typeof visitor !== "function") {
        wrappedVisitors[key] = visitor;
        continue;
      }
      if (!VISITOR_NODE_NAME_PATTERN.test(key)) {
        // Lifecycle hooks etc. — pass through unwrapped.
        wrappedVisitors[key] = visitor;
        continue;
      }
      if (key === "Program") {
        wrappedVisitors.Program = (node: EsTreeNodeOfType<"Program">) => {
          fileIsNonReactJsx = fileImportsNonReactJsxDialect(node);
          (visitor as (n: EsTreeNodeOfType<"Program">) => void)(node);
        };
        continue;
      }
      if (key === "JSXOpeningElement") {
        wrappedVisitors.JSXOpeningElement = (node: EsTreeNodeOfType<"JSXOpeningElement">) => {
          if (!fileIsNonReactJsx && jsxAttributeIsNonReactDialectMarker(node)) {
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
        fileIsNonReactJsx = fileImportsNonReactJsxDialect(node);
      };
    }
    return wrappedVisitors;
  }) as CreateFn;

export const defineRule: DefineRule = <RuleDefinition>(rule: RuleDefinition): RuleDefinition => {
  const tags = (rule as { tags?: ReadonlyArray<string> }).tags;
  const create = (rule as { create?: unknown }).create;
  if (typeof create !== "function") return rule;
  let wrappedCreate = create as (...args: unknown[]) => unknown;
  // `migration-hint` wins over `test-noise` — deprecated API usage in
  // test code is the very surface that needs migration (`react-dom/test-utils`
  // imports, legacy lifecycle methods in test class fixtures, etc.).
  // Skip the test-noise wrapper when the rule has both tags.
  const honorsTestNoise = tags?.includes("test-noise") && !tags?.includes("migration-hint");
  if (honorsTestNoise) {
    wrappedCreate = wrapCreateForTestNoise(wrappedCreate as never) as never;
  }
  if (tags?.includes("react-jsx-only")) {
    wrappedCreate = wrapCreateForReactJsxOnly(wrappedCreate as never) as never;
  }
  if (wrappedCreate === create) return rule;
  return {
    ...rule,
    create: wrappedCreate,
  } as RuleDefinition;
};
