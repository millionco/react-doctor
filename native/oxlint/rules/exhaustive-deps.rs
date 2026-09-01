use std::{borrow::Cow, hash::Hash};

use itertools::Itertools;
use lazy_regex::Regex;
use rustc_hash::FxHashSet;

use oxc_ast::{
    AstKind, AstType,
    ast::{
        Argument, ArrayExpressionElement, ArrowFunctionBody, ArrowFunctionExpression,
        AssignmentTarget, BindingPattern, CallExpression, ChainElement, ComputedMemberExpression,
        Expression, FormalParameters, Function, FunctionBody, IdentifierReference, PropertyKey,
        StaticMemberExpression, TSSignature, TSType, TSTypeName, VariableDeclarationKind,
    },
    match_expression,
};
use oxc_ast_visit::{
    VisitJs,
    walk_js::{walk_arrow_function_body, walk_function_body},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, ReferenceId, ScopeId, Semantic, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_str::Str;

use crate::{
    AstNode,
    ast_util::variable_declaration_kind,
    ast_util::{
        get_declaration_from_reference_id, get_declaration_of_variable, get_enclosing_function,
    },
    context::{ContextHost, LintContext},
    rule::Rule,
};

fn missing_callback_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` crashes without a function as its first argument."
    ))
    .with_label(span)
}

fn dependency_array_required_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` re-runs on every render with no dependency array."
    ))
    .with_label(span)
}

fn unknown_dependencies_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through."
    ))
    .with_label(span)
}

fn async_effect_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` was given an async function, so its cleanup breaks."
    ))
    .with_label(span)
}

fn missing_dependency_diagnostic(
    hook_name: &str,
    deps: &[Name<'_>],
    span: Span,
    _mutable_ref_dependency: Option<&str>,
) -> OxcDiagnostic {
    let dependency_names = deps.iter().map(ToString::to_string).join(", ");
    OxcDiagnostic::warn(format!(
        "`{hook_name}` can run with a stale `{dependency_names}` & show your users old data."
    ))
    .with_label(span)
}

fn unnecessary_dependency_diagnostic(hook_name: &str, dep_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` re-runs whenever `{dep_name}` changes even though it never uses it."
    ))
    .with_label(span)
}

fn dependency_array_not_array_literal_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}`'s dependencies can't be checked because its second argument isn't an inline array, so stale values can slip through."
    ))
    .with_label(span)
}

fn literal_in_dependency_array_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "A literal in `{hook_name}`'s dependency array never changes, so it adds noise without protecting against stale values."
    ))
    .with_label(span)
}

fn duplicate_dependency_diagnostic(hook_name: &str, dep_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` lists `{dep_name}` twice, adding dependency-array noise without changing when it runs."
    ))
    .with_label(span)
}

fn complex_expression_in_dependency_array_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "A complex expression in `{hook_name}`'s dependency array hides the real value, so stale values can slip through.",
    ))
    .with_label(span)
}

fn spread_dependency_diagnostic(hook_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "A spread in `{hook_name}`'s dependency array hides the actual deps, so stale values can slip through."
    ))
    .with_label(span)
}

fn dependency_changes_on_every_render_diagnostic(
    hook_name: &str,
    span: Span,
    dep_name: &str,
    _dep_decl_span: Span,
) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{dep_name}` is rebuilt every render, so `{hook_name}` runs every time."
    ))
    .with_label(span)
}

fn unnecessary_outer_scope_dependency_diagnostic(
    hook_name: &str,
    dep_name: &str,
    span: Span,
) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` doesn't need `{dep_name}` in its dependency array — it's defined outside the component and never changes between renders."
    ))
    .with_label(span)
}

fn ref_current_dependency_diagnostic(hook_name: &str, dep_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` won't re-run when `{dep_name}` changes, since a ref never triggers a redraw."
    ))
    .with_label(span)
}

fn infinite_rerender_call_to_set_state_diagnostic(
    hook_name: &str,
    setter_name: &str,
    span: Span,
) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{hook_name}` calls `{setter_name}` with a value that can change on every render and no dependency array, so it can keep triggering renders."
    ))
    .with_label(span)
}

fn ref_accessed_directly_in_effect_cleanup_diagnostic(dep_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "Your cleanup may read the wrong node since the ref `{dep_name}` can change before it runs."
    ))
    .with_label(span)
}

fn assignment_diagnostic(name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "Assigning to `{name}` inside a hook is thrown away after each render, so the next render reads the old value."
    ))
    .with_label(span)
}

fn functions_returned_from_use_effect_event_must_not_be_included_in_dependency_array(
    span: Span,
) -> OxcDiagnostic {
    OxcDiagnostic::warn("A function from `useEffectEvent` is stable, so listing it adds noise and defeats the event/dependency split.")
    .with_label(span)
}

fn forwarded_unstable_dependency_diagnostic(name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "`{name}` is rebuilt every render and reaches a Hook dependency inside this custom Hook."
    ))
    .with_label(span)
}

#[derive(Debug, Default, Clone)]
pub struct ExhaustiveDeps;

struct ExhaustiveDepsReportingContext<'ctx, 'ast> {
    inner: &'ctx LintContext<'ast>,
}

impl<'ast> std::ops::Deref for ExhaustiveDepsReportingContext<'_, 'ast> {
    type Target = LintContext<'ast>;

    fn deref(&self) -> &Self::Target {
        self.inner
    }
}

impl ExhaustiveDepsReportingContext<'_, '_> {
    fn diagnostic(&self, diagnostic: OxcDiagnostic) {
        let report_offset = diagnostic
            .labels
            .first()
            .map_or(0, oxc_span::LabeledSpan::offset);
        if !is_exhaustive_deps_suppressed_at(report_offset, self.source_text()) {
            self.inner.diagnostic(diagnostic);
        }
    }
}

declare_oxc_lint!(
    /// ### What it does
    ///
    /// Verifies the list of dependencies for Hooks like `useEffect` and similar.
    ///
    /// ### Why is this bad?
    ///
    /// React Hooks like `useEffect` and similar require a list of dependencies to be passed as an argument. This list is used to determine when the effect should be re-run. If the list is missing or incomplete, the effect may run more often than necessary, or not at all.
    ///
    /// ### Examples
    ///
    /// Examples of **incorrect** code for this rule:
    /// ```javascript
    /// function MyComponent(props) {
    ///     useEffect(() => {
    ///         console.log(props.foo);
    ///     }, []);
    ///     // `props` is missing from the dependencies array
    ///     return <div />;
    /// }
    /// ```
    ///
    /// Examples of **correct** code for this rule:
    /// ```javascript
    /// function MyComponent(props) {
    ///     useEffect(() => {
    ///         console.log(props.foo);
    ///     }, [props]);
    ///     return <div />;
    /// }
    /// ```
    ExhaustiveDeps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Missing effect dependencies.",
);

const HOOKS_USELESS_WITHOUT_DEPENDENCIES: [&str; 2] = ["useCallback", "useMemo"];
const REACT_COMPONENT_TYPE_NAMES: [&str; 4] =
    ["ComponentClass", "ComponentType", "FC", "FunctionComponent"];

fn symbol_has_react_component_type_annotation(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(type_annotation) = &declarator.type_annotation else {
        return false;
    };
    type_node_proves_react_component(&type_annotation.type_annotation, ctx, &mut Vec::new())
}

fn type_node_proves_react_component<'a>(
    type_node: &TSType<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match type_node {
        TSType::TSIntersectionType(intersection) => intersection
            .types
            .iter()
            .any(|member| type_node_proves_react_component(member, ctx, visited_symbol_ids)),
        TSType::TSParenthesizedType(parenthesized) => type_node_proves_react_component(
            &parenthesized.type_annotation,
            ctx,
            visited_symbol_ids,
        ),
        TSType::TSTypeReference(type_reference) => {
            type_name_proves_react_component(&type_reference.type_name, ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn type_name_proves_react_component<'a>(
    type_name: &TSTypeName<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    match type_name {
        TSTypeName::QualifiedName(qualified_name) => {
            if !REACT_COMPONENT_TYPE_NAMES.contains(&qualified_name.right.name.as_str()) {
                return false;
            }
            let TSTypeName::IdentifierReference(namespace) = &qualified_name.left else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(namespace.reference_id())
                .symbol_id()
            else {
                return false;
            };
            react_import_for_symbol(symbol_id, ctx).is_some_and(|entry| {
                matches!(
                    entry.import_name,
                    crate::module_record::ImportImportName::Default(_)
                        | crate::module_record::ImportImportName::NamespaceObject
                )
            })
        }
        TSTypeName::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if react_import_for_symbol(symbol_id, ctx).is_some_and(|entry| {
                matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if REACT_COMPONENT_TYPE_NAMES.contains(&imported_name.name())
                )
            }) {
                return true;
            }
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            matches!(
                declaration.kind(),
                AstKind::TSTypeAliasDeclaration(alias)
                    if type_node_proves_react_component(
                        &alias.type_annotation,
                        ctx,
                        visited_symbol_ids,
                    )
            )
        }
        TSTypeName::ThisExpression(_) => false,
    }
}

fn react_import_for_symbol<'a>(
    symbol_id: SymbolId,
    ctx: &'a LintContext<'_>,
) -> Option<&'a crate::module_record::ImportEntry> {
    ctx.module_record().import_entries.iter().find(|entry| {
        REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

impl Rule for ExhaustiveDeps {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && !ctx
                .file_extension()
                .is_some_and(|extension| extension == "vue" || extension == "svelte")
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expr) = node.kind() else {
            return;
        };

        let ctx = &ExhaustiveDepsReportingContext { inner: ctx };

        let Some(hook_name) = reactive_hook_name(call_expr, ctx) else {
            return;
        };

        let Some(callback_index) = self.get_reactive_hook_callback_index(hook_name.as_ref(), ctx)
        else {
            return;
        };
        report_forwarded_fresh_hook_dependencies(node, call_expr, ctx);
        let hook_name = hook_name.as_ref();

        let component_scope_id = match get_enclosing_function(node, ctx).map(|node| node.kind()) {
            Some(AstKind::Function(function)) => function.scope_id(),
            Some(AstKind::ArrowFunctionExpression(function)) => function.scope_id(),
            _ => ctx.scoping().root_scope_id(),
        };

        let callback_node = call_expr.arguments.get(callback_index);
        let dependencies_node = call_expr.arguments.get(callback_index + 1);
        let dependencies_argument_span = dependencies_node.map(|argument| argument.span());

        let Some(callback_node) = callback_node else {
            ctx.diagnostic(missing_callback_diagnostic(hook_name, call_expr.span()));
            return;
        };
        let callback_argument_span = callback_node.span();

        let is_effect = matches!(
            hook_name,
            "useEffect" | "useLayoutEffect" | "useInsertionEffect"
        );
        let should_check_ref_cleanup =
            is_effect || additional_hooks(ctx).is_some_and(|regex| regex.is_match(hook_name));

        let mut forced_callback_dependency = None;
        let callback_node = match callback_node {
            Argument::SpreadElement(_) => {
                if dependencies_node.is_some() {
                    ctx.diagnostic(unknown_dependencies_diagnostic(
                        hook_name,
                        callback_argument_span,
                    ));
                }
                None
            }
            match_expression!(Argument) => {
                match callback_node.to_expression().get_inner_expression() {
                    Expression::ArrowFunctionExpression(arrow_function_expression) => {
                        Some(CallbackNode::ArrowFunction(arrow_function_expression))
                    }
                    Expression::FunctionExpression(function_expression) => {
                        Some(CallbackNode::Function(function_expression))
                    }
                    Expression::Identifier(ident) => {
                        if let Some(dependencies_node) = dependencies_node {
                            let dependencies_include_callback = dependencies_node
                                .as_expression()
                                .is_some_and(|value| {
                                    matches!(value.get_inner_expression(), Expression::ArrayExpression(array) if array.elements.iter().any(|element| {
                                        matches!(element.as_expression().map(Expression::get_inner_expression), Some(Expression::Identifier(array_identifier)) if array_identifier.name == ident.name)
                                    }))
                                });
                            // Try to find the var in the current scope
                            if let Some(decl) = get_declaration_of_variable(ident, ctx.semantic()) {
                                match decl.kind() {
                                    AstKind::VariableDeclarator(var_decl) => {
                                        if let Some(init) = &var_decl.init {
                                            match init.get_inner_expression() {
                                                Expression::FunctionExpression(function) => {
                                                    Some(CallbackNode::Function(function))
                                                }
                                                Expression::ArrowFunctionExpression(function) => {
                                                    Some(CallbackNode::ArrowFunction(function))
                                                }
                                                Expression::CallExpression(_) => {
                                                    let reference = ctx
                                                        .scoping()
                                                        .get_reference(ident.reference_id());
                                                    forced_callback_dependency = Some(Dependency {
                                                        span: ident.span,
                                                        name: ident.name.clone().into(),
                                                        reference_id: ident.reference_id(),
                                                        symbol_id: reference.symbol_id(),
                                                        chain: Vec::new(),
                                                    });
                                                    Some(CallbackNode::Identifier {
                                                        span: ident.span,
                                                        scope_id: component_scope_id,
                                                        node_id: reference.node_id(),
                                                    })
                                                }
                                                _ => {
                                                    if dependencies_include_callback {
                                                        return;
                                                    }
                                                    ctx.diagnostic(
                                                        unknown_dependencies_diagnostic(
                                                            hook_name,
                                                            callback_argument_span,
                                                        ),
                                                    );
                                                    None
                                                }
                                            }
                                        } else {
                                            None
                                        }
                                    }
                                    AstKind::Function(function) => {
                                        Some(CallbackNode::Function(function))
                                    }
                                    AstKind::FormalParameter(_) => {
                                        if dependencies_include_callback {
                                            return;
                                        }
                                        ctx.diagnostic(unknown_dependencies_diagnostic(
                                            hook_name,
                                            callback_argument_span,
                                        ));
                                        None
                                    }
                                    _ => None,
                                }
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    }
                    _ => {
                        if dependencies_node.is_some() {
                            ctx.diagnostic(unknown_dependencies_diagnostic(
                                hook_name,
                                callback_argument_span,
                            ));
                        }
                        None
                    }
                }
            }
        };

        let Some(callback_node) = callback_node else {
            if dependencies_node.is_none() && hook_requires_dependency_array(hook_name, ctx) {
                ctx.diagnostic(dependency_array_required_diagnostic(
                    hook_name,
                    call_expr.span(),
                ));
            }
            return;
        };

        if callback_node.is_async() && is_effect {
            ctx.diagnostic(async_effect_diagnostic(hook_name, callback_argument_span));
        }

        if let Some(dependencies_argument) = dependencies_node.and_then(Argument::as_expression) {
            match dependencies_argument.get_inner_expression() {
                Expression::Identifier(identifier)
                    if identifier.name == "undefined"
                        && ctx.is_reference_to_global_variable(identifier) =>
                {
                    if is_auto_dependencies_hook(hook_name, ctx) {
                        return;
                    }
                    if HOOKS_USELESS_WITHOUT_DEPENDENCIES.contains(&hook_name) {
                        ctx.diagnostic(dependency_array_required_diagnostic(
                            hook_name,
                            dependencies_argument.span(),
                        ));
                    }
                    return;
                }
                Expression::NullLiteral(_) => {
                    if is_auto_dependencies_hook(hook_name, ctx) {
                        return;
                    }
                    if HOOKS_USELESS_WITHOUT_DEPENDENCIES.contains(&hook_name) {
                        ctx.diagnostic(dependency_array_required_diagnostic(
                            hook_name,
                            dependencies_argument.span(),
                        ));
                        return;
                    }
                }
                Expression::Identifier(identifier)
                    if ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_some_and(|symbol_id| symbol_is_parameter(symbol_id, ctx)) =>
                {
                    return;
                }
                _ => {}
            }
        }

        let dependencies_node = dependencies_node.and_then(|node| match node {
            Argument::SpreadElement(_) => {
                ctx.diagnostic(dependency_array_not_array_literal_diagnostic(
                    hook_name,
                    node.span(),
                ));
                None
            }
            match_expression!(Argument) => {
                let inner_expr = node.to_expression().get_inner_expression();
                match inner_expr {
                    Expression::ArrayExpression(array_expr) => Some(array_expr),
                    Expression::Identifier(ident)
                        if ident.name == "undefined"
                            && ctx.is_reference_to_global_variable(ident) =>
                    {
                        None
                    }
                    _ => {
                        ctx.diagnostic(dependency_array_not_array_literal_diagnostic(
                            hook_name,
                            node.span(),
                        ));
                        None
                    }
                }
            }
        });

        let callback_scope_id = callback_node.scope_id();
        let (mut found_dependencies, refs_inside_cleanups) = {
            let mut found_dependencies = ExhaustiveDepsVisitor::new(ctx.semantic());

            if let Some(parameters) = callback_node.parameters() {
                found_dependencies.visit_formal_parameters(parameters);
            }

            if let Some(function_body) = callback_node.body() {
                function_body.visit(&mut found_dependencies);
            }

            (
                found_dependencies.found_dependencies,
                found_dependencies.refs_inside_cleanups,
            )
        };
        found_dependencies.retain(|dependency| {
            dependency.symbol_id.is_some_and(|symbol_id| {
                let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
                symbol_scope_id != callback_scope_id
                    && !ctx
                        .scoping()
                        .scope_is_descendant_of(symbol_scope_id, callback_scope_id)
            })
        });

        let mut assigned_names = FxHashSet::default();
        let mut did_report_outer_assignment = false;
        for candidate in ctx.nodes().iter() {
            if !callback_node.span().contains_inclusive(candidate.span()) {
                continue;
            }
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                continue;
            };
            let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
                continue;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                continue;
            };
            if assigned_names.contains(identifier.name.as_str())
                || get_enclosing_function(ctx.symbol_declaration(symbol_id), ctx).is_none()
            {
                continue;
            }
            let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
            if symbol_scope_id == callback_scope_id
                || ctx
                    .scoping()
                    .scope_is_descendant_of(symbol_scope_id, callback_scope_id)
            {
                continue;
            }
            assigned_names.insert(identifier.name.to_string());
            did_report_outer_assignment = true;
            ctx.diagnostic(assignment_diagnostic(
                identifier.name.as_str(),
                identifier.span,
            ));
        }
        if did_report_outer_assignment {
            return;
        }

        if should_check_ref_cleanup {
            for r#ref in refs_inside_cleanups {
                if let Expression::Identifier(ident) = r#ref.object.get_inner_expression() {
                    let reference = ctx.scoping().get_reference(ident.reference_id());
                    let is_callback_local = reference.symbol_id().is_some_and(|symbol_id| {
                        let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
                        symbol_scope_id == callback_scope_id
                            || ctx
                                .scoping()
                                .scope_is_descendant_of(symbol_scope_id, callback_scope_id)
                    });
                    if is_callback_local {
                        continue;
                    }
                    let has_write_reference = reference.symbol_id().is_some_and(|symbol_id| {
                        ctx.semantic()
                            .symbol_references(symbol_id)
                            .any(|reference| {
                                let reference_node = ctx.nodes().get_node(reference.node_id());
                                ref_current_chain_is_written(
                                    reference.node_id(),
                                    get_enclosing_function(reference_node, ctx).is_some_and(
                                        |function| function.id() == callback_node.node_id(),
                                    ),
                                    ctx,
                                )
                            })
                    });

                    if has_write_reference || is_seeded_data_ref(ident, ctx) {
                        break;
                    }
                }
                ctx.diagnostic(ref_accessed_directly_in_effect_cleanup_diagnostic(
                    ctx.source_range(r#ref.span()),
                    callback_node.span(),
                ));
                break;
            }
        }

        if dependencies_node.is_none()
            && let Some(dependencies_argument_span) = dependencies_argument_span
        {
            let mut missing_dependencies = found_dependencies
                .iter()
                .filter(|dependency| {
                    is_identifier_a_dependency(
                        dependency.name,
                        dependency.reference_id,
                        dependency.span,
                        ctx,
                        component_scope_id,
                    )
                })
                .map(Name::from)
                .collect::<Vec<_>>();
            missing_dependencies.sort_unstable_by_key(|dependency| dependency.span.start);
            if !missing_dependencies.is_empty() {
                ctx.diagnostic(missing_dependency_diagnostic(
                    hook_name,
                    &missing_dependencies,
                    dependencies_argument_span,
                    None,
                ));
            }
            return;
        }

        let Some(dependencies_node) = dependencies_node else {
            if is_effect {
                let set_state_call = if should_use_curated_port_behavior(ctx) {
                    find_render_changing_state_setter_name(&callback_node, ctx)
                } else {
                    find_state_setter_reference_name(&callback_node, ctx)
                };

                if let Some(setter_name) = set_state_call {
                    ctx.diagnostic(infinite_rerender_call_to_set_state_diagnostic(
                        hook_name,
                        setter_name.as_str(),
                        callback_node.span(),
                    ));
                    return;
                }
            }
            if hook_requires_dependency_array(hook_name, ctx) {
                ctx.diagnostic(dependency_array_required_diagnostic(
                    hook_name,
                    call_expr.span(),
                ));
            }

            return;
        };

        let has_literal_dependency = dependencies_node.elements.iter().any(|element| {
            element.as_expression().is_some_and(|expression| {
                let expression = expression.get_inner_expression();
                expression.is_literal()
                    || matches!(expression, Expression::TemplateLiteral(template) if template.expressions.is_empty())
            })
        });
        let has_non_string_literal_dependency = dependencies_node.elements.iter().any(|element| {
            element.as_expression().is_some_and(|expression| {
                let expression = expression.get_inner_expression();
                expression.is_literal() && !matches!(expression, Expression::StringLiteral(_))
            })
        });
        if has_non_string_literal_dependency {
            ctx.diagnostic(literal_in_dependency_array_diagnostic(
                hook_name,
                dependencies_node.span,
            ));
        }

        let mut did_report_ref_current_dependency = false;
        let declared_dependencies_iter =
            dependencies_node
                .elements
                .iter()
                .filter_map(|elem| match elem {
                    ArrayExpressionElement::Elision(_) => None,
                    ArrayExpressionElement::SpreadElement(spread) => {
                        let is_parameter_spread = matches!(spread.argument.get_inner_expression(), Expression::Identifier(identifier) if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(|symbol_id| symbol_is_parameter(symbol_id, ctx)));
                        if !is_parameter_spread {
                            ctx.diagnostic(spread_dependency_diagnostic(hook_name, elem.span()));
                        }
                        None
                    }
                    match_expression!(ArrayExpressionElement) => {
                        let elem = elem.to_expression().get_inner_expression();

                        let dependency = match elem {
                            Expression::CallExpression(call) if call.arguments.is_empty() => {
                                analyze_property_chain(&call.callee, ctx)
                            }
                            Expression::ChainExpression(chain)
                                if matches!(&chain.expression, ChainElement::CallExpression(call) if call.arguments.is_empty()) =>
                            {
                                let ChainElement::CallExpression(call) = &chain.expression else {
                                    unreachable!();
                                };
                                analyze_property_chain(&call.callee, ctx)
                            }
                            _ => analyze_property_chain(elem, ctx),
                        };
                        let has_computed_member = match elem {
                            Expression::CallExpression(call) => {
                                contains_computed_member(&call.callee)
                            }
                            Expression::ChainExpression(chain)
                                if let ChainElement::CallExpression(call) = &chain.expression =>
                            {
                                contains_computed_member(&call.callee)
                            }
                            _ => contains_computed_member(elem),
                        };
                        if has_computed_member {
                            ctx.diagnostic(complex_expression_in_dependency_array_diagnostic(
                                hook_name,
                                elem.span(),
                            ));
                            None
                        } else {
                            match dependency {
                                Ok(Some(dependency)) => {
                                    let is_ref_current_non_dependency = dependency.chain.len() == 1
                                        && dependency.chain[0] == "current"
                                        && dependency.symbol_id.is_some_and(|symbol_id| {
                                            symbol_has_stable_hook_origin(symbol_id, ctx)
                                        });
                                    if !is_ref_current_non_dependency {
                                        return Some(dependency);
                                    }
                                    if !did_report_ref_current_dependency {
                                        ctx.diagnostic(ref_current_dependency_diagnostic(
                                            hook_name,
                                            &dependency.to_string(),
                                            dependency.span,
                                        ));
                                        did_report_ref_current_dependency = true;
                                    }
                                    None
                                }
                                Ok(None) => None,
                                Err(())
                                    if elem.is_literal()
                                        || matches!(elem, Expression::TemplateLiteral(template) if template.expressions.is_empty()) =>
                                {
                                    None
                                }
                                Err(()) => {
                                    ctx.diagnostic(
                                        complex_expression_in_dependency_array_diagnostic(
                                            hook_name,
                                            elem.span(),
                                        ),
                                    );
                                    None
                                }
                            }
                        }
                    }
                });

        let mut did_report_duplicate_dependency = false;
        let declared_dependencies = {
            let mut declared_dependencies = FxHashSet::default();
            for item in declared_dependencies_iter {
                let span = item.span;
                let item_name = item.to_string();
                if !declared_dependencies.insert(item) {
                    did_report_duplicate_dependency = true;
                    ctx.diagnostic(duplicate_dependency_diagnostic(hook_name, &item_name, span));
                }
            }

            declared_dependencies
        };

        found_dependencies.retain(|dependency| {
            !dependency.chain.is_empty()
                || !declared_dependencies
                    .iter()
                    .any(|declared| declared.name == dependency.name && !declared.chain.is_empty())
                || !is_boolean_guard_dependency(dependency, ctx)
        });

        replace_derived_dependencies(
            &mut found_dependencies,
            &declared_dependencies,
            ctx,
            component_scope_id,
        );
        if matches!(hook_name, "useEffect" | "useLayoutEffect") && !declared_dependencies.is_empty()
        {
            remove_sole_writer_guard_dependencies(&mut found_dependencies, &callback_node, ctx);
        }
        add_aggregate_props_dependency(
            &mut found_dependencies,
            &declared_dependencies,
            &callback_node,
            should_use_curated_port_behavior(ctx),
            ctx,
        );
        let forced_callback_reference_id = forced_callback_dependency
            .as_ref()
            .map(|dependency| dependency.reference_id);
        if let Some(forced_callback_dependency) = forced_callback_dependency {
            found_dependencies.insert(forced_callback_dependency);
        }

        let mut undeclared_deps = found_dependencies
            .difference(&declared_dependencies)
            .filter(|dep| {
                // `foo.current` reads should be attributed to `foo` when `foo` is also tracked.
                // This matches react-hooks behavior for ref-like values passed as props.
                if dep.chain.last().is_some_and(|part| part == "current") {
                    let mut base_chain = dep.chain.clone();
                    base_chain.pop();
                    let base_dependency = Dependency {
                        span: dep.span,
                        name: dep.name,
                        reference_id: dep.reference_id,
                        symbol_id: dep.symbol_id,
                        chain: base_chain,
                    };
                    if found_dependencies.contains(&base_dependency) {
                        return false;
                    }
                }

                if declared_dependencies
                    .iter()
                    .any(|decl_dep| dep.contains(decl_dep))
                {
                    return false;
                }

                if forced_callback_reference_id == Some(dep.reference_id) {
                    return true;
                }
                if !is_identifier_a_dependency(
                    dep.name,
                    dep.reference_id,
                    dep.span,
                    ctx,
                    component_scope_id,
                ) {
                    return false;
                }
                true
            })
            .collect::<Vec<_>>();
        undeclared_deps
            .sort_unstable_by_key(|dependency| (dependency.span.start, dependency.span.end));

        if undeclared_deps.is_empty() {
            for dependency in &declared_dependencies {
                let Some(symbol_id) = dependency.symbol_id else {
                    continue;
                };
                let dependency_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
                let is_captured_module_dependency =
                    ctx.scoping().scope_flags(dependency_scope_id).is_top()
                        && found_dependencies.iter().any(|found_dependency| {
                            found_dependency.symbol_id == Some(symbol_id)
                                && found_dependency.contains(dependency)
                        });
                if is_captured_module_dependency {
                    ctx.diagnostic(unnecessary_outer_scope_dependency_diagnostic(
                        hook_name,
                        &dependency.to_string(),
                        dependency.span,
                    ));
                }
            }
        }

        if !undeclared_deps.is_empty() {
            let undeclared = undeclared_deps
                .iter()
                .copied()
                .map(Name::from)
                .collect::<Vec<_>>();
            let mutable_ref_dependency = declared_dependencies.iter().find_map(|declared_dep| {
                if !declared_dep
                    .chain
                    .last()
                    .is_some_and(|part| part == "current")
                {
                    return None;
                }

                let mut base_chain = declared_dep.chain.clone();
                base_chain.pop();
                let base_dependency = Dependency {
                    span: declared_dep.span,
                    name: declared_dep.name,
                    reference_id: declared_dep.reference_id,
                    symbol_id: declared_dep.symbol_id,
                    chain: base_chain,
                };
                undeclared_deps
                    .iter()
                    .copied()
                    .any(|dep| dep == &base_dependency)
                    .then(|| declared_dep.to_string())
            });
            ctx.diagnostic(missing_dependency_diagnostic(
                hook_name,
                &undeclared,
                dependencies_node.span(),
                mutable_ref_dependency.as_deref(),
            ));
        } else if has_literal_dependency && !has_non_string_literal_dependency {
            ctx.diagnostic(literal_in_dependency_array_diagnostic(
                hook_name,
                dependencies_node.span,
            ));
        }

        for dep in &declared_dependencies {
            if dep
                .symbol_id
                .is_some_and(|symbol_id| symbol_has_react_use_effect_event_origin(symbol_id, ctx))
            {
                ctx.diagnostic(functions_returned_from_use_effect_event_must_not_be_included_in_dependency_array(dep.span));
            }
        }

        let mut unnecessary_dependencies = declared_dependencies
            .iter()
            .filter(|dependency| {
                if did_report_ref_current_dependency
                    || !undeclared_deps.is_empty()
                    || found_dependencies.iter().any(|found_dependency| {
                        found_dependency.symbol_id.is_some()
                            && found_dependency.contains(dependency)
                    })
                    || undeclared_deps
                        .iter()
                        .copied()
                        .any(|undeclared_dependency| dependency.contains(undeclared_dependency))
                    || declared_dependencies.iter().any(|declared_dependency| {
                        declared_dependency != *dependency
                            && dependency.contains(declared_dependency)
                    })
                {
                    return false;
                }
                if !is_effect {
                    return !is_extra_dependency_allowed_for_hook(
                        hook_name,
                        dependency,
                        ctx,
                        component_scope_id,
                    );
                }
                dependency.symbol_id.is_none_or(|symbol_id| {
                    ctx.scoping()
                        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
                        .is_top()
                })
            })
            .collect::<Vec<_>>();
        if !is_effect {
            for dependency in &declared_dependencies {
                let is_used = found_dependencies
                    .iter()
                    .any(|capture| capture.contains(dependency));
                let has_broader_declared_dependency = declared_dependencies
                    .iter()
                    .any(|other| dependency != other && dependency.contains(other));
                if is_used
                    && has_broader_declared_dependency
                    && !unnecessary_dependencies.contains(&dependency)
                {
                    unnecessary_dependencies.push(dependency);
                }
            }
        }
        unnecessary_dependencies.sort_unstable_by_key(|dependency| dependency.span.start);
        if let Some(last_dependency) = unnecessary_dependencies.last() {
            let dependency_names = unnecessary_dependencies
                .iter()
                .map(|dependency| dependency.to_string())
                .join(", ");
            ctx.diagnostic(unnecessary_dependency_diagnostic(
                hook_name,
                &dependency_names,
                last_dependency.span,
            ));
        }

        let has_unused_declared_dependency = declared_dependencies.iter().any(|declared| {
            !found_dependencies
                .iter()
                .any(|capture| capture.contains(declared))
        });
        let mut ordered_declared_dependencies = declared_dependencies.iter().collect_vec();
        ordered_declared_dependencies.sort_unstable_by_key(|dependency| dependency.span.start);
        for dep in &ordered_declared_dependencies {
            let Some(symbol_id) = dep.symbol_id else {
                continue;
            };

            if dep.chain.is_empty()
                && !is_recursive_initializer_capture(symbol_id, callback_node.span(), ctx)
                && is_symbol_function_value(symbol_id, ctx)
            {
                let name = ctx.scoping().symbol_name(symbol_id);
                let decl_span = ctx.scoping().symbol_span(symbol_id);
                ctx.diagnostic(dependency_changes_on_every_render_diagnostic(
                    hook_name, dep.span, name, decl_span,
                ));
            }
        }
        if undeclared_deps.is_empty()
            && !has_unused_declared_dependency
            && !did_report_duplicate_dependency
            && let Some(dep) = ordered_declared_dependencies.iter().find(|dep| {
                dep.chain.is_empty()
                    && dep.symbol_id.is_some_and(|symbol_id| {
                        !is_recursive_initializer_capture(symbol_id, callback_node.span(), ctx)
                            && !is_symbol_function_value(symbol_id, ctx)
                            && is_symbol_declaration_referentially_unique(symbol_id, ctx)
                    })
            })
        {
            let symbol_id = dep.symbol_id.unwrap();
            let name = ctx.scoping().symbol_name(symbol_id);
            let decl_span = ctx.scoping().symbol_span(symbol_id);
            ctx.diagnostic(dependency_changes_on_every_render_diagnostic(
                hook_name, dep.span, name, decl_span,
            ));
        }
    }
}

fn hook_requires_dependency_array(hook_name: &str, ctx: &LintContext<'_>) -> bool {
    HOOKS_USELESS_WITHOUT_DEPENDENCIES.contains(&hook_name)
        || (require_explicit_effect_deps(ctx)
            && matches!(
                hook_name,
                "useEffect"
                    | "useLayoutEffect"
                    | "useCallback"
                    | "useMemo"
                    | "useImperativeHandle"
                    | "useInsertionEffect"
            ))
}

fn symbol_is_parameter(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .find_map(|owner| match owner.kind() {
            AstKind::Function(function) => Some(&function.params),
            AstKind::ArrowFunctionExpression(function) => Some(&function.params),
            _ => None,
        })
        .is_some_and(|parameters| {
            parameters.items.iter().any(|parameter| {
                parameter
                    .pattern
                    .get_binding_identifiers()
                    .iter()
                    .any(|identifier| identifier.symbol_id() == symbol_id)
            }) || parameters.rest.as_ref().is_some_and(|rest| {
                rest.rest
                    .argument
                    .get_binding_identifiers()
                    .iter()
                    .any(|identifier| identifier.symbol_id() == symbol_id)
            })
        })
}

fn is_extra_dependency_allowed_for_hook<'a>(
    hook_name: &str,
    dependency: &Dependency<'a>,
    ctx: &LintContext<'a>,
    component_scope_id: ScopeId,
) -> bool {
    hook_name == "useMemo"
        && is_identifier_a_dependency(
            dependency.name,
            dependency.reference_id,
            dependency.span,
            ctx,
            component_scope_id,
        )
        && dependency
            .symbol_id
            .is_none_or(|symbol_id| !is_symbol_declaration_referentially_unique(symbol_id, ctx))
}

fn is_recursive_initializer_capture(
    symbol_id: SymbolId,
    callback_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .take_while(|owner| {
            !matches!(
                owner.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find_map(|owner| match owner.kind() {
            AstKind::VariableDeclarator(declarator) => Some(declarator),
            _ => None,
        })
        .and_then(|declarator| declarator.init.as_ref())
        .is_some_and(|initializer| initializer.span().contains_inclusive(callback_span))
}

fn is_symbol_declaration_referentially_unique(symbol_id: SymbolId, ctx: &LintContext) -> bool {
    let declaration = ctx.semantic().symbol_declaration(symbol_id);
    let declaration = std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .take_while(|owner| {
            !matches!(
                owner.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find(|owner| {
            matches!(
                owner.kind(),
                AstKind::Class(_) | AstKind::VariableDeclarator(_)
            )
        });
    let Some(declaration) = declaration else {
        return false;
    };

    match declaration.kind() {
        AstKind::Class(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            if declarator.id.is_destructuring_pattern() {
                return false;
            }

            let Some(initializer) = &declarator.init else {
                return false;
            };
            if matches!(
                initializer.get_inner_expression(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) {
                return false;
            }

            is_expression_referentially_unique(initializer, ctx)
        }
        _ => false,
    }
}

fn is_symbol_function_value(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    if std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .any(|owner| {
            matches!(owner.kind(), AstKind::Function(function) if function.id.as_ref().is_some_and(|identifier| identifier.symbol_id() == symbol_id))
        })
    {
        return true;
    }
    if parameter_default_initializer_for_symbol(symbol_id, ctx).is_some_and(|initializer| {
        matches!(
            initializer.get_inner_expression(),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        )
    }) {
        return true;
    }
    let initializer = std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .take_while(|owner| {
            !matches!(
                owner.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find_map(|owner| match owner.kind() {
            AstKind::VariableDeclarator(declarator) => binding_pattern_initializer_for_symbol(
                &declarator.id,
                symbol_id,
                declarator.init.as_ref(),
            ),
            AstKind::FormalParameter(parameter) => {
                binding_pattern_initializer_for_symbol(&parameter.pattern, symbol_id, None)
            }
            _ => None,
        });
    initializer.is_some_and(|initializer| {
        matches!(
            initializer.get_inner_expression(),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        )
    })
}

fn is_expression_referentially_unique<'a>(expr: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    match expr.get_inner_expression() {
        Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_)
        | Expression::NewExpression(_)
        | Expression::RegExpLiteral(_)
        | Expression::JSXElement(_)
        | Expression::JSXFragment(_) => true,
        Expression::ConditionalExpression(conditional) => {
            is_expression_referentially_unique(&conditional.consequent, ctx)
                || is_expression_referentially_unique(&conditional.alternate, ctx)
        }
        Expression::LogicalExpression(logical) => {
            if logical.operator.as_str() == "??"
                && is_controlled_state_selection(&logical.left, ctx)
            {
                return is_expression_referentially_unique(&logical.left, ctx);
            }
            is_expression_referentially_unique(&logical.left, ctx)
                || is_expression_referentially_unique(&logical.right, ctx)
        }
        Expression::AssignmentExpression(_) => true,
        // A BinaryExpression is deliberately absent: the arms above recurse
        // because those expressions evaluate *to* one of their operands, which
        // a binary expression never does. Every binary operator -- arithmetic,
        // comparison, bitwise, `in`, `instanceof` -- yields a primitive, so the
        // result is stable however unstable the operands are. Recursing into
        // the right operand made `new Date(a) > new Date()` inherit
        // "referentially unique" from the NewExpression and reported a boolean
        // as changing every render.
        _ => false,
    }
}

fn is_controlled_state_selection<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::ConditionalExpression(selection) = expression.get_inner_expression() else {
        return false;
    };
    let Expression::Identifier(discriminator) = selection.test.get_inner_expression() else {
        return false;
    };
    let Some(discriminator_symbol_id) = ctx
        .scoping()
        .get_reference(discriminator.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if ctx
        .semantic()
        .symbol_references(discriminator_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let AstKind::VariableDeclarator(discriminator_declarator) =
        ctx.symbol_declaration(discriminator_symbol_id).kind()
    else {
        return false;
    };
    let Some(Expression::BinaryExpression(comparison)) = discriminator_declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !matches!(comparison.operator.as_str(), "!=" | "!==") {
        return false;
    }
    let controlled_value = if is_global_undefined(&comparison.right, ctx) {
        &comparison.left
    } else if is_global_undefined(&comparison.left, ctx) {
        &comparison.right
    } else {
        return false;
    };
    if !expressions_reference_same_symbol(&selection.consequent, controlled_value, ctx) {
        return false;
    }
    state_initializer_for_expression(&selection.alternate, ctx).is_some_and(|initializer| {
        is_provably_non_nullish_initializer(initializer, ctx, &mut Vec::new())
    }) && controlled_value_type_excludes_null(controlled_value, ctx)
}

fn is_global_undefined(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier))
        || matches!(expression.get_inner_expression(), Expression::UnaryExpression(unary) if unary.operator.as_str() == "void")
}

fn expressions_reference_same_symbol(
    left: &Expression<'_>,
    right: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(left) = left.get_inner_expression() else {
        return false;
    };
    let Expression::Identifier(right) = right.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(left.reference_id())
        .symbol_id()
        .zip(
            ctx.scoping()
                .get_reference(right.reference_id())
                .symbol_id(),
        )
        .is_some_and(|(left, right)| left == right)
}

fn state_initializer_for_expression<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b Expression<'a>> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let state_symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(state_symbol_id).kind()
    else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let Some(Some(BindingPattern::BindingIdentifier(binding))) = pattern.elements.first() else {
        return None;
    };
    if binding.symbol_id() != state_symbol_id {
        return None;
    }
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return None;
    };
    if !exhaustive_deps_is_react_api_call(call, "useState", ctx) {
        return None;
    }
    call.arguments.first().and_then(Argument::as_expression)
}

fn is_provably_non_nullish_initializer(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ClassExpression(_)
        | Expression::NewExpression(_)
        | Expression::TemplateLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::StringLiteral(_) => true,
        Expression::NullLiteral(_) => false,
        Expression::LogicalExpression(logical) if logical.operator.as_str() == "??" => {
            is_provably_non_nullish_initializer(&logical.right, ctx, visited)
        }
        Expression::ConditionalExpression(conditional) => {
            is_provably_non_nullish_initializer(&conditional.consequent, ctx, visited)
                && is_provably_non_nullish_initializer(&conditional.alternate, ctx, visited)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited.contains(&symbol_id) {
                return false;
            }
            visited.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let result = matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                if matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                    && declarator.init.as_ref().is_some_and(|initializer| is_provably_non_nullish_initializer(initializer, ctx, visited)));
            visited.pop();
            result
        }
        _ => false,
    }
}

fn controlled_value_type_excludes_null(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    controlled_value_type(symbol_id, ctx)
        .is_some_and(|type_node| type_excludes_null(type_node, ctx, &mut Vec::new()))
}

fn controlled_value_type<'a, 'b>(
    symbol_id: SymbolId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b TSType<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::FormalParameter(parameter) = declaration.kind()
        && let Some(annotation) = &parameter.type_annotation
    {
        return Some(&annotation.type_annotation);
    }
    let symbol_span = ctx.scoping().symbol_span(symbol_id);
    let parameter = ctx.nodes().iter().find_map(|node| {
        let AstKind::FormalParameter(parameter) = node.kind() else {
            return None;
        };
        parameter
            .pattern
            .span()
            .contains_inclusive(symbol_span)
            .then_some((node, parameter))
    })?;
    let property_name = parameter
        .1
        .pattern
        .get_identifier_name()
        .map(|name| name.to_string())
        .or_else(|| {
            let BindingPattern::ObjectPattern(object) = &parameter.1.pattern else {
                return None;
            };
            object.properties.iter().find_map(|property| {
                property
                    .value
                    .span()
                    .contains_inclusive(symbol_span)
                    .then(|| property.key.static_name().map(|name| name.to_string()))
                    .flatten()
            })
        })?;
    let props_type = if let Some(annotation) = &parameter.1.type_annotation {
        Some(&annotation.type_annotation)
    } else {
        component_props_type_for_parameter(parameter.0, ctx)
    }?;
    property_type_from_type(props_type, &property_name, ctx, &mut Vec::new())
}

fn component_props_type_for_parameter<'a, 'b>(
    parameter: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b TSType<'a>> {
    let parameters = ctx.nodes().parent_node(parameter.id());
    let function = ctx.nodes().parent_node(parameters.id());
    let function_root = transparent_expression_root(function, ctx);
    let declarator = ctx.nodes().parent_node(function_root.id());
    let AstKind::VariableDeclarator(declarator) = declarator.kind() else {
        return None;
    };
    let binding = declarator.id.get_binding_identifier()?;
    if !symbol_has_react_component_type_annotation(binding.symbol_id(), ctx) {
        return None;
    }
    let annotation = declarator.type_annotation.as_ref()?;
    let TSType::TSTypeReference(reference) = &annotation.type_annotation else {
        return None;
    };
    reference.type_arguments.as_ref()?.params.first()
}

fn property_type_from_type<'a, 'b>(
    type_node: &'b TSType<'a>,
    property_name: &str,
    ctx: &'b LintContext<'a>,
    visited_names: &mut Vec<String>,
) -> Option<&'b TSType<'a>> {
    match type_node {
        TSType::TSTypeLiteral(literal) => {
            property_type_from_signatures(&literal.members, property_name)
        }
        TSType::TSIntersectionType(intersection) => intersection
            .types
            .iter()
            .find_map(|member| property_type_from_type(member, property_name, ctx, visited_names)),
        TSType::TSTypeReference(reference) => {
            let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
                return None;
            };
            if visited_names
                .iter()
                .any(|name| name == identifier.name.as_str())
            {
                return None;
            }
            visited_names.push(identifier.name.to_string());
            let result = ctx.nodes().iter().find_map(|node| match node.kind() {
                AstKind::TSInterfaceDeclaration(interface)
                    if interface.id.name == identifier.name =>
                {
                    property_type_from_signatures(&interface.body.body, property_name)
                }
                AstKind::TSTypeAliasDeclaration(alias) if alias.id.name == identifier.name => {
                    property_type_from_type(
                        &alias.type_annotation,
                        property_name,
                        ctx,
                        visited_names,
                    )
                }
                _ => None,
            });
            visited_names.pop();
            result
        }
        _ => None,
    }
}

fn property_type_from_signatures<'a, 'b>(
    members: &'b [TSSignature<'a>],
    property_name: &str,
) -> Option<&'b TSType<'a>> {
    members.iter().find_map(|member| {
        let TSSignature::TSPropertySignature(property) = member else {
            return None;
        };
        (!property.computed && property.key.static_name().as_deref() == Some(property_name))
            .then(|| {
                property
                    .type_annotation
                    .as_ref()
                    .map(|annotation| &annotation.type_annotation)
            })
            .flatten()
    })
}

fn type_excludes_null(
    type_node: &TSType<'_>,
    ctx: &LintContext<'_>,
    visited_names: &mut Vec<String>,
) -> bool {
    match type_node {
        TSType::TSNullKeyword(_) | TSType::TSAnyKeyword(_) | TSType::TSUnknownKeyword(_) => false,
        TSType::TSUnionType(union) => union
            .types
            .iter()
            .all(|member| type_excludes_null(member, ctx, visited_names)),
        TSType::TSTypeReference(reference) => {
            let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
                return false;
            };
            if visited_names
                .iter()
                .any(|name| name == identifier.name.as_str())
            {
                return false;
            }
            let declarations = ctx
                .nodes()
                .iter()
                .filter(|node| matches!(node.kind(), AstKind::TSInterfaceDeclaration(interface) if interface.id.name == identifier.name)
                    || matches!(node.kind(), AstKind::TSTypeAliasDeclaration(alias) if alias.id.name == identifier.name))
                .collect::<Vec<_>>();
            if declarations.is_empty() {
                return matches!(
                    identifier.name.as_str(),
                    "Array"
                        | "ReadonlyArray"
                        | "Map"
                        | "ReadonlyMap"
                        | "Set"
                        | "ReadonlySet"
                        | "Date"
                        | "RegExp"
                        | "Promise"
                        | "Record"
                ) && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none();
            }
            visited_names.push(identifier.name.to_string());
            let result = declarations.iter().all(|node| match node.kind() {
                AstKind::TSInterfaceDeclaration(_) => true,
                AstKind::TSTypeAliasDeclaration(alias) => {
                    type_excludes_null(&alias.type_annotation, ctx, visited_names)
                }
                _ => false,
            });
            visited_names.pop();
            result
        }
        _ => true,
    }
}

#[derive(Debug)]
enum CallbackNode<'a> {
    Function(&'a Function<'a>),
    ArrowFunction(&'a ArrowFunctionExpression<'a>),
    Identifier {
        span: Span,
        scope_id: ScopeId,
        node_id: NodeId,
    },
}

#[derive(Clone, Copy)]
enum CallbackBody<'a, 'b> {
    Function(&'b FunctionBody<'a>),
    Arrow(&'b ArrowFunctionBody<'a>),
}

impl<'a> CallbackBody<'a, '_> {
    fn visit(self, visitor: &mut ExhaustiveDepsVisitor<'a, '_>) {
        match self {
            Self::Function(body) => visitor.visit_function_body(body),
            Self::Arrow(body) => visitor.visit_arrow_function_body(body),
        }
    }

    fn visit_root(self, visitor: &mut ExhaustiveDepsVisitor<'a, '_>) {
        match self {
            Self::Function(body) => walk_function_body(visitor, body),
            Self::Arrow(body) => walk_arrow_function_body(visitor, body),
        }
    }
}

impl<'a> CallbackNode<'a> {
    fn is_async(&self) -> bool {
        match self {
            CallbackNode::Function(func) => func.r#async,
            CallbackNode::ArrowFunction(func) => func.r#async,
            CallbackNode::Identifier { .. } => false,
        }
    }

    fn scope_id(&self) -> ScopeId {
        match self {
            CallbackNode::Function(function) => function.scope_id(),
            CallbackNode::ArrowFunction(function) => function.scope_id(),
            CallbackNode::Identifier { scope_id, .. } => *scope_id,
        }
    }

    fn parameters(&self) -> Option<&FormalParameters<'a>> {
        match self {
            CallbackNode::Function(func) => Some(&func.params),
            CallbackNode::ArrowFunction(func) => Some(&func.params),
            CallbackNode::Identifier { .. } => None,
        }
    }

    fn body(&self) -> Option<CallbackBody<'a, '_>> {
        match self {
            CallbackNode::Function(func) => func.body.as_deref().map(CallbackBody::Function),
            CallbackNode::ArrowFunction(func) => Some(CallbackBody::Arrow(&func.body)),
            CallbackNode::Identifier { .. } => None,
        }
    }

    fn node_id(&self) -> NodeId {
        match self {
            CallbackNode::Function(function) => function.node_id.get(),
            CallbackNode::ArrowFunction(function) => function.node_id.get(),
            CallbackNode::Identifier { node_id, .. } => *node_id,
        }
    }
}

impl GetSpan for CallbackNode<'_> {
    fn span(&self) -> Span {
        match self {
            CallbackNode::Function(func) => func.span,
            CallbackNode::ArrowFunction(func) => func.span,
            CallbackNode::Identifier { span, .. } => *span,
        }
    }
}

fn find_render_changing_state_setter_name(
    callback: &CallbackNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    ctx.nodes().iter().find_map(|node| {
        let AstKind::CallExpression(call) = node.kind() else {
            return None;
        };
        if !callback.span().contains_inclusive(call.span)
            || get_enclosing_function(node, ctx)
                .is_none_or(|owner| owner.id() != callback.node_id())
        {
            return None;
        }
        let written_value = call
            .arguments
            .first()
            .and_then(|argument| argument.as_expression())?;
        let (setter_symbol_id, state_symbol_id) = state_setter_descriptor(call, ctx)?;
        (is_provably_changing_state_value(written_value, state_symbol_id, ctx)
            || is_provably_changing_functional_updater(written_value, ctx))
        .then(|| ctx.scoping().symbol_name(setter_symbol_id).to_string())
    })
}

fn find_state_setter_reference_name(
    callback: &CallbackNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    ctx.nodes().iter().find_map(|node| {
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return None;
        };
        if !callback.span().contains_inclusive(identifier.span)
            || get_enclosing_function(node, ctx)
                .is_none_or(|owner| owner.id() != callback.node_id())
        {
            return None;
        }
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        let setter_symbol_id = resolve_stable_symbol_id(symbol_id, ctx, &mut FxHashSet::default());
        state_setter_descriptor_for_symbol(setter_symbol_id, ctx)
            .map(|_| ctx.scoping().symbol_name(setter_symbol_id).to_string())
    })
}

fn state_setter_descriptor<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, Option<SymbolId>)> {
    let setter_symbol_id = resolve_stable_identifier_symbol(&call.callee, ctx)?;
    let state_symbol_id = state_setter_descriptor_for_symbol(setter_symbol_id, ctx)?;
    Some((setter_symbol_id, state_symbol_id))
}

fn state_setter_descriptor_for_symbol(
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<Option<SymbolId>> {
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let setter_binding = pattern
        .elements
        .get(1)
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)?;
    if setter_binding.symbol_id() != setter_symbol_id {
        return None;
    }
    let Expression::CallExpression(initializer) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    if !exhaustive_deps_is_react_api_call(initializer, "useState", ctx) {
        return None;
    }
    let state_symbol_id = pattern
        .elements
        .first()
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)
        .map(oxc_ast::ast::BindingIdentifier::symbol_id);
    Some(state_symbol_id)
}

fn is_provably_changing_functional_updater<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let (parameters, body) = match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => {
            let body = if let Some(expression) = function.get_expression() {
                expression
            } else {
                let Some(function_body) = function.get_function_body() else {
                    return false;
                };
                let [oxc_ast::ast::Statement::ReturnStatement(statement)] =
                    function_body.statements.as_slice()
                else {
                    return false;
                };
                let Some(expression) = statement.argument.as_ref() else {
                    return false;
                };
                expression
            };
            (function.params.as_ref(), body)
        }
        Expression::FunctionExpression(function) => {
            let Some(function_body) = function.body.as_ref() else {
                return false;
            };
            let [oxc_ast::ast::Statement::ReturnStatement(statement)] =
                function_body.statements.as_slice()
            else {
                return false;
            };
            let Some(expression) = statement.argument.as_ref() else {
                return false;
            };
            (function.params.as_ref(), expression)
        }
        _ => return false,
    };
    let Some(previous_value_symbol_id) = parameters
        .items
        .first()
        .and_then(|parameter| parameter.pattern.get_binding_identifier())
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
    else {
        return false;
    };
    is_fresh_equality_guard_updater(body, previous_value_symbol_id, ctx)
        || is_provably_changing_state_value(body, Some(previous_value_symbol_id), ctx)
}

fn is_provably_changing_state_value(
    expression: &Expression<'_>,
    previous_value_symbol_id: Option<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if is_guaranteed_fresh_state_value(expression, ctx, &mut FxHashSet::default()) {
        return true;
    }
    if let Expression::ConditionalExpression(conditional) = expression {
        let consequent = is_provably_changing_state_value(
            &conditional.consequent,
            previous_value_symbol_id,
            ctx,
        );
        let alternate =
            is_provably_changing_state_value(&conditional.alternate, previous_value_symbol_id, ctx);
        return if expression_reads_symbol(&conditional.test, previous_value_symbol_id, ctx) {
            consequent && alternate
        } else {
            consequent || alternate
        };
    }
    if !expression_reads_symbol(expression, previous_value_symbol_id, ctx) {
        return false;
    }
    match expression {
        Expression::UnaryExpression(unary) => unary.operator.as_str() == "!",
        Expression::UpdateExpression(_) => true,
        Expression::BinaryExpression(binary) => {
            matches!(binary.operator.as_str(), "+" | "-")
                && expression_reads_symbol(&binary.left, previous_value_symbol_id, ctx)
                && is_non_zero_literal(&binary.right)
        }
        _ => false,
    }
}

fn is_guaranteed_fresh_state_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ObjectExpression(_)
        | Expression::ArrayExpression(_)
        | Expression::JSXElement(_)
        | Expression::JSXFragment(_)
        | Expression::RegExpLiteral(_) => true,
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .is_some_and(|last| is_guaranteed_fresh_state_value(last, ctx, visited_symbol_ids)),
        Expression::ConditionalExpression(conditional) => {
            is_guaranteed_fresh_state_value(&conditional.consequent, ctx, visited_symbol_ids)
                && is_guaranteed_fresh_state_value(&conditional.alternate, ctx, visited_symbol_ids)
        }
        Expression::LogicalExpression(logical) => {
            is_guaranteed_fresh_state_value(&logical.left, ctx, visited_symbol_ids)
                && is_guaranteed_fresh_state_value(&logical.right, ctx, visited_symbol_ids)
        }
        Expression::CallExpression(call) => {
            matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if ctx.is_reference_to_global_variable(identifier)
                    && (identifier.name == "Array"
                        || (identifier.name == "Object" && call.arguments.is_empty())))
        }
        Expression::NewExpression(construction) => {
            matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier)
                if ctx.is_reference_to_global_variable(identifier)
                    && matches!(identifier.name.as_str(), "Array" | "Date" | "Error" | "Map" | "RegExp" | "Set" | "WeakMap" | "WeakSet")
                    || ctx.is_reference_to_global_variable(identifier)
                        && identifier.name == "Object"
                        && construction.arguments.is_empty())
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
                    .is_top()
            {
                return false;
            }
            let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
            else {
                return false;
            };
            let parent = ctx
                .nodes()
                .parent_node(ctx.symbol_declaration(symbol_id).id());
            matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    is_guaranteed_fresh_state_value(initializer, ctx, visited_symbol_ids)
                })
        }
        _ => false,
    }
}

fn expression_reads_symbol(
    expression: &Expression<'_>,
    target_symbol_id: Option<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(target_symbol_id) = target_symbol_id else {
        return false;
    };
    ctx.nodes().iter().any(|node| {
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return false;
        };
        if !expression.span().contains_inclusive(identifier.span) {
            return false;
        }
        let reference = ctx.scoping().get_reference(identifier.reference_id());
        !reference.is_write()
            && reference.symbol_id().is_some_and(|symbol_id| {
                resolve_stable_symbol_id(symbol_id, ctx, &mut FxHashSet::default())
                    == target_symbol_id
            })
    })
}

fn resolve_stable_symbol_id(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> SymbolId {
    if !visited_symbol_ids.insert(symbol_id) {
        return symbol_id;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return symbol_id;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return symbol_id;
    }
    let Some(Expression::Identifier(identifier)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return symbol_id;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .map_or(symbol_id, |source_symbol_id| {
            resolve_stable_symbol_id(source_symbol_id, ctx, visited_symbol_ids)
        })
}

fn is_non_zero_literal(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(literal) => literal.value != 0.0,
        Expression::BigIntLiteral(literal) => literal.value != "0",
        Expression::StringLiteral(literal) => !literal.value.is_empty(),
        _ => false,
    }
}

fn is_fresh_equality_guard_updater<'a>(
    expression: &Expression<'a>,
    previous_value_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::ConditionalExpression(conditional) = expression.get_inner_expression() else {
        return false;
    };
    let Expression::BinaryExpression(test) = conditional.test.get_inner_expression() else {
        return false;
    };
    if !matches!(test.operator.as_str(), "==" | "!=" | "===" | "!==") {
        return false;
    }
    let compared_value = if expression_is_symbol(&test.left, previous_value_symbol_id, ctx) {
        &test.right
    } else if expression_is_symbol(&test.right, previous_value_symbol_id, ctx) {
        &test.left
    } else {
        return false;
    };
    if !is_potentially_fresh_compared_value(compared_value, ctx, &mut FxHashSet::default()) {
        return false;
    }
    let equality = matches!(test.operator.as_str(), "==" | "===");
    let consequent_is_previous =
        expression_is_symbol(&conditional.consequent, previous_value_symbol_id, ctx);
    let alternate_is_previous =
        expression_is_symbol(&conditional.alternate, previous_value_symbol_id, ctx);
    let consequent_is_compared =
        expressions_reference_same_symbol(&conditional.consequent, compared_value, ctx);
    let alternate_is_compared =
        expressions_reference_same_symbol(&conditional.alternate, compared_value, ctx);
    if equality {
        consequent_is_previous && alternate_is_compared
    } else {
        consequent_is_compared && alternate_is_previous
    }
}

fn expression_is_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(symbol_id))
}

fn is_potentially_fresh_compared_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if is_expression_referentially_unique(expression, ctx) {
        return true;
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            is_potentially_fresh_compared_value(&conditional.consequent, ctx, visited_symbol_ids)
                || is_potentially_fresh_compared_value(
                    &conditional.alternate,
                    ctx,
                    visited_symbol_ids,
                )
        }
        Expression::LogicalExpression(logical) => {
            is_potentially_fresh_compared_value(&logical.left, ctx, visited_symbol_ids)
                || is_potentially_fresh_compared_value(&logical.right, ctx, visited_symbol_ids)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let AstKind::VariableDeclaration(variable) = parent.kind() else {
                return false;
            };
            if !variable.kind.is_const() {
                return true;
            }
            declarator.init.as_ref().is_some_and(|initializer| {
                is_potentially_fresh_compared_value(initializer, ctx, visited_symbol_ids)
            })
        }
        _ => false,
    }
}

impl ExhaustiveDeps {
    // https://github.com/facebook/react/blob/1b0132c05acabae5aebd32c2cadddfb16bda70bc/packages/eslint-plugin-react-hooks/src/ExhaustiveDeps.js#L1789
    fn get_reactive_hook_callback_index(
        &self,
        hook_name: &str,
        ctx: &LintContext<'_>,
    ) -> Option<usize> {
        match hook_name {
            "useEffect" | "useLayoutEffect" | "useInsertionEffect" | "useCallback" | "useMemo" => {
                Some(0)
            }
            "useImperativeHandle" => Some(1),
            _ => additional_hooks(ctx)
                .is_some_and(|regex| regex.is_match(hook_name))
                .then_some(0),
        }
    }
}

fn reactive_hook_name<'a, 'b>(
    call: &'b CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<Cow<'b, str>> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if let Some(entry) = resolve_identifier_import(identifier, ctx) {
                if !REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name()) {
                    return additional_hooks(ctx)
                        .is_some_and(|regex| regex.is_match(identifier.name.as_str()))
                        .then(|| Cow::Borrowed(identifier.name.as_str()));
                }
                let crate::module_record::ImportImportName::Name(imported_name) =
                    &entry.import_name
                else {
                    return None;
                };
                return Some(Cow::Owned(imported_name.name().to_string()));
            }
            if ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none()
            {
                return Some(Cow::Borrowed(identifier.name.as_str()));
            }
            additional_hooks(ctx)
                .is_some_and(|regex| regex.is_match(identifier.name.as_str()))
                .then(|| Cow::Borrowed(identifier.name.as_str()))
        }
        Expression::StaticMemberExpression(member)
            if member.property.name == "useEffect"
                || member.property.name == "useLayoutEffect"
                || member.property.name == "useInsertionEffect"
                || member.property.name == "useCallback"
                || member.property.name == "useMemo"
                || member.property.name == "useImperativeHandle" =>
        {
            let Expression::Identifier(receiver) = member.object.get_inner_expression() else {
                return None;
            };
            let is_global_react = receiver.name == "React"
                && ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_none();
            (is_global_react
                || resolve_identifier_import(receiver, ctx).is_some_and(|entry| {
                    REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
                        && matches!(
                            &entry.import_name,
                            crate::module_record::ImportImportName::NamespaceObject
                                | crate::module_record::ImportImportName::Default(_)
                        )
                }))
            .then(|| Cow::Borrowed(member.property.name.as_str()))
        }
        _ => None,
    }
}

fn exhaustive_deps_is_react_api_call<'a>(
    call: &CallExpression<'a>,
    expected_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if let Some(entry) = resolve_identifier_import(identifier, ctx) {
                let crate::module_record::ImportImportName::Name(imported_name) =
                    &entry.import_name
                else {
                    return false;
                };
                return REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
                    && imported_name.name() == expected_name;
            }
            identifier.name == expected_name
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        Expression::StaticMemberExpression(member) if member.property.name == expected_name => {
            let Expression::Identifier(receiver) = member.object.get_inner_expression() else {
                return false;
            };
            if receiver.name == "React"
                && ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_none()
            {
                return true;
            }
            resolve_identifier_import(receiver, ctx).is_some_and(|entry| {
                REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
                    && matches!(
                        &entry.import_name,
                        crate::module_record::ImportImportName::NamespaceObject
                            | crate::module_record::ImportImportName::Default(_)
                    )
            })
        }
        _ => false,
    }
}

fn call_name<'a, 'b>(call: &'b CallExpression<'a>) -> Option<&'b str> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        _ => None,
    }
}

fn report_forwarded_fresh_hook_dependencies<'a>(
    call_node: &AstNode<'a>,
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) {
    if !is_render_phase_component_or_hook_call(call_node, ctx) {
        return;
    }
    let Some(function_id) = forwarded_local_function_id(&call.callee, ctx, &mut Vec::new()) else {
        return;
    };
    let Some(parameters) = function_parameters(function_id, ctx) else {
        return;
    };
    for parameter in forwarded_parameter_bindings(parameters) {
        let Some((source, report_span)) = forwarded_parameter_source(call, &parameter, ctx) else {
            continue;
        };
        let Some(binding_name) =
            fresh_render_value_binding_name(source, parameter.binding.name.as_str(), ctx)
        else {
            continue;
        };
        if !parameter_reaches_hook_dependency(parameter.binding.symbol_id(), ctx) {
            continue;
        }
        if !is_exhaustive_deps_suppressed_at(report_span.start, ctx.source_text()) {
            ctx.diagnostic(forwarded_unstable_dependency_diagnostic(
                binding_name,
                report_span,
            ));
        }
    }
}

fn forwarded_local_function_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(_) => Some(declaration.id()),
                AstKind::VariableDeclarator(declarator) => {
                    let parent = ctx.nodes().parent_node(declaration.id());
                    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                    {
                        return None;
                    }
                    forwarded_local_function_id(declarator.init.as_ref()?, ctx, visited_symbol_ids)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

struct ForwardedParameterBinding<'a, 'b> {
    binding: &'b oxc_ast::ast::BindingIdentifier<'a>,
    default_value: Option<&'b Expression<'a>>,
    parameter_index: usize,
    property_name: Option<String>,
}

fn forwarded_parameter_bindings<'a, 'b>(
    parameters: &'b FormalParameters<'a>,
) -> Vec<ForwardedParameterBinding<'a, 'b>> {
    let mut bindings = Vec::new();
    for (parameter_index, parameter) in parameters.items.iter().enumerate() {
        match &parameter.pattern {
            BindingPattern::BindingIdentifier(binding) => {
                bindings.push(ForwardedParameterBinding {
                    binding,
                    default_value: None,
                    parameter_index,
                    property_name: None,
                })
            }
            BindingPattern::AssignmentPattern(assignment) => {
                if let BindingPattern::BindingIdentifier(binding) = &assignment.left {
                    bindings.push(ForwardedParameterBinding {
                        binding,
                        default_value: Some(&assignment.right),
                        parameter_index,
                        property_name: None,
                    });
                }
            }
            BindingPattern::ObjectPattern(object) => {
                for property in &object.properties {
                    let Some(property_name) = property.key.static_name() else {
                        continue;
                    };
                    let (binding, default_value) = match &property.value {
                        BindingPattern::BindingIdentifier(binding) => (binding, None),
                        BindingPattern::AssignmentPattern(assignment) => {
                            let BindingPattern::BindingIdentifier(binding) = &assignment.left
                            else {
                                continue;
                            };
                            (binding, Some(&assignment.right))
                        }
                        _ => continue,
                    };
                    bindings.push(ForwardedParameterBinding {
                        binding,
                        default_value,
                        parameter_index,
                        property_name: Some(property_name.to_string()),
                    });
                }
            }
            _ => {}
        }
    }
    bindings
}

fn forwarded_parameter_source<'a, 'b>(
    call: &'b CallExpression<'a>,
    parameter: &ForwardedParameterBinding<'a, 'b>,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b Expression<'a>, Span)> {
    let argument = match call.arguments.get(parameter.parameter_index) {
        Some(Argument::SpreadElement(_)) => return None,
        Some(argument) => argument.as_expression(),
        None => None,
    };
    if let Some(property_name) = &parameter.property_name {
        if let Some(argument) = argument {
            let object = resolve_const_object_expression(argument, ctx)?;
            if let Some(value) = get_static_object_property_value(object, property_name) {
                return Some((value, value.span()));
            }
            if matches!(object.get_inner_expression(), Expression::ObjectExpression(object) if object.properties.iter().any(|property| matches!(property, oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_))))
            {
                return None;
            }
        }
        return parameter
            .default_value
            .map(|default_value| (default_value, call.span()));
    }
    argument
        .map(|argument| (argument, argument.span()))
        .or_else(|| {
            parameter
                .default_value
                .map(|default_value| (default_value, call.span()))
        })
}

fn resolve_const_object_expression<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b Expression<'a>> {
    let mut current = expression.get_inner_expression();
    let mut visited = Vec::new();
    loop {
        if matches!(current, Expression::ObjectExpression(_)) {
            return Some(current);
        }
        let Expression::Identifier(identifier) = current else {
            return None;
        };
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if visited.contains(&symbol_id) {
            return None;
        }
        visited.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        current = declarator.init.as_ref()?.get_inner_expression();
    }
}

fn function_parameters<'a, 'b>(
    function_id: NodeId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b FormalParameters<'a>> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => Some(function.params.as_ref()),
        AstKind::ArrowFunctionExpression(function) => Some(function.params.as_ref()),
        _ => None,
    }
}

fn is_render_phase_component_or_hook_call<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(function) = get_enclosing_function(call_node, ctx) else {
        return false;
    };
    match function.kind() {
        AstKind::Function(function) => function.id.as_ref().is_some_and(|identifier| {
            identifier.name.starts_with("use")
                || identifier
                    .name
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
        }),
        AstKind::ArrowFunctionExpression(_) => {
            let parent = ctx.nodes().parent_node(function.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return false;
            };
            declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| {
                    binding.name.starts_with("use")
                        || binding
                            .name
                            .as_bytes()
                            .first()
                            .is_some_and(u8::is_ascii_uppercase)
                })
        }
        _ => false,
    }
}

fn fresh_render_value_binding_name<'a, 'b>(
    expression: &'b Expression<'a>,
    fallback_name: &'b str,
    ctx: &LintContext<'a>,
) -> Option<&'b str> {
    if is_fresh_render_value(expression) {
        return Some(fallback_name);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if ctx
        .scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
    {
        return None;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    declarator
        .init
        .as_ref()
        .is_some_and(is_fresh_render_value)
        .then_some(identifier.name.as_str())
}

fn is_fresh_render_value(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::JSXElement(_)
            | Expression::JSXFragment(_)
            | Expression::NewExpression(_)
    )
}

fn parameter_reaches_hook_dependency(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    if ctx
        .semantic()
        .symbol_references(symbol_id)
        .any(|reference| {
            reference.is_write() || reference_mutates_collection(reference.node_id(), ctx)
        })
    {
        return false;
    }
    ctx.semantic()
        .symbol_references(symbol_id)
        .any(|reference| {
            let identifier = ctx.nodes().get_node(reference.node_id());
            let array = ctx.nodes().parent_node(identifier.id());
            if !matches!(array.kind(), AstKind::ArrayExpression(_)) {
                return false;
            }
            let call = ctx.nodes().parent_node(array.id());
            let AstKind::CallExpression(call_expression) = call.kind() else {
                return false;
            };
            let Some(hook_name) = reactive_hook_name(call_expression, ctx) else {
                return false;
            };
            let Some(callback_index) =
                ExhaustiveDeps.get_reactive_hook_callback_index(&hook_name, ctx)
            else {
                return false;
            };
            call_expression
                .arguments
                .get(callback_index + 1)
                .is_some_and(|argument| argument.span() == array.span())
        })
}

fn reference_mutates_collection(reference_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let reference = ctx.nodes().get_node(reference_id);
    let member = ctx.nodes().parent_node(reference.id());
    let AstKind::StaticMemberExpression(member_expression) = member.kind() else {
        return false;
    };
    if member_expression.object.span() != reference.span()
        || !matches!(
            member_expression.property.name.as_str(),
            "copyWithin"
                | "fill"
                | "pop"
                | "push"
                | "reverse"
                | "shift"
                | "sort"
                | "splice"
                | "unshift"
                | "add"
                | "clear"
                | "delete"
                | "set"
        )
    {
        return false;
    }
    matches!(ctx.nodes().parent_node(member.id()).kind(), AstKind::CallExpression(call) if call.callee.span() == member.span())
}

fn additional_hooks(ctx: &LintContext<'_>) -> Option<Regex> {
    let settings = ctx.settings().json.as_ref();
    let react_doctor = settings
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("exhaustiveDeps"));
    let react_hooks = settings.and_then(|settings| settings.get("react-hooks"));
    let pattern = react_doctor
        .and_then(|settings| settings.get("additionalHooks"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            react_doctor
                .and_then(|settings| settings.get("additionalEffectHooks"))
                .and_then(serde_json::Value::as_str)
        })
        .or_else(|| {
            react_hooks
                .and_then(|settings| settings.get("additionalHooks"))
                .and_then(serde_json::Value::as_str)
        })
        .or_else(|| {
            react_hooks
                .and_then(|settings| settings.get("additionalEffectHooks"))
                .and_then(serde_json::Value::as_str)
        })?;
    Regex::new(pattern).ok()
}

fn is_auto_dependencies_hook(hook_name: &str, ctx: &LintContext<'_>) -> bool {
    let settings = ctx.settings().json.as_ref();
    settings
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("exhaustiveDeps"))
        .and_then(|settings| settings.get("experimental_autoDependenciesHooks"))
        .and_then(serde_json::Value::as_array)
        .or_else(|| {
            settings
                .and_then(|settings| settings.get("react-hooks"))
                .and_then(|settings| settings.get("experimental_autoDependenciesHooks"))
                .and_then(serde_json::Value::as_array)
        })
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .any(|configured_hook| configured_hook == hook_name)
}

fn require_explicit_effect_deps(ctx: &LintContext<'_>) -> bool {
    let settings = ctx.settings().json.as_ref();
    settings
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("exhaustiveDeps"))
        .and_then(|settings| settings.get("requireExplicitEffectDeps"))
        .and_then(serde_json::Value::as_bool)
        .or_else(|| {
            settings
                .and_then(|settings| settings.get("react-hooks"))
                .and_then(|settings| settings.get("requireExplicitEffectDeps"))
                .and_then(serde_json::Value::as_bool)
        })
        .unwrap_or(false)
}

fn is_exhaustive_deps_suppressed_at(offset: u32, source: &str) -> bool {
    let line_start = source[..offset as usize]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    let line_end = source[offset as usize..]
        .find('\n')
        .map_or(source.len(), |index| offset as usize + index);
    if exhaustive_deps_disable_directive_names_rule(&source[line_start..line_end], "disable-line") {
        return true;
    }
    if line_start == 0 {
        return false;
    }
    let previous_line_end = line_start - 1;
    let previous_line_start = source[..previous_line_end]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    exhaustive_deps_disable_directive_names_rule(
        &source[previous_line_start..previous_line_end],
        "disable-next-line",
    )
}

fn exhaustive_deps_disable_directive_names_rule(line: &str, directive: &str) -> bool {
    let Some(directive_index) = line
        .find(&format!("eslint-{directive}"))
        .or_else(|| line.find(&format!("oxlint-{directive}")))
    else {
        return false;
    };
    line[directive_index + directive.len() + "eslint-".len()..]
        .split(|character: char| character.is_whitespace() || character == ',')
        .map(|part| part.trim_matches(|character: char| matches!(character, ':' | ';')))
        .any(|part| matches!(part, "exhaustive-deps" | "react-hooks/exhaustive-deps"))
}

#[derive(Debug, Clone)]
struct Name<'a> {
    pub span: Span,
    pub name: Cow<'a, str>,
}
impl std::fmt::Display for Name<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.name.fmt(f)
    }
}

impl<'a> From<&Dependency<'a>> for Name<'a> {
    fn from(dep: &Dependency<'a>) -> Self {
        let name = if dep.chain.is_empty() {
            Cow::Borrowed(dep.name.as_str())
        } else {
            Cow::Owned(dep.to_string())
        };
        Self {
            name,
            span: dep.span,
        }
    }
}
impl<'a> From<&IdentifierReference<'a>> for Name<'a> {
    fn from(id: &IdentifierReference<'a>) -> Self {
        Self {
            name: Cow::Borrowed(id.name.as_str()),
            span: id.span,
        }
    }
}

#[derive(Debug)]
struct Dependency<'a> {
    span: Span,
    name: Str<'a>,
    reference_id: ReferenceId,
    // the symbol id that this dependency is referring to
    symbol_id: Option<SymbolId>,
    chain: Vec<Str<'a>>,
}

impl Hash for Dependency<'_> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.name.hash(state);
        self.chain.hash(state);
        self.symbol_id.hash(state);
    }
}

impl PartialEq for Dependency<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name && self.chain == other.chain && self.symbol_id == other.symbol_id
    }
}

impl Eq for Dependency<'_> {}

impl Dependency<'_> {
    #[expect(clippy::inherent_to_string)]
    fn to_string(&self) -> String {
        std::iter::once(&self.name)
            .chain(self.chain.iter())
            .map(Str::as_str)
            .join(".")
    }

    fn contains(&self, other: &Self) -> bool {
        self.name == other.name && chain_contains(&self.chain, &other.chain)
    }
}

fn first_destructured_property_path<'a>(pattern: &'a BindingPattern<'a>) -> Option<Vec<Str<'a>>> {
    let BindingPattern::ObjectPattern(object) = pattern else {
        return None;
    };
    let property = object.properties.first()?;
    let property_name: Str<'a> = match &property.key {
        PropertyKey::StaticIdentifier(identifier) => Str::from(identifier.name.as_str()),
        PropertyKey::Identifier(identifier) => Str::from(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Str::from(literal.value.as_str()),
        _ => return None,
    };
    let mut path = vec![property_name];
    if let Some(nested_path) = first_destructured_property_path(&property.value) {
        path.extend(nested_path);
    }
    Some(path)
}

fn destructured_property_path_for_reference<'a>(
    reference_id: ReferenceId,
    semantic: &Semantic<'a>,
) -> Option<Vec<Str<'a>>> {
    let mut current = semantic
        .nodes()
        .get_node(semantic.scoping().get_reference(reference_id).node_id());
    loop {
        let parent = semantic.nodes().parent_node(current.id());
        let is_chain_object = match parent.kind() {
            AstKind::StaticMemberExpression(member) => member.object.span() == current.span(),
            AstKind::ComputedMemberExpression(member) => member.object.span() == current.span(),
            AstKind::ChainExpression(chain) => chain.expression.span() == current.span(),
            AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::ParenthesizedExpression(_) => parent.span() == current.span(),
            _ => false,
        };
        if !is_chain_object {
            break;
        }
        current = parent;
    }
    let AstKind::VariableDeclarator(declarator) = semantic.nodes().parent_node(current.id()).kind()
    else {
        return None;
    };
    declarator
        .init
        .as_ref()
        .filter(|initializer| initializer.span() == current.span())
        .and_then(|_| first_destructured_property_path(&declarator.id))
}

fn replace_derived_dependencies<'a>(
    found_dependencies: &mut FxHashSet<Dependency<'a>>,
    declared_dependencies: &FxHashSet<Dependency<'a>>,
    ctx: &LintContext<'a>,
    component_scope_id: ScopeId,
) {
    let mut pending = std::mem::take(found_dependencies);
    let mut rewritten = FxHashSet::default();
    let mut remaining_passes = pending.len().saturating_add(1);
    while remaining_passes > 0 {
        remaining_passes -= 1;
        let mut did_rewrite = false;
        let mut ordered_pending = pending.drain().collect::<Vec<_>>();
        ordered_pending
            .sort_unstable_by_key(|dependency| (dependency.span.start, dependency.span.end));
        for dependency in ordered_pending {
            let source_dependencies = (!declared_dependencies.contains(&dependency)
                && dependency.chain.is_empty())
            .then(|| derived_source_dependencies(&dependency, ctx, component_scope_id))
            .flatten();
            if let Some(source_dependencies) = source_dependencies {
                let mut source_dependencies = source_dependencies.into_iter().collect::<Vec<_>>();
                source_dependencies.sort_unstable_by_key(|source| source.span.start);
                for (source_index, mut source_dependency) in
                    source_dependencies.into_iter().enumerate()
                {
                    source_dependency.span = Span::new(
                        dependency.span.start,
                        dependency.span.start.saturating_add(source_index as u32),
                    );
                    rewritten.insert(source_dependency);
                }
                did_rewrite = true;
            } else {
                rewritten.insert(dependency);
            }
        }
        if !did_rewrite {
            break;
        }
        pending = std::mem::take(&mut rewritten);
    }
    rewritten.extend(pending);
    *found_dependencies = rewritten;
}

fn derived_source_dependencies<'a>(
    dependency: &Dependency<'a>,
    ctx: &LintContext<'a>,
    component_scope_id: ScopeId,
) -> Option<FxHashSet<Dependency<'a>>> {
    let symbol_id = dependency.symbol_id?;
    if let Some(dependencies) = pure_called_function_dependencies(dependency, symbol_id, ctx) {
        return Some(dependencies);
    }
    if let Some(dependencies) = render_derived_mutable_dependencies(dependency, symbol_id, ctx) {
        return Some(dependencies);
    }
    if ctx.scoping().symbol_scope_id(symbol_id) != component_scope_id
        || ctx
            .semantic()
            .symbol_references(symbol_id)
            .any(|reference| reference.is_write())
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let Some(declarator_node) = std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .take_while(|owner| {
            !matches!(
                owner.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find(|owner| matches!(owner.kind(), AstKind::VariableDeclarator(_)))
    else {
        return None;
    };
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        unreachable!();
    };
    let parent = ctx.nodes().parent_node(declarator_node.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let initializer = declarator.init.as_ref()?;
    if !is_identity_derived_expression(initializer) {
        return None;
    }
    let mut visitor = ExhaustiveDepsVisitor::new(ctx.semantic());
    visitor.visit_expression(initializer);
    if visitor
        .found_dependencies
        .iter()
        .any(|source| source.symbol_id.is_none())
    {
        return None;
    }
    visitor
        .found_dependencies
        .retain(|source| source.symbol_id != Some(symbol_id));
    Some(visitor.found_dependencies)
}

fn render_derived_mutable_dependencies<'a>(
    dependency: &Dependency<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<FxHashSet<Dependency<'a>>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let Some(declarator_node) = std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .take_while(|owner| {
            !matches!(
                owner.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find(|owner| matches!(owner.kind(), AstKind::VariableDeclarator(_)))
    else {
        return None;
    };
    let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
        unreachable!();
    };
    let parent = ctx.nodes().parent_node(declarator_node.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind == VariableDeclarationKind::Let)
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let boundary_function = get_enclosing_function(declarator_node, ctx)?;
    let captured_reference = ctx.nodes().get_node(
        ctx.scoping()
            .get_reference(dependency.reference_id)
            .node_id(),
    );
    let capturing_function = get_enclosing_function(captured_reference, ctx)?;
    if capturing_function.id() == boundary_function.id() {
        return None;
    }
    let mut dependencies = FxHashSet::default();
    if let Some(initializer) = &declarator.init {
        if !is_mutable_derived_expression(initializer, ctx) {
            return None;
        }
        collect_expression_dependencies(initializer, symbol_id, ctx, &mut dependencies);
    }
    let mut write_count = 0;
    for reference in ctx.semantic().symbol_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if !reference.is_write() {
            if capturing_function
                .span()
                .contains_inclusive(reference_node.span())
                || is_read_only_initial_state_argument(reference_node, ctx)
            {
                continue;
            }
            return None;
        }
        let reference_root = transparent_expression_root(reference_node, ctx);
        let assignment_node = ctx.nodes().parent_node(reference_root.id());
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            return None;
        };
        if assignment.operator.as_str() != "="
            || assignment.left.span() != reference_root.span()
            || get_enclosing_function(assignment_node, ctx).map(AstNode::id)
                != Some(boundary_function.id())
            || !is_mutable_derived_expression(&assignment.right, ctx)
        {
            return None;
        }
        collect_expression_dependencies(&assignment.right, symbol_id, ctx, &mut dependencies);
        if !collect_assignment_control_dependencies(
            assignment_node,
            boundary_function,
            symbol_id,
            ctx,
            &mut dependencies,
        ) {
            return None;
        }
        write_count += 1;
    }
    (write_count > 0 && !dependencies.is_empty()).then_some(dependencies)
}

fn is_read_only_initial_state_argument<'a>(reference: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let reference_root = transparent_expression_root(reference, ctx);
    let call_node = ctx.nodes().parent_node(reference_root.id());
    let AstKind::CallExpression(call) = call_node.kind() else {
        return false;
    };
    call.arguments
        .iter()
        .any(|argument| argument.span() == reference_root.span())
        && exhaustive_deps_is_react_api_call(call, "useState", ctx)
}

fn is_mutable_derived_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    if is_identity_derived_expression(expression) {
        return true;
    }
    let Expression::NewExpression(new_expression) = expression.get_inner_expression() else {
        return false;
    };
    let Expression::Identifier(callee) = new_expression.callee.get_inner_expression() else {
        return false;
    };
    callee.name == "Error"
        && ctx.is_reference_to_global_variable(callee)
        && new_expression.arguments.iter().all(|argument| {
            argument
                .as_expression()
                .is_some_and(is_pure_derived_expression)
        })
}

fn collect_expression_dependencies<'a>(
    expression: &Expression<'a>,
    excluded_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    dependencies: &mut FxHashSet<Dependency<'a>>,
) {
    let mut visitor = ExhaustiveDepsVisitor::new(ctx.semantic());
    visitor.visit_expression(expression);
    visitor
        .found_dependencies
        .retain(|dependency| dependency.symbol_id != Some(excluded_symbol_id));
    dependencies.extend(visitor.found_dependencies);
}

fn collect_assignment_control_dependencies<'a>(
    assignment: &AstNode<'a>,
    boundary_function: &AstNode<'a>,
    excluded_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    dependencies: &mut FxHashSet<Dependency<'a>>,
) -> bool {
    let mut current = assignment;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == boundary_function.id() {
            return true;
        }
        match parent.kind() {
            AstKind::ExpressionStatement(_) | AstKind::BlockStatement(_) => {}
            AstKind::IfStatement(statement) => {
                if statement.test.span() == current.span() {
                    return false;
                }
                if !is_mutable_derived_expression(&statement.test, ctx) {
                    return false;
                }
                collect_expression_dependencies(
                    &statement.test,
                    excluded_symbol_id,
                    ctx,
                    dependencies,
                );
            }
            _ => return false,
        }
        current = parent;
    }
}

fn pure_called_function_dependencies<'a>(
    dependency: &Dependency<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<FxHashSet<Dependency<'a>>> {
    if ctx
        .semantic()
        .symbol_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let reference = ctx.nodes().get_node(
        ctx.scoping()
            .get_reference(dependency.reference_id)
            .node_id(),
    );
    let reference_root = transparent_expression_root(reference, ctx);
    let call_node = ctx.nodes().parent_node(reference_root.id());
    let AstKind::CallExpression(call) = call_node.kind() else {
        return None;
    };
    if call.callee.span() != reference_root.span() {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let (body, is_pure) = match declaration.kind() {
        AstKind::Function(function) if !function.r#async && !function.generator => {
            let body = function.body.as_deref()?;
            (CallbackBody::Function(body), pure_function_body(body))
        }
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::FunctionExpression(function)
                    if !function.r#async && !function.generator =>
                {
                    let body = function.body.as_deref()?;
                    (CallbackBody::Function(body), pure_function_body(body))
                }
                Expression::ArrowFunctionExpression(function) if !function.r#async => {
                    let is_pure = match &function.body {
                        ArrowFunctionBody::FunctionBody(body) => pure_function_body(body),
                        expression @ match_expression!(ArrowFunctionBody) => {
                            is_pure_derived_expression(expression.to_expression())
                        }
                    };
                    (CallbackBody::Arrow(&function.body), is_pure)
                }
                _ => return None,
            }
        }
        _ => return None,
    };
    if !is_pure {
        return None;
    }
    let mut visitor = ExhaustiveDepsVisitor::new(ctx.semantic());
    body.visit(&mut visitor);
    visitor
        .found_dependencies
        .retain(|source| source.symbol_id != Some(symbol_id));
    (!visitor.found_dependencies.is_empty()).then_some(visitor.found_dependencies)
}

fn pure_function_body(body: &FunctionBody<'_>) -> bool {
    body.directives.is_empty() && body.statements.iter().all(pure_function_statement)
}

fn pure_function_statement(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::BlockStatement(block) => {
            block.body.iter().all(pure_function_statement)
        }
        oxc_ast::ast::Statement::ReturnStatement(statement) => statement
            .argument
            .as_ref()
            .is_none_or(is_pure_derived_expression),
        oxc_ast::ast::Statement::IfStatement(statement) => {
            is_pure_derived_expression(&statement.test)
                && pure_function_statement(&statement.consequent)
                && statement
                    .alternate
                    .as_ref()
                    .is_none_or(pure_function_statement)
        }
        _ => false,
    }
}

fn is_pure_derived_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        expression if expression.is_literal() => true,
        Expression::Identifier(_) => true,
        Expression::StaticMemberExpression(member) => is_pure_derived_expression(&member.object),
        Expression::ComputedMemberExpression(member) => {
            is_pure_derived_expression(&member.object)
                && is_pure_derived_expression(&member.expression)
        }
        Expression::BinaryExpression(binary) => {
            is_pure_derived_expression(&binary.left) && is_pure_derived_expression(&binary.right)
        }
        Expression::LogicalExpression(logical) => {
            is_pure_derived_expression(&logical.left) && is_pure_derived_expression(&logical.right)
        }
        Expression::UnaryExpression(unary) => {
            unary.operator.as_str() != "delete" && is_pure_derived_expression(&unary.argument)
        }
        Expression::ConditionalExpression(conditional) => {
            is_pure_derived_expression(&conditional.test)
                && is_pure_derived_expression(&conditional.consequent)
                && is_pure_derived_expression(&conditional.alternate)
        }
        Expression::TemplateLiteral(template) => {
            template.expressions.iter().all(is_pure_derived_expression)
        }
        _ => false,
    }
}

fn is_identity_derived_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::Identifier(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::StaticMemberExpression(member) => {
            static_member_root_is_identifier(&member.object)
        }
        Expression::ChainExpression(chain) => {
            matches!(
                &chain.expression,
                ChainElement::StaticMemberExpression(member)
                    if static_member_root_is_identifier(&member.object)
            ) || matches!(
                &chain.expression,
                ChainElement::TSNonNullExpression(non_null)
                    if is_identity_derived_expression(&non_null.expression)
            )
        }
        Expression::LogicalExpression(logical) => {
            is_identity_derived_expression(&logical.left)
                && is_identity_derived_expression(&logical.right)
        }
        Expression::ConditionalExpression(conditional) => {
            is_identity_derived_expression(&conditional.test)
                && is_identity_derived_expression(&conditional.consequent)
                && is_identity_derived_expression(&conditional.alternate)
        }
        _ => false,
    }
}

fn static_member_root_is_identifier(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(_) => true,
        Expression::StaticMemberExpression(member) => {
            static_member_root_is_identifier(&member.object)
        }
        Expression::ChainExpression(chain) => {
            matches!(
                &chain.expression,
                ChainElement::StaticMemberExpression(member)
                    if static_member_root_is_identifier(&member.object)
            ) || matches!(
                &chain.expression,
                ChainElement::TSNonNullExpression(non_null)
                    if static_member_root_is_identifier(&non_null.expression)
            )
        }
        _ => false,
    }
}

fn is_boolean_guard_dependency(dependency: &Dependency<'_>, ctx: &LintContext<'_>) -> bool {
    let reference = ctx.nodes().get_node(
        ctx.scoping()
            .get_reference(dependency.reference_id)
            .node_id(),
    );
    let mut current = transparent_expression_root(reference, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::IfStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::WhileStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::DoWhileStatement(statement) if statement.test.span() == current.span() => {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if expression.test.span() == current.span() =>
            {
                return true;
            }
            AstKind::UnaryExpression(expression) if expression.operator.as_str() == "!" => {
                current = parent;
            }
            AstKind::LogicalExpression(_) => {
                current = parent;
            }
            _ => return false,
        }
    }
}

fn contains_computed_member(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ComputedMemberExpression(_) => true,
        Expression::StaticMemberExpression(member) => contains_computed_member(&member.object),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::ComputedMemberExpression(_) => true,
            ChainElement::StaticMemberExpression(member) => {
                contains_computed_member(&member.object)
            }
            ChainElement::PrivateFieldExpression(member) => {
                contains_computed_member(&member.object)
            }
            ChainElement::CallExpression(_) => false,
            ChainElement::TSNonNullExpression(non_null) => {
                contains_computed_member(&non_null.expression)
            }
        },
        Expression::BinaryExpression(binary) => {
            contains_computed_member(&binary.left) || contains_computed_member(&binary.right)
        }
        Expression::LogicalExpression(logical) => {
            contains_computed_member(&logical.left) || contains_computed_member(&logical.right)
        }
        Expression::UnaryExpression(unary) => contains_computed_member(&unary.argument),
        Expression::ConditionalExpression(conditional) => {
            contains_computed_member(&conditional.test)
                || contains_computed_member(&conditional.consequent)
                || contains_computed_member(&conditional.alternate)
        }
        Expression::TemplateLiteral(template) => {
            template.expressions.iter().any(contains_computed_member)
        }
        _ => false,
    }
}

fn add_aggregate_props_dependency<'a>(
    found_dependencies: &mut FxHashSet<Dependency<'a>>,
    declared_dependencies: &FxHashSet<Dependency<'a>>,
    callback: &CallbackNode<'a>,
    curated_behavior: bool,
    ctx: &LintContext<'a>,
) {
    let props_dependencies = found_dependencies
        .iter()
        .filter(|dependency| dependency.name == "props" && !dependency.chain.is_empty())
        .collect::<Vec<_>>();
    if props_dependencies.len() < 2
        || declared_dependencies
            .iter()
            .any(|dependency| dependency.name == "props" && dependency.chain.is_empty())
    {
        return;
    }
    let all_props_dependencies_are_covered = props_dependencies.iter().all(|capture| {
        declared_dependencies
            .iter()
            .any(|declared| capture.contains(declared))
    });
    if curated_behavior && all_props_dependencies_are_covered {
        return;
    }
    let props_symbol_id = props_dependencies
        .first()
        .and_then(|dependency| dependency.symbol_id);
    if !callback_has_props_member_call(callback.span(), props_symbol_id, ctx) {
        return;
    }
    let first_name = props_dependencies[0].name.clone();
    let first_reference_id = props_dependencies[0].reference_id;
    let first_symbol_id = props_dependencies[0].symbol_id;
    found_dependencies.insert(Dependency {
        span: Span::new(callback.span().end, callback.span().end),
        name: first_name,
        reference_id: first_reference_id,
        symbol_id: first_symbol_id,
        chain: Vec::new(),
    });
}

fn callback_has_props_member_call(
    callback_span: Span,
    props_symbol_id: Option<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(props_symbol_id) = props_symbol_id else {
        return false;
    };
    ctx.nodes().iter().any(|node| {
        if !callback_span.contains_inclusive(node.span()) {
            return false;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            return false;
        };
        let mut object = member.object();
        loop {
            let Some(nested_member) = object.get_inner_expression().as_member_expression() else {
                break;
            };
            if nested_member.static_property_name() == Some("current") {
                return false;
            }
            object = nested_member.object();
        }
        let Expression::Identifier(root) = object.get_inner_expression() else {
            return false;
        };
        ctx.scoping().get_reference(root.reference_id()).symbol_id() == Some(props_symbol_id)
    })
}

fn remove_sole_writer_guard_dependencies<'a>(
    found_dependencies: &mut FxHashSet<Dependency<'a>>,
    callback: &CallbackNode<'a>,
    ctx: &LintContext<'a>,
) {
    found_dependencies.retain(|dependency| {
        dependency.chain.len() > 0
            || !dependency.symbol_id.is_some_and(|symbol_id| {
                is_sole_writer_guard_capture(symbol_id, callback.span(), ctx)
            })
    });
}

fn is_sole_writer_guard_capture(
    state_symbol_id: SymbolId,
    callback_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    if ctx
        .semantic()
        .symbol_references(state_symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(state_symbol_id).kind()
    else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(Some(BindingPattern::BindingIdentifier(state_binding))) = pattern.elements.first()
    else {
        return false;
    };
    let Some(Some(BindingPattern::BindingIdentifier(setter_binding))) = pattern.elements.get(1)
    else {
        return false;
    };
    if state_binding.symbol_id() != state_symbol_id {
        return false;
    }
    let Some(Expression::CallExpression(initializer)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !exhaustive_deps_is_react_api_call(initializer, "useState", ctx) {
        return false;
    }
    let state_references = ctx
        .semantic()
        .symbol_references(state_symbol_id)
        .filter(|reference| {
            callback_span.contains_inclusive(ctx.nodes().get_node(reference.node_id()).span())
        })
        .collect::<Vec<_>>();
    if state_references.len() != 1 {
        return false;
    }
    let state_reference = ctx.nodes().get_node(state_references[0].node_id());
    let state_root = transparent_expression_root(state_reference, ctx);
    if matches!(
        ctx.nodes().parent_node(state_root.id()).kind(),
        AstKind::StaticMemberExpression(member) if member.object.span() == state_root.span()
    ) {
        return false;
    }
    let setter_references = ctx
        .semantic()
        .symbol_references(setter_binding.symbol_id())
        .collect::<Vec<_>>();
    if setter_references.len() != 1 {
        return false;
    }
    let setter_reference = ctx.nodes().get_node(setter_references[0].node_id());
    if !callback_span.contains_inclusive(setter_reference.span()) {
        return false;
    }
    let setter_root = transparent_expression_root(setter_reference, ctx);
    let setter_call_node = ctx.nodes().parent_node(setter_root.id());
    let AstKind::CallExpression(setter_call) = setter_call_node.kind() else {
        return false;
    };
    if setter_call.callee.span() != setter_root.span() || setter_call.arguments.len() != 1 {
        return false;
    }
    let Some(written_value) = setter_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let Some((comparison_node, counterpart, equal_when_truthy)) =
        sole_writer_equality(state_root, callback_span, ctx)
    else {
        return false;
    };
    if !sole_writer_values_match(counterpart, written_value, ctx) {
        return false;
    }
    sole_writer_guard_controls_setter(
        comparison_node,
        !equal_when_truthy,
        setter_call_node,
        callback_span,
        ctx,
    )
}

fn sole_writer_equality<'a, 'b>(
    state_root: &'b AstNode<'a>,
    callback_span: Span,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b AstNode<'a>, &'b Expression<'a>, bool)> {
    let mut current = ctx.nodes().parent_node(state_root.id());
    while callback_span.contains_inclusive(current.span()) {
        match current.kind() {
            AstKind::BinaryExpression(binary)
                if matches!(binary.operator.as_str(), "===" | "!==") =>
            {
                if binary.left.span() == state_root.span() {
                    return Some((current, &binary.right, binary.operator.as_str() == "==="));
                }
                if binary.right.span() == state_root.span() {
                    return Some((current, &binary.left, binary.operator.as_str() == "==="));
                }
            }
            AstKind::CallExpression(call) if call.arguments.len() == 2 => {
                let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression()
                else {
                    current = ctx.nodes().parent_node(current.id());
                    continue;
                };
                let Expression::Identifier(object) = member.object.get_inner_expression() else {
                    current = ctx.nodes().parent_node(current.id());
                    continue;
                };
                if member.property.name == "is"
                    && object.name == "Object"
                    && ctx.is_reference_to_global_variable(object)
                {
                    let first = call.arguments[0].as_expression()?;
                    let second = call.arguments[1].as_expression()?;
                    if first.span() == state_root.span() {
                        return Some((current, second, true));
                    }
                    if second.span() == state_root.span() {
                        return Some((current, first, true));
                    }
                }
            }
            _ => {}
        }
        current = ctx.nodes().parent_node(current.id());
    }
    None
}

fn sole_writer_values_match<'a>(
    left: &Expression<'a>,
    right: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let left = resolve_const_identifier_expression(left, ctx);
    let right = resolve_const_identifier_expression(right, ctx);
    if left.span() == right.span() {
        return true;
    }
    match (left.get_inner_expression(), right.get_inner_expression()) {
        (Expression::Identifier(left), Expression::Identifier(right)) => {
            let left_symbol = ctx.scoping().get_reference(left.reference_id()).symbol_id();
            let right_symbol = ctx
                .scoping()
                .get_reference(right.reference_id())
                .symbol_id();
            left_symbol == right_symbol && (left_symbol.is_some() || left.name == right.name)
        }
        (Expression::BooleanLiteral(left), Expression::BooleanLiteral(right)) => {
            left.value == right.value
        }
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::NumericLiteral(left), Expression::NumericLiteral(right)) => {
            (left.value.is_nan() && right.value.is_nan())
                || left.value.to_bits() == right.value.to_bits()
        }
        (Expression::BigIntLiteral(left), Expression::BigIntLiteral(right)) => {
            left.value == right.value
        }
        (Expression::StringLiteral(left), Expression::StringLiteral(right)) => {
            left.value == right.value
        }
        _ => false,
    }
}

fn resolve_const_identifier_expression<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b Expression<'a> {
    let mut current = expression.get_inner_expression();
    let mut visited = Vec::new();
    while let Expression::Identifier(identifier) = current {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            break;
        };
        if visited.contains(&symbol_id) {
            break;
        }
        visited.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            break;
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            break;
        }
        let Some(initializer) = &declarator.init else {
            break;
        };
        current = initializer.get_inner_expression();
    }
    current
}

fn sole_writer_guard_controls_setter(
    comparison: &AstNode<'_>,
    mut different_outcome: bool,
    setter_call: &AstNode<'_>,
    callback_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = comparison;
    while callback_span.contains_inclusive(current.span()) {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::UnaryExpression(unary) if unary.operator.as_str() == "!" => {
                different_outcome = !different_outcome;
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_) => {}
            AstKind::LogicalExpression(logical) => match logical.operator.as_str() {
                "&&" if different_outcome => {}
                "||" if !different_outcome => {}
                _ => return false,
            },
            AstKind::IfStatement(statement) => {
                if !statement.test.span().contains_inclusive(comparison.span()) {
                    return false;
                }
                let setter_on_truthy = statement
                    .consequent
                    .span()
                    .contains_inclusive(setter_call.span());
                let setter_on_falsey =
                    statement.alternate.as_ref().is_some_and(|alternate| {
                        alternate.span().contains_inclusive(setter_call.span())
                    }) || sole_writer_guard_exits_before_setter(parent, setter_call, ctx);
                return setter_on_truthy != setter_on_falsey
                    && different_outcome == setter_on_truthy;
            }
            _ => return false,
        }
        current = parent;
    }
    false
}

fn sole_writer_guard_exits_before_setter(
    guard: &AstNode<'_>,
    setter_call: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::IfStatement(statement) = guard.kind() else {
        return false;
    };
    if statement.alternate.is_some() || !sole_writer_branch_exits(&statement.consequent) {
        return false;
    }
    let block = ctx.nodes().parent_node(guard.id());
    let AstKind::BlockStatement(block) = block.kind() else {
        return false;
    };
    let guard_index = block
        .body
        .iter()
        .position(|statement| statement.span() == guard.span());
    guard_index.is_some_and(|guard_index| {
        block
            .body
            .iter()
            .skip(guard_index + 1)
            .any(|statement| statement.span().contains_inclusive(setter_call.span()))
    })
}

fn sole_writer_branch_exits(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(_)
        | oxc_ast::ast::Statement::ThrowStatement(_) => true,
        oxc_ast::ast::Statement::BlockStatement(block) => {
            block.body.last().is_some_and(sole_writer_branch_exits)
        }
        _ => false,
    }
}

fn chain_contains(a: &[Str<'_>], b: &[Str<'_>]) -> bool {
    for (index, part) in b.iter().enumerate() {
        let Some(other) = a.get(index) else {
            return false;
        };
        if other != part {
            return false;
        }
    }

    true
}

fn analyze_property_chain<'a, 'b>(
    expr: &'b Expression<'a>,
    semantic: &'b Semantic<'a>,
) -> Result<Option<Dependency<'a>>, ()> {
    match expr.get_inner_expression() {
        Expression::Identifier(ident) => Ok(Some(Dependency {
            span: ident.span(),
            name: ident.name.into(),
            reference_id: ident.reference_id(),
            chain: vec![],
            symbol_id: semantic
                .scoping()
                .get_reference(ident.reference_id())
                .symbol_id(),
        })),
        // TODO; is this correct?
        Expression::JSXElement(_) => Ok(None),
        Expression::StaticMemberExpression(expr) => concat_members(expr, semantic),
        Expression::ComputedMemberExpression(expr) => {
            analyze_property_chain(&expr.object, semantic)
        }
        Expression::ChainExpression(chain_expr) => match &chain_expr.expression {
            ChainElement::StaticMemberExpression(expr) => concat_members(expr, semantic),
            _ => Err(()),
        },
        _ => Err(()),
    }
}

fn concat_members<'a, 'b>(
    member_expr: &'b StaticMemberExpression<'a>,
    semantic: &'b Semantic<'a>,
) -> Result<Option<Dependency<'a>>, ()> {
    let Some(source) = analyze_property_chain(&member_expr.object, semantic)? else {
        return Ok(None);
    };

    let new_chain = Vec::from([Str::from(member_expr.property.name)]);

    Ok(Some(Dependency {
        span: member_expr.span,
        name: source.name,
        reference_id: source.reference_id,
        chain: [source.chain, new_chain].concat(),
        symbol_id: semantic
            .scoping()
            .get_reference(source.reference_id)
            .symbol_id(),
    }))
}

fn is_identifier_a_dependency<'a>(
    ident_name: Str<'a>,
    ident_reference_id: ReferenceId,
    ident_span: Span,
    ctx: &'_ LintContext<'a>,
    component_scope_id: ScopeId,
) -> bool {
    let mut visited = FxHashSet::default();
    is_identifier_a_dependency_impl(
        ident_name,
        ident_reference_id,
        ident_span,
        ctx,
        component_scope_id,
        &mut visited,
    )
}

fn symbol_has_react_use_effect_event_origin(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    exhaustive_deps_is_react_api_call(call, "useEffectEvent", ctx)
}

fn symbol_has_stable_hook_origin(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    if ctx
        .semantic()
        .symbol_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let Some(declarator) = std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .take_while(|owner| {
            !matches!(
                owner.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find_map(|owner| match owner.kind() {
            AstKind::VariableDeclarator(declarator) => Some(declarator),
            _ => None,
        })
    else {
        return false;
    };
    let Some(initializer) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if variable_declaration_kind(declarator, ctx) == VariableDeclarationKind::Const
        && (matches!(
            initializer,
            Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::StringLiteral(_)
        ) || matches!(initializer, Expression::TemplateLiteral(template) if template.expressions.is_empty()))
    {
        return true;
    }
    let Expression::CallExpression(call) = initializer else {
        return false;
    };
    let Some(hook_name) = call_name(call) else {
        return false;
    };
    if (hook_name == "useRef" && exhaustive_deps_is_react_api_call(call, "useRef", ctx))
        || (hook_name == "useEffectEvent"
            && exhaustive_deps_is_react_api_call(call, "useEffectEvent", ctx))
        || matches!(
            hook_name,
            "useEventCallback"
                | "useStableCallback"
                | "useMemoizedFn"
                | "usePersistFn"
                | "useLatestCallback"
                | "useCallbackRef"
                | "useEvent"
        )
    {
        return true;
    }
    if !matches!(
        hook_name,
        "useState" | "useReducer" | "useActionState" | "useTransition"
    ) {
        return false;
    }
    let BindingPattern::ArrayPattern(array) = &declarator.id else {
        return false;
    };
    array
        .elements
        .get(1)
        .and_then(Option::as_ref)
        .is_some_and(|binding| {
            binding
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
        })
}

fn is_seeded_data_ref(identifier: &IdentifierReference<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !exhaustive_deps_is_react_api_call(call, "useRef", ctx) {
        return false;
    }
    let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    match argument.get_inner_expression() {
        Expression::NullLiteral(_) => false,
        Expression::Identifier(undefined) => {
            undefined.name != "undefined" || !ctx.is_reference_to_global_variable(undefined)
        }
        _ => true,
    }
}

fn ref_current_chain_is_written(
    reference_node_id: NodeId,
    allow_nested_write: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let reference = ctx.nodes().get_node(reference_node_id);
    let mut chain_root = ctx.nodes().parent_node(reference.id());
    let AstKind::StaticMemberExpression(current_member) = chain_root.kind() else {
        return false;
    };
    if current_member.property.name != "current" || current_member.object.span() != reference.span()
    {
        return false;
    }

    let current_parent = ctx.nodes().parent_node(chain_root.id());
    if matches!(current_parent.kind(), AstKind::AssignmentExpression(assignment) if assignment.left.span() == chain_root.span())
        || matches!(current_parent.kind(), AstKind::UpdateExpression(update) if update.argument.span() == chain_root.span())
    {
        return true;
    }
    if !allow_nested_write {
        return false;
    }

    loop {
        let parent = ctx.nodes().parent_node(chain_root.id());
        let is_chain_parent = match parent.kind() {
            AstKind::StaticMemberExpression(member) => member.object.span() == chain_root.span(),
            AstKind::ComputedMemberExpression(member) => member.object.span() == chain_root.span(),
            AstKind::ChainExpression(chain) => chain.expression.span() == chain_root.span(),
            AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::ParenthesizedExpression(_) => parent.span() == chain_root.span(),
            _ => false,
        };
        if !is_chain_parent {
            return matches!(parent.kind(), AstKind::AssignmentExpression(assignment) if assignment.left.span().contains_inclusive(chain_root.span()))
                || matches!(parent.kind(), AstKind::UpdateExpression(update) if update.argument.span().contains_inclusive(chain_root.span()));
        }
        chain_root = parent;
    }
}

fn is_identifier_a_dependency_impl<'a>(
    ident_name: Str<'a>,
    ident_reference_id: ReferenceId,
    ident_span: Span,
    ctx: &'_ LintContext<'a>,
    component_scope_id: ScopeId,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(declaration) = get_declaration_from_reference_id(ident_reference_id, ctx) else {
        // No declaration means it's a global variable, e.g. `console` or `window`,
        // which are not dependencies
        return false;
    };

    if ctx.scoping().scope_flags(declaration.scope_id()).is_top() {
        return false;
    }

    let Some(symbol_id) = ctx.scoping().get_reference(ident_reference_id).symbol_id() else {
        return false;
    };
    let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    if symbol_scope_id != component_scope_id
        && !ctx
            .scoping()
            .scope_is_descendant_of(symbol_scope_id, component_scope_id)
    {
        return false;
    }

    let declaration_function_scope_id =
        ctx.nodes()
            .ancestors(declaration.id())
            .find_map(|owner| match owner.kind() {
                AstKind::Function(function) => Some(function.scope_id()),
                AstKind::ArrowFunctionExpression(function) => Some(function.scope_id()),
                _ => None,
            });
    if declaration.span().contains_inclusive(ident_span)
        || declaration_function_scope_id != Some(component_scope_id)
    {
        return false;
    }

    if is_stable_value(
        declaration,
        ident_name,
        ident_reference_id,
        ctx,
        component_scope_id,
        visited,
    ) {
        return false;
    }

    true
}

// https://github.com/facebook/react/blob/fee786a057774ab687aff765345dd86fce534ab2/packages/eslint-plugin-react-hooks/src/ExhaustiveDeps.js#L164
fn is_stable_value<'a, 'b>(
    node: &'b AstNode<'a>,
    ident_name: Str<'a>,
    ident_reference_id: ReferenceId,
    ctx: &'b LintContext<'a>,
    component_scope_id: ScopeId,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let reference_symbol_id = ctx.scoping().get_reference(ident_reference_id).symbol_id();
    if reference_symbol_id.is_some_and(|symbol_id| visited.contains(&symbol_id)) {
        return true;
    }
    if let Some(symbol_id) = reference_symbol_id
        && let Some(initializer) = parameter_default_initializer_for_symbol(symbol_id, ctx)
    {
        let function_body = match initializer.get_inner_expression() {
            Expression::ArrowFunctionExpression(function) => {
                Some(CallbackBody::Arrow(&function.body))
            }
            Expression::FunctionExpression(function) => {
                function.body.as_deref().map(CallbackBody::Function)
            }
            _ => None,
        };
        if let Some(function_body) = function_body {
            visited.insert(symbol_id);
            let is_stable = is_function_stable(
                function_body,
                Some(symbol_id),
                ctx,
                component_scope_id,
                visited,
            );
            if !is_stable {
                visited.remove(&symbol_id);
            }
            return is_stable;
        }
    }
    let node = if matches!(
        node.kind(),
        AstKind::VariableDeclaration(_)
            | AstKind::VariableDeclarator(_)
            | AstKind::FormalParameter(_)
            | AstKind::ArrowFunctionExpression(_)
            | AstKind::Function(_)
    ) {
        node
    } else {
        ctx.nodes()
            .ancestors(node.id())
            .take_while(|owner| {
                !matches!(
                    owner.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .find(|owner| {
                matches!(
                    owner.kind(),
                    AstKind::VariableDeclarator(_) | AstKind::FormalParameter(_)
                )
            })
            .unwrap_or(node)
    };

    match node.kind() {
        AstKind::VariableDeclaration(declaration) => {
            if declaration.kind == VariableDeclarationKind::Const {
                return true;
            }

            false
        }
        AstKind::VariableDeclarator(declaration) => {
            // if the variable does not have an initializer, then it's not a stable value
            let Some(init) = &declaration.init else {
                return false;
            };

            {
                // if the variables is a function, check whether the function is stable
                let function_body = match init.get_inner_expression() {
                    Expression::ArrowFunctionExpression(arrow_func) => {
                        Some(CallbackBody::Arrow(&arrow_func.body))
                    }
                    Expression::FunctionExpression(func) => {
                        func.body.as_deref().map(CallbackBody::Function)
                    }
                    _ => None,
                };
                if let Some(function_body) = function_body {
                    let Some(symbol_id) = reference_symbol_id else {
                        return false;
                    };
                    visited.insert(symbol_id);
                    let is_stable = is_function_stable(
                        function_body,
                        Some(symbol_id),
                        ctx,
                        component_scope_id,
                        visited,
                    );
                    if !is_stable {
                        visited.remove(&symbol_id);
                    }
                    return is_stable;
                }
            }

            // if the variables is a constant, and the initializer is a literal, then it's a stable value. (excluding regex literals)
            if variable_declaration_kind(declaration, ctx) == VariableDeclarationKind::Const
                && (matches!(
                    init.get_inner_expression(),
                    Expression::BooleanLiteral(_)
                        | Expression::NullLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::BigIntLiteral(_)
                        | Expression::StringLiteral(_)
                ))
            {
                return true;
            }

            if variable_declaration_kind(declaration, ctx) == VariableDeclarationKind::Const
                && declaration
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| Some(binding.symbol_id()) == reference_symbol_id)
                && reference_symbol_id.is_some_and(|symbol_id| {
                    ctx.semantic()
                        .symbol_references(symbol_id)
                        .all(|reference| !reference.is_write())
                })
                && matches!(init.get_inner_expression(), Expression::Identifier(identifier) if resolve_identifier_import(identifier, ctx).is_some())
            {
                return true;
            }

            let Expression::CallExpression(init_expr) = init.get_inner_expression() else {
                return false;
            };

            if (exhaustive_deps_is_react_api_call(init_expr, "useCallback", ctx)
                || exhaustive_deps_is_react_api_call(init_expr, "useMemo", ctx))
                && let Some(symbol_id) = reference_symbol_id
                && declaration
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && ctx
                    .semantic()
                    .symbol_references(symbol_id)
                    .all(|reference| !reference.is_write())
            {
                visited.insert(symbol_id);
                let is_stable = memoized_hook_dependencies_are_stable(
                    init_expr,
                    ctx,
                    component_scope_id,
                    visited,
                );
                if !is_stable {
                    visited.remove(&symbol_id);
                }
                return is_stable;
            }

            let Some(init_name) = call_name(init_expr) else {
                return false;
            };

            if (init_name == "useRef"
                && exhaustive_deps_is_react_api_call(init_expr, "useRef", ctx))
                || (init_name == "useEffectEvent"
                    && exhaustive_deps_is_react_api_call(init_expr, "useEffectEvent", ctx))
                || matches!(
                    init_name,
                    "useEventCallback"
                        | "useStableCallback"
                        | "useMemoizedFn"
                        | "usePersistFn"
                        | "useLatestCallback"
                        | "useCallbackRef"
                        | "useEvent"
                )
            {
                return true;
            }

            let BindingPattern::ArrayPattern(array_pat) = &declaration.id else {
                return false;
            };

            let Some(Some(second_arg)) = array_pat.elements.get(1) else {
                return false;
            };

            let BindingPattern::BindingIdentifier(binding_ident) = &second_arg else {
                return false;
            };

            if ((init_name == "useState"
                && exhaustive_deps_is_react_api_call(init_expr, "useState", ctx))
                || (init_name == "useReducer"
                    && exhaustive_deps_is_react_api_call(init_expr, "useReducer", ctx))
                || (init_name == "useTransition"
                    && exhaustive_deps_is_react_api_call(init_expr, "useTransition", ctx))
                || (init_name == "useActionState"
                    && exhaustive_deps_is_react_api_call(init_expr, "useActionState", ctx)))
                && binding_ident.name == ident_name
                && !ctx
                    .semantic()
                    .symbol_references(
                        ctx.scoping()
                            .get_reference(ident_reference_id)
                            .symbol_id()
                            .unwrap(),
                    )
                    .any(|reference| {
                        if let AstKind::AssignmentExpression(assignment_expression) =
                            ctx.nodes().parent_kind(reference.node_id())
                        {
                            assignment_expression.left.span().contains_inclusive(
                                ctx.nodes().get_node(reference.node_id()).span(),
                            )
                        } else {
                            false
                        }
                    })
            {
                return true;
            }

            false
        }
        AstKind::FormalParameter(parameter) => {
            let Some(symbol_id) = reference_symbol_id else {
                return false;
            };
            let Some(initializer) =
                binding_pattern_initializer_for_symbol(&parameter.pattern, symbol_id, None)
            else {
                return false;
            };
            let function_body = match initializer.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => {
                    Some(CallbackBody::Arrow(&function.body))
                }
                Expression::FunctionExpression(function) => {
                    function.body.as_deref().map(CallbackBody::Function)
                }
                _ => None,
            };
            let Some(function_body) = function_body else {
                return false;
            };
            visited.insert(symbol_id);
            let is_stable = is_function_stable(
                function_body,
                Some(symbol_id),
                ctx,
                component_scope_id,
                visited,
            );
            if !is_stable {
                visited.remove(&symbol_id);
            }
            is_stable
        }
        AstKind::ArrowFunctionExpression(_) | AstKind::Function(_) => {
            let function_body = match node.kind() {
                AstKind::ArrowFunctionExpression(arrow_func) => {
                    Some(CallbackBody::Arrow(&arrow_func.body))
                }
                AstKind::Function(func) => func.body.as_deref().map(CallbackBody::Function),
                _ => unreachable!(),
            };

            let Some(function_body) = function_body else {
                return false;
            };

            let Some(symbol_id) = reference_symbol_id else {
                return false;
            };
            visited.insert(symbol_id);
            let is_stable = is_function_stable(
                function_body,
                Some(symbol_id),
                ctx,
                component_scope_id,
                visited,
            );
            if !is_stable {
                visited.remove(&symbol_id);
            }
            is_stable
        }
        _ => false,
    }
}

fn parameter_default_initializer_for_symbol<'a, 'b>(
    symbol_id: SymbolId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    std::iter::once(declaration)
        .chain(ctx.nodes().ancestors(declaration.id()))
        .take_while(|owner| {
            !matches!(
                owner.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .find_map(|owner| match owner.kind() {
            AstKind::AssignmentPattern(assignment) => binding_pattern_initializer_for_symbol(
                &assignment.left,
                symbol_id,
                Some(&assignment.right),
            ),
            AstKind::FormalParameter(parameter) => binding_pattern_initializer_for_symbol(
                &parameter.pattern,
                symbol_id,
                parameter.initializer.as_deref(),
            ),
            _ => None,
        })
}

fn memoized_hook_dependencies_are_stable<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
    component_scope_id: ScopeId,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(Expression::ArrayExpression(dependencies)) = call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    dependencies.elements.iter().all(|element| {
        let Some(expression) = element.as_expression() else {
            return false;
        };
        let expression = expression.get_inner_expression();
        if expression.is_literal() {
            return true;
        }
        let Expression::Identifier(identifier) = expression else {
            return false;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if ctx
            .scoping()
            .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
            .is_top()
        {
            return true;
        }
        !is_identifier_a_dependency_impl(
            identifier.name.into(),
            identifier.reference_id(),
            identifier.span,
            ctx,
            component_scope_id,
            visited,
        )
    })
}

fn is_function_stable<'a, 'b>(
    function_body: CallbackBody<'a, 'b>,
    function_symbol_id: Option<SymbolId>,
    ctx: &'b LintContext<'a>,
    component_scope_id: ScopeId,
    visited: &mut FxHashSet<SymbolId>,
) -> bool {
    let deps = {
        let mut collector = ExhaustiveDepsVisitor::new(ctx.semantic());
        function_body.visit(&mut collector);
        collector.found_dependencies
    };

    deps.iter().all(|dep| {
        dep.symbol_id == function_symbol_id
            || !is_identifier_a_dependency_impl(
                dep.name,
                dep.reference_id,
                dep.span,
                ctx,
                component_scope_id,
                visited,
            )
    })
}

// https://github.com/facebook/react/blob/fee786a057774ab687aff765345dd86fce534ab2/packages/eslint-plugin-react-hooks/src/ExhaustiveDeps.js#L1742
fn func_call_without_react_namespace<'a, 'b>(call_expr: &'b CallExpression<'a>) -> Option<&'b str> {
    let inner_exp = call_expr.callee.get_inner_expression();

    if let Expression::Identifier(ident) = inner_exp {
        return Some(&ident.name);
    }

    let Expression::StaticMemberExpression(member) = inner_exp else {
        return None;
    };

    let reference = member.object.get_identifier_reference()?;

    if reference.name == "React" {
        return Some(&member.property.name);
    }

    None
}

struct ExhaustiveDepsVisitor<'a, 'b> {
    semantic: &'b Semantic<'a>,
    stack: Vec<AstType>,
    skip_reporting_dependency: bool,
    found_dependencies: FxHashSet<Dependency<'a>>,
    refs_inside_cleanups: Vec<&'a StaticMemberExpression<'a>>,
}

impl<'a, 'b> ExhaustiveDepsVisitor<'a, 'b> {
    fn new(semantic: &'b Semantic<'a>) -> Self {
        Self {
            semantic,
            stack: vec![],
            skip_reporting_dependency: false,
            found_dependencies: FxHashSet::default(),
            refs_inside_cleanups: vec![],
        }
    }
}

impl<'a> VisitJs<'a> for ExhaustiveDepsVisitor<'a, '_> {
    fn enter_node(&mut self, kind: AstKind<'a>) {
        self.stack.push(kind.ty());
    }

    fn leave_node(&mut self, _kind: AstKind<'a>) {
        self.stack.pop();
    }

    fn visit_static_member_expression(&mut self, it: &StaticMemberExpression<'a>) {
        if it.property.name == "current" && is_inside_effect_cleanup(&self.stack) {
            // Safety: this is safe
            let it = unsafe {
                std::mem::transmute::<&StaticMemberExpression<'_>, &'a StaticMemberExpression<'a>>(
                    it,
                )
            };
            self.refs_inside_cleanups.push(it);
        }

        // consider `useEffect(() => { console.log(props.foo().foo.bar); }, [props.foo]);`
        // we don't care about `foo.bar`, only `props.foo`
        if matches!(
            it.object.get_inner_expression(),
            Expression::CallExpression(_)
        ) || self.skip_reporting_dependency
        {
            self.visit_expression(&it.object);
            return;
        }

        if matches!(
            &it.object,
            Expression::TSAsExpression(_)
                | Expression::TSSatisfiesExpression(_)
                | Expression::TSTypeAssertion(_)
                | Expression::TSNonNullExpression(_)
                | Expression::ParenthesizedExpression(_)
        ) {
            self.visit_expression(&it.object);
            return;
        }

        if let Ok(source) = analyze_property_chain(&it.object, self.semantic) {
            if let Some(source) = source {
                let symbol_id = self
                    .semantic
                    .scoping()
                    .get_reference(source.reference_id)
                    .symbol_id();
                if it.property.name == "current"
                    || source.chain.iter().any(|part| part == "current")
                {
                    let mut chain = source.chain.clone();
                    if let Some(current_index) = chain.iter().position(|part| part == "current") {
                        chain.truncate(current_index);
                    }
                    self.found_dependencies.insert(Dependency {
                        name: source.name,
                        reference_id: source.reference_id,
                        span: source.span,
                        chain,
                        symbol_id,
                    });
                } else {
                    let mut chain = source.chain.clone();
                    chain.push(Str::from(it.property.name));
                    if let Some(destructured_path) =
                        destructured_property_path_for_reference(source.reference_id, self.semantic)
                    {
                        chain.extend(destructured_path);
                    }
                    self.found_dependencies.insert(Dependency {
                        name: source.name,
                        reference_id: source.reference_id,
                        span: source.span,
                        chain,
                        symbol_id,
                    });
                }
            }

            let cur_skip_reporting_dependency = self.skip_reporting_dependency;
            self.skip_reporting_dependency = true;
            self.visit_expression(&it.object);
            self.skip_reporting_dependency = cur_skip_reporting_dependency;
        } else {
            // this means that some part of the chain could not be analyzed
            // for example `foo.bar.baz().abc`. `baz()` cannot be statically analyzed
            // instead, continue to go down, looking at the object to gather dependencies
            self.visit_expression(&it.object);
        }
    }

    fn visit_computed_member_expression(&mut self, it: &ComputedMemberExpression<'a>) {
        let was_skipping_dependency = self.skip_reporting_dependency;
        self.visit_expression(&it.object);
        self.skip_reporting_dependency = false;
        self.visit_expression(&it.expression);
        self.skip_reporting_dependency = was_skipping_dependency;
    }

    fn visit_identifier_reference(&mut self, ident: &IdentifierReference<'a>) {
        if self.skip_reporting_dependency {
            return;
        }
        let reference_id = ident.reference_id();
        let symbol_id = self
            .semantic
            .scoping()
            .get_reference(reference_id)
            .symbol_id();
        let destructured_path =
            destructured_property_path_for_reference(reference_id, self.semantic);
        self.found_dependencies.insert(Dependency {
            name: ident.name.into(),
            reference_id,
            span: ident.span,
            chain: destructured_path.unwrap_or_default(),
            symbol_id,
        });
    }
}

fn is_inside_effect_cleanup(stack: &[AstType]) -> bool {
    let mut iter = stack.iter().rev();

    while let Some(&cur) = iter.next() {
        if matches!(cur, AstType::Function | AstType::ArrowFunctionExpression)
            && iter.next() == Some(&AstType::ReturnStatement)
        {
            return true;
        }
    }

    false
}
