use oxc_ast::{
    AstKind,
    ast::{
        Argument, AssignmentTarget, AssignmentTargetMaybeDefault, AssignmentTargetProperty,
        BindingPattern, CallExpression, Expression, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Ink reuses the existing output instance and ignores fresh renderer options; use its `rerender()` method or unmount it first.";

#[derive(Debug, Default, Clone)]
pub struct InkNoRepeatedRender;

declare_oxc_lint!(
    /// Disallow repeated Ink render calls before the existing renderer is unmounted.
    InkNoRepeatedRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow repeated Ink render calls before unmount.",
);

#[derive(Clone, Copy, PartialEq, Eq)]
enum InkRenderOutput {
    ProcessStdout,
    StableBinding(SymbolId),
    Other,
}

#[derive(Default)]
struct InkRenderCleanupBindings {
    instance_symbol_ids: FxHashSet<SymbolId>,
    unmount_symbol_ids: FxHashSet<SymbolId>,
}

impl Rule for InkNoRepeatedRender {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut render_call_nodes = ctx
            .nodes()
            .iter()
            .filter(|node| {
                matches!(
                    node.kind(),
                    AstKind::CallExpression(call_expression)
                        if imported_module_api_matches(
                            &call_expression.callee,
                            "render",
                            "ink",
                            ctx,
                        )
                )
            })
            .collect::<Vec<_>>();
        render_call_nodes.sort_unstable_by_key(|node| node.span().start);

        let mut render_calls_by_owner = FxHashMap::<NodeId, Vec<&AstNode<'_>>>::default();
        for render_call_node in render_call_nodes {
            let owner_node_id = ink_render_owner_node_id(render_call_node, ctx);
            let previous_render_calls = render_calls_by_owner.entry(owner_node_id).or_default();
            let did_render_before_unmount = previous_render_calls.iter().any(|earlier_call_node| {
                let AstKind::CallExpression(earlier_call) = earlier_call_node.kind() else {
                    return false;
                };
                let AstKind::CallExpression(later_call) = render_call_node.kind() else {
                    return false;
                };
                ink_render_calls_share_output(earlier_call, later_call, ctx)
                    && cfg_block_can_reach(
                        ctx.nodes().cfg_id(earlier_call_node.id()),
                        ctx.nodes().cfg_id(render_call_node.id()),
                        &FxHashSet::default(),
                        ctx,
                    )
                    && !ink_render_is_unmounted_before(
                        owner_node_id,
                        earlier_call_node,
                        render_call_node,
                        ctx,
                    )
            });
            previous_render_calls.push(render_call_node);
            if did_render_before_unmount {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(render_call_node.span()));
            }
        }
    }
}

fn ink_render_owner_node_id<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> NodeId {
    crate::ast_util::get_enclosing_function(node, ctx)
        .map(AstNode::id)
        .unwrap_or(NodeId::ROOT)
}

fn ink_render_calls_share_output<'a>(
    earlier_call: &CallExpression<'a>,
    later_call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(earlier_output) = ink_render_output(earlier_call, ctx) else {
        return false;
    };
    let Some(later_output) = ink_render_output(later_call, ctx) else {
        return false;
    };
    match (earlier_output, later_output) {
        (InkRenderOutput::ProcessStdout, InkRenderOutput::ProcessStdout) => true,
        (InkRenderOutput::StableBinding(earlier), InkRenderOutput::StableBinding(later)) => {
            earlier == later
        }
        _ => false,
    }
}

fn ink_render_output<'a>(
    render_call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<InkRenderOutput> {
    let Some(options) = render_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return Some(InkRenderOutput::ProcessStdout);
    };
    let Expression::ObjectExpression(options) = options.get_inner_expression() else {
        return None;
    };
    let mut output = Some(InkRenderOutput::ProcessStdout);
    for property in &options.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            output = None;
            continue;
        };
        let Some(property_name) = property.key.static_name() else {
            if property.computed {
                output = None;
            }
            continue;
        };
        if property_name != "stdout" {
            continue;
        }
        output = Some(ink_render_output_expression(&property.value, ctx));
    }
    output
}

fn ink_render_output_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> InkRenderOutput {
    if is_process_stdout_member(expression, ctx) {
        return InkRenderOutput::ProcessStdout;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return InkRenderOutput::Other;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return InkRenderOutput::Other;
    };
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        InkRenderOutput::Other
    } else {
        InkRenderOutput::StableBinding(symbol_id)
    }
}

fn ink_render_is_unmounted_before(
    owner_node_id: NodeId,
    earlier_call_node: &AstNode<'_>,
    later_call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let bindings = ink_render_cleanup_bindings(earlier_call_node, ctx);
    let cleanup_call_nodes = ctx.nodes().iter().filter(|candidate| {
        candidate.span().end > earlier_call_node.span().end
            && candidate.span().end < later_call_node.span().start
            && ink_render_owner_node_id(candidate, ctx) == owner_node_id
            && matches!(
                candidate.kind(),
                AstKind::CallExpression(call_expression)
                    if ink_is_render_unmount_call(
                        call_expression,
                        earlier_call_node,
                        &bindings,
                        ctx,
                    )
            )
    });
    let earlier_block = ctx.nodes().cfg_id(earlier_call_node.id());
    let later_block = ctx.nodes().cfg_id(later_call_node.id());
    let mut cleanup_blocks = FxHashSet::default();
    for cleanup_call_node in cleanup_call_nodes {
        let cleanup_block = ctx.nodes().cfg_id(cleanup_call_node.id());
        if cleanup_block == earlier_block || cleanup_block == later_block {
            return true;
        }
        cleanup_blocks.insert(cleanup_block);
    }
    !cleanup_blocks.is_empty()
        && !cfg_block_can_reach(earlier_block, later_block, &cleanup_blocks, ctx)
}

fn ink_render_cleanup_bindings(
    render_call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> InkRenderCleanupBindings {
    let mut bindings = InkRenderCleanupBindings::default();
    let parent = ctx.nodes().parent_node(render_call_node.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == render_call_node.span()) =>
        {
            ink_add_binding_pattern(&declarator.id, &mut bindings);
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == render_call_node.span() =>
        {
            ink_add_assignment_target(&assignment.left, &mut bindings, ctx);
        }
        _ => {}
    }
    bindings
}

fn ink_add_binding_pattern(pattern: &BindingPattern<'_>, bindings: &mut InkRenderCleanupBindings) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            bindings.instance_symbol_ids.insert(identifier.symbol_id());
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                if property.key.static_name().as_deref() == Some("unmount") {
                    ink_add_unmount_binding_pattern(&property.value, bindings);
                }
            }
        }
        _ => {}
    }
}

fn ink_add_unmount_binding_pattern(
    pattern: &BindingPattern<'_>,
    bindings: &mut InkRenderCleanupBindings,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            bindings.unmount_symbol_ids.insert(identifier.symbol_id());
        }
        BindingPattern::AssignmentPattern(pattern) => {
            ink_add_unmount_binding_pattern(&pattern.left, bindings);
        }
        _ => {}
    }
}

fn ink_add_assignment_target(
    target: &AssignmentTarget<'_>,
    bindings: &mut InkRenderCleanupBindings,
    ctx: &LintContext<'_>,
) {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => {
            if let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            {
                bindings.instance_symbol_ids.insert(symbol_id);
            }
        }
        AssignmentTarget::ObjectAssignmentTarget(pattern) => {
            for property in &pattern.properties {
                match property {
                    AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(identifier)
                        if identifier.binding.name == "unmount" =>
                    {
                        if let Some(symbol_id) = ctx
                            .scoping()
                            .get_reference(identifier.binding.reference_id())
                            .symbol_id()
                        {
                            bindings.unmount_symbol_ids.insert(symbol_id);
                        }
                    }
                    AssignmentTargetProperty::AssignmentTargetPropertyProperty(property)
                        if property.name.static_name().as_deref() == Some("unmount") =>
                    {
                        ink_add_unmount_assignment_target(&property.binding, bindings, ctx);
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

fn ink_add_unmount_assignment_target(
    target: &AssignmentTargetMaybeDefault<'_>,
    bindings: &mut InkRenderCleanupBindings,
    ctx: &LintContext<'_>,
) {
    match target {
        AssignmentTargetMaybeDefault::AssignmentTargetIdentifier(identifier) => {
            if let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            {
                bindings.unmount_symbol_ids.insert(symbol_id);
            }
        }
        AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(target) => {
            ink_add_assignment_target(&target.binding, bindings, ctx);
        }
        _ => {}
    }
}

fn ink_is_render_unmount_call(
    call_expression: &CallExpression<'_>,
    render_call_node: &AstNode<'_>,
    bindings: &InkRenderCleanupBindings,
    ctx: &LintContext<'_>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| bindings.unmount_symbol_ids.contains(&symbol_id));
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    if member_expression.static_property_name() != Some("unmount") {
        return false;
    }
    let receiver = member_expression.object().get_inner_expression();
    if receiver.span() == render_call_node.span() {
        return true;
    }
    let Expression::Identifier(identifier) = receiver else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| bindings.instance_symbol_ids.contains(&symbol_id))
}
