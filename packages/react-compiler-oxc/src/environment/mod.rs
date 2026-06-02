//! The minimal `Environment` carried through stage-1 lowering, ported from the
//! subset of `packages/react-compiler/src/HIR/Environment.ts` that `lower()`
//! and `HIRBuilder` actually use.
//!
//! [`Environment`] owns the four monotonic id counters (`next*Id`), the
//! [`ReactFunctionType`], the [`EnvironmentConfig`], the set of captured
//! "context" identifiers (from [`find_context_identifiers`]), and the global
//! resolver. Full type inference, the shape/global *type* registries, error
//! accumulation, and outlining bookkeeping are deferred to later stages.
//!
//! Two free helpers operate on the oxc [`Semantic`] result:
//! - [`resolve_identifier`] — the `HIRBuilder.resolveIdentifier` port: maps an
//!   identifier reference to a [`VariableBinding`] (local identifier vs one of
//!   the non-local import/global forms).
//! - [`find_context_identifiers`] — the `FindContextIdentifiers` port: the set
//!   of outer-scope bindings that a nested function captures by reassigning, or
//!   by reading while they are also reassigned.

pub mod config;
pub mod globals;
pub mod shapes;

pub use config::{EnvironmentConfig, ExternalFunctionSpec, InstrumentationConfig};
pub use globals::{GlobalResolution, is_hook_name, is_known_global, is_known_react_module};
pub use shapes::{
    BUILTIN_ARRAY_ID, BUILTIN_FUNCTION_ID, BUILTIN_JSX_ID, BUILTIN_OBJECT_ID, BUILTIN_PROPS_ID,
    BUILTIN_REF_VALUE_ID, BUILTIN_SET_STATE_ID, BUILTIN_USE_REF_ID, BUILTIN_USE_STATE_ID,
    DEFAULT_MUTATING_HOOK_ID, DEFAULT_NONMUTATING_HOOK_ID, FunctionSignature, GlobalRegistry,
    ObjectShape, ShapeRegistry, builtin_shapes, custom_hook_type, default_globals,
    get_global_declaration,
};

use std::collections::BTreeSet;

use oxc::ast::AstKind;
use oxc::ast::ast::{Expression, ImportDeclaration, ModuleExportName};
use oxc::semantic::{Reference, ScopeId, Semantic, SymbolId};
use oxc::syntax::scope::ScopeFlags;

use crate::hir::ids::{IdAllocator, IdentifierId, ScopeId as HirScopeId};
use crate::hir::model::ReactFunctionType;
use crate::hir::value::{NonLocalBinding, VariableBinding};

/// The stage-1 lowering environment: id generators + function type + config +
/// captured context identifiers + global resolution.
///
/// Mirrors the data-bearing fields of the TS `Environment`. The id counters use
/// the shared [`IdAllocator`] from `hir::ids`; each `next_*` method reads then
/// post-increments, matching `env.nextFooId++`.
#[derive(Clone, Debug)]
pub struct Environment {
    next_identifier: IdAllocator,
    next_block: IdAllocator,
    next_scope: IdAllocator,
    next_instruction: IdAllocator,
    next_declaration: IdAllocator,

    /// Whether the function being lowered is a component, hook, or other.
    pub fn_type: ReactFunctionType,
    /// The stage-1 subset of `EnvironmentConfig`.
    pub config: EnvironmentConfig,

    /// The oxc symbols captured (reassigned/referenced) by a nested function,
    /// as computed by [`find_context_identifiers`]. Mirrors
    /// `Environment.#contextIdentifiers` (keyed by Babel `Identifier` node
    /// there; by oxc [`SymbolId`] here).
    context_identifiers: BTreeSet<SymbolId>,

    /// The oxc symbols hoisted by the BlockStatement TDZ-hoisting pass in
    /// `BuildHIR` (`Environment.#hoistedIdentifiers`). `addHoistedIdentifier`
    /// adds a symbol to *both* the hoisted set and the context set, so once a
    /// binding is hoisted its later loads/stores become `LoadContext`/
    /// `StoreContext`. Mutated during lowering as declarations are hoisted.
    hoisted_identifiers: BTreeSet<SymbolId>,
}

impl Environment {
    /// Construct a fresh environment with all id counters at `0`.
    ///
    /// `context_identifiers` is the result of [`find_context_identifiers`] for
    /// the outermost function being compiled (empty for none).
    pub fn new(
        fn_type: ReactFunctionType,
        config: EnvironmentConfig,
        context_identifiers: BTreeSet<SymbolId>,
    ) -> Self {
        Environment {
            next_identifier: IdAllocator::new(),
            next_block: IdAllocator::new(),
            next_scope: IdAllocator::new(),
            next_instruction: IdAllocator::new(),
            next_declaration: IdAllocator::new(),
            fn_type,
            config,
            context_identifiers,
            hoisted_identifiers: BTreeSet::new(),
        }
    }

    /// `env.nextIdentifierId`: the next [`IdentifierId`] (post-increment).
    pub fn next_identifier_id(&mut self) -> IdentifierId {
        IdentifierId::new(self.next_identifier.alloc())
    }

    /// `env.nextBlockId`: the next [`crate::hir::BlockId`] (post-increment).
    pub fn next_block_id(&mut self) -> crate::hir::ids::BlockId {
        crate::hir::ids::BlockId::new(self.next_block.alloc())
    }

    /// The value the next [`Environment::next_block_id`] call would return,
    /// without advancing. Used to seed a post-lowering pass driver with the
    /// environment's current `nextBlockId` so freshly-created blocks continue
    /// the same id sequence.
    pub fn peek_block_id(&self) -> u32 {
        self.next_block.peek()
    }

    /// The value the next [`Environment::next_identifier_id`] call would return,
    /// without advancing (the post-lowering analog of `peek_block_id`).
    pub fn peek_identifier_id(&self) -> u32 {
        self.next_identifier.peek()
    }

    /// `env.nextScopeId`: the next [`HirScopeId`] (post-increment).
    pub fn next_scope_id(&mut self) -> HirScopeId {
        HirScopeId::new(self.next_scope.alloc())
    }

    /// The next [`crate::hir::InstructionId`] (post-increment). Distinct counter
    /// from the TS, which numbers instructions in a later `markInstructionIds`
    /// pass; exposed here so lowering can allocate sequencing ids if needed.
    pub fn next_instruction_id(&mut self) -> crate::hir::ids::InstructionId {
        crate::hir::ids::InstructionId::new(self.next_instruction.alloc())
    }

    /// The next [`crate::hir::DeclarationId`] (post-increment). In the TS, a
    /// declaration id is derived from the identifier id (`makeDeclarationId(id)`);
    /// this independent counter is available for cases that need a fresh one.
    pub fn next_declaration_id(&mut self) -> crate::hir::ids::DeclarationId {
        crate::hir::ids::DeclarationId::new(self.next_declaration.alloc())
    }

    /// `Environment.isContextIdentifier`: whether `symbol` is a captured context
    /// identifier for this function (or one hoisted by the TDZ pass —
    /// `addHoistedIdentifier` adds to both sets).
    pub fn is_context_identifier(&self, symbol: SymbolId) -> bool {
        self.context_identifiers.contains(&symbol) || self.hoisted_identifiers.contains(&symbol)
    }

    /// The full set of captured context identifiers.
    pub fn context_identifiers(&self) -> &BTreeSet<SymbolId> {
        &self.context_identifiers
    }

    /// `Environment.isHoistedIdentifier`: whether `symbol` was hoisted by the
    /// TDZ-hoisting pass (so the pass does not hoist it twice).
    pub fn is_hoisted_identifier(&self, symbol: SymbolId) -> bool {
        self.hoisted_identifiers.contains(&symbol)
    }

    /// `Environment.addHoistedIdentifier`: record `symbol` as hoisted (adds it to
    /// both the hoisted and context sets, mirroring the TS where the hoisted set
    /// is a subset of the context set).
    pub fn add_hoisted_identifier(&mut self, symbol: SymbolId) {
        self.hoisted_identifiers.insert(symbol);
    }

    /// The stage-1 surface of `Environment.getGlobalDeclaration`: given the
    /// [`NonLocalBinding`] produced by [`resolve_identifier`], return the
    /// binding to attach to `LoadGlobal`. Type shapes are deferred, so this is
    /// the identity transform; the helper exists so call sites read like the TS
    /// pipeline and so later stages can hang type resolution off it.
    pub fn resolve_global(&self, binding: NonLocalBinding) -> GlobalResolution {
        binding
    }
}

/// `HIRBuilder.resolveIdentifier`: map an identifier reference to a
/// [`VariableBinding`].
///
/// Resolution rules, mirroring the TS:
/// - No resolved symbol (unresolved reference) -> [`NonLocalBinding::Global`].
/// - Symbol declared at module scope (the root function's parent scope) -> one
///   of the import forms ([`NonLocalBinding::ImportDefault`] /
///   [`NonLocalBinding::ImportNamespace`] / [`NonLocalBinding::ImportSpecifier`])
///   when the declaration is an import specifier, else
///   [`NonLocalBinding::ModuleLocal`].
/// - Otherwise a local [`VariableBinding::Identifier`].
///
/// `root_fn_scope` is the scope of the outermost function being compiled; its
/// parent is "module scope" for the purpose of detecting non-local bindings
/// (the TS uses `env.parentFunction.scope.parent`). When the reference resolves
/// to a local symbol, the returned `identifier` is *not* allocated here — the
/// caller (`HIRBuilder.resolveBinding`) owns the binding map and id allocation;
/// instead the symbol's source name and a placeholder identifier id are carried
/// so the caller can intern it. The `binding_kind` is the oxc symbol-flag spelled
/// to match Babel's `BindingKind` strings used by `PrintHIR`.
pub fn resolve_identifier(
    semantic: &Semantic<'_>,
    root_fn_scope: ScopeId,
    name: &str,
    symbol: Option<SymbolId>,
) -> ResolvedReference {
    let scoping = semantic.scoping();

    let Some(symbol) = symbol else {
        // Unresolved reference: a global.
        return ResolvedReference::NonLocal(NonLocalBinding::Global {
            name: name.to_string(),
        });
    };

    // An `enum`-declared binding is never lowered as a local by `BuildHIR` (the
    // `EnumDeclaration`/`TSEnumDeclaration` case only emits an `UnsupportedNode`
    // and never registers the enum name in its `#bindings` map). A reference to
    // the enum therefore resolves to a `LoadGlobal`, exactly as the TS oracle
    // does (`LoadGlobal(global) Bool`). Without this, oxc's scope analysis would
    // bind `Bool` as an inner block-scoped local with no lowered store/declare,
    // leaving it with no node in `PruneNonEscapingScopes`'s identifier graph.
    {
        use oxc::syntax::symbol::SymbolFlags;
        if scoping
            .symbol_flags(symbol)
            .intersects(SymbolFlags::Enum)
        {
            return ResolvedReference::NonLocal(NonLocalBinding::Global {
                name: name.to_string(),
            });
        }
    }

    // "Module scope" = the parent of the outermost compiled function's scope.
    let module_scope = scoping.scope_parent_id(root_fn_scope);
    let symbol_scope = scoping.symbol_scope_id(symbol);

    let is_module_binding = module_scope == Some(symbol_scope);
    if is_module_binding {
        let decl = scoping.symbol_declaration(symbol);
        let kind = semantic.nodes().kind(decl);
        if let Some(binding) = non_local_from_declaration(semantic, name, decl, kind) {
            return ResolvedReference::NonLocal(binding);
        }
        return ResolvedReference::NonLocal(NonLocalBinding::ModuleLocal {
            name: name.to_string(),
        });
    }

    ResolvedReference::Local {
        symbol,
        name: name.to_string(),
        binding_kind: binding_kind_for(semantic, symbol),
    }
}

/// The outcome of [`resolve_identifier`]: a non-local binding (ready to attach
/// to `LoadGlobal`) or a local symbol the caller must intern into its binding
/// map and assign an [`IdentifierId`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolvedReference {
    /// A binding declared inside the function being compiled.
    Local {
        /// The oxc symbol the reference resolves to.
        symbol: SymbolId,
        /// The source name of the symbol.
        name: String,
        /// The Babel-style `BindingKind` (`'let'`/`'const'`/`'var'`/`'param'`/
        /// `'module'`/`'hoisted'`) used by `PrintHIR`.
        binding_kind: String,
    },
    /// A binding declared outside the function (import/module-local/global).
    NonLocal(NonLocalBinding),
}

impl ResolvedReference {
    /// Convert to the model's [`VariableBinding`]. For [`ResolvedReference::Local`]
    /// the caller supplies the interned [`crate::hir::Identifier`] (which it
    /// allocated/looked up in its binding map).
    pub fn into_variable_binding(
        self,
        identifier: impl FnOnce(SymbolId) -> crate::hir::Identifier,
    ) -> VariableBinding {
        match self {
            ResolvedReference::Local {
                symbol,
                binding_kind,
                ..
            } => VariableBinding::Identifier {
                identifier: identifier(symbol),
                binding_kind,
            },
            ResolvedReference::NonLocal(binding) => VariableBinding::NonLocal(binding),
        }
    }
}

/// Build the import-form [`NonLocalBinding`] for a module-scope symbol whose
/// declaration node is `kind`, or `None` if the declaration is not an import
/// specifier (in which case the caller falls back to `ModuleLocal`).
fn non_local_from_declaration(
    semantic: &Semantic<'_>,
    name: &str,
    decl: oxc::semantic::NodeId,
    kind: AstKind<'_>,
) -> Option<NonLocalBinding> {
    match kind {
        AstKind::ImportSpecifier(spec) => {
            let module = import_source(semantic, decl)?;
            let imported = match &spec.imported {
                ModuleExportName::IdentifierName(id) => id.name.as_str().to_string(),
                ModuleExportName::IdentifierReference(id) => id.name.as_str().to_string(),
                ModuleExportName::StringLiteral(s) => s.value.as_str().to_string(),
            };
            Some(NonLocalBinding::ImportSpecifier {
                name: name.to_string(),
                module,
                imported,
            })
        }
        AstKind::ImportDefaultSpecifier(_) => {
            let module = import_source(semantic, decl)?;
            Some(NonLocalBinding::ImportDefault {
                name: name.to_string(),
                module,
            })
        }
        AstKind::ImportNamespaceSpecifier(_) => {
            let module = import_source(semantic, decl)?;
            Some(NonLocalBinding::ImportNamespace {
                name: name.to_string(),
                module,
            })
        }
        _ => None,
    }
}

/// Walk up from an import specifier node to its enclosing [`ImportDeclaration`]
/// and read the module source string.
fn import_source(semantic: &Semantic<'_>, decl: oxc::semantic::NodeId) -> Option<String> {
    for kind in semantic.nodes().ancestor_kinds(decl) {
        if let AstKind::ImportDeclaration(import) = kind {
            return Some(import_decl_source(import));
        }
    }
    None
}

fn import_decl_source(import: &ImportDeclaration<'_>) -> String {
    import.source.value.as_str().to_string()
}

/// The Babel-style `BindingKind` string for an oxc symbol, derived from its
/// `SymbolFlags`. Stage 1 only needs the spellings `PrintHIR` may surface.
fn binding_kind_for(semantic: &Semantic<'_>, symbol: SymbolId) -> String {
    use oxc::syntax::symbol::SymbolFlags;
    let flags = semantic.scoping().symbol_flags(symbol);
    if flags.contains(SymbolFlags::FunctionScopedVariable) {
        // `var` and function parameters are function-scoped.
        "var".to_string()
    } else if flags.contains(SymbolFlags::Function) {
        "hoisted".to_string()
    } else if flags.contains(SymbolFlags::ConstVariable) {
        "const".to_string()
    } else {
        // `BlockScopedVariable` (`let`) and anything else default to `let`.
        "let".to_string()
    }
}

/// `findContextIdentifiers`: the set of bindings (oxc [`SymbolId`]s) that a
/// function nested inside `root_fn_scope` captures from an outer scope by
/// reassigning, or by reading while they are also reassigned somewhere.
///
/// The TS walks the Babel AST tracking, per binding, three booleans:
/// `reassigned`, `reassignedByInnerFn`, `referencedByInnerFn`, then keeps the
/// binding if `reassignedByInnerFn || (reassigned && referencedByInnerFn)`.
///
/// We compute the same predicate from oxc's resolved references. For each symbol
/// declared at or above `root_fn_scope`, we inspect its references:
/// - a write marks `reassigned`;
/// - a reference that occurs inside a function scope *nested below the symbol's
///   own enclosing function scope* is "by an inner fn" — matching the TS check
///   that the binding resolves above the inner lambda's parent scope. A write
///   there sets `reassignedByInnerFn`; any reference there sets
///   `referencedByInnerFn`.
pub fn find_context_identifiers(
    semantic: &Semantic<'_>,
    root_fn_scope: ScopeId,
) -> BTreeSet<SymbolId> {
    let scoping = semantic.scoping();
    let mut result = BTreeSet::new();

    for symbol in scoping.symbol_ids() {
        let symbol_scope = scoping.symbol_scope_id(symbol);
        // Consider every binding `findContextIdentifiers` would see when
        // traversing the compiled function: bindings declared in the root
        // function's scope, in any *nested* (descendant) block/function scope, or
        // in an *ancestor* (outer, captured) scope. The TS pass keys off the
        // identifiers it encounters while traversing the function body, so a
        // block-scoped local reassigned by an inner lambda (`{ let x = …;
        // const fn = () => { x = … }; }`) must be in scope here. The earlier
        // self-or-ancestor-only filter wrongly dropped those nested-block locals,
        // so they were lowered as plain `StoreLocal` instead of `StoreContext`
        // and the inner function captured nothing — `OutlineFunctions` then
        // outlined it to an empty helper, discarding the reassignment
        // (`lambda-reassign-shadowed-primitive`).
        if !scope_is_self_or_ancestor(scoping, symbol_scope, root_fn_scope)
            && !scope_is_self_or_ancestor(scoping, root_fn_scope, symbol_scope)
        {
            continue;
        }
        let symbol_fn_scope = enclosing_function_scope(scoping, symbol_scope);

        let mut reassigned = false;
        let mut reassigned_by_inner_fn = false;
        let mut referenced_by_inner_fn = false;

        for &reference_id in scoping.get_resolved_reference_ids(symbol) {
            let reference: &Reference = scoping.get_reference(reference_id);
            let is_write = reference.is_write();
            if is_write {
                reassigned = true;
            }
            let ref_fn_scope = enclosing_function_scope(scoping, reference.scope_id());
            let by_inner_fn = is_strict_descendant_function(scoping, ref_fn_scope, symbol_fn_scope);
            if by_inner_fn {
                referenced_by_inner_fn = true;
                if is_write {
                    reassigned_by_inner_fn = true;
                }
            }
        }

        if reassigned_by_inner_fn || (reassigned && referenced_by_inner_fn) {
            result.insert(symbol);
        }
    }

    result
}

/// Whether `scope` is `target` or an ancestor (outer scope) of `target`.
fn scope_is_self_or_ancestor(
    scoping: &oxc::semantic::Scoping,
    scope: ScopeId,
    target: ScopeId,
) -> bool {
    if scope == target {
        return true;
    }
    scoping.scope_ancestors(target).any(|s| s == scope)
}

/// The nearest enclosing function/arrow scope of `scope` (or `scope` itself if
/// it is one). Falls back to the root scope when no function scope is found.
fn enclosing_function_scope(scoping: &oxc::semantic::Scoping, scope: ScopeId) -> ScopeId {
    let is_fn = |s: ScopeId| {
        let flags = scoping.scope_flags(s);
        flags.contains(ScopeFlags::Function) || flags.contains(ScopeFlags::Arrow)
    };
    if is_fn(scope) {
        return scope;
    }
    // `scope_ancestors` yields `scope` first, then its parents.
    scoping
        .scope_ancestors(scope)
        .find(|&s| is_fn(s))
        .unwrap_or(scope)
}

/// Whether `inner_fn` is a function scope strictly nested below `outer_fn` —
/// i.e. the reference's function is an inner lambda relative to where the symbol
/// is declared, the oxc analog of the TS `currentFn.scope.parent.getBinding`
/// capture check.
fn is_strict_descendant_function(
    scoping: &oxc::semantic::Scoping,
    inner_fn: ScopeId,
    outer_fn: ScopeId,
) -> bool {
    if inner_fn == outer_fn {
        return false;
    }
    scoping.scope_ancestors(inner_fn).any(|s| s == outer_fn)
}

/// Whether `expr` is a function-like expression (used by lowering to decide
/// `enableNameAnonymousFunctions` naming); kept here so the env module owns the
/// small predicates the config gates. Mirrors the call sites in `lower()` that
/// special-case arrow/function expressions.
pub fn is_function_like_expression(expr: &Expression<'_>) -> bool {
    matches!(
        expr,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc::allocator::Allocator;
    use oxc::ast::ast::Statement;
    use oxc::parser::Parser;
    use oxc::semantic::SemanticBuilder;
    use oxc::span::SourceType;

    fn parse<'a>(allocator: &'a Allocator, src: &'a str) -> oxc::ast::ast::Program<'a> {
        Parser::new(allocator, src, SourceType::tsx())
            .parse()
            .program
    }

    /// The scope id of the first top-level function declaration in `program`.
    fn first_fn_scope(semantic: &Semantic<'_>) -> ScopeId {
        let program = semantic.nodes().program();
        for stmt in &program.body {
            if let Statement::FunctionDeclaration(func) = stmt {
                return func.scope_id.get().expect("function scope set by semantic");
            }
        }
        panic!("no top-level function declaration");
    }

    #[test]
    fn env_id_counters_post_increment() {
        let mut env = Environment::new(
            ReactFunctionType::Component,
            EnvironmentConfig::default(),
            BTreeSet::new(),
        );
        assert_eq!(env.next_identifier_id(), IdentifierId::new(0));
        assert_eq!(env.next_identifier_id(), IdentifierId::new(1));
        assert_eq!(env.next_block_id(), crate::hir::ids::BlockId::new(0));
        assert_eq!(env.next_block_id(), crate::hir::ids::BlockId::new(1));
        assert_eq!(env.next_scope_id(), HirScopeId::new(0));
        assert_eq!(
            env.next_instruction_id(),
            crate::hir::ids::InstructionId::new(0)
        );
        assert_eq!(
            env.next_declaration_id(),
            crate::hir::ids::DeclarationId::new(0)
        );
    }

    #[test]
    fn config_defaults_match_ts_schema() {
        let c = EnvironmentConfig::default();
        assert!(c.enable_optional_dependencies);
        assert!(c.validate_hooks_usage);
        assert!(c.validate_ref_access_during_render);
        assert!(!c.enable_name_anonymous_functions);
        assert!(c.custom_macros.is_none());
        assert!(c.enable_function_outlining);
        assert!(c.enable_assume_hooks_follow_rules_of_react);
        assert!(!c.enable_jsx_outlining);
        assert!(!c.is_custom_macro("featureflag"));
    }

    #[test]
    fn config_custom_macro_membership() {
        let c = EnvironmentConfig {
            custom_macros: Some(vec!["featureflag".to_string()]),
            ..EnvironmentConfig::default()
        };
        assert!(c.is_custom_macro("featureflag"));
        assert!(!c.is_custom_macro("other"));
    }

    #[test]
    fn config_emit_instrument_forget_pragma_parsing() {
        // A bare `@enableEmitInstrumentForget` (or `:true`) substitutes the harness
        // `testComplexConfigDefaults` object (`Utils/TestUtils.ts:42-52`).
        let c = EnvironmentConfig::from_source(
            "// @enableEmitInstrumentForget @compilationMode:\"annotation\"\n",
        );
        let cfg = c
            .enable_emit_instrument_forget
            .as_ref()
            .expect("instrument-forget set");
        assert_eq!(cfg.fn_spec.import_specifier_name, "useRenderCounter");
        assert_eq!(cfg.fn_spec.source, "react-compiler-runtime");
        assert_eq!(
            cfg.gating.as_ref().map(|g| g.import_specifier_name.as_str()),
            Some("shouldInstrument")
        );
        assert_eq!(cfg.global_gating.as_deref(), Some("DEV"));
        // Off by default (the TS `null`).
        let c = EnvironmentConfig::from_source("function f() {}\n");
        assert!(c.enable_emit_instrument_forget.is_none());
        // `:false` explicitly disables it.
        let c = EnvironmentConfig::from_source("// @enableEmitInstrumentForget:false\n");
        assert!(c.enable_emit_instrument_forget.is_none());
    }

    #[test]
    fn config_emit_hook_guards_pragma_parsing() {
        // A bare `@enableEmitHookGuards` substitutes the `$dispatcherGuard` external
        // function (`Utils/TestUtils.ts:53-56`).
        let c = EnvironmentConfig::from_source("// @enableEmitHookGuards\n");
        let cfg = c.enable_emit_hook_guards.as_ref().expect("hook-guards set");
        assert_eq!(cfg.import_specifier_name, "$dispatcherGuard");
        assert_eq!(cfg.source, "react-compiler-runtime");
        // Off by default.
        let c = EnvironmentConfig::from_source("function f() {}\n");
        assert!(c.enable_emit_hook_guards.is_none());
    }

    #[test]
    fn config_custom_macros_pragma_parsing() {
        // `parseConfigPragmaForTests`: a quoted dotted string keeps only the
        // segment before the first `.` (`parsedVal.split('.')[0]`). The `idx`
        // method/wildcard fixtures use `@customMacros:"idx.a"` / `"idx.*.b"`.
        let c = EnvironmentConfig::from_source("// @customMacros:\"idx\"\n");
        assert_eq!(c.custom_macros.as_deref(), Some(&["idx".to_string()][..]));
        let c = EnvironmentConfig::from_source("// @customMacros:\"idx.a\"\n");
        assert_eq!(c.custom_macros.as_deref(), Some(&["idx".to_string()][..]));
        let c = EnvironmentConfig::from_source("// @customMacros:\"idx.*.b\"\n");
        assert_eq!(c.custom_macros.as_deref(), Some(&["idx".to_string()][..]));
        // The `cx` meta-isms fixtures use `@customMacros:"cx"`.
        let c = EnvironmentConfig::from_source(
            "// @compilationMode:\"infer\" @customMacros:\"cx\"\n",
        );
        assert_eq!(c.custom_macros.as_deref(), Some(&["cx".to_string()][..]));
        // JSON-array form (`@customMacros:["cx","idx"]`) keeps every name.
        let c = EnvironmentConfig::from_source("// @customMacros:[\"cx\",\"idx\"]\n");
        assert_eq!(
            c.custom_macros.as_deref(),
            Some(&["cx".to_string(), "idx".to_string()][..])
        );
        // No pragma => `None` (the TS `null` default).
        let c = EnvironmentConfig::from_source("function f() {}\n");
        assert!(c.custom_macros.is_none());
    }

    #[test]
    fn is_hook_name_matches_ts_regex() {
        assert!(is_hook_name("useState"));
        assert!(is_hook_name("use0"));
        assert!(is_hook_name("useX"));
        assert!(!is_hook_name("use"));
        assert!(!is_hook_name("user")); // lowercase letter after `use`
        assert!(!is_hook_name("usestate"));
        assert!(!is_hook_name("State"));
    }

    #[test]
    fn known_react_module_is_case_insensitive() {
        assert!(is_known_react_module("react"));
        assert!(is_known_react_module("React"));
        assert!(is_known_react_module("react-dom"));
        assert!(!is_known_react_module("preact"));
    }

    #[test]
    fn known_global_includes_registry_and_hooks() {
        assert!(is_known_global("Object"));
        assert!(is_known_global("React"));
        assert!(is_known_global("useState"));
        assert!(is_known_global("useCustomThing")); // hook-like
        assert!(!is_known_global("totallyUnknown"));
    }

    #[test]
    fn resolve_unresolved_reference_is_global() {
        let allocator = Allocator::default();
        let src = "function Component() { return Foo; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let root = first_fn_scope(&semantic);
        let resolved = resolve_identifier(&semantic, root, "Foo", None);
        assert_eq!(
            resolved,
            ResolvedReference::NonLocal(NonLocalBinding::Global {
                name: "Foo".to_string()
            })
        );
    }

    #[test]
    fn resolve_import_specifier_binding() {
        let allocator = Allocator::default();
        let src = "import {useState} from 'react';\nfunction Component() { return useState; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let scoping = semantic.scoping();
        let root = first_fn_scope(&semantic);
        let symbol = scoping.get_root_binding("useState".into());
        let resolved = resolve_identifier(&semantic, root, "useState", symbol);
        assert_eq!(
            resolved,
            ResolvedReference::NonLocal(NonLocalBinding::ImportSpecifier {
                name: "useState".to_string(),
                module: "react".to_string(),
                imported: "useState".to_string(),
            })
        );
    }

    #[test]
    fn resolve_import_specifier_aliased() {
        let allocator = Allocator::default();
        let src = "import {useState as useS} from 'react';\nfunction Component() { return useS; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let scoping = semantic.scoping();
        let root = first_fn_scope(&semantic);
        let symbol = scoping.get_root_binding("useS".into());
        let resolved = resolve_identifier(&semantic, root, "useS", symbol);
        assert_eq!(
            resolved,
            ResolvedReference::NonLocal(NonLocalBinding::ImportSpecifier {
                name: "useS".to_string(),
                module: "react".to_string(),
                imported: "useState".to_string(),
            })
        );
    }

    #[test]
    fn resolve_import_default_binding() {
        let allocator = Allocator::default();
        let src = "import React from 'react';\nfunction Component() { return React; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let scoping = semantic.scoping();
        let root = first_fn_scope(&semantic);
        let symbol = scoping.get_root_binding("React".into());
        let resolved = resolve_identifier(&semantic, root, "React", symbol);
        assert_eq!(
            resolved,
            ResolvedReference::NonLocal(NonLocalBinding::ImportDefault {
                name: "React".to_string(),
                module: "react".to_string(),
            })
        );
    }

    #[test]
    fn resolve_import_namespace_binding() {
        let allocator = Allocator::default();
        let src = "import * as React from 'react';\nfunction Component() { return React; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let scoping = semantic.scoping();
        let root = first_fn_scope(&semantic);
        let symbol = scoping.get_root_binding("React".into());
        let resolved = resolve_identifier(&semantic, root, "React", symbol);
        assert_eq!(
            resolved,
            ResolvedReference::NonLocal(NonLocalBinding::ImportNamespace {
                name: "React".to_string(),
                module: "react".to_string(),
            })
        );
    }

    #[test]
    fn resolve_module_local_binding() {
        let allocator = Allocator::default();
        let src = "const x = 1;\nfunction Component() { return x; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let scoping = semantic.scoping();
        let root = first_fn_scope(&semantic);
        let symbol = scoping.get_root_binding("x".into());
        let resolved = resolve_identifier(&semantic, root, "x", symbol);
        assert_eq!(
            resolved,
            ResolvedReference::NonLocal(NonLocalBinding::ModuleLocal {
                name: "x".to_string()
            })
        );
    }

    #[test]
    fn resolve_local_binding() {
        let allocator = Allocator::default();
        let src = "function Component() { const x = 1; return x; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let scoping = semantic.scoping();
        let root = first_fn_scope(&semantic);
        let symbol = scoping.find_binding(root, "x".into()).expect("local x");
        let resolved = resolve_identifier(&semantic, root, "x", Some(symbol));
        match resolved {
            ResolvedReference::Local {
                name, binding_kind, ..
            } => {
                assert_eq!(name, "x");
                assert_eq!(binding_kind, "const");
            }
            other => panic!("expected local, got {other:?}"),
        }
    }

    #[test]
    fn context_identifier_reassigned_by_inner_fn() {
        // `count` is declared in the component and reassigned by the nested
        // arrow, so it is a context identifier.
        let allocator = Allocator::default();
        let src = "function Component() { let count = 0; const inc = () => { count = count + 1; }; return inc; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let root = first_fn_scope(&semantic);
        let ctx = find_context_identifiers(&semantic, root);
        let scoping = semantic.scoping();
        let count = scoping
            .find_binding(root, "count".into())
            .expect("count binding");
        assert!(ctx.contains(&count), "count should be captured: {ctx:?}");
    }

    #[test]
    fn non_context_identifier_only_read_by_inner_fn() {
        // `value` is only read (never reassigned), so even though an inner fn
        // reads it, it is NOT a context identifier (matches TS predicate).
        let allocator = Allocator::default();
        let src =
            "function Component() { const value = 0; const read = () => value; return read; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let root = first_fn_scope(&semantic);
        let ctx = find_context_identifiers(&semantic, root);
        let scoping = semantic.scoping();
        let value = scoping
            .find_binding(root, "value".into())
            .expect("value binding");
        assert!(
            !ctx.contains(&value),
            "read-only capture should not be a context id: {ctx:?}"
        );
    }

    #[test]
    fn non_context_identifier_reassigned_in_same_fn() {
        // `n` is reassigned but only within the same function (no inner fn),
        // so it is not a context identifier.
        let allocator = Allocator::default();
        let src = "function Component() { let n = 0; n = n + 1; return n; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let root = first_fn_scope(&semantic);
        let ctx = find_context_identifiers(&semantic, root);
        assert!(ctx.is_empty(), "no inner-fn capture: {ctx:?}");
    }

    #[test]
    fn context_identifier_reassigned_and_read_by_inner_fn() {
        // `acc` is reassigned in the outer fn AND read by an inner fn ->
        // captured via the `reassigned && referencedByInnerFn` branch.
        let allocator = Allocator::default();
        let src = "function Component() { let acc = 0; acc = acc + 1; const get = () => acc; return get; }";
        let program = parse(&allocator, src);
        let semantic = SemanticBuilder::new().build(&program).semantic;
        let root = first_fn_scope(&semantic);
        let ctx = find_context_identifiers(&semantic, root);
        let scoping = semantic.scoping();
        let acc = scoping
            .find_binding(root, "acc".into())
            .expect("acc binding");
        assert!(ctx.contains(&acc), "acc should be captured: {ctx:?}");
    }

    #[test]
    fn resolve_global_is_identity_for_stage1() {
        let env = Environment::new(
            ReactFunctionType::Hook,
            EnvironmentConfig::default(),
            BTreeSet::new(),
        );
        let binding = NonLocalBinding::Global {
            name: "Foo".to_string(),
        };
        assert_eq!(env.resolve_global(binding.clone()), binding);
    }
}
