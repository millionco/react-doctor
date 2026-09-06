use std::collections::HashSet;

use oxc_ast::ast::{
    Argument, AssignmentTarget, ClassElement, Expression, MemberExpression, ObjectPropertyKind,
    PropertyKey,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;

use crate::{
    AstNode,
    context::LintContext,
    rule::Rule,
    utils::{is_es5_component, is_es6_component},
};

const MESSAGE: &str =
    "This component shows up as Anonymous in React DevTools because it has no `displayName`.";
const DEFAULT_ADDITIONAL_HOCS: [&str; 3] = ["observer", "lazy", "withTracking"];

#[derive(Debug, Default, Clone)]
pub struct DisplayName;

struct Settings {
    ignore_transpiler_name: bool,
    check_context_objects: bool,
    react_version: String,
    additional_hocs: HashSet<String>,
}

#[derive(Default)]
struct DisplayNameAssignments {
    identifier_targets: HashSet<String>,
    member_path_segments: HashSet<String>,
}

declare_oxc_lint!(
    /// Require React components to have an inferable display name.
    DisplayName,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require React components to have an inferable display name.",
);

impl Rule for DisplayName {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = resolve_display_name_settings(ctx);
        let assignments = collect_display_name_assignments(ctx);
        let curated_behavior = should_use_curated_port_behavior(ctx);

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Class(_) => check_display_name_class(node, &settings, &assignments, ctx),
                AstKind::Function(function) if function.is_expression() => {
                    check_display_name_function_expression(
                        node,
                        &settings,
                        &assignments,
                        curated_behavior,
                        ctx,
                    );
                }
                AstKind::Function(function) if function.is_function_declaration() => {
                    check_display_name_function_declaration(
                        node,
                        &assignments,
                        curated_behavior,
                        ctx,
                    );
                }
                AstKind::ArrowFunctionExpression(_) => {
                    check_display_name_arrow_function(node, &settings, curated_behavior, ctx)
                }
                AstKind::CallExpression(_) => {
                    check_display_name_call(node, &settings, &assignments, ctx);
                }
                _ => {}
            }
        }
    }
}

fn resolve_display_name_settings(ctx: &LintContext<'_>) -> Settings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("displayName"));
    let additional_hocs = rule_settings
        .and_then(|settings| settings.get("additionalHoCs"))
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_else(|| {
            DEFAULT_ADDITIONAL_HOCS
                .into_iter()
                .map(str::to_owned)
                .collect()
        });
    Settings {
        ignore_transpiler_name: boolean_display_name_setting(rule_settings, "ignoreTranspilerName"),
        check_context_objects: boolean_display_name_setting(rule_settings, "checkContextObjects"),
        react_version: rule_settings
            .and_then(|settings| settings.get("reactVersion"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        additional_hocs,
    }
}

fn boolean_display_name_setting(settings: Option<&serde_json::Value>, name: &str) -> bool {
    settings
        .and_then(|settings| settings.get(name))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

fn report_missing_display_name(span: Span, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
}

fn check_display_name_class<'a>(
    node: &AstNode<'a>,
    settings: &Settings,
    assignments: &DisplayNameAssignments,
    ctx: &LintContext<'a>,
) {
    let AstKind::Class(class) = node.kind() else {
        return;
    };
    if !is_es6_component(node) {
        return;
    }
    let name = class.id.as_ref();
    if name.is_some_and(|name| {
        is_react_component_name(name.name.as_str()) && !settings.ignore_transpiler_name
    }) || class_has_display_name_member(class)
        || name.is_some_and(|name| assignments.identifier_targets.contains(name.name.as_str()))
    {
        return;
    }
    report_missing_display_name(name.map_or(class.span, GetSpan::span), ctx);
}

fn class_has_display_name_member(class: &oxc_ast::ast::Class<'_>) -> bool {
    class.body.body.iter().any(|element| match element {
        ClassElement::MethodDefinition(method) => {
            method.r#static
                && matches!(&method.key, PropertyKey::StaticIdentifier(identifier) if identifier.name == "displayName")
        }
        ClassElement::PropertyDefinition(property) => {
            property.r#static
                && matches!(&property.key, PropertyKey::StaticIdentifier(identifier) if identifier.name == "displayName")
        }
        _ => false,
    })
}

fn check_display_name_function_expression<'a>(
    node: &AstNode<'a>,
    settings: &Settings,
    assignments: &DisplayNameAssignments,
    curated_behavior: bool,
    ctx: &LintContext<'a>,
) {
    let AstKind::Function(function) = node.kind() else {
        return;
    };
    if !node_contains_jsx(node, ctx) {
        return;
    }
    if !curated_behavior && function.id.is_none() && is_module_exports_assignment(node, ctx) {
        report_missing_display_name(node.span(), ctx);
        return;
    }
    if !curated_behavior
        && !function_contains_react_render_output(node, ctx)
        && !node_contains_bare_create_element_call(node, ctx)
    {
        return;
    }
    if function.id.as_ref().is_some_and(|identifier| {
        is_react_component_name(identifier.name.as_str()) && !settings.ignore_transpiler_name
    }) {
        return;
    }
    let parent = ctx.nodes().parent_node(node.id());
    if let AstKind::ObjectProperty(property) = parent.kind()
        && property.method
        && let Some(property_name) = object_property_display_name(property)
        && is_react_component_name(property_name)
        && settings.ignore_transpiler_name
        && !assignments.member_path_segments.contains(property_name)
    {
        report_missing_display_name(node.span(), ctx);
        return;
    }
    if get_assigned_name(node, ctx)
        .is_some_and(|name| is_react_component_name(name) && !settings.ignore_transpiler_name)
    {
        return;
    }
    if is_module_exports_assignment(node, ctx) && function.id.is_none() {
        report_missing_display_name(node.span(), ctx);
        return;
    }
    if function.id.is_none() && matches!(parent.kind(), AstKind::ReturnStatement(_)) {
        report_missing_display_name(node.span(), ctx);
    }
}

fn object_property_display_name<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    if property.computed {
        return match &property.key {
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        };
    }
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn check_display_name_arrow_function<'a>(
    node: &AstNode<'a>,
    settings: &Settings,
    curated_behavior: bool,
    ctx: &LintContext<'a>,
) {
    let expression_root = display_name_skip_parentheses(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let is_default_export = matches!(parent.kind(), AstKind::ExportDefaultDeclaration(_));
    if !node_contains_jsx(node, ctx) && !is_default_export {
        return;
    }
    if !curated_behavior && is_module_exports_assignment(node, ctx) {
        report_missing_display_name(node.span(), ctx);
        return;
    }
    if !curated_behavior
        && !function_contains_react_render_output(node, ctx)
        && !node_contains_bare_create_element_call(node, ctx)
    {
        return;
    }
    if matches!(
        parent.kind(),
        AstKind::ArrowFunctionExpression(_) | AstKind::ReturnStatement(_)
    ) {
        report_missing_display_name(node.span(), ctx);
        return;
    }

    let mut current = parent;
    loop {
        match current.kind() {
            AstKind::VariableDeclarator(declarator) => {
                if declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|identifier| {
                        is_react_component_name(identifier.name.as_str())
                            && !settings.ignore_transpiler_name
                    })
                {
                    return;
                }
                break;
            }
            AstKind::ExportDefaultDeclaration(_) => {
                report_missing_display_name(node.span(), ctx);
                return;
            }
            _ if is_module_exports_assignment(node, ctx) => {
                report_missing_display_name(node.span(), ctx);
                return;
            }
            AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            | AstKind::Class(_)
            | AstKind::Program(_) => break,
            _ => current = ctx.nodes().parent_node(current.id()),
        }
    }
}

fn check_display_name_function_declaration<'a>(
    node: &AstNode<'a>,
    assignments: &DisplayNameAssignments,
    curated_behavior: bool,
    ctx: &LintContext<'a>,
) {
    if curated_behavior {
        return;
    }
    let parent = ctx.nodes().parent_node(node.id());
    if !matches!(parent.kind(), AstKind::ExportDefaultDeclaration(_))
        || !function_contains_react_render_output(node, ctx)
    {
        return;
    }
    let AstKind::Function(function) = node.kind() else {
        return;
    };
    if function.id.as_ref().is_some_and(|identifier| {
        assignments
            .identifier_targets
            .contains(identifier.name.as_str())
    }) {
        return;
    }
    report_missing_display_name(function.id.as_ref().map_or(node.span(), GetSpan::span), ctx);
}

fn check_display_name_call<'a>(
    node: &AstNode<'a>,
    settings: &Settings,
    assignments: &DisplayNameAssignments,
    ctx: &LintContext<'a>,
) {
    let AstKind::CallExpression(call) = node.kind() else {
        return;
    };
    if settings.check_context_objects
        && is_react_version_at_least(&settings.react_version, 16, 3)
        && is_create_context_call(call)
    {
        if get_assigned_name(node, ctx)
            .is_some_and(|name| assignments.identifier_targets.contains(name))
        {
            return;
        }
        report_missing_display_name(node.span(), ctx);
        return;
    }
    if should_report_hoc_display_name(node, settings, assignments, ctx) {
        report_missing_display_name(node.span(), ctx);
        return;
    }
    if !is_create_class_like_call(node) {
        return;
    }
    let Some(first_argument) = call.arguments.first() else {
        report_missing_display_name(node.span(), ctx);
        return;
    };
    let Some(Expression::ObjectExpression(object)) = first_argument.as_expression() else {
        report_missing_display_name(node.span(), ctx);
        return;
    };
    if object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        !property.computed && property.key.static_name().as_deref() == Some("displayName")
    }) {
        return;
    }
    let parent = ctx.nodes().parent_node(node.id());
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|identifier| {
                is_react_component_name(identifier.name.as_str())
                    && !settings.ignore_transpiler_name
            })
    {
        return;
    }
    if let AstKind::AssignmentExpression(assignment) = parent.kind()
        && assignment_target_name(&assignment.left)
            .is_some_and(|name| is_react_component_name(name) && !settings.ignore_transpiler_name)
    {
        return;
    }
    report_missing_display_name(node.span(), ctx);
}

fn should_report_hoc_display_name<'a>(
    node: &AstNode<'a>,
    settings: &Settings,
    assignments: &DisplayNameAssignments,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::CallExpression(call) = node.kind() else {
        return false;
    };
    let Some(call_name) = display_name_hoc_callee_name(call, &settings.additional_hocs) else {
        return false;
    };
    if !node_contains_jsx(node, ctx) {
        return false;
    }
    if get_assigned_name(node, ctx)
        .is_some_and(|name| assignments.identifier_targets.contains(name))
    {
        return false;
    }
    let Some(first_argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    if call_name == "forwardRef" {
        let parent = ctx.nodes().parent_node(node.id());
        if let AstKind::CallExpression(parent_call) = parent.kind()
            && display_name_hoc_callee_name(parent_call, &settings.additional_hocs) == Some("memo")
            && call_argument_matches(parent_call.arguments.first(), node.span())
            && supports_composed_forward_ref_display_name(&settings.react_version)
        {
            return false;
        }
    }
    if call_name == "memo"
        && let Expression::CallExpression(inner_call) = first_argument.get_inner_expression()
    {
        if display_name_hoc_callee_name(inner_call, &settings.additional_hocs) != Some("forwardRef")
        {
            return false;
        }
        return !supports_composed_forward_ref_display_name(&settings.react_version);
    }
    match first_argument.get_inner_expression() {
        Expression::FunctionExpression(function) if function.id.is_some() => false,
        Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_) => true,
        _ => false,
    }
}

fn display_name_hoc_callee_name<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    additional_hocs: &HashSet<String>,
) -> Option<&'a str> {
    let name = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name.as_str(),
        Expression::StaticMemberExpression(member) => member.property.name.as_str(),
        _ => return None,
    };
    (matches!(name, "memo" | "forwardRef") || additional_hocs.contains(name)).then_some(name)
}

fn supports_composed_forward_ref_display_name(version: &str) -> bool {
    if version.is_empty() {
        return false;
    }
    if is_react_version_at_least(version, 15, 7) {
        return true;
    }
    parse_react_version(version).is_some_and(|(major, minor, patch)| {
        major == 0 && minor == 14 && patch.is_some_and(|patch| patch >= 11)
    })
}

fn is_react_version_at_least(version: &str, expected_major: u32, expected_minor: u32) -> bool {
    if version.is_empty() {
        return true;
    }
    let Some((major, minor, _)) = parse_react_version(version) else {
        return true;
    };
    major > expected_major || major == expected_major && minor >= expected_minor
}

fn parse_react_version(version: &str) -> Option<(u32, u32, Option<u32>)> {
    let mut segments = version.split('.');
    let major = segments.next()?.parse().ok()?;
    let minor = parse_leading_version_number(segments.next()?)?;
    let patch = segments.next().and_then(parse_leading_version_number);
    Some((major, minor, patch))
}

fn parse_leading_version_number(segment: &str) -> Option<u32> {
    segment
        .split(|character: char| !character.is_ascii_digit())
        .next()?
        .parse()
        .ok()
}

fn is_create_context_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    call_expression_static_callee_name(call) == Some("createContext")
}

fn is_create_class_like_call(node: &AstNode<'_>) -> bool {
    if is_es5_component(node) {
        return true;
    }
    let AstKind::CallExpression(call) = node.kind() else {
        return false;
    };
    call.callee
        .as_member_expression()
        .and_then(MemberExpression::static_property_name)
        == Some("createClass")
}

fn call_expression_static_callee_name<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a str> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(MemberExpression::static_property_name),
    }
}

fn call_argument_matches(argument: Option<&Argument<'_>>, span: Span) -> bool {
    argument
        .and_then(Argument::as_expression)
        .is_some_and(|expression| expression.span() == span)
}

fn node_contains_jsx(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        node.span().contains_inclusive(candidate.span())
            && (matches!(candidate.kind(), AstKind::JSXElement(_) | AstKind::JSXFragment(_))
                || matches!(candidate.kind(), AstKind::CallExpression(call) if is_create_element_call(call)))
    })
}

fn node_contains_bare_create_element_call(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        node.span().contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::CallExpression(call) if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "createElement"))
    })
}

fn get_assigned_name<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<&'a str> {
    let expression_root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.name.as_str()),
        AstKind::AssignmentExpression(assignment) => assignment_target_name(&assignment.left),
        _ => None,
    }
}

fn assignment_target_name<'a>(target: &'a AssignmentTarget<'a>) -> Option<&'a str> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => Some(identifier.name.as_str()),
        _ => target
            .as_member_expression()
            .and_then(MemberExpression::static_property_name),
    }
}

fn is_module_exports_assignment<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = display_name_skip_parentheses(node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::AssignmentExpression(assignment) = parent.kind() else {
        return false;
    };
    let Some(member) = assignment.left.as_member_expression() else {
        return false;
    };
    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "module")
        && member.static_property_name() == Some("exports")
}

fn display_name_skip_parentheses<'a, 'ctx>(
    mut node: &'ctx AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> &'ctx AstNode<'a> {
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(parent.kind(), AstKind::ParenthesizedExpression(_)) {
            return node;
        }
        node = parent;
    }
}

fn collect_display_name_assignments(ctx: &LintContext<'_>) -> DisplayNameAssignments {
    let mut assignments = DisplayNameAssignments::default();
    for node in ctx.nodes().iter() {
        let AstKind::AssignmentExpression(assignment) = node.kind() else {
            continue;
        };
        let Some(member) = assignment.left.as_member_expression() else {
            continue;
        };
        if member.static_property_name() != Some("displayName") {
            continue;
        }
        let object = member.object();
        if let Expression::Identifier(identifier) = object.get_inner_expression() {
            assignments
                .identifier_targets
                .insert(identifier.name.to_string());
        }
        collect_member_path_segments(object, &mut assignments.member_path_segments);
    }
    assignments
}

fn collect_member_path_segments(expression: &Expression<'_>, segments: &mut HashSet<String>) {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            segments.insert(identifier.name.to_string());
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return;
            };
            collect_member_path_segments(member.object(), segments);
            if let Some(property_name) = member.static_property_name() {
                segments.insert(property_name.to_string());
            }
        }
    }
}

fn is_react_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
