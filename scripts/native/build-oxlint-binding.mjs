import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromScript = createRequire(import.meta.url);
const nativeDirectory = path.join(repositoryRoot, "native", "oxlint");
const nativeRulesDirectory = path.join(nativeDirectory, "rules");
const upstream = JSON.parse(fs.readFileSync(path.join(nativeDirectory, "upstream.json"), "utf8"));
const patchPath = path.join(nativeDirectory, "react-doctor.patch");
const delegatedRules = new Map(
  (upstream.delegatedRules ?? []).map((delegatedRule) => [delegatedRule.id, delegatedRule]),
);

const argumentsList = process.argv.slice(2);
const readOption = (name) => {
  const optionIndex = argumentsList.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = argumentsList[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};

const sourcePath = readOption("--source");
const outputDirectory = path.resolve(
  readOption("--output") ?? path.join(repositoryRoot, "dist", "native-oxlint"),
);
const shouldCheckOnly = argumentsList.includes("--check-only");
const shouldCompileCheck = argumentsList.includes("--compile-check");
const shouldUseAllocator = !argumentsList.includes("--no-allocator");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxc-"));
const checkoutDirectory = path.join(temporaryDirectory, "oxc");

const run = (command, commandArguments, options = {}) =>
  execFileSync(command, commandArguments, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });

try {
  if (sourcePath) {
    run("git", ["clone", "--no-checkout", path.resolve(sourcePath), checkoutDirectory]);
  } else {
    run("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "--branch",
      upstream.tag,
      "--depth=1",
      upstream.repository,
      checkoutDirectory,
    ]);
  }

  run("git", ["checkout", "--detach", upstream.commit], { cwd: checkoutDirectory });
  const resolvedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkoutDirectory,
    encoding: "utf8",
  }).trim();
  if (resolvedCommit !== upstream.commit) {
    throw new Error(`expected upstream commit ${upstream.commit}, received ${resolvedCommit}`);
  }

  run("git", ["apply", "--check", patchPath], { cwd: checkoutDirectory });
  if (shouldCheckOnly) {
    process.stdout.write(`Patch applies to ${upstream.tag} (${upstream.commit}).\n`);
    process.exitCode = 0;
  } else {
    run("git", ["apply", patchPath], { cwd: checkoutDirectory });
    const upstreamRulesDirectory = path.join(
      checkoutDirectory,
      "crates",
      "oxc_linter",
      "src",
      "rules",
      "react_doctor_native",
    );
    fs.mkdirSync(upstreamRulesDirectory, { recursive: true });
    const buildDelegatedRuleSource = (delegatedRule) => {
      const fixCapability = delegatedRule.fix ? `\n    ${delegatedRule.fix},` : "";
      const shouldRun = delegatedRule.skipNonProduction
        ? "!is_non_production_file(ctx) && self.upstream_rule.should_run(ctx)"
        : "self.upstream_rule.should_run(ctx)";
      return `use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    rules::${delegatedRule.module}::${delegatedRule.struct} as UpstreamRule,
};
use oxc_macros::declare_oxc_lint;

#[derive(Debug, Default, Clone)]
pub struct ${delegatedRule.struct} {
    upstream_rule: UpstreamRule,
}

declare_oxc_lint!(
    /// React Doctor adapter for Oxc's native detector.
    ${delegatedRule.struct},
    react_doctor_native,
    ${delegatedRule.category},${fixCapability}
    version = "0.1.0",
    short_description = "Runs the parity-matched native Oxc detector with React Doctor diagnostics.",
);

impl Rule for ${delegatedRule.struct} {
    fn from_configuration(value: serde_json::Value) -> Result<Self, serde_json::Error> {
        UpstreamRule::from_configuration(value).map(|upstream_rule| Self { upstream_rule })
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        self.upstream_rule.run(node, ctx);
    }

    fn run_once(&self, ctx: &LintContext) {
        self.upstream_rule.run_once(ctx);
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ${shouldRun}
    }
}
`;
    };
    const nativeUtilitySources = new Map(
      [
        "r3f-state-setter-transition",
        "node-is-inside-repeated-execution",
        "is-non-production-file",
        "is-create-element-call",
        "is-react-api-call",
        "is-react-hook-call",
        "is-global-nan-value",
        "is-proven-global-namespace-reference",
        "is-proven-dom-event-target",
        "binding-pattern-has-symbol",
        "binding-pattern-initializer-for-symbol",
        "binding-property-name-for-symbol",
        "is-process-stdout-member",
        "member-expression-identifier-property-name",
        "strip-parenthesized-expression",
        "property-key-matches-name",
        "property-key-identifier-name",
        "program-references-r3f",
        "is-type-only-import",
        "global-require-module-source",
        "is-r3f-canvas",
        "r3f-jsx-event-handler-expression",
        "for-each-named-import",
        "for-each-value-import",
        "resolve-jsx-element-name",
        "resolve-jsx-element-type",
        "resolve-configured-jsx-element-type",
        "is-scoped-react-fragment-element",
        "get-string-literal-attribute-value",
        "get-direct-string-literal-attribute-value",
        "is-literal-void-expression",
        "is-no-op-statement",
        "unwrap-object-integrity-expression",
        "is-result-discarded-call",
        "is-jsx-attribute-potentially-truthy",
        "jsx-attribute-may-have-non-empty-value",
        "parse-finite-number",
        "parse-static-jsx-number",
        "get-authoritative-jsx-attribute",
        "jsx-attribute-expression",
        "jsx-module-api-reference-matches",
        "is-proven-intrinsic-jsx-element",
        "find-jsx-attribute",
        "get-static-class-name",
        "does-tailwind-variant-scope-cover",
        "tailwind-token-priority",
        "update-effective-tailwind-boolean-state",
        "tailwind-border-edges",
        "visible-tailwind-border-edges",
        "has-visible-tailwind-background",
        "has-visible-tailwind-border",
        "has-visible-tailwind-closed-border",
        "has-visible-tailwind-ring",
        "has-visible-tailwind-fill-or-edge",
        "generated-image-jsx-opening-element-ids",
        "is-generated-image-render-filename",
        "should-use-curated-port-behavior",
        "has-any-jsx-spread-attribute",
        "is-local-test-scaffold-jsx",
        "is-in-project-directory",
        "is-next-file-active",
        "is-react-native-file-target",
        "is-react-native-file-active",
        "react-doctor-framework-setting-from-json",
        "program-estree-span",
        "get-next-static-jsx-element-sibling",
        "collect-static-jsx-elements",
        "collect-static-jsx-opening-elements",
        "visit-static-jsx-children",
        "scan-static-jsx-subtree-for-part",
        "is-static-jsx-tree-root",
        "get-static-jsx-tree-opening-elements",
        "get-static-jsx-descendant-opening-elements",
        "is-js-whitespace",
        "normalize-static-jsx-whitespace",
        "is-non-source-file",
        "is-svg-tag-name",
        "is-tailwind-card-surface",
        "is-tailwind-padded-card-surface",
        "get-css-function-contents",
        "split-css-top-level",
        "motion-react-api-path-matches",
        "is-render-phase-component-or-hook",
        "find-render-phase-component-or-hook",
        "function-executes-during-render",
        "component-renders-ink",
        "children-forwarding-components",
        "ink-render-call-is-related-to-node",
        "is-inside-stable-react-initializer",
        "is-inside-stable-r3f-react-initializer",
        "resolve-imported-jsx-component-name",
        "resolve-jsx-import-api-path",
        "resolve-shadcn-component-name",
        "resolve-general-shadcn-ui-component-name",
        "resolve-react-aria-component-name",
        "jsx-element-name-trailing-segment",
        "jsx-part-is-inside-root-without-required-ancestor",
        "motion-react-component-matches",
        "get-static-direct-jsx-elements",
        "is-motion-hook-result-expression",
        "transparent-expression-root",
        "parenthesized-expression-root",
        "component-or-hook-function-name",
        "function-contains-react-render-output",
        "file-is-non-react-jsx-dialect",
        "module-api-path-matches",
        "object-has-accessible-child",
        "is-focusable-jsx-opening-element",
        "resolve-jsx-element-type-name",
        "first-js-whitespace-token",
        "direct-named-import-matches",
        "direct-zod-factory-call-name",
        "is-direct-zod-namespace-identifier",
        "is-direct-method-call-on-zod-factory",
        "is-react-router-session-method",
        "is-react-router-file-active",
        "is-react-router-framework-file-active",
        "tailwind-class-name-tokens",
        "static-tailwind-opacity",
        "tailwind-top-level-character-indices",
        "split-tailwind-opacity-modifier",
        "parse-javascript-decimal-prefix-value",
        "format-javascript-number",
        "imported-module-api-matches",
        "resolve-identifier-import",
        "identifier-initializer",
        "identifier-symbol-id-with-lexical-fallback",
        "resolve-direct-unreassigned-symbol-initializer",
        "resolve-direct-unreassigned-initializer",
        "module-jsx-tree-index",
        "is-node-conditionally-executed",
        "are-nodes-in-mutually-exclusive-branches",
        "cfg-block-can-reach",
        "is-node-reachable-within-function",
        "nodes-can-co-execute",
        "node-dominates-node",
        "static-literal-truthiness",
        "can-node-reach-later-node-within-function",
        "do-nodes-cover-every-path-after-node",
        "get-react-router-middleware-next-symbol",
        "is-react-es6-component",
        "can-content-editable-be-tabbable",
        "get-static-jsx-attribute-string-values",
        "get-implicit-role",
        "get-known-static-jsx-attribute-string-values",
        "get-static-project-dom-ids",
        "resolve-local-react-callback",
        "local-callback-nearest-function-id",
        "local-callback-nearest-function-node-index",
        "for-each-local-callback-execution-node",
        "for-each-analyzed-synchronous-execution-node",
        "animation-callback-updates-mixer",
        "is-imported-or-stable-parameter-call",
        "resolve-expression-key",
        "resolve-r3f-analyzed-callback-function-id",
        "type-import-module-api-reference-matches",
        "for-each-r3f-callback-execution-node",
        "r3f-callback-state-property-matches",
        "collect-r3f-host-ref-symbol-ids",
        "r3f-use-three-state-property-matches",
        "r3f-analyzed-use-three-state-property-matches",
        "get-inline-style-object-expression",
        "get-inline-style-object-expression-with-aliases",
        "get-static-style-property-string-value",
        "get-effective-static-style-property-string-value",
        "is-layout-transition-property",
        "is-svg-layout-transition-exempt-element",
        "is-pure-black-color",
        "parse-color-to-rgb",
        "has-color-chroma",
        "is-data-visualization-context",
        "get-static-jsx-text",
        "is-top-level-page-copy-root",
        "is-inside-navigation",
        "get-effective-tailwind-class-name-token",
        "resolve-effective-tailwind-class-name-token",
        "parse-static-tailwind-font-size",
        "parse-static-tailwind-length-px",
        "get-static-tailwind-font-size",
        "get-static-effective-font-size",
        "get-effective-nonzero-tailwind-tracking",
        "is-technical-label-text",
        "get-effective-static-style-property",
        "get-static-style-property-number-value",
        "has-capability",
        "has-capability-or-unspecified",
        "symbol-has-write-before",
        "normalize-tailwind-arbitrary-utility-value",
        "get-tailwind-visibility-effect",
        "get-tailwind-visibility-at-breakpoints",
        "get-static-string-expression",
        "get-static-route-property",
        "get-static-route-full-path",
        "get-tanstack-route-options-object",
        "walk-tanstack-server-fn-chain",
        "collect-binding-pattern-names",
        "find-side-effect",
        "find-sequential-independent-await",
        "async-local-function-is-order-independent",
        "find-guarding-try-statement",
        "is-tanstack-root-route-filename",
        "effect-execution-contains-fetch-call",
        "is-static-react-router-route-object",
        "is-react-router-route-function",
        "is-definitely-falsy-expression",
        "has-active-route-property",
        "resolve-static-jsx-attribute",
        "is-statically-hidden-from-screen-reader",
        "get-opening-element-tag-name",
        "is-inside-excluded-typography-ancestor",
        "is-inside-statically-hidden-jsx-subtree",
        "collect-axis-shorthand-values",
        "has-responsive-axis-prefix",
        "setter-is-written-only-from-event-handlers",
        "state-setter-symbol-id",
        "remotion-render-function-has-evidence",
        "run-remotion-css-time-rule",
        "get-static-motion-transition-objects",
        "get-static-motion-property-object",
        "three-constructor-api-name",
        "three-constructor-name",
        "resolve-three-constructor",
        "three-module-api-name",
        "three-module-api-path-matches",
        "resolve-stable-identifier-symbol",
        "resolve-const-identifier-root-symbol",
        "contains-react-router-export-usage",
        "is-route-request-expression",
        "statement-always-exits",
        "resolve-recursive-animation-frame-callback",
        "resolve-analyzed-recursive-animation-frame-callback-id",
        "resolve-raw-device-pixel-ratio",
        "get-static-object-property-value",
        "resolve-static-number",
        "resolve-static-number-argument",
        "resolve-static-array-like-length",
        "is-float-typed-array",
        "is-cpu-typed-array",
        "is-context-from-get-context",
        "is-webgl-context-reference",
        "resolve-r3f-fresh-value",
        "r3f-constructor-name",
        "get-closed-r3f-buffer-geometry-attributes",
        "get-r3f-surface-visibility",
        "get-active-r3f-material-texture-property-names",
        "static-member-expression-property-name",
        "r3f-analyze-owned-root-lifecycle",
        "r3f-owned-root-access-has-non-allocation-identity-write",
        "has-possible-static-property-write-before",
        "module-api-reference-matches",
        "resolve-loader-cache-provenance",
        "has-r3f-runtime-import",
        "r3f-canvas-has-public-provenance",
        "is-r3f-host-intrinsic",
        "read-static-jsx-boolean-attribute",
        "is-nullish-expression",
        "analyze-closed-r3f-canvas-lighting",
        "can-expression-override-jsx-attribute-with-aliases",
      ].map((utilityName) => [
        utilityName.replaceAll("-", "_"),
        fs.readFileSync(path.join(nativeRulesDirectory, `${utilityName}.rs`), "utf8").trim(),
      ]),
    );
    const nativeUtilityDependencies = new Map([
      ["is_imported_or_stable_parameter_call", ["has_possible_static_property_write_before"]],
      [
        "resolve_analyzed_recursive_animation_frame_callback_id",
        ["has_possible_static_property_write_before", "resolve_recursive_animation_frame_callback"],
      ],
    ]);
    const nativeRuleUtilityDependencies = new Map([
      [
        "r3f-require-global-effect-cleanup",
        ["r3f_analyzed_use_three_state_property_matches", "statement_always_exits"],
      ],
      [
        "r3f-no-mutating-pointer-event-data",
        ["has_possible_static_property_write_before", "r3f_callback_state_property_matches"],
      ],
      [
        "r3f-no-object-pointer-capture",
        ["has_possible_static_property_write_before", "r3f_callback_state_property_matches"],
      ],
      ["r3f-no-shader-configuration-mutation-in-use-frame", ["jsx_attribute_expression"]],
      ["r3f-no-state-in-pointer-move", ["r3f_state_setter_transition"]],
      ["r3f-no-state-in-use-frame", ["r3f_state_setter_transition"]],
      ["three-no-state-in-animation-loop", ["r3f_state_setter_transition"]],
      [
        "three-no-object-construction-in-render",
        ["r3f_analyzed_use_three_state_property_matches", "statement_always_exits"],
      ],
      ["r3f-no-unstable-args", ["jsx_attribute_expression"]],
      ["r3f-prefer-gpu-position-animation", ["jsx_attribute_expression"]],
      [
        "r3f-prefer-instanced-mesh",
        [
          "jsx_attribute_expression",
          "r3f_analyzed_use_three_state_property_matches",
          "statement_always_exits",
        ],
      ],
      ["r3f-no-mutate-uniform-prop-source-in-use-frame", ["jsx_attribute_expression"]],
      ["r3f-require-data-texture-update", ["jsx_attribute_expression"]],
      ["r3f-require-dynamic-buffer-usage", ["jsx_attribute_expression"]],
      ["r3f-require-instanced-buffer-update", ["jsx_attribute_expression"]],
      ["r3f-valid-texture-color-space", ["jsx_attribute_expression"]],
      [
        "r3f-require-owned-texture-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_analyzed_use_three_state_property_matches",
          "statement_always_exits",
        ],
      ],
      ["r3f-require-position-buffer-update", ["jsx_attribute_expression"]],
      [
        "r3f-require-projection-matrix-update",
        [
          "jsx_attribute_expression",
          "r3f_analyzed_use_three_state_property_matches",
          "statement_always_exits",
        ],
      ],
      [
        "r3f-require-root-unmount",
        ["r3f_owned_root_access_has_non_allocation_identity_write", "statement_always_exits"],
      ],
      [
        "three-require-controls-cleanup",
        ["r3f_analyze_owned_root_lifecycle", "statement_always_exits"],
      ],
      [
        "three-require-animation-mixer-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_analyzed_use_three_state_property_matches",
          "statement_always_exits",
        ],
      ],
      [
        "three-require-owned-geometry-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_owned_root_access_has_non_allocation_identity_write",
          "statement_always_exits",
        ],
      ],
      [
        "three-require-owned-material-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_owned_root_access_has_non_allocation_identity_write",
          "statement_always_exits",
        ],
      ],
      [
        "three-require-owned-texture-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_analyzed_use_three_state_property_matches",
          "statement_always_exits",
        ],
      ],
      [
        "three-require-gpu-computation-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_analyzed_use_three_state_property_matches",
          "r3f_owned_root_access_has_non_allocation_identity_write",
          "statement_always_exits",
        ],
      ],
      [
        "three-require-postprocessing-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_owned_root_access_has_non_allocation_identity_write",
          "statement_always_exits",
        ],
      ],
      [
        "three-require-renderer-cleanup",
        [
          "jsx_attribute_expression",
          "r3f_analyze_owned_root_lifecycle",
          "r3f_owned_root_access_has_non_allocation_identity_write",
          "statement_always_exits",
        ],
      ],
      [
        "three-require-worker-loader-cleanup",
        [
          "r3f_analyze_owned_root_lifecycle",
          "r3f_owned_root_access_has_non_allocation_identity_write",
          "statement_always_exits",
        ],
      ],
      ["three-require-uv-for-texture-map", ["get_static_string_expression"]],
      [
        "three-require-render-target-cleanup",
        ["r3f_analyze_owned_root_lifecycle", "statement_always_exits"],
      ],
      ["three-no-allocation-in-pointer-move", ["jsx_attribute_expression"]],
    ]);
    for (const nativeRuleId of upstream.nativeRules) {
      const delegatedRule = delegatedRules.get(nativeRuleId);
      const nativeRuleSource = delegatedRule
        ? buildDelegatedRuleSource(delegatedRule)
        : fs.readFileSync(path.join(nativeRulesDirectory, `${nativeRuleId}.rs`), "utf8");
      const requiredUtilitySources = [];
      const requiredUtilityNames = new Set(nativeRuleUtilityDependencies.get(nativeRuleId) ?? []);
      let sourceWithUtilities = nativeRuleSource;
      const remainingUtilitySources = new Map(nativeUtilitySources);
      while (true) {
        const requiredUtility = [...remainingUtilitySources].find(
          ([utilityName]) =>
            requiredUtilityNames.has(utilityName) ||
            sourceWithUtilities.includes(`${utilityName}(`),
        );
        if (!requiredUtility) break;
        const [utilityName, utilitySource] = requiredUtility;
        remainingUtilitySources.delete(utilityName);
        requiredUtilityNames.delete(utilityName);
        for (const dependencyName of nativeUtilityDependencies.get(utilityName) ?? []) {
          requiredUtilityNames.add(dependencyName);
        }
        requiredUtilitySources.push(utilitySource);
        sourceWithUtilities += `\n${utilitySource}`;
      }
      const emittedUtilityImports = new Set();
      const requiredUtilities = requiredUtilitySources
        .join("\n\n")
        .split("\n")
        .filter((line) => {
          if (!line.startsWith("use ") || !line.endsWith(";")) return true;
          if (emittedUtilityImports.has(line)) return false;
          emittedUtilityImports.add(line);
          return true;
        })
        .join("\n");
      fs.writeFileSync(
        path.join(upstreamRulesDirectory, `${nativeRuleId.replaceAll("-", "_")}.rs`),
        requiredUtilities ? `${requiredUtilities}\n\n${nativeRuleSource}` : nativeRuleSource,
      );
    }
    const sharedNativeUtilityIds = ["simple-glob-matches"];
    for (const sharedNativeUtilityId of sharedNativeUtilityIds) {
      fs.copyFileSync(
        path.join(nativeRulesDirectory, `${sharedNativeUtilityId}.rs`),
        path.join(upstreamRulesDirectory, `${sharedNativeUtilityId.replaceAll("-", "_")}.rs`),
      );
    }
    const rulesRegistryPath = path.join(
      checkoutDirectory,
      "crates",
      "oxc_linter",
      "src",
      "rules.rs",
    );
    const nativeModuleDeclarations = [
      ...sharedNativeUtilityIds.map(
        (sharedNativeUtilityId) => `    mod ${sharedNativeUtilityId.replaceAll("-", "_")};`,
      ),
      ...upstream.nativeRules.map(
        (nativeRuleId) => `    pub mod ${nativeRuleId.replaceAll("-", "_")};`,
      ),
    ].join("\n");
    const rulesRegistry = fs
      .readFileSync(rulesRegistryPath, "utf8")
      .replace(
        "pub(crate) mod react_doctor_native;",
        `pub(crate) mod react_doctor_native {\n${nativeModuleDeclarations}\n}`,
      );
    fs.writeFileSync(rulesRegistryPath, rulesRegistry);
    run("rustfmt", ["--version"], { cwd: checkoutDirectory });
    run("cargo", ["lintgen"], { cwd: checkoutDirectory });
    if (shouldCompileCheck) {
      run("cargo", ["check", "--locked", "-p", "oxc_linter"], { cwd: checkoutDirectory });
      process.stdout.write(`Native rules compile against ${upstream.tag} (${upstream.commit}).\n`);
      process.exitCode = 0;
    } else {
      const targetDirectory = path.resolve(
        process.env.CARGO_TARGET_DIR ?? path.join(temporaryDirectory, "target"),
      );
      const cargoArguments = ["build", "--locked", "-p", "oxlint", "--release", "--lib"];
      if (shouldUseAllocator) cargoArguments.push("--features", "allocator");
      run("cargo", cargoArguments, {
        cwd: checkoutDirectory,
        env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
      });

      const libraryName =
        process.platform === "win32"
          ? "oxlint.dll"
          : process.platform === "darwin"
            ? "liboxlint.dylib"
            : "liboxlint.so";
      const platformSuffix =
        process.platform === "linux"
          ? `${process.platform}-${process.arch}-gnu`
          : `${process.platform}-${process.arch}`;
      const bindingFileName = `oxlint-react-doctor.${platformSuffix}.node`;
      const builtLibraryPath = path.join(targetDirectory, "release", libraryName);
      const outputBindingPath = path.join(outputDirectory, bindingFileName);
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.copyFileSync(builtLibraryPath, outputBindingPath);
      const nativeBinding = requireFromScript(outputBindingPath);
      if (typeof nativeBinding.lint !== "function") {
        throw new Error(`built binding does not export lint: ${outputBindingPath}`);
      }

      const sha256 = (filePath) =>
        crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
      fs.writeFileSync(
        path.join(outputDirectory, `${bindingFileName}.json`),
        `${JSON.stringify(
          {
            upstreamRepository: upstream.repository,
            upstreamTag: upstream.tag,
            upstreamCommit: upstream.commit,
            oxlintVersion: upstream.oxlintVersion,
            rustToolchain: upstream.rustToolchain,
            nativeRules: upstream.nativeRules,
            bindingFile: bindingFileName,
            bindingSha256: sha256(outputBindingPath),
            patchSha256: sha256(patchPath),
          },
          null,
          2,
        )}\n`,
      );
      process.stdout.write(`Built ${outputBindingPath}\n`);
    }
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
