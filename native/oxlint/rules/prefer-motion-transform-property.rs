use crate::{AstNode, context::LintContext, rule::Rule};
use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttributeValue, JSXElementName, JSXExpression, JSXMemberExpressionObject,
        ObjectExpression, ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

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
const INDIVIDUAL_MOTION_TRANSFORM_PROPERTY_NAMES: [&str; 16] = [
    "x",
    "y",
    "z",
    "translateX",
    "translateY",
    "translateZ",
    "scale",
    "scaleX",
    "scaleY",
    "rotate",
    "rotateX",
    "rotateY",
    "rotateZ",
    "skewX",
    "skewY",
    "transformPerspective",
];

#[derive(Debug, Default, Clone)]
pub struct PreferMotionTransformProperty;

declare_oxc_lint!(
    /// Prefer a single Motion transform string when compositor acceleration matters.
    PreferMotionTransformProperty,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Prefer a single Motion transform string.",
);

impl Rule for PreferMotionTransformProperty {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !prefer_motion_is_proven_element(&opening_element.name, ctx) {
            return;
        }

        let mut first_property_span = None;
        let mut property_names = Vec::new();
        for animation_property_name in MOTION_ANIMATE_PROPERTY_NAMES {
            if animation_property_name == "initial" {
                continue;
            }
            let Some(animation_object) =
                prefer_motion_animation_object(opening_element, animation_property_name)
            else {
                continue;
            };
            let mut animation_properties = Vec::new();
            let mut has_direct_transform = false;
            for property in &animation_object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    animation_properties.clear();
                    break;
                };
                let Some(property_name) =
                    prefer_motion_property_name(property).filter(|name| !name.is_empty())
                else {
                    animation_properties.clear();
                    break;
                };
                if property_name == "transform" {
                    has_direct_transform = true;
                } else if INDIVIDUAL_MOTION_TRANSFORM_PROPERTY_NAMES.contains(&property_name) {
                    animation_properties.push((property_name, property.span));
                }
            }
            if has_direct_transform || animation_properties.is_empty() {
                continue;
            }
            first_property_span.get_or_insert(animation_properties[0].1);
            for (property_name, _) in animation_properties {
                if !property_names.contains(&property_name) {
                    property_names.push(property_name);
                }
            }
        }

        let Some(first_property_span) = first_property_span else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Motion's individual {} transform keys can keep this animation on the main thread. Use a single transform string when compositor acceleration is important.",
                property_names.join(", "),
            ))
            .with_label(first_property_span),
        );
    }
}

fn prefer_motion_animation_object<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    property_name: &str,
) -> Option<&'b ObjectExpression<'a>> {
    let attribute = get_authoritative_jsx_attribute(opening_element, property_name, true)?;
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    let JSXExpression::ObjectExpression(object) = &container.expression else {
        return None;
    };
    Some(object)
}

fn prefer_motion_is_proven_element(
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
                    prefer_motion_component_symbol(symbol_id, ctx, &mut Vec::new())
                })
        }
        JSXElementName::MemberExpression(member) => {
            prefer_motion_factory_jsx_object(&member.object, ctx, &mut Vec::new())
        }
        _ => false,
    }
}

fn prefer_motion_factory_jsx_object(
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
                prefer_motion_factory_symbol(symbol_id, ctx, visited_symbol_ids)
            }),
        JSXMemberExpressionObject::MemberExpression(member) => {
            MOTION_FACTORY_EXPORTS.contains(&member.property.name.as_str())
                && matches!(
                    &member.object,
                    JSXMemberExpressionObject::IdentifierReference(identifier)
                        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                            |symbol_id| prefer_motion_resolves_to_namespace_import(
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

fn prefer_motion_factory_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if prefer_motion_is_namespace_import(symbol_id, &MOTION_TAG_MODULES, ctx)
        || prefer_motion_imported_name(symbol_id, &MOTION_FACTORY_MODULES, ctx)
            .is_some_and(|name| MOTION_FACTORY_EXPORTS.contains(&name))
    {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = prefer_motion_const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let result = prefer_motion_factory_expression(initializer, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    result
}

fn prefer_motion_factory_expression(
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
                prefer_motion_factory_symbol(symbol_id, ctx, visited_symbol_ids)
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
                    |symbol_id| prefer_motion_resolves_to_namespace_import(
                        symbol_id,
                        &MOTION_FACTORY_MODULES,
                        ctx,
                        visited_symbol_ids,
                    )
                )
        )
}

fn prefer_motion_component_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if prefer_motion_imported_name(symbol_id, &MOTION_TAG_MODULES, ctx)
        .is_some_and(|name| name != "create")
    {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = prefer_motion_const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let result = prefer_motion_component_expression(initializer, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    result
}

fn prefer_motion_component_expression(
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
                prefer_motion_component_symbol(symbol_id, ctx, visited_symbol_ids)
            });
    }
    if let Some(member) = expression.as_member_expression()
        && prefer_motion_factory_expression(member.object(), ctx, visited_symbol_ids)
    {
        return true;
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    if prefer_motion_factory_expression(&call.callee, ctx, visited_symbol_ids) {
        return true;
    }
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("create")
        && prefer_motion_factory_expression(member.object(), ctx, visited_symbol_ids)
}

fn prefer_motion_const_initializer<'a>(
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

fn prefer_motion_imported_name<'a>(
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

fn prefer_motion_is_namespace_import(
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

fn prefer_motion_resolves_to_namespace_import(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if prefer_motion_is_namespace_import(symbol_id, module_sources, ctx) {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(Expression::Identifier(identifier)) =
        prefer_motion_const_initializer(symbol_id, ctx).map(Expression::get_inner_expression)
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
    let result = prefer_motion_resolves_to_namespace_import(
        next_symbol_id,
        module_sources,
        ctx,
        visited_symbol_ids,
    );
    visited_symbol_ids.pop();
    result
}

fn prefer_motion_property_name<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) if !property.computed => {
            Some(identifier.name.as_str())
        }
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        PropertyKey::TemplateLiteral(template)
            if property.computed && template.expressions.is_empty() =>
        {
            let quasi = template.quasis.first()?;
            Some(
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str()),
            )
        }
        _ => None,
    }
}
