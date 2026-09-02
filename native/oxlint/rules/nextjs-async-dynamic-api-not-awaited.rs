use oxc_ast::{
    AstKind,
    ast::{Expression, TSType, TSTypeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This Next.js request API returns a Promise. Synchronous property access warns in Next.js 15 and is removed in Next.js 16; await it or unwrap it with React `use()`.";
const DYNAMIC_API_NAMES: [&str; 3] = ["cookies", "headers", "draftMode"];
const NEXTJS_REACT_RUNTIME_MODULE_SOURCES: [&str; 5] = [
    "react",
    "react-dom",
    "preact/compat",
    "preact/hooks",
    "@wordpress/element",
];

#[derive(Debug, Default, Clone)]
pub struct NextjsAsyncDynamicApiNotAwaited;

declare_oxc_lint!(
    /// Require awaiting asynchronous Next.js request APIs.
    NextjsAsyncDynamicApiNotAwaited,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Synchronous Next.js request API access.",
);

impl Rule for NextjsAsyncDynamicApiNotAwaited {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_next_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_capability(ctx, "nextjs:15") || !nextjs_dynamic_api_file_is_relevant(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            if nextjs_node_is_statically_skipped(node, ctx) {
                continue;
            }
            match node.kind() {
                AstKind::CallExpression(call)
                    if nextjs_dynamic_api_call(call, ctx)
                        && !nextjs_dynamic_call_has_unsafe_unwrapped_cast(node, ctx)
                        && nextjs_dynamic_call_is_consumed(node, ctx) =>
                {
                    ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call.span));
                }
                AstKind::CallExpression(call) => {
                    for argument in &call.arguments {
                        let Some(argument) = argument.as_expression() else {
                            continue;
                        };
                        if nextjs_call_consumes_dynamic_value(call, argument.span(), ctx) {
                            if nextjs_call_uses_official_direct_value_semantics(
                                call,
                                argument.span(),
                                ctx,
                            ) {
                                nextjs_report_official_direct_value(argument, ctx);
                                nextjs_report_dynamic_pending_consumption(argument, ctx);
                            } else {
                                nextjs_report_pending_consumption(argument, ctx);
                            }
                        }
                    }
                }
                AstKind::NewExpression(construction) => {
                    let Some(argument) = construction
                        .arguments
                        .first()
                        .and_then(|argument| argument.as_expression())
                    else {
                        continue;
                    };
                    if nextjs_new_consumes_dynamic_value(construction, argument.span(), ctx) {
                        nextjs_report_pending_consumption(argument, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator)
                    if nextjs_binding_pattern_consumes_dynamic_value(&declarator.id) =>
                {
                    if let Some(initializer) = &declarator.init {
                        nextjs_report_pending_consumption(initializer, ctx);
                    }
                }
                AstKind::AssignmentExpression(assignment) => {
                    if nextjs_assignment_target_consumes_dynamic_value(&assignment.left) {
                        nextjs_report_pending_consumption(&assignment.right, ctx);
                    }
                    nextjs_report_pending_assignment_target(node, assignment, ctx);
                    nextjs_report_official_assignment_consumption(node, assignment, ctx);
                }
                AstKind::SpreadElement(spread) => {
                    nextjs_report_pending_consumption(&spread.argument, ctx);
                }
                AstKind::ForInStatement(statement) => {
                    nextjs_report_pending_consumption(&statement.right, ctx);
                }
                AstKind::ForOfStatement(statement) => {
                    nextjs_report_pending_consumption(&statement.right, ctx);
                }
                AstKind::YieldExpression(expression) if expression.delegate => {
                    if let Some(argument) = &expression.argument {
                        nextjs_report_pending_consumption(argument, ctx);
                    }
                }
                AstKind::StaticMemberExpression(member) => {
                    nextjs_report_pending_binding_member(
                        &member.object,
                        Some(member.property.name.as_str()),
                        ctx,
                    );
                }
                AstKind::ComputedMemberExpression(member) => {
                    nextjs_report_official_direct_value(&member.expression, ctx);
                    nextjs_report_dynamic_pending_consumption(&member.expression, ctx);
                    nextjs_report_pending_binding_member(
                        &member.object,
                        nextjs_static_string(&member.expression, ctx, &mut Vec::new()),
                        ctx,
                    );
                }
                AstKind::PrivateFieldExpression(member) => {
                    nextjs_report_pending_binding_member(&member.object, None, ctx);
                }
                AstKind::ObjectProperty(property) if property.computed => {
                    if let Some(key) = property.key.as_expression() {
                        nextjs_report_official_direct_value(key, ctx);
                        nextjs_report_dynamic_pending_consumption(key, ctx);
                    }
                }
                AstKind::ConditionalExpression(expression) => {
                    nextjs_report_official_direct_value(&expression.test, ctx);
                }
                AstKind::LogicalExpression(expression) => {
                    nextjs_report_official_direct_value(&expression.left, ctx);
                }
                AstKind::IfStatement(statement) => {
                    nextjs_report_official_direct_value(&statement.test, ctx);
                }
                AstKind::WhileStatement(statement) => {
                    nextjs_report_official_direct_value(&statement.test, ctx);
                }
                AstKind::DoWhileStatement(statement) => {
                    nextjs_report_official_direct_value(&statement.test, ctx);
                }
                AstKind::ForStatement(statement) => {
                    if let Some(test) = &statement.test {
                        nextjs_report_official_direct_value(test, ctx);
                    }
                }
                AstKind::SwitchStatement(statement) => {
                    nextjs_report_official_direct_value(&statement.discriminant, ctx);
                }
                AstKind::BinaryExpression(expression) => {
                    nextjs_report_official_direct_value(&expression.left, ctx);
                    nextjs_report_official_direct_value(&expression.right, ctx);
                    if expression.operator != BinaryOperator::In {
                        nextjs_report_dynamic_pending_consumption(&expression.left, ctx);
                    }
                    nextjs_report_dynamic_pending_consumption(&expression.right, ctx);
                }
                AstKind::UnaryExpression(expression)
                    if expression.operator != UnaryOperator::Void =>
                {
                    nextjs_report_official_direct_value(&expression.argument, ctx);
                    if !matches!(
                        expression.operator,
                        UnaryOperator::LogicalNot | UnaryOperator::Typeof
                    ) {
                        nextjs_report_dynamic_pending_consumption(&expression.argument, ctx);
                    }
                }
                AstKind::UpdateExpression(expression) => {
                    if let Some(argument) = expression.argument.get_expression() {
                        nextjs_report_pending_consumption(argument, ctx);
                    }
                }
                AstKind::TemplateLiteral(template) => {
                    let parent = ctx.nodes().parent_node(node.id());
                    if !matches!(parent.kind(), AstKind::TaggedTemplateExpression(_))
                        || matches!(parent.kind(), AstKind::TaggedTemplateExpression(tagged) if nextjs_global_string_raw_tag(&tagged.tag, ctx, &mut Vec::new()))
                    {
                        for expression in &template.expressions {
                            nextjs_report_official_direct_value(expression, ctx);
                            nextjs_report_dynamic_pending_consumption(expression, ctx);
                        }
                    }
                }
                AstKind::JSXExpressionContainer(container) => {
                    if let Some(expression) = container.expression.as_expression() {
                        nextjs_report_official_direct_value(expression, ctx);
                        nextjs_report_dynamic_pending_consumption(expression, ctx);
                    }
                }
                AstKind::JSXSpreadAttribute(attribute) => {
                    nextjs_report_dynamic_pending_consumption(&attribute.argument, ctx);
                }
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                    nextjs_report_nested_official_parameter_destructure(node, ctx);
                }
                _ => {}
            }
        }
    }
}

fn nextjs_dynamic_api_file_is_relevant(ctx: &LintContext<'_>) -> bool {
    if ctx
        .module_record()
        .import_entries
        .iter()
        .any(|entry| entry.module_request.name() == "next/headers")
    {
        return true;
    }
    let Some(filename) = ctx
        .file_path()
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
    else {
        return false;
    };
    let Some((stem, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    if !matches!(extension, "ts" | "tsx" | "js" | "jsx" | "mts" | "mjs") {
        return false;
    }
    let is_metadata_image = ["opengraph-image", "twitter-image", "icon", "apple-icon"]
        .iter()
        .any(|prefix| {
            stem.strip_prefix(prefix)
                .is_some_and(|suffix| suffix.bytes().all(|byte| byte.is_ascii_digit()))
        });
    (is_in_project_directory(ctx, "app")
        || ctx
            .file_path()
            .to_string_lossy()
            .replace('\\', "/")
            .starts_with("app/"))
        && (matches!(stem, "page" | "layout" | "default" | "route" | "sitemap")
            || is_metadata_image)
}

fn nextjs_report_nested_official_parameter_destructure<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) {
    let Some((parameter, property_names)) = nextjs_official_function_contract(function, ctx) else {
        return;
    };
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
        return;
    };
    for property in &pattern.properties {
        if property
            .key
            .static_name()
            .is_some_and(|name| property_names.contains(&name.as_ref()))
            && property.value.get_binding_identifier().is_none()
        {
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(property.span));
        }
    }
}

fn nextjs_dynamic_call_has_unsafe_unwrapped_cast<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if has_capability(ctx, "nextjs:16") {
        return false;
    }
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let type_annotation = match parent.kind() {
            AstKind::TSAsExpression(expression) => Some(&expression.type_annotation),
            AstKind::TSTypeAssertion(expression) => Some(&expression.type_annotation),
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::ChainExpression(_) => None,
            _ => return false,
        };
        if type_annotation.is_some_and(|type_annotation| {
            nextjs_is_unsafe_unwrapped_type(type_annotation, ctx, &mut Vec::new())
        }) {
            return true;
        }
        current = parent;
    }
}

fn nextjs_is_unsafe_unwrapped_type<'a>(
    type_node: &'a TSType<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let TSType::TSTypeReference(reference) = type_node else {
        return false;
    };
    match &reference.type_name {
        TSTypeName::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbols.contains(&symbol_id) {
                return false;
            }
            if nextjs_unsafe_type_import_matches(symbol_id, ctx) {
                return true;
            }
            let AstKind::TSTypeAliasDeclaration(alias) = ctx.symbol_declaration(symbol_id).kind()
            else {
                return false;
            };
            visited_symbols.push(symbol_id);
            let matches =
                nextjs_is_unsafe_unwrapped_type(&alias.type_annotation, ctx, visited_symbols);
            visited_symbols.pop();
            matches
        }
        TSTypeName::QualifiedName(qualified) => {
            if !matches!(
                qualified.right.name.as_str(),
                "UnsafeUnwrappedCookies" | "UnsafeUnwrappedHeaders" | "UnsafeUnwrappedDraftMode"
            ) {
                return false;
            }
            let TSTypeName::IdentifierReference(namespace) = &qualified.left else {
                return false;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(namespace.reference_id())
                .symbol_id()
            else {
                return false;
            };
            ctx.module_record().import_entries.iter().any(|entry| {
                entry.module_request.name() == "next/headers"
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
                    && matches!(
                        entry.import_name,
                        crate::module_record::ImportImportName::NamespaceObject
                    )
            })
        }
        TSTypeName::ThisExpression(_) => false,
    }
}

fn nextjs_unsafe_type_import_matches(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "next/headers"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if matches!(
                        imported_name.name(),
                        "UnsafeUnwrappedCookies"
                            | "UnsafeUnwrappedHeaders"
                            | "UnsafeUnwrappedDraftMode"
                    )
            )
    })
}

fn nextjs_report_pending_binding_member<'a>(
    object: &'a Expression<'a>,
    property_name: Option<&str>,
    ctx: &LintContext<'a>,
) {
    if matches!(property_name, Some("then" | "catch" | "finally")) {
        return;
    }
    if let Some(source_span) = nextjs_official_prop_source(object, ctx) {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(source_span));
        return;
    }
    match object.get_inner_expression() {
        Expression::Identifier(_) => {}
        Expression::CallExpression(call) if !nextjs_dynamic_api_call(call, ctx) => {}
        _ => return,
    }
    if matches!(object.get_inner_expression(), Expression::CallExpression(call)
    if call.callee.as_member_expression().is_none_or(|member| {
        !matches!(member_expression_identifier_property_name(member), Some("then" | "catch" | "finally"))
    })) {
        return;
    }
    let Some(source_span) = nextjs_pending_const_source(object, ctx, &mut Vec::new()) else {
        return;
    };
    ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(source_span));
}

#[derive(Clone)]
struct NextjsOfficialPropsObjectSource {
    property_names: Vec<&'static str>,
    root_symbol_id: SymbolId,
}

fn nextjs_narrow_official_props_for_binding_pattern(
    source: &mut NextjsOfficialPropsObjectSource,
    pattern: &oxc_ast::ast::ObjectPattern<'_>,
) -> bool {
    for property in &pattern.properties {
        let Some(property_name) = property.key.static_name() else {
            return false;
        };
        source
            .property_names
            .retain(|candidate| *candidate != property_name.as_ref());
    }
    true
}

fn nextjs_narrow_official_props_for_assignment_pattern(
    source: &mut NextjsOfficialPropsObjectSource,
    pattern: &oxc_ast::ast::ObjectAssignmentTarget<'_>,
) -> bool {
    for property in &pattern.properties {
        match property {
            oxc_ast::ast::AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(
                property,
            ) => source
                .property_names
                .retain(|candidate| *candidate != property.binding.name.as_str()),
            oxc_ast::ast::AssignmentTargetProperty::AssignmentTargetPropertyProperty(property) => {
                let Some(property_name) = property.name.static_name() else {
                    return false;
                };
                source
                    .property_names
                    .retain(|candidate| *candidate != property_name.as_ref());
            }
        }
    }
    true
}

fn nextjs_official_props_object_source<'a>(
    expression: &'a Expression<'a>,
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<NextjsOfficialPropsObjectSource> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbols.contains(&symbol_id) {
        return None;
    }
    visited_symbols.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let Some(function) = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) && let Some((parameter, property_names)) =
        nextjs_official_function_contract(function, ctx)
    {
        if parameter
            .pattern
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            visited_symbols.pop();
            return Some(NextjsOfficialPropsObjectSource {
                property_names: property_names.to_vec(),
                root_symbol_id: symbol_id,
            });
        }
        if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &parameter.pattern
            && pattern.rest.as_ref().is_some_and(|rest| {
                rest.argument
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
            })
        {
            let mut source = NextjsOfficialPropsObjectSource {
                property_names: property_names.to_vec(),
                root_symbol_id: symbol_id,
            };
            let is_valid = nextjs_narrow_official_props_for_binding_pattern(&mut source, pattern);
            visited_symbols.pop();
            return is_valid.then_some(source);
        }
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
    {
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            let source = nextjs_official_props_object_source(
                declarator.init.as_ref()?,
                reference_node,
                ctx,
                visited_symbols,
            );
            visited_symbols.pop();
            return source;
        }
        if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
            && pattern.rest.as_ref().is_some_and(|rest| {
                rest.argument
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
            })
        {
            let mut source = nextjs_official_props_object_source(
                declarator.init.as_ref()?,
                reference_node,
                ctx,
                visited_symbols,
            )?;
            let is_valid = nextjs_narrow_official_props_for_binding_pattern(&mut source, pattern);
            visited_symbols.pop();
            return is_valid.then_some(source);
        }
    }
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let write_node = ctx.nodes().get_node(reference.node_id());
        let Some(assignment_node_id) = nextjs_assignment_for_write(write_node, ctx) else {
            continue;
        };
        let assignment_node = ctx.nodes().get_node(assignment_node_id);
        if assignment_node.span().start >= reference_node.span().start
            || !node_dominates_node(assignment_node, reference_node, ctx)
            || nextjs_node_is_statically_skipped(assignment_node, ctx)
        {
            continue;
        }
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        if assignment.operator != AssignmentOperator::Assign {
            continue;
        }
        if matches!(&assignment.left, oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(target) if ctx.scoping().get_reference(target.reference_id()).symbol_id() == Some(symbol_id))
        {
            if let Some(source) = nextjs_official_props_object_source(
                &assignment.right,
                assignment_node,
                ctx,
                visited_symbols,
            ) {
                visited_symbols.pop();
                return Some(source);
            }
            continue;
        }
        let Some(object_target) = ctx.nodes().ancestors(write_node.id()).find_map(|ancestor| {
            let AstKind::ObjectAssignmentTarget(pattern) = ancestor.kind() else {
                return None;
            };
            assignment
                .left
                .span()
                .contains_inclusive(pattern.span())
                .then_some(pattern)
        }) else {
            continue;
        };
        if !ctx.nodes().ancestors(write_node.id()).any(|ancestor| {
            matches!(ancestor.kind(), AstKind::AssignmentTargetRest(_))
                && object_target.span().contains_inclusive(ancestor.span())
        }) {
            continue;
        }
        let Some(mut source) = nextjs_official_props_object_source(
            &assignment.right,
            assignment_node,
            ctx,
            visited_symbols,
        ) else {
            continue;
        };
        if nextjs_narrow_official_props_for_assignment_pattern(&mut source, object_target) {
            visited_symbols.pop();
            return Some(source);
        }
    }
    visited_symbols.pop();
    None
}

fn nextjs_member_matches_official_property<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    property_name: &str,
    root_symbol_id: SymbolId,
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if member_expression_identifier_property_name(member) != Some(property_name) {
        return false;
    }
    nextjs_official_props_object_source(member.object(), reference_node, ctx, &mut Vec::new())
        .is_some_and(|source| source.root_symbol_id == root_symbol_id)
}

fn nextjs_expression_retains_official_pending<'a>(
    expression: &'a Expression<'a>,
    property_name: &str,
    root_symbol_id: SymbolId,
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        expression
            if expression.as_member_expression().is_some_and(|member| {
                nextjs_member_matches_official_property(
                    member,
                    property_name,
                    root_symbol_id,
                    reference_node,
                    ctx,
                )
            }) =>
        {
            true
        }
        Expression::Identifier(_) => {
            nextjs_official_prop_source(expression, ctx).is_some()
                || nextjs_pending_const_source(expression, ctx, &mut Vec::new()).is_some()
        }
        Expression::ConditionalExpression(conditional) => {
            if let Some(value) = nextjs_static_logical_value(&conditional.test, ctx) {
                return nextjs_expression_retains_official_pending(
                    if value.is_truthy {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    property_name,
                    root_symbol_id,
                    reference_node,
                    ctx,
                );
            }
            nextjs_expression_retains_official_pending(
                &conditional.consequent,
                property_name,
                root_symbol_id,
                reference_node,
                ctx,
            ) || nextjs_expression_retains_official_pending(
                &conditional.alternate,
                property_name,
                root_symbol_id,
                reference_node,
                ctx,
            )
        }
        Expression::LogicalExpression(logical) => {
            let left_retains = nextjs_expression_retains_official_pending(
                &logical.left,
                property_name,
                root_symbol_id,
                reference_node,
                ctx,
            );
            let right_retains = nextjs_expression_retains_official_pending(
                &logical.right,
                property_name,
                root_symbol_id,
                reference_node,
                ctx,
            );
            if left_retains {
                return logical.operator != LogicalOperator::And || right_retains;
            }
            nextjs_static_logical_value(&logical.left, ctx).map_or(right_retains, |value| {
                nextjs_logical_right_can_be_result(logical.operator, value) && right_retains
            })
        }
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.last().is_some_and(|expression| {
                nextjs_expression_retains_official_pending(
                    expression,
                    property_name,
                    root_symbol_id,
                    reference_node,
                    ctx,
                )
            })
        }
        Expression::AssignmentExpression(assignment) => nextjs_expression_retains_official_pending(
            &assignment.right,
            property_name,
            root_symbol_id,
            reference_node,
            ctx,
        ),
        Expression::CallExpression(call) => {
            call.callee.as_member_expression().is_some_and(|member| {
                matches!(
                    member_expression_identifier_property_name(member),
                    Some("then" | "catch" | "finally")
                ) && nextjs_expression_retains_official_pending(
                    member.object(),
                    property_name,
                    root_symbol_id,
                    reference_node,
                    ctx,
                )
            })
        }
        expression => nextjs_pending_const_source(expression, ctx, &mut Vec::new()).is_some(),
    }
}

fn nextjs_official_property_is_cleared_before<'a>(
    reference_node: &AstNode<'a>,
    property_name: &str,
    root_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_owner =
        crate::ast_util::get_enclosing_function(reference_node, ctx).map(AstNode::id);
    let clearing_nodes = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                return false;
            };
            if candidate.span().start >= reference_node.span().start
                || crate::ast_util::get_enclosing_function(candidate, ctx).map(AstNode::id)
                    != reference_owner
                || nextjs_node_is_statically_skipped(candidate, ctx)
                || matches!(
                    assignment.operator,
                    AssignmentOperator::LogicalOr | AssignmentOperator::LogicalNullish
                )
            {
                return false;
            }
            let Some(member) = assignment.left.as_member_expression() else {
                return false;
            };
            if !nextjs_member_matches_official_property(
                member,
                property_name,
                root_symbol_id,
                candidate,
                ctx,
            ) {
                return false;
            }
            assignment.operator != AssignmentOperator::Assign
                || matches!(assignment.right.get_inner_expression(), Expression::AwaitExpression(_))
                || matches!(assignment.right.get_inner_expression(), Expression::CallExpression(call) if nextjs_react_use_call(call, ctx))
                || !nextjs_expression_retains_official_pending(
                    &assignment.right,
                    property_name,
                    root_symbol_id,
                    candidate,
                    ctx,
                )
        })
        .collect::<Vec<_>>();
    clearing_nodes.iter().any(|clearing_node| {
        nextjs_clearing_assignment_dominates(clearing_node, &clearing_nodes, reference_node, ctx)
    })
}

fn nextjs_report_official_assignment_consumption<'a>(
    assignment_node: &AstNode<'a>,
    assignment: &'a oxc_ast::ast::AssignmentExpression<'a>,
    ctx: &LintContext<'a>,
) {
    if assignment.operator == AssignmentOperator::Assign {
        return;
    }
    let Some(member) = assignment.left.as_member_expression() else {
        return;
    };
    let Some(property_name) = member_expression_identifier_property_name(member) else {
        return;
    };
    let Some(source) =
        nextjs_official_props_object_source(member.object(), assignment_node, ctx, &mut Vec::new())
    else {
        return;
    };
    if source.property_names.contains(&property_name)
        && !nextjs_official_property_is_cleared_before(
            assignment_node,
            property_name,
            source.root_symbol_id,
            ctx,
        )
    {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(member.span()));
    }
}

fn nextjs_official_identifier_is_cleared_before<'a>(
    symbol_id: SymbolId,
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_owner =
        crate::ast_util::get_enclosing_function(reference_node, ctx).map(AstNode::id);
    let clearing_nodes = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .filter_map(|reference| {
            let write_node = ctx.nodes().get_node(reference.node_id());
            let assignment_node_id = nextjs_assignment_for_write(write_node, ctx)?;
            let assignment_node = ctx.nodes().get_node(assignment_node_id);
            if assignment_node.span().start >= reference_node.span().start
                || crate::ast_util::get_enclosing_function(assignment_node, ctx).map(AstNode::id)
                    != reference_owner
                || nextjs_node_is_statically_skipped(assignment_node, ctx)
            {
                return None;
            }
            let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
                return None;
            };
            if matches!(
                assignment.operator,
                AssignmentOperator::LogicalOr | AssignmentOperator::LogicalNullish
            ) || (assignment.operator == AssignmentOperator::Assign
                && (nextjs_expression_retains_symbol(&assignment.right, symbol_id, ctx)
                    || nextjs_pending_const_source(&assignment.right, ctx, &mut Vec::new())
                        .is_some()))
            {
                return None;
            }
            Some(assignment_node)
        })
        .collect::<Vec<_>>();
    clearing_nodes.iter().any(|clearing_node| {
        nextjs_clearing_assignment_dominates(clearing_node, &clearing_nodes, reference_node, ctx)
    })
}

fn nextjs_official_prop_source<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_span::Span> {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression
        && let Some(member) = call.callee.as_member_expression()
        && matches!(
            member_expression_identifier_property_name(member),
            Some("then" | "catch" | "finally")
        )
    {
        return nextjs_official_prop_source(member.object(), ctx);
    }
    if let Expression::Identifier(identifier) = expression {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        let declaration = ctx.symbol_declaration(symbol_id);
        if let AstKind::VariableDeclarator(declarator) = declaration.kind()
            && declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
            && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
            && let Some(initializer) = &declarator.init
            && let Some(source_span) = nextjs_official_prop_source(initializer, ctx)
        {
            return Some(source_span);
        }
        if let AstKind::VariableDeclarator(declarator) = declaration.kind()
            && let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
            && let Some(property_name) = pattern.properties.iter().find_map(|property| {
                property
                    .value
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                    .then(|| property.key.static_name())
                    .flatten()
            })
            && let Some(source) = declarator.init.as_ref().and_then(|initializer| {
                nextjs_official_props_object_source(
                    initializer,
                    ctx.nodes().get_node(identifier.node_id.get()),
                    ctx,
                    &mut Vec::new(),
                )
            })
            && source.property_names.contains(&property_name.as_ref())
        {
            return Some(identifier.span);
        }
        let function = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })?;
        let (parameter, property_names) = nextjs_official_function_contract(function, ctx)?;
        let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
            return None;
        };
        return pattern.properties.iter().find_map(|property| {
            let binding = property.value.get_binding_identifier()?;
            (binding.symbol_id() == symbol_id
                && property
                    .key
                    .static_name()
                    .is_some_and(|name| property_names.contains(&name.as_ref()))
                && !nextjs_official_identifier_is_cleared_before(
                    symbol_id,
                    ctx.nodes().get_node(identifier.node_id.get()),
                    ctx,
                ))
            .then_some(identifier.span)
        });
    }
    let member = expression.as_member_expression()?;
    let property_name = member_expression_identifier_property_name(member)?;
    let reference_node = ctx.nodes().get_node(expression.node_id());
    let source =
        nextjs_official_props_object_source(member.object(), reference_node, ctx, &mut Vec::new())?;
    if !source.property_names.contains(&property_name)
        || nextjs_official_property_is_cleared_before(
            reference_node,
            property_name,
            source.root_symbol_id,
            ctx,
        )
    {
        return None;
    }
    Some(member.span())
}

fn nextjs_official_direct_value_source<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_span::Span> {
    let source_span = nextjs_official_prop_source(expression, ctx)?;
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::VariableDeclarator(declarator) = declaration.kind()
                && declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
                && let Some(initializer) = &declarator.init
                && nextjs_official_prop_source(initializer, ctx).is_some()
            {
                return Some(source_span);
            }
            let function = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })?;
            let (parameter, property_names) = nextjs_official_function_contract(function, ctx)?;
            if !property_names.contains(&"id") {
                return None;
            }
            let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
                return None;
            };
            pattern
                .properties
                .iter()
                .any(|property| {
                    property.key.static_name().as_deref() == Some("id")
                        && property
                            .value
                            .get_binding_identifier()
                            .is_some_and(|binding| binding.symbol_id() == symbol_id)
                })
                .then_some(source_span)
        }
        expression
            if expression
                .as_member_expression()
                .and_then(member_expression_identifier_property_name)
                == Some("id") =>
        {
            Some(source_span)
        }
        _ => None,
    }
}

fn nextjs_report_official_direct_value<'a>(expression: &'a Expression<'a>, ctx: &LintContext<'a>) {
    if let Some(source_span) = nextjs_official_direct_value_source(expression, ctx) {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(source_span));
    }
}

fn nextjs_official_function_contract<'a, 'b>(
    function: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(
    &'b oxc_ast::ast::FormalParameter<'a>,
    &'static [&'static str],
)> {
    let filename = ctx.file_path().file_name()?.to_str()?;
    let route_kind = filename.split('.').next()?;
    let normalized_filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if !is_in_project_directory(ctx, "app")
        && !normalized_filename.starts_with("app/")
        && !normalized_filename.contains("/app/")
    {
        return None;
    }
    let is_next_16 = has_capability(ctx, "nextjs:16");
    let (parameter_index, property_names) = if route_kind == "route"
        && ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]
            .iter()
            .any(|name| nextjs_function_exported_as(function, name, ctx))
    {
        (1, &["params"][..])
    } else if matches!(route_kind, "page" | "layout")
        && (nextjs_function_exported_as(function, "generateMetadata", ctx)
            || nextjs_function_exported_as(function, "generateViewport", ctx))
    {
        (
            0,
            if route_kind == "page" {
                &["params", "searchParams"][..]
            } else {
                &["params"][..]
            },
        )
    } else if nextjs_function_exported_as(function, "default", ctx) && route_kind == "page" {
        (0, &["params", "searchParams"][..])
    } else if nextjs_function_exported_as(function, "default", ctx)
        && matches!(route_kind, "layout" | "default")
    {
        (0, &["params"][..])
    } else if nextjs_function_exported_as(function, "default", ctx)
        && is_next_16
        && (route_kind.starts_with("opengraph-image")
            || route_kind.starts_with("twitter-image")
            || route_kind.starts_with("icon")
            || route_kind.starts_with("apple-icon"))
    {
        (0, &["id", "params"][..])
    } else if nextjs_function_exported_as(function, "default", ctx)
        && is_next_16
        && filename.starts_with("sitemap.")
        && ctx
            .file_path()
            .components()
            .any(|component| component.as_os_str() == "app")
    {
        (0, &["id"][..])
    } else {
        return None;
    };
    let parameters = match function.kind() {
        AstKind::Function(function) => &function.params,
        AstKind::ArrowFunctionExpression(function) => &function.params,
        _ => return None,
    };
    Some((parameters.items.get(parameter_index)?, property_names))
}

fn nextjs_function_exported_as(
    function: &AstNode<'_>,
    exported_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    if exported_name == "default"
        && ctx
            .nodes()
            .ancestors(function.id())
            .any(|ancestor| matches!(ancestor.kind(), AstKind::ExportDefaultDeclaration(_)))
    {
        return true;
    }
    ctx.module_record()
        .local_export_entries
        .iter()
        .any(|entry| {
            if entry.is_type {
                return false;
            }
            let name_matches = match &entry.export_name {
                crate::module_record::ExportExportName::Name(name) => name.name() == exported_name,
                crate::module_record::ExportExportName::Default(_) => exported_name == "default",
                crate::module_record::ExportExportName::Null => false,
            };
            let Some(local_name) = entry.local_name.name() else {
                return false;
            };
            name_matches
                && ctx
                    .scoping()
                    .get_root_binding(local_name.into())
                    .is_some_and(|symbol_id| {
                        nextjs_export_symbol_resolves_to_function(
                            symbol_id,
                            function.span(),
                            ctx,
                            &mut Vec::new(),
                        )
                    })
        })
}

fn nextjs_export_symbol_resolves_to_function(
    symbol_id: oxc_semantic::SymbolId,
    function_span: oxc_span::Span,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if visited_symbols.contains(&symbol_id) {
        return false;
    }
    visited_symbols.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if declaration.span() == function_span
        && matches!(
            declaration.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    {
        visited_symbols.pop();
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        visited_symbols.pop();
        return false;
    };
    let resolves = declarator.init.as_ref().is_some_and(|initializer| {
        if initializer.span() == function_span
            && matches!(
                initializer.get_inner_expression(),
                Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)
            )
        {
            return true;
        }
        matches!(
            initializer.get_inner_expression(),
            Expression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                    |target_symbol_id| nextjs_export_symbol_resolves_to_function(
                        target_symbol_id,
                        function_span,
                        ctx,
                        visited_symbols,
                    )
                )
        )
    });
    visited_symbols.pop();
    resolves
}

#[derive(Clone, Copy)]
struct NextjsStaticLogicalValue {
    is_nullish: bool,
    is_truthy: bool,
}

fn nextjs_static_logical_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NextjsStaticLogicalValue> {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => Some(NextjsStaticLogicalValue {
            is_nullish: true,
            is_truthy: false,
        }),
        Expression::BooleanLiteral(literal) => Some(NextjsStaticLogicalValue {
            is_nullish: false,
            is_truthy: literal.value,
        }),
        Expression::NumericLiteral(literal) => Some(NextjsStaticLogicalValue {
            is_nullish: false,
            is_truthy: literal.value != 0.0 && !literal.value.is_nan(),
        }),
        Expression::StringLiteral(literal) => Some(NextjsStaticLogicalValue {
            is_nullish: false,
            is_truthy: !literal.value.is_empty(),
        }),
        Expression::TemplateLiteral(template) => {
            let has_static_content = template.quasis.iter().any(|quasi| {
                !quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                    .is_empty()
            });
            (has_static_content || template.expressions.is_empty()).then_some(
                NextjsStaticLogicalValue {
                    is_nullish: false,
                    is_truthy: has_static_content,
                },
            )
        }
        Expression::BigIntLiteral(literal) => Some(NextjsStaticLogicalValue {
            is_nullish: false,
            is_truthy: !literal.is_zero(),
        }),
        Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_)
        | Expression::NewExpression(_) => Some(NextjsStaticLogicalValue {
            is_nullish: false,
            is_truthy: true,
        }),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
            Some(NextjsStaticLogicalValue {
                is_nullish: true,
                is_truthy: false,
            })
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Typeof => {
            Some(NextjsStaticLogicalValue {
                is_nullish: false,
                is_truthy: true,
            })
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            nextjs_static_logical_value(&unary.argument, ctx).map(|value| {
                NextjsStaticLogicalValue {
                    is_nullish: false,
                    is_truthy: !value.is_truthy,
                }
            })
        }
        Expression::Identifier(identifier)
            if ctx.is_reference_to_global_variable(identifier)
                && matches!(identifier.name.as_str(), "undefined" | "NaN" | "Infinity") =>
        {
            Some(NextjsStaticLogicalValue {
                is_nullish: identifier.name == "undefined",
                is_truthy: identifier.name == "Infinity",
            })
        }
        _ => None,
    }
}

fn nextjs_logical_right_can_be_result(
    operator: LogicalOperator,
    value: NextjsStaticLogicalValue,
) -> bool {
    match operator {
        LogicalOperator::And => value.is_truthy,
        LogicalOperator::Or => !value.is_truthy,
        LogicalOperator::Coalesce => value.is_nullish,
    }
}

fn nextjs_node_is_statically_skipped(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let node_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            AstKind::IfStatement(statement) => {
                let Some(value) = nextjs_static_logical_value(&statement.test, ctx) else {
                    continue;
                };
                if (!value.is_truthy && statement.consequent.span().contains_inclusive(node_span))
                    || (value.is_truthy
                        && statement.alternate.as_ref().is_some_and(|alternate| {
                            alternate.span().contains_inclusive(node_span)
                        }))
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let Some(value) = nextjs_static_logical_value(&expression.test, ctx) else {
                    continue;
                };
                if (!value.is_truthy && expression.consequent.span().contains_inclusive(node_span))
                    || (value.is_truthy
                        && expression.alternate.span().contains_inclusive(node_span))
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(node_span) =>
            {
                if let Some(value) = nextjs_static_logical_value(&expression.left, ctx)
                    && !nextjs_logical_right_can_be_result(expression.operator, value)
                {
                    return true;
                }
            }
            AstKind::WhileStatement(statement)
                if statement.body.span().contains_inclusive(node_span)
                    && nextjs_static_logical_value(&statement.test, ctx)
                        .is_some_and(|value| !value.is_truthy) =>
            {
                return true;
            }
            AstKind::ForStatement(statement)
                if (statement.body.span().contains_inclusive(node_span)
                    || statement
                        .update
                        .as_ref()
                        .is_some_and(|update| update.span().contains_inclusive(node_span)))
                    && statement
                        .test
                        .as_ref()
                        .and_then(|test| nextjs_static_logical_value(test, ctx))
                        .is_some_and(|value| !value.is_truthy) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn nextjs_static_symbol_value_before<'a>(
    symbol_id: SymbolId,
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<NextjsStaticLogicalValue> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let mut latest_start = declarator.span.start;
    let mut latest_value = declarator
        .init
        .as_ref()
        .and_then(|initializer| nextjs_static_logical_value(initializer, ctx))
        .or_else(|| {
            declarator
                .init
                .is_none()
                .then_some(NextjsStaticLogicalValue {
                    is_nullish: true,
                    is_truthy: false,
                })
        });
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let write_node = ctx.nodes().get_node(reference.node_id());
        let Some(assignment_node_id) = nextjs_assignment_for_write(write_node, ctx) else {
            continue;
        };
        let assignment_node = ctx.nodes().get_node(assignment_node_id);
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        if assignment.operator != AssignmentOperator::Assign
            || assignment_node.span().start <= latest_start
            || assignment_node.span().start >= reference_node.span().start
            || !node_dominates_node(assignment_node, reference_node, ctx)
            || nextjs_node_is_statically_skipped(assignment_node, ctx)
            || !matches!(&assignment.left, oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(target) if ctx.scoping().get_reference(target.reference_id()).symbol_id() == Some(symbol_id))
        {
            continue;
        }
        latest_start = assignment_node.span().start;
        latest_value = nextjs_static_logical_value(&assignment.right, ctx);
    }
    latest_value
}

fn nextjs_expression_retains_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                == Some(symbol_id)
        }
        Expression::ConditionalExpression(conditional) => {
            if let Some(value) = nextjs_static_logical_value(&conditional.test, ctx) {
                return nextjs_expression_retains_symbol(
                    if value.is_truthy {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    symbol_id,
                    ctx,
                );
            }
            nextjs_expression_retains_symbol(&conditional.consequent, symbol_id, ctx)
                || nextjs_expression_retains_symbol(&conditional.alternate, symbol_id, ctx)
        }
        Expression::LogicalExpression(logical) => {
            let left_retains = nextjs_expression_retains_symbol(&logical.left, symbol_id, ctx);
            let right_retains = nextjs_expression_retains_symbol(&logical.right, symbol_id, ctx);
            if left_retains {
                return logical.operator != LogicalOperator::And || right_retains;
            }
            nextjs_static_logical_value(&logical.left, ctx).map_or(right_retains, |value| {
                nextjs_logical_right_can_be_result(logical.operator, value) && right_retains
            })
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .is_some_and(|expression| nextjs_expression_retains_symbol(expression, symbol_id, ctx)),
        Expression::AssignmentExpression(assignment) => {
            nextjs_expression_retains_symbol(&assignment.right, symbol_id, ctx)
        }
        Expression::CallExpression(call) => {
            call.callee.as_member_expression().is_some_and(|member| {
                matches!(
                    member_expression_identifier_property_name(member),
                    Some("then" | "catch" | "finally")
                ) && nextjs_expression_retains_symbol(member.object(), symbol_id, ctx)
            })
        }
        _ => false,
    }
}

fn nextjs_assignment_for_write<'a>(
    write_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(write_node.id()) {
        match ancestor.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.left.span().contains_inclusive(write_node.span()) =>
            {
                return Some(ancestor.id());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return None,
            _ => {}
        }
    }
    None
}

fn nextjs_assignment_pattern_retains_symbol(
    assignment: &oxc_ast::ast::AssignmentExpression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if nextjs_expression_retains_symbol(&assignment.right, symbol_id, ctx) {
        return true;
    }
    if matches!(
        assignment.left,
        oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(_)
    ) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| !reference.is_write())
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            assignment
                .left
                .span()
                .contains_inclusive(reference_node.span())
        })
}

fn nextjs_node_is_unconditional_within_span(
    node: &AstNode<'_>,
    boundary_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.span() == boundary_span {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::CatchClause(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::DoWhileStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::ForStatement(_)
                | AstKind::IfStatement(_)
                | AstKind::LogicalExpression(_)
                | AstKind::SwitchCase(_)
                | AstKind::SwitchStatement(_)
                | AstKind::TryStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::Function(_)
                | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn nextjs_statement_always_exits(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    use oxc_ast::ast::Statement;

    match statement {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => true,
        Statement::IfStatement(statement) => {
            if let Some(test_value) = static_literal_truthiness(&statement.test) {
                return if test_value {
                    nextjs_statement_always_exits(&statement.consequent)
                } else {
                    statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| nextjs_statement_always_exits(alternate))
                };
            }
            statement.alternate.as_ref().is_some_and(|alternate| {
                nextjs_statement_always_exits(&statement.consequent)
                    && nextjs_statement_always_exits(alternate)
            })
        }
        Statement::TryStatement(statement) => {
            if statement
                .finalizer
                .as_ref()
                .is_some_and(|finalizer| nextjs_statement_block_always_exits(finalizer))
            {
                return true;
            }
            nextjs_statement_block_always_exits(&statement.block)
                && statement
                    .handler
                    .as_ref()
                    .is_none_or(|handler| nextjs_statement_block_always_exits(&handler.body))
        }
        Statement::DoWhileStatement(statement) => nextjs_statement_always_exits(&statement.body),
        Statement::WhileStatement(statement) => {
            static_literal_truthiness(&statement.test) == Some(true)
                && nextjs_statement_always_exits(&statement.body)
        }
        Statement::ForStatement(statement) => {
            statement
                .test
                .as_ref()
                .is_none_or(|test| static_literal_truthiness(test) == Some(true))
                && nextjs_statement_always_exits(&statement.body)
        }
        Statement::BlockStatement(statement) => nextjs_statement_block_always_exits(statement),
        _ => false,
    }
}

fn nextjs_statement_block_always_exits(statement: &oxc_ast::ast::BlockStatement<'_>) -> bool {
    statement.body.iter().any(nextjs_statement_always_exits)
}

fn nextjs_clearing_assignment_dominates<'a>(
    clearing_node: &AstNode<'a>,
    clearing_nodes: &[&AstNode<'a>],
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if node_dominates_node(clearing_node, reference_node, ctx) {
        return true;
    }
    let clearing_span = clearing_node.span();
    for conditional in ctx.nodes().ancestors(clearing_node.id()) {
        if let AstKind::TryStatement(statement) = conditional.kind() {
            let clears_try_block = statement.block.span.contains_inclusive(clearing_span);
            let clears_handler = statement
                .handler
                .as_ref()
                .is_some_and(|handler| handler.body.span.contains_inclusive(clearing_span));
            let other_path_clears = if clears_try_block {
                statement.handler.as_ref().is_some_and(|handler| {
                    nextjs_statement_block_always_exits(&handler.body)
                        || clearing_nodes.iter().any(|candidate| {
                            handler.body.span.contains_inclusive(candidate.span())
                                && nextjs_node_is_unconditional_within_span(
                                    candidate,
                                    handler.body.span,
                                    ctx,
                                )
                        })
                })
            } else if clears_handler {
                clearing_nodes.iter().any(|candidate| {
                    statement.block.span.contains_inclusive(candidate.span())
                        && nextjs_node_is_unconditional_within_span(
                            candidate,
                            statement.block.span,
                            ctx,
                        )
                })
            } else {
                false
            };
            if other_path_clears && node_dominates_node(conditional, reference_node, ctx) {
                return true;
            }
            continue;
        }
        let (consequent_span, alternate_span) = match conditional.kind() {
            AstKind::IfStatement(statement) => {
                let Some(alternate) = &statement.alternate else {
                    continue;
                };
                (statement.consequent.span(), alternate.span())
            }
            AstKind::ConditionalExpression(expression) => {
                (expression.consequent.span(), expression.alternate.span())
            }
            _ => continue,
        };
        let clearing_is_consequent = consequent_span.contains_inclusive(clearing_span);
        let clearing_is_alternate = alternate_span.contains_inclusive(clearing_span);
        if !clearing_is_consequent && !clearing_is_alternate {
            continue;
        }
        let other_branch = if clearing_is_consequent {
            alternate_span
        } else {
            consequent_span
        };
        let has_other_clear = clearing_nodes.iter().any(|candidate| {
            other_branch.contains_inclusive(candidate.span())
                && nextjs_node_is_unconditional_within_span(candidate, other_branch, ctx)
        });
        if has_other_clear && node_dominates_node(conditional, reference_node, ctx) {
            return true;
        }
    }
    false
}

fn nextjs_pending_identifier_source<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<oxc_span::Span> {
    nextjs_pending_symbol_source_before(
        symbol_id,
        ctx.nodes().get_node(identifier.node_id.get()),
        ctx,
        visited_symbols,
    )
}

fn nextjs_pending_symbol_source_before<'a>(
    symbol_id: SymbolId,
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<oxc_span::Span> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let reference_owner =
        crate::ast_util::get_enclosing_function(reference_node, ctx).map(AstNode::id);
    let declaration_owner =
        crate::ast_util::get_enclosing_function(declaration, ctx).map(AstNode::id);
    if reference_owner != declaration_owner {
        let owner_id = reference_owner?;
        return nextjs_direct_execution_sites(owner_id, ctx)
            .into_iter()
            .find_map(|invocation_node_id| {
                nextjs_pending_symbol_source_before(
                    symbol_id,
                    ctx.nodes().get_node(invocation_node_id),
                    ctx,
                    visited_symbols,
                )
            });
    }
    let mut pending_sources = Vec::new();
    if let Some(initializer) = &declarator.init
        && let Some(source) = nextjs_pending_const_source(initializer, ctx, visited_symbols)
    {
        pending_sources.push((initializer.span().start, source));
    }
    let mut clearing_nodes = Vec::new();
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let write_node = ctx.nodes().get_node(reference.node_id());
        let Some(assignment_node_id) = nextjs_assignment_for_write(write_node, ctx) else {
            continue;
        };
        let assignment_node = ctx.nodes().get_node(assignment_node_id);
        if assignment_node.span().start >= reference_node.span().start
            || crate::ast_util::get_enclosing_function(assignment_node, ctx).map(AstNode::id)
                != reference_owner
            || nextjs_node_is_statically_skipped(assignment_node, ctx)
        {
            continue;
        }
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        let static_left_value = nextjs_static_symbol_value_before(symbol_id, assignment_node, ctx);
        let logical_right_is_skipped = match assignment.operator {
            AssignmentOperator::LogicalAnd => {
                static_left_value.is_some_and(|value| !value.is_truthy)
            }
            AssignmentOperator::LogicalOr => static_left_value.is_some_and(|value| value.is_truthy),
            AssignmentOperator::LogicalNullish => {
                static_left_value.is_some_and(|value| !value.is_nullish)
            }
            _ => false,
        };
        if logical_right_is_skipped {
            continue;
        }
        let retained_source = nextjs_pending_const_source(&assignment.right, ctx, visited_symbols);
        if matches!(
            assignment.operator,
            AssignmentOperator::Assign
                | AssignmentOperator::LogicalAnd
                | AssignmentOperator::LogicalOr
                | AssignmentOperator::LogicalNullish
        ) {
            if let Some(source) = retained_source {
                pending_sources.push((assignment.span.start, source));
                continue;
            }
        }
        if nextjs_assignment_pattern_retains_symbol(assignment, symbol_id, ctx)
            || (matches!(
                assignment.operator,
                AssignmentOperator::LogicalOr | AssignmentOperator::LogicalNullish
            ) && static_left_value.is_none())
        {
            continue;
        }
        clearing_nodes.push(assignment_node);
    }
    pending_sources.sort_by_key(|(start, _)| *start);
    pending_sources
        .into_iter()
        .rev()
        .find_map(|(source_start, source)| {
            (!clearing_nodes.iter().any(|clearing_node| {
                clearing_node.span().start > source_start
                    && nextjs_clearing_assignment_dominates(
                        clearing_node,
                        &clearing_nodes,
                        reference_node,
                        ctx,
                    )
            }))
            .then_some(source)
        })
}

fn nextjs_report_pending_assignment_target<'a>(
    assignment_node: &AstNode<'a>,
    assignment: &oxc_ast::ast::AssignmentExpression<'a>,
    ctx: &LintContext<'a>,
) {
    if assignment.operator == AssignmentOperator::Assign {
        return;
    }
    let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
    else {
        return;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return;
    };
    if let Some(source_span) =
        nextjs_pending_symbol_source_before(symbol_id, assignment_node, ctx, &mut Vec::new())
    {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(source_span));
        return;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let Some(function) = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return;
    };
    let Some((parameter, property_names)) = nextjs_official_function_contract(function, ctx) else {
        return;
    };
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &parameter.pattern else {
        return;
    };
    if pattern.properties.iter().any(|property| {
        property
            .value
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
            && property
                .key
                .static_name()
                .is_some_and(|name| property_names.contains(&name.as_ref()))
    }) && !nextjs_official_identifier_is_cleared_before(symbol_id, assignment_node, ctx)
    {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(identifier.span));
    }
}

fn nextjs_direct_execution_sites<'a>(
    function_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> Vec<NodeId> {
    let mut invocation_nodes = Vec::new();
    for candidate in ctx.nodes().iter() {
        if nextjs_node_is_statically_skipped(candidate, ctx) {
            continue;
        }
        match candidate.kind() {
            AstKind::CallExpression(call) => {
                if nextjs_callback_function_id_at_invocation(
                    &call.callee,
                    candidate,
                    ctx,
                    &mut Vec::new(),
                ) == Some(function_id)
                {
                    invocation_nodes.push(candidate.id());
                    continue;
                }
                let is_synchronous_iterator = call
                    .callee
                    .as_member_expression()
                    .and_then(member_expression_identifier_property_name)
                    .is_some_and(|method| {
                        matches!(
                            method,
                            "every"
                                | "filter"
                                | "find"
                                | "findIndex"
                                | "flatMap"
                                | "forEach"
                                | "map"
                                | "reduce"
                                | "reduceRight"
                                | "some"
                                | "sort"
                                | "toSorted"
                        )
                    });
                if is_synchronous_iterator
                    && call.arguments.iter().any(|argument| {
                        argument.as_expression().is_some_and(|argument| {
                            nextjs_callback_function_id_at_invocation(
                                argument,
                                candidate,
                                ctx,
                                &mut Vec::new(),
                            ) == Some(function_id)
                        })
                    })
                    && call.callee.as_member_expression().is_some_and(|member| {
                        nextjs_callback_receiver_is_provably_nonempty(member.object(), ctx)
                    })
                {
                    invocation_nodes.push(candidate.id());
                }
            }
            AstKind::NewExpression(construction)
                if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Promise" && ctx.is_reference_to_global_variable(identifier))
                    && construction
                        .arguments
                        .first()
                        .and_then(|argument| argument.as_expression())
                        .is_some_and(|argument| {
                            nextjs_callback_function_id_at_invocation(
                                argument,
                                candidate,
                                ctx,
                                &mut Vec::new(),
                            ) == Some(function_id)
                        }) =>
            {
                invocation_nodes.push(candidate.id());
            }
            _ => {}
        }
    }
    invocation_nodes
}

fn nextjs_callback_function_id_at_invocation<'a>(
    expression: &'a Expression<'a>,
    invocation_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) if !function.generator => {
            Some(function.node_id.get())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            visited_symbols.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::Function(function) = declaration.kind()
                && !function.generator
            {
                visited_symbols.pop();
                return Some(function.node_id.get());
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                visited_symbols.pop();
                return None;
            };
            if declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                visited_symbols.pop();
                return None;
            }
            let Some(mut selected_expression) = declarator.init.as_ref() else {
                visited_symbols.pop();
                return None;
            };
            let mut selected_start = declarator.span.start;
            let invocation_owner =
                crate::ast_util::get_enclosing_function(invocation_node, ctx).map(AstNode::id);
            for reference in ctx.scoping().get_resolved_references(symbol_id) {
                if !reference.is_write() {
                    continue;
                }
                let write_node = ctx.nodes().get_node(reference.node_id());
                let Some(assignment_node_id) = nextjs_assignment_for_write(write_node, ctx) else {
                    continue;
                };
                let assignment_node = ctx.nodes().get_node(assignment_node_id);
                if assignment_node.span().start <= selected_start
                    || assignment_node.span().start >= invocation_node.span().start
                    || crate::ast_util::get_enclosing_function(assignment_node, ctx)
                        .map(AstNode::id)
                        != invocation_owner
                    || !node_dominates_node(assignment_node, invocation_node, ctx)
                {
                    continue;
                }
                let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
                    continue;
                };
                if assignment.operator != AssignmentOperator::Assign
                    || !matches!(&assignment.left, oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(target) if ctx.scoping().get_reference(target.reference_id()).symbol_id() == Some(symbol_id))
                {
                    continue;
                }
                selected_expression = &assignment.right;
                selected_start = assignment_node.span().start;
            }
            let function_id = nextjs_callback_function_id_at_invocation(
                selected_expression,
                invocation_node,
                ctx,
                visited_symbols,
            );
            visited_symbols.pop();
            function_id
        }
        _ => None,
    }
}

fn nextjs_callback_receiver_is_provably_nonempty(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => array.elements.iter().any(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                nextjs_callback_receiver_is_provably_nonempty(&spread.argument, ctx)
            }
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => false,
            _ => true,
        }),
        Expression::StringLiteral(literal) => !literal.value.is_empty(),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()
            .is_some_and(|quasi| !quasi.value.raw.is_empty()),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            declarator.init.as_ref().is_some_and(|initializer| {
                nextjs_callback_receiver_is_provably_nonempty(initializer, ctx)
            })
        }
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.as_member_expression() else {
                return false;
            };
            let Some(method_name) = static_member_expression_property_name(member) else {
                return false;
            };
            if !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Array" && ctx.is_reference_to_global_variable(identifier))
            {
                return false;
            }
            if method_name == "from" {
                return call
                    .arguments
                    .first()
                    .and_then(|argument| argument.as_expression())
                    .is_some_and(|source| {
                        nextjs_callback_receiver_is_provably_nonempty(source, ctx)
                    });
            }
            method_name == "of"
                && call
                    .arguments
                    .iter()
                    .any(|argument| argument.as_expression().is_some())
        }
        Expression::NewExpression(construction) => {
            if !matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Array" && ctx.is_reference_to_global_variable(identifier))
            {
                return false;
            }
            if construction.arguments.len() != 1 {
                return construction
                    .arguments
                    .iter()
                    .any(|argument| argument.as_expression().is_some());
            }
            construction
                .arguments
                .first()
                .and_then(|argument| argument.as_expression())
                .is_some_and(|argument| {
                    !matches!(
                        argument.get_inner_expression(),
                        Expression::NumericLiteral(_)
                    )
                })
        }
        _ => false,
    }
}

fn nextjs_pending_const_source<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_span::Span> {
    if !has_capability(ctx, "nextjs:16") {
        let unsafe_type = match expression {
            Expression::TSAsExpression(cast) => Some(&cast.type_annotation),
            Expression::TSTypeAssertion(cast) => Some(&cast.type_annotation),
            _ => None,
        };
        if unsafe_type.is_some_and(|type_annotation| {
            nextjs_is_unsafe_unwrapped_type(type_annotation, ctx, &mut Vec::new())
        }) {
            return None;
        }
    }
    match expression.get_inner_expression() {
        Expression::CallExpression(call) if nextjs_dynamic_api_call(call, ctx) => Some(call.span),
        Expression::CallExpression(call) => {
            let member = call.callee.as_member_expression()?;
            if !matches!(
                member_expression_identifier_property_name(member),
                Some("then" | "catch" | "finally")
            ) {
                return None;
            }
            nextjs_pending_const_source(member.object(), ctx, visited_symbols)
        }
        Expression::ConditionalExpression(conditional) => {
            if let Some(value) = nextjs_static_logical_value(&conditional.test, ctx) {
                return nextjs_pending_const_source(
                    if value.is_truthy {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    ctx,
                    visited_symbols,
                );
            }
            nextjs_pending_const_source(&conditional.alternate, ctx, visited_symbols).or_else(
                || nextjs_pending_const_source(&conditional.consequent, ctx, visited_symbols),
            )
        }
        Expression::LogicalExpression(logical) => {
            let left_source = nextjs_pending_const_source(&logical.left, ctx, visited_symbols);
            let right_source = nextjs_pending_const_source(&logical.right, ctx, visited_symbols);
            if left_source.is_some() {
                return if logical.operator == LogicalOperator::And {
                    right_source
                } else {
                    left_source
                };
            }
            nextjs_static_logical_value(&logical.left, ctx).map_or(right_source, |value| {
                nextjs_logical_right_can_be_result(logical.operator, value)
                    .then_some(right_source)
                    .flatten()
            })
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .and_then(|expression| nextjs_pending_const_source(expression, ctx, visited_symbols)),
        Expression::AssignmentExpression(assignment) => {
            nextjs_pending_const_source(&assignment.right, ctx, visited_symbols)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbols.contains(&symbol_id) {
                return None;
            }
            visited_symbols.push(symbol_id);
            let source =
                nextjs_pending_identifier_source(identifier, symbol_id, ctx, visited_symbols);
            visited_symbols.pop();
            source
        }
        _ => None,
    }
}

fn nextjs_report_pending_consumption<'a>(expression: &'a Expression<'a>, ctx: &LintContext<'a>) {
    if matches!(expression.get_inner_expression(), Expression::CallExpression(call) if nextjs_dynamic_api_call(call, ctx))
    {
        return;
    }
    if let Some(source_span) = nextjs_official_prop_source(expression, ctx) {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(source_span));
        return;
    }
    if let Some(source_span) = nextjs_pending_const_source(expression, ctx, &mut Vec::new()) {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(source_span));
    }
}

fn nextjs_report_dynamic_pending_consumption<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) {
    if matches!(expression.get_inner_expression(), Expression::CallExpression(call) if nextjs_dynamic_api_call(call, ctx))
    {
        return;
    }
    if let Some(source_span) = nextjs_pending_const_source(expression, ctx, &mut Vec::new()) {
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(source_span));
    }
}

fn nextjs_dynamic_api_call<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    nextjs_dynamic_api_call_inner(call, ctx, &mut Vec::new())
}

fn nextjs_dynamic_api_call_inner<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    match &call.callee {
        Expression::Identifier(identifier) => {
            if resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
                entry.module_request.name() == "next/headers"
                    && matches!(
                        &entry.import_name,
                        crate::module_record::ImportImportName::Name(imported_name)
                            if DYNAMIC_API_NAMES.contains(&imported_name.name())
                    )
            }) {
                return true;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbols.contains(&symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::Function(function) = declaration.kind() {
                if !call.arguments.is_empty() || !function.params.items.is_empty() {
                    return false;
                }
                let Some(returned_expression) = function
                    .body
                    .as_ref()
                    .and_then(|body| nextjs_single_return_expression(&body.statements))
                else {
                    return false;
                };
                let Expression::CallExpression(returned_call) =
                    returned_expression.get_inner_expression()
                else {
                    return false;
                };
                visited_symbols.push(symbol_id);
                let matches = nextjs_dynamic_api_call_inner(returned_call, ctx, visited_symbols);
                visited_symbols.pop();
                return matches;
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let variable_declaration = ctx.nodes().parent_node(declaration.id());
            if !matches!(variable_declaration.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                return false;
            }
            if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id {
                let imported_name = pattern.properties.iter().find_map(|property| {
                    property
                        .value
                        .get_binding_identifier()
                        .is_some_and(|binding| binding.symbol_id() == symbol_id)
                        .then(|| property.key.static_name())
                        .flatten()
                });
                if imported_name.is_some_and(|name| DYNAMIC_API_NAMES.contains(&name.as_ref()))
                    && matches!(
                        declarator.init.as_ref().map(Expression::get_inner_expression),
                        Some(Expression::Identifier(namespace))
                            if resolve_identifier_import(namespace, ctx).is_some_and(|entry| {
                                entry.module_request.name() == "next/headers"
                                    && matches!(entry.import_name, crate::module_record::ImportImportName::NamespaceObject)
                            })
                    )
                {
                    return true;
                }
            }
            if call.arguments.is_empty() {
                let returned_expression = match declarator
                    .init
                    .as_ref()
                    .map(Expression::get_inner_expression)
                {
                    Some(Expression::ArrowFunctionExpression(function))
                        if function.params.items.is_empty() =>
                    {
                        function.get_expression().or_else(|| {
                            function
                                .get_function_body()
                                .and_then(|body| nextjs_single_return_expression(&body.statements))
                        })
                    }
                    Some(Expression::FunctionExpression(function))
                        if function.params.items.is_empty() =>
                    {
                        function
                            .body
                            .as_ref()
                            .and_then(|body| nextjs_single_return_expression(&body.statements))
                    }
                    _ => None,
                };
                if let Some(Expression::CallExpression(returned_call)) =
                    returned_expression.map(Expression::get_inner_expression)
                {
                    visited_symbols.push(symbol_id);
                    let matches =
                        nextjs_dynamic_api_call_inner(returned_call, ctx, visited_symbols);
                    visited_symbols.pop();
                    if matches {
                        return true;
                    }
                }
            }
            let Some(member) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
                .and_then(Expression::as_member_expression)
            else {
                return false;
            };
            nextjs_dynamic_namespace_member_matches(member, ctx)
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member| nextjs_dynamic_namespace_member_matches(member, ctx)),
    }
}

fn nextjs_single_return_expression<'a, 'b>(
    statements: &'b [oxc_ast::ast::Statement<'a>],
) -> Option<&'b Expression<'a>> {
    let [oxc_ast::ast::Statement::ReturnStatement(statement)] = statements else {
        return None;
    };
    statement.argument.as_ref()
}

fn nextjs_dynamic_namespace_member_matches<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(api_name) = nextjs_dynamic_member_name(member, ctx, &mut Vec::new()) else {
        return false;
    };
    DYNAMIC_API_NAMES.contains(&api_name)
        && matches!(
            member.object().get_inner_expression(),
            Expression::Identifier(namespace)
                if resolve_identifier_import(namespace, ctx).is_some_and(|entry| {
                    entry.module_request.name() == "next/headers"
                        && matches!(
                            entry.import_name,
                            crate::module_record::ImportImportName::NamespaceObject
                        )
                })
        )
}

fn nextjs_dynamic_member_name<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'a str> {
    match member {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            nextjs_static_string(&member.expression, ctx, visited_symbols)
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn nextjs_static_string<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<&'a str> {
    if let Some(value) = get_static_string_expression(expression) {
        return Some(value);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited_symbols.contains(&symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let variable_declaration = ctx.nodes().parent_node(declaration.id());
    if !matches!(variable_declaration.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return None;
    }
    visited_symbols.push(symbol_id);
    let value = nextjs_static_string(declarator.init.as_ref()?, ctx, visited_symbols);
    visited_symbols.pop();
    value
}

fn nextjs_global_string_raw_tag(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        expression if expression.as_member_expression().is_some_and(|member| {
            static_member_expression_property_name(member) == Some("raw")
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "String" && ctx.is_reference_to_global_variable(identifier))
        }) => true,
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbols.contains(&symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                return false;
            }
            let Some(initializer) = &declarator.init else {
                return false;
            };
            visited_symbols.push(symbol_id);
            let matches = nextjs_global_string_raw_tag(initializer, ctx, visited_symbols);
            visited_symbols.pop();
            matches
        }
        _ => false,
    }
}

fn nextjs_dynamic_call_is_consumed<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::AwaitExpression(_) => false,
        AstKind::CallExpression(parent_call) => {
            if parent_call.arguments.first().is_some_and(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|expression| expression.span() == root.span())
            }) && nextjs_react_use_call(parent_call, ctx)
            {
                return false;
            }
            nextjs_call_consumes_dynamic_value(parent_call, root.span(), ctx)
        }
        AstKind::StaticMemberExpression(member) => {
            member.object.span() == root.span()
                && !matches!(member.property.name.as_str(), "then" | "catch" | "finally")
        }
        AstKind::ComputedMemberExpression(member) => {
            member.object.span() == root.span()
                && !matches!(
                    nextjs_static_string(&member.expression, ctx, &mut Vec::new()),
                    Some("then" | "catch" | "finally")
                )
        }
        AstKind::PrivateFieldExpression(member) => member.object.span() == root.span(),
        AstKind::VariableDeclarator(declarator) => {
            nextjs_binding_pattern_consumes_dynamic_value(&declarator.id)
        }
        AstKind::AssignmentExpression(assignment) => {
            nextjs_assignment_target_consumes_dynamic_value(&assignment.left)
        }
        AstKind::NewExpression(construction) => {
            nextjs_new_consumes_dynamic_value(construction, root.span(), ctx)
        }
        AstKind::SpreadElement(_)
        | AstKind::JSXSpreadAttribute(_)
        | AstKind::ForInStatement(_)
        | AstKind::ForOfStatement(_) => true,
        AstKind::YieldExpression(expression) => expression.delegate,
        AstKind::UnaryExpression(expression) => !matches!(
            expression.operator,
            UnaryOperator::LogicalNot | UnaryOperator::Typeof | UnaryOperator::Void
        ),
        AstKind::BinaryExpression(expression) => {
            expression.operator != BinaryOperator::In || expression.right.span() == root.span()
        }
        AstKind::TemplateLiteral(_) => {
            let template_parent = ctx.nodes().parent_node(parent.id());
            !matches!(template_parent.kind(), AstKind::TaggedTemplateExpression(_))
                || matches!(template_parent.kind(), AstKind::TaggedTemplateExpression(tagged) if nextjs_global_string_raw_tag(&tagged.tag, ctx, &mut Vec::new()))
        }
        AstKind::JSXExpressionContainer(_) => true,
        _ => false,
    }
}

fn nextjs_binding_pattern_consumes_dynamic_value(
    pattern: &oxc_ast::ast::BindingPattern<'_>,
) -> bool {
    match pattern {
        oxc_ast::ast::BindingPattern::ArrayPattern(_) => true,
        oxc_ast::ast::BindingPattern::ObjectPattern(pattern) => {
            pattern.rest.is_some()
                || pattern.properties.iter().any(|property| {
                    !matches!(
                        property.key.static_name().as_deref(),
                        Some("then" | "catch" | "finally")
                    )
                })
        }
        _ => false,
    }
}

fn nextjs_assignment_target_consumes_dynamic_value(
    target: &oxc_ast::ast::AssignmentTarget<'_>,
) -> bool {
    match target {
        oxc_ast::ast::AssignmentTarget::ArrayAssignmentTarget(_) => true,
        oxc_ast::ast::AssignmentTarget::ObjectAssignmentTarget(pattern) => {
            pattern.rest.is_some()
                || pattern.properties.iter().any(|property| match property {
                    oxc_ast::ast::AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(
                        property,
                    ) => !matches!(property.binding.name.as_str(), "then" | "catch" | "finally"),
                    oxc_ast::ast::AssignmentTargetProperty::AssignmentTargetPropertyProperty(
                        property,
                    ) => !matches!(
                        property.name.static_name().as_deref(),
                        Some("then" | "catch" | "finally")
                    ),
                })
        }
        _ => false,
    }
}

fn nextjs_react_use_call<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match &call.callee {
        Expression::Identifier(identifier) => {
            nextjs_is_named_react_api_import(identifier, "use", ctx)
                || nextjs_is_destructured_react_api_binding(identifier, "use", ctx)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            if static_member_expression_property_name(member) != Some("use") {
                return false;
            }
            let Expression::Identifier(namespace) = member.object().get_inner_expression() else {
                return false;
            };
            let Some(symbol_id) = nextjs_resolve_const_identifier_alias(namespace, ctx) else {
                return false;
            };
            nextjs_matching_react_import(symbol_id, ctx).is_some_and(|entry| {
                matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Default(_)
                        | crate::module_record::ImportImportName::NamespaceObject
                ) || matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == "default"
                )
            })
        }),
    }
}

fn nextjs_is_named_react_api_import<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = nextjs_resolve_const_identifier_alias(identifier, ctx) else {
        return false;
    };
    nextjs_matching_react_import(symbol_id, ctx).is_some_and(|entry| {
        matches!(
            &entry.import_name,
            crate::module_record::ImportImportName::Name(imported_name)
                if imported_name.name() == api_name
        )
    })
}

fn nextjs_is_destructured_react_api_binding<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    api_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const() {
        return false;
    }
    let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    let has_matching_property = pattern.properties.iter().any(|property| {
        if property.computed || !nextjs_property_key_matches_name(&property.key, api_name) {
            return false;
        }
        matches!(
            &property.value,
            oxc_ast::ast::BindingPattern::BindingIdentifier(binding_identifier)
                if binding_identifier.symbol_id() == symbol_id
        )
    });
    has_matching_property
        && declarator.init.as_ref().is_some_and(|initializer| {
            nextjs_is_react_namespace_receiver(initializer.get_inner_expression(), ctx)
        })
}

fn nextjs_is_react_namespace_receiver<'a>(
    receiver: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = receiver else {
        return false;
    };
    let Some(symbol_id) = nextjs_resolve_const_identifier_alias(identifier, ctx) else {
        return false;
    };
    nextjs_matching_react_import(symbol_id, ctx).is_some_and(|entry| {
        matches!(
            &entry.import_name,
            crate::module_record::ImportImportName::Default(_)
                | crate::module_record::ImportImportName::NamespaceObject
        ) || matches!(
            &entry.import_name,
            crate::module_record::ImportImportName::Name(imported_name)
                if imported_name.name() == "default"
        )
    })
}

fn nextjs_property_key_matches_name(property_key: &oxc_ast::ast::PropertyKey, name: &str) -> bool {
    match property_key {
        oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) => identifier.name == name,
        oxc_ast::ast::PropertyKey::Identifier(identifier) => identifier.name == name,
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => literal.value == name,
        oxc_ast::ast::PropertyKey::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().is_some_and(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                    == name
            })
        }
        _ => false,
    }
}

fn nextjs_resolve_const_identifier_alias<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let mut visited_symbols = Vec::new();
    loop {
        if visited_symbols.contains(&symbol_id) {
            return None;
        }
        visited_symbols.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return Some(symbol_id);
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
            return Some(symbol_id);
        };
        if !variable_declaration.kind.is_const()
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
        {
            return None;
        }
        let Some(Expression::Identifier(next_identifier)) = declarator
            .init
            .as_ref()
            .map(|initializer| initializer.get_inner_expression())
        else {
            return Some(symbol_id);
        };
        symbol_id = ctx
            .scoping()
            .get_reference(next_identifier.reference_id())
            .symbol_id()?;
    }
}

fn nextjs_matching_react_import<'a>(
    symbol_id: SymbolId,
    ctx: &'a LintContext<'_>,
) -> Option<&'a crate::module_record::ImportEntry> {
    ctx.module_record().import_entries.iter().find(|entry| {
        NEXTJS_REACT_RUNTIME_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn nextjs_call_consumes_dynamic_value<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    dynamic_span: oxc_span::Span,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(dynamic_argument_index) = call.arguments.iter().position(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == dynamic_span)
    }) else {
        return false;
    };
    if let Expression::Identifier(identifier) = call.callee.get_inner_expression() {
        return dynamic_argument_index == 0
            && matches!(
                identifier.name.as_str(),
                "BigInt"
                    | "Boolean"
                    | "decodeURI"
                    | "decodeURIComponent"
                    | "Number"
                    | "String"
                    | "encodeURI"
                    | "encodeURIComponent"
                    | "isFinite"
                    | "isNaN"
                    | "parseFloat"
                    | "parseInt"
            )
            && ctx.is_reference_to_global_variable(identifier);
    }
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    if !ctx.is_reference_to_global_variable(receiver) {
        return false;
    }
    let Some(method_name) = nextjs_dynamic_member_name(member, ctx, &mut Vec::new()) else {
        return false;
    };
    match receiver.name.as_str() {
        "Array" => method_name == "from" && dynamic_argument_index == 0,
        "JSON" => method_name == "stringify" && dynamic_argument_index == 0,
        "Reflect" => {
            if dynamic_argument_index != 0 {
                return false;
            }
            if matches!(method_name, "get" | "getOwnPropertyDescriptor" | "has")
                && call
                    .arguments
                    .get(1)
                    .and_then(|argument| argument.as_expression())
                    .is_some_and(|property| {
                        matches!(
                            nextjs_static_string(property, ctx, &mut Vec::new()),
                            Some("then" | "catch" | "finally")
                        )
                    })
            {
                return false;
            }
            matches!(
                method_name,
                "get" | "getOwnPropertyDescriptor" | "has" | "ownKeys"
            )
        }
        "Object" => {
            if method_name == "getOwnPropertyDescriptor"
                && call
                    .arguments
                    .get(1)
                    .and_then(|argument| argument.as_expression())
                    .is_some_and(|property| {
                        matches!(
                            nextjs_static_string(property, ctx, &mut Vec::new()),
                            Some("then" | "catch" | "finally")
                        )
                    })
            {
                return false;
            }
            (dynamic_argument_index == 0
                && matches!(
                    method_name,
                    "entries"
                        | "fromEntries"
                        | "getOwnPropertyDescriptor"
                        | "getOwnPropertyDescriptors"
                        | "getOwnPropertyNames"
                        | "getOwnPropertySymbols"
                        | "keys"
                        | "values"
                ))
                || (method_name == "assign" && dynamic_argument_index > 0)
        }
        _ => false,
    }
}

fn nextjs_call_uses_official_direct_value_semantics<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    dynamic_span: oxc_span::Span,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(dynamic_argument_index) = call.arguments.iter().position(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == dynamic_span)
    }) else {
        return false;
    };
    if dynamic_argument_index != 0 {
        return false;
    }
    if let Expression::Identifier(identifier) = call.callee.get_inner_expression() {
        return matches!(
            identifier.name.as_str(),
            "BigInt"
                | "Boolean"
                | "decodeURI"
                | "decodeURIComponent"
                | "Number"
                | "String"
                | "encodeURI"
                | "encodeURIComponent"
                | "isFinite"
                | "isNaN"
                | "parseFloat"
                | "parseInt"
        ) && ctx.is_reference_to_global_variable(identifier);
    }
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    matches!(
        member.object().get_inner_expression(),
        Expression::Identifier(receiver)
            if receiver.name == "JSON"
                && ctx.is_reference_to_global_variable(receiver)
                && nextjs_dynamic_member_name(member, ctx, &mut Vec::new()) == Some("stringify")
    )
}

fn nextjs_new_consumes_dynamic_value<'a>(
    construction: &'a oxc_ast::ast::NewExpression<'a>,
    dynamic_span: oxc_span::Span,
    ctx: &LintContext<'a>,
) -> bool {
    if !construction.arguments.first().is_some_and(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == dynamic_span)
    }) {
        return false;
    }
    matches!(
        construction.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if matches!(
                identifier.name.as_str(),
                "Headers" | "Map" | "Set" | "URLSearchParams" | "WeakMap" | "WeakSet"
            ) && ctx.is_reference_to_global_variable(identifier)
    )
}
