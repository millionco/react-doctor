use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression, MemberExpression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::{node::NodeId, operator::UnaryOperator};
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This makes the browser recalculate layout again & again because element.style writes are interleaved with layout reads inside a loop, so do all reads first, then set the styles at once with cssText or a CSS class";
const ITERATOR_METHOD_NAMES: [&str; 6] = [
    "forEach",
    "map",
    "flatMap",
    "filter",
    "reduce",
    "reduceRight",
];
const LAYOUT_FORCING_PROPERTY_NAMES: [&str; 10] = [
    "offsetWidth",
    "offsetHeight",
    "offsetTop",
    "offsetLeft",
    "clientWidth",
    "clientHeight",
    "scrollWidth",
    "scrollHeight",
    "scrollTop",
    "scrollLeft",
];
const LAYOUT_FORCING_METHOD_NAMES: [&str; 3] = [
    "getBoundingClientRect",
    "getClientRects",
    "getComputedStyle",
];
const LAYOUT_NEUTRAL_STYLE_PROPERTY_NAMES: [&str; 19] = [
    "transform",
    "opacity",
    "transition",
    "transitionProperty",
    "transitionDuration",
    "transitionDelay",
    "transitionTimingFunction",
    "willChange",
    "animation",
    "animationName",
    "animationDuration",
    "animationDelay",
    "animationPlayState",
    "filter",
    "backdropFilter",
    "boxShadow",
    "zIndex",
    "pointerEvents",
    "cursor",
];
const DOM_CREATION_METHOD_NAMES: [&str; 5] = [
    "createElement",
    "createElementNS",
    "createDocumentFragment",
    "cloneNode",
    "importNode",
];
const DETACHED_SUBTREE_QUERY_METHOD_NAMES: [&str; 4] = [
    "querySelector",
    "querySelectorAll",
    "getElementsByTagName",
    "getElementsByClassName",
];
const DOM_ATTACHMENT_METHOD_NAMES: [&str; 9] = [
    "appendChild",
    "append",
    "prepend",
    "insertBefore",
    "replaceChild",
    "replaceChildren",
    "before",
    "after",
    "replaceWith",
];
const MAX_DETACHED_ROOT_RESOLUTION_DEPTH: usize = 4;

#[derive(Debug, Default, Clone)]
pub struct JsBatchDomCss;

#[derive(Clone, Copy)]
struct PerIterationBody {
    owner_id: NodeId,
    span: Span,
}

#[derive(Clone, Copy, Default)]
struct PerIterationLayoutReads {
    has_used_layout_read: bool,
    has_deliberate_forced_reflow: bool,
}

struct StyleAssignment<'a> {
    element: &'a Expression<'a>,
    property_name: &'a str,
}

struct DetachedCreationRoot {
    root_name: String,
    scope_span: Span,
}

declare_oxc_lint!(
    /// Disallow repeated inline style writes interleaved with layout reads in a loop.
    JsBatchDomCss,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Repeated inline style writes.",
);

impl Rule for JsBatchDomCss {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut layout_reads_by_owner = FxHashMap::<NodeId, PerIterationLayoutReads>::default();
        for node in ctx.nodes().iter() {
            let Some(statements) = statement_list(node.kind()) else {
                continue;
            };
            let Some(per_iteration_body) = find_enclosing_per_iteration_body(node, ctx) else {
                continue;
            };
            for statement_index in 1..statements.len() {
                let Some(current_style_assignment) =
                    get_style_assignment(&statements[statement_index])
                else {
                    continue;
                };
                let Some(previous_style_assignment) =
                    get_style_assignment(&statements[statement_index - 1])
                else {
                    continue;
                };
                if is_layout_neutral_style_property(current_style_assignment.property_name)
                    && is_layout_neutral_style_property(previous_style_assignment.property_name)
                {
                    continue;
                }
                let layout_reads = *layout_reads_by_owner
                    .entry(per_iteration_body.owner_id)
                    .or_insert_with(|| scan_per_iteration_layout_reads(per_iteration_body, ctx));
                if !layout_reads.has_used_layout_read || layout_reads.has_deliberate_forced_reflow {
                    break;
                }
                if is_provably_detached_at_write(
                    &current_style_assignment,
                    statements[statement_index].span(),
                    ctx,
                ) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(MESSAGE).with_label(statements[statement_index].span()),
                );
            }
        }
    }
}

fn statement_list<'a>(kind: AstKind<'a>) -> Option<&'a [Statement<'a>]> {
    match kind {
        AstKind::BlockStatement(block) => Some(block.body.as_slice()),
        AstKind::FunctionBody(body) => Some(body.statements.as_slice()),
        _ => None,
    }
}

fn find_enclosing_per_iteration_body(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<PerIterationBody> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let body_span = match ancestor.kind() {
            AstKind::ForStatement(statement) => Some(statement.body.span()),
            AstKind::ForInStatement(statement) => Some(statement.body.span()),
            AstKind::ForOfStatement(statement) => Some(statement.body.span()),
            AstKind::WhileStatement(statement) => Some(statement.body.span()),
            AstKind::DoWhileStatement(statement) => Some(statement.body.span()),
            AstKind::Function(function) => {
                if !is_iterator_callback(ancestor, ctx) {
                    return None;
                }
                function.body.as_ref().map(|body| body.span)
            }
            AstKind::ArrowFunctionExpression(function) => {
                if !is_iterator_callback(ancestor, ctx) {
                    return None;
                }
                Some(function.body.span())
            }
            _ => None,
        };
        if let Some(span) = body_span {
            return Some(PerIterationBody {
                owner_id: ancestor.id(),
                span,
            });
        }
    }
    None
}

fn is_iterator_callback<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let function_root = layout_transparent_expression_root(function_node, ctx);
    let call_node = ctx.nodes().parent_node(function_root.id());
    let AstKind::CallExpression(call) = call_node.kind() else {
        return false;
    };
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let MemberExpression::StaticMemberExpression(member) = member else {
        return false;
    };
    let method_name = member.property.name.as_str();
    if ITERATOR_METHOD_NAMES.contains(&method_name) {
        return call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|callback| {
                callback.get_inner_expression().span() == function_node.span()
            });
    }
    method_name == "from"
        && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "Array")
        && call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
            .is_some_and(|callback| callback.get_inner_expression().span() == function_node.span())
}

fn scan_per_iteration_layout_reads(
    per_iteration_body: PerIterationBody,
    ctx: &LintContext<'_>,
) -> PerIterationLayoutReads {
    let mut layout_reads = PerIterationLayoutReads::default();
    for candidate in ctx.nodes().iter() {
        if !per_iteration_body.span.contains_inclusive(candidate.span()) {
            continue;
        }
        let Some(value_node_id) = get_layout_read_value_node_id(candidate, ctx) else {
            continue;
        };
        let value_node = ctx.nodes().get_node(value_node_id);
        if is_discarded_layout_value(value_node, ctx) {
            layout_reads.has_deliberate_forced_reflow = true;
        } else if is_in_direct_iteration_execution(value_node, per_iteration_body.owner_id, ctx) {
            layout_reads.has_used_layout_read = true;
        }
    }
    layout_reads
}

fn get_layout_read_value_node_id<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> Option<NodeId> {
    match node.kind() {
        AstKind::CallExpression(call) if matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "getComputedStyle") => {
            Some(node.id())
        }
        AstKind::StaticMemberExpression(member) => {
            let property_name = member.property.name.as_str();
            let member_root = layout_transparent_expression_root(node, ctx);
            if LAYOUT_FORCING_METHOD_NAMES.contains(&property_name) {
                let parent = ctx.nodes().parent_node(member_root.id());
                return matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == member_root.span())
                    .then_some(parent.id());
            }
            if !LAYOUT_FORCING_PROPERTY_NAMES.contains(&property_name) {
                return None;
            }
            let parent = ctx.nodes().parent_node(member_root.id());
            if matches!(parent.kind(), AstKind::AssignmentExpression(assignment) if assignment.left.span() == member_root.span())
            {
                return None;
            }
            Some(member_root.id())
        }
        _ => None,
    }
}

fn is_discarded_layout_value<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let value_root = layout_transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(value_root.id());
    if matches!(parent.kind(), AstKind::ExpressionStatement(_)) {
        return true;
    }
    let AstKind::UnaryExpression(unary) = parent.kind() else {
        return false;
    };
    if unary.operator != UnaryOperator::Void {
        return false;
    }
    let unary_root = layout_transparent_expression_root(parent, ctx);
    matches!(
        ctx.nodes().parent_node(unary_root.id()).kind(),
        AstKind::ExpressionStatement(_)
    )
}

fn layout_transparent_expression_root<'a, 'b>(
    mut node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> &'b AstNode<'a> {
    loop {
        let parent = ctx.nodes().parent_node(node.id());
        if !matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::ChainExpression(_)
                | AstKind::TSNonNullExpression(_)
        ) {
            return node;
        }
        node = parent;
    }
}

fn is_in_direct_iteration_execution(
    node: &AstNode<'_>,
    iteration_owner_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == iteration_owner_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn get_style_assignment<'a>(statement: &'a Statement<'a>) -> Option<StyleAssignment<'a>> {
    let Statement::ExpressionStatement(statement) = statement else {
        return None;
    };
    let Expression::AssignmentExpression(assignment) =
        unwrap_discarded_style_expression(&statement.expression)
    else {
        return None;
    };
    let MemberExpression::StaticMemberExpression(property_member) =
        assignment.left.as_member_expression()?
    else {
        return None;
    };
    let Expression::StaticMemberExpression(style_member) = &property_member.object else {
        return None;
    };
    if style_member.property.name != "style" {
        return None;
    }
    Some(StyleAssignment {
        element: &style_member.object,
        property_name: property_member.property.name.as_str(),
    })
}

fn unwrap_discarded_style_expression<'a>(mut expression: &'a Expression<'a>) -> &'a Expression<'a> {
    loop {
        expression = expression.get_inner_expression();
        match expression {
            Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => {
                expression = &unary.argument;
            }
            Expression::SequenceExpression(sequence)
                if sequence.expressions.len() > 1
                    && sequence.expressions[..sequence.expressions.len() - 1]
                        .iter()
                        .all(|expression| expression.get_inner_expression().is_literal()) =>
            {
                expression = &sequence.expressions[sequence.expressions.len() - 1];
            }
            _ => return expression,
        }
    }
}

fn is_layout_neutral_style_property(property_name: &str) -> bool {
    LAYOUT_NEUTRAL_STYLE_PROPERTY_NAMES.contains(&property_name)
}

fn is_provably_detached_at_write<'a>(
    style_assignment: &StyleAssignment<'a>,
    write_span: Span,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(creation_root) = resolve_detached_creation_root(style_assignment.element, 0, ctx)
    else {
        return false;
    };
    !has_attachment_before(&creation_root, write_span.start, ctx)
}

fn resolve_detached_creation_root<'a>(
    expression: &Expression<'a>,
    depth: usize,
    ctx: &LintContext<'a>,
) -> Option<DetachedCreationRoot> {
    if depth > MAX_DETACHED_ROOT_RESOLUTION_DEPTH {
        return None;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let initializer = js_batch_dom_css_variable_initializer_for_symbol(
        &declarator.id,
        symbol_id,
        declarator.init.as_ref(),
    )?
    .get_inner_expression();
    if is_dom_creation_call(initializer) {
        return Some(DetachedCreationRoot {
            root_name: identifier.name.to_string(),
            scope_span: variable_scope_span(declaration, ctx)?,
        });
    }
    if let Expression::CallExpression(call) = initializer
        && let Some(MemberExpression::StaticMemberExpression(member)) =
            call.callee.as_member_expression()
        && DETACHED_SUBTREE_QUERY_METHOD_NAMES.contains(&member.property.name.as_str())
    {
        return resolve_detached_creation_root(&member.object, depth + 1, ctx);
    }
    let member = initializer.as_member_expression()?;
    resolve_detached_creation_root(member.object(), depth + 1, ctx)
}

fn js_batch_dom_css_variable_initializer_for_symbol<'a>(
    pattern: &'a BindingPattern<'a>,
    symbol_id: oxc_semantic::SymbolId,
    base_initializer: Option<&'a Expression<'a>>,
) -> Option<&'a Expression<'a>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            (identifier.symbol_id() == symbol_id).then_some(base_initializer)?
        }
        BindingPattern::AssignmentPattern(assignment) => {
            js_batch_dom_css_variable_initializer_for_symbol(
                &assignment.left,
                symbol_id,
                Some(&assignment.right),
            )
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                let property_initializer = match &property.value {
                    BindingPattern::AssignmentPattern(assignment) => Some(&assignment.right),
                    _ => None,
                };
                if let Some(initializer) = js_batch_dom_css_variable_initializer_for_symbol(
                    &property.value,
                    symbol_id,
                    property_initializer,
                ) {
                    return Some(initializer);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                js_batch_dom_css_variable_initializer_for_symbol(&rest.argument, symbol_id, None)
            })
        }
        BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                let element_initializer = match element {
                    BindingPattern::AssignmentPattern(assignment) => Some(&assignment.right),
                    _ => None,
                };
                if let Some(initializer) = js_batch_dom_css_variable_initializer_for_symbol(
                    element,
                    symbol_id,
                    element_initializer,
                ) {
                    return Some(initializer);
                }
            }
            pattern.rest.as_ref().and_then(|rest| {
                js_batch_dom_css_variable_initializer_for_symbol(&rest.argument, symbol_id, None)
            })
        }
    }
}

fn is_dom_creation_call(expression: &Expression<'_>) -> bool {
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    matches!(
        call.callee.as_member_expression(),
        Some(MemberExpression::StaticMemberExpression(member))
            if DOM_CREATION_METHOD_NAMES.contains(&member.property.name.as_str())
    )
}

fn variable_scope_span(declarator: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<Span> {
    let declaration = ctx.nodes().parent_node(declarator.id());
    let AstKind::VariableDeclaration(variable_declaration) = declaration.kind() else {
        return None;
    };
    let is_block_scoped = !variable_declaration.kind.is_var();
    for ancestor in ctx.nodes().ancestors(declarator.id()) {
        match ancestor.kind() {
            AstKind::BlockStatement(_) if is_block_scoped => return Some(ancestor.span()),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_) => {
                return Some(ancestor.span());
            }
            _ => {}
        }
    }
    None
}

fn has_attachment_before(
    creation_root: &DetachedCreationRoot,
    before_start: u32,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start >= before_start
            || !creation_root
                .scope_span
                .contains_inclusive(candidate.span())
        {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let Some(MemberExpression::StaticMemberExpression(member)) =
            call.callee.as_member_expression()
        else {
            return false;
        };
        DOM_ATTACHMENT_METHOD_NAMES.contains(&member.property.name.as_str())
            && call.arguments.iter().any(|argument| {
                matches!(argument.as_expression(), Some(Expression::Identifier(identifier)) if identifier.name.as_str() == creation_root.root_name.as_str())
            })
    })
}
