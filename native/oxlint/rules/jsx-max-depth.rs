use oxc_ast::{
    ast::{Expression, JSXChild},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::node::NodeId;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const CURATED_MAX_DEPTH: f64 = 14.0;
const UPSTREAM_MAX_DEPTH: f64 = 2.0;

#[derive(Debug, Default, Clone)]
pub struct JsxMaxDepth;

#[derive(Clone, Copy)]
struct DeepLeafCandidate {
    span: Span,
    depth: u32,
}

declare_oxc_lint!(
    /// Limit JSX nesting depth.
    JsxMaxDepth,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Limit JSX nesting depth.",
);

impl Rule for JsxMaxDepth {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let max_depth = configured_max_depth(ctx);
        let mut deepest_leaf_per_tree = FxHashMap::<NodeId, DeepLeafCandidate>::default();
        for node in ctx.nodes().iter() {
            if !matches!(
                node.kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            ) || !is_leaf_jsx_node(node)
            {
                continue;
            }
            let ancestor_depth = jsx_ancestor_depth(node, ctx);
            let child_depth = calculate_node_jsx_depth(node, ctx, &mut FxHashSet::default());
            let total_depth = ancestor_depth + child_depth;
            if f64::from(total_depth) <= max_depth {
                continue;
            }
            let tree_root = outermost_jsx_ancestor_id(node, ctx);
            let candidate = DeepLeafCandidate {
                span: node.span(),
                depth: total_depth,
            };
            deepest_leaf_per_tree
                .entry(tree_root)
                .and_modify(|existing| {
                    if candidate.depth > existing.depth {
                        *existing = candidate;
                    }
                })
                .or_insert(candidate);
        }
        for candidate in deepest_leaf_per_tree.values() {
            let message = format!(
                "This JSX is hard to read at {} levels deep, past the limit of {max_depth}.",
                candidate.depth
            );
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(candidate.span));
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }
}

fn configured_max_depth(ctx: &LintContext) -> f64 {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("jsxMaxDepth"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("max"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or_else(|| {
            if uses_curated_behavior(ctx) {
                CURATED_MAX_DEPTH
            } else {
                UPSTREAM_MAX_DEPTH
            }
        })
}

fn uses_curated_behavior(ctx: &LintContext) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("portedRuleMode"))
        .and_then(serde_json::Value::as_str)
        == Some("curated")
}

fn calculate_variable_jsx_depth(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> u32 {
    if !visited_symbol_ids.insert(symbol_id) {
        return 0;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return 0;
    };
    declarator.init.as_ref().map_or(0, |initializer| {
        calculate_expression_jsx_depth(initializer, ctx, visited_symbol_ids)
    })
}

fn calculate_expression_jsx_depth(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> u32 {
    match expression.get_inner_expression() {
        Expression::JSXElement(element) => {
            calculate_jsx_children_depth(&element.children, ctx, visited_symbol_ids)
        }
        Expression::JSXFragment(fragment) => {
            calculate_jsx_children_depth(&fragment.children, ctx, visited_symbol_ids)
        }
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .map_or(0, |symbol_id| {
                calculate_variable_jsx_depth(symbol_id, ctx, visited_symbol_ids)
            }),
        _ => 0,
    }
}

fn calculate_node_jsx_depth(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> u32 {
    match node.kind() {
        AstKind::JSXElement(element) => {
            calculate_jsx_children_depth(&element.children, ctx, visited_symbol_ids)
        }
        AstKind::JSXFragment(fragment) => {
            calculate_jsx_children_depth(&fragment.children, ctx, visited_symbol_ids)
        }
        _ => 0,
    }
}

fn calculate_jsx_children_depth(
    children: &[JSXChild<'_>],
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> u32 {
    let mut maximum_depth = 0;
    for child in children {
        let depth = match child {
            JSXChild::Element(element) => {
                calculate_jsx_children_depth(&element.children, ctx, visited_symbol_ids) + 1
            }
            JSXChild::Fragment(fragment) => {
                calculate_jsx_children_depth(&fragment.children, ctx, visited_symbol_ids) + 1
            }
            JSXChild::ExpressionContainer(container) => container
                .expression
                .as_expression()
                .map_or(0, |expression| {
                    let resolved_depth =
                        calculate_expression_jsx_depth(expression, ctx, visited_symbol_ids);
                    if resolved_depth > 0 {
                        resolved_depth + 1
                    } else {
                        0
                    }
                }),
            _ => 0,
        };
        maximum_depth = maximum_depth.max(depth);
    }
    maximum_depth
}

fn is_leaf_jsx_node(node: &AstNode<'_>) -> bool {
    let children = match node.kind() {
        AstKind::JSXElement(element) => &element.children,
        AstKind::JSXFragment(fragment) => &fragment.children,
        _ => return true,
    };
    !children
        .iter()
        .any(|child| matches!(child, JSXChild::Element(_) | JSXChild::Fragment(_)))
}

fn jsx_ancestor_depth(node: &AstNode<'_>, ctx: &LintContext<'_>) -> u32 {
    u32::try_from(
        ctx.nodes()
            .ancestors(node.id())
            .filter(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::JSXElement(_) | AstKind::JSXFragment(_)
                )
            })
            .count(),
    )
    .unwrap_or(u32::MAX)
}

fn outermost_jsx_ancestor_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> NodeId {
    ctx.nodes()
        .ancestors(node.id())
        .filter(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            )
        })
        .map(AstNode::id)
        .last()
        .unwrap_or_else(|| node.id())
}
