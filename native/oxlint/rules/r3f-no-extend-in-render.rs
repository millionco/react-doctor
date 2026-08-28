use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};
use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_syntax::operator::{AssignmentOperator, UnaryOperator};

const R3F_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const MESSAGE: &str = "This extend call runs during React render and mutates R3F's global catalogue again on every execution. Move the registration to module scope";

#[derive(Debug, Default, Clone)]
pub struct R3FNoExtendInRender;

impl RuleMeta for R3FNoExtendInRender {
    const NAME: &'static str = "r3f-no-extend-in-render";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow repeatedly extending the R3F catalogue during render.",
    };
}

impl Rule for R3FNoExtendInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !module_api_path_matches(
            &call_expression.callee,
            &["extend"],
            &R3F_PUBLIC_MODULES,
            false,
            ctx,
        ) {
            return;
        }
        if let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression()
            && let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            && symbol_has_write_before(symbol_id, call_expression.span.start, ctx)
        {
            return;
        }
        if extend_call_is_protected_by_module_cache(node, ctx)
            || find_render_phase_component_or_hook(node, ctx).is_none()
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn extend_call_is_protected_by_module_cache<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current_child = call_node;
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        let AstKind::IfStatement(if_statement) = ancestor.kind() else {
            current_child = ancestor;
            continue;
        };
        let is_consequent = if_statement.consequent.span() == current_child.span();
        let is_alternate = if_statement
            .alternate
            .as_ref()
            .is_some_and(|alternate| alternate.span() == current_child.span());
        if !is_consequent && !is_alternate {
            current_child = ancestor;
            continue;
        }
        let test = if_statement.test.get_inner_expression();
        let guarded_expression = if is_alternate {
            test
        } else {
            let Expression::UnaryExpression(unary_expression) = test else {
                return false;
            };
            if unary_expression.operator != UnaryOperator::LogicalNot {
                return false;
            }
            unary_expression.argument.get_inner_expression()
        };
        let Expression::Identifier(guarded_identifier) = guarded_expression else {
            return false;
        };
        let Some(guarded_symbol_id) = ctx
            .scoping()
            .get_reference(guarded_identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        let guarded_declaration = ctx.symbol_declaration(guarded_symbol_id);
        let AstKind::VariableDeclarator(guarded_declarator) = guarded_declaration.kind() else {
            return false;
        };
        let Some(Expression::CallExpression(cache_get_call)) = guarded_declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return false;
        };
        let Some(cache_get_member) = cache_get_call.callee.as_member_expression() else {
            return false;
        };
        if cache_get_member.static_property_name() != Some("get") {
            return false;
        }
        let Expression::Identifier(cache_identifier) =
            cache_get_member.object().get_inner_expression()
        else {
            return false;
        };
        let Some(cache_symbol_id) = ctx
            .scoping()
            .get_reference(cache_identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        let Some(cache_key_identifier) = cache_get_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression)
            .and_then(|expression| match expression {
                Expression::Identifier(identifier) => Some(identifier),
                _ => None,
            })
        else {
            return false;
        };
        let Some(cache_key_symbol_id) = ctx
            .scoping()
            .get_reference(cache_key_identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if !cache_symbol_is_module_weak_map(cache_symbol_id, ctx) {
            return false;
        }
        let enclosing_function_id =
            crate::ast_util::get_enclosing_function(call_node, ctx).map(AstNode::id);
        return ctx.nodes().iter().any(|candidate| {
            let AstKind::CallExpression(cache_set_call) = candidate.kind() else {
                return false;
            };
            current_child.span().contains_inclusive(candidate.span())
                && candidate.span().start > call_node.span().end
                && crate::ast_util::get_enclosing_function(candidate, ctx).map(AstNode::id)
                    == enclosing_function_id
                && !is_node_conditionally_executed(candidate, current_child.id(), ctx)
                && cache_set_call_populates_guarded_value(
                    cache_set_call,
                    cache_symbol_id,
                    cache_key_symbol_id,
                    guarded_symbol_id,
                    ctx,
                )
        });
    }
    false
}

fn cache_symbol_is_module_weak_map(
    cache_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if !ctx
        .scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(cache_symbol_id))
        .is_top()
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(cache_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::NewExpression(initializer)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    matches!(
        initializer.callee.get_inner_expression(),
        Expression::Identifier(identifier)
            if identifier.name == "WeakMap"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
    )
}

fn cache_set_call_populates_guarded_value<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    cache_symbol_id: oxc_semantic::SymbolId,
    cache_key_symbol_id: oxc_semantic::SymbolId,
    guarded_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    if member_expression.static_property_name() != Some("set") {
        return false;
    }
    let Expression::Identifier(cache_identifier) =
        member_expression.object().get_inner_expression()
    else {
        return false;
    };
    if ctx
        .scoping()
        .get_reference(cache_identifier.reference_id())
        .symbol_id()
        != Some(cache_symbol_id)
    {
        return false;
    }
    let Some(Expression::Identifier(cache_key_identifier)) = call_expression
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if ctx
        .scoping()
        .get_reference(cache_key_identifier.reference_id())
        .symbol_id()
        != Some(cache_key_symbol_id)
    {
        return false;
    }
    let Some(cache_value) = call_expression
        .arguments
        .get(1)
        .and_then(oxc_ast::ast::Argument::as_expression)
    else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        if !cache_value.span().contains_inclusive(candidate.span())
            || assignment.operator != AssignmentOperator::Assign
        {
            return false;
        }
        let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
            return false;
        };
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(guarded_symbol_id)
            && expression_is_provably_truthy(&assignment.right, ctx, &mut Vec::new())
    })
}

fn expression_is_provably_truthy<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ArrayExpression(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::ClassExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::NewExpression(_)
            | Expression::ObjectExpression(_)
    ) {
        return true;
    }
    if let Expression::TemplateLiteral(template_literal) = expression {
        return template_literal
            .quasis
            .iter()
            .any(|quasi| !quasi.value.raw.is_empty());
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
    if visited_symbol_ids.contains(&symbol_id)
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    declarator.init.as_ref().is_some_and(|initializer| {
        expression_is_provably_truthy(initializer, ctx, visited_symbol_ids)
    })
}
