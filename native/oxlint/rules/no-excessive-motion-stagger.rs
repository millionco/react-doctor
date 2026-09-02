use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, JSXAttributeValue, JSXElementName, JSXExpression,
        JSXMemberExpressionObject, ObjectProperty,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EXCESSIVE_MOTION_STAGGER_SECONDS: f64 = 0.08;
const MOTION_ANIMATE_PROPERTY_NAMES: [&str; 8] = [
    "animate",
    "initial",
    "exit",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
];
const MOTION_FACTORY_MODULES: [&str; 2] = ["framer-motion", "motion/react"];
const MOTION_TAG_MODULES: [&str; 4] = [
    "framer-motion/client",
    "framer-motion/m",
    "motion/react-client",
    "motion/react-m",
];
const MOTION_FACTORY_EXPORTS: [&str; 2] = ["m", "motion"];

#[derive(Debug, Default, Clone)]
pub struct NoExcessiveMotionStagger;

declare_oxc_lint!(
    /// Disallow excessive per-item Motion stagger intervals.
    NoExcessiveMotionStagger,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow excessive per-item Motion stagger intervals.",
);

impl Rule for NoExcessiveMotionStagger {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        for transition_object in no_excessive_motion_transition_objects(opening_element, ctx) {
            let Some((property, seconds)) =
                no_excessive_motion_stagger_value(transition_object, ctx)
            else {
                continue;
            };
            if seconds <= EXCESSIVE_MOTION_STAGGER_SECONDS {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This {}-second per-item stagger makes later children wait unnecessarily. Keep the interval at {} seconds or less.",
                    format_javascript_number(seconds),
                    format_javascript_number(EXCESSIVE_MOTION_STAGGER_SECONDS),
                ))
                .with_label(property.span),
            );
        }
    }
}

fn no_excessive_motion_transition_objects<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &'b LintContext<'a>,
) -> Vec<&'b oxc_ast::ast::ObjectExpression<'a>> {
    if !no_excessive_motion_is_proven_element(&opening_element.name, ctx) {
        return Vec::new();
    }
    let mut transition_objects = Vec::new();
    if let Some(transition_object) =
        no_excessive_motion_property_object(opening_element, "transition")
    {
        transition_objects.push(transition_object);
    }
    for animation_property_name in MOTION_ANIMATE_PROPERTY_NAMES {
        let Some(animation_object) =
            no_excessive_motion_property_object(opening_element, animation_property_name)
        else {
            continue;
        };
        let Some(transition_property) =
            no_excessive_motion_effective_property(animation_object, "transition")
        else {
            continue;
        };
        let Expression::ObjectExpression(transition_object) = &transition_property.value else {
            continue;
        };
        transition_objects.push(transition_object);
    }
    transition_objects
}

fn no_excessive_motion_effective_property<'a, 'b>(
    object: &'b oxc_ast::ast::ObjectExpression<'a>,
    target_name: &str,
) -> Option<&'b ObjectProperty<'a>> {
    for property in object.properties.iter().rev() {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        let property_name = match &property.key {
            oxc_ast::ast::PropertyKey::StaticIdentifier(identifier) if !property.computed => {
                identifier.name.as_str()
            }
            oxc_ast::ast::PropertyKey::StringLiteral(literal) => literal.value.as_str(),
            oxc_ast::ast::PropertyKey::TemplateLiteral(template)
                if property.computed && template.expressions.is_empty() =>
            {
                let quasi = template.quasis.first()?;
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
            }
            _ => return None,
        };
        if property_name.is_empty() {
            return None;
        }
        if property_name == target_name {
            return Some(property);
        }
    }
    None
}

fn no_excessive_motion_property_object<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    property_name: &str,
) -> Option<&'b oxc_ast::ast::ObjectExpression<'a>> {
    let attribute = get_authoritative_jsx_attribute(opening_element, property_name, true)?;
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    let JSXExpression::ObjectExpression(object) = &container.expression else {
        return None;
    };
    Some(object)
}

fn no_excessive_motion_is_proven_element(
    element_name: &JSXElementName<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match element_name {
        JSXElementName::IdentifierReference(identifier) => {
            if identifier
                .name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_lowercase)
            {
                return false;
            }
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| {
                    no_excessive_motion_component_symbol(symbol_id, ctx, &mut Vec::new())
                })
        }
        JSXElementName::MemberExpression(member) => {
            no_excessive_motion_factory_jsx_object(&member.object, ctx, &mut Vec::new())
        }
        _ => false,
    }
}

fn no_excessive_motion_factory_jsx_object(
    object: &JSXMemberExpressionObject<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    match object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                no_excessive_motion_factory_symbol(symbol_id, ctx, visited_symbol_ids)
            }),
        JSXMemberExpressionObject::MemberExpression(member) => {
            MOTION_FACTORY_EXPORTS.contains(&member.property.name.as_str())
                && matches!(
                    &member.object,
                    JSXMemberExpressionObject::IdentifierReference(identifier)
                        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                            |symbol_id| no_excessive_motion_resolves_to_namespace_import(
                                symbol_id,
                                &MOTION_FACTORY_MODULES,
                                ctx,
                                visited_symbol_ids,
                            )
                        )
                )
        }
        _ => false,
    }
}

fn no_excessive_motion_factory_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if no_excessive_motion_is_namespace_import(symbol_id, &MOTION_TAG_MODULES, ctx)
        || no_excessive_motion_imported_name(symbol_id, &MOTION_FACTORY_MODULES, ctx)
            .is_some_and(|name| MOTION_FACTORY_EXPORTS.contains(&name))
    {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = no_excessive_motion_const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let result = no_excessive_motion_factory_expression(initializer, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    result
}

fn no_excessive_motion_factory_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                no_excessive_motion_factory_symbol(symbol_id, ctx, visited_symbol_ids)
            });
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    MOTION_FACTORY_EXPORTS.contains(&member.static_property_name().unwrap_or(""))
        && matches!(
            member.object().get_inner_expression(),
            Expression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                    |symbol_id| no_excessive_motion_resolves_to_namespace_import(
                        symbol_id,
                        &MOTION_FACTORY_MODULES,
                        ctx,
                        visited_symbol_ids,
                    )
                )
        )
}

fn no_excessive_motion_component_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if no_excessive_motion_imported_name(symbol_id, &MOTION_TAG_MODULES, ctx)
        .is_some_and(|name| name != "create")
    {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = no_excessive_motion_const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let result = no_excessive_motion_component_expression(initializer, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    result
}

fn no_excessive_motion_component_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                no_excessive_motion_component_symbol(symbol_id, ctx, visited_symbol_ids)
            });
    }
    if let Some(member) = expression.as_member_expression()
        && no_excessive_motion_factory_expression(member.object(), ctx, visited_symbol_ids)
    {
        return true;
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    if no_excessive_motion_factory_expression(&call.callee, ctx, visited_symbol_ids) {
        return true;
    }
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("create")
        && no_excessive_motion_factory_expression(member.object(), ctx, visited_symbol_ids)
}

fn no_excessive_motion_const_initializer<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    (variable_declaration.kind.is_const()
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|identifier| identifier.symbol_id() == symbol_id))
    .then_some(declarator.init.as_ref())?
}

fn no_excessive_motion_imported_name<'a>(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &'a LintContext<'_>,
) -> Option<&'a str> {
    ctx.module_record().import_entries.iter().find_map(|entry| {
        (!entry.is_type
            && module_sources.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id))
        .then(|| match &entry.import_name {
            crate::module_record::ImportImportName::Name(name) => Some(name.name()),
            crate::module_record::ImportImportName::Default(_)
            | crate::module_record::ImportImportName::NamespaceObject => None,
        })?
    })
}

fn no_excessive_motion_is_namespace_import(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && module_sources.contains(&entry.module_request.name())
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn no_excessive_motion_resolves_to_namespace_import(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if no_excessive_motion_is_namespace_import(symbol_id, module_sources, ctx) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(Expression::Identifier(identifier)) =
        no_excessive_motion_const_initializer(symbol_id, ctx).map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(next_symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let result = no_excessive_motion_resolves_to_namespace_import(
        next_symbol_id,
        module_sources,
        ctx,
        visited_symbol_ids,
    );
    visited_symbol_ids.pop();
    result
}

fn no_excessive_motion_stagger_value<'a, 'b>(
    transition_object: &'b oxc_ast::ast::ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'b ObjectProperty<'a>, f64)> {
    if let Some(legacy_property) =
        no_excessive_motion_effective_property(transition_object, "staggerChildren")
        && let Some(seconds) = no_excessive_motion_legacy_number(legacy_property)
    {
        return Some((legacy_property, seconds));
    }
    let delay_children_property =
        no_excessive_motion_effective_property(transition_object, "delayChildren")?;
    let Expression::CallExpression(stagger_call) = &delay_children_property.value else {
        return None;
    };
    if !no_excessive_motion_is_stagger_call(stagger_call, ctx) {
        return None;
    }
    let Expression::NumericLiteral(interval) = stagger_call
        .arguments
        .first()
        .and_then(Argument::as_expression)?
    else {
        return None;
    };
    Some((delay_children_property, interval.value))
}

fn no_excessive_motion_legacy_number(property: &ObjectProperty<'_>) -> Option<f64> {
    match &property.value {
        Expression::NumericLiteral(number) => Some(number.value),
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation =>
        {
            match &unary.argument {
                Expression::NumericLiteral(number) => Some(-number.value),
                _ => None,
            }
        }
        _ => None,
    }
}

fn no_excessive_motion_is_stagger_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = &call.callee else {
        return false;
    };
    let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        MOTION_FACTORY_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "stagger"
            )
    })
}
