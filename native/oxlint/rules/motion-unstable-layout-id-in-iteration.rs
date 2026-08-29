use crate::{AstNode, context::LintContext, rule::Rule};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

struct MotionLayoutIterator {
    callback: oxc_semantic::NodeId,
    item_symbol: Option<oxc_semantic::SymbolId>,
    index_symbol: Option<oxc_semantic::SymbolId>,
}
#[derive(Debug, Default, Clone)]
pub struct MotionUnstableLayoutIdInIteration;
declare_oxc_lint!(
    /// Disallows unstable Motion layout IDs in iteration.
    MotionUnstableLayoutIdInIteration,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unstable Motion layout IDs in iterations."
);
impl Rule for MotionUnstableLayoutIdInIteration {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(open) = node.kind() else {
            return;
        };
        if !is_proven_motion_jsx_element(&open.name, ctx) {
            return;
        }
        let Some(attribute) = get_authoritative_jsx_attribute(open, "layoutId", true) else {
            return;
        };
        let Some(iterator) = motion_layout_iterator(node, ctx) else {
            return;
        };
        if motion_layout_item_group(node, &iterator, ctx) {
            return;
        }
        if motion_layout_static_string(attribute).is_some() {
            if motion_layout_conditional(node, iterator.callback, ctx) {
                return;
            }
            ctx.diagnostic(OxcDiagnostic::warn("This literal layoutId is rendered for every iteration, so multiple live items share one global Motion layout identity. Derive it from stable item identity or scope the item with LayoutGroup.").with_label(attribute.span));
            return;
        }
        if let Some(symbol) = iterator.index_symbol
            && motion_layout_attribute_references(attribute, symbol, ctx)
        {
            ctx.diagnostic(OxcDiagnostic::warn("This layoutId depends on the iteration index, so reordering items can attach shared-layout animation to the wrong element. Derive it from stable item identity.").with_label(attribute.span));
        }
    }
}
fn motion_layout_iterator(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<MotionLayoutIterator> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let parameters = match ancestor.kind() {
            AstKind::ArrowFunctionExpression(function) => &function.params,
            AstKind::Function(function) => &function.params,
            _ => continue,
        };
        let function_root = transparent_expression_root(ancestor, ctx);
        let parent = ctx.nodes().parent_node(function_root.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return None;
        };
        if call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_none_or(|argument| argument.get_inner_expression().span() != ancestor.span())
            || call
                .callee
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                .is_none_or(|name| name != "map" && name != "flatMap")
        {
            return None;
        }
        return Some(MotionLayoutIterator {
            callback: ancestor.id(),
            item_symbol: parameters
                .items
                .first()
                .and_then(|parameter| parameter.pattern.get_binding_identifier())
                .map(|binding| binding.symbol_id()),
            index_symbol: parameters
                .items
                .get(1)
                .and_then(|parameter| parameter.pattern.get_binding_identifier())
                .map(|binding| binding.symbol_id()),
        });
    }
    None
}
fn motion_layout_conditional(
    node: &AstNode<'_>,
    boundary: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .take_while(|a| a.id() != boundary)
        .any(|a| {
            matches!(
                a.kind(),
                AstKind::LogicalExpression(_) | AstKind::ConditionalExpression(_)
            )
        })
}
fn motion_layout_attribute_references(
    a: &oxc_ast::ast::JSXAttribute<'_>,
    symbol: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(c)) = &a.value else {
        return false;
    };
    let Some(e) = c.expression.as_expression() else {
        return false;
    };
    motion_layout_expression_references(e, symbol, ctx, &mut Vec::new())
}
fn motion_layout_expression_references(
    expression: &Expression<'_>,
    symbol: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|node| {
        let AstKind::IdentifierReference(identifier) = node.kind() else {
            return false;
        };
        node.span().start >= span.start
            && node.span().end <= span.end
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|candidate| {
                    motion_layout_symbol_resolves_to(candidate, symbol, ctx, visited_symbols)
                })
    })
}
fn motion_layout_symbol_resolves_to(
    candidate: oxc_semantic::SymbolId,
    target: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if candidate == target {
        return true;
    }
    if visited_symbols.contains(&candidate) {
        return false;
    }
    visited_symbols.push(candidate);
    let declaration = ctx.symbol_declaration(candidate);
    let resolves = if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        && let Some(initializer) = &declarator.init
    {
        motion_layout_expression_references(initializer, target, ctx, visited_symbols)
    } else {
        false
    };
    visited_symbols.pop();
    resolves
}
fn motion_layout_item_group(
    node: &AstNode<'_>,
    iterator: &MotionLayoutIterator,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(item_symbol) = iterator.item_symbol else {
        return false;
    };
    ctx.nodes()
        .ancestors(node.id())
        .take_while(|ancestor| ancestor.id() != iterator.callback)
        .any(|ancestor| {
            let AstKind::JSXElement(element) = ancestor.kind() else {
                return false;
            };
            if !motion_react_component_matches(&element.opening_element.name, "LayoutGroup", ctx) {
                return false;
            }
            let Some(attribute) =
                get_authoritative_jsx_attribute(&element.opening_element, "id", true)
            else {
                return false;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                return false;
            };
            container
                .expression
                .as_expression()
                .is_some_and(|expression| {
                    motion_layout_expression_references(
                        expression,
                        item_symbol,
                        ctx,
                        &mut Vec::new(),
                    )
                })
        })
}
fn motion_layout_static_string<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => Some(value.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => {
            match container.expression.as_expression()?.get_inner_expression() {
                Expression::StringLiteral(value) => Some(value.value.as_str()),
                Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                    template
                        .quasis
                        .first()
                        .map(|quasi| quasi.value.raw.as_str())
                }
                _ => None,
            }
        }
        _ => None,
    }
}
