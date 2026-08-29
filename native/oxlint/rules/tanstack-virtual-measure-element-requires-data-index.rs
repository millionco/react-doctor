use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule};

const VIRTUAL_MODULES: [&str; 1] = ["@tanstack/react-virtual"];
const VIRTUAL_HOOKS: [&str; 2] = ["useVirtualizer", "useWindowVirtualizer"];

#[derive(Debug, Default, Clone)]
pub struct TanstackVirtualMeasureElementRequiresDataIndex;

declare_oxc_lint!(
    /// Require an index attribute on measured TanStack Virtual elements.
    TanstackVirtualMeasureElementRequiresDataIndex,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require data-index on measured virtual items.",
);

impl Rule for TanstackVirtualMeasureElementRequiresDataIndex {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening) = node.kind() else {
                continue;
            };
            let Some(reference) =
                find_jsx_attribute(opening, "ref").and_then(jsx_attribute_expression)
            else {
                continue;
            };
            let Some(hook_call) =
                tanstack_virtual_measure_hook_call(reference, &node_index, ctx, &mut Vec::new())
            else {
                continue;
            };
            let Some(attribute_name) = tanstack_virtual_index_attribute(hook_call, ctx) else {
                continue;
            };
            if opening.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) || find_jsx_attribute(opening, &attribute_name).is_some()
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(format!(
                "This element's ref is the virtualizer's measureElement, but it has no {attribute_name} attribute, so the virtualizer cannot attribute the measured size to a row and drops it with a console warning. Add {attribute_name}={{virtualItem.index}}."
            )).with_label(opening.name.span()));
        }
    }
}

fn tanstack_virtual_measure_hook_call<'a, 'b>(
    expression: &'b Expression<'a>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &'b LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> Option<&'b oxc_ast::ast::CallExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression()
        && member.static_property_name() == Some("measureElement")
    {
        return tanstack_virtual_resolve_hook_call(member.object(), ctx, visited);
    }
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        let function_id = expression.node_id();
        return node_index
            .node_ids(function_id)
            .iter()
            .find_map(|&node_id| {
                let AstKind::CallExpression(call) = ctx.nodes().get_node(node_id).kind() else {
                    return None;
                };
                tanstack_virtual_measure_hook_call(
                    &call.callee,
                    node_index,
                    ctx,
                    &mut visited.clone(),
                )
            });
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
    {
        return None;
    }
    if let oxc_ast::ast::BindingPattern::ObjectPattern(pattern) = &declarator.id
        && pattern.properties.iter().any(|property| {
            !property.computed
                && property.key.static_name().as_deref() == Some("measureElement")
                && matches!(&property.value,
                    oxc_ast::ast::BindingPattern::BindingIdentifier(binding)
                        if binding.symbol_id() == symbol_id)
        })
    {
        return tanstack_virtual_resolve_hook_call(declarator.init.as_ref()?, ctx, visited);
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    tanstack_virtual_measure_hook_call(declarator.init.as_ref()?, node_index, ctx, visited)
}

fn tanstack_virtual_resolve_hook_call<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &'b LintContext<'a>,
    visited: &mut Vec<SymbolId>,
) -> Option<&'b oxc_ast::ast::CallExpression<'a>> {
    let expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression
        && VIRTUAL_HOOKS.iter().any(|hook| {
            module_api_path_matches(&call.callee, &[*hook], &VIRTUAL_MODULES, false, ctx)
        })
    {
        return Some(call);
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
    tanstack_virtual_resolve_hook_call(declarator.init.as_ref()?, ctx, visited)
}

fn tanstack_virtual_index_attribute<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let options_expression = call
        .arguments
        .first()?
        .as_expression()?
        .get_inner_expression();
    let options = tanstack_virtual_options_object(options_expression, ctx, &mut Vec::new())?;
    let mut attribute_name = Some("data-index".to_string());
    for property in &options.properties {
        match property {
            oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_) => attribute_name = None,
            oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                if !property.computed
                    && property.key.static_name().as_deref() == Some("indexAttribute") =>
            {
                attribute_name = get_static_string_expression(&property.value).map(str::to_string);
            }
            _ => {}
        }
    }
    attribute_name
}

fn tanstack_virtual_options_object<'a, 'b>(
    expression: &'b Expression<'a>,
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
    tanstack_virtual_options_object(declarator.init.as_ref()?, ctx, visited)
}
