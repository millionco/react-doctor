//! Minimal `EnvironmentConfig`, ported from the subset of
//! `packages/react-compiler/src/HIR/Environment.ts` (`EnvironmentConfigSchema`)
//! that stage-1 lowering (`lower()` in `BuildHIR.ts`) actually consults.
//!
//! The full config has ~50 fields, almost all of which gate validation or
//! later passes (mutation/aliasing inference, reactive scopes, codegen). Those
//! are deferred. The flags kept here are the ones read during lowering or that
//! influence which `LoadGlobal`/hook bindings are produced; each defaults to the
//! same value as the corresponding `z.*.default(...)` in the TS schema so that a
//! `Default::default()` config matches the compiler's out-of-the-box behavior.

/// A compiler-injected import target, ported from `Environment.ts`'s
/// `ExternalFunctionSchema` (`{source, importSpecifierName}`). Mirrors the
/// [`crate::compile::ExternalFunction`] used for `@gating`, kept separate here so
/// the environment module has no dependency on the compile driver.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExternalFunctionSpec {
    /// The module the function is imported from (the import's `source`).
    pub source: String,
    /// The exported name imported from `source` (the import's `imported`), and the
    /// default local-name hint passed to `newUid`.
    pub import_specifier_name: String,
}

/// `InstrumentationSchema` (`Environment.ts:70-79`): the config for
/// `enableEmitInstrumentForget`. Codegen emits, at the top of each compiled
/// function body, an `if (<gates>) <fn>("<FnName>", "<filepath>");` instrumentation
/// call. The schema requires at least one of `gating`/`global_gating`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstrumentationConfig {
    /// The instrumentation function to call (e.g. `useRenderCounter`).
    pub fn_spec: ExternalFunctionSpec,
    /// An optional runtime feature-flag function (imported, e.g. `shouldInstrument`).
    pub gating: Option<ExternalFunctionSpec>,
    /// An optional global-variable gate (a bare identifier, e.g. `DEV`).
    pub global_gating: Option<String>,
}

/// Stage-1 subset of `EnvironmentConfig`.
///
/// Every field mirrors a flag in `EnvironmentConfigSchema` and keeps the TS
/// default. Fields not read during lowering are intentionally omitted rather
/// than stubbed; add them here as later stages need them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvironmentConfig {
    /// `enableOptionalDependencies` (TS default `true`). When set, optional
    /// chains such as `props?.items?.foo` infer the full path as a dependency
    /// rather than only the base; consulted while lowering optional members.
    pub enable_optional_dependencies: bool,

    /// `validateHooksUsage` (TS default `true`). Gates emitting errors for
    /// invalid hook calls encountered during lowering.
    pub validate_hooks_usage: bool,

    /// `validateRefAccessDuringRender` (TS default `true`). Gates ref-mutation
    /// checks while lowering member access in render.
    pub validate_ref_access_during_render: bool,

    /// `enableNameAnonymousFunctions` (TS default `false`). When set, lowering
    /// synthesizes names for inline anonymous functions.
    pub enable_name_anonymous_functions: bool,

    /// `customMacros` (TS default `null`). Names the compiler must not rename or
    /// separate from their arguments (e.g. `featureflag("...")`). `None` mirrors
    /// the `null` default; an empty list means "no macros".
    pub custom_macros: Option<Vec<String>>,

    /// `enableFunctionOutlining` (TS default `true`). Allows extracting
    /// anonymous functions that close over nothing into top-level helpers.
    pub enable_function_outlining: bool,

    /// `enableAssumeHooksFollowRulesOfReact` (TS default `true`). Selects the
    /// default hook effect/value-kind inference (frozen vs conditionally
    /// mutate) used when resolving an unknown hook-like global.
    pub enable_assume_hooks_follow_rules_of_react: bool,

    /// `enableJsxOutlining` (TS default `false`). Whether nested JSX may be
    /// outlined into a separate component.
    pub enable_jsx_outlining: bool,

    /// `enableTreatRefLikeIdentifiersAsRefs` (TS default `true`). When set,
    /// `inferTypes` treats a `.current` access on a ref-like-named object (e.g.
    /// `fooRef.current`) as a ref, unifying the object with `BuiltInUseRef` and
    /// the result with `BuiltInRefValue`.
    pub enable_treat_ref_like_identifiers_as_refs: bool,

    /// `enableTreatSetIdentifiersAsStateSetters` (TS default `false`). When set,
    /// `inferTypes` treats a call whose callee name starts with `set` as a
    /// `BuiltInSetState` setter.
    pub enable_treat_set_identifiers_as_state_setters: bool,

    /// `enablePreserveExistingMemoizationGuarantees` (TS default `true`). One of
    /// the three flags `dropManualMemoization` consults to decide whether to emit
    /// `StartMemoize`/`FinishMemoize` markers around rewritten manual memoization.
    pub enable_preserve_existing_memoization_guarantees: bool,

    /// `enableTransitivelyFreezeFunctionExpressions` (TS default `true`). Gates
    /// `InferMutationAliasingEffects`'s `freezeValue`: when a `FunctionExpression`
    /// value is frozen and this flag (or `enablePreserveExistingMemoizationGuarantees`)
    /// is set, the function's captured context places are *transitively* frozen
    /// too (`InferMutationAliasingEffects.ts:1466-1474`). Defaulting to `true` makes
    /// this the normal behavior; `@enableTransitivelyFreezeFunctionExpressions:false`
    /// (paired with `@enablePreserveExistingMemoizationGuarantees:false`) disables it.
    pub enable_transitively_freeze_function_expressions: bool,

    /// `validatePreserveExistingMemoizationGuarantees`. The Zod schema default is
    /// `true`, but the test harness OVERRIDES it from the first-line pragma:
    /// `validatePreserveExistingMemoizationGuarantees = firstLine.includes(
    /// '@validatePreserveExistingMemoizationGuarantees')` (`harness.ts:158-160`,
    /// mirrored in `capture-code.ts:55-57`) — i.e. `false` unless the pragma is
    /// present. Because the corpus oracle is produced under the harness, this
    /// defaults to `false` here (set `true` only by the `@…` pragma). See
    /// [`EnvironmentConfig::is_memoization_validation_enabled`].
    pub validate_preserve_existing_memoization_guarantees: bool,

    /// `validateNoSetStateInRender` (TS default `true`). See
    /// [`EnvironmentConfig::is_memoization_validation_enabled`].
    pub validate_no_set_state_in_render: bool,

    /// `enableEmitInstrumentForget` (TS default `null`). When set (the
    /// `@enableEmitInstrumentForget` pragma maps it to the
    /// `testComplexConfigDefaults` object — `Utils/TestUtils.ts`), codegen emits an
    /// `if (<gates>) <fn>("<FnName>", "<filepath>");` instrumentation call at the top
    /// of each compiled function body (`CodegenReactiveFunction.ts:247-307`).
    pub enable_emit_instrument_forget: Option<InstrumentationConfig>,

    /// `enableEmitHookGuards` (TS default `null`). When set (the
    /// `@enableEmitHookGuards` pragma maps it to the `testComplexConfigDefaults`
    /// `$dispatcherGuard` external function — `Utils/TestUtils.ts:53-56`), codegen
    /// wraps the whole compiled body in a `try { <fn>(0); … } finally { <fn>(1); }`
    /// guard and each hook *call* in a `(function () { try { <fn>(2); return
    /// <call>; } finally { <fn>(3); } })()` IIFE (`CodegenReactiveFunction.ts:150-159,
    /// 1352-1424`).
    pub enable_emit_hook_guards: Option<ExternalFunctionSpec>,

    /// `enableCustomTypeDefinitionForReanimated` (TS default `false`). When set,
    /// the environment installs a custom module type for `react-native-reanimated`
    /// (`Environment.ts:603-606` → `getReanimatedModuleType`, `Globals.ts:1055`),
    /// so imports such as `useAnimatedProps`/`useSharedValue` resolve to typed
    /// hooks (freeze args / mutable shared-value return) rather than the generic
    /// custom-hook fallback. Only activates under the
    /// `@enableCustomTypeDefinitionForReanimated` pragma.
    pub enable_custom_type_definition_for_reanimated: bool,

    /// `enableResetCacheOnSourceFileChanges` (TS default `null`; effectively
    /// `false`). When set AND the source code is known, [`codegen_function`]
    /// reserves cache slot 0 for an `HMAC-SHA256(key = source).digest('hex')` source
    /// hash and emits a fast-refresh guard that resets all cache slots to the memo
    /// sentinel when the stored hash differs (`CodegenReactiveFunction.ts:127-243`).
    /// Only activates under the `@enableResetCacheOnSourceFileChanges` pragma.
    ///
    /// [`codegen_function`]: crate::codegen::compile_module
    pub enable_reset_cache_on_source_file_changes: bool,
}

impl Default for EnvironmentConfig {
    /// Mirrors the defaults declared in `EnvironmentConfigSchema`.
    fn default() -> Self {
        EnvironmentConfig {
            enable_optional_dependencies: true,
            validate_hooks_usage: true,
            validate_ref_access_during_render: true,
            enable_name_anonymous_functions: false,
            custom_macros: None,
            enable_function_outlining: true,
            enable_assume_hooks_follow_rules_of_react: true,
            enable_jsx_outlining: false,
            enable_treat_ref_like_identifiers_as_refs: true,
            enable_treat_set_identifiers_as_state_setters: false,
            enable_preserve_existing_memoization_guarantees: true,
            enable_transitively_freeze_function_expressions: true,
            // Harness override: `false` unless `@validatePreserveExistingMemoizationGuarantees`.
            validate_preserve_existing_memoization_guarantees: false,
            validate_no_set_state_in_render: true,
            enable_emit_instrument_forget: None,
            enable_emit_hook_guards: None,
            enable_custom_type_definition_for_reanimated: false,
            enable_reset_cache_on_source_file_changes: false,
        }
    }
}

impl EnvironmentConfig {
    /// Construct a config with all stage-1 defaults (same as
    /// [`EnvironmentConfig::default`]).
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse the `@key:value` environment-config pragmas from a fixture's first
    /// line, mirroring `parseConfigPragmaEnvironmentForTest` (`Utils/TestUtils.ts`).
    ///
    /// The test harness reads only `input.substring(0, input.indexOf('\n'))`, and
    /// `splitPragma` splits on `@`, then on the first `:` into `key`/`value`. A bare
    /// `@key` or `@key:true` sets the flag `true`; `@key:false` sets it `false`;
    /// any other value is JSON-parsed. Only the subset of `EnvironmentConfigSchema`
    /// fields modeled by this struct is honored — unknown/unmodeled keys are skipped
    /// (exactly as TS skips keys not in `EnvironmentConfigSchema.shape`, except that
    /// here "modeled" is narrower than the full schema). Keeping the set narrow is
    /// deliberate: a pragma that toggles a flag whose downstream behavior the Rust
    /// port does not yet implement would not change output, so honoring it would be
    /// misleading rather than faithful.
    pub fn from_source(code: &str) -> Self {
        let first_line = code.split('\n').next().unwrap_or("");
        let mut config = EnvironmentConfig::default();
        for entry in first_line.split('@') {
            let key_val = entry.trim();
            if key_val.is_empty() {
                continue;
            }
            let (key, value) = match key_val.find(':') {
                // `splitPragma`: a bare `@key` yields the first whitespace-delimited
                // token as the key with a null value.
                None => (key_val.split(' ').next().unwrap_or(key_val), None),
                Some(idx) => (&key_val[..idx], Some(key_val[idx + 1..].trim())),
            };
            // `isSet`: a null value or `"true"` enables the boolean flag.
            let is_set = matches!(value, None | Some("true"));
            let is_false = matches!(value, Some("false"));
            // Boolean schema flags modeled by this struct.
            let bool_flag = match key {
                "enableOptionalDependencies" => Some(&mut config.enable_optional_dependencies),
                "validateHooksUsage" => Some(&mut config.validate_hooks_usage),
                "validateRefAccessDuringRender" => {
                    Some(&mut config.validate_ref_access_during_render)
                }
                "enableNameAnonymousFunctions" => Some(&mut config.enable_name_anonymous_functions),
                "enableFunctionOutlining" => Some(&mut config.enable_function_outlining),
                "enableAssumeHooksFollowRulesOfReact" => {
                    Some(&mut config.enable_assume_hooks_follow_rules_of_react)
                }
                "enableJsxOutlining" => Some(&mut config.enable_jsx_outlining),
                "enableTreatRefLikeIdentifiersAsRefs" => {
                    Some(&mut config.enable_treat_ref_like_identifiers_as_refs)
                }
                "enableTreatSetIdentifiersAsStateSetters" => {
                    Some(&mut config.enable_treat_set_identifiers_as_state_setters)
                }
                "enablePreserveExistingMemoizationGuarantees" => {
                    Some(&mut config.enable_preserve_existing_memoization_guarantees)
                }
                "enableTransitivelyFreezeFunctionExpressions" => {
                    Some(&mut config.enable_transitively_freeze_function_expressions)
                }
                "validatePreserveExistingMemoizationGuarantees" => {
                    Some(&mut config.validate_preserve_existing_memoization_guarantees)
                }
                "validateNoSetStateInRender" => Some(&mut config.validate_no_set_state_in_render),
                "enableCustomTypeDefinitionForReanimated" => {
                    Some(&mut config.enable_custom_type_definition_for_reanimated)
                }
                "enableResetCacheOnSourceFileChanges" => {
                    Some(&mut config.enable_reset_cache_on_source_file_changes)
                }
                _ => None,
            };
            if let Some(slot) = bool_flag {
                if is_set {
                    *slot = true;
                } else if is_false {
                    *slot = false;
                }
                continue;
            }
            // `customMacros`: a single dotted string `@customMacros:foo.bar` becomes
            // `['foo']` (TS keeps only the segment before the first `.`); otherwise a
            // JSON array of names. We model the simple string-and-array cases the
            // fixtures use.
            if key == "customMacros"
                && let Some(raw) = value
                && !raw.is_empty()
            {
                config.custom_macros = Some(parse_custom_macros(raw));
            }
            // `enableEmitInstrumentForget`: the schema field is a nullable object, but
            // the test harness treats a bare `@enableEmitInstrumentForget` (or
            // `:true`) as "set" and substitutes the `testComplexConfigDefaults` object
            // (`Utils/TestUtils.ts:42-52,91-92`). No corpus fixture passes an explicit
            // object value, so we honor only the set/unset forms.
            if key == "enableEmitInstrumentForget" {
                if is_set {
                    config.enable_emit_instrument_forget =
                        Some(test_complex_instrument_forget_default());
                } else if is_false {
                    config.enable_emit_instrument_forget = None;
                }
            }
            // `enableEmitHookGuards`: like instrument-forget, the schema field is a
            // nullable `ExternalFunctionSchema`, but the harness substitutes the
            // `$dispatcherGuard` complex default when the pragma is set
            // (`Utils/TestUtils.ts:53-56`).
            if key == "enableEmitHookGuards" {
                if is_set {
                    config.enable_emit_hook_guards = Some(ExternalFunctionSpec {
                        source: "react-compiler-runtime".to_string(),
                        import_specifier_name: "$dispatcherGuard".to_string(),
                    });
                } else if is_false {
                    config.enable_emit_hook_guards = None;
                }
            }
        }
        config
    }

    /// Whether `name` is on the custom-macro allowlist. `false` when no macros
    /// are configured (the `null`/`None` default).
    pub fn is_custom_macro(&self, name: &str) -> bool {
        self.custom_macros
            .as_ref()
            .is_some_and(|macros| macros.iter().any(|m| m == name))
    }

    /// `dropManualMemoization`'s `isValidationEnabled`: whether
    /// `StartMemoize`/`FinishMemoize` markers are emitted. Mirrors the TS
    /// disjunction
    /// `validatePreserveExistingMemoizationGuarantees ||
    ///  validateNoSetStateInRender ||
    ///  enablePreserveExistingMemoizationGuarantees`.
    pub fn is_memoization_validation_enabled(&self) -> bool {
        self.validate_preserve_existing_memoization_guarantees
            || self.validate_no_set_state_in_render
            || self.enable_preserve_existing_memoization_guarantees
    }
}

/// The `testComplexConfigDefaults.enableEmitInstrumentForget` object
/// (`Utils/TestUtils.ts:42-52`) the harness substitutes when the pragma is set:
/// `fn = react-compiler-runtime/useRenderCounter`, `gating =
/// react-compiler-runtime/shouldInstrument`, `globalGating = 'DEV'`.
fn test_complex_instrument_forget_default() -> InstrumentationConfig {
    InstrumentationConfig {
        fn_spec: ExternalFunctionSpec {
            source: "react-compiler-runtime".to_string(),
            import_specifier_name: "useRenderCounter".to_string(),
        },
        gating: Some(ExternalFunctionSpec {
            source: "react-compiler-runtime".to_string(),
            import_specifier_name: "shouldInstrument".to_string(),
        }),
        global_gating: Some("DEV".to_string()),
    }
}

/// Parse a `@customMacros` pragma value. A single dotted string keeps only the
/// segment before the first `.` (TS `parsedVal.split('.')[0]`); a JSON-ish array
/// `["foo","bar"]` becomes the list of names. Tolerates single quotes.
fn parse_custom_macros(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if let Some(inner) = trimmed.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        inner
            .split(',')
            .map(|s| s.trim().trim_matches(['"', '\'']).to_string())
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        let name = trimmed.trim_matches(['"', '\'']);
        vec![name.split('.').next().unwrap_or(name).to_string()]
    }
}
