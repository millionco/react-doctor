use oxc_ast::{
    AstKind,
    ast::{Argument, ArrayExpressionElement, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const IMPORTED_EFFECT_WRAPPER_NAMES: [&str; 2] =
    ["useIsomorphicLayoutEffect", "useModernLayoutEffect"];
const MESSAGE: &str = "This effect focuses an item whenever a controlled selection changes, so an external selection update can steal focus. Gate focus on user navigation or on the list opening.";

#[derive(Debug, Default, Clone)]
pub struct NoControlledSelectionFocusEffect;

declare_oxc_lint!(
    /// Warns when controlled selection changes drive focus from an effect.
    NoControlledSelectionFocusEffect,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when controlled selection changes steal focus.",
);

impl Rule for NoControlledSelectionFocusEffect {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if !is_controlled_selection_effect_call(effect_call, ctx) {
            return;
        }
        let Some(owner_function_id) = local_callback_nearest_function_id(node.id(), ctx) else {
            return;
        };
        let selection_symbol_ids =
            controlled_selection_dependency_symbols(effect_call, owner_function_id, ctx);
        if selection_symbol_ids.is_empty() {
            return;
        }
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(callback_id) = exact_local_function_id_including_generators(
            callback_expression,
            ctx,
            &mut Vec::new(),
            &mut LocalFunctionResolutionCache::default(),
        ) else {
            return;
        };
        let callback = ctx.nodes().get_node(callback_id);
        let statements = match callback.kind() {
            AstKind::Function(function) => function.body.as_ref().map(|body| &body.statements),
            AstKind::ArrowFunctionExpression(function) if function.get_expression().is_none() => {
                function
                    .body
                    .as_function_body()
                    .map(|body| &body.statements)
            }
            _ => None,
        };
        let Some(statements) = statements else {
            return;
        };
        let mut selection_ref_symbol_ids = FxHashSet::default();
        for statement in statements {
            if let Some(reference_symbol_id) =
                selection_ref_symbol_id(statement, &selection_symbol_ids, ctx)
            {
                selection_ref_symbol_ids.insert(reference_symbol_id);
            }
            if selection_ref_symbol_ids.iter().any(|reference_symbol_id| {
                focus_call_uses_reference(statement, *reference_symbol_id, ctx)
            }) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(effect_call.span));
                return;
            }
        }
    }
}

fn is_controlled_selection_effect_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_react_hook_call(call_expression, &EFFECT_HOOK_NAMES, ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression() else {
        return false;
    };
    if !IMPORTED_EFFECT_WRAPPER_NAMES.contains(&identifier.name.as_str()) {
        return false;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
    )
}

fn controlled_selection_dependency_symbols(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let Some(Expression::ArrayExpression(dependencies)) = call_expression
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return FxHashSet::default();
    };
    dependencies
        .elements
        .iter()
        .filter_map(ArrayExpressionElement::as_expression)
        .filter_map(|dependency| {
            let Expression::Identifier(identifier) = dependency.get_inner_expression() else {
                return None;
            };
            if !is_controlled_selection_name(identifier.name.as_str()) {
                return None;
            }
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            if !matches!(declaration.kind(), AstKind::FormalParameter(_)) {
                return None;
            }
            ctx.nodes()
                .ancestors(declaration.id())
                .find(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                })
                .is_some_and(|function| function.id() == owner_function_id)
                .then_some(symbol_id)
        })
        .collect()
}

fn is_controlled_selection_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    ["selected", "selection"].iter().any(|prefix| {
        lowercase_name.strip_prefix(prefix).is_some_and(|suffix| {
            suffix.is_empty() || ["index", "id", "key", "item", "value"].contains(&suffix)
        })
    })
}

fn selection_ref_symbol_id(
    statement: &Statement<'_>,
    selection_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Statement::ExpressionStatement(statement) = statement else {
        return None;
    };
    let Expression::AssignmentExpression(assignment) = statement.expression.get_inner_expression()
    else {
        return None;
    };
    if assignment.operator != AssignmentOperator::Assign {
        return None;
    }
    let target = assignment.left.as_member_expression()?;
    if static_member_expression_property_name(target) != Some("current") {
        return None;
    }
    let Expression::Identifier(selection) = assignment.right.get_inner_expression() else {
        return None;
    };
    let selection_symbol_id = ctx
        .scoping()
        .get_reference(selection.reference_id())
        .symbol_id()?;
    if !selection_symbol_ids.contains(&selection_symbol_id) {
        return None;
    }
    let Expression::Identifier(reference) = target.object().get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(reference.reference_id())
        .symbol_id()
}

fn focus_call_uses_reference(
    statement: &Statement<'_>,
    reference_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Statement::ExpressionStatement(statement) = statement else {
        return false;
    };
    let Expression::CallExpression(call_expression) = statement.expression.get_inner_expression()
    else {
        return false;
    };
    let callee_name = match &call_expression.callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(member_expression_identifier_property_name),
    };
    if !callee_name.is_some_and(|name| name.starts_with("focus")) {
        return false;
    }
    call_expression.arguments.iter().any(|argument| {
        let Some(Expression::Identifier(identifier)) = argument
            .as_expression()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(reference_symbol_id)
    })
}
