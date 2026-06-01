//! Stage-1 lowering: oxc AST -> HIR (`lower()` in `BuildHIR.ts`).
//!
//! [`lower`] is the entry point ported from the TS `lower(func, env, ...)`. It
//! constructs an [`HirBuilder`], lowers the function parameters (including
//! destructuring params), lowers the body (block statement or arrow-expression
//! implicit return), appends the trailing implicit `Void` return, and builds the
//! final [`HirFunction`].
//!
//! The submodules split the work the same way the TS file groups it:
//! - [`builder`] — the `HIRBuilder` lowering engine.
//! - [`post`] — the post-lowering CFG passes run by `build()`.
//! - [`lower_statement`] — `lowerStatement` + `lowerAssignment`.
//! - [`lower_expression`] — `lowerExpression` (part 1: literals + identifiers).
//!
//! Constructs not yet handled return a structured [`LowerError`] rather than
//! panicking, so the harness records the function as `unsupported` and moves on
//! (matching the TS behavior of `recordError` for `todo`/`invariant` cases).

pub mod builder;
pub mod lower_expression;
pub mod lower_statement;
pub mod post;

use std::collections::{BTreeMap, BTreeSet};

use oxc::ast::ast::{
    ArrowFunctionExpression, BindingPattern, Expression, Function, FunctionBody, FormalParameters,
};
use oxc::semantic::{ScopeId, Semantic, SymbolId};
use oxc::span::{GetSpan, Span};

use crate::environment::Environment;
use crate::hir::model::{FunctionParam, HirFunction, ReactFunctionType};
use crate::hir::place::{Effect, IdentifierName, Place, SourceLocation};
use crate::hir::value::{
    FunctionExpressionType, InstructionKind, LoweredFunction, PrimitiveValue, SpreadPattern,
    VariableBinding,
};
use crate::hir::{InstructionValue, ReturnVariant, Terminal};

use builder::{HirBuilder, build_temporary_place, zero_id};
use lower_expression::{lower_expression_to_temporary, lower_value_to_temporary};
use lower_statement::{AssignmentKind, lower_assignment};

/// A structured lowering failure. Mirrors the TS `recordError` cases: a `todo`
/// for unsupported syntax and an `invariant` for internal inconsistencies. The
/// harness records the affected function as `unsupported` rather than emitting
/// (potentially wrong) HIR.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LowerError {
    /// An expression form not yet lowered.
    UnsupportedExpression {
        /// The expression kind (`node.type`).
        kind: String,
        /// The originating location.
        loc: SourceLocation,
    },
    /// A statement form not yet lowered.
    UnsupportedStatement {
        /// The statement kind (`node.type`).
        kind: String,
        /// The originating location.
        loc: SourceLocation,
    },
    /// An internal invariant violation (e.g. a binding could not be resolved).
    Invariant {
        /// A human-readable reason.
        reason: String,
        /// The originating location.
        loc: SourceLocation,
    },
    /// A recoverable `ErrorCategory.Todo`: a construct the compiler recognizes but
    /// declines to compile (e.g. unreachable code with hoisted function
    /// declarations). The TS `recordError`s these and bails the function, leaving
    /// the original source untouched.
    Todo {
        /// A human-readable reason (matching the TS error `reason`).
        reason: String,
        /// The originating location.
        loc: SourceLocation,
    },
}

impl std::fmt::Display for LowerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LowerError::UnsupportedExpression { kind, .. } => {
                write!(f, "unsupported expression: {kind}")
            }
            LowerError::UnsupportedStatement { kind, .. } => {
                write!(f, "unsupported statement: {kind}")
            }
            LowerError::Invariant { reason, .. } => write!(f, "invariant: {reason}"),
            LowerError::Todo { reason, .. } => write!(f, "todo: {reason}"),
        }
    }
}

impl std::error::Error for LowerError {}

/// A function-like AST node lowering can operate on (`t.Function` in the TS:
/// function declarations/expressions and arrow functions).
pub enum FunctionLike<'a, 'ast> {
    /// A `function` declaration or expression.
    Function(&'a Function<'ast>),
    /// An arrow function.
    Arrow(&'a ArrowFunctionExpression<'ast>),
}

impl<'a, 'ast> FunctionLike<'a, 'ast> {
    /// The function's formal parameter list.
    pub fn params(&self) -> &'a FormalParameters<'ast> {
        match self {
            FunctionLike::Function(f) => &f.params,
            FunctionLike::Arrow(a) => &a.params,
        }
    }

    /// The source span of the whole function-like node. Stage 7 codegen uses this
    /// to splice the regenerated function text back over the original node.
    pub fn span(&self) -> Span {
        match self {
            FunctionLike::Function(f) => f.span,
            FunctionLike::Arrow(a) => a.span,
        }
    }

    /// The function's declared name, if any.
    pub fn id_name(&self) -> Option<String> {
        match self {
            FunctionLike::Function(f) => f.id.as_ref().map(|id| id.name.as_str().to_string()),
            FunctionLike::Arrow(_) => None,
        }
    }

    fn is_generator(&self) -> bool {
        match self {
            FunctionLike::Function(f) => f.generator,
            FunctionLike::Arrow(_) => false,
        }
    }

    fn is_async(&self) -> bool {
        match self {
            FunctionLike::Function(f) => f.r#async,
            FunctionLike::Arrow(a) => a.r#async,
        }
    }

    /// The function scope id (used as the root scope for binding resolution).
    pub fn scope_id(&self) -> Option<ScopeId> {
        match self {
            FunctionLike::Function(f) => f.scope_id.get(),
            FunctionLike::Arrow(a) => a.scope_id.get(),
        }
    }
}

/// `lower(func, env, ...)`: lower a function-like node into an [`HirFunction`].
///
/// `bindings` seeds the binding map for nested-function lowering (pass an empty
/// map for the outermost function). `fn_type` is the function's React kind.
pub fn lower(
    func: &FunctionLike<'_, '_>,
    body: &FunctionBody<'_>,
    is_arrow_expression_body: bool,
    semantic: &Semantic<'_>,
    env: &mut Environment,
    bindings: BTreeMap<oxc::semantic::SymbolId, crate::hir::Identifier>,
    is_nested: bool,
) -> Result<HirFunction, LowerError> {
    let root_fn_scope = func
        .scope_id()
        .expect("function scope set by semantic analysis");
    // For a top-level function, the component scope is its own scope; nested
    // functions go through `lower_function`, which passes the inherited one.
    // The top-level call has no parent to adopt the final bindings, so we discard
    // them.
    lower_inner(
        func,
        body,
        is_arrow_expression_body,
        semantic,
        env,
        bindings,
        is_nested,
        Vec::new(),
        root_fn_scope,
        // Top-level functions have no parent, so no inherited claimed names.
        BTreeSet::new(),
    )
    .map(|lowered| lowered.func)
}

/// As [`lower`], but also returns the binding-collision renames performed across
/// the whole function tree (`(symbol, resolved_name)` pairs). Used by the
/// `outputMode: 'lint'` codegen path to replay the TS `scope.rename` side-effect
/// onto the original source (where the compiled function is never emitted, so the
/// renames are the only visible change). See [`HirBuilder::renames`].
pub fn lower_with_renames(
    func: &FunctionLike<'_, '_>,
    body: &FunctionBody<'_>,
    is_arrow_expression_body: bool,
    semantic: &Semantic<'_>,
    env: &mut Environment,
    bindings: BTreeMap<oxc::semantic::SymbolId, crate::hir::Identifier>,
    is_nested: bool,
) -> Result<(HirFunction, Vec<(oxc::semantic::SymbolId, String)>), LowerError> {
    let root_fn_scope = func
        .scope_id()
        .expect("function scope set by semantic analysis");
    lower_inner(
        func,
        body,
        is_arrow_expression_body,
        semantic,
        env,
        bindings,
        is_nested,
        Vec::new(),
        root_fn_scope,
        BTreeSet::new(),
    )
    .map(|lowered| (lowered.func, lowered.renames))
}

/// The core lowering routine. `captured_refs` are the context identifiers
/// captured by a nested function (empty for top-level); `component_scope` is the
/// outermost function's scope, used for non-local resolution and to scope the
/// pure-scope walk in nested functions.
#[allow(clippy::too_many_arguments)]
fn lower_inner(
    func: &FunctionLike<'_, '_>,
    body: &FunctionBody<'_>,
    is_arrow_expression_body: bool,
    semantic: &Semantic<'_>,
    env: &mut Environment,
    bindings: BTreeMap<oxc::semantic::SymbolId, crate::hir::Identifier>,
    is_nested: bool,
    captured_refs: Vec<(oxc::semantic::SymbolId, SourceLocation)>,
    component_scope: ScopeId,
    inherited_claimed_names: BTreeSet<String>,
) -> Result<LoweredInner, LowerError> {
    let root_fn_scope = func
        .scope_id()
        .expect("function scope set by semantic analysis");
    let func_loc = span_to_loc(func.span(), &TempLoc { semantic });

    let mut builder = HirBuilder::new(
        env,
        semantic,
        root_fn_scope,
        bindings,
        inherited_claimed_names,
    );
    builder.set_component_scope(component_scope);
    builder.set_context(captured_refs.clone());

    // --- captured context --------------------------------------------------
    // Mirror the TS `lower()`: the captured refs are resolved (interned) *before*
    // params, so their identifier ids match the order the parent allocated them.
    let mut context: Vec<Place> = Vec::new();
    for (symbol, loc) in &captured_refs {
        let name = symbol_name(semantic, *symbol);
        let identifier = builder.resolve_binding(*symbol, &name, loc.clone());
        context.push(Place {
            identifier,
            effect: Effect::Unknown,
            reactive: false,
            loc: loc.clone(),
        });
    }

    // --- parameters --------------------------------------------------------
    let mut params: Vec<FunctionParam> = Vec::new();
    let formal = func.params();
    for param in &formal.items {
        lower_param(&mut builder, param, &mut params)?;
    }
    if let Some(rest) = &formal.rest {
        // A `...rest` parameter: allocate a promoted temporary, then destructure.
        let loc = span_to_loc(rest.span, &builder);
        let mut place = build_temporary_place(&mut builder, loc.clone());
        promote_temporary(&mut place);
        params.push(FunctionParam::Spread(SpreadPattern {
            place: place.clone(),
        }));
        lower_assignment(
            &mut builder,
            loc,
            InstructionKind::Let,
            &rest.rest.argument,
            place,
            AssignmentKind::Assignment,
        )?;
    }

    // --- body --------------------------------------------------------------
    let mut directives: Vec<String> = Vec::new();
    if is_arrow_expression_body {
        // Arrow with an expression body: implicit return of the expression.
        let expr = arrow_expression_body(body).ok_or_else(|| LowerError::Invariant {
            reason: "Expected arrow expression body".to_string(),
            loc: func_loc.clone(),
        })?;
        // Reserve the fallthrough block *before* lowering the body so block ids
        // are allocated in the same order as the TS `lower()` (the fallthrough is
        // reserved first, then the body expression — which may itself reserve
        // blocks — is lowered).
        let fallthrough = builder.reserve(crate::hir::model::BlockKind::Block);
        let value = lower_expression_to_temporary(&mut builder, expr)?;
        builder.terminate_with_continuation(
            Terminal::Return {
                return_variant: ReturnVariant::Implicit,
                value,
                id: zero_id(),
                effects: None,
                loc: SourceLocation::Generated,
            },
            fallthrough,
        );
    } else {
        // The function body is a `BlockStatement`; lower it through the TDZ
        // hoisting path scoped to the function's own scope (where its body-level
        // `let`/`const`/`var`/function bindings live in oxc).
        lower_statement::lower_block_statements(&mut builder, &body.statements, root_fn_scope)?;
        directives = body
            .directives
            .iter()
            .map(|d| d.expression.value.as_str().to_string())
            .collect();
    }

    // --- trailing implicit void return ------------------------------------
    let void_value = lower_value_to_temporary(
        &mut builder,
        InstructionValue::Primitive {
            value: PrimitiveValue::Undefined,
            loc: SourceLocation::Generated,
        },
    );
    builder.terminate(
        Terminal::Return {
            return_variant: ReturnVariant::Void,
            value: void_value,
            id: zero_id(),
            effects: None,
            loc: SourceLocation::Generated,
        },
        None,
    );

    // `returns` place is the last temporary allocated, matching the TS
    // `createTemporaryPlace(env, func.node.loc)` at the very end of `lower()`.
    let returns = build_temporary_place(&mut builder, func_loc.clone());

    let id = func.id_name();
    let generator = func.is_generator();
    let async_ = func.is_async();
    let fn_type = if is_nested {
        ReactFunctionType::Other
    } else {
        builder.environment().fn_type
    };

    // Capture the names claimed by this function *before* `build()` consumes the
    // builder, so a parent can adopt them (mirroring TS's shared `#bindings` map).
    // See [`HirBuilder::adopt_claimed_names`].
    let claimed_names = builder.claimed_names().clone();
    let renames = builder.renames().to_vec();
    let (hir_body, hoisting_error) = builder.build();

    // `HIRBuilder.build()` records a recoverable Todo when the function contains
    // unreachable code with a hoisted function declaration (`Support functions
    // with unreachable code that may contain hoisted declarations`). The TS
    // `recordError` later causes the function to bail; we surface it as a
    // `LowerError` so the per-function pipeline leaves the original source
    // untouched (matching `processFn` returning null for an errored function).
    if let Some(loc) = hoisting_error {
        return Err(LowerError::Todo {
            reason: "Support functions with unreachable code that may contain hoisted declarations"
                .to_string(),
            loc,
        });
    }

    Ok(LoweredInner {
        func: HirFunction {
            loc: func_loc,
            id,
            name_hint: None,
            fn_type,
            params,
            return_type_annotation: None,
            returns,
            context,
            body: hir_body,
            generator,
            async_,
            directives,
            aliasing_effects: None,
            outlined: Vec::new(),
        },
        claimed_names,
        renames,
    })
}

/// The result of [`lower_inner`]: the lowered function plus the set of binding
/// names it claimed (so a parent can adopt a nested function's claimed names) and
/// the binding-collision renames it performed (so the lint-mode codegen can replay
/// the TS `scope.rename` side-effect onto the original source).
struct LoweredInner {
    func: HirFunction,
    claimed_names: BTreeSet<String>,
    renames: Vec<(oxc::semantic::SymbolId, String)>,
}

/// Lower a single non-rest parameter, mirroring the param loop in the TS
/// `lower()`: a bare identifier becomes a [`FunctionParam::Place`] directly; a
/// destructuring pattern allocates a promoted temporary param and emits a
/// follow-up destructure assignment.
///
/// A parameter with a default value (`function f(x = expr)`) is an
/// `AssignmentPattern` in babel, but oxc splits it into `FormalParameter::pattern`
/// (the `left`) plus `FormalParameter::initializer` (the `right`). When an
/// initializer is present we therefore reconstruct the TS `isAssignmentPattern()`
/// branch (BuildHIR.ts:130-151): allocate a promoted temporary param, then route
/// `pattern`/`initializer` through the default-extraction lowering
/// (`x = init === undefined ? expr : init`).
fn lower_param(
    builder: &mut HirBuilder<'_, '_>,
    param: &oxc::ast::ast::FormalParameter<'_>,
    params: &mut Vec<FunctionParam>,
) -> Result<(), LowerError> {
    let pattern = &param.pattern;
    if let Some(initializer) = &param.initializer {
        // Default-valued parameter: behaves exactly like babel's `AssignmentPattern`
        // param. Allocate a promoted temporary param, then lower the default.
        let loc = span_to_loc(param.span, builder);
        let mut place = build_temporary_place(builder, loc.clone());
        promote_temporary(&mut place);
        params.push(FunctionParam::Place(place.clone()));
        lower_statement::lower_default_value_assignment(
            builder,
            loc,
            InstructionKind::Let,
            pattern,
            initializer,
            place,
            AssignmentKind::Assignment,
        )?;
        return Ok(());
    }
    match pattern {
        BindingPattern::BindingIdentifier(ident) => {
            let loc = span_to_loc(ident.span, builder);
            let symbol = ident.symbol_id.get();
            let binding = builder.resolve_identifier(ident.name.as_str(), symbol, loc.clone());
            match binding {
                VariableBinding::Identifier { identifier, .. } => {
                    params.push(FunctionParam::Place(Place {
                        identifier,
                        effect: Effect::Unknown,
                        reactive: false,
                        loc,
                    }));
                    Ok(())
                }
                VariableBinding::NonLocal(_) => Err(LowerError::Invariant {
                    reason: format!("Could not find binding for param `{}`", ident.name.as_str()),
                    loc,
                }),
            }
        }
        BindingPattern::ObjectPattern(_)
        | BindingPattern::ArrayPattern(_)
        | BindingPattern::AssignmentPattern(_) => {
            let loc = span_to_loc(pattern.span(), builder);
            let mut place = build_temporary_place(builder, loc.clone());
            promote_temporary(&mut place);
            params.push(FunctionParam::Place(place.clone()));
            lower_assignment(
                builder,
                loc,
                InstructionKind::Let,
                pattern,
                place,
                AssignmentKind::Assignment,
            )?;
            Ok(())
        }
    }
}

/// `promoteTemporary`: give an unnamed temporary a `#t<declarationId>` name.
fn promote_temporary(place: &mut Place) {
    let decl = place.identifier.declaration_id.as_u32();
    place.identifier.name = Some(IdentifierName::Promoted {
        value: format!("#t{decl}"),
    });
}

/// The single expression an arrow-with-expression-body returns. In oxc the
/// parser wraps it in a one-statement `FunctionBody` containing an
/// `ExpressionStatement`.
fn arrow_expression_body<'b, 'ast>(
    body: &'b FunctionBody<'ast>,
) -> Option<&'b oxc::ast::ast::Expression<'ast>> {
    match body.statements.first() {
        Some(oxc::ast::ast::Statement::ExpressionStatement(stmt)) => Some(&stmt.expression),
        _ => None,
    }
}

/// A `span->loc` context. Both the [`HirBuilder`] and a bare-`Semantic` holder
/// satisfy it; only the span itself is used (filenames are deferred), so the
/// receiver is currently ignored. Kept as a parameter so call sites read like
/// the TS `node.loc` lookups and so a later stage can attach line/column.
pub(crate) trait LocContext {}
impl LocContext for HirBuilder<'_, '_> {}
struct TempLoc<'a, 's> {
    #[allow(dead_code)]
    semantic: &'a Semantic<'s>,
}
impl LocContext for TempLoc<'_, '_> {}

/// Convert an oxc [`Span`] (byte offsets) into a HIR [`SourceLocation::Span`].
pub(crate) fn span_to_loc<C: LocContext + ?Sized>(span: Span, _ctx: &C) -> SourceLocation {
    SourceLocation::Span {
        start: span.start,
        end: span.end,
        filename: None,
    }
}

// === nested-function lowering ==============================================

/// `lowerFunctionToValue`: lower an arrow/function expression to a
/// `FunctionExpression` instruction value (`lowerFunction` wrapped).
pub(crate) fn lower_function_to_value(
    builder: &mut HirBuilder<'_, '_>,
    expr: &Expression<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let (func, body, is_arrow_expr_body, fn_type) = match expr {
        Expression::ArrowFunctionExpression(arrow) => (
            FunctionLike::Arrow(arrow),
            &arrow.body,
            arrow.expression,
            FunctionExpressionType::ArrowFunctionExpression,
        ),
        Expression::FunctionExpression(func) => {
            let body = func.body.as_ref().ok_or_else(|| LowerError::Invariant {
                reason: "Function expression without body".to_string(),
                loc: loc.clone(),
            })?;
            (
                FunctionLike::Function(func),
                body,
                false,
                FunctionExpressionType::FunctionExpression,
            )
        }
        _ => {
            return Err(LowerError::Invariant {
                reason: "lower_function_to_value expects a function-like expression".to_string(),
                loc,
            });
        }
    };
    let lowered = lower_function(builder, &func, body, is_arrow_expr_body)?;
    let name = lowered.func.id.clone();
    Ok(InstructionValue::FunctionExpression {
        name,
        name_hint: None,
        lowered_func: Box::new(lowered),
        function_type: fn_type,
        loc,
    })
}

/// Lower a function *declaration* to a `FunctionExpression` instruction value
/// (`function_type: FunctionDeclaration`), used by the statement-level
/// declaration lowering.
pub(crate) fn lower_function_declaration_value(
    builder: &mut HirBuilder<'_, '_>,
    func: &Function<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let body = func.body.as_ref().ok_or_else(|| LowerError::Invariant {
        reason: "Function declaration without body".to_string(),
        loc: loc.clone(),
    })?;
    let lowered = lower_function(builder, &FunctionLike::Function(func), body, false)?;
    let name = lowered.func.id.clone();
    Ok(InstructionValue::FunctionExpression {
        name,
        name_hint: None,
        lowered_func: Box::new(lowered),
        function_type: FunctionExpressionType::FunctionDeclaration,
        loc,
    })
}

/// `lowerObjectMethod`: lower an object method's function expression to an
/// `ObjectMethod` instruction value.
pub(crate) fn lower_object_method(
    builder: &mut HirBuilder<'_, '_>,
    func: &Function<'_>,
    loc: SourceLocation,
) -> Result<InstructionValue, LowerError> {
    let body = func.body.as_ref().ok_or_else(|| LowerError::Invariant {
        reason: "Object method without body".to_string(),
        loc: loc.clone(),
    })?;
    let lowered = lower_function(builder, &FunctionLike::Function(func), body, false)?;
    Ok(InstructionValue::ObjectMethod {
        lowered_func: Box::new(lowered),
        loc,
    })
}

/// `lowerFunction`: gather the nested function's captured context, then lower it
/// recursively, sharing the parent's bindings + env counters.
fn lower_function(
    builder: &mut HirBuilder<'_, '_>,
    func: &FunctionLike<'_, '_>,
    body: &FunctionBody<'_>,
    is_arrow_expr_body: bool,
) -> Result<LoweredFunction, LowerError> {
    let component_scope = builder.component_scope();
    let fn_scope = func
        .scope_id()
        .expect("nested function scope set by semantic analysis");
    let gathered =
        gather_captured_context(builder.semantic(), fn_scope, component_scope, builder.bindings());

    // Merge the *parent's* captured context ahead of the newly-gathered refs,
    // mirroring the TS `new Map([...builder.context, ...capturedContext])`: the
    // map dedups on symbol, keeping the parent's first-insertion order. This is
    // why a deeply nested function inherits an outer captured ref (e.g. `props`)
    // even if it does not reference it directly.
    let mut seen: BTreeSet<SymbolId> = BTreeSet::new();
    let mut captured: Vec<(SymbolId, SourceLocation)> = Vec::new();
    for (symbol, loc) in builder.context().iter().cloned().collect::<Vec<_>>() {
        if seen.insert(symbol) {
            captured.push((symbol, loc));
        }
    }
    for (symbol, loc) in gathered {
        if seen.insert(symbol) {
            captured.push((symbol, loc));
        }
    }

    // Share the parent's interned bindings so captured references resolve to the
    // same identifier ids, and share the env counters (passed by `&mut`).
    let parent_bindings = builder.bindings().clone();
    // Thread the parent's *adopted* claimed names so a name claimed by an earlier
    // sibling lambda (carried only as an adopted name, not in `bindings`) is
    // visible to this lambda and forces the `<name>_<index>` collision rename —
    // matching TS's by-reference `#bindings` map shared across all nested fns.
    let parent_claimed = builder.claimed_names().clone();
    let lowered = lower_inner(
        func,
        body,
        is_arrow_expr_body,
        builder.semantic(),
        builder.environment_mut(),
        parent_bindings,
        /* is_nested */ true,
        captured,
        component_scope,
        parent_claimed,
    )?;
    // Adopt the names the nested function claimed. This mirrors TS sharing the
    // `#bindings` map by reference, so a name shadowed inside the lambda makes a
    // later outer declaration of the same name collide and be renamed — without
    // leaking the lambda's symbol→identifier interning into the parent.
    builder.adopt_claimed_names(lowered.claimed_names);
    // Bubble the nested function's scope-rename side-effects up to the parent so
    // the outermost builder ends up with every rename in the function tree
    // (mirroring TS's single shared Babel AST).
    builder.adopt_renames(lowered.renames);
    Ok(LoweredFunction { func: lowered.func })
}

/// `gatherCapturedContext`: the free-variable references inside the nested
/// function whose binding lives in a "pure" scope (from the function's parent up
/// to and including the component scope), in first-reference (traversal) order.
///
/// Bindings already interned by the parent (present in `parent_bindings`) are
/// the candidates: a captured reference must resolve to a binding declared
/// outside the nested function but at/above its parent and within the component.
fn gather_captured_context(
    semantic: &Semantic<'_>,
    fn_scope: ScopeId,
    component_scope: ScopeId,
    _parent_bindings: &BTreeMap<SymbolId, crate::hir::Identifier>,
) -> Vec<(SymbolId, SourceLocation)> {
    let scoping = semantic.scoping();

    // Pure scopes: the parent of the nested function up to and including the
    // component scope.
    let mut pure_scopes: BTreeSet<ScopeId> = BTreeSet::new();
    if let Some(parent) = scoping.scope_parent_id(fn_scope) {
        let mut current = Some(parent);
        while let Some(scope) = current {
            pure_scopes.insert(scope);
            if scope == component_scope {
                break;
            }
            current = scoping.scope_parent_id(scope);
        }
    }

    // Collect (symbol, first-reference span-start) for symbols whose declaration
    // scope is a pure scope and that are referenced from within the nested fn.
    let mut captured: Vec<(SymbolId, SourceLocation, u32)> = Vec::new();
    let mut seen: BTreeSet<SymbolId> = BTreeSet::new();
    for symbol in scoping.symbol_ids() {
        let symbol_scope = scoping.symbol_scope_id(symbol);
        if !pure_scopes.contains(&symbol_scope) {
            continue;
        }
        // Find the first reference (by span) that occurs inside the nested fn.
        let mut first: Option<(u32, u32)> = None;
        for &reference_id in scoping.get_resolved_reference_ids(symbol) {
            let reference = scoping.get_reference(reference_id);
            let ref_scope = reference.scope_id();
            if !scope_is_self_or_descendant(scoping, ref_scope, fn_scope) {
                continue;
            }
            let span = reference_span(semantic, reference_id);
            if let Some(span) = span {
                match first {
                    Some((start, _)) if start <= span.0 => {}
                    _ => first = Some(span),
                }
            } else if first.is_none() {
                first = Some((u32::MAX, u32::MAX));
            }
        }
        if let Some((start, end)) = first
            && seen.insert(symbol)
        {
            let loc = if start == u32::MAX {
                SourceLocation::Generated
            } else {
                SourceLocation::Span {
                    start,
                    end,
                    filename: None,
                }
            };
            captured.push((symbol, loc, start));
        }
    }
    captured.sort_by_key(|(_, _, start)| *start);
    captured
        .into_iter()
        .map(|(symbol, loc, _)| (symbol, loc))
        .collect()
}

/// Whether `scope` is `target` or a descendant (inner scope) of `target`.
fn scope_is_self_or_descendant(
    scoping: &oxc::semantic::Scoping,
    scope: ScopeId,
    target: ScopeId,
) -> bool {
    if scope == target {
        return true;
    }
    scoping.scope_ancestors(scope).any(|s| s == target)
}

/// The source span of a reference's identifier node.
fn reference_span(semantic: &Semantic<'_>, reference_id: oxc::semantic::ReferenceId) -> Option<(u32, u32)> {
    let node_id = semantic.scoping().get_reference(reference_id).node_id();
    let span = semantic.nodes().get_node(node_id).span();
    Some((span.start, span.end))
}

/// The source name of a symbol.
fn symbol_name(semantic: &Semantic<'_>, symbol: SymbolId) -> String {
    semantic.scoping().symbol_name(symbol).to_string()
}
