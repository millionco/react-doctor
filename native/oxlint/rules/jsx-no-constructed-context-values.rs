use oxc_ast::{
    AstKind,
    ast::{
        Expression, IdentifierReference, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        JSXElementName, JSXMemberExpressionObject,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const CONTEXT_MODULE_SOURCES: [&str; 3] = ["react", "use-context-selector", "react-tracked"];
const MESSAGE: &str =
    "Every reader of this context redraws on each render because you build its `value` inline.";

#[derive(Debug, Default, Clone)]
pub struct JsxNoConstructedContextValues;

declare_oxc_lint!(
    /// Disallow inline-constructed React context values.
    JsxNoConstructedContextValues,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow inline-constructed React context values.",
);

impl Rule for JsxNoConstructedContextValues {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_context_provider_name(&opening_element.name, ctx)
            || crate::ast_util::get_enclosing_function(node, ctx).is_none()
        {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if attribute_name.name != "value" {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            if is_constructed_context_value(expression) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(attribute.span));
            }
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }
}

fn is_context_provider_name<'a>(name: &JSXElementName<'a>, ctx: &LintContext<'a>) -> bool {
    match name {
        JSXElementName::MemberExpression(member_expression)
            if member_expression.property.name == "Provider" =>
        {
            let JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            is_known_context_identifier(identifier, true, ctx)
        }
        JSXElementName::IdentifierReference(identifier) => {
            is_context_module_named_import(identifier, ctx)
                || is_known_context_identifier(identifier, false, ctx)
        }
        _ => false,
    }
}

fn is_known_context_identifier<'a>(
    identifier: &IdentifierReference<'a>,
    allow_context_named_import: bool,
    ctx: &LintContext<'a>,
) -> bool {
    if allow_context_named_import && is_context_named_import(identifier, ctx) {
        return true;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if is_context_binding_symbol(symbol_id, ctx) {
        return true;
    }
    let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    ctx.nodes().iter().any(|candidate| {
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            return false;
        };
        let Some(binding_identifier) = declarator.id.get_binding_identifier() else {
            return false;
        };
        binding_identifier.name == identifier.name
            && ctx
                .scoping()
                .symbol_scope_id(binding_identifier.symbol_id())
                == symbol_scope_id
            && is_stable_top_level_context_symbol(binding_identifier.symbol_id(), ctx)
            && is_context_declarator(candidate, declarator, binding_identifier.symbol_id(), ctx)
    })
}

fn is_context_binding_symbol<'a>(symbol_id: oxc_semantic::SymbolId, ctx: &LintContext<'a>) -> bool {
    if !is_stable_top_level_context_symbol(symbol_id, ctx) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    is_context_declarator(declaration, declarator, symbol_id, ctx)
}

fn is_stable_top_level_context_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
        && !ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
}

fn is_context_declarator<'a>(
    declaration: &AstNode<'a>,
    declarator: &oxc_ast::ast::VariableDeclarator<'a>,
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const()
        || declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    module_api_path_matches(
        &call_expression.callee,
        &["createContext"],
        &CONTEXT_MODULE_SOURCES,
        true,
        ctx,
    ) || is_global_react_create_context_call(call_expression, ctx)
}

fn is_context_named_import<'a>(
    identifier: &IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
        identifier.name.ends_with("Context")
            || matches!(
                &entry.import_name,
                ImportImportName::Name(imported_name) if imported_name.name().ends_with("Context")
            )
    })
}

fn is_context_module_named_import<'a>(
    identifier: &IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_context_named_import(identifier, ctx)
        && resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
            entry
                .module_request
                .name()
                .rsplit('/')
                .next()
                .is_some_and(|segment| segment == "context")
        })
}

fn is_global_react_create_context_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member_expression) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
    else {
        return false;
    };
    identifier.name == "React"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
        && member_expression.static_property_name() == Some("createContext")
}

fn is_constructed_context_value(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(_)
        | Expression::ArrayExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_)
        | Expression::NewExpression(_)
        | Expression::JSXElement(_)
        | Expression::JSXFragment(_) => true,
        Expression::ConditionalExpression(conditional_expression) => {
            is_constructed_context_value(&conditional_expression.consequent)
                || is_constructed_context_value(&conditional_expression.alternate)
        }
        Expression::LogicalExpression(logical_expression) => {
            is_constructed_context_value(&logical_expression.left)
                || is_constructed_context_value(&logical_expression.right)
        }
        _ => false,
    }
}
