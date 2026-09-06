use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule};

const TABLE_MODULES: [&str; 1] = ["@tanstack/react-table"];
const TABLE_HOOKS: [&str; 2] = ["useReactTable", "useTable"];
const ARRAY_METHODS: [&str; 10] = [
    "concat",
    "filter",
    "flat",
    "flatMap",
    "map",
    "slice",
    "toReversed",
    "toSorted",
    "toSpliced",
    "with",
];

#[derive(Debug, Default, Clone)]
pub struct TanstackTableNoUnstableDataOrColumns;

declare_oxc_lint!(
    /// Disallow unstable data and columns passed to TanStack Table.
    TanstackTableNoUnstableDataOrColumns,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unstable TanStack Table data and columns.",
);

impl Rule for TanstackTableNoUnstableDataOrColumns {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        if !TABLE_HOOKS
            .iter()
            .any(|hook| module_api_path_matches(&call.callee, &[*hook], &TABLE_MODULES, false, ctx))
        {
            return;
        }
        let Some(owner) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        let Some(options_expression) = call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(options) =
            tanstack_table_options_object(options_expression, owner.id(), ctx, &mut Vec::new())
        else {
            return;
        };
        for property in &options.properties {
            let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.computed {
                continue;
            }
            let option_name = property.key.static_name();
            let Some(option_name @ ("data" | "columns")) = option_name.as_deref() else {
                continue;
            };
            let Some(fresh) =
                tanstack_table_fresh_array(&property.value, owner.id(), ctx, &mut Vec::new())
            else {
                continue;
            };
            let structures = if option_name == "columns" {
                "column and header structures"
            } else {
                "row models"
            };
            ctx.diagnostic(OxcDiagnostic::warn(format!(
                "This `{option_name}` option gets a new array identity on every render, so the table rebuilds its {structures} each render and auto-reset features can re-render in a loop. Memoize it with useMemo/useState or hoist it to module scope."
            )).with_label(fresh));
        }
    }
}

fn tanstack_table_options_object<'a, 'b>(
    expression: &'b Expression<'a>,
    owner_id: NodeId,
    ctx: &'b LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> Option<&'b oxc_ast::ast::ObjectExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let Expression::ObjectExpression(object) = expression {
        return Some(object);
    }
    let Expression::Identifier(identifier) = expression else {
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
    if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let initializer = declarator.init.as_ref()?.get_inner_expression();
    if let Expression::Identifier(_) = initializer {
        return tanstack_table_options_object(initializer, owner_id, ctx, visited);
    }
    if crate::ast_util::get_enclosing_function(declaration, ctx).map(crate::AstNode::id)
        != Some(owner_id)
    {
        return None;
    }
    let Expression::ObjectExpression(object) = initializer else {
        return None;
    };
    Some(object)
}

fn tanstack_table_fresh_array<'a, 'b>(
    expression: &'b Expression<'a>,
    owner_id: NodeId,
    ctx: &'b LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> Option<Span> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ArrayExpression(_) => Some(expression.span()),
        Expression::CallExpression(call) if tanstack_table_array_call(call, ctx) => {
            Some(expression.span())
        }
        Expression::LogicalExpression(logical) => {
            tanstack_table_fresh_array(&logical.left, owner_id, ctx, visited)
                .or_else(|| tanstack_table_fresh_array(&logical.right, owner_id, ctx, visited))
        }
        Expression::ConditionalExpression(conditional) => {
            tanstack_table_fresh_array(&conditional.consequent, owner_id, ctx, visited).or_else(
                || tanstack_table_fresh_array(&conditional.alternate, owner_id, ctx, visited),
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited.contains(&symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            if crate::ast_util::get_enclosing_function(declaration, ctx).map(crate::AstNode::id)
                != Some(owner_id)
            {
                return None;
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            visited.push(symbol_id);
            tanstack_table_fresh_array(declarator.init.as_ref()?, owner_id, ctx, visited)
                .map(|_| expression.span())
        }
        _ => None,
    }
}

fn tanstack_table_array_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method) = member.static_property_name() else {
        return false;
    };
    if let Expression::Identifier(receiver) = member.object()
        && ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_none()
        && ((receiver.name == "Array" && matches!(method, "from" | "of"))
            || (receiver.name == "Object" && matches!(method, "entries" | "keys" | "values")))
    {
        return true;
    }
    ARRAY_METHODS.contains(&method)
        && !tanstack_table_known_object(member.object(), ctx, &mut Vec::new())
}

fn tanstack_table_known_object(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(_) => true,
        Expression::ArrayExpression(_) => false,
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
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    tanstack_table_known_object(initializer, ctx, visited)
                })
        }
        _ => false,
    }
}
