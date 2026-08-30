use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, BindingPattern, Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const ARRAY_READ_METHOD_NAMES: [&str; 15] = [
    "length", "map", "forEach", "filter", "find", "reduce", "some", "every", "flat", "flatMap",
    "indexOf", "includes", "slice", "concat", "join",
];
const MESSAGE: &str = "Your users hit a crash when `props.children` is not an array in Preact, so use `toChildArray(children)` from `preact` before calling array methods or reading `.length`.";

#[derive(Debug, Default, Clone)]
pub struct PreactNoChildrenLength;

declare_oxc_lint!(
    /// Disallow direct array operations on Preact children.
    PreactNoChildrenLength,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Array methods on Preact children can crash.",
);

impl Rule for PreactNoChildrenLength {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let component_like_function_ids = preact_component_like_function_ids(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::StaticMemberExpression(member) = node.kind() else {
                continue;
            };
            if !ARRAY_READ_METHOD_NAMES.contains(&member.property.name.as_str())
                || !preact_is_children_member_object(
                    &member.object,
                    node,
                    ctx,
                    &component_like_function_ids,
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member.span));
        }
    }
}

fn preact_component_like_function_ids(ctx: &LintContext<'_>) -> FxHashSet<NodeId> {
    let mut component_like_function_ids = FxHashSet::default();
    for node in ctx.nodes().iter() {
        if matches!(
            node.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && preact_function_binding_name(node, ctx).is_some_and(|name| {
            name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
                || name
                    .strip_prefix("use")
                    .and_then(|suffix| suffix.as_bytes().first())
                    .is_some_and(u8::is_ascii_uppercase)
        }) {
            component_like_function_ids.insert(node.id());
        }
        let has_render_evidence = matches!(
            node.kind(),
            AstKind::JSXElement(_) | AstKind::JSXFragment(_)
        ) || matches!(node.kind(), AstKind::CallExpression(call)
            if matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "h")
                || is_create_element_call(call));
        if !has_render_evidence {
            continue;
        }
        for function_node in ctx.nodes().ancestors(node.id()) {
            if matches!(
                function_node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) && preact_function_body_span(function_node)
                .is_some_and(|body_span| body_span.contains_inclusive(node.span()))
            {
                component_like_function_ids.insert(function_node.id());
            }
        }
    }
    component_like_function_ids
}

fn preact_is_children_member_object<'a>(
    object: &Expression<'a>,
    member_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    component_like_function_ids: &FxHashSet<NodeId>,
) -> bool {
    if let Expression::Identifier(identifier) = object {
        if identifier.name != "children" {
            return false;
        }
        let Some(declaring_function) = preact_children_destructuring_function(identifier, ctx)
        else {
            return false;
        };
        return preact_declaring_function_is_component_like(
            declaring_function,
            ctx,
            component_like_function_ids,
        );
    }
    let Some(children_member) = object.as_member_expression() else {
        return false;
    };
    if member_expression_identifier_property_name(children_member) != Some("children") {
        return false;
    }
    let props_object = children_member.object();
    if props_object
        .as_member_expression()
        .is_some_and(|props_member| {
            member_expression_identifier_property_name(props_member) == Some("props")
                && matches!(props_member.object(), Expression::ThisExpression(_))
        })
    {
        return true;
    }
    let Expression::Identifier(props_identifier) = props_object else {
        return false;
    };
    if props_identifier.name != "props" {
        return false;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(props_identifier.reference_id())
        .symbol_id()
    else {
        return preact_has_component_like_ancestor(member_node, ctx, component_like_function_ids);
    };
    let Some(declaring_function) = preact_parameter_declaring_function(symbol_id, ctx) else {
        return false;
    };
    preact_declaring_function_is_component_like(
        declaring_function,
        ctx,
        component_like_function_ids,
    )
}

fn preact_children_destructuring_function<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    if let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    {
        let declaring_function = preact_parameter_declaring_function(symbol_id, ctx)?;
        return preact_destructures_children_as_first_parameter(declaring_function)
            .then_some(declaring_function);
    }
    let declaring_function = ctx
        .nodes()
        .ancestors(identifier.node_id.get())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })?;
    preact_destructures_children_as_first_parameter(declaring_function)
        .then_some(declaring_function)
}

fn preact_parameter_declaring_function<'a, 'b>(
    symbol_id: SymbolId,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })?;
    let parameters_span = match function_node.kind() {
        AstKind::Function(function) => function.params.span,
        AstKind::ArrowFunctionExpression(function) => function.params.span,
        _ => return None,
    };
    parameters_span
        .contains_inclusive(declaration.span())
        .then_some(function_node)
}

fn preact_destructures_children_as_first_parameter(function_node: &AstNode<'_>) -> bool {
    let first_parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    };
    let Some(BindingPattern::ObjectPattern(pattern)) =
        first_parameter.map(|parameter| &parameter.pattern)
    else {
        return false;
    };
    pattern
        .properties
        .iter()
        .any(|property| property_key_identifier_name(&property.key) == Some("children"))
}

fn preact_declaring_function_is_component_like<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    component_like_function_ids: &FxHashSet<NodeId>,
) -> bool {
    if component_like_function_ids.contains(&function_node.id()) {
        return true;
    }
    if preact_function_binding_name(function_node, ctx).is_some() {
        return false;
    }
    preact_has_component_like_ancestor(function_node, ctx, component_like_function_ids)
}

fn preact_has_component_like_ancestor<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    component_like_function_ids: &FxHashSet<NodeId>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && component_like_function_ids.contains(&ancestor.id())
    })
}

fn preact_function_binding_name<'a, 'b>(
    function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b str> {
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.name.as_str());
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.name.as_str()),
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == function_root.span() =>
        {
            let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        AstKind::CallExpression(_) => {
            let call_parent = ctx.nodes().parent_node(parent.id());
            let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.name.as_str())
        }
        _ => None,
    }
}

fn preact_function_body_span(function_node: &AstNode<'_>) -> Option<Span> {
    match function_node.kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.span),
        AstKind::ArrowFunctionExpression(function) => Some(function.body.span()),
        _ => None,
    }
}
